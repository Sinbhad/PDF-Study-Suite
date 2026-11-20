/**
 * Corpus loader for tools/eval-quiz.js and tools/eval-summary.js: turns one manifest entry into the study
 * materials the app produces (summary, flashcards, quiz, practice test) plus the scope text and structures.
 *
 * Includes:
 *   - Deterministic disk parse cache keyed by PDF path/size/mtime, pages/mode, and SHA-256 of src/pdf/*.js
 *     (override dir with PDF_PARSE_CACHE_DIR; disable with opts.noCache = true).
 *   - Optional OCR hydration (--with-ocr, --ocr-cache=<dir>) applying cached or live browser PP-OCRv5
 *     results onto picture pages before study material generation.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CACHE_DIR = process.env.PDF_PARSE_CACHE_DIR || path.join(os.tmpdir(), 'pdf-study-suite-parse-cache');

let cachedSrcPdfHash = null;
function getSrcPdfHash() {
  if (cachedSrcPdfHash) return cachedSrcPdfHash;
  const pdfDir = path.join(ROOT, 'src/pdf');
  const h = crypto.createHash('sha256');
  const files = fs.readdirSync(pdfDir).filter((f) => f.endsWith('.js')).sort();
  for (const f of files) {
    h.update(f);
    h.update('\0');
    h.update(fs.readFileSync(path.join(pdfDir, f)));
  }
  cachedSrcPdfHash = h.digest('hex').slice(0, 16);
  return cachedSrcPdfHash;
}

/** Loads the browser scripts into Node in index.html order (same list as tools/run-pdf.js). */
function loadPipeline() {
  globalThis.window = globalThis;
  globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"?]+)/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/') || s === 'src/ui/study-pipeline.js');
  for (const s of scripts) require(path.join(ROOT, s));
  return globalThis.PDFStudy;
}

function readManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(manifest.entries) || !manifest.entries.length) throw new Error(`no entries in ${file}`);
  return manifest;
}

/** Practice-test questions as one flat list, whatever shape the test object has. */
function testQuestions(test) {
  if (!test) return [];
  if (Array.isArray(test.questions)) return test.questions;
  return (test.sections || []).flatMap((s) => s.questions || []);
}

function parseCacheKey(absPath, entry) {
  const st = fs.statSync(absPath);
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({
    v: 2,
    absPath,
    size: st.size,
    mtimeMs: st.mtimeMs,
    pages: entry.pages || null,
    mode: entry.mode || null,
    srcPdfHash: getSrcPdfHash(),
  }));
  return h.digest('hex');
}

function serializeParsed(parsed) {
  return {
    numPages: parsed.numPages,
    initialPageNums: (parsed.pages || []).map((p) => p && p.pageNumber).filter(Boolean),
    outline: parsed.outline || [],
    isLazy: Boolean(parsed.isLazy),
    pageLabels: parsed.pageLabels || null,
    inkSummary: parsed.inkSummary || null,
    pageEntries: Array.from((parsed.pageCache || new Map()).entries()),
  };
}

function hydrateParsed(raw) {
  const data = JSON.parse(JSON.stringify(raw));
  const pageCache = new Map(data.pageEntries || []);
  const pages = (data.initialPageNums || []).map((n) => pageCache.get(n)).filter(Boolean);
  return {
    pdfDoc: {},
    numPages: data.numPages,
    pages,
    pageCache,
    outline: data.outline || [],
    isLazy: Boolean(data.isLazy),
    pageLabels: data.pageLabels || null,
    inkSummary: data.inkSummary || null,
  };
}

function readParseCache(cacheFile) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    return hydrateParsed(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  } catch (_e) {
    return null;
  }
}

function writeParseCache(cacheFile, parsed) {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(serializeParsed(parsed)));
    fs.renameSync(tmp, cacheFile);
  } catch (_e) {
    // Cache write errors are non-fatal
  }
}

/** Populate missing OCR cache for picture pages in headless browser when vendor/hw/ is installed. */
async function populateOcrCache(absPath, pageNumbers, ocrCacheFile) {
  const { findBrowser, openApp } = require('./eval-browser.js');
  const exe = findBrowser();
  if (!exe || !pageNumbers.length) return {};
  const app = await openApp({ exe, timeoutMs: 300000, env: { LARSON_PDF: absPath } });
  try {
    const raw = await app.evalJs(`(async () => {
      const avail = await PDFStudy.hwAvailability.ready;
      if (!avail.available) return JSON.stringify({ error: avail.reason });
      const buf = await (await fetch('/local-larson.pdf')).arrayBuffer();
      const parsed = await PDFStudy.pdfLoader.loadPdfDocument(buf, () => {});
      const targets = ${JSON.stringify(pageNumbers)};
      await PDFStudy.pdfLoader.ensurePagesLoaded(parsed, Math.min(...targets), Math.max(...targets), () => {});
      await PDFStudy.hwPipeline.ensureRecognised(parsed, Math.min(...targets), Math.max(...targets), {});
      const out = {};
      for (const n of targets) {
        const p = parsed.pageCache.get(n);
        if (p && p.ink && (p.ink.raw || p.ink.result)) out[n] = p.ink.raw || p.ink.result;
      }
      return JSON.stringify({ pages: out });
    })()`);
    const parsedOut = JSON.parse(raw);
    if (parsedOut.error || !parsedOut.pages) return {};
    fs.mkdirSync(path.dirname(ocrCacheFile), { recursive: true });
    fs.writeFileSync(ocrCacheFile, JSON.stringify(parsedOut, null, 1));
    return parsedOut.pages;
  } finally {
    app.close();
  }
}

async function applyOcrIfRequested(P, parsed, entry, start, end, opts) {
  if (!opts.withOcr) return;
  const cacheDir = opts.ocrCache ? path.resolve(ROOT, opts.ocrCache) : path.join(ROOT, 'tests/corpus/local/ocr-cache');
  const ocrFile = path.join(cacheDir, `${entry.id}.ocr.json`);
  let ocrPages = null;
  if (fs.existsSync(ocrFile)) {
    try {
      ocrPages = JSON.parse(fs.readFileSync(ocrFile, 'utf8')).pages || {};
    } catch (_e) {
      ocrPages = null;
    }
  }
  if (!ocrPages && opts.ocrPopulate) {
    const need = [];
    for (let n = start; n <= end; n++) {
      const p = parsed.pageCache.get(n);
      if (p && p.ink && p.ink.needsRecognition) need.push(n);
    }
    if (need.length) ocrPages = await populateOcrCache(path.resolve(ROOT, entry.path), need, ocrFile);
  }
  if (!ocrPages || !P.ocrLines) return;
  for (let n = start; n <= end; n++) {
    const p = parsed.pageCache.get(n);
    const res = ocrPages[String(n)] || ocrPages[n];
    if (p && res) P.ocrLines.applyToPage(p, res);
  }
}

async function pdfMaterials(P, entry, counts, opts = {}) {
  const absPath = path.resolve(ROOT, entry.path);
  const useCache = !opts.noCache;
  const cacheFile = useCache ? path.join(DEFAULT_CACHE_DIR, `${parseCacheKey(absPath, entry)}.json`) : '';
  let parsed = useCache ? readParseCache(cacheFile) : null;
  let cls;
  let mode;
  let start;
  let end;

  if (!parsed) {
    const buf = fs.readFileSync(absPath);
    const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parsed = await P.pdfLoader.loadPdfDocument(data, () => {});
    cls = P.classifier.classifyDocument(parsed);
    mode = entry.mode === 'slides' ? 'slide_deck' : entry.mode === 'book' ? 'book' : cls.type;
    [start, end] = entry.pages || [1, parsed.numPages];
    if (parsed.isLazy && P.pdfLoader.ensurePagesLoaded) {
      await P.pdfLoader.ensurePagesLoaded(parsed, start, end, () => {});
    }
    if (useCache) writeParseCache(cacheFile, parsed);
  } else {
    cls = P.classifier.classifyDocument(parsed);
    mode = entry.mode === 'slides' ? 'slide_deck' : entry.mode === 'book' ? 'book' : cls.type;
    [start, end] = entry.pages || [1, parsed.numPages];
  }

  await applyOcrIfRequested(P, parsed, entry, start, end, opts);

  const state = {
    parsedPdf: parsed,
    classification: cls,
    activeMode: mode,
    quizCount: counts.quiz,
    quizSeed: 0,
    slideDeck: P.slideExtractor.extractSlideDeck(parsed),
    bookHierarchy: P.bookHierarchy.extractBookHierarchy(parsed),
    selectedScope: { id: 'eval', type: 'range', title: entry.title || `Pages ${start}-${end}`, startPage: start, endPage: end },
    generated: {},
  };
  await P.studyPipeline.buildMaterials(state, start, end, () => {});
  const slides = state.slideDeck.slides.filter((s) => s.slideNumber >= start && s.slideNumber <= end);
  const tableText = (list) => (list || []).map((t) => t.text || '').filter(Boolean);
  const scopeText = mode === 'slide_deck'
    ? slides.map((s) => [s.title, ...(s.bullets || []), ...tableText(s.tables)].join('\n')).join('\n\n')
    : [(state.lastScopeObj && state.lastScopeObj.text) || '', ...tableText(state.lastScopeObj && state.lastScopeObj.tables)].join('\n');
  return {
    mode,
    scopeText,
    scopeObj: state.lastScopeObj || null,
    slides: mode === 'slide_deck' ? slides : null,
    generated: state.generated,
  };
}

function textMaterials(P, entry, counts) {
  const text = fs.readFileSync(path.join(ROOT, entry.path), 'utf8').replace(/\r\n/g, '\n');
  const title = entry.title || path.basename(entry.path, '.txt');
  const summary = P.summarizer.summarizeText(text, { headings: [title], didacticBlocks: [] });
  const quiz = P.quizEngine.generateQuiz(text, { maxQuestions: counts.quiz, mode: 'book', didacticBlocks: [], seedOffset: 0 });
  const test = P.studyPipeline.buildPracticeTest(text, text, { mode: 'book', didacticBlocks: [], scopeTitle: title });
  const flashcards = P.flashcardEngine.extractBookFlashcards(text, title, []);
  return { mode: 'book', scopeText: text, scopeObj: null, slides: null, generated: { summary, quiz, test, flashcards } };
}

/**
 * -> { mode, scopeText, scopeObj, slides, summary, quiz, test, flashcards, requested }.
 */
async function buildEntry(P, entry, manifest, opts = {}) {
  const counts = { quiz: manifest.quizCount || 10, test: manifest.testCount || 20 };
  if (entry.kind !== 'pdf' && entry.kind !== 'text') throw new Error(`entry ${entry.id}: kind must be "pdf" or "text"`);
  const res = entry.kind === 'pdf'
    ? await pdfMaterials(P, entry, counts, opts)
    : textMaterials(P, entry, counts);
  return {
    mode: res.mode,
    scopeText: res.scopeText,
    scopeObj: res.scopeObj,
    slides: res.slides,
    summary: res.generated.summary || null,
    quiz: res.generated.quiz || [],
    test: testQuestions(res.generated.test),
    flashcards: res.generated.flashcards || [],
    requested: counts.quiz + counts.test,
  };
}

module.exports = { ROOT, DEFAULT_CACHE_DIR, loadPipeline, readManifest, buildEntry, testQuestions };

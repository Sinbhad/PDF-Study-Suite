/**
 * End-to-end part of the handwriting suite: real PDF.js in Node, a synthetic ink-only PDF, the real
 * pipeline, a fake Worker around the real worker core and a mock engine. Called by handwriting_fixtures.js.
 */
const fs = require('fs');
const path = require('path');
const synth = require('./hw_synth.js');
const ROOT = path.join(__dirname, '..');

function loadEnvironment() {
  globalThis.window = globalThis;
  globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
    .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/') || s === 'src/ui/study-pipeline.js');
  for (const s of scripts) require(path.join(ROOT, s));
  for (const f of ['src/pdf/ink-detect.js', 'src/pdf/ocr-lines.js', 'src/hw/hw-client.js', 'src/hw/hw-pipeline.js', 'src/ui/study-pipeline.js']) require(path.join(ROOT, f));
  return globalThis.PDFStudy;
}

const LINES = [
  ['A limit describes the value a function approaches.', 0.9],
  ['Definition: A function is continuous at c if the limit equals f(c).', 0.3],
  ['The derivative is defined as the limit of the difference quotient.', 0.85],
];

/** Page bitmap (scale 2 => 1224x1584) with three text rows. */
function pageBitmap() {
  const img = synth.bitmap(1224, 1584);
  [200, 300, 400].forEach((y) => synth.wordRow(img, 100, y, 24, 6));
  return { ...img, scale: 2 };
}

async function run(check) {
  const P = loadEnvironment();
  const load = (buf) => P.pdfLoader.loadPdfDocument(buf, () => {});

  // ---- ink PDF is detected ----
  const parsed = await load(synth.buildInkPdf(2, 36));
  check('e2e: ink PDF has 2 pages', parsed.numPages === 2);
  check('e2e: every ink page needs recognition with wordCount 0',
    parsed.pages.every((p) => p.ink && p.ink.needsRecognition === true && p.wordCount === 0),
    JSON.stringify(parsed.pages.map((p) => [p.wordCount, p.ink])));
  check('e2e: summarise sees 2 needing pages', P.inkDetect.summarise(parsed).needing === 2);

  // ---- text PDF is untouched and never starts a worker ----
  const textBuf = fs.readFileSync(path.join(ROOT, 'samples', 'sample_textbook_chapters.pdf'));
  const text = await load(textBuf.buffer.slice(textBuf.byteOffset, textBuf.byteOffset + textBuf.byteLength));
  check('e2e: text PDF pages need no recognition', Array.from(text.pageCache.values()).every((p) => !p.ink || !p.ink.needsRecognition));
  const textStats = synth.newStats();
  const textClient = P.hwClient.create({ workerFactory: synth.fakeWorkerFactory(synth.mockEngine(), textStats) });
  const zero = await P.hwPipeline.ensureRecognised(text, 1, Math.min(text.numPages, 5), { client: textClient, renderPage: () => { throw new Error('should not render'); } });
  check('e2e: text PDF -> zero stats', zero.pages === 0 && zero.regions === 0 && zero.low === 0 && zero.cancelled === false, JSON.stringify(zero));
  check('e2e: text PDF never creates the worker', textStats.created === 0);

  // ---- recognise the ink PDF ----
  const engine = synth.mockEngine({ script: LINES });
  const stats = synth.newStats();
  const client = P.hwClient.create({ workerFactory: synth.fakeWorkerFactory(engine, stats) });
  let renders = 0;
  const renderPage = async () => { renders++; return pageBitmap(); };
  const phases = new Set();
  const r1 = await P.hwPipeline.ensureRecognised(parsed, 1, 2, { renderPage, client, onProgress: (p) => phases.add(p.phase) });
  check('e2e: stats pages === 2', r1.pages === 2, JSON.stringify(r1));
  check('e2e: stats regions === 6', r1.regions === 6, JSON.stringify(r1));
  check('e2e: stats low >= 1', r1.low >= 1, JSON.stringify(r1));
  check('e2e: not cancelled; engine reported', r1.cancelled === false && r1.engine && r1.engine.available === true);
  check('e2e: page progress reported', phases.has('page'));
  check('e2e: pages now have the trusted lines and words', parsed.pages.every((p) => p.lines.length === 2 && p.wordCount > 15 && p.ink.recognised),
    JSON.stringify(parsed.pages.map((p) => [p.lines.length, p.wordCount])));
  check('e2e: line text is the recognised sentence', parsed.pages[0].lines[0].text === LINES[0][0], parsed.pages[0].lines[0].text);
  check('e2e: low-confidence line held back from page lines', parsed.pages[0].lines.every((l) => l.text !== LINES[1][0] && !l.ocr.low));
  check('e2e: lowConfidence lists it', P.ocrLines.lowConfidence(parsed.pages[0]).length === 1);
  check('e2e: worker created once', stats.created === 1);

  const r2 = await P.hwPipeline.ensureRecognised(parsed, 1, 2, { renderPage, client });
  check('e2e: second call does no work', r2.pages === 0 && renders === 2, JSON.stringify(r2));

  // ---- abort ----
  const fresh = await load(synth.buildInkPdf(2, 36));
  const aborted = new AbortController();
  aborted.abort();
  const r3 = await P.hwPipeline.ensureRecognised(fresh, 1, 2, { renderPage, client, signal: aborted.signal });
  check('e2e: pre-aborted signal -> cancelled', r3.cancelled === true && r3.pages === 0, JSON.stringify(r3));
  const ac = new AbortController();
  const r4 = await P.hwPipeline.ensureRecognised(fresh, 1, 2, { client, signal: ac.signal, renderPage: async () => { ac.abort(); return pageBitmap(); } });
  check('e2e: abort mid-run -> cancelled, unfinished page not applied', r4.cancelled === true && !fresh.pages[0].ink.recognised, JSON.stringify(r4));

  // ---- study materials from the recognised document ----
  const state = {
    parsedPdf: parsed, classification: P.classifier.classifyDocument(parsed), activeMode: 'book', quizCount: 10, quizSeed: 0,
    slideDeck: P.slideExtractor.extractSlideDeck(parsed), bookHierarchy: P.bookHierarchy.extractBookHierarchy(parsed),
    selectedScope: { id: 't', type: 'range', title: 'Pages 1-2', startPage: 1, endPage: 2 }, generated: {},
  };
  await P.studyPipeline.buildMaterials(state, 1, 2, () => {});
  const g = state.generated;
  const scope = (state.lastScopeObj && state.lastScopeObj.text) || '';
  check('e2e: summary has sentences', g.summary && g.summary.sentences && g.summary.sentences.length > 0, JSON.stringify(g.summary));
  check('e2e: scope text has the trusted sentences, not the low one', LINES.every(([t, c]) => scope.includes(t.slice(0, 20)) === (c >= 0.6)), scope.slice(0, 300));
  const fc = (g.flashcards || []).length;
  const qz = (g.quiz || []).length;
  console.log(`info: recognised-ink materials -> flashcards ${fc}, quiz ${qz}, summary ${g.summary ? g.summary.sentences.length : 0}`);
  check('e2e: flashcards or quiz non-empty (rule engines)', fc + qz > 0, `flashcards=${fc} quiz=${qz}`);
}

module.exports = { run };

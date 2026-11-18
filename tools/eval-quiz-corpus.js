/**
 * Corpus loader for tools/eval-quiz.js: turns one manifest entry into the study materials the app would
 * show for it (quiz, practice test, flashcards) plus the scope text those were generated from.
 *
 *   kind "pdf"   the real pipeline, exactly as tools/run-pdf.js drives it (PDF.js parse -> classify ->
 *                studyPipeline.buildMaterials) over the entry's page range and mode
 *   kind "text"  a raw passage fed straight to the engines the way buildMaterials' textbook branch calls
 *                them, with no didactic blocks and no sections (a .txt has no page layout to mine)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Loads the browser scripts into Node in index.html order (same list as tools/run-pdf.js). */
function loadPipeline() {
  globalThis.window = globalThis;
  globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
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

async function pdfMaterials(P, entry, counts) {
  const buf = fs.readFileSync(path.resolve(ROOT, entry.path)); // resolve: a local manifest may hold absolute paths
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await P.pdfLoader.loadPdfDocument(data, () => {});
  const cls = P.classifier.classifyDocument(parsed);
  const mode = entry.mode === 'slides' ? 'slide_deck' : entry.mode === 'book' ? 'book' : cls.type;
  const [start, end] = entry.pages || [1, parsed.numPages];
  const state = {
    parsedPdf: parsed, classification: cls, activeMode: mode, quizCount: counts.quiz, quizSeed: 0,
    slideDeck: P.slideExtractor.extractSlideDeck(parsed),
    bookHierarchy: P.bookHierarchy.extractBookHierarchy(parsed),
    selectedScope: { id: 'eval', type: 'range', title: entry.title || `Pages ${start}-${end}`, startPage: start, endPage: end },
    generated: {},
  };
  await P.studyPipeline.buildMaterials(state, start, end, () => {});
  // The text the questions came from: the scope text for a textbook, the slide titles, bullets and tables for a
  // deck (a table's header and cells are printed on the slide, so a word from them is no recognition debris).
  const slides = state.slideDeck.slides.filter((s) => s.slideNumber >= start && s.slideNumber <= end);
  const tableText = (list) => (list || []).map((t) => t.text || '').filter(Boolean);
  const scopeText = mode === 'slide_deck'
    ? slides.map((s) => [s.title, ...(s.bullets || []), ...tableText(s.tables)].join('\n')).join('\n\n')
    : [(state.lastScopeObj && state.lastScopeObj.text) || '', ...tableText(state.lastScopeObj && state.lastScopeObj.tables)].join('\n');
  return { scopeText, generated: state.generated };
}

function textMaterials(P, entry, counts) {
  const text = fs.readFileSync(path.join(ROOT, entry.path), 'utf8').replace(/\r\n/g, '\n');
  const title = entry.title || path.basename(entry.path, '.txt');
  const quiz = P.quizEngine.generateQuiz(text, { maxQuestions: counts.quiz, mode: 'book', didacticBlocks: [], seedOffset: 0 });
  const test = P.studyPipeline.buildPracticeTest(text, text, { mode: 'book', didacticBlocks: [], scopeTitle: title });
  const flashcards = P.flashcardEngine.extractBookFlashcards(text, title, []);
  return { scopeText: text, generated: { quiz, test, flashcards } };
}

/**
 * -> { scopeText, quiz, test, flashcards, requested }. `requested` is what the app asks the engines
 * for: the quiz length plus the practice test's fixed 20.
 */
async function buildEntry(P, entry, manifest) {
  const counts = { quiz: manifest.quizCount || 10, test: manifest.testCount || 20 };
  if (entry.kind !== 'pdf' && entry.kind !== 'text') throw new Error(`entry ${entry.id}: kind must be "pdf" or "text"`);
  const { scopeText, generated } = entry.kind === 'pdf'
    ? await pdfMaterials(P, entry, counts)
    : textMaterials(P, entry, counts);
  return {
    scopeText,
    quiz: generated.quiz || [],
    test: testQuestions(generated.test),
    flashcards: generated.flashcards || [],
    requested: counts.quiz + counts.test,
  };
}

module.exports = { ROOT, loadPipeline, readManifest, buildEntry, testQuestions };

/**
 * Dev harness: runs a saved handwriting page result (the recogniser's per-page JSON) through the same
 * document -> study pipeline the browser uses, without rendering. Recognition is replaced by a stand-in
 * that applies the saved result with ocrLines.applyToPage when the pipeline asks for it.
 * Usage: node tools/run-ocr-result.js <page-result.json> [--out=report.json] [--full]
 * Prints a compact report: mode, page lines, sections / blocks, summary, flashcards, quiz, practice test.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
if (!pos[0]) { console.error('usage: node tools/run-ocr-result.js <page-result.json> [--out=file.json] [--full]'); process.exit(2); }

globalThis.window = globalThis;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const listed = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
  .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/') || s === 'src/ui/study-pipeline.js');
// Modules not yet listed in index.html still load (ocr-*.js before the rest of src/pdf)
const extra = fs.readdirSync(path.join(ROOT, 'src/pdf')).filter((f) => /^ocr-.+\.js$/.test(f))
  .map((f) => `src/pdf/${f}`).filter((s) => !listed.includes(s));
for (const s of extra.concat(listed)) require(path.join(ROOT, s));
const P = globalThis.PDFStudy;

/** One-page parsed document as the loader leaves a page without a text layer. */
function documentFor(result) {
  const scale = result.scale > 0 ? result.scale : 1;
  const width = (result.width || 0) / scale;
  const height = (result.height || 0) / scale;
  const page = {
    pageNumber: result.pageNumber || 1, width, height, aspectRatio: width / Math.max(1, height),
    lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', recognised: false },
  };
  return { numPages: 1, pages: [page], pageCache: new Map([[page.pageNumber, page]]), outline: [], isLazy: false };
}

/** Recognition stand-in: same return shape as hwPipeline.ensureRecognised, applies the saved result. */
function recogniserFor(result) {
  return {
    ensureRecognised: async (parsed, start, end) => {
      let pages = 0;
      for (const page of parsed.pages) {
        if (page.pageNumber < start || page.pageNumber > end || page.ink.recognised) continue;
        P.ocrLines.applyToPage(page, Object.assign({}, result, { pageNumber: page.pageNumber }));
        pages++;
      }
      return { pages, cancelled: false, engine: { available: true, name: 'saved-result' } };
    },
  };
}

/** What main.processLoadedDocument + setDefaultScope do, minus the DOM. */
function openDocument(parsed) {
  let cls = P.classifier.classifyDocument(parsed);
  let mode = cls.type;
  const ink = P.inkDetect.summarise(parsed);
  if (ink && ink.share >= 0.5) {
    mode = 'book';
    cls = Object.assign({}, cls, { type: 'book', reasons: ['Handwritten or scanned pages'].concat(cls.reasons || []) });
  }
  const state = {
    parsedPdf: parsed, classification: cls, activeMode: mode, quizCount: 10, quizSeed: 0, generated: {},
    slideDeck: P.slideExtractor.extractSlideDeck(parsed), bookHierarchy: P.bookHierarchy.extractBookHierarchy(parsed),
  };
  const total = parsed.numPages;
  if (mode === 'slide_deck') {
    state.selectedScope = { id: 'all-slides', type: 'all_slides', title: `All slides (1-${total})`, startPage: 1, endPage: total };
    return state;
  }
  const chapters = state.bookHierarchy.chapters || [];
  const ch = chapters.find((c) => !c.isExtra) || chapters[0];
  const sec = ch && ((ch.sections || []).find((s) => !s.isExtra) || (ch.sections || [])[0]);
  state.selectedScope = sec
    ? { id: sec.id, type: 'section', title: `${sec.title} (${ch.title})`, startPage: sec.startPage, endPage: sec.endPage }
    : ch ? { id: ch.id, type: 'chapter', title: ch.title, startPage: ch.startPage, endPage: ch.endPage }
      : { id: 'all-book', type: 'all_book', title: `Pages 1-${total}`, startPage: 1, endPage: total };
  return state;
}

const cut = (s, n = 140) => { const t = String(s == null ? '' : s).replace(/\s+/g, ' '); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

function report(state, result) {
  const page = state.parsedPdf.pages[0];
  const scope = state.lastScopeObj || {};
  const g = state.generated || {};
  const summary = g.summary || {};
  const sentences = summary.sentences || summary.overviewSentences || [];
  const cards = g.flashcards || [];
  const quiz = g.quiz || [];
  const test = g.test;
  const full = 'full' in flags;
  return {
    mode: state.activeMode,
    scope: state.selectedScope.title,
    resultLines: (result.lines || []).length,
    layout: result.layout || 'page',
    pageLines: page.lines.length,
    lowHeldBack: P.ocrLines.lowConfidence(page).length,
    headings: page.lines.filter((l) => l.isBold || l.fontSize > 12).length,
    canvasTopics: scope.canvas ? scope.canvas.topics.map((t) => `${cut(t.name, 40)} (${t.slides.length} blocks)`) : undefined,
    canvasShare: scope.canvas ? Math.round(scope.canvas.share * 100) / 100 : undefined,
    didacticBlocks: (scope.didacticBlocks || []).map((b) => `${b.category}: ${cut(b.title, 60)}`),
    scopeTextLines: String(scope.text || '').split('\n').length,
    scopeText: full ? scope.text : undefined,
    summary: {
      sentences: sentences.length,
      sample: sentences.slice(0, full ? 99 : 6).map((s) => cut(typeof s === 'string' ? s : s.text || s.sentence)),
      topicBlocks: (summary.slideBreakdown || []).length, definitions: (summary.definitions || []).length,
    },
    flashcards: {
      count: cards.length,
      first: cards.slice(0, full ? 999 : 8).map((c) => `${cut(c.front, 70)}  =>  ${cut(c.back, 110)}${c.context ? `  [${cut(c.context, 30)}]` : ''}`),
    },
    quiz: {
      count: quiz.length,
      first: quiz.slice(0, full ? 99 : 5).map((q) => ({ q: cut(q.question, 160), options: (q.options || []).map((o) => cut(o, 70)), answer: cut(q.answer, 70) })),
    },
    test: {
      count: P.studyPipeline.testQuestionCount(test),
      sections: ((test && test.sections) || []).map((s) => `${s.name}: ${(s.questions || []).length}`),
    },
  };
}

(async () => {
  const result = JSON.parse(fs.readFileSync(pos[0], 'utf8'));
  const parsed = documentFor(result);
  P.hwPipeline = recogniserFor(result);
  const state = openDocument(parsed);
  const { startPage, endPage } = state.selectedScope;
  await P.studyPipeline.buildMaterials(state, startPage, endPage, () => {});
  const json = JSON.stringify(report(state, result), null, 1);
  if (flags.out) fs.writeFileSync(flags.out, json); else process.stdout.write(json + '\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

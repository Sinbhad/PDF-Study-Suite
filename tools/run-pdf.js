/**
 * Dev harness: runs the real extraction + study pipeline on a PDF in Node (no browser).
 * Usage: node tools/run-pdf.js <file.pdf> [startPage endPage] [--mode=slides|book] [--out=file.json]
 * Prints a JSON report: classification, slides or scope text, summary, flashcards, quiz, test.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
if (!pos[0]) { console.error('usage: node tools/run-pdf.js <file.pdf> [start end] [--mode=] [--out=]'); process.exit(2); }

globalThis.window = globalThis;
globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
  .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/') || s === 'src/ui/study-pipeline.js');
for (const s of scripts) require(path.join(ROOT, s));
const P = globalThis.PDFStudy;

(async () => {
  const buf = fs.readFileSync(pos[0]);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const parsed = await P.pdfLoader.loadPdfDocument(data, () => {});
  const cls = P.classifier.classifyDocument(parsed);
  const mode = flags.mode === 'slides' ? 'slide_deck' : flags.mode === 'book' ? 'book' : cls.type;
  const state = {
    parsedPdf: parsed, classification: cls, activeMode: mode, quizCount: 10, quizSeed: 0,
    slideDeck: P.slideExtractor.extractSlideDeck(parsed),
    bookHierarchy: P.bookHierarchy.extractBookHierarchy(parsed),
    selectedScope: { title: 'Scope' }, generated: {},
  };
  const start = Number(pos[1]) || 1;
  const end = Number(pos[2]) || (mode === 'slide_deck' ? parsed.numPages : Math.min(parsed.numPages, start + 14));
  state.selectedScope = { id: 'cli', type: 'range', title: flags.title || `Pages ${start}-${end}`, startPage: start, endPage: end };
  await P.studyPipeline.buildMaterials(state, start, end, () => {});
  const report = {
    numPages: parsed.numPages, classification: cls, mode, scope: state.selectedScope,
    chapters: (state.bookHierarchy.chapters || []).map((c) => ({ title: c.title, pages: [c.startPage, c.endPage], isExtra: !!c.isExtra,
      sections: (c.sections || []).map((s) => `${s.title} ${s.startPage}-${s.endPage}`) })),
    slides: mode === 'slide_deck' ? state.slideDeck.slides.filter((s) => s.slideNumber >= start && s.slideNumber <= end) : undefined,
    scopeText: state.lastScopeObj ? state.lastScopeObj.text : undefined,
    didacticBlocks: state.lastScopeObj ? state.lastScopeObj.didacticBlocks : undefined,
    generated: state.generated,
  };
  const json = JSON.stringify(report, null, 1);
  if (flags.out) fs.writeFileSync(flags.out, json); else process.stdout.write(json + '\n');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

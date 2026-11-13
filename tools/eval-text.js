/**
 * Measures digital-PDF text extraction: runs a fixed list of page ranges through the real pipeline in Node
 * (page parsing -> scope text + exercise text, exactly as the app builds them) and prints defect counts
 * from tools/eval-text-counters.js, so a change can be judged before and after with one command.
 *
 * Usage: node tools/eval-text.js [--book=path.pdf] [--only=label] [--show=counter] [--dump=dir]
 *   --book   the Larson calculus PDF (default: $LARSON_PDF or ~/Downloads/Larson-...-txtbk.pdf); skipped if missing
 *   --only   run only ranges whose label contains this text
 *   --pages  measure these book pages instead of the fixed list, e.g. --pages=200-210,476-479
 *   --show   print the offending lines for one counter (header, figure, hyphen, order, subpart, math, glued, table)
 *   --dump   write each range's scope text, exercise text and raw lines to this folder
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { countDefects, tableDefects } = require('./eval-text-counters.js');

const ROOT = path.resolve(__dirname, '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const BOOK = flags.book || process.env.LARSON_PDF ||
  path.join(os.homedir(), 'Downloads', 'Larson-Calculus-of-a-Single-Variable-10th-Edition-c2014-txtbk.pdf');

// [label, first PDF page, last PDF page]: prose, worked examples, exercise sets, tables, openers, review, back matter
const BOOK_RANGES = [
  ['P.1 prose', 25, 27], ['1.1 prose', 65, 67], ['1.2 tables', 72, 74], ['1.3 prose', 82, 86],
  ['1.3 exercises', 90, 92], ['1.review', 114, 115], ['1.problems', 116, 117], ['2 opener', 118, 118],
  ['2.1 prose', 119, 121], ['2.4 exercises', 159, 161], ['4 opener', 266, 266], ['4.4 prose', 300, 302],
  ['4.5 exercises', 325, 327], ['5.6 prose', 389, 391], ['5 review', 416, 417], ['8 opener', 530, 530],
  ['8.6 tables', 574, 576], ['9.1 prose', 607, 609], ['9.10 exercises', 696, 698], ['10.1 prose', 705, 707],
  ['10 review', 765, 766], ['appendix', 771, 772], ['index', 854, 855],
];
const SAMPLES = ['sample_textbook_chapters.pdf', 'sample_class_slides.pdf', '_relations.pdf'];
const COLS = ['lines', 'header', 'figure', 'hyphen', 'order', 'subpart', 'math', 'glued', 'table'];

function loadPipeline() {
  globalThis.window = globalThis;
  globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"?]+)/g)].map((m) => m[1])
    .filter((s) => s.startsWith('src/pdf/') || s.startsWith('src/nlp/'));
  for (const s of scripts) require(path.join(ROOT, s));
  return globalThis.PDFStudy;
}

async function openPdf(P, file) {
  const buf = fs.readFileSync(file);
  return P.pdfLoader.loadPdfDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), () => {});
}

/** One range through the pipeline: scope + exercise text counters, plus merged table cells in the raw lines. */
async function measure(P, parsed, label, start, end) {
  const pages = await P.pdfLoader.ensurePagesLoaded(parsed, start, end);
  const scope = P.scopeBuilder.formatPagesToScope(pages, start, end, parsed);
  const a = countDefects(scope.text);
  const b = countDefects(scope.exerciseText);
  const raw = pages.flatMap((p) => p.lines.map((l) => l.formattedText || l.text));
  // Merged table cells are counted on the raw page lines: number-only rows never reach the scope text
  a.examples.table = tableDefects(raw);
  a.counts.table = a.examples.table.length;
  b.counts.table = 0;
  if (flags.dump) {
    fs.mkdirSync(flags.dump, { recursive: true });
    const rawDump = pages.map((p) => `=== page ${p.pageNumber} (${p.kind})\n` + p.lines.map((l) =>
      `${l.isMargin ? 'M' : ' '}c${l.column} x${Math.round(l.x0)}-${Math.round(l.x1)} y${Math.round(l.topY)} f${l.fontSize} | ${l.formattedText || l.text}`).join('\n')).join('\n');
    const name = label.replace(/[^\w.]+/g, '_');
    fs.writeFileSync(path.join(flags.dump, `${name}.txt`), `${scope.text}\n\n##### EXERCISES\n${scope.exerciseText}\n`);
    fs.writeFileSync(path.join(flags.dump, `${name}.raw.txt`), rawDump);
  }
  return { label: `${label} (${start}-${end})`, scope: a, exercises: b };
}

function printTable(title, rows, part) {
  const pad = (s, n) => String(s).padStart(n);
  console.log(`\n${title}\n${'range'.padEnd(30)}${COLS.map((c) => pad(c, 8)).join('')}`);
  const total = Object.fromEntries(COLS.map((c) => [c, 0]));
  for (const r of rows) {
    console.log(`${r.label.padEnd(30)}${COLS.map((c) => pad(r[part].counts[c], 8)).join('')}`);
    for (const c of COLS) total[c] += r[part].counts[c];
  }
  console.log(`${'TOTAL'.padEnd(30)}${COLS.map((c) => pad(total[c], 8)).join('')}`);
}

(async () => {
  console.warn = () => {}; // PDF.js image-decoder warnings
  const P = loadPipeline();
  const jobs = [];
  const custom = flags.pages && flags.pages.split(',').map((r) => r.split('-').map(Number)).map(([a, b]) => [`pages ${a}`, a, b || a]);
  if (fs.existsSync(BOOK)) jobs.push({ file: BOOK, ranges: custom || BOOK_RANGES });
  else console.log(`(book not found, skipped: ${BOOK})`);
  for (const s of custom ? [] : SAMPLES) {
    const file = path.join(ROOT, 'samples', s);
    if (fs.existsSync(file)) jobs.push({ file, ranges: null, name: s.replace(/\.pdf$/, '') });
    else console.log(`(sample not found, skipped: ${s})`);
  }
  const rows = [];
  for (const job of jobs) {
    const parsed = await openPdf(P, job.file);
    const ranges = job.ranges || [[job.name, 1, parsed.numPages]];
    for (const [label, s, e] of ranges) {
      if (flags.only && !label.includes(flags.only)) continue;
      rows.push(await measure(P, parsed, label, s, e));
    }
  }
  printTable('SCOPE TEXT (feeds summaries, cards and quizzes; table = merged cells in raw page lines)', rows, 'scope');
  printTable('EXERCISE TEXT (end-of-section exercise sets)', rows, 'exercises');
  if (flags.show) {
    for (const r of rows) {
      for (const part of ['scope', 'exercises']) {
        for (const ex of r[part].examples[flags.show] || []) console.log(`[${r.label} ${part}] ${String(ex).slice(0, 200)}`);
      }
    }
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

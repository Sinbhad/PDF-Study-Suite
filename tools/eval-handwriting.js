/**
 * Batch evaluation of the real handwriting recogniser on a folder of JPEG/PNG photos or scans (developer tool; offline).
 * Each image becomes a one-page PDF with no text layer and goes through the real app code in headless Edge/Chrome:
 * PDF.js render, the recognition Web Worker and the installed model. One JSON file per image is written to --out.
 * When the image folder holds TRANSCRIPTS.json ({ "<file>": { "lines": [...] } }) the run is scored: CER/WER per
 * page, per line and per category, for all pieces and for kept pieces only, plus a confidence calibration table,
 * written to <out>/summary.json and <out>/summary.md; the per-category table is printed at the end.
 *
 * Usage: node tools/eval-handwriting.js <image-folder> --out=<results-folder> [options]
 *   --only=substring    only images whose file name contains this
 *   --force             re-run images that already have a result JSON (and rebuild their crop previews)
 *   --score-only        do not start the browser: re-score the JSON files already in --out
 *   --crops=a,b,c       debug previews for images whose name contains any of these (default off):
 *                       <out>/crops/<file>/page-boxes.png, one PNG per region crop, sheet-NN.png contact sheets
 *   --timeout=1200      seconds allowed per image
 *   --browser=path      Edge/Chrome executable (default: $BROWSER, then the usual install locations)
 * The images and results are test data: keep them in a git-ignored folder (for example under vendor/hw/).
 */
const fs = require('fs');
const path = require('path');
const { imageToPdf, kindOf } = require('./eval-pdf.js');
const { findBrowser, openApp } = require('./eval-browser.js');
const { writeCrops } = require('./eval-crops.js');
const { writeReport, categoryTable } = require('./eval-report.js');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const dir = args.find((a) => !a.startsWith('--'));
if (!dir || !flags.out || flags.out === true || !fs.existsSync(dir)) {
  console.error('usage: node tools/eval-handwriting.js <image-folder> --out=<results-folder> [--only=s] [--force] [--score-only] [--crops=a,b]');
  process.exit(2);
}
const TIMEOUT = (Number(flags.timeout) || 1200) * 1000;
const cropKeys = typeof flags.crops === 'string' ? flags.crops.split(',').map((s) => s.trim()).filter(Boolean) : [];
const wantsCrops = (f) => cropKeys.some((k) => f.includes(k));

/** Runs in the page: recognise the one-page PDF with the app's own pipeline and return the raw page result. */
const pageScript = (b64) => `(async () => {
  const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
  const t0 = performance.now();
  const parsed = await PDFStudy.pdfLoader.loadPdfDocument(bytes.buffer, () => {});
  const page = parsed.pageCache.get(1);
  const ink = Object.assign({}, page.ink);
  const stats = await PDFStudy.hwPipeline.ensureRecognised(parsed, 1, 1, {});
  const res = (page.ink && page.ink.result) || null;
  return JSON.stringify({ seconds: Math.round((performance.now() - t0) / 100) / 10, ink, stats, result: res,
    lines: (page.lines || []).map((l) => ({ text: l.text, fontSize: l.fontSize, low: !!(l.ocr && l.ocr.low), confidence: l.ocr && l.ocr.confidence })) });
})()`;

function describe(rec) {
  if (rec.error) return rec.error;
  const lines = rec.result ? rec.result.lines.length : 0;
  const regs = rec.result ? rec.result.lines.reduce((n, l) => n + l.regions.length, 0) : 0;
  return `${rec.seconds}s, ${lines} lines, ${regs} pieces${rec.result && rec.result.skippedReason ? `, ${rec.result.skippedReason}` : ''}`;
}

async function runBrowser(files) {
  const exe = findBrowser(flags.browser);
  if (!exe) { console.error('No Edge/Chrome found; pass --browser=path'); process.exit(2); }
  const app = await openApp({ exe, timeoutMs: TIMEOUT });
  try {
    for (const f of files) {
      const outFile = path.join(flags.out, `${f}.json`);
      const done = fs.existsSync(outFile) && !flags.force;
      const crops = wantsCrops(f) && (flags.force || !fs.existsSync(path.join(flags.out, 'crops', f)));
      if (done && !crops) { console.log(`${f}: already done`); continue; }
      let rec; let pdf;
      try {
        const img = imageToPdf(fs.readFileSync(path.join(dir, f)), kindOf(f));
        pdf = img.pdf.toString('base64');
        if (done) rec = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        else rec = Object.assign({ file: f, imageWidth: img.w, imageHeight: img.h }, JSON.parse(await app.evalJs(pageScript(pdf))));
      } catch (err) {
        rec = { file: f, error: String((err && err.message) || err) };
      }
      if (!done) {
        fs.writeFileSync(outFile, JSON.stringify(rec, null, 1));
        console.log(`${f}: ${describe(rec)}`);
      }
      if (crops && pdf && !rec.error) {
        try {
          console.log(`${f}: ${await writeCrops(app.evalJs, flags.out, f, pdf, rec.result)}`);
        } catch (err) {
          console.log(`${f}: crop previews failed: ${String((err && err.message) || err)}`);
        }
      }
    }
  } finally {
    app.close();
  }
}

async function main() {
  fs.mkdirSync(flags.out, { recursive: true });
  const files = fs.readdirSync(dir).filter((f) => kindOf(f) && (!flags.only || f.includes(flags.only))).sort();
  if (!flags['score-only']) await runBrowser(files);
  const summary = writeReport(flags.out, dir);
  if (!summary) { console.log('No TRANSCRIPTS.json in the image folder: results not scored.'); return; }
  console.log(`\n${categoryTable(summary)}\n\nWritten: ${path.join(flags.out, 'summary.md')} and summary.json`);
}

main().then(() => process.exit(0), (err) => { console.error(String((err && err.stack) || err)); process.exit(1); });

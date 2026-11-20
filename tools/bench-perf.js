/**
 * Dedicated performance & parse-latency benchmark for PDF Study Suite.
 * Wall-clock performance budgets belong here, never inside deterministic unit suites (tests/*_fixtures.js).
 *
 * Usage:
 *   node tools/bench-perf.js [--local] [--out=bench.json]
 *
 * Measures:
 *   1. Handwriting prepareCrop throughput (200 crops of 1400x90 -> 384x384).
 *   2. Cold & warm-page PDF.js + pdfLoader parsing latency on public sample PDFs.
 *   3. With --local (when local corpus files exist): cold parse latency on real decks (deck-anticestode, deck-neuro-2).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
  })
);

function loadPdfPipeline() {
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

function benchPrepareCrop() {
  const util = require(path.join(ROOT, 'src/hw/engine-util.js'));
  const w = 1400;
  const h = 90;
  const words = { data: new Uint8Array(w * h).fill(255), w, h };
  for (let y = 25; y < 65; y++) {
    for (let x = 60; x < 1340; x++) {
      if ((x * 7 + y * 3) % 23 < 4) words.data[y * w + x] = 20;
    }
  }
  // Warmup
  for (let i = 0; i < 10; i++) util.prepareCrop(words);
  const runs = 200;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < runs; i++) util.prepareCrop(words);
  const totalMs = Number(process.hrtime.bigint() - t0) / 1e6;
  return {
    name: 'prepareCrop_200x_1400x90',
    runs,
    totalMs: Math.round(totalMs * 10) / 10,
    perCropMs: Math.round((totalMs / runs) * 100) / 100,
    targetBudgetMs: 4000,
  };
}

async function benchPdfParse(P, label, filePath, pages) {
  const buf = fs.readFileSync(filePath);
  const data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const t0 = process.hrtime.bigint();
  const parsed = await P.pdfLoader.loadPdfDocument(data, () => {});
  const loadMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const [start, end] = pages || [1, parsed.numPages];
  const t1 = process.hrtime.bigint();
  await P.pdfLoader.ensurePagesLoaded(parsed, start, end, () => {});
  const rangeMs = Number(process.hrtime.bigint() - t1) / 1e6;
  return {
    name: `pdf_parse_${label}`,
    numPages: parsed.numPages,
    range: [start, end],
    loadMs: Math.round(loadMs * 10) / 10,
    rangeMs: Math.round(rangeMs * 10) / 10,
    totalMs: Math.round((loadMs + rangeMs) * 10) / 10,
  };
}

(async () => {
  const log = console.log;
  console.log = (...a) => {
    if (!/^Warning: /.test(String(a[0]))) log(...a);
  };
  console.warn = () => {};

  const results = [];
  results.push(benchPrepareCrop());

  const P = loadPdfPipeline();
  const samples = [
    ['sample_textbook', path.join(ROOT, 'samples/sample_textbook_chapters.pdf'), [1, 3]],
    ['sample_slides', path.join(ROOT, 'samples/sample_class_slides.pdf'), [1, 4]],
  ];
  for (const [label, filePath, pages] of samples) {
    if (fs.existsSync(filePath)) results.push(await benchPdfParse(P, label, filePath, pages));
  }

  if (flags.local) {
    const localManifestPath = path.join(ROOT, 'tests/corpus/local/manifest.json');
    if (fs.existsSync(localManifestPath)) {
      const localManifest = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
      const wanted = new Set(['deck-anticestode', 'deck-neuro-2']);
      for (const entry of localManifest.entries || []) {
        if (!wanted.has(entry.id) || !fs.existsSync(entry.path)) continue;
        results.push(await benchPdfParse(P, entry.id, entry.path, entry.pages));
      }
    }
  }

  log('Benchmark results (informational; never fails unit suites):');
  for (const r of results) {
    if (r.perCropMs !== undefined) {
      log(`  ${r.name.padEnd(28)} total=${r.totalMs}ms  perCrop=${r.perCropMs}ms  (budget hint <${r.targetBudgetMs}ms)`);
    } else {
      log(`  ${r.name.padEnd(28)} pages=${r.numPages}  load=${r.loadMs}ms  range=${r.rangeMs}ms  total=${r.totalMs}ms`);
    }
  }
  if (typeof flags.out === 'string') {
    fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  }
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

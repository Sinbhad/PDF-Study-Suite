/**
 * End-to-end run of one PDF with no text layer in the real app (developer tool; offline; Node 22+ and Edge/Chrome).
 * Starts `python app.py`, which serves the PDF itself (so a file of any size works), opens the app in a headless
 * browser, lets it load, recognise and build the study material exactly as a user would get it, and reports
 * times, how the page was read (tiles, clusters, blocks, lines, characters, confidence) and what was generated.
 *
 * Usage: node tools/eval-canvas.js <file.pdf> [--out=report.json] [--timeout=1200] [--browser=path]
 * Exit code 0 = text was read and no request left this computer; 1 = otherwise; 2 = usage/setup problem.
 */
const fs = require('fs');
const path = require('path');
const { findBrowser, openApp } = require('./eval-browser.js');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pdfPath = args.find((a) => !a.startsWith('--'));
if (!pdfPath || !fs.existsSync(pdfPath)) { console.error('usage: node tools/eval-canvas.js <file.pdf> [--out=report.json] [--timeout=1200]'); process.exit(2); }
const TIMEOUT = (Number(flags.timeout) || 1200) * 1000;

/** Runs in the page. */
const pageScript = (name) => `(async () => {
  const ms = () => performance.now();
  const sec = (v) => Math.round(v / 100) / 10;
  const t = { fetch: 0, load: 0, build: 0, tileRender: 0, tileRead: 0, tiles: 0 };
  let t0 = ms();
  const buf = await (await fetch('/local-larson.pdf')).arrayBuffer();
  t.fetch = ms() - t0; t0 = ms();
  const parsed = await PDFStudy.pdfLoader.loadPdfDocument(buf, () => {});
  t.load = ms() - t0;
  const reader = PDFStudy.hwCanvasRead;
  const draw = reader.renderTile;
  reader.renderTile = async (...a) => { const s = ms(); try { return await draw(...a); } finally { t.tileRender += ms() - s; t.tiles++; } };
  const create = PDFStudy.hwClient.create; // the app makes a fresh client per document: time its tile reads
  PDFStudy.hwClient.create = (o) => {
    const client = create(o);
    const read = client.readTile;
    client.readTile = async (p) => { const s = ms(); try { return await read(p); } finally { t.tileRead += ms() - s; } };
    return client;
  };
  t0 = ms();
  await PDFStudy.main.processLoadedDocument(${JSON.stringify(name)}, parsed);
  t.build = ms() - t0;
  const st = PDFStudy.main.appState;
  const clip = (v, n) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '...' : s; };
  const pages = Array.from(parsed.pageCache.values()).map((p) => {
    const res = (p.ink && p.ink.result) || { lines: [] };
    const regions = res.lines.flatMap((l) => l.regions.map((r) => Object.assign({ cluster: l.cluster, group: l.group }, r)));
    const read = regions.filter((r) => r.text);
    const conf = read.map((r) => r.confidence).sort((a, b) => a - b);
    const q = (f) => (conf.length ? Math.round(conf[Math.min(conf.length - 1, Math.floor(f * conf.length))] * 100) / 100 : null);
    const hist = [0, 0, 0, 0, 0];
    conf.forEach((c) => { hist[Math.min(4, Math.floor(c * 5))]++; });
    const kept = read.filter((r) => r.confidence >= 0.6);
    const samples = {};
    for (const r of read) {
      const k = 'cluster ' + (r.cluster == null ? 0 : r.cluster);
      if (!samples[k]) samples[k] = [];
      if (samples[k].length < 5) samples[k].push(r.confidence.toFixed(2) + ' ' + r.text);
    }
    return {
      page: p.pageNumber, widthPt: p.width, heightPt: p.height, ink: { reason: p.ink && p.ink.reason, pathOps: p.ink && p.ink.pathOps, imageOps: p.ink && p.ink.imageOps },
      layout: res.layout || 'lines', skippedReason: res.skippedReason || null, engine: res.engine || null, tiles: res.tiles || 0, clusters: res.clusters || 0, groups: res.groups || 0,
      pieces: regions.length, linesRead: read.length, characters: read.reduce((n, r) => n + r.text.length, 0),
      keptLines: kept.length, keptCharacters: kept.reduce((n, r) => n + r.text.length, 0),
      confidence: { p05: q(0.05), p25: q(0.25), median: q(0.5), p75: q(0.75), p95: q(0.95), histogram: { '0.0-0.2': hist[0], '0.2-0.4': hist[1], '0.4-0.6': hist[2], '0.6-0.8': hist[3], '0.8-1.0': hist[4] } },
      studyLines: (p.lines || []).length, samples, lines: read.map((r) => ({ text: r.text, confidence: Math.round(r.confidence * 1000) / 1000, cluster: r.cluster, group: r.group, stats: r.stats })),
    };
  });
  const g = st.generated || {};
  const sentences = (g.summary && (g.summary.sentences || g.summary.overviewSentences)) || [];
  const test = g.test || null;
  return JSON.stringify({
    file: ${JSON.stringify(name)}, userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency,
    seconds: { fetch: sec(t.fetch), loadPdf: sec(t.load), recogniseAndBuild: sec(t.build), tileRender: sec(t.tileRender), tileRead: sec(t.tileRead), total: sec(t.fetch + t.load + t.build) },
    tilesRendered: t.tiles, mode: st.activeMode, handwriting: st.handwriting, pages,
    generated: {
      summarySentences: sentences.length, summarySample: sentences.slice(0, 6).map((s) => clip(s.text || s, 220)),
      summarySections: ((g.summary && (g.summary.sections || g.summary.topics)) || []).length,
      flashcards: (g.flashcards || []).length, flashcardSample: (g.flashcards || []).slice(0, 10).map((c) => clip(c, 260)),
      quiz: (g.quiz || []).length, quizSample: (g.quiz || []).slice(0, 4).map((c) => clip(c, 420)),
      test: PDFStudy.studyPipeline.testQuestionCount(test), testSections: test && test.sections ? test.sections.map((s) => (s.name || s.title) + ': ' + ((s.questions || []).length)) : [],
    },
    offOriginRequests: performance.getEntriesByType('resource').map((e) => e.name).filter((u) => /^https?:/.test(u) && !u.startsWith(location.origin)),
    notice: (document.getElementById('hwNotice') || {}).textContent || '',
  });
})()`;

async function main() {
  const exe = findBrowser(flags.browser);
  if (!exe) { console.error('No Edge/Chrome found; pass --browser=path'); process.exit(2); }
  const app = await openApp({ exe, timeoutMs: TIMEOUT, env: { LARSON_PDF: path.resolve(pdfPath) } });
  let report;
  try {
    report = JSON.parse(await app.evalJs(pageScript(path.basename(pdfPath))));
  } finally {
    app.close();
  }
  if (flags.out) fs.writeFileSync(flags.out, JSON.stringify(report, null, 1));
  const brief = JSON.parse(JSON.stringify(report));
  brief.pages.forEach((p) => { delete p.lines; }); // every line is in the --out file only
  console.log(JSON.stringify(brief, null, 1));
  const read = report.pages.reduce((n, p) => n + p.linesRead, 0);
  const ok = { textRead: read > 0, nothingLeftThisComputer: report.offOriginRequests.length === 0 };
  console.log(`checks: ${JSON.stringify(ok)}`);
  return Object.values(ok).every(Boolean) ? 0 : 1;
}

main().then((code) => process.exit(code), (err) => { console.error(String((err && err.stack) || err)); process.exit(1); });

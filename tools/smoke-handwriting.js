/**
 * Real-browser smoke test for handwriting recognition (developer tool; offline; needs Node 22+ and Edge/Chrome).
 * Starts `python app.py` and headless Edge/Chrome via tools/eval-browser.js, loads a PDF with
 * no text layer, lets the real model read it in the real Web Worker, and prints what came out.
 *
 * Usage: node tools/smoke-handwriting.js <fixture.pdf> [--shots=dir] [--browser=path] [--timeout=600] [--no-isolation]
 * Exit code 0 = ok; 1 = failed assertion; 2 = setup/browser unavailable.
 */
const fs = require('fs');
const path = require('path');
const { findBrowser, openApp } = require('./eval-browser.js');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const pdfPath = args.find((a) => !a.startsWith('--'));
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error('usage: node tools/smoke-handwriting.js <fixture.pdf> [--shots=dir]');
  process.exit(2);
}
const TIMEOUT = (Number(flags.timeout) || 600) * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pageScript(b64) {
  return `(async () => {
    const availability = await PDFStudy.hwAvailability.ready;
    const switchedOn = PDFStudy.ENABLE_HANDWRITING === true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    const parsed = await PDFStudy.pdfLoader.loadPdfDocument(bytes.buffer, () => {});
    const ink = Array.from(parsed.pageCache.values()).map((p) => Object.assign({ page: p.pageNumber, words: p.wordCount }, p.ink));
    await PDFStudy.main.processLoadedDocument('handwriting-fixture.pdf', parsed);
    if (PDFStudy.backgroundRead) await PDFStudy.backgroundRead.whenIdle();
    const st = PDFStudy.main.appState;
    const firstRun = performance.now() - t0;
    const inkPages = Array.from(parsed.pageCache.values()).filter((p) => p.ink && p.ink.recognised);
    inkPages.forEach((p) => { p.ink.recognised = false; });
    const t1 = performance.now();
    const again = await PDFStudy.hwPipeline.ensureRecognised(parsed, 1, parsed.numPages, {});
    const warm = performance.now() - t1;
    const allLines = (p) => (p.ink && p.ink.result ? PDFStudy.ocrLines.toPageLines(p.ink.result, p, { includeLow: true }) : p.lines || []);
    const pages = Array.from(parsed.pageCache.values()).map((p) => ({
      page: p.pageNumber, kind: p.kind, wordCount: p.wordCount, studyLines: (p.lines || []).length,
      lines: allLines(p).map((l) => ({ text: l.text, fontSize: l.fontSize, low: !!(l.ocr && l.ocr.low) })),
      regions: ((p.ink && p.ink.result && p.ink.result.lines) || []).flatMap((l) => l.regions.map((r) =>
        ({ id: r.id, kind: r.kind, source: r.source, confidence: Math.round(r.confidence * 1000) / 1000, text: r.text, stats: r.stats }))),
      skippedReason: p.ink && p.ink.result && p.ink.result.skippedReason,
    }));
    const g = st.generated || {};
    return JSON.stringify({
      firstRunSeconds: Math.round(firstRun / 100) / 10, warmSecondsPerPiece: again.regions ? Math.round(warm / again.regions / 10) / 100 : null,
      userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, crossOriginIsolated: self.crossOriginIsolated,
      availability: { available: availability.available, reason: availability.reason, switchedOn },
      inkBefore: ink, mode: st.activeMode, handwriting: st.handwriting, pages,
      generated: { summarySentences: (g.summary && g.summary.sentences) || [], flashcards: (g.flashcards || []).length,
        quiz: (g.quiz || []).length, firstCard: (g.flashcards || [])[0] || null },
      notice: (document.getElementById('hwNotice') || {}).textContent || '',
    });
  })()`;
}

async function shot(send, dir, name) {
  if (!dir) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, name), Buffer.from(r.data, 'base64'));
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

async function main() {
  const exe = findBrowser(flags.browser);
  if (!exe) {
    console.error('No Edge/Chrome found; pass --browser=path');
    process.exit(2);
  }
  const shots = flags.shots ? path.resolve(flags.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });

  const env = {};
  if ('no-isolation' in flags) env.NO_ISOLATION = '1';

  let app;
  try {
    app = await openApp({ exe, timeoutMs: TIMEOUT, env, windowSize: '1280,900', captureEvents: true });
  } catch (err) {
    console.error(`the app or the browser did not start (${(err && err.message) || err})`);
    process.exit(2);
  }

  try {
    await app.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
    const report = JSON.parse(await app.evalJs(pageScript(fs.readFileSync(pdfPath).toString('base64'))));
    await sleep(300);
    await shot(app.send, shots, 'handwriting-summary-light.png');
    if (await app.evalJs('(() => { const b = document.getElementById("hwReviewBtn"); if (b) b.click(); return !!b; })()')) {
      await sleep(2500);
      await shot(app.send, shots, 'handwriting-review-light.png');
      report.reviewCrops = JSON.parse(await app.evalJs('JSON.stringify(Array.from(document.querySelectorAll(".hw-crop canvas")).map((c) => ({ px: c.width + "x" + c.height, shown: Math.round(c.getBoundingClientRect().width), card: c.parentElement.clientWidth, ready: c.hasAttribute("data-ready"), hidden: !c.offsetParent })))'));
      await app.evalJs('document.documentElement.setAttribute("data-theme", "dark")');
      await sleep(300);
      await shot(app.send, shots, 'handwriting-review-dark.png');
      await app.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(1500);
      await shot(app.send, shots, 'handwriting-review-phone-dark.png');
      await app.send('Emulation.clearDeviceMetricsOverride');
    }

    await app.evalJs('document.documentElement.setAttribute("data-theme", "light"); document.getElementById("demoBookBtn").click()');
    await sleep(2500);
    await shot(app.send, shots, 'math-light.png');
    const fonts = await app.evalJs('document.fonts.ready.then(() => JSON.stringify(Array.from(document.fonts).map((f) => f.family + " " + f.style + " " + f.weight + ": " + f.status)))');
    await app.evalJs('document.documentElement.setAttribute("data-theme", "dark")');
    await sleep(300);
    await shot(app.send, shots, 'math-dark.png');
    await app.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(800);
    await shot(app.send, shots, 'math-phone-dark.png');
    await app.evalJs('document.documentElement.setAttribute("data-theme", "light")');
    await sleep(300);
    await shot(app.send, shots, 'math-phone-light.png');

    const origin = new URL(app.appUrl).origin;
    const requests = app.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url);
    report.fonts = JSON.parse(fonts);
    report.offOriginRequests = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(origin));
    report.pageRequests = requests.length;
    report.consoleProblems = app.events
      .filter((e) => (e.method === 'Runtime.exceptionThrown')
        || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
        || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
      .map((e) => (e.params.entry ? `${e.params.entry.text} ${e.params.entry.url || ''}` : e.params.exceptionDetails
        ? (e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text
        : (e.params.args || []).map((a) => a.value || a.description).join(' ')));
    console.log(JSON.stringify(report, null, 1));

    const read = report.pages.flatMap((p) => p.regions).filter((r) => r.source === 'model' && r.text);
    const engine = (report.handwriting && report.handwriting.engine) || {};
    console.log(`reader: ${engine.name || 'none'}, threads ${engine.threads || 1}, crossOriginIsolated ${report.crossOriginIsolated}, warm seconds per piece ${report.warmSecondsPerPiece}`);
    const ok = {
      switchedOn: report.availability.switchedOn,
      modelLoaded: !!engine.available,
      textRead: read.length > 0,
      nothingLeftThisComputer: report.offOriginRequests.length === 0,
      noPageErrors: report.consoleProblems.length === 0,
    };
    const expFile = `${pdfPath}.expected.json`;
    if (fs.existsSync(expFile)) {
      const want = JSON.parse(fs.readFileSync(expFile, 'utf8')).lines;
      const got = report.pages.flatMap((p) => p.lines.map((l) => l.text));
      const cer = editDistance(want.join('\n'), got.join('\n')) / Math.max(1, want.join('\n').length);
      const exact = want.filter((w, i) => got[i] === w).length;
      ok.accuracy = cer <= 0.15;
      console.log(`expected vs read: ${exact} of ${want.length} lines exact, character error rate ${(cer * 100).toFixed(1)}%`);
      want.forEach((w, i) => {
        if (got[i] !== w) console.log(`  line ${i + 1}: expected ${JSON.stringify(w)}\n           read     ${JSON.stringify(got[i])}`);
      });
    }
    console.log(`checks: ${JSON.stringify(ok)}`);
    return Object.values(ok).every(Boolean) ? 0 : 1;
  } finally {
    app.close();
  }
}

main().then((code) => process.exit(code), (err) => {
  console.error(String((err && err.stack) || err));
  process.exit(1);
});

/**
 * Real-browser smoke test for handwriting recognition (developer tool; offline; needs Node 22+ and Edge/Chrome).
 * Starts `python app.py`, opens the real app in a headless browser over the DevTools protocol, loads a PDF with
 * no text layer, lets the real model read it in the real Web Worker, and prints what came out.
 *
 * Usage: node tools/smoke-handwriting.js <fixture.pdf> [--shots=dir] [--browser=path] [--timeout=600]
 * Make a fixture first: python tools/make-handwriting-fixture.py fixture.pdf
 * If <fixture.pdf>.expected.json is beside it (the fixture maker writes it) the text is compared with it.
 * Exit code 0 = model loaded, text read (character error rate <= 15% when expected text is known), no request
 * left this computer and no page errors; 1 = any of those failed; 2 = usage/setup problem.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const pdfPath = args.find((a) => !a.startsWith('--'));
if (!pdfPath || !fs.existsSync(pdfPath)) { console.error('usage: node tools/smoke-handwriting.js <fixture.pdf> [--shots=dir]'); process.exit(2); }
const TIMEOUT = (Number(flags.timeout) || 600) * 1000;
const BROWSERS = [flags.browser, process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const kids = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitLine = (stream, re, ms) => new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${re}`)), ms);
  stream.on('data', (d) => { buf += d; const m = re.exec(buf); if (m) { clearTimeout(t); resolve(m); } });
});
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve(JSON.parse(s))); }).on('error', reject);
});

/** Minimal DevTools-protocol client over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools socket failed')); });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  return { send, events, close: () => ws.close() };
}

/** Runs inside the page: load the PDF bytes the way the app does, then report what recognition produced. */
function pageScript(b64) {
  return `(async () => {
    PDFStudy.ENABLE_HANDWRITING = true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    const t0 = performance.now();
    const parsed = await PDFStudy.pdfLoader.loadPdfDocument(bytes.buffer, () => {});
    const ink = Array.from(parsed.pageCache.values()).map((p) => Object.assign({ page: p.pageNumber, words: p.wordCount }, p.ink));
    await PDFStudy.main.processLoadedDocument('handwriting-fixture.pdf', parsed);
    const st = PDFStudy.main.appState;
    const firstRun = performance.now() - t0;
    // Second pass with the model already loaded: time per piece without the one-off model load
    const inkPages = Array.from(parsed.pageCache.values()).filter((p) => p.ink && p.ink.recognised);
    inkPages.forEach((p) => { p.ink.recognised = false; });
    const t1 = performance.now();
    const again = await PDFStudy.hwPipeline.ensureRecognised(parsed, 1, parsed.numPages, {});
    const warm = performance.now() - t1;
    // Every line read, including low-confidence ones that are held back from the study text until checked
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
      inkBefore: ink, mode: st.activeMode, handwriting: st.handwriting, pages,
      generated: { summarySentences: (g.summary && g.summary.sentences) || [], flashcards: (g.flashcards || []).length,
        quiz: (g.quiz || []).length, firstCard: (g.flashcards || [])[0] || null },
      notice: (document.getElementById('hwNotice') || {}).textContent || '',
    });
  })()`;
}

async function shot(cdp, dir, name) {
  if (!dir) return;
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(dir, name), Buffer.from(r.data, 'base64'));
}
const evalJs = async (cdp, expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: TIMEOUT });
  if (r.exceptionDetails) throw new Error(`page error: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
  return r.result.value;
};

async function main() {
  const exe = BROWSERS.find((p) => p && fs.existsSync(p));
  if (!exe) { console.error('No Edge/Chrome found; pass --browser=path'); process.exit(2); }
  const shots = flags.shots ? path.resolve(flags.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });

  const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-u', 'app.py'], { cwd: ROOT, env: { ...process.env, NO_BROWSER: '1' } });
  kids.push(server);
  const appUrl = (await waitLine(server.stdout, /Running locally at: (http:\/\/\S+)/, 15000))[1];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-study-smoke-'));
  const browser = spawn(exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--disable-extensions', '--window-size=1280,900', 'about:blank']);
  kids.push(browser);
  const port = (await waitLine(browser.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 20000))[1];
  await sleep(500);
  const target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page');
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable'); await cdp.send('Log.enable');
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
  await cdp.send('Page.navigate', { url: appUrl });
  for (let i = 0; i < 100 && !(await evalJs(cdp, 'document.readyState === "complete" && !!(window.PDFStudy && PDFStudy.main)')); i++) await sleep(200);

  const report = JSON.parse(await evalJs(cdp, pageScript(fs.readFileSync(pdfPath).toString('base64'))));
  await sleep(300);
  await shot(cdp, shots, 'handwriting-summary-light.png');
  if (await evalJs(cdp, '(() => { const b = document.getElementById("hwReviewBtn"); if (b) b.click(); return !!b; })()')) {
    await sleep(2500); // crops render lazily
    await shot(cdp, shots, 'handwriting-review-light.png');
    report.reviewCrops = JSON.parse(await evalJs(cdp, 'JSON.stringify(Array.from(document.querySelectorAll(".hw-crop canvas")).map((c) => ({ px: c.width + "x" + c.height, shown: Math.round(c.getBoundingClientRect().width), card: c.parentElement.clientWidth, ready: c.hasAttribute("data-ready"), hidden: !c.offsetParent })))'));
    await evalJs(cdp, 'document.documentElement.setAttribute("data-theme", "dark")');
    await sleep(300); await shot(cdp, shots, 'handwriting-review-dark.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(1500); await shot(cdp, shots, 'handwriting-review-phone-dark.png');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
  }
  // Math typography check on the built-in calculus sample (no handwriting involved)
  await evalJs(cdp, 'document.documentElement.setAttribute("data-theme", "light"); document.getElementById("demoBookBtn").click()');
  await sleep(2500); await shot(cdp, shots, 'math-light.png');
  const fonts = await evalJs(cdp, 'document.fonts.ready.then(() => JSON.stringify(Array.from(document.fonts).map((f) => f.family + " " + f.style + " " + f.weight + ": " + f.status)))');
  await evalJs(cdp, 'document.documentElement.setAttribute("data-theme", "dark")');
  await sleep(300); await shot(cdp, shots, 'math-dark.png');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await sleep(800); await shot(cdp, shots, 'math-phone-dark.png');
  await evalJs(cdp, 'document.documentElement.setAttribute("data-theme", "light")');
  await sleep(300); await shot(cdp, shots, 'math-phone-light.png');

  const origin = new URL(appUrl).origin;
  const requests = cdp.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url);
  report.fonts = JSON.parse(fonts);
  report.offOriginRequests = requests.filter((u) => /^https?:/.test(u) && !u.startsWith(origin));
  report.pageRequests = requests.length;
  report.consoleProblems = cdp.events.filter((e) => (e.method === 'Runtime.exceptionThrown')
    || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map((e) => (e.params.entry ? `${e.params.entry.text} ${e.params.entry.url || ''}` : e.params.exceptionDetails
      ? (e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text
      : (e.params.args || []).map((a) => a.value || a.description).join(' ')));
  console.log(JSON.stringify(report, null, 1));
  cdp.close();
  const read = report.pages.flatMap((p) => p.regions).filter((r) => r.source === 'model' && r.text);
  const ok = { modelLoaded: !!(report.handwriting && report.handwriting.engine && report.handwriting.engine.available),
    textRead: read.length > 0, nothingLeftThisComputer: report.offOriginRequests.length === 0, noPageErrors: report.consoleProblems.length === 0 };
  const expFile = `${pdfPath}.expected.json`;
  if (fs.existsSync(expFile)) {
    const want = JSON.parse(fs.readFileSync(expFile, 'utf8')).lines;
    const got = report.pages.flatMap((p) => p.lines.map((l) => l.text));
    const cer = editDistance(want.join('\n'), got.join('\n')) / Math.max(1, want.join('\n').length);
    const exact = want.filter((w, i) => got[i] === w).length;
    ok.accuracy = cer <= 0.15;
    console.log(`expected vs read: ${exact} of ${want.length} lines exact, character error rate ${(cer * 100).toFixed(1)}%`);
    want.forEach((w, i) => { if (got[i] !== w) console.log(`  line ${i + 1}: expected ${JSON.stringify(w)}
           read     ${JSON.stringify(got[i])}`); });
  }
  console.log(`checks: ${JSON.stringify(ok)}`);
  return Object.values(ok).every(Boolean) ? 0 : 1;
}

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const stop = () => kids.forEach((k) => { try { k.kill(); } catch (_e) { /* already gone */ } });
main().then((code) => { stop(); process.exit(code); }, (err) => { console.error(String((err && err.stack) || err)); stop(); process.exit(1); });

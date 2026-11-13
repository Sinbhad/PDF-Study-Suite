/**
 * Starts `python app.py` and a headless Edge/Chrome on the app, and returns a small DevTools client
 * (evaluate an expression in the page) for the evaluation tools. Offline: everything stays on 127.0.0.1.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BROWSERS = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitLine = (stream, re, ms) => new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${re}`)), ms);
  stream.on('data', (d) => { buf += d; const m = re.exec(buf); if (m) { clearTimeout(t); resolve(m); } });
});
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => { let s = ''; res.on('data', (d) => (s += d)); res.on('end', () => resolve(JSON.parse(s))); }).on('error', reject);
});

/** First browser that exists: the explicit path, $BROWSER, then the usual install locations. */
function findBrowser(explicit) {
  return [explicit, process.env.BROWSER, ...BROWSERS].find((p) => p && fs.existsSync(p)) || null;
}

/**
 * @param {{exe:string, timeoutMs:number, env?:object}} opts env: extra environment for app.py (LARSON_PDF=<file> serves it at /local-larson.pdf)
 * @returns {Promise<{evalJs:function(string):Promise<any>, close:function}>}
 */
async function openApp(opts) {
  const kids = [];
  const close = () => kids.forEach((k) => { try { k.kill(); } catch (_e) { /* already gone */ } });
  try {
    const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-u', 'app.py'], { cwd: ROOT, env: { ...process.env, NO_BROWSER: '1', ...(opts.env || {}) } });
    kids.push(server);
    const appUrl = (await waitLine(server.stdout, /Running locally at: (http:\/\/\S+)/, 15000))[1];
    const browser = spawn(opts.exe, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-study-eval-'))}`,
      '--no-first-run', '--disable-extensions', 'about:blank']);
    kids.push(browser);
    const port = (await waitLine(browser.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 20000))[1];
    await sleep(500);
    const ws = new WebSocket((await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('DevTools socket failed')); });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    const send = (method, params = {}) => new Promise((res, rej) => { pending.set(++id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: opts.timeoutMs });
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Page.navigate', { url: appUrl });
    for (let i = 0; i < 100 && !(await evalJs('document.readyState === "complete" && !!(window.PDFStudy && PDFStudy.hwPipeline)').catch(() => false)); i++) await sleep(200);
    return { evalJs, close: () => { try { ws.close(); } catch (_e) { /* closed */ } close(); } };
  } catch (err) {
    close();
    throw err;
  }
}

module.exports = { ROOT, findBrowser, openApp };

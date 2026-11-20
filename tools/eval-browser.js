/**
 * Starts `python app.py` and a headless Edge/Chrome on the app, and returns a small DevTools client
 * (evaluate an expression in the page, attach preload scripts, inspect CDP events) for the evaluation tools.
 * Offline: everything stays on 127.0.0.1.
 *
 * Sanitizes MSYS/Git-Bash environment variables on Windows so headless Edge spawns reliably from Git Bash,
 * PowerShell, or cmd, and drains app.py stderr so request logs never block pipes under heavy traffic.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const waitLine = (stream, re, ms) => new Promise((resolve, reject) => {
  let buf = '';
  const t = setTimeout(() => reject(new Error(`timed out waiting for ${re}; got: ${buf.slice(-400)}`)), ms);
  stream.on('data', (d) => {
    buf += d;
    const m = re.exec(buf);
    if (m) {
      clearTimeout(t);
      resolve(m);
    }
  });
});

const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let s = '';
    res.on('data', (d) => (s += d));
    res.on('end', () => {
      try {
        resolve(JSON.parse(s));
      } catch (e) {
        reject(e);
      }
    });
  }).on('error', reject);
});

/** First browser that exists: the explicit path, $BROWSER, then the usual install locations. */
function findBrowser(explicit) {
  return [explicit, process.env.BROWSER, ...BROWSERS].find((p) => p && fs.existsSync(p)) || null;
}

/** Strips MSYS / Git-Bash env vars on Windows that cause Chromium/Edge headless launch failures (exit 2). */
function sanitizedBrowserEnv() {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    for (const k of [
      'MSYSTEM', 'MSYSTEM_CARCH', 'MSYSTEM_CHOST', 'MSYSTEM_PREFIX',
      'MINGW_PREFIX', 'MINGW_CHOST', 'MINGW_PACKAGE_PREFIX',
      'SHELL', 'SHLVL', 'TERM', 'CHERE_INVOKING',
    ]) {
      delete env[k];
    }
    const winTmp = path.win32.resolve(os.tmpdir());
    env.TEMP = winTmp;
    env.TMP = winTmp;
  }
  return env;
}

/**
 * @param {{
 *   exe: string,
 *   timeoutMs: number,
 *   env?: object,
 *   windowSize?: string,
 *   preloadScript?: string,
 *   captureEvents?: boolean
 * }} opts
 */
async function openApp(opts) {
  const kids = [];
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-study-eval-'));
  const cleanupKids = () => {
    kids.forEach((k) => {
      try { k.kill(); } catch (_e) { /* already gone */ }
    });
    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (_e) { /* Windows may hold lock briefly */ }
  };

  try {
    const server = spawn(process.platform === 'win32' ? 'python' : 'python3', ['-u', 'app.py'], {
      cwd: ROOT,
      env: { ...process.env, NO_BROWSER: '1', ...(opts.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    kids.push(server);
    server.stderr.resume(); // drain HTTP access log so pipe buffer never blocks server

    const appUrl = (await waitLine(server.stdout, /Running locally at: (http:\/\/\S+)/, 15000))[1];
    const browserExe = process.platform === 'win32' ? path.win32.normalize(opts.exe) : opts.exe;
    const winSize = opts.windowSize || '1280,900';
    const browserArgs = [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${process.platform === 'win32' ? path.win32.resolve(profileDir) : profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-gpu',
      `--window-size=${winSize}`,
      'about:blank',
    ];
    const browser = spawn(browserExe, browserArgs, {
      env: sanitizedBrowserEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    kids.push(browser);
    browser.stdout.resume();

    const port = (await waitLine(browser.stderr, /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//, 20000))[1];
    await sleep(400);
    const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];
    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      throw new Error('No DevTools page target available');
    }

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = () => rej(new Error('DevTools socket failed'));
    });

    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.rej(new Error(m.error.message));
        else p.res(m.result);
      } else if (m.method && opts.captureEvents !== false) {
        events.push(m);
      }
    };

    const send = (method, params = {}) => new Promise((res, rej) => {
      pending.set(++id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const evalJs = async (expression) => {
      const r = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: opts.timeoutMs || 60000,
      });
      if (r.exceptionDetails) {
        throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
      }
      return r.result.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    await send('Log.enable');
    if (opts.preloadScript) {
      await send('Page.addScriptToEvaluateOnNewDocument', { source: opts.preloadScript });
    }
    await send('Page.navigate', { url: appUrl });
    for (
      let i = 0;
      i < 100 && !(await evalJs('document.readyState === "complete" && !!(window.PDFStudy && PDFStudy.main)').catch(() => false));
      i++
    ) {
      await sleep(200);
    }

    return {
      appUrl,
      events,
      send,
      evalJs,
      close: () => {
        try { ws.close(); } catch (_e) { /* closed */ }
        cleanupKids();
      },
    };
  } catch (err) {
    cleanupKids();
    throw err;
  }
}

module.exports = { ROOT, findBrowser, sanitizedBrowserEnv, openApp };

/**
 * Headless Browser E2E & Accessibility Harness for PDF Study Suite (100% offline via app.py + CDP).
 *
 * Tests:
 *   1. Welcome screen & theme toggle (light / dark) at 1280x800 and 375x812.
 *   2. Slide deck (samples/sample_class_slides.pdf): all 5 tabs, flashcard flip/known/filter/add/export,
 *      quiz interactions, practice test submission, split view canvas render, keyboard shortcuts.
 *   3. Textbook (samples/sample_textbook_chapters.pdf): outline rail, custom page-range form, 5 tabs.
 *   4. Dead-end states: synthetic blank/no-ink PDF and synthetic image-only PDF.
 *   5. Private-window / blocked-IndexedDB fallback: ensures zero uncaught errors and graceful memory store.
 *
 * Asserts across every step: 0 console errors, 0 uncaught exceptions, 0 unexpected HTTP >= 400 responses,
 * 0 off-origin requests, 0px horizontal overflow at 1280x800 & 375x812, visible focus styles, and
 * WCAG 2.2 AA standalone interactive target size >= 24x24px.
 *
 * Usage: node tools/eval-ui-e2e.js [--browser=path] [--timeout=180] [--quiet]
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { ROOT, findBrowser, openApp } = require('./eval-browser.js');

const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const TIMEOUT = (Number(flags.timeout) || 180) * 1000;
const QUIET = flags.quiet === true;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildPdf(bodies) {
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;
  bodies.forEach((b, i) => {
    offsets.push(pos);
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), buf, Buffer.from('\nendobj\n')]);
    parts.push(obj);
    pos += obj.length;
  });
  const count = bodies.length + 1;
  const xref = `xref\n0 ${count}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  return Buffer.concat([...parts, Buffer.from(xref)]);
}

function makeBlankPdf() {
  return buildPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]);
}

function makeImageOnlyPdf() {
  const w = 40;
  const h = 40;
  const pixels = Buffer.alloc(w * h, 240);
  // Dark rectangle stripes inside the image so it is non-empty ink
  for (let y = 10; y < 30; y += 6) {
    for (let x = 6; x < 34; x++) pixels[y * w + x] = 20;
  }
  const compressed = zlib.deflateSync(pixels);
  const content = Buffer.from('q 595 0 0 792 0 0 cm /Im0 Do Q');
  return buildPdf([
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`),
      compressed,
      Buffer.from('\nendstream'),
    ]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
  ]);
}

async function setViewport(send, width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile: Boolean(mobile),
  });
  await sleep(120);
}

async function checkLayoutAndTargets(evalJs, label) {
  const res = await evalJs(`(() => {
    const docEl = document.documentElement;
    const overflow = docEl.scrollWidth - docEl.clientWidth;
    const smallTargets = [];
    for (const el of document.querySelectorAll('button, a, input, select, [role="tab"]')) {
      if (el.offsetParent === null) continue;
      if (el.classList.contains('btn-link') || el.classList.contains('page-jump') || el.classList.contains('note-link')) continue;
      if (el.closest('.prose, .sum-points, .def, .status-line')) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (r.width < 23.5 || r.height < 23.5) {
        smallTargets.push({
          tag: el.tagName,
          id: el.id || '',
          cls: el.className || '',
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
        });
      }
    }
    const inlineSmall = [];
    for (const el of document.querySelectorAll('.page-jump, .note-link')) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.height < 23.5) inlineSmall.push({ cls: el.className, h: Math.round(r.height * 10) / 10 });
    }
    return { overflow, scrollW: docEl.scrollWidth, clientW: docEl.clientWidth, smallTargets, inlineSmall };
  })()`);
  if (res.overflow > 1) {
    throw new Error(`[${label}] Horizontal overflow: scrollWidth=${res.scrollW} > clientWidth=${res.clientW}`);
  }
  if (res.smallTargets.length) {
    throw new Error(`[${label}] Standalone interactive targets < 24px: ${JSON.stringify(res.smallTargets.slice(0, 5))}`);
  }
  if (res.inlineSmall.length) {
    throw new Error(`[${label}] Inline page-jump/note-link height < 24px: ${JSON.stringify(res.inlineSmall.slice(0, 5))}`);
  }
}

async function openPdfBytes(evalJs, name, buf) {
  const b64 = buf.toString('base64');
  const ok = await evalJs(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
    return await PDFStudy.fileOpen.openBuffer(${JSON.stringify(name)}, bytes.buffer, { size: bytes.length });
  })()`);
  if (!ok) throw new Error(`openBuffer returned false for ${name}`);
  await evalJs('PDFStudy.backgroundRead ? PDFStudy.backgroundRead.whenIdle() : Promise.resolve()');
  await sleep(150);
}

function collectRuntimeProblems(app) {
  const origin = new URL(app.appUrl).origin;
  const headReqIds = new Set();
  const expected404ReqIds = new Set();
  const offOrigin = [];
  const failedSameOrigin = [];
  const consoleProblems = [];

  const isExpectedOptional404 = (pathname, reqId, status) => {
    if (pathname === '/local-larson.pdf') return true;
    if (status === 404 && headReqIds.has(reqId) && pathname.startsWith('/vendor/hw/')) {
      return !fs.existsSync(path.join(ROOT, pathname.slice(1)));
    }
    return false;
  };

  for (const e of app.events) {
    if (e.method === 'Network.requestWillBeSent') {
      const url = e.params.request.url;
      if (e.params.request.method === 'HEAD') headReqIds.add(e.params.requestId);
      if (/^https?:/.test(url) && !url.startsWith(origin)) offOrigin.push(url);
    } else if (e.method === 'Network.responseReceived') {
      const { url, status } = e.params.response;
      if (status >= 400 && url.startsWith(origin)) {
        const pathname = new URL(url).pathname;
        // /local-larson.pdf and absent optional vendor/hw/* HEAD probes return 404 when not installed on disk.
        if (isExpectedOptional404(pathname, e.params.requestId, status)) {
          expected404ReqIds.add(e.params.requestId);
        } else {
          failedSameOrigin.push(`${status} ${pathname}`);
        }
      }
    } else if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails;
      consoleProblems.push((d.exception && d.exception.description) || d.text);
    } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
      const ent = e.params.entry;
      const expectedLarson = ent.url && ent.url.endsWith('/local-larson.pdf');
      const expectedHwProbe = ent.networkRequestId && expected404ReqIds.has(ent.networkRequestId);
      if (!expectedLarson && !expectedHwProbe) {
        consoleProblems.push(`${ent.text} ${ent.url || ''}`.trim());
      }
    } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
      consoleProblems.push((e.params.args || []).map((a) => a.value || a.description).join(' '));
    }
  }
  return { offOrigin, failedSameOrigin, consoleProblems };
}

async function runMainFlows(exe) {
  const app = await openApp({ exe, timeoutMs: TIMEOUT, windowSize: '1280,800', captureEvents: true });
  try {
    await app.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });

    // 1. Welcome screen across light/dark and 1280x800 + 375x812
    const hasWelcome = await app.evalJs('!!(document.getElementById("choosePdfBtn") && document.getElementById("demoSlidesBtn") && document.getElementById("demoBookBtn"))');
    if (!hasWelcome) throw new Error('Welcome screen missing primary action or sample buttons');
    for (const [w, h, mob] of [[1280, 800, false], [375, 812, true]]) {
      await setViewport(app.send, w, h, mob);
      for (const theme of ['light', 'dark']) {
        await app.evalJs(`PDFStudy.theme.apply(${JSON.stringify(theme)})`);
        await checkLayoutAndTargets(app.evalJs, `welcome ${w}x${h} ${theme}`);
      }
    }
    await app.evalJs('document.documentElement.style.fontSize = "200%";');
    for (const [w, h, mob] of [[1280, 800, false], [375, 812, true]]) {
      await setViewport(app.send, w, h, mob);
      await checkLayoutAndTargets(app.evalJs, `welcome-zoom200 ${w}x${h}`);
    }
    await app.evalJs('document.documentElement.style.fontSize = "";');
    await setViewport(app.send, 1280, 800, false);
    await app.evalJs('PDFStudy.theme.apply("light")');

    // Focus ring CSS rule check
    const hasFocusRule = await app.evalJs(`Array.from(document.styleSheets).some((ss) => {
      try { return Array.from(ss.cssRules || []).some((r) => String(r.selectorText || '').includes(':focus-visible')); }
      catch (_e) { return false; }
    })`);
    if (!hasFocusRule) throw new Error('Missing :focus-visible style rule in stylesheets');

    // 2. Slide deck E2E
    const slidesBuf = fs.readFileSync(path.join(ROOT, 'samples/sample_class_slides.pdf'));
    await openPdfBytes(app.evalJs, 'sample_class_slides.pdf', slidesBuf);

    for (const tab of ['summary', 'flashcards', 'quiz', 'test', 'reader']) {
      await app.evalJs(`PDFStudy.tabs.select(${JSON.stringify(tab)}, true)`);
      await sleep(80);
      const selected = await app.evalJs(`document.getElementById("tab-${tab}").getAttribute("aria-selected") === "true"`);
      if (!selected) throw new Error(`Tab ${tab} did not become aria-selected="true"`);
      const nonEmpty = await app.evalJs(tab === 'reader'
        ? 'document.getElementById("pdfReaderPanel") && !document.getElementById("pdfReaderPanel").classList.contains("hidden")'
        : 'document.getElementById("activeStudyPanel").innerHTML.trim().length > 40');
      if (!nonEmpty) throw new Error(`Tab ${tab} rendered empty on sample_class_slides.pdf`);
    }

    // Check responsive light/dark across all 5 tabs (including Reader & #readerPageScrubber) at 1280x800 and 375x812
    for (const tab of ['summary', 'flashcards', 'quiz', 'test', 'reader']) {
      await app.evalJs(`PDFStudy.tabs.select(${JSON.stringify(tab)}, false)`);
      for (const [w, h, mob] of [[1280, 800, false], [375, 812, true]]) {
        await setViewport(app.send, w, h, mob);
        for (const theme of ['light', 'dark']) {
          await app.evalJs(`PDFStudy.theme.apply(${JSON.stringify(theme)})`);
          await checkLayoutAndTargets(app.evalJs, `slides-${tab} ${w}x${h} ${theme}`);
          if (tab === 'reader') {
            const scrubOk = await app.evalJs(`(() => {
              const s = document.getElementById("readerPageScrubber");
              if (!s || s.offsetParent === null) return false;
              const r = s.getBoundingClientRect();
              return r.width >= 23.5 && r.height >= 23.5;
            })()`);
            if (!scrubOk) throw new Error(`#readerPageScrubber failed visible >=24px target check at slides-reader ${w}x${h} ${theme}`);
          }
        }
      }
    }
    // Check 200% text zoom on reader tab across 1280x800 and 375x812 (already on reader tab)
    await app.evalJs('document.documentElement.style.fontSize = "200%";');
    for (const [w, h, mob] of [[1280, 800, false], [375, 812, true]]) {
      await setViewport(app.send, w, h, mob);
      await checkLayoutAndTargets(app.evalJs, `slides-reader-zoom200 ${w}x${h}`);
    }
    await app.evalJs('document.documentElement.style.fontSize = "";');
    await setViewport(app.send, 1280, 800, false);
    await app.evalJs('PDFStudy.theme.apply("light")');
    await sleep(250);

    // Keyboard focus-visible & ArrowRight check on #readerPageScrubber
    await app.evalJs('document.getElementById("readerNextBtn").focus();');
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await app.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
    await sleep(350);
    const scrubFocus = await app.evalJs(`(() => {
      const s = document.getElementById("readerPageScrubber");
      const inp = document.getElementById("readerPageInput");
      return {
        focused: document.activeElement === s,
        focusVisible: !!(s && s.matches(":focus-visible")),
        page: inp ? inp.value : ""
      };
    })()`);
    if (!scrubFocus.focused || !scrubFocus.focusVisible || scrubFocus.page !== '2') {
      throw new Error(`Scrubber keyboard focus/navigation check failed: ${JSON.stringify(scrubFocus)}`);
    }

    // Flashcards interactions: flip, known, filter, form validation, cancel, export
    await app.evalJs('PDFStudy.tabs.select("flashcards", false)');
    await app.evalJs('document.getElementById("flashcardBox").click()');
    const flipped = await app.evalJs('document.getElementById("flashcardBox").classList.contains("is-flipped")');
    if (!flipped) throw new Error('Clicking flashcard did not flip it');
    await app.evalJs('document.getElementById("fcKnownBtn").click()');
    await app.evalJs('document.getElementById("fcAddBtn").click()');
    await app.evalJs('document.querySelector("#fcForm button[type=submit]").click()');
    const formErr = await app.evalJs('(document.getElementById("fcFormError") || {}).textContent || ""');
    if (!formErr.trim()) throw new Error('Empty flashcard form did not show inline validation error');
    await app.evalJs('document.getElementById("fcFormCancel").click()');
    // Stub anchor download before clicking export so headless browser does not prompt
    await app.evalJs(`(() => {
      PDFStudy.storage.downloadFile = (fn, data) => { window.__lastExport = { fn, len: String(data || '').length }; };
      const btn = document.getElementById("fcExportAnkiBtn");
      if (btn) btn.click();
    })()`);
    const exp = await app.evalJs('window.__lastExport');
    if (!exp || !exp.len) throw new Error('Anki TSV export did not emit data');

    // Quiz interaction
    await app.evalJs('PDFStudy.tabs.select("quiz", false)');
    const qActed = await app.evalJs(`(() => {
      const opt = document.querySelector(".q-opt:not(:disabled)");
      if (opt) { opt.click(); return "opt"; }
      const show = document.querySelector("[data-show-qid]");
      if (show) { show.click(); const g = document.querySelector("[data-grade='got']"); if (g) g.click(); return "reveal"; }
      const inp = document.querySelector(".q-typed-input:not(:disabled)");
      if (inp) { inp.value = "test"; inp.closest("form").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); return "typed"; }
      return "none";
    })()`);
    if (qActed === 'none') throw new Error('No interactive quiz control found on sample_class_slides.pdf');

    // Practice test submission
    await app.evalJs('PDFStudy.tabs.select("test", false); window.confirm = () => true;');
    const submitted = await app.evalJs(`(() => {
      const opt = document.querySelector(".q-opt:not(:disabled)");
      if (opt) opt.click();
      const sub = document.getElementById("testSubmitBtn");
      if (!sub) return false;
      sub.click();
      return !!document.querySelector(".test-report");
    })()`);
    if (!submitted) throw new Error('Practice test submit did not render .test-report');

    // Split view canvas render
    await app.evalJs('PDFStudy.tabs.select("summary", false); document.getElementById("splitViewToggleBtn").click();');
    await sleep(400);
    const canvasOk = await app.evalJs(`(() => {
      const c = document.getElementById("pdfCanvas");
      return !!(c && !document.getElementById("pdfReaderPanel").classList.contains("hidden") && c.width > 0 && c.height > 0);
    })()`);
    if (!canvasOk) throw new Error('Split view did not render #pdfCanvas with non-zero dimensions');
    await checkLayoutAndTargets(app.evalJs, 'slides-split 1280x800');

    // 3. Textbook E2E (outline rail + custom range)
    const bookBuf = fs.readFileSync(path.join(ROOT, 'samples/sample_textbook_chapters.pdf'));
    await openPdfBytes(app.evalJs, 'sample_textbook_chapters.pdf', bookBuf);
    const railCount = await app.evalJs('document.querySelectorAll("#chapterTreeList .tree-row").length');
    if (!railCount) throw new Error('Textbook outline rail rendered 0 rows');
    await app.evalJs(`(() => {
      const det = document.querySelector("details.tree-range");
      if (det) det.open = true;
      document.getElementById("customStartPage").value = "1";
      document.getElementById("customEndPage").value = "2";
      document.getElementById("customRangeForm").dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    })()`);
    await sleep(300);
    await checkLayoutAndTargets(app.evalJs, 'textbook-range 1280x800');
    await setViewport(app.send, 375, 812, true);
    await checkLayoutAndTargets(app.evalJs, 'textbook-range 375x812');
    await setViewport(app.send, 1280, 800, false);

    // 4. Dead-end states: blank PDF + image-only PDF
    await openPdfBytes(app.evalJs, 'blank-test.pdf', makeBlankPdf());
    const blankState = await app.evalJs('(document.querySelector(".empty.state") || {}).getAttribute ? document.querySelector(".empty.state").getAttribute("data-state") : ""');
    if (blankState !== 'blank-document') {
      throw new Error(`Expected blank-document dead-end state, got: ${JSON.stringify(blankState)}`);
    }

    await openPdfBytes(app.evalJs, 'image-only-test.pdf', makeImageOnlyPdf());
    const imgHandled = await app.evalJs('!!(document.querySelector(".empty.state") || document.querySelector(".sum-lead, .sec, .hw-notice:not(.hidden)"))');
    if (!imgHandled) throw new Error('Image-only PDF rendered neither explained dead-end state nor study output');

    const probs = collectRuntimeProblems(app);
    if (probs.offOrigin.length) throw new Error(`Off-origin network requests detected: ${probs.offOrigin.join(', ')}`);
    if (probs.failedSameOrigin.length) throw new Error(`Failed same-origin requests: ${probs.failedSameOrigin.join(', ')}`);
    if (probs.consoleProblems.length) throw new Error(`Browser console/runtime errors: ${probs.consoleProblems.join(' | ')}`);
  } finally {
    app.close();
  }
}

async function runBlockedIndexedDbFlow(exe) {
  const preloadScript = `(() => {
    try {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
      });
    } catch (_e) {}
  })();`;
  const app = await openApp({ exe, timeoutMs: TIMEOUT, windowSize: '1280,800', preloadScript, captureEvents: true });
  try {
    const slidesBuf = fs.readFileSync(path.join(ROOT, 'samples/sample_class_slides.pdf'));
    await openPdfBytes(app.evalJs, 'sample_class_slides.pdf', slidesBuf);
    await app.evalJs('PDFStudy.tabs.select("flashcards", false); const k = document.getElementById("fcKnownBtn"); if (k) k.click();');
    await sleep(200);
    const probs = collectRuntimeProblems(app);
    if (probs.consoleProblems.length) {
      throw new Error(`Private-mode blocked IndexedDB caused errors: ${probs.consoleProblems.join(' | ')}`);
    }
    if (probs.offOrigin.length || probs.failedSameOrigin.length) {
      throw new Error(`Private-mode request error: ${JSON.stringify(probs)}`);
    }
  } finally {
    app.close();
  }
}

async function main() {
  const exe = findBrowser(flags.browser);
  if (!exe) {
    console.error('No Edge/Chrome found; pass --browser=path');
    process.exit(2);
  }
  await runMainFlows(exe);
  await runBlockedIndexedDbFlow(exe);
  if (!QUIET) {
    console.log('[OK] UI E2E & Accessibility checks passed (1280x800 + 375x812, light + dark, 5 tabs, split reader, 200% reader zoom, dead-end PDFs, blocked-IndexedDB fallback, 0 overflow, 0 console errors)');
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`UI E2E FAIL: ${(err && err.stack) || err}`);
  process.exit(1);
});

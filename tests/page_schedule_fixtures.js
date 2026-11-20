/**
 * When pages are parsed (Node, no PDF.js): src/pdf/page-scheduler.js and src/pdf/parsed-page-cache.js.
 * Pages come back in the order asked for, a page asked for twice while it is parsed is parsed once, a
 * remembered page is not parsed at all, a remembered page is a private copy, a parse error reaches the caller,
 * and without a store or a fingerprint nothing is cached. In Node there are no helper workers: pages are
 * parsed one at a time in page order, exactly as before.
 * Run: node tests/page_schedule_fixtures.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = (...p) => require(path.join(ROOT, 'src', ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const store = src('ui', 'doc-store.js');
src('nlp', 'study-keys.js');
const cache = src('pdf', 'parsed-page-cache.js');
const scheduler = src('pdf', 'page-scheduler.js');
const P = globalThis.PDFStudy;
store.configure({ memoryOnly: true });

const tick = () => new Promise((r) => setTimeout(r, 1));
const fakeDoc = (print, numPages) => ({ numPages, fingerprints: [print, null] });

function loadPdfModules() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/<script\s+src="([^"?]+)/g)) {
    if (m[1].startsWith('src/pdf/')) require(path.join(ROOT, m[1]));
  }
}

function buildSyntheticPdfWithImages() {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAJ+.SFUI-Regular_wdth_opsz2B9AF4 >>');
  // 2x2 uncompressed RGB Image XObject (h * u = 4 > maxImageSize: 1)
  const img = add(`<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 12 >>\nstream\n${Array(12).fill('A').join('')}\nendstream`);
  const textOp = (font, size, x, y, str, mode = 0) => `BT ${mode ? `${mode} Tr ` : ''}/${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${str}) Tj ET`;
  const typedText = 'Typed slide bullet covering cellular transport and membrane gradients across epithelial layers today.';
  const p1 = [
    textOp('F1', 18, 72, 480, typedText),
    textOp('F1', 14, 72, 420, 'Secondary line with plenty of words to stay above mixed threshold.'),
    'q 100 0 0 80 700 400 cm /Im1 Do Q',
    'BT 3 Tr /F2 28 Tf 1 0 0 1 300 320 Tm (handwritten overlay note) Tj ET',
  ].join('\n');
  const p2 = 'q 600 0 0 400 100 70 cm /Im1 Do Q';
  const p3 = [
    textOp('F1', 20, 72, 480, 'Interscalene block landmarks and anatomy'),
    'q 680 0 0 380 100 50 cm /Im1 Do Q',
  ].join('\n');
  const strokes = Array.from({ length: 165 }, (_, i) => `${440 + (i % 15) * 14} ${120 + Math.floor(i / 15) * 16} m ${450 + (i % 15) * 14} ${128 + Math.floor(i / 15) * 16} l S`).join('\n');
  const p4 = [
    textOp('F1', 14, 72, 480, 'Long typed prose block about nerve conduction velocity and myelinated axon saltatory propagation.'),
    textOp('F1', 14, 72, 440, 'Additional typed sentence ensuring word count clearly exceeds fifteen words on this slide.'),
    strokes,
    'q 80 0 0 60 720 400 cm /Im1 Do Q',
  ].join('\n');
  const kids = [];
  for (const ops of [p1, p2, p3, p4]) {
    const c = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /XObject << /Im1 ${img} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

async function fastLaneTests() {
  loadPdfModules();
  const OPS = {
    save: 1, restore: 2, transform: 3, constructPath: 4, stroke: 5,
    paintImageXObject: 6, setTextRenderingMode: 7, showText: 8, setFont: 9, beginText: 10, setTextMatrix: 11,
  };
  const makePageSpec = (words, hasImg, looseCount) => {
    const text = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
    const items = words ? [{ str: text, transform: [14, 0, 0, 14, 72, 480], width: words * 40, height: 14, fontName: 'F1' }] : [];
    const fnFast = [];
    const argFast = [];
    for (let i = 0; i < looseCount; i++) {
      const x = 420 + (i % 15) * 14;
      const y = 80 + Math.floor(i / 15) * 14;
      fnFast.push(OPS.constructPath, OPS.stroke);
      argFast.push([[], [], [x, x + 8, y, y + 8]], []);
    }
    const fnFull = fnFast.slice();
    const argFull = argFast.slice();
    if (hasImg) {
      fnFull.push(OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore);
      argFull.push([], [680, 0, 0, 380, 100, 60], ['Im1', 680, 380], []);
    }
    return { items, fastOps: { fnArray: fnFast, argsArray: argFast }, fullOps: { fnArray: fnFull, argsArray: argFull } };
  };
  const specs = {
    1: makePageSpec(20, true, 0),    // > MIXED_MAX_WORDS typed + image -> fast lane only, no full fallback
    2: makePageSpec(2, true, 0),     // < MIN_WORDS + image -> low words triggers full fallback -> no-text
    3: makePageSpec(6, true, 0),     // <= MIXED_MAX_WORDS + large image -> low words triggers full fallback -> mixed/image
    4: makePageSpec(20, true, 160),  // > MIXED_MAX_WORDS + loose strokes + image -> needsRecognition triggers full fallback
  };

  const docCalls = [];
  const fullOpCalls = [];
  const fastOpCalls = [];
  let fastDestroyed = 0;
  let fastCleanups = 0;
  let fullCleanups = 0;
  let failFastOpen = false;

  const makeFakePdfDoc = (isFast) => ({
    numPages: 4,
    fingerprints: ['fake-fast-lane', null],
    async getOutline() { return []; },
    async getPageLabels() { return null; },
    async getPage(n) {
      const s = specs[n];
      return {
        pageNumber: n,
        commonObjs: { has: () => true, get: () => ({ name: 'Helvetica' }) },
        getViewport: ({ scale }) => ({ width: 960 * scale, height: 540 * scale, viewBox: [0, 0, 960, 540], transform: [1, 0, 0, -1, 0, 540] }),
        getTextContent: async () => ({ items: s.items, styles: {} }),
        getOperatorList: async () => {
          (isFast ? fastOpCalls : fullOpCalls).push(n);
          return isFast ? s.fastOps : s.fullOps;
        },
        getAnnotations: async () => [],
        cleanup() { if (isFast) fastCleanups++; else fullCleanups++; },
      };
    },
    destroy() { if (isFast) fastDestroyed++; },
  });

  const prevLib = globalThis.pdfjsLib;
  const prevStore = P.docStore;
  P.docStore = null;
  globalThis.pdfjsLib = {
    OPS,
    GlobalWorkerOptions: {},
    getDocument(opts) {
      docCalls.push({ maxImageSize: opts.maxImageSize, verbosity: opts.verbosity, fontExtraProperties: opts.fontExtraProperties });
      if (opts.maxImageSize === 1 && failFastOpen) return { promise: Promise.reject(new Error('fast open failed')) };
      return { promise: Promise.resolve(makeFakePdfDoc(opts.maxImageSize === 1)) };
    },
  };

  try {
    const buf = new ArrayBuffer(32);
    const parsed = await P.pdfLoader.loadPdfDocument(buf, () => {});
    const [p1, p2, p3, p4] = parsed.pages;
    check('fast lane opens parse-only doc with maxImageSize: 1 and verbosity: 0',
      docCalls.some((c) => c.maxImageSize === 1 && c.verbosity === 0 && c.fontExtraProperties === true), JSON.stringify(docCalls));
    check('fast lane parses all 4 pages on fastDoc first', fastOpCalls.join() === '1,2,3,4', fastOpCalls.join());
    check('high-word typed page skips fullDoc fallback', !fullOpCalls.includes(1) && p1.wordCount === 20 && p1.ink.needsRecognition === false && p1.ink.reason === 'has-text');
    check('low-word picture page triggers fullDoc fallback for imageOps/no-text', fullOpCalls.includes(2) && p2.ink.needsRecognition === true && p2.ink.reason === 'no-text' && p2.ink.imageOps === 1, JSON.stringify(p2.ink));
    check('low-word mixed/image page triggers fullDoc fallback for readBoxes', fullOpCalls.includes(3) && p3.ink.needsRecognition === true && p3.ink.reason === 'mixed' && p3.ink.mixed === 'image' && p3.ink.readBoxes.length === 1, JSON.stringify(p3.ink));
    check('needsRecognition page with >15 words triggers fullDoc fallback for imageOps', fullOpCalls.includes(4) && p4.ink.needsRecognition === true && p4.ink.mixed === 'paths' && p4.ink.imageOps === 1, JSON.stringify(p4.ink));
    check('fast and fallback pages clean up after parsing', fastCleanups === 4 && fullCleanups === 3, `${fastCleanups}/${fullCleanups}`);

    await parsed.pdfDoc.destroy();
    check('destroying parsed.pdfDoc also destroys the fast parse-only helper doc', fastDestroyed === 1, String(fastDestroyed));

    // If fast lane fails to open, scheduler cleanly falls back to full pdfDoc
    fullOpCalls.length = 0;
    fastOpCalls.length = 0;
    failFastOpen = true;
    const parsedFallback = await P.pdfLoader.loadPdfDocument(new ArrayBuffer(32), () => {});
    check('fast lane open failure falls back cleanly to main pdfDoc',
      parsedFallback.pages.length === 4 && fullOpCalls.join() === '1,2,3,4' && parsedFallback.pages[1].ink.reason === 'no-text');
    await parsedFallback.pdfDoc.destroy();
  } finally {
    globalThis.pdfjsLib = prevLib;
    P.docStore = prevStore;
  }
}

async function realPdfParityTests() {
  const prevWin = globalThis.window;
  const prevLib = globalThis.pdfjsLib;
  const prevWorker = globalThis.pdfjsWorker;
  const prevStore = P.docStore;
  globalThis.window = globalThis;
  globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
  loadPdfModules();
  P.docStore = null;

  const pdfBuf = buildSyntheticPdfWithImages();
  const abFast = pdfBuf.buffer.slice(pdfBuf.byteOffset, pdfBuf.byteOffset + pdfBuf.byteLength);
  const abFull = abFast.slice(0);
  let parsedFast = null;
  let fullDoc = null;
  try {
    parsedFast = await P.pdfLoader.loadPdfDocument(abFast, () => {});
    await P.pdfLoader.ensurePagesLoaded(parsedFast, 1, parsedFast.numPages, () => {});
    fullDoc = await globalThis.pdfjsLib.getDocument({ data: abFull, fontExtraProperties: true, verbosity: 0 }).promise;
    for (let n = 1; n <= fullDoc.numPages; n++) {
      const fastPage = parsedFast.pageCache.get(n);
      const fullPage = await P.pdfLoader.parseSinglePage(fullDoc, n);
      check(`real PDF parity p${n}: lines match`, JSON.stringify(fastPage.lines) === JSON.stringify(fullPage.lines));
      check(`real PDF parity p${n}: annotations match`, JSON.stringify(fastPage.annotations) === JSON.stringify(fullPage.annotations));
      check(`real PDF parity p${n}: wordCount and kind match`, fastPage.wordCount === fullPage.wordCount && fastPage.kind === fullPage.kind);
      check(`real PDF parity p${n}: ink decision fields match`,
        fastPage.ink.needsRecognition === fullPage.ink.needsRecognition &&
        fastPage.ink.reason === fullPage.ink.reason &&
        fastPage.ink.mixed === fullPage.ink.mixed &&
        JSON.stringify(fastPage.ink.readBoxes) === JSON.stringify(fullPage.ink.readBoxes) &&
        fastPage.ink.pathOps === fullPage.ink.pathOps &&
        fastPage.ink.annotationStrokes === fullPage.ink.annotationStrokes,
        JSON.stringify([fastPage.ink, fullPage.ink]));
      if (n >= 2) {
        check(`real PDF parity p${n}: fallback preserves imageOps (${fullPage.ink.imageOps})`,
          fastPage.ink.imageOps === fullPage.ink.imageOps && fastPage.ink.imageOps === 1, JSON.stringify(fastPage.ink));
      }
    }
    check('real PDF parity: p1 keeps invisible overlay in annotations; p2 no-text, p3 mixed/image, p4 mixed/paths',
      parsedFast.pageCache.get(1).annotations.length === 1 &&
      parsedFast.pageCache.get(2).ink.reason === 'no-text' &&
      parsedFast.pageCache.get(3).ink.mixed === 'image' &&
      parsedFast.pageCache.get(4).ink.mixed === 'paths');
  } finally {
    if (parsedFast && parsedFast.pdfDoc && parsedFast.pdfDoc.destroy) await parsedFast.pdfDoc.destroy();
    if (fullDoc && fullDoc.destroy) await fullDoc.destroy();
    P.docStore = prevStore;
    globalThis.pdfjsLib = prevLib;
    globalThis.pdfjsWorker = prevWorker;
    globalThis.window = prevWin;
  }
}

/** A parser that records the order it was called in and takes a little while per page. */
function parser(log) {
  return async (doc, n) => {
    log.push(n);
    await tick();
    if (n === 13) throw new Error('page 13 cannot be parsed');
    return { pageNumber: n, lines: [{ text: `line on page ${n}` }], wordCount: 4, ink: { reason: 'typed' } };
  };
}

async function renderCancellationTests() {
  loadPdfModules();
  const canvas = { width: 0, height: 0, getContext: () => ({}) };
  let cancelCount = 0;
  const rendered = [];
  let rejectFirst = null;
  let resolveSecond = null;
  const mockDoc = {
    async getPage(n) {
      return {
        getViewport: ({ scale }) => ({ width: 100 * scale, height: 200 * scale }),
        render() {
          rendered.push(n);
          if (n === 1) {
            return {
              promise: new Promise((_res, rej) => { rejectFirst = rej; }),
              cancel() {
                cancelCount++;
                const err = new Error('cancelled');
                err.name = 'RenderingCancelledException';
                rejectFirst(err);
              },
            };
          }
          return {
            promise: new Promise((res) => { resolveSecond = res; }),
            cancel() { cancelCount++; },
          };
        },
      };
    },
  };
  const p1 = P.pdfLoader.renderPageToCanvas(mockDoc, 1, canvas, 1);
  await Promise.resolve();
  const p2 = P.pdfLoader.renderPageToCanvas(mockDoc, 2, canvas, 1);
  await Promise.resolve();
  if (resolveSecond) resolveSecond();
  await Promise.all([p1, p2]);
  check('renderPageToCanvas cancels overlapping render and swallows RenderingCancelledException',
    cancelCount === 1 && rendered.join(',') === '1,2', `${cancelCount}:${rendered.join(',')}`);

  // Stale call superseded while getPage() is still pending skips page.render()
  let releaseSlowGetPage = null;
  const rendered2 = [];
  const docSlow = {
    getPage(n) {
      const pageObj = {
        getViewport: () => ({ width: 50, height: 50 }),
        render() {
          rendered2.push(n);
          return { promise: Promise.resolve(), cancel() {} };
        },
      };
      if (n === 1) return new Promise((res) => { releaseSlowGetPage = () => res(pageObj); });
      return Promise.resolve(pageObj);
    },
  };
  const slow1 = P.pdfLoader.renderPageToCanvas(docSlow, 1, canvas, 1);
  const fast2 = P.pdfLoader.renderPageToCanvas(docSlow, 2, canvas, 1);
  await fast2;
  releaseSlowGetPage();
  await slow1;
  check('renderPageToCanvas skips rendering stale page superseded during getPage()',
    rendered2.join(',') === '2', rendered2.join(','));
}

async function main() {
  // Without a store: one at a time, in page order, nothing remembered
  const realStore = P.docStore;
  P.docStore = null;
  let log = [];
  const doc = fakeDoc('print-a', 20);
  scheduler.attach(doc, scheduler.begin(new ArrayBuffer(8)));
  const pages = await Promise.all(scheduler.schedule(doc, [3, 1, 2], parser(log)));
  check('pages come back in the order asked for', pages.map((p) => p.pageNumber).join() === '3,1,2');
  check('Node: parsed one at a time in the order asked for', log.join() === '3,1,2', log.join());

  // The same page asked for twice while it is parsed: parsed once, both get the same page
  log = [];
  const first = scheduler.schedule(doc, [4, 5], parser(log));
  const second = scheduler.schedule(doc, [5, 6], parser(log));
  const [a5, b5] = await Promise.all([first[1], second[0]]);
  await Promise.all(second);
  check('a page in flight is not parsed twice', log.filter((n) => n === 5).length === 1 && a5 === b5, log.join());

  // A failure reaches the caller; the pages after it are still parsed
  log = [];
  const withError = scheduler.schedule(doc, [12, 13, 14], parser(log));
  const outcome = await Promise.all(withError.map((p) => p.then(() => 'ok', (e) => e.message)));
  check('a parse error rejects that page only', outcome.join('|') === 'ok|page 13 cannot be parsed|ok', outcome.join('|'));
  P.docStore = realStore;

  // With a store, a fingerprint and a parser version: parsed pages are remembered for the next opening
  cache.useVersion('v1');
  log = [];
  const docB = fakeDoc('print-b', 20);
  scheduler.attach(docB, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(docB, [1, 2, 3], parser(log)));
  await tick();
  const again = fakeDoc('print-b', 20); // the same file opened again
  scheduler.attach(again, scheduler.begin(new ArrayBuffer(8)));
  log = [];
  const back = await Promise.all(scheduler.schedule(again, [1, 2, 3, 4], parser(log)));
  check('reopened: remembered pages are not parsed again', log.join() === '4', log.join());
  check('reopened: the remembered pages are the pages', back.map((p) => p.lines[0].text).join('|') === 'line on page 1|line on page 2|line on page 3|line on page 4');
  back[0].lines.push({ text: 'added later, as reading a picture does' });
  const third = fakeDoc('print-b', 20);
  scheduler.attach(third, scheduler.begin(new ArrayBuffer(8)));
  const fresh = await scheduler.schedule(third, [1], parser([]))[0];
  check('a remembered page is a private copy: later changes are not remembered', fresh.lines.length === 1);

  // A new parser version, another file with the same fingerprint, or no fingerprint: nothing is found
  cache.useVersion('v2');
  log = [];
  const docC = fakeDoc('print-b', 20);
  scheduler.attach(docC, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(docC, [1], parser(log)));
  check('a new parser version parses afresh', log.join() === '1');
  cache.useVersion('v1');
  log = [];
  const sameId = fakeDoc('print-b', 21); // same fingerprint, another page count: another file
  scheduler.attach(sameId, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(sameId, [1], parser(log)));
  check('another file with the same fingerprint is not served these pages', log.join() === '1');
  check('no fingerprint: no cache', (await cache.forDocument({ numPages: 3, fingerprints: [null] }, 8)) === null);
  check('too many pages to keep: no cache', (await cache.forDocument(fakeDoc('print-big', cache.MAX_PAGES + 1), 8)) === null);
  cache.useVersion(null);
  check('parser version unknown: no cache', (await cache.forDocument(fakeDoc('print-b', 20), 8)) === null);

  check('Node: nextTask resolves at once', (await Promise.race([scheduler.nextTask().then(() => true), tick().then(() => false)])) === true);

  await fastLaneTests();
  await realPdfParityTests();
  await renderCancellationTests();

  console.log(`page_schedule_fixtures: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

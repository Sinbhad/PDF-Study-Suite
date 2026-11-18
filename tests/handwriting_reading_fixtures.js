/**
 * Reading picture pages without blocking, and remembering what was read (Node, no model, no PDF.js):
 * the per-page result cache (src/ui/ocr-cache.js) on the in-memory document store, corrections that win over
 * the model's text, a reopened document that never starts the reader, typed text first and pictures later
 * (src/ui/study-reading.js), a replaced run that leaves pages unread instead of skipped (src/hw/hw-pipeline.js),
 * the shortened orientation check (src/hw/upright.js), boxes too small to hold three characters
 * (src/hw/hw-worker-core.js) and the wait for the availability check (src/hw/hw-availability.js).
 * Every text here is invented for the test.
 * Run: node tests/handwriting_reading_fixtures.js
 */
const path = require('path');
const S = require('./hw_synth.js');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const detect = src('pdf', 'ink-detect.js');
const ocr = src('pdf', 'ocr-lines.js');
const pipe = src('hw', 'hw-pipeline.js');
const upright = src('hw', 'upright.js');
const nullEngine = src('hw', 'null-engine.js');
const store = src('ui', 'doc-store.js');
src('ui', 'doc-verdict.js');
const cache = src('ui', 'ocr-cache.js');
const reading = src('ui', 'study-reading.js');
const P = globalThis.PDFStudy;

store.configure({ memoryOnly: true });
let openDoc = 'doc-a';
P.docSession = { id: () => openDoc };

const W = 800;
const H = 600;
const typedLine = (text, x, y) => ({
  text, formattedText: text, cleanText: text, x0: x, textX0: x, x1: x + 300, topY: y, bottomY: y + 14,
  fontSize: 12, wordCount: text.split(/\s+/).length, pageWidth: W, pageHeight: H,
});
const typedPage = (n) => {
  const page = { pageNumber: n, width: W, height: H, lines: [0, 1, 2].map((i) => typedLine('A typed sentence about the forearm muscles.', 60, 80 + i * 30)) };
  page.wordCount = 21;
  page.ink = detect.assess(page, { pathOps: 2, imageOps: 0 });
  return page;
};
const imagePage = (n) => {
  const page = { pageNumber: n, width: W, height: H, lines: [], wordCount: 0 };
  page.ink = detect.assess(page, { pathOps: 3, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 80, w: 680, h: 460 }], paths: [], pathsMeasured: true } });
  return page;
};
const docOf = (pages) => ({ numPages: pages.length, pages, pageCache: new Map(pages.map((p) => [p.pageNumber, p])) });
const resultFor = (n, extra) => Object.assign({
  pageNumber: n, scale: 1, width: W, height: H, engine: 'ppocr-v5',
  lines: [
    ['The flexor tendons pass under the retinaculum.', 0.93],
    ['The median nerve runs with them.', 0.9],
    ['a line the reader was not sure about', 0.3],
  ].map(([text, confidence], i) => {
    const box = { x: 100, y: 100 + i * 40, w: 400, h: 16 };
    return { index: i, box, regions: [{ id: `p${n}-l${i}-r0`, kind: 'text', box, text: `${text} (${n})`, confidence, source: 'model' }] };
  }),
}, extra);
/** A deck: typed slides with picture slides at the given numbers. */
const deck = (count, pictures) => docOf(Array.from({ length: count }, (_, i) => (pictures.includes(i + 1) ? imagePage(i + 1) : typedPage(i + 1))));
const appOf = (parsed) => ({ parsedPdf: parsed, activeMode: 'slide_deck', handwriting: null, selectedScope: { startPage: 1, endPage: parsed.numPages } });

/** Stand-in for the reader: "reads" every page that needs it and reports each one, like ensureRecognised. */
function fakeReader() {
  const log = { calls: 0, pages: [] };
  const ensureRecognised = async (parsed, s, e, o) => {
    log.calls += 1;
    const needed = detect.pagesNeeding(parsed, s, e).filter((n) => !parsed.pageCache.get(n).ink.skipped || o.retrySkipped);
    for (const n of needed) {
      ocr.applyToPage(parsed.pageCache.get(n), resultFor(n));
      log.pages.push(n);
      if (o.onResult) o.onResult(n);
    }
    return { pages: needed.length, regions: 0, low: 0, skipped: 0, cancelled: false, engine: needed.length ? { name: 'ppocr-v5', available: true } : null };
  };
  return { log, ensureRecognised };
}

async function withReader(fn) {
  const real = P.hwPipeline.ensureRecognised;
  const fake = fakeReader();
  P.hwPipeline.ensureRecognised = fake.ensureRecognised;
  try {
    return await fn(fake.log);
  } finally {
    P.hwPipeline.ensureRecognised = real;
  }
}

async function cacheTests() {
  openDoc = 'doc-cache';
  const first = deck(3, [2]);
  ocr.applyToPage(first.pageCache.get(2), resultFor(2));
  check('cache: a finished reading is saved', (await cache.save(first, 2)) === true);
  check('cache: the key names the page and the reader version', cache.keyOf(2) === `2:${pipe.READER_VERSION}` && pipe.READER_VERSION.length > 3);

  const again = deck(3, [2]);
  const n = await cache.restore(again, [1, 2, 3]);
  const page = again.pageCache.get(2);
  check('cache: a new copy of the document gets the page back', n === 1 && page.ink.recognised === true && page.ink.remembered === true && page.lines.length === 2, `${n} restored, ${page.lines.length} lines`);
  check('cache: what is restored goes through the same rules (the unsure line is listed, not added)', ocr.lowConfidence(page).length === 1 && page.lines.every((l) => l.ocr && !l.ocr.low));
  check('cache: restoring again finds nothing left to do', (await cache.restore(again, [2])) === 0);

  // a correction is saved with the page and comes back in place of the model's text
  ocr.applyCorrection(page, 'p2-l2-r0', 'The ulnar nerve passes outside the tunnel.');
  check('cache: a corrected page is marked until it is saved', page.ink.corrected === true);
  check('cache: saveCorrected saves it and clears the mark', (await cache.saveCorrected(again)) === 1 && page.ink.corrected === false && (await cache.saveCorrected(again)) === 0);
  const third = deck(3, [2]);
  await cache.restore(third, [2]);
  const back = third.pageCache.get(2);
  const fixed = back.ink.result.lines[2].regions[0];
  check('cache: the student\'s text wins over the model\'s after reopening', fixed.text === 'The ulnar nerve passes outside the tunnel.' && fixed.source === 'user' && fixed.confidence === 1 && back.lines.length === 3 && ocr.lowConfidence(back).length === 0, JSON.stringify(fixed));

  // a new reader version, or another document, finds nothing
  const version = pipe.READER_VERSION;
  pipe.READER_VERSION = `${version}-next`;
  check('cache: a new reader version misses, so the page is read afresh', (await cache.restore(deck(3, [2]), [2])) === 0);
  pipe.READER_VERSION = version;
  openDoc = 'doc-other';
  check('cache: another document does not see it', (await cache.restore(deck(3, [2]), [2])) === 0);

  // what is not worth keeping
  const stopped = deck(2, [2]);
  ocr.applyToPage(stopped.pageCache.get(2), resultFor(2, { partial: true }));
  const unread = deck(2, [2]);
  const manual = resultFor(2, { engine: undefined });
  manual.lines.forEach((l) => l.regions.forEach((r) => Object.assign(r, { text: '', confidence: 0, source: 'manual' })));
  ocr.applyToPage(unread.pageCache.get(2), manual);
  check('cache: a stopped reading and an unread page are not saved', (await cache.save(stopped, 2)) === false && (await cache.save(unread, 2)) === false && (await cache.save(unread, 1)) === false);
  ocr.applyCorrection(unread.pageCache.get(2), 'p2-l0-r0', 'Typed in by the student.');
  check('cache: text the student typed in is saved even though no reader ran', (await cache.saveCorrected(unread)) === 1 && cache.worthKeeping(manual) === true);

  // no open document, or no store: nothing is remembered and nothing throws
  openDoc = null;
  check('cache: without an open document nothing is remembered', (await cache.restore(deck(3, [2]), [2])) === 0 && (await cache.save(first, 2)) === false);
  openDoc = 'detached';
  check('cache: a detached session is not a document', (await cache.save(first, 2)) === false);
  const realStore = P.docStore;
  P.docStore = null;
  openDoc = 'doc-cache';
  check('cache: without a store the calls still answer', (await cache.restore(deck(3, [2]), [2])) === 0 && (await cache.saveCorrected(first)) === 0);
  P.docStore = realStore;
}

async function deferTests() {
  await withReader(async (log) => {
    openDoc = 'doc-defer';
    const st = appOf(deck(8, [3, 5, 6]));
    const first = await reading.read(st, 1, 8, { handwriting: true, defer: true });
    check('defer: typed text beside pictures -> the pictures are handed back, the reader is not started', first.pending.join() === '3,5,6' && first.changed === false && log.calls === 0, JSON.stringify(first));
    check('defer: nothing is reported as read yet', st.handwriting.pages === 0 && st.handwriting.engine === null);

    const seen = [];
    const second = await reading.read(st, 1, 8, { handwriting: true, onPageRead: (n) => seen.push(n) });
    check('read: the pages are read, each one reported as it is done', second.pending.length === 0 && second.changed === true && log.pages.join() === '3,5,6' && seen.join() === '3,5,6');
    check('read: counts hold the kept pieces of the pages read', st.handwriting.pages === 3 && st.handwriting.regions === 9 && st.handwriting.low === 3 && st.handwriting.engine.name === 'ppocr-v5', JSON.stringify(st.handwriting));
    await new Promise((r) => setTimeout(r, 10)); // saving is not awaited by the reader

    // the same document opened again: everything is remembered
    const reopened = appOf(deck(8, [3, 5, 6]));
    log.pages.length = 0;
    const third = await reading.read(reopened, 1, 8, { handwriting: true, defer: true });
    check('reopen: remembered pages are applied before the first build, nothing is left to read', third.pending.length === 0 && third.changed === true && log.pages.length === 0, JSON.stringify(third));
    check('reopen: the counts and the reader\'s name are there although no reader ran', reopened.handwriting.pages === 3 && reopened.handwriting.low === 3 && reopened.handwriting.engine.name === 'ppocr-v5' && reopened.handwriting.engine.available === true, JSON.stringify(reopened.handwriting));

    // one new picture page: only that one is still to read
    openDoc = 'doc-defer';
    const grown = appOf(deck(8, [3, 5, 6, 7]));
    const fourth = await reading.read(grown, 1, 8, { handwriting: true, defer: true });
    check('reopen: a page not read before is the only one pending', fourth.pending.join() === '7' && fourth.changed === true);

    // nothing typed in the range: there is nothing to show first, so the pages are read at once
    openDoc = 'doc-notes';
    const notes = appOf(deck(3, [1, 2, 3]));
    log.calls = 0;
    const all = await reading.read(notes, 1, 3, { handwriting: true, defer: true });
    check('defer: a range of pictures only is read straight away', all.pending.length === 0 && log.calls === 1 && notes.handwriting.pages === 3);

    // pages the student stopped at are not picked up again unasked
    openDoc = 'doc-stopped';
    const halted = appOf(deck(6, [2, 4]));
    halted.parsedPdf.pageCache.get(4).ink.skipped = true;
    const rest = await reading.read(halted, 1, 6, { handwriting: true, defer: true });
    const asked = await reading.read(halted, 1, 6, { handwriting: true, defer: true, retrySkipped: true });
    check('defer: a skipped page is pending only when the student asks for the rest', rest.pending.join() === '2' && asked.pending.join() === '2,4');

    // switched off, and a run that has been replaced
    openDoc = 'doc-off';
    const off = appOf(deck(4, [2]));
    log.calls = 0;
    const none = await reading.read(off, 1, 4, { handwriting: false });
    check('off: reading switched off -> nothing pending, nothing read, nothing recorded', none.pending.length === 0 && none.changed === false && log.calls === 0 && off.handwriting === null);
    const stale = appOf(deck(4, [2]));
    const late = await reading.read(stale, 1, 4, { handwriting: true, isCurrent: () => false });
    check('stale: a replaced run records nothing', late.pending.length === 0 && late.changed === false && stale.handwriting === null);
  });
}

async function pipelineTests() {
  const hwClient = src('hw', 'hw-client.js');
  const rowsPage = () => {
    const img = S.bitmap(600, 400);
    for (let i = 0; i < 3; i++) S.wordRow(img, 50, 30 + i * 80, 24, 4);
    return { ...img, scale: 1 };
  };
  const inkPage = (n) => ({ pageNumber: n, width: 600, height: 400, lines: [], wordCount: 0, ink: { needsRecognition: true } });

  // a run that was replaced by a newer one stops, but the pages it did not reach are not marked as stopped
  const replaced = docOf([inkPage(1), inkPage(2), inkPage(3)]);
  const base = S.mockEngine();
  const ac = new AbortController();
  let current = true;
  const eng = { ...base, recognise: async (c, k) => { const r = await base.recognise(c, k); if (base.calls.length === 2) { current = false; ac.abort(); } return r; } };
  const c1 = hwClient.create({ workerFactory: S.fakeWorkerFactory(eng, S.newStats()) });
  const r1 = await pipe.ensureRecognised(replaced, 1, 3, { client: c1, signal: ac.signal, isCurrent: () => current, renderPage: async () => rowsPage() });
  c1.dispose();
  check('replaced run: it stops', r1.cancelled === true && r1.skipped === 0, JSON.stringify(r1));
  check('replaced run: unread pages stay unread, not skipped', !replaced.pageCache.get(2).ink.skipped && !replaced.pageCache.get(3).ink.skipped);
  check('replaced run: the page it was cut short on is read again too', detect.pagesNeeding(replaced, 1, 3).join() === '1,2,3' && replaced.pageCache.get(1).lines.length > 0 && !replaced.pageCache.get(1).ink.skipped);

  // the student's own Stop still marks them, so "Read the rest" is offered
  const stoppedDoc = docOf([inkPage(1), inkPage(2)]);
  const base2 = S.mockEngine();
  const ac2 = new AbortController();
  const eng2 = { ...base2, recognise: async (c, k) => { const r = await base2.recognise(c, k); if (base2.calls.length === 2) ac2.abort(); return r; } };
  const c2 = hwClient.create({ workerFactory: S.fakeWorkerFactory(eng2, S.newStats()) });
  const r2 = await pipe.ensureRecognised(stoppedDoc, 1, 2, { client: c2, signal: ac2.signal, isCurrent: () => true, renderPage: async () => rowsPage() });
  c2.dispose();
  check('stopped run: unread pages, and the one that was cut short, are marked skipped', r2.cancelled === true && r2.skipped === 2 && stoppedDoc.pageCache.get(1).ink.skipped === true && stoppedDoc.pageCache.get(2).ink.skipped === true);

  // each page is reported once its result is on the page; the counts are of kept pieces
  const told = [];
  const three = docOf([inkPage(1), inkPage(2)]);
  const c3 = hwClient.create({ workerFactory: S.fakeWorkerFactory(S.mockEngine({ script: [['A line of words that reads well.', 0.9], ['i', 0.2], ['', 0]] }), S.newStats()) });
  const r3 = await pipe.ensureRecognised(three, 1, 2, { client: c3, renderPage: async () => rowsPage(), onResult: (n, result) => told.push([n, three.pageCache.get(n).ink.raw === result]) });
  c3.dispose();
  check('onResult: called per page after the result was applied', told.length === 2 && told.every(([, applied]) => applied) && told.map(([n]) => n).join() === '1,2', JSON.stringify(told));
  check('counts: noise pieces are not counted', r3.pages === 2 && r3.regions === 2 && r3.low === 0, JSON.stringify(r3));

  // nothing to read: no reader is made at all
  const stats = S.newStats();
  let made = 0;
  const realCreate = hwClient.create;
  hwClient.create = (o) => { made += 1; return realCreate(Object.assign({}, o, { workerFactory: S.fakeWorkerFactory(S.mockEngine(), stats) })); };
  try {
    pipe.dispose();
    const read = docOf([inkPage(1), inkPage(2)]);
    read.pages.forEach((p) => { p.ink.recognised = true; });
    const r4 = await pipe.ensureRecognised(read, 1, 2, {});
    check('nothing to read: the shared reader is never created', r4.pages === 0 && made === 0 && stats.created === 0);

    // two runs on the shared reader: the second waits for the first, so both finish without colliding
    const a = docOf([inkPage(1)]);
    const b = docOf([inkPage(1)]);
    const [ra, rb] = await Promise.all([
      pipe.ensureRecognised(a, 1, 1, { renderPage: async () => rowsPage() }),
      pipe.ensureRecognised(b, 1, 1, { renderPage: async () => rowsPage() }),
    ]);
    check('shared reader: overlapping runs are taken one after the other', ra.pages === 1 && rb.pages === 1 && !ra.errors && !rb.errors && made === 1, JSON.stringify([ra, rb]));
  } finally {
    pipe.dispose();
    hwClient.create = realCreate;
  }
}

/** Page-prep and reader stand-ins for the orientation check: `reads` is what each probe line reads as, as given. */
function probeStubs(reads) {
  const calls = { plan: 0, read: 0, flipped: 0 };
  const plan = () => {
    calls.plan++;
    return { lines: reads.map((_, i) => ({ index: i, box: { x: 0, y: i * 20, w: 200 - i, h: 10 }, regions: [{ box: { x: 0, y: i * 20, w: 200 - i, h: 10 } }] })) };
  };
  const crop = (_p, _g, _w, _h, box) => ({ data: Uint8Array.from([1, 0, 0, 2]), w: 2, h: 2, row: box.y / 20 });
  const read = async (c) => {
    calls.read++;
    if (c.data[0] === 2) {
      calls.flipped++;
      return { text: 'q', confidence: 0.1 };
    }
    return reads[c.row];
  };
  return { calls, plan, crop, read };
}

async function orientationTests() {
  const page = S.bitmap(60, 60);
  const run = (stubs) => upright.choose(page.gray, 60, 60, { angle: 0, plan: stubs.plan, crop: stubs.crop, read: stubs.read });

  // a caption among photograph fragments: the mean is poor, the caption settles it
  const caption = probeStubs([{ text: 'l.', confidence: 0.1 }, { text: 'Needle tip beside the artery', confidence: 0.93 }, { text: '', confidence: 0 }]);
  const a = await run(caption);
  check('orientation: one line read as sure, real words -> upright, no crop is read turned over', a.view.angle === 0 && caption.calls.read === 3 && caption.calls.flipped === 0 && a.reads.size === 3, JSON.stringify(caption.calls));
  check('orientation: the work done is reported', a.work.plans === 1 && a.work.reads === 3, JSON.stringify(a.work));

  // sure but not words, or words but not sure: the full check still runs
  const digits = probeStubs([{ text: '7', confidence: 0.95 }, { text: 'x', confidence: 0.2 }, { text: 'o', confidence: 0.1 }]);
  await run(digits);
  const unsure = probeStubs([{ text: 'some words here', confidence: 0.8 }, { text: 'x', confidence: 0.1 }, { text: 'o', confidence: 0.1 }]);
  await run(unsure);
  check('orientation: a sure digit or unsure words do not settle it', digits.calls.flipped === 3 && unsure.calls.flipped === 3 && upright.CERTAIN > 0.8);

  // the caller knows the page is the right way up (it has typed text): nothing is read to find out
  const known = probeStubs([{ text: 'x', confidence: 0.1 }, { text: 'y', confidence: 0.1 }, { text: 'z', confidence: 0.1 }]);
  const k = await upright.choose(page.gray, 60, 60, { angle: 0, upright: true, plan: known.plan, crop: known.crop, read: known.read });
  check('orientation: a page known to be upright is not probed at all', k.view.angle === 0 && known.calls.read === 0 && known.calls.plan === 1 && k.reads.size === 0);

  // nothing reads as characters at all: a photograph. The same crops are not read again turned over
  const blank = probeStubs([{ text: '', confidence: 0 }, { text: ' ', confidence: 0 }, { text: '', confidence: 0 }]);
  const b = await run(blank);
  check('orientation: lines that read as nothing are not read turned over', b.view.angle === 0 && blank.calls.read === 3 && blank.calls.flipped === 0 && b.work.reads === 3);
}

async function tinyBoxTests() {
  const boxes = [{ x: 0, y: 0, w: 60, h: 10 }, { x: 0, y: 20, w: 9, h: 10 }, { x: 20, y: 20, w: 11, h: 10 }, { x: 0, y: 40, w: 14, h: 10 }];
  const prep = {
    plan: () => ({ bin: { data: new Uint8Array(1), w: 1, h: 1 }, medH: 10, inverted: false, lines: boxes.map((box, i) => ({ index: i, box, regions: [{ box }] })) }),
    cropFor: () => ({ data: new Uint8Array(40).fill(200), w: 10, h: 4 }),
  };
  const readWith = async (engine, canvasEngine) => {
    const out = [];
    const h = S.core.createHandler({ engine, canvasEngine, raster: S.raster, segmenter: { classifyRegion: () => 'text' }, prep, post: (m) => out.push(m) });
    await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: new Uint8Array(100 * 60).fill(255), width: 100, height: 60, scale: 1, angle: 0 });
    return out.find((m) => m.type === 'page-done').result;
  };
  const pp = { name: 'ppocr-v5', reads: 0, async load() { return { available: true, reason: '' }; }, async recognise() { this.reads++; return { text: 'printed words here', confidence: 0.9, kind: 'text' }; }, threads: () => 1 };
  const result = await readWith(nullEngine, pp);
  const regs = result.lines.flatMap((l) => l.regions);
  check('tiny boxes: with PP-OCR a box narrower than MIN_READ_ASPECT times its height is not read', pp.reads === 2 && S.core.MIN_READ_ASPECT === 1.2, String(pp.reads));
  check('tiny boxes: they come back as read-as-nothing pieces, which the noise rule discards', regs.length === 4 && regs[1].text === '' && regs[2].text === '' && regs[1].source === 'model' && regs[0].text && regs[3].text && result.timing.tiny === 2, JSON.stringify(regs.map((r) => r.text)));
  check('tiny boxes: the result says where the time went', result.timing.pieces === 4 && result.timing.plans === 1 && result.timing.probes === 1 && result.timing.orient >= 0 && result.timing.read >= 0, JSON.stringify(result.timing));
  const hw = S.mockEngine();
  await readWith(hw, null);
  check('tiny boxes: the handwriting model still reads every box', hw.calls.length === 4, String(hw.calls.length));
}

/** `upright` travels from the pipeline through the client to the worker: a slide with typed text is sent with it. */
async function knownUprightTests() {
  const sent = [];
  const client = {
    onModelProgress: null,
    init: async () => ({ name: 'lines', available: true, reason: '' }),
    initCanvas: async () => ({ name: 'tiles', available: false, reason: '' }),
    readTile: async () => ({ lines: [], engine: null }),
    recognisePage: async (p) => {
      sent.push(p.upright);
      return { pageNumber: p.pageNumber, scale: p.scale, width: p.width, height: p.height, lines: [] };
    },
    cancel() {},
    dispose() {},
  };
  const reader = src('hw', 'canvas-read.js');
  const realOverview = reader.renderOverview;
  const realRelease = reader.release;
  reader.renderOverview = async () => ({ page: {}, rgba: new Uint8ClampedArray(120 * 80 * 4).fill(255), width: 120, height: 80, scale: 1 });
  reader.release = () => {};
  try {
    const mixed = { pageNumber: 1, width: 120, height: 80, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'mixed', mixed: 'image', imageOps: 1 } };
    const bare = { pageNumber: 2, width: 120, height: 80, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', imageOps: 1 } };
    const doc = { numPages: 2, pdfDoc: {}, pages: [mixed, bare], pageCache: new Map([[1, mixed], [2, bare]]) };
    await pipe.ensureRecognised(doc, 1, 2, { client });
    check('upright: a page with typed text is sent as known upright, a picture-only page is not', sent.join() === 'true,false', sent.join());
  } finally {
    reader.renderOverview = realOverview;
    reader.release = realRelease;
  }

  const posted = [];
  const fakeWorker = {
    onmessage: null,
    onerror: null,
    postMessage(m) {
      posted.push(m);
      if (m.type === 'init') Promise.resolve().then(() => fakeWorker.onmessage({ data: { type: 'ready', engine: { name: 'x', available: true } } }));
    },
    terminate() {},
  };
  const c = src('hw', 'hw-client.js').create({ workerFactory: () => fakeWorker });
  c.recognisePage({ pageNumber: 1, gray: new Uint8Array(4), width: 2, height: 2, scale: 1, angle: 0, upright: true }).catch(() => {});
  await new Promise((r) => setTimeout(r, 10));
  c.dispose();
  const pageMsg = posted.find((m) => m.type === 'page');
  check('upright: the client passes it to the worker', !!pageMsg && pageMsg.upright === true && pageMsg.angle === 0);
}

async function availabilityTests() {
  const A = src('hw', 'hw-availability.js');
  const t0 = Date.now();
  const done = await A.settled(1000);
  check('availability: settled() resolves with the finished check', done === A && Date.now() - t0 < 500);
  const realReady = A.ready;
  A.ready = new Promise(() => {}); // a check that never answers
  const t1 = Date.now();
  const late = await A.settled(30);
  A.ready = realReady;
  check('availability: a slow check is not waited for beyond the limit', late === A && Date.now() - t1 < 500);
}

(async () => {
  for (const [name, fn] of [['cache', cacheTests], ['defer', deferTests], ['pipeline', pipelineTests], ['orientation', orientationTests], ['tiny boxes', tinyBoxTests], ['known upright', knownUprightTests], ['availability', availabilityTests]]) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  console.log(`handwriting_reading_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

/**
 * Upright-page fixtures (Node): the page angle estimate (skew-angle.js), turning a bitmap and mapping boxes back
 * (page-turn.js), the orientation check (upright.js), the worker core and the tile reader on a crooked page with boxes in page
 * pixels, which engine the status reports when only PP-OCR is installed, the availability switch
 * (hw-availability.js), the thread count (wasm-threads.js) and a short column beside a long one (columns.js).
 * Run: node tests/handwriting_upright_fixtures.js
 */
const path = require('path');
const S = require('./hw_synth.js');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const skew = src('hw', 'skew-angle.js');
const turn = src('hw', 'page-turn.js');
const upright = src('hw', 'upright.js');
const columns = src('hw', 'columns.js');
const threads = src('hw', 'wasm-threads.js');
const nullEngine = src('hw', 'null-engine.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const ROWS = 10;
/** A level page of `ROWS` text rows; rows[i] is the box of row i. */
function levelPage() {
  const img = S.bitmap(900, 1100);
  const rows = [];
  for (let i = 0; i < ROWS; i++) rows.push(S.wordRow(img, 90, 120 + i * 90, 28, 8 - (i % 3), 62, 18));
  return { img, rows };
}

/** The same page with its lines sloping by `deg`: { gray, width, height, frame } (frame.toFrame maps level -> sloped). */
function slopedPage(deg) {
  const { img, rows } = levelPage();
  const frame = turn.frame(img.width, img.height, -deg);
  const out = turn.rotate({ data: img.gray, w: img.width, h: img.height, ch: 1 }, frame);
  return { gray: out.data, width: out.w, height: out.h, frame, rows };
}

function angleTests() {
  const level = levelPage().img;
  const flat = skew.estimate(level.gray, level.width, level.height);
  check('angle: a level page measures level', Math.abs(flat.angle) < 0.15 && flat.strength >= skew.MIN_STRENGTH, JSON.stringify(flat));
  for (const deg of [-12, -6, -3.2, -1, 2, 6, 10]) {
    const p = slopedPage(deg);
    const got = skew.estimate(p.gray, p.width, p.height);
    check(`angle: lines sloping ${deg} degrees are measured within a quarter degree`, Math.abs(got.angle - deg) < 0.25, JSON.stringify(got));
  }
  const blank = S.bitmap(600, 800);
  const none = skew.estimate(blank.gray, blank.width, blank.height);
  check('angle: an empty page has no angle', none.angle === 0 && none.strength === 0 && none.sideways.strength === 0);
  check('angle: a tiny bitmap is left alone', skew.estimate(new Uint8Array(64), 8, 8).angle === 0);
  // scattered blobs with no lines: nothing may be turned
  const dots = S.bitmap(800, 800);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let i = 0; i < 260; i++) S.rect(dots, 20 + Math.floor(rnd() * 740), 20 + Math.floor(rnd() * 740), 9, 9);
  const scattered = skew.estimate(dots.gray, dots.width, dots.height);
  check('angle: scattered marks with no lines give no angle', scattered.angle === 0, JSON.stringify(scattered));
  const side = slopedPage(90);
  const s = skew.estimate(side.gray, side.width, side.height);
  check('angle: a page on its side is offered as a sideways candidate', s.sideways.strength >= skew.MIN_STRENGTH && Math.abs(s.sideways.angle) < 0.3, JSON.stringify(s));
}

function turnTests() {
  const img = { data: Uint8Array.from({ length: 100 * 60 }, (_, i) => (i * 7) % 251), w: 100, h: 60, ch: 1 };
  const q = turn.frame(100, 60, 90);
  const there = turn.rotate(img, q);
  const back = turn.rotate(there, turn.frame(there.w, there.h, -90));
  check('turn: a quarter turn swaps the sides and loses nothing', q.w === 60 && q.h === 100 && back.w === 100 && back.h === 60 && back.data.every((v, i) => v === img.data[i]));
  const half = turn.rotate(img, turn.frame(100, 60, 180));
  check('turn: a half turn is the pixels in reverse', half.w === 100 && half.h === 60 && half.data.every((v, i) => v === img.data[img.data.length - 1 - i]));
  const f = turn.frame(900, 1100, 7.5);
  const p = f.toFrame(123, 456);
  const r = f.toSource(p.x, p.y);
  check('turn: page -> upright frame -> page is the same point', Math.abs(r.x - 123) < 1e-6 && Math.abs(r.y - 456) < 1e-6);
  check('turn: the upright frame holds the whole turned page', f.w > 900 && f.h > 1100 && f.srcW === 900 && f.srcH === 1100);
  const box = { x: 300, y: 500, w: 400, h: 40 };
  const pageBox = f.boxToSource(box);
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([x, y]) => f.toSource(x, y));
  const holds = corners.every((c) => c.x >= pageBox.x - 1 && c.x <= pageBox.x + pageBox.w + 1 && c.y >= pageBox.y - 1 && c.y <= pageBox.y + pageBox.h + 1);
  check('turn: a box goes back as the page rectangle around all four corners', holds && pageBox.h > box.h && pageBox.x >= 0 && pageBox.y >= 0 && pageBox.x + pageBox.w <= 900 && pageBox.y + pageBox.h <= 1100, JSON.stringify(pageBox));
  const colour = { data: new Uint8ClampedArray(20 * 10 * 4).fill(255), w: 20, h: 10, ch: 4 };
  colour.data.set([10, 20, 30, 255], (5 * 20 + 3) * 4);
  const turned = turn.rotate(colour, turn.frame(20, 10, 180));
  const at = ((10 - 1 - 5) * 20 + (20 - 1 - 3)) * 4;
  check('turn: colour pixels keep their channels and array type', turned.data instanceof Uint8ClampedArray && turned.data[at] === 10 && turned.data[at + 1] === 20 && turned.data[at + 2] === 30);
  check('turn: angles fold into one turn, small ones need no turning', turn.fold(365) === 5 && turn.fold(-190) === 170 && turn.fold(180) === 180 && !turn.needsTurn(0.2) && turn.needsTurn(-0.5) && !turn.needsTurn(undefined));
  // new corners repeat the edge: a dark surround stays dark right into the corner
  const dark = { data: new Uint8Array(40 * 40).fill(30), w: 40, h: 40, ch: 1 };
  const dt = turn.rotate(dark, turn.frame(40, 40, 10));
  check('turn: added corners repeat the edge pixel', dt.data[0] === 30 && dt.data[dt.data.length - 1] === 30);
}

/** Stand-ins for page-prep and a reader: crops remember which way up they are in their first pixel. */
function orientationStubs(confidence, lines = 4) {
  const calls = { plan: 0, read: 0 };
  const plan = () => {
    calls.plan++;
    return { lines: Array.from({ length: lines }, (_, i) => ({ index: i, box: { x: 0, y: i * 20, w: 200 - i, h: 10 }, regions: [{ box: { x: 0, y: i * 20, w: 200 - i, h: 10 } }] })) };
  };
  const crop = (_p, _g, _w, _h, box) => ({ data: Uint8Array.from([1, 0, 0, 2]), w: 2, h: 2, row: box.y / 20 });
  const read = async (c) => {
    calls.read++;
    const flipped = c.data[0] === 2;
    return { text: 'x', confidence: confidence(flipped, calls.read) };
  };
  return { calls, plan, crop, read };
}

async function orientationTests() {
  const page = S.bitmap(60, 60);
  const run = (stubs, extra) => upright.choose(page.gray, 60, 60, Object.assign({ angle: 0, plan: stubs.plan, crop: stubs.crop, read: stubs.read }, extra));
  const good = orientationStubs(() => 0.9);
  const a = await run(good);
  check('orientation: a page that reads well is taken as it is, three reads, all kept for reuse', a.view.angle === 0 && a.view.frame === null && good.calls.read === 3 && good.calls.plan === 1 && a.reads.size === 3);
  const upsideDown = orientationStubs((flipped) => (flipped ? 0.9 : 0.2));
  const b = await run(upsideDown);
  check('orientation: lines that read far better turned over turn the page over', b.view.angle === 180 && upsideDown.calls.plan === 2 && b.reads.size === 0, JSON.stringify([b.view.angle, upsideDown.calls]));
  // read 2 (a line as it is) fails; turned over, every line reads well: one failed line must not flip the page
  const oneBad = orientationStubs((flipped, n) => (flipped ? 0.9 : n === 2 ? 0 : 0.85));
  const c = await run(oneBad);
  check('orientation: one line that failed to read does not turn the page over', c.view.angle === 0 && c.reads.size === 3, JSON.stringify(oneBad.calls));
  const weak = orientationStubs((flipped) => (flipped ? 0.42 : 0.2));
  const d = await run(weak);
  check('orientation: a poor read is not replaced by another poor read', d.view.angle === 0);
  const noReader = orientationStubs(() => 0.9);
  const e = await upright.choose(page.gray, 60, 60, { angle: 5, plan: noReader.plan, crop: noReader.crop });
  check('orientation: without a reader the page is only straightened', e.view.angle === 5 && !!e.view.frame && noReader.calls.read === 0 && e.reads.size === 0);
  const halted = orientationStubs(() => 0.1);
  const f = await run(halted, { stopped: () => halted.calls.read >= 1 });
  check('orientation: a cancel stops the check after the read in flight', halted.calls.read === 1 && f.view.angle === 0 && f.reads.size === 1);
  const skipped = orientationStubs(() => 0.1);
  await run(skipped, { skip: () => true });
  check('orientation: a page that will not be read is not probed', skipped.calls.read === 0);
  const off = upright.planView({ gray: null, width: 100, height: 100, frame: turn.frame(60, 60, 20) }, () => ({ lines: [{ index: 0, box: { x: 0, y: 0, w: 8, h: 4 }, regions: [{ box: { x: 0, y: 0, w: 8, h: 4 } }] }, { index: 1, box: { x: 30, y: 36, w: 20, h: 6 }, regions: [{ box: { x: 30, y: 36, w: 20, h: 6 } }] }] }));
  check('orientation: a piece in a corner the turn added is not on the page', off.lines.length === 1 && off.lines[0].index === 0 && off.lines[0].box.x === 30);
}

async function readPage(engine, canvasEngine, page, angle) {
  const out = [];
  const h = S.core.createHandler({ engine, canvasEngine, raster: S.raster, segmenter: S.segmenter, post: (m) => out.push(m) });
  await h.handle({ type: 'init' });
  await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: page.gray, width: page.width, height: page.height, scale: 1, angle });
  return { ready: out.find((m) => m.type === 'ready').engine, result: (out.find((m) => m.type === 'page-done') || {}).result, out };
}

async function crookedPageTests() {
  const deg = 5;
  const p = slopedPage(deg);
  const { result } = await readPage(S.mockEngine(), null, p);
  const regs = result.lines.flatMap((l) => l.regions);
  check('core: a crooked page is measured and straightened, and says so', Math.abs(result.angle - deg) < 0.3 && result.width === p.width && result.height === p.height, String(result.angle));
  check('core: every row is still found, top to bottom', result.lines.length === ROWS && result.lines.every((l, i) => !i || l.box.y > result.lines[i - 1].box.y), String(result.lines.length));
  // each row's middle, carried onto the crooked page, lies inside the box reported for that row
  const inside = p.rows.every((row, i) => {
    const c = p.frame.toFrame(row.x + row.w / 2, row.y + row.h / 2);
    const b = result.lines[i] && result.lines[i].box;
    return b && c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h;
  });
  check('core: boxes are in the pixels of the page as given', inside, JSON.stringify(result.lines.map((l) => l.box)));
  check('core: boxes stay inside the page', regs.every((r) => r.box.x >= 0 && r.box.y >= 0 && r.box.x + r.box.w <= p.width && r.box.y + r.box.h <= p.height));
  check('core: a piece of a turned page carries its own size beside the page rectangle', regs.every((r) => r.size && r.size.h < r.box.h && r.size.h <= 40 && r.size.w > 100), JSON.stringify(regs[0]));
  const given = await readPage(S.mockEngine(), null, slopedPage(deg), 0);
  check('core: an angle given by the caller is used instead of measuring', given.result.angle === undefined && given.result.lines.flatMap((l) => l.regions).every((r) => !r.size));
  const level = levelPage().img;
  const plain = await readPage(S.mockEngine(), null, level);
  check('core: a level page is read as it is', plain.result.angle === undefined && plain.result.lines.length === ROWS && plain.result.lines.flatMap((l) => l.regions).every((r) => !r.size));
}

const fakePpocr = (available) => ({
  name: 'ppocr-v5', loads: 0, reads: 0,
  async load(onProgress) { this.loads++; if (onProgress) onProgress({ loaded: 3, total: 3, file: 'rec.onnx' }); return { available, reason: available ? '' : 'PP-OCR model files are not installed' }; },
  async recognise() { this.reads++; return { text: 'printed words', confidence: 0.9, kind: 'text', stats: { mean: 0.95, min: 0.9, chars: 13 } }; },
  threads: () => 4,
});

async function engineStatusTests() {
  const page = () => levelPage().img;
  const only = fakePpocr(true);
  const a = await readPage(nullEngine, only, page());
  const regsA = a.result.lines.flatMap((l) => l.regions);
  check('status: PP-OCR alone is the reader that `ready` reports, with no error', a.ready.name === 'ppocr-v5' && a.ready.available === true && a.ready.reason === '' && a.ready.threads === 4, JSON.stringify(a.ready));
  check('status: the page is read by it and says so', a.result.engine === 'ppocr-v5' && regsA.length === ROWS && regsA.every((r) => r.source === 'model' && r.text === 'printed words' && r.stats.engine === 'ppocr'));
  check('status: each piece is read once (the orientation check reuses its reads)', only.reads === ROWS, String(only.reads));
  check('status: PP-OCR loading is reported as model progress', a.out.some((m) => m.type === 'model-progress' && m.file === 'rec.onnx'));
  const b = await readPage(nullEngine, fakePpocr(false), page());
  check('status: nothing installed -> not available, with the page reader named as what is missing', b.ready.available === false && /PP-OCR model files are not installed/.test(b.ready.reason) && b.result.engine === undefined && b.result.lines.flatMap((l) => l.regions).every((r) => r.source === 'manual'), JSON.stringify(b.ready));
  const hw = S.mockEngine();
  const spare = fakePpocr(true);
  const c = await readPage(hw, spare, page());
  check('status: with the handwriting model installed it is the reader reported', c.ready.name === 'mock' && c.ready.available === true && c.result.engine === 'mock' && spare.loads === 0);
  const d = await readPage(nullEngine, null, page());
  check('status: no PP-OCR engine at all -> the handwriting model status stands', d.ready.available === false && d.result.lines.flatMap((l) => l.regions).every((r) => r.source === 'manual'));

  // the pipeline's stats.engine is what the UI notice reads
  const stats = S.newStats();
  const factory = () => {
    stats.created++;
    const w = { onmessage: null, onerror: null, postMessage(msg) { Promise.resolve().then(() => handler.handle(msg)); }, terminate() {} };
    const handler = S.core.createHandler({ engine: nullEngine, canvasEngine: fakePpocr(true), raster: S.raster, segmenter: S.segmenter, post: (m) => { if (w.onmessage) w.onmessage({ data: m }); } });
    return w;
  };
  const pageObj = { pageNumber: 1, width: 900, height: 1100, lines: [], wordCount: 0, ink: { needsRecognition: true } };
  const doc = { numPages: 1, pages: [pageObj], pageCache: new Map([[1, pageObj]]) };
  const client = src('hw', 'hw-client.js').create({ workerFactory: factory });
  const r = await src('hw', 'hw-pipeline.js').ensureRecognised(doc, 1, 1, { client, renderPage: async () => Object.assign(page(), { scale: 1 }) });
  client.dispose();
  check('status: the pipeline reports PP-OCR as the engine that read the page', r.pages === 1 && r.engine && r.engine.name === 'ppocr-v5' && r.engine.available === true && pageObj.ink.recognised === true, JSON.stringify(r));
}

async function availabilityTests() {
  const A = src('hw', 'hw-availability.js');
  const P = globalThis.PDFStudy;
  const settled = await A.ready;
  check('availability: outside a browser the switch is off and nothing throws', P.ENABLE_HANDWRITING === false && settled === A && A.available === false && A.reason.length > 0);
  const asked = [];
  const allThere = await A.check(async (url, init) => { asked.push([url, init.method]); return { ok: true }; }, 'http://127.0.0.1:8765/');
  check('availability: every file there -> available, asked with HEAD on the app origin', allThere.available === true && allThere.reason === '' && asked.length === A.FILES.length && asked.every(([u, m]) => u.startsWith('http://127.0.0.1:8765/vendor/hw/') && m === 'HEAD'));
  let n = 0;
  const missing = await A.check(async (url) => { n++; return { ok: !url.endsWith('det.onnx') }; }, 'http://127.0.0.1:8765/');
  check('availability: a missing file -> off, named in the reason, no further requests', missing.available === false && /det\.onnx is missing/.test(missing.reason) && n === 4, `${n} ${missing.reason}`);
  const offline = await A.check(async () => { throw new TypeError('Failed to fetch'); }, 'http://127.0.0.1:8765/');
  check('availability: a failed request -> off, never rejects', offline.available === false);
  check('availability: the same files the PP-OCR engine checks before loading', JSON.stringify(A.FILES) === JSON.stringify(src('hw', 'engine-ppocr.js').PROBES));
}

/** The tile reader on a crooked page: the angle goes to every tile, boxes come back on the page as given. */
async function crookedTileTests() {
  const reader = src('hw', 'canvas-read.js');
  const planner = src('hw', 'canvas-plan.js');
  const shot = { page: null, scale: 1, width: 1000, height: 800 };
  const survey = { lineHeight: 30, clusters: [{ x: 100, y: 100, w: 800, h: 600 }], grid: null };
  const rect = planner.tiles(survey, shot.width, shot.height)[0];
  const pageFrame = turn.frame(shot.width, shot.height, 5);
  // two stacked lines of the level page, as the worker reports them: page rectangles in tile pixels plus their own size
  const level = [{ x: 200, y: 285, w: 600, h: 30 }, { x: 200, y: 330, w: 600, h: 30 }];
  const asTileLine = (b, text) => {
    const pb = pageFrame.boxToSource(b);
    return { box: { x: (pb.x - rect.x) * rect.zoom, y: (pb.y - rect.y) * rect.zoom, w: pb.w * rect.zoom, h: pb.h * rect.zoom }, size: { w: b.w * rect.zoom, h: b.h * rect.zoom }, text, confidence: 0.9 };
  };
  const jobs = [];
  const client = { readTile: async (job) => { jobs.push(job); return { lines: [asTileLine(level[1], 'second'), asTileLine(level[0], 'first')], engine: { name: 'ppocr-v5', available: true } }; } };
  const renderTile = async (_page, _scale, r) => ({ rgba: new Uint8ClampedArray(4), width: Math.ceil(r.w * r.zoom), height: Math.ceil(r.h * r.zoom) });
  const res = await reader.readPage(shot, survey, { pageNumber: 1, client, renderTile, angle: 5 });
  const regs = res.lines.map((l) => l.regions[0]);
  check('tiles: the page angle is sent with every tile and reported on the result', jobs.length === 1 && jobs[0].angle === 5 && res.angle === 5);
  check('tiles: lines are ordered as they lie on the level page', regs.map((r) => r.text).join() === 'first,second' && res.lines[0].group === res.lines[1].group);
  const want = pageFrame.boxToSource(level[0]);
  const near = (a, b) => Math.abs(a - b) <= 1;
  check('tiles: the box reported is the rectangle on the page as given, with the line\'s own size beside it', near(regs[0].box.x, want.x) && near(regs[0].box.y, want.y) && near(regs[0].box.w, want.w) && near(regs[0].box.h, want.h) && near(regs[0].size.h, 30) && near(regs[0].size.w, 600), JSON.stringify([regs[0].box, want, regs[0].size]));
  const jobs2 = [];
  const plainClient = { readTile: async (job) => { jobs2.push(job); return { lines: [{ box: { x: 10, y: 10, w: 400, h: 40 }, text: 'level', confidence: 0.9 }], engine: { name: 'ppocr-v5', available: true } }; } };
  const flat = await reader.readPage(shot, survey, { pageNumber: 1, client: plainClient, renderTile, angle: 0.1 });
  check('tiles: a level page sends no angle and reports none', !('angle' in jobs2[0]) && flat.angle === undefined && !flat.lines[0].regions[0].size);
}

function threadTests() {
  const nav = (cores) => ({ hardwareConcurrency: cores });
  check('threads: one thread when the page is not cross-origin isolated', threads.count({ crossOriginIsolated: false, navigator: nav(16) }) === 1 && threads.count({ navigator: nav(16) }) === 1);
  check('threads: isolated -> the cores, at most MAX_THREADS', threads.count({ crossOriginIsolated: true, navigator: nav(16) }) === threads.MAX_THREADS && threads.count({ crossOriginIsolated: true, navigator: nav(2) }) === 2);
  check('threads: unknown core count -> one thread', threads.count({ crossOriginIsolated: true, navigator: {} }) === 1 && threads.count({ crossOriginIsolated: true }) === 1);
}

function columnTests() {
  const lineH = 40;
  const box = (x, y, w) => ({ x, y, w, h: lineH });
  // three notes on the left, the longest running into the gap; five on the right
  const left = [box(90, 100, 350), box(90, 220, 520), box(90, 340, 600)];
  const right = [0, 1, 2, 3, 4].map((i) => box(900, 100 + i * 120, 500 + (i % 2) * 40));
  const out = columns.lines([...left, ...right], lineH);
  check('columns: a short column beside a longer one is read first, whole', out.length === 8 && out.slice(0, 3).every((l) => l.box.x === 90) && out.slice(3).every((l) => l.box.x === 900), JSON.stringify(out.map((l) => [l.column, l.box.x, l.box.y])));
  check('columns: each line of the two columns is its own line', out.every((l) => l.regions.length === 1));
  const pairs = columns.lines([box(90, 100, 350), box(900, 100, 500), box(90, 220, 520), box(900, 220, 540)], lineH);
  check('columns: two rows side by side are still read across', pairs.length === 2 && pairs.every((l) => l.regions.length === 2));
}

(async () => {
  angleTests();
  turnTests();
  await orientationTests();
  await crookedPageTests();
  await engineStatusTests();
  await crookedTileTests();
  await availabilityTests();
  threadTests();
  columnTests();
  console.log(`handwriting_upright_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

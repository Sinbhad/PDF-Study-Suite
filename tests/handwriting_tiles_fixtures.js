/**
 * Canvas page fixtures (Node): the survey that tells a page of tiny writing in islands from an ordinary page,
 * the tile plan (size caps, cuts, joining neighbours), reading order of the lines of all tiles, how tile boxes
 * map back to the page, and which reader the pipeline picks. No model and no browser: fake client and renders.
 * Run: node tests/handwriting_tiles_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const raster = src('hw', 'raster.js');
const plan = src('hw', 'canvas-plan.js');
const order = src('hw', 'canvas-order.js');
const reader = src('hw', 'canvas-read.js');
src('pdf', 'ink-detect.js');
src('pdf', 'ocr-lines.js');
const pipe = src('hw', 'hw-pipeline.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const page = (w, h, bg = [255, 255, 255]) => {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([bg[0], bg[1], bg[2], 255], i * 4);
  return { rgba, w, h };
};
function fill(img, x, y, w, h, c) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) img.rgba.set([c[0], c[1], c[2], 255], (yy * img.w + xx) * 4);
}
/** Rows of small separate marks standing in for letters `gh` px tall. */
function writing(img, x, y, w, rows, gh, c) {
  for (let r = 0; r < rows; r++) for (let xx = x; xx + gh < x + w; xx += gh + 2) fill(img, xx, y + r * Math.round(gh * 2.2), gh - 1, gh, c);
}
const BLACK = [20, 20, 20];
const PURPLE = [200, 170, 255];
const ORANGE = [255, 165, 40];

function surveyTests() {
  check('inkGray: pale purple and orange stay dark, highlighter and paper are white',
    Array.from(raster.inkGray(new Uint8Array([200, 170, 255, 255, 255, 165, 40, 255, 255, 250, 150, 255, 255, 255, 255, 255]), 4, 1)).join() === '170,40,255,255');
  check('toGray: luma would wash the pale purple out', raster.toGray(new Uint8Array([200, 170, 255, 255]), 1, 1)[0] > 185);

  const img = page(1200, 900);
  writing(img, 60, 80, 220, 12, 4, BLACK);
  writing(img, 520, 90, 260, 10, 4, PURPLE);
  writing(img, 300, 600, 240, 9, 4, ORANGE);
  fill(img, 60, 76, 220, 12, [255, 252, 150]); // highlighter over the first line...
  writing(img, 60, 80, 220, 1, 4, BLACK); // ...with the writing on top of it
  const sv = plan.survey(img.rgba, img.w, img.h);
  check('survey: tiny writing in islands is a canvas page', sv.dense === true && sv.lineHeight === 6, JSON.stringify({ d: sv.dense, l: sv.lineHeight, g: sv.glyphs }));
  check('survey: three islands, coloured ones included, highlighter ignored', sv.clusters.length === 3 && sv.clusters.every((c) => c.w < 300 && c.h < 130), JSON.stringify(sv.clusters));
  const tl = plan.tiles(sv, img.w, img.h);
  check('tiles: one per island at the zoom that makes lines 40 px', tl.length === 3 && Math.abs(tl[0].zoom - 40 / 6) < 1e-9, JSON.stringify(tl));
  check('tiles: each covers its island with a margin', sv.clusters.every((c) => tl.some((t) => t.x < c.x && t.y < c.y && t.x + t.w > c.x + c.w && t.y + t.h > c.y + c.h)));

  const big = page(1200, 900);
  writing(big, 80, 80, 1000, 9, 30, BLACK);
  const sb = plan.survey(big.rgba, big.w, big.h);
  check('survey: ordinary-size writing is not a canvas page', sb.dense === false && sb.lineHeight === 45, JSON.stringify({ d: sb.dense, l: sb.lineHeight }));
  const photo = page(600, 400, [170, 165, 150]);
  writing(photo, 40, 40, 500, 20, 4, BLACK);
  check('survey: a photo of paper is not a canvas page', plan.survey(photo.rgba, photo.w, photo.h).dense === false);
  const dots = page(1200, 900);
  for (let y = 20; y < 900; y += 20) for (let x = 20; x < 1200; x += 20) fill(dots, x, y, 2, 2, [150, 150, 150]);
  writing(dots, 80, 80, 1000, 9, 30, BLACK);
  check('survey: dotted paper under ordinary writing is not a canvas page', plan.survey(dots.rgba, dots.w, dots.h).dense === false);

  const wall = page(1650, 1275); // one island far too wide for a single enlarged render
  writing(wall, 40, 40, 1560, 60, 4, BLACK);
  const sw = plan.survey(wall.rgba, wall.w, wall.h);
  const tw = plan.tiles(sw, wall.w, wall.h);
  const fits = (list) => list.every((t) => t.w * t.zoom <= plan.MAX_SIDE && t.h * t.zoom <= plan.MAX_SIDE && t.w * t.h * t.zoom * t.zoom <= plan.MAX_PIXELS);
  check('tiles: an oversized island is cut into tiles within the caps', sw.dense && sw.clusters.length === 1 && tw.length >= 3 && fits(tw), `${tw.length} tiles`);
  const gray = raster.inkGray(wall.rgba, wall.w, wall.h);
  let missed = 0;
  for (let y = 0; y < wall.h; y += 3) for (let x = 0; x < wall.w; x += 3) {
    if (gray[y * wall.w + x] < 128 && !tw.some((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)) missed++;
  }
  check('tiles: no ink is left outside the tiles', missed === 0, `${missed} samples`);
  check('tiles: a blind cut overlaps so a line on it is whole in one tile', tw.some((t) => tw.some((u) => u !== t && u.x < t.x + t.w && u.x > t.x)));

  const tall = page(1650, 1275); // too tall, with an empty band 21 px high between two blocks of the same island
  writing(tall, 40, 40, 500, 40, 4, BLACK);
  writing(tall, 40, 416, 500, 40, 4, BLACK);
  const st = plan.survey(tall.rgba, tall.w, tall.h);
  const tt = plan.tiles(st, tall.w, tall.h);
  check('tiles: a cut follows the empty band', st.clusters.length === 1 && tt.length === 2 && fits(tt) && Math.abs(tt[0].y + tt[0].h - 405) < 12 && Math.abs(tt[1].y - 405) < 12, JSON.stringify(tt.map((t) => [t.y, t.h])));
}

const line = (x, y, w, text, confidence = 0.9, h = 6) => ({ box: { x, y, w, h }, text, confidence });

function orderTests() {
  // two topics side by side at the same height, a third below; lines handed over in a scrambled order
  const a = [line(100, 100, 60, 'A title'), line(100, 108, 120, 'A one'), line(100, 116, 110, 'A two'), line(100, 140, 90, 'A2 one'), line(100, 148, 90, 'A2 two')];
  const b = [line(400, 102, 60, 'B title'), line(400, 110, 120, 'B one'), line(400, 118, 110, 'B two')];
  const c = [line(250, 400, 80, 'C title'), line(250, 408, 80, 'C one')];
  const mixed = [b[1], a[3], c[1], a[0], b[0], a[2], c[0], a[4], b[2], a[1]];
  const out = order.arrange(mixed);
  const texts = out.lines.map((l) => l.text).join(' | ');
  check('order: topics are read one after the other, never interleaved', texts === [...a, ...b, ...c].map((l) => l.text).join(' | '), texts);
  check('order: three clusters, four blocks', out.clusters === 3 && out.groups === 4, `${out.clusters} ${out.groups}`);
  check('order: cluster and group count up through the page', out.lines.map((l) => `${l.cluster}${l.group}`).join(' ') === '00 00 00 01 01 12 12 12 23 23');
  const twice = order.arrange([line(100, 100, 120, 'whole line', 0.8), line(104, 101, 110, 'whole lin', 0.5), line(100, 108, 100, 'next')]);
  check('order: the same ink read in two overlapping tiles is kept once', twice.lines.length === 2 && twice.lines[0].text === 'whole line', JSON.stringify(twice.lines.map((l) => l.text)));
  const cols = order.arrange([line(100, 100, 80, 'L1'), line(300, 100, 80, 'R1'), line(100, 108, 80, 'L2'), line(300, 108, 80, 'R2')]);
  check('order: two lists side by side are read list by list', cols.lines.map((l) => l.text).join() === 'L1,L2,R1,R2' && cols.groups === 2, cols.lines.map((l) => l.text).join());
  check('order: nothing in, nothing out', order.arrange([]).lines.length === 0 && order.arrange(null).groups === 0);
}

/** Client stand-in: records calls; the tile reader "reads" one line per tile at a fixed place in tile pixels. */
function fakeClient(opts = {}) {
  const calls = [];
  return {
    calls,
    onModelProgress: null,
    init: async () => { calls.push('init'); return { name: 'lines', available: true, reason: '' }; },
    initCanvas: async () => { calls.push('initCanvas'); return { name: 'tiles', available: opts.tiles !== false, reason: '' }; },
    readTile: async (p) => {
      calls.push('readTile');
      if (opts.abortAt && calls.filter((c) => c === 'readTile').length >= opts.abortAt) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
      return { lines: [{ box: { x: 40, y: 80, w: 400, h: p.lineHeight }, text: `tile ${p.width}x${p.height}`, confidence: 0.9, stats: { mean: 0.9 } }], engine: { name: 'tiles', available: true } };
    },
    recognisePage: async (p) => {
      calls.push(`page:${p.gray[0]}`);
      const result = { pageNumber: p.pageNumber, scale: p.scale, width: p.width, height: p.height, lines: [] };
      if (opts.tooMany) result.skippedReason = 'too-many-regions';
      else result.lines.push({ index: 0, box: { x: 0, y: 0, w: 10, h: 10 }, regions: [{ id: 'p1-l0-r0', kind: 'text', box: { x: 0, y: 0, w: 10, h: 10 }, text: 'a line', confidence: 0.9, source: 'model' }] });
      return result;
    },
    cancel() {},
    dispose() {},
  };
}

async function readTests() {
  const img = page(1200, 900);
  writing(img, 60, 80, 220, 12, 4, BLACK);
  writing(img, 520, 400, 260, 10, 4, PURPLE);
  const sv = plan.survey(img.rgba, img.w, img.h);
  const shot = { page: {}, scale: 2, width: img.w, height: img.h };
  const renderTile = async (_page, _scale, rect) => ({ rgba: new Uint8ClampedArray(4), width: Math.ceil(rect.w * rect.zoom), height: Math.ceil(rect.h * rect.zoom) });
  const progress = [];
  const client = fakeClient();
  const res = await reader.readPage(shot, sv, { pageNumber: 3, client, renderTile, onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
  check('read: one result line per tile, page fields set', res.lines.length === 2 && res.layout === 'canvas' && res.pageNumber === 3 && res.scale === 2 && res.width === 1200 && res.tiles === 2, JSON.stringify(res).slice(0, 200));
  const tl = plan.tiles(sv, img.w, img.h);
  const b = res.lines[0].box;
  check('read: tile boxes are mapped back to overview pixels', Math.abs(b.x - (tl[0].x + 40 / tl[0].zoom)) < 0.06 && Math.abs(b.y - (tl[0].y + 80 / tl[0].zoom)) < 0.06 && Math.abs(b.h - 6) < 0.06, JSON.stringify(b));
  check('read: region ids, cluster and group, progress per tile', res.lines[1].regions[0].id === 'p3-l1-r0' && res.lines[1].cluster === 1 && res.lines[1].group === 1 && progress.join() === '1/2,2/2', progress.join());
  const off = await reader.readPage(shot, sv, { pageNumber: 1, renderTile, client: { readTile: async () => ({ lines: [], engine: { name: 'tiles', available: false } }) } });
  check('read: no tile reader installed -> empty result that says so', off.lines.length === 0 && off.engine.available === false);
  const err = await reader.readPage(shot, sv, { pageNumber: 1, client: fakeClient({ abortAt: 2 }), renderTile }).then(() => null, (e) => e);
  check('read: a cancel keeps the tiles already read', !!err && err.name === 'AbortError' && !!err.partial && err.partial.partial === true && err.partial.lines.length === 1);
}

function docOf(imageOps) {
  const p = { pageNumber: 1, width: 600, height: 450, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', pathOps: 500, imageOps } };
  return { numPages: 1, pdfDoc: {}, pages: [p], pageCache: new Map([[1, p]]) };
}

async function routingTests() {
  const dense = page(1200, 900);
  writing(dense, 60, 80, 220, 12, 4, PURPLE);
  writing(dense, 520, 400, 260, 10, 4, BLACK);
  const plain = page(1200, 900);
  writing(plain, 80, 80, 1000, 9, 30, PURPLE);
  const real = { overview: reader.renderOverview, tile: reader.renderTile, release: reader.release };
  let released = 0;
  reader.release = () => { released++; };
  reader.renderTile = async (_p, _s, rect) => ({ rgba: new Uint8ClampedArray(4), width: Math.ceil(rect.w * rect.zoom), height: Math.ceil(rect.h * rect.zoom) });
  const run = async (img, client, imageOps = 0) => {
    reader.renderOverview = async () => ({ page: {}, rgba: img.rgba.slice(), width: img.w, height: img.h, scale: 2 });
    const doc = docOf(imageOps);
    const out = await pipe.ensureRecognised(doc, 1, 1, { client });
    return { out, page: doc.pageCache.get(1) };
  };
  try {
    const c1 = fakeClient();
    const r1 = await run(dense, c1);
    check('pipeline: a canvas page goes to the tile reader; the line reader is never loaded', c1.calls.join() === 'initCanvas,readTile,readTile' && r1.out.pages === 1 && r1.out.regions === 2, c1.calls.join());
    check('pipeline: canvas result is applied to the page', r1.page.ink.recognised === true && r1.page.ink.result.layout === 'canvas' && r1.out.engine.name === 'tiles' && released === 1);
    const c2 = fakeClient();
    const r2 = await run(plain, c2);
    check('pipeline: an ordinary drawn page goes to the line reader with pen colours kept dark', c2.calls.join() === 'init,page:255' && r2.out.regions === 1 && !r2.page.ink.result.layout, c2.calls.join());
    const c3 = fakeClient({ tooMany: true });
    const r3 = await run(plain, c3, 1);
    check('pipeline: a page with too many pieces is read in tiles instead of being skipped', c3.calls.slice(0, 3).join() === 'init,page:255,initCanvas' && c3.calls.includes('readTile') && r3.page.ink.result.layout === 'canvas', c3.calls.join());
    const c4 = fakeClient({ tiles: false });
    const r4 = await run(dense, c4);
    check('pipeline: without the tile reader a canvas page falls back to the line reader', c4.calls.join() === 'initCanvas,init,page:255' && r4.out.pages === 1 && r4.out.engine.name === 'lines', c4.calls.join());
    const c5 = fakeClient({ tiles: false, tooMany: true });
    const r5 = await run(plain, c5);
    check('pipeline: too many pieces and no tile reader -> the skipped result stands', r5.page.ink.result.skippedReason === 'too-many-regions', c5.calls.join());
    const c6 = fakeClient();
    const doc = docOf(0);
    await pipe.ensureRecognised(doc, 1, 1, { client: c6, renderPage: async () => ({ gray: new Uint8Array(100).fill(255), width: 10, height: 10, scale: 1 }) });
    check('pipeline: a caller-supplied render keeps the plain line path', c6.calls.join() === 'init,page:255', c6.calls.join());
  } finally {
    Object.assign(reader, { renderOverview: real.overview, renderTile: real.tile, release: real.release });
  }
}

(async () => {
  surveyTests();
  orderTests();
  await readTests();
  await routingTests();
  console.log(`handwriting_tiles_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });

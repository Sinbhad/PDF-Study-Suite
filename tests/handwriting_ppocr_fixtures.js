/**
 * PP-OCR engine fixtures (Node): image preparation, DB boxes and line merging, CTC decoding and confidence, the
 * engine's missing-files path and plumbing (fake onnxruntime), the worker's tile / init-canvas / cancel protocol and
 * printed / second-opinion routing (fake engines). When vendor/hw holds the real runtime and models, a last section
 * reads a small image drawn here. Run: node tests/handwriting_ppocr_fixtures.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const src = (...p) => require(path.join(ROOT, 'src', ...p));
src('hw', 'engine-util.js');
const P = src('hw', 'ppocr-prep.js');
const B = src('hw', 'ppocr-boxes.js');
const C = src('hw', 'ppocr-ctc.js');
const E = src('hw', 'engine-ppocr.js');
const core = src('hw', 'hw-worker-core.js');
const S = require('./hw_synth.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps;
const rgbaOf = (w, h, fill) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) d.set(fill, i * 4); return d; };
const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1, score: 0.9 });

function prepTests() {
  const px = new Uint8ClampedArray([250, 240, 120, 255, 20, 20, 20, 255, 200, 160, 240, 255, 0, 0, 0, 0]);
  const n = P.neutralise(px, 4, 1).data;
  check('neutralise: highlighter -> white, black and pale purple ink kept', n[0] === 255 && n[2] === 255 && n[4] === 20 && n[8] === 200 && n[10] === 240, String(n));
  check('neutralise: transparent pixel composited to white', n[12] === 255 && n[15] === 255, String(n.slice(12)));
  const img = { data: new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255, 100, 100, 100, 100, 100, 100, 100, 100]), w: 4, h: 4, ch: 1 };
  const r = P.resize(img, 2, 2).data;
  check('resize: area average when shrinking', near(r[0], 0) && near(r[1], 255) && near(r[2], 100) && near(r[3], 100), String(r));
  const up = P.resize({ data: new Uint8Array([0, 200]), w: 2, h: 1, ch: 1 }, 4, 1).data;
  check('resize: bilinear when enlarging, ends kept', near(up[0], 0) && near(up[3], 200) && up[1] > 0 && up[1] < up[2], String(up));
  const t = P.detTensor({ data: rgbaOf(40, 30, [255, 0, 0, 255]), w: 40, h: 30, ch: 4 });
  const plane = t.W * t.H;
  check('detTensor: padded to multiples of 32', t.W === 64 && t.H === 32 && t.data.length === 3 * plane);
  check('detTensor: BGR order, ImageNet normalised', near(t.data[0], (0 - 0.485) / 0.229) && near(t.data[2 * plane], (1 - 0.406) / 0.225), `${t.data[0]} ${t.data[2 * plane]}`);
  check('detTensor: padding is white', near(t.data[50], (1 - 0.485) / 0.229) && near(t.data[31 * 64 + 1], (1 - 0.485) / 0.229));
  const rt = P.recTensor({ data: new Uint8Array(100 * 20).fill(255), w: 100, h: 20, ch: 1 });
  check('recTensor: height 48, aspect kept, min width 320, zero padding', rt.W === 320 && rt.used === 240 && near(rt.data[0], 1) && rt.data[300] === 0 && rt.data.length === 3 * 48 * 320, `${rt.W} ${rt.used}`);
  check('recTensor: degenerate crop -> null', P.recTensor({ data: new Uint8Array(1), w: 1, h: 1, ch: 1 }) === null);
  const c = P.cropImage({ data: Uint8Array.from({ length: 16 }, (_, i) => i), w: 4, h: 4, ch: 1 }, { x0: 1, y0: 2, x1: 3, y1: 9 });
  check('cropImage: clamped sub-image', c.w === 2 && c.h === 2 && String(Array.from(c.data)) === '9,10,13,14', String(Array.from(c.data)));
}

function boxTests() {
  const w = 60, h = 40;
  const prob = new Float32Array(w * h);
  const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) prob[y * w + x] = v; };
  fill(5, 5, 25, 11, 0.95); fill(30, 5, 50, 11, 0.4); fill(5, 20, 7, 30, 0.99); fill(5, 30, 45, 36, 0.8);
  const comps = B.components(prob, w, h, 0.3);
  check('components: 3 regions (the 2-pixel-wide one dropped), mean probability kept', comps.length === 3 && comps.some((b) => b.x0 === 30 && near(b.score, 0.4)), JSON.stringify(comps));
  const db = B.dbBoxes(prob, w, h);
  check('dbBoxes: low-score region dropped, boxes unclipped and clamped', db.length === 2 && db[0].x0 < 5 && db[0].y0 < 5 && db.every((b) => b.x0 >= 0 && b.x1 <= w && b.y1 <= h), JSON.stringify(db));
  const u = B.unclip({ x0: 10, y0: 10, x1: 110, y1: 20, score: 1 }, 1.6);
  check('unclip: w*h*1.6/(2(w+h)) on every side', near(u.x0, 10 - 1600 / 220) && near(u.y1, 20 + 1600 / 220));
  const twoColour = B.mergeLines([box(300, 102, 700, 138), box(100, 100, 280, 140)]);
  check('mergeLines: black term + coloured definition on one baseline -> one line', twoColour.length === 1 && twoColour[0].x0 === 100 && twoColour[0].x1 === 700, JSON.stringify(twoColour));
  const columns = B.mergeLines([box(100, 100, 400, 140), box(560, 104, 900, 142), box(100, 150, 400, 190), box(560, 152, 900, 190)]);
  check('mergeLines: two columns 4 line heights apart stay apart', columns.length === 4, JSON.stringify(columns));
  check('mergeLines: a heading three times taller is not joined', B.mergeLines([box(100, 100, 300, 220), box(310, 180, 500, 220)]).length === 2);
  check('mergeLines: the next line down is not joined', B.mergeLines([box(100, 100, 300, 140), box(310, 128, 500, 168)]).length === 2);
  const ord = B.order([box(500, 103, 600, 140), box(100, 160, 300, 200), box(100, 100, 300, 138)]);
  check('order: rows top to bottom, each left to right', ord.map((b) => b.x0 + ':' + b.y0).join(' ') === '100:100 500:103 100:160', JSON.stringify(ord));
  const cl = B.clipNeighbours([box(0, 0, 100, 44), box(0, 32, 100, 76), box(200, 30, 300, 40)]);
  check('clipNeighbours: overlapping rows split at the middle, other columns ignored', cl[0].y1 === 38 && cl[1].y0 === 38 && cl[2].y0 === 30, JSON.stringify(cl));
  check('grid: one window when the image fits', B.grid(800, 600, 1600, 128).length === 1);
  const g = B.grid(3000, 1000, 1600, 128);
  check('grid: windows within the cap, overlapping, cores tile the image', g.length === 2 && g.every((t) => t.w <= 1600) && g[0].x + g[0].w > g[1].x && g[0].core.x1 === g[1].core.x0 && g[1].core.x1 === 3000, JSON.stringify(g));
  const own = B.owned([box(10, 10, 50, 30), box(1500, 10, 1590, 30)], g[1]);
  check('owned: window coordinates shifted, centre outside the core dropped', own.length === 1 && own[0].x0 === g[1].x + 1500, JSON.stringify(own));
}

function ctcTests() {
  const vocab = ['<blank>', 'a', 'b', ' '];
  const steps = [[0.1, 0.9, 0, 0], [0.2, 0.8, 0, 0], [0.9, 0.1, 0, 0], [0.1, 0.7, 0.2, 0], [0, 0, 0.1, 0.9], [0, 0.1, 0.6, 0.3]];
  const d = C.decode(Float32Array.from(steps.flat()), 6, 4, vocab);
  check('decode: repeats collapse, a blank separates a repeat', d.text === 'aa b' && d.probs.length === 4 && near(d.probs[0], 0.9) && near(d.probs[3], 0.6), JSON.stringify(d));
  const good = C.lineConfidence(Array(20).fill(0.98), 'Spinosad - Fleas here');
  const unsure = C.lineConfidence([0.9, 0.5, 0.6, 0.7, 0.4, 0.8, 0.5, 0.6], 'Fiproni Hck');
  check('lineConfidence: clean read well above 0.6, unsure read below', good.confidence > 0.85 && unsure.confidence < 0.6, `${good.confidence} ${unsure.confidence}`);
  check('lineConfidence: stats are raw mean, min and count', near(unsure.mean, 0.625) && near(unsure.min, 0.4) && unsure.chars === 8);
  check('lineConfidence: one or two characters held back', C.lineConfidence([1, 1], '42').confidence < 0.6 && C.lineConfidence([1], 'v').confidence < 0.6);
  check('lineConfidence: junk and empty held back', C.lineConfidence(Array(10).fill(0.99), '#.;,-#.;,-').confidence < 0.6 && C.lineConfidence([], '').confidence === 0);
}

/** A fake onnxruntime module: detection marks one text band, recognition spells `word`. */
function fakeOrt(word, vocab) {
  const sess = (kind) => ({ inputNames: ['x'], outputNames: ['y'], async run(feeds) {
    const [, , H, W] = feeds.x.dims;
    if (kind === 'det') { const m = new Float32Array(H * W); for (let y = 10; y < 16; y++) for (let x = 6; x < 60; x++) m[y * W + x] = 0.9; return { y: { data: m, dims: [1, 1, H, W] } }; }
    const T = W / 8; const Cn = vocab.length; const out = new Float32Array(T * Cn);
    for (let t = 0; t < T; t++) { const k = t % 2 === 0 && t / 2 < word.length ? vocab.indexOf(word[t / 2]) : 0; out[t * Cn + k] = 0.97; out[t * Cn + (k ? 0 : 1)] = 0.03; }
    return { y: { data: out, dims: [1, T, Cn] } };
  } });
  return { env: { wasm: {} }, Tensor: function (type, data, dims) { this.data = data; this.dims = dims; }, InferenceSession: { create: async (bytes) => sess(bytes[0] === 1 ? 'det' : 'rec') } };
}

async function engineTests() {
  let imports = 0;
  const absent = E.create({ baseUrl: 'http://localhost/app/', fetchFn: async () => ({ ok: false }), importModule: async () => { imports++; throw new Error('must not be imported'); } });
  const a = await absent.load();
  check('engine: files absent -> available false with a reason, runtime never imported', a.available === false && /not installed/.test(a.reason) && imports === 0, JSON.stringify(a));
  check('engine: load is idempotent', (await absent.load()) === a);
  const r = await absent.recognise({ data: new Uint8Array(400).fill(200), w: 40, h: 10 }, 'text');
  const t = await absent.readTile({ rgba: rgbaOf(20, 20, [255, 255, 255, 255]), width: 20, height: 20 }, { lineHeight: 10 });
  check('engine: not loaded -> empty read, no rejection', r.text === '' && r.confidence === 0 && t.lines.length === 0, JSON.stringify([r, t]));
  const broken = E.create({ baseUrl: 'http://localhost/app/', fetchFn: async () => ({ ok: true }), importModule: async () => ({}) });
  const b = await broken.load();
  check('engine: odd runtime module -> available false, never rejects', b.available === false && b.reason.length > 0, JSON.stringify(b));
  const vocab = ['<blank>', 'H', 'i', 'o', ' '];
  const files = { 'det.onnx': [1], 'rec.onnx': [2] };
  const fetchFn = async (u) => ({ ok: true, json: async () => vocab, arrayBuffer: async () => Uint8Array.from(files[u.split('/').pop()] || [0]).buffer });
  const fake = E.create({ baseUrl: 'http://localhost/app/', fetchFn, importModule: async () => fakeOrt('Hi Ho', vocab) });
  const l = await fake.load();
  const ort = await fake.readTile({ rgba: rgbaOf(200, 100, [255, 255, 255, 255]), width: 200, height: 100 }, { lineHeight: 24 });
  const line = ort.lines[0] || {};
  check('engine (fake runtime): one line read, box back in tile pixels', l.available && ort.lines.length === 1 && line.text === 'Hi Ho' && line.box.x < 6 && line.box.x + line.box.w > 60 && line.box.y < 10, JSON.stringify([l, ort.lines]));
  check('engine (fake runtime): line confidence and stats', line.confidence > 0.6 && line.stats && near(line.stats.mean, 0.97) && line.stats.chars === 5, JSON.stringify(line));
  const rc = await fake.recognise({ data: new Uint8Array(400 * 40).fill(255), w: 400, h: 40 }, 'math');
  check('engine (fake runtime): recognise() contract', rc.text === 'Hi Ho' && rc.kind === 'text' && rc.confidence > 0.6, JSON.stringify(rc));
  let stops = 0;
  const st = await fake.readTile({ rgba: rgbaOf(200, 100, [255, 255, 255, 255]), width: 200, height: 100 }, { lineHeight: 24, shouldStop: () => ++stops > 0 });
  check('engine (fake runtime): shouldStop ends the tile', st.cancelled === true && st.lines.length === 0);
}

const prepStub = (n, printed) => ({
  plan: () => ({ bin: { data: new Uint8Array(1), w: 1, h: 1 }, medH: 2, printed,
    lines: Array.from({ length: n }, (_, i) => ({ index: i, box: { x: 0, y: i * 3, w: 10, h: 2 }, regions: [{ box: { x: 0, y: i * 3, w: 10, h: 2 } }] })) }),
  cropFor: () => ({ data: new Uint8Array(20).fill(200), w: 10, h: 2 }),
});
const fakeEngine = (name, available, read, extra) => Object.assign({ name, calls: 0, loads: 0, async load() { this.loads++; return { available, reason: available ? '' : 'missing' }; },
  async recognise() { this.calls++; return read(this.calls); } }, extra || {});
async function runPage(trocr, canvas, printed, n = 2) {
  const out = [];
  const h = core.createHandler({ engine: trocr, canvasEngine: canvas, raster: S.raster, segmenter: { classifyRegion: () => 'text' }, prep: prepStub(n, printed), post: (m) => out.push(m) });
  await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: new Uint8Array(4), width: 2, height: 2, scale: 1 });
  const done = out.find((m) => m.type === 'page-done');
  return done ? done.result.lines.flatMap((l) => l.regions) : [];
}

async function coreTests() {
  const tileLines = [{ box: { x: 1, y: 2, w: 30, h: 10 }, text: 'Spinosad - Fleas', confidence: 0.9, stats: { mean: 0.95, min: 0.8, chars: 16 } }];
  const pp = (avail, extra) => fakeEngine('ppocr-v5', avail, () => ({ text: 'printed words', confidence: 0.9, kind: 'text', stats: { mean: 0.95, min: 0.9, chars: 13 } }), Object.assign({ async readTile() { return { lines: tileLines }; } }, extra));
  const out = [];
  const canvas = pp(true);
  const trocr = fakeEngine('trocr', true, () => ({ text: 'x', confidence: 0.9 }));
  const h = core.createHandler({ engine: trocr, canvasEngine: canvas, raster: S.raster, segmenter: S.segmenter, post: (m) => out.push(m) });
  await h.handle({ type: 'init-canvas' });
  check('core: init-canvas -> canvas-ready with engine info, handwriting model untouched', out[0].type === 'canvas-ready' && out[0].engine.name === 'ppocr-v5' && out[0].engine.available === true && trocr.loads === 0, JSON.stringify(out));
  await h.handle({ type: 'tile', jobId: 7, pageNumber: 2, rgba: new ArrayBuffer(16), width: 2, height: 2, lineHeight: 40 });
  const td = out[1] || {};
  check('core: tile -> tile-done with the lines and engine info, engine loaded once', td.type === 'tile-done' && td.jobId === 7 && td.lines === tileLines && td.engine.available && canvas.loads === 1, JSON.stringify(td));
  const out2 = [];
  const h2 = core.createHandler({ engine: trocr, canvasEngine: pp(false), raster: S.raster, segmenter: S.segmenter, post: (m) => out2.push(m) });
  await h2.handle({ type: 'tile', jobId: 1, rgba: new Uint8ClampedArray(16), width: 2, height: 2, lineHeight: 40 });
  check('core: PP-OCR not installed -> tile-done with no lines, available false', out2[0].type === 'tile-done' && out2[0].lines.length === 0 && out2[0].engine.available === false, JSON.stringify(out2));
  const out3 = [];
  const h3 = core.createHandler({ engine: trocr, canvasEngine: null, raster: S.raster, segmenter: S.segmenter, post: (m) => out3.push(m) });
  await h3.handle({ type: 'init-canvas' });
  check('core: no canvas engine -> canvas-ready available false', out3[0].engine.available === false && out3[0].engine.reason.length > 0, JSON.stringify(out3));
  const out4 = [];
  let h4 = null;
  const slow = pp(true, { async readTile(t, o) { h4.handle({ type: 'cancel', jobId: 3 }); await new Promise((r) => setTimeout(r, 5)); return { lines: o.shouldStop() ? [] : tileLines, cancelled: o.shouldStop() }; } });
  h4 = core.createHandler({ engine: trocr, canvasEngine: slow, raster: S.raster, segmenter: S.segmenter, post: (m) => out4.push(m) });
  await h4.handle({ type: 'tile', jobId: 3, pageNumber: 4, rgba: new ArrayBuffer(16), width: 2, height: 2, lineHeight: 40 });
  check('core: cancel during a tile -> cancelled, no tile-done', out4.length === 1 && out4[0].type === 'cancelled' && out4[0].jobId === 3 && out4[0].pageNumber === 4, JSON.stringify(out4));
  const out5 = [];
  const h5 = core.createHandler({ engine: trocr, canvasEngine: pp(true, { async readTile() { throw new Error('tile failed'); } }), raster: S.raster, segmenter: S.segmenter, post: (m) => out5.push(m) });
  await h5.handle({ type: 'tile', jobId: 5, rgba: new ArrayBuffer(16), width: 2, height: 2, lineHeight: 40 });
  check('core: tile failure -> error with the message', out5[0].type === 'error' && out5[0].jobId === 5 && /tile failed/.test(out5[0].message), JSON.stringify(out5));

  const t1 = fakeEngine('trocr', true, () => ({ text: 'hand', confidence: 0.9 }));
  const c1 = pp(true);
  const printed = await runPage(t1, c1, true);
  check('route: printed page read by PP-OCR only, marked engine ppocr', t1.calls === 0 && c1.calls === 2 && printed.every((r) => r.text === 'printed words' && r.stats.engine === 'ppocr' && r.source === 'model'), JSON.stringify(printed));
  const t2 = fakeEngine('trocr', true, () => ({ text: 'hand', confidence: 0.9 }));
  const c2 = pp(true);
  const sure = await runPage(t2, c2, false);
  check('route: confident handwriting read -> PP-OCR never loaded or asked', c2.loads === 0 && c2.calls === 0 && sure.every((r) => r.text === 'hand' && !(r.stats && r.stats.engine)), JSON.stringify(sure));
  const t3 = fakeEngine('trocr', true, (n) => ({ text: 'h' + n, confidence: 0.4, stats: { mean: 0.6 } }));
  const answers = [{ text: 'clear', confidence: 0.8, stats: { mean: 0.9 } }, { text: 'vague', confidence: 0.7, stats: { mean: 0.7 } }];
  const c3 = fakeEngine('ppocr-v5', true, (n) => answers[n - 1]);
  const second = await runPage(t3, c3, false);
  check('route: unsure handwriting -> sure PP-OCR read taken, unsure one not', second[0].text === 'clear' && second[0].stats.engine === 'ppocr' && second[1].text === 'h2' && second[1].confidence === 0.4, JSON.stringify(second));
  const t4 = fakeEngine('trocr', false, () => ({ text: 'never', confidence: 1 }));
  const c4 = pp(true);
  const only = await runPage(t4, c4, false);
  check('route: no handwriting model -> PP-OCR reads every piece as model text', t4.calls === 0 && only.length === 2 && only.every((r) => r.text === 'printed words' && r.source === 'model'), JSON.stringify(only));
  const none = await runPage(fakeEngine('trocr', false, () => ({})), pp(false), false);
  check('route: neither engine -> manual regions as before', none.every((r) => r.source === 'manual' && r.text === ''), JSON.stringify(none));
  const many = await runPage(fakeEngine('trocr', false, () => ({})), pp(true), false, core.MAX_REGIONS + 1);
  check('route: too many regions on an ordinary page stays manual', many.length === core.MAX_REGIONS + 1 && many.every((r) => r.source === 'manual'), String(many.length));
}

(async () => {
  const t0 = Date.now();
  for (const [name, fn] of [['prep', prepTests], ['boxes', boxTests], ['ctc', ctcTests], ['engine', engineTests], ['core', coreTests], ['models', require('./hw_ppocr_real.js')]]) {
    try { await fn(check); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  console.log(`info: ${Date.now() - t0} ms`);
  console.log(`handwriting_ppocr_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

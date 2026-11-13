/**
 * Handwriting engine fixtures (Node): crop preparation for the model, loop/junk detection, line confidence,
 * encoder precision selection and the recognise() contract (with a fake library), and how low-confidence
 * pieces are kept out of the page lines that feed summaries, flashcards and quizzes.
 * Run: node tests/handwriting_engine_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const util = src('hw', 'engine-util.js');
const model = src('hw', 'engine-model.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

function gray(w, h, v) { return { data: new Uint8Array(w * h).fill(v), w, h }; }

function prepareTests() {
  const S = util.MODEL_SIDE;
  const p = util.prepareCrop(gray(1000, 60, 0));
  check('prepareCrop: 384x384 Uint8Array', p && p.w === 384 && p.h === 384 && S === 384 && p.data instanceof Uint8Array && p.data.length === 384 * 384);
  const col = (img, y) => img.data[y * 384 + 192];
  check('prepareCrop: thin white margin top and bottom', col(p, 0) === 255 && col(p, 383) === 255 && col(p, 5) === 255, `${col(p, 0)} ${col(p, 5)}`);
  const darkRows = Array.from({ length: 384 }, (_, y) => col(p, y)).filter((v) => v < 30).length;
  check('prepareCrop: no aspect padding, a 1000x60 line fills the height but the margin', darkRows >= 384 * 0.85, `${darkRows} dark rows`);

  const W = 1536;
  const stroke = gray(W, 384, 255);
  for (let y = 0; y < 384; y++) stroke.data[y * W + 801] = 0;
  const s = util.prepareCrop(stroke, { marginFrac: 0 });
  const row = Array.from(s.data.slice(192 * 384, 193 * 384));
  const darkest = Math.min(...row);
  check('prepareCrop: a 1px stroke survives a 4x shrink as gray', darkest > 60 && darkest < 230, `darkest ${darkest}`);
  check('prepareCrop: marginFrac 0 adds nothing', row.filter((v) => v < 255).length <= 2, String(row.filter((v) => v < 255).length));

  const words = gray(1400, 90, 255);
  for (let y = 25; y < 65; y++) for (let x = 60; x < 1340; x++) if ((x * 7 + y * 3) % 23 < 4) words.data[y * 1400 + x] = 20;
  const wp = util.prepareCrop(words);
  const mid = wp.data.filter((v) => v > 0 && v < 255).length;
  check('prepareCrop: soft output, not hard 0/255', mid > 1000, `${mid} in-between pixels`);
  check('prepareCrop: deterministic', util.prepareCrop(words).data.every((v, i) => v === wp.data[i]));
  check('prepareCrop: white stays white', util.prepareCrop(gray(300, 40, 255)).data.every((v) => v === 255));
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) util.prepareCrop(words);
  const ms = Date.now() - t0;
  check('prepareCrop: 200 crops of 1400x90 in under 4 s', ms < 4000, `${ms} ms`);
  console.log(`info: prepareCrop 1400x90 -> 384x384: ${(ms / 200).toFixed(1)} ms per crop`);

  const bad = [null, {}, { data: new Uint8Array(0), w: 0, h: 0 }, gray(1, 50, 0), gray(50, 1, 0), { data: new Uint8Array(10), w: 10, h: 10 }];
  check('prepareCrop: degenerate crops -> null', bad.every((c) => util.prepareCrop(c) === null));
  const tiny = util.prepareCrop({ data: new Uint8Array([0, 255, 255, 0]), w: 2, h: 2 });
  check('prepareCrop: a 2x2 crop still works', tiny && tiny.w === 384 && tiny.data.every((v) => v >= 0 && v <= 255));
}

function loopTests() {
  const looped = ['0 0 0 0', '# # # #', 'a b c d e f', 'the the the the', 'of the of the of the', 'aaaaaaaa', 'abababab',
    '0 0 0 0 0 0 0 0 0 0 0 0', '1 1 1 1.', 'is is is is is is', 'and and, and and and the'];
  const real = ['that that nation', 'we can not dedicate - we can not consecrate - we can not hallow', 'had had', 'very very',
    'we counted 1 2 3 and stopped', '6', 'do this.', 'x = a + b', 'Four score and seven years ago our fathers', '', 'I, a man, said so.'];
  const fp = real.filter((t) => util.looksLooped(t));
  const fn = looped.filter((t) => !util.looksLooped(t));
  check('looksLooped: catches the junk loops', fn.length === 0, JSON.stringify(fn));
  check('looksLooped: leaves real repeats and short lines alone', fp.length === 0, JSON.stringify(fp));
}

function confidenceTests() {
  const lc = util.lineConfidence;
  const many = (n, p) => Array(n).fill(p);
  check('lineConfidence: empty text -> 0', lc(many(5, 0.99), '').confidence === 0);
  const sure = lc(many(20, 0.98), 'A clear and confident line of text.');
  check('lineConfidence: confident line high, stats', sure.confidence > 0.95 && sure.tokens === 20 && Math.abs(sure.mean - 0.98) < 1e-9 && sure.min === 0.98, JSON.stringify(sure));
  const one = lc(many(30, 0.97).concat([0.45]), 'A long and mostly certain line with one unsure word.');
  check('lineConfidence: one unsure token in a long line is not flagged', one.confidence >= 0.6, JSON.stringify(one));
  const weak = lc(many(30, 0.97).concat([0.002]), 'A long line where one word is badly unsure.');
  check('lineConfidence: one very weak token is flagged', weak.confidence < 0.6, JSON.stringify(weak));
  const meh = lc(many(20, 0.76), 'a fluent but unsure line');
  check('lineConfidence: geometric mean under 0.77 is flagged', meh.confidence < 0.6 && lc(many(20, 0.8), 'a fairly sure line').confidence >= 0.6, JSON.stringify(meh));
  const pl = util.proseLike;
  check('proseLike: sentences yes', pl('Definition: A function is continuous at c') && pl('Fallen cold and dead.') && pl("The ship has weather'd every rack,"));
  check('proseLike: formulas and fragments no', !pl('f ( x ) = x 2 + 1') && !pl('x y z a b') && !pl('at c.') && !pl('lim x 0 sin x / x') && !pl('area = one half base times height'));
  const loop = lc(many(12, 0.99), '0 0 0 0 0 0');
  check('lineConfidence: looped text capped at LOOP_CAP', loop.looped && loop.confidence <= util.LOOP_CAP && util.LOOP_CAP <= 0.1, JSON.stringify(loop));
  check('lineConfidence: no probabilities -> text heuristic', lc([], 'The derivative is a limit.').confidence === 0.7 && lc(null, '%%%%%%%%').confidence <= 0.35);
  check('lineConfidence: short legit line keeps its score', lc([0.95, 0.9], '6').confidence > 0.8);
  check('lineConfidence: constants named for re-calibration', util.MIN_WEIGHT >= 0 && util.MIN_WEIGHT < 1 && util.MEAN_POWER >= 1 && util.MARGIN_FRAC > 0 && util.MARGIN_FRAC < 0.1);
}

/** Fake library: records pipeline options and images; each "token" feeds the recorder a logits row with max p. */
function fakeLib(state) {
  class RawImage { constructor(data, w, h, c) { Object.assign(this, { data, width: w, height: h, channels: c }); } }
  const logitsFor = (p) => { const a = Math.log((p * 9) / (1 - p)); return { data: Float32Array.from([a, 0, 0, 0, 0, 0, 0, 0, 0, 0]), dims: [1, 10] }; };
  return {
    env: {}, RawImage,
    pipeline: async (task, id, opts) => {
      state.pipelineArgs = { task, id, opts };
      if (state.failLoad) throw new Error('session failed');
      return async (image, gen) => {
        state.images.push(image);
        state.gen = gen;
        for (const p of state.probs) gen.logits_processor[0]([], logitsFor(p));
        return [{ generated_text: state.text }];
      };
    },
  };
}

async function engineTests() {
  const base = 'http://localhost/app/';
  const all = ['vendor/hw/transformers.min.mjs', 'vendor/hw/models/trocr-small-handwritten/config.json',
    'vendor/hw/models/trocr-small-handwritten/onnx/decoder_model_merged_quantized.onnx'];
  const enc = 'vendor/hw/models/trocr-small-handwritten/onnx/encoder_model.onnx';
  const encQ = 'vendor/hw/models/trocr-small-handwritten/onnx/encoder_model_quantized.onnx';
  const make = (files, extra) => {
    const state = Object.assign({ images: [], probs: [0.97, 0.95, 0.99], text: 'at c .', imports: 0 }, extra);
    const have = new Set(files.map((f) => base + f));
    const eng = model.create({ baseUrl: base, fetchFn: async (u, init) => ({ ok: have.has(u) && init && init.method === 'HEAD' }),
      importModule: async () => { state.imports++; return (state.lib = fakeLib(state)); } });
    return { eng, state };
  };
  const dtypeOf = (s) => s.pipelineArgs && s.pipelineArgs.opts.dtype;

  let { eng, state } = make([...all, enc, encQ]);
  let r = await eng.load();
  check('model: full-precision encoder + 8-bit decoder by default', r.available && r.encoder === 'fp32' && JSON.stringify(dtypeOf(state)) === '{"encoder_model":"fp32","decoder_model_merged":"q8"}', JSON.stringify([r, dtypeOf(state)]));
  const wasm = state.lib.env.backends.onnx.wasm;
  check('model: one WASM thread, local files only', state.pipelineArgs.opts.device === 'wasm' && wasm.numThreads === 1 && state.lib.env.allowRemoteModels === false);
  const rec = await eng.recognise(gray(700, 50, 255), 'text');
  const img = state.images[0];
  check('model: crop reaches the library as 384x384 RGB', img.width === 384 && img.height === 384 && img.channels === 3 && img.data.length === 384 * 384 * 3);
  check('model: max_new_tokens 96 and the recorder attached', state.gen.max_new_tokens === 96 && model.MAX_NEW_TOKENS === 96 && state.gen.logits_processor.length === 1);
  check('model: text with punctuation closed up, confidence and stats', rec.text === 'at c.' && rec.confidence > 0.9 && rec.stats.tokens === 3 && Math.abs(rec.stats.min - 0.95) < 1e-4 && rec.stats.mean > 0.95 && rec.kind === 'text', JSON.stringify(rec));
  const m = await eng.recognise(gray(200, 60, 255), 'math');
  check('model: math capped at 0.3', m.confidence <= 0.3 && m.text === 'at c.', JSON.stringify(m));
  state.text = '0 0 0 0 0 0 0';
  const junk = await eng.recognise(gray(200, 60, 255), 'text');
  check('model: looped junk kept for review but confidence <= 0.1', junk.text === '0 0 0 0 0 0 0' && junk.confidence <= 0.1, JSON.stringify(junk));
  const deg = await eng.recognise(gray(1, 1, 0), 'text');
  check('model: degenerate crop -> empty, no library call', deg.text === '' && deg.confidence === 0 && deg.stats.tokens === 0 && state.images.length === 3);

  ({ eng, state } = make([...all, encQ]));
  r = await eng.load();
  check('model: only the 8-bit encoder (older install) -> all 8-bit', r.available && dtypeOf(state).encoder_model === 'q8' && dtypeOf(state).decoder_model_merged === 'q8', JSON.stringify(dtypeOf(state)));
  ({ eng, state } = make(all));
  r = await eng.load();
  check('model: no encoder file -> not installed, library not imported', !r.available && /not installed/.test(r.reason) && state.imports === 0, JSON.stringify(r));
  ({ eng, state } = make([all[0], all[1], enc]));
  r = await eng.load();
  check('model: no decoder file -> not installed', !r.available && state.imports === 0);
  ({ eng, state } = make([...all, enc], { failLoad: true }));
  r = await eng.load();
  const after = await eng.recognise(gray(100, 30, 0), 'text');
  check('model: load failure -> { available:false, reason }, recognise empty', !r.available && r.reason === 'session failed' && after.text === '' && after.confidence === 0, JSON.stringify(r));
}

function ocrTests() {
  const ocr = src('pdf', 'ocr-lines.js');
  const reg = (id, kind, x, text, confidence) => ({ id, kind, box: { x, y: 0, w: 200, h: 30 }, text, confidence, source: 'model' });
  const result = { pageNumber: 2, scale: 1, width: 600, height: 800, lines: [
    { index: 0, box: { x: 0, y: 0, w: 600, h: 30 }, regions: [reg('p2-l0-r0', 'text', 0, 'Trusted words here', 0.9), reg('p2-l0-r1', 'text', 300, 'garbled bit', 0.4)] },
    { index: 1, box: { x: 0, y: 60, w: 600, h: 30 }, regions: [reg('p2-l1-r0', 'text', 0, 'Whole line unsure', 0.5)] },
    { index: 2, box: { x: 0, y: 120, w: 600, h: 30 }, regions: [reg('p2-l2-r0', 'math', 0, 'x^2', 0.3)] },
  ] };
  const page = { pageNumber: 2, width: 600, height: 800, lines: [], ink: { needsRecognition: true } };
  ocr.applyToPage(page, result);
  check('ocr: unconfirmed low pieces are left out of the page lines', page.lines.length === 1 && page.lines[0].text === 'Trusted words here' && page.wordCount === 3, JSON.stringify(page.lines.map((l) => l.text)));
  check('ocr: low pieces stay in the result for review', ocr.lowConfidence(page).map((r) => r.id).join() === 'p2-l0-r1,p2-l1-r0,p2-l2-r0');
  check('ocr: includeLow returns everything (diagnostics)', ocr.toPageLines(result, page, { includeLow: true }).length === 3);
  ocr.applyCorrection(page, 'p2-l1-r0', 'Whole line unsure'); // "Looks right" ticked: same text, confirmed
  ocr.applyCorrection(page, 'p2-l0-r1', 'fixed bit');
  check('ocr: confirmed and corrected pieces become study text', page.lines.map((l) => l.text).join('|') === 'Trusted words here fixed bit|Whole line unsure' && page.lines.every((l) => !l.ocr.low), JSON.stringify(page.lines.map((l) => l.text)));
  check('ocr: only the unconfirmed math piece is still listed', ocr.lowConfidence(page).length === 1 && ocr.LOW_CONFIDENCE === 0.6);
}

(async () => {
  for (const [name, fn] of [['prepare', prepareTests], ['loop', loopTests], ['confidence', confidenceTests], ['engine', engineTests], ['ocr', ocrTests]]) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  if (!failed) console.log(`[OK] handwriting engine: crop preparation, loop check, confidence, model loading, low-confidence lines`);
  console.log(`handwriting_engine_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

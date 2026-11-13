/**
 * Real PP-OCR models on a small drawn image (used by handwriting_ppocr_fixtures.js). Runs only when vendor/hw holds
 * the onnxruntime-web loader and the PP-OCRv5 files (they are installed by tools/fetch-handwriting-model.py and not
 * kept in git); otherwise it says so and passes.
 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const ROOT = path.join(__dirname, '..');
const HW = path.join(ROOT, 'vendor', 'hw');
const NEEDED = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'models/ppocr-v5/det.onnx', 'models/ppocr-v5/rec.onnx', 'models/ppocr-v5/vocab.json'];

/** 5x7 block capitals: enough letters for the test words. */
const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', C: '01111 10000 10000 10000 10000 10000 01111',
  D: '11110 10001 10001 10001 10001 10001 11110', E: '11111 10000 10000 11110 10000 10000 11111',
  F: '11111 10000 10000 11110 10000 10000 10000', G: '01111 10000 10000 10111 10001 10001 01111',
  I: '01110 00100 00100 00100 00100 00100 01110', K: '10001 10010 10100 11000 10100 10010 10001',
  L: '10000 10000 10000 10000 10000 10000 11111', R: '11110 10001 10001 11110 10100 10010 10001',
  S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  '+': '00000 00100 00100 11111 00100 00100 00000', ' ': '00000 00000 00000 00000 00000 00000 00000',
};

/** Draw `text` in block capitals at (x, y), `cell` pixels per font dot, in colour rgb. */
function draw(img, text, x, y, cell, rgb) {
  for (const ch of text) {
    const rows = FONT[ch].split(' ');
    rows.forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        if (row[c] !== '1') continue;
        for (let yy = 0; yy < cell; yy++) for (let xx = 0; xx < cell; xx++) img.data.set(rgb, ((y + r * cell + yy) * img.w + x + c * cell + xx) * 4);
      }
    });
    x += 6 * cell;
  }
}

function fill(img, x0, y0, x1, y1, rgba) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgba, (y * img.w + x) * 4);
}

const plain = (s) => s.toUpperCase().replace(/[^A-Z+]/g, '');

module.exports = async function realModels(check) {
  const missing = NEEDED.filter((f) => !fs.existsSync(path.join(HW, f)));
  if (missing.length) {
    console.log(`info: real PP-OCR section skipped (not installed: ${missing.join(', ')})`);
    return;
  }
  const E = require(path.join(ROOT, 'src', 'hw', 'engine-ppocr.js'));
  const fetchFn = async (u) => {
    const p = fileURLToPath(u);
    const ok = fs.existsSync(p);
    return { ok, arrayBuffer: async () => fs.readFileSync(p), json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) };
  };
  const eng = E.create({ baseUrl: pathToFileURL(ROOT + path.sep).href, fetchFn, importModule: (u) => import(u) });
  const st = await eng.load();
  check('real: engine loads from vendor/hw', st.available === true, JSON.stringify(st));
  if (!st.available) return;
  const img = { data: new Uint8ClampedArray(900 * 200 * 4).fill(255), w: 900, h: 200 };
  fill(img, 30, 22, 520, 70, [250, 245, 140, 255]); // pale yellow highlighter behind the first line
  draw(img, 'FLEAS + TICKS', 40, 28, 5, [20, 20, 20]); // black
  draw(img, 'GIARDIA', 40, 110, 5, [200, 160, 240]); // pale purple
  draw(img, 'CEDAR', 520, 110, 5, [245, 170, 70]); // orange, a column of its own
  const t0 = Date.now();
  const r = await eng.readTile({ rgba: img.data, width: img.w, height: img.h }, { lineHeight: 35 });
  const ms = Date.now() - t0;
  const texts = r.lines.map((l) => plain(l.text));
  check('real: three lines, the two-column row kept apart, in reading order', r.lines.length === 3 && texts[0] === 'FLEAS+TICKS' && texts[1] === 'GIARDIA' && texts[2] === 'CEDAR', JSON.stringify(r.lines.map((l) => [l.text, l.box])));
  check('real: pale inks read with high confidence', r.lines.length === 3 && r.lines.every((l) => l.confidence >= 0.6), JSON.stringify(r.lines.map((l) => l.confidence)));
  const crop = { data: new Uint8Array(330 * 50).fill(255), w: 330, h: 50 };
  for (let i = 0; i < 330 * 50; i++) { const j = ((110 - 8 + Math.floor(i / 330)) * 900 + 32 + (i % 330)) * 4; crop.data[i] = Math.min(img.data[j], img.data[j + 1], img.data[j + 2]); }
  const rc = await eng.recognise(crop, 'text');
  check('real: recognise() reads a gray line crop', plain(rc.text) === 'GIARDIA' && rc.confidence >= 0.6, JSON.stringify(rc));
  console.log(`info: real PP-OCR tile read in ${ms} ms`);
};

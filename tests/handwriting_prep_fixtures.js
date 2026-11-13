/**
 * Page preparation fixtures (Node): hwPagePrep.plan / cropFor on synthetic handwriting-like pages - borders and dark
 * scan edges, ruled paper, specks, touching lines, word gaps, two columns, very long lines, light-on-dark pages, the
 * soft gray crop contract and the worker core running on the real plan. Run: node tests/handwriting_prep_fixtures.js
 */
const path = require('path');
const hw = (f) => require(path.join(__dirname, '..', 'src', 'hw', f));
const prep = hw('page-prep.js');
const core = hw('hw-worker-core.js');
const raster = hw('raster.js');
const segmenter = hw('segmenter.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const W = 1200;
const H = 1500;
function page(bg = 245) { return { g: new Uint8Array(W * H).fill(bg), w: W, h: H }; }
function rect(p, x, y, w, h, v) {
  for (let j = Math.max(0, y); j < Math.min(p.h, y + h); j++) for (let i = Math.max(0, x); i < Math.min(p.w, x + w); i++) p.g[j * p.w + i] = v;
}
/** Handwriting-like word: upright strokes on an x-height, some ascenders/descenders, joined along the baseline. */
function word(p, x, y, len, ink = 40, xh = 18, plain = false) {
  for (let k = 0; k * 9 < len; k++) {
    const sx = x + k * 9;
    const tall = !plain && k % 4 === 1 ? 14 : 0;
    const tail = !plain && k % 5 === 3 ? 12 : 0;
    rect(p, sx, y - tall, 3, xh + tall + tail, ink);
    rect(p, sx, y + xh - 3, Math.min(9, x + len - sx), 3, ink);
  }
  return len;
}
/** One text line of words separated by `gap` px, starting at x; returns the right edge. */
function line(p, x, y, words, gap = 16, ink = 40, xh = 18, plain = false) {
  let cx = x;
  for (const len of words) { word(p, cx, y, len, ink, xh, plain); cx += len + gap; }
  return cx - gap;
}
/** Box blur (3x3): soft anti-aliased stroke edges like a real render. */
function soften(p) {
  const out = p.g.slice();
  for (let y = 1; y < p.h - 1; y++) {
    for (let x = 1; x < p.w - 1; x++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += p.g[(y + dy) * p.w + x + dx];
      out[y * p.w + x] = Math.round(s / 9);
    }
  }
  p.g = out;
  return p;
}
const WORDS = [90, 60, 120, 75, 100, 55, 110, 80, 95];
const TOPS = [200, 290, 380, 470, 560, 650];
function textPage(bg) {
  const p = page(bg);
  TOPS.forEach((y) => line(p, 150, y, WORDS));
  return p;
}
const plan = (p) => prep.plan(p.g, p.w, p.h);
const regionsOf = (pl) => pl.lines.flatMap((l) => l.regions);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. Contract: shape, reading order, indices, integer boxes
const tidy = soften(textPage(250));
const tp = plan(tidy);
check('plan: returns bin, lines, medH, inverted', tp.bin && tp.bin.data && Array.isArray(tp.lines) && tp.medH > 0 && tp.inverted === false, Object.keys(tp).join());
check('plan: one line per written line, top to bottom', tp.lines.length === TOPS.length && tp.lines.every((l, i) => l.index === i && near(l.box.y, TOPS[i] - 14, 6)), JSON.stringify(tp.lines.map((l) => l.box)));
check('plan: a full-width line with normal word gaps is ONE region', tp.lines.every((l) => l.regions.length === 1), JSON.stringify(tp.lines.map((l) => l.regions.length)));
const intBox = (b) => [b.x, b.y, b.w, b.h].every(Number.isInteger) && b.w > 0 && b.h > 0;
check('plan: integer boxes, regions inside their line', tp.lines.every((l) => intBox(l.box) && l.regions.every((r) => intBox(r.box) && r.box.x >= l.box.x && r.box.y >= l.box.y && r.box.x + r.box.w <= l.box.x + l.box.w && r.box.y + r.box.h <= l.box.y + l.box.h)));

// 2. Soft gray crops
const crop = prep.cropFor(tp, tidy.g, W, H, tp.lines[0].regions[0].box);
const levels = new Set(crop.data);
const sorted = Array.from(crop.data).sort((a, b) => a - b);
check('cropFor: { data, w, h } of the padded box', crop.data instanceof Uint8Array && crop.data.length === crop.w * crop.h && crop.w > tp.lines[0].regions[0].box.w && crop.h > tp.lines[0].regions[0].box.h);
check('cropFor: soft gray, never a 1-bit image', levels.size > 8 && sorted.some((v) => v > 30 && v < 220), `levels ${levels.size}`);
check('cropFor: background white, ink dark', sorted[sorted.length >> 1] >= 245 && sorted[0] <= 60, `median ${sorted[sorted.length >> 1]} min ${sorted[0]}`);
const faint = soften(textPage(250));
for (let i = 0; i < faint.g.length; i++) faint.g[i] = 250 - Math.round((250 - faint.g[i]) * 0.3); // pencil: ink ~180
const fp = plan(faint);
const fc = prep.cropFor(fp, faint.g, W, H, fp.lines[0].regions[0].box);
check('cropFor: faint pencil is darkened, not thresholded', fp.lines.length === TOPS.length && Math.min(...fc.data) <= 100 && new Set(fc.data).size >= 5, `lines ${fp.lines.length} min ${Math.min(...fc.data)} levels ${new Set(fc.data).size}`);

// 3. Page border, dark scan edge, shading
const photo = textPage(235);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) photo.g[y * W + x] = Math.max(0, photo.g[y * W + x] - Math.round((x / W) * 60)); // light falls off
rect(photo, 0, 0, 45, H, 25); // dark scan edge
rect(photo, 70, 60, W - 140, 4, 30); rect(photo, 70, H - 64, W - 140, 4, 30); // printed frame
rect(photo, 70, 60, 4, H - 120, 30); rect(photo, W - 74, 60, 4, H - 120, 30);
soften(photo);
const pp = plan(photo);
check('photo: border, frame and dark edge dropped, every line found', pp.lines.length === TOPS.length, JSON.stringify(pp.lines.map((l) => l.box)));
check('photo: no box reaches the edge or the frame', regionsOf(pp).every((r) => r.box.x > 80 && r.box.x + r.box.w < W - 80), JSON.stringify(regionsOf(pp).map((r) => r.box)));

// 4. Ruled paper: faint and darker rules under the baselines, text survives
const ruled = textPage(250);
for (let y = 150; y < H - 100; y += 90) rect(ruled, 0, y, W, 2, y < 500 ? 200 : 150);
TOPS.forEach((y) => rect(ruled, 0, y + 18, W, 2, 170)); // rules touching the baselines
soften(ruled);
const rp = plan(ruled);
check('ruled: rules are not lines, one box per written line', rp.lines.length === TOPS.length && rp.lines.every((l) => l.regions.length === 1), JSON.stringify(rp.lines.map((l) => l.box)));
const strokeInk = (pl, y) => { let n = 0; for (let yy = y - 14; yy < y + 16; yy++) for (let x = 150; x < 1100; x++) n += pl.bin.data[yy * W + x]; return n; };
check('ruled: text strokes survive the rule removal', TOPS.every((y) => strokeInk(rp, y) >= 0.7 * strokeInk(tp, y)), TOPS.map((y) => `${strokeInk(rp, y)}/${strokeInk(tp, y)}`).join(' '));
const rc = prep.cropFor(rp, ruled.g, W, H, rp.lines[2].regions[0].box);
let ruleDark = 0;
for (let x = 0; x < rc.w; x++) if (rc.data[(rc.h - 6) * rc.w + x] < 200) ruleDark++;
check('ruled: the crop shows no rule line', ruleDark < rc.w * 0.2, `${ruleDark}/${rc.w}`);

// 5. Specks and stray marks go; a genuine short line stays
const specky = textPage(250);
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
for (let k = 0; k < 120; k++) rect(specky, rnd(W - 4), 760 + rnd(H - 800), 2, 2, 60);
rect(specky, 40, 1000, 7, 6, 50); // a lone mark in the margin
rect(specky, 40, 1110, 26, 3, 40); rect(specky, 51, 1099, 3, 26, 40); // a "+" in the margin
line(specky, 150, 740, [70, 40]); // "do this."
soften(specky);
const sp = plan(specky);
check('specks and a margin cross: filtered, the short line survives as its own line', sp.lines.length === TOPS.length + 1 && near(sp.lines[TOPS.length].box.y, 726, 8), JSON.stringify(sp.lines.map((l) => l.box)));

// 6. Three touching lines (descenders reach into the next line, no empty row between) are cut into three
const touch = page(250);
[300, 334, 368].forEach((y, r) => {
  line(touch, 150, y, WORDS);
  for (let x = 160; x < 1000; x += 37) rect(touch, x, y + 15, 3, 22, 40); // tails into the next line
  if (r === 2) return;
});
soften(touch);
const tq = plan(touch);
check('touching: a 3-line block is re-split into 3 lines', tq.lines.length === 3 && tq.lines.every((l) => l.box.h < 70), JSON.stringify(tq.lines.map((l) => l.box)));

// 7. Two columns stay two regions; a very long line is read in two halves
const cols = page(250);
TOPS.forEach((y) => { line(cols, 60, y, [90, 60, 100]); line(cols, 760, y, [80, 70, 90]); });
const longWords = [];
for (let s = 0; s < 1060; s += 66) longWords.push(50);
line(cols, 40, 800, longWords, 16, 40, 18, true);
soften(cols);
const cp = plan(cols);
check('columns: a wide gap gives two regions in one line', cp.lines.length === TOPS.length + 1 && cp.lines.slice(0, -1).every((l) => l.regions.length === 2) && cp.lines[0].regions[0].box.x < cp.lines[0].regions[1].box.x, JSON.stringify(cp.lines.map((l) => l.regions.map((r) => r.box))));
const longLine = cp.lines[cp.lines.length - 1];
check('long line: width:height above ~28 is split at word gaps', longLine.regions.length >= 2 && longLine.regions.every((r) => r.box.w / r.box.h <= 28), JSON.stringify(longLine.regions.map((r) => r.box)));

// 8. Light ink on a dark screen
const dark = soften(textPage(250));
for (let i = 0; i < dark.g.length; i++) dark.g[i] = 255 - dark.g[i];
const dp = plan(dark);
check('dark page: detected as inverted, lines found', dp.inverted === true && dp.lines.length === TOPS.length, `${dp.inverted} ${dp.lines.length}`);
const dc = prep.cropFor(dp, dark.g, W, H, dp.lines[1].regions[0].box);
const ds = Array.from(dc.data).sort((a, b) => a - b);
check('dark page: crops are dark ink on white', ds[ds.length >> 1] >= 245 && ds[0] <= 60, `median ${ds[ds.length >> 1]} min ${ds[0]}`);

// 9. A blank page plans nothing
check('blank page: no lines', plan(page(250)).lines.length === 0);

// 10. Two sloped lines with no empty row between them: two boxes, each crop holding only its own line's ink
// (the straight lines above are shifted sideways so their strokes do not stack into columns)
const shifted = () => { const p = page(250); TOPS.forEach((y, i) => line(p, 150 + 23 * i, y, WORDS)); return p; };
const slope = shifted();
const slopeY = (x, y0) => y0 + Math.round(0.08 * (x - 150));
const starts = [];
for (const y0 of [820, 870]) { let cx = 150; for (const len of WORDS) { starts.push(cx); word(slope, cx, slopeY(cx, y0), len); cx += len + 16; } }
soften(slope);
const slp = plan(slope);
const pair = slp.lines.slice(TOPS.length);
// inside a word the upper line's ink ends 30 px under its x-height top and the lower line's starts 36 px under it
const inkOf = (l, upper) => {
  const b = l.regions[0].box;
  const c = prep.cropFor(slp, slope.g, W, H, b);
  const pad = Math.max(3, Math.round(b.h * 0.15));
  const r = { own: 0, stray: 0 };
  for (let y = 0; y < c.h; y++) {
    for (let x = 0; x < c.w; x++) {
      if (c.data[y * c.w + x] > 128) continue;
      const px = Math.max(0, b.x - pad) + x;
      const sx = Math.max(150, ...starts.filter((s) => s <= px));
      const lower = Math.max(0, b.y - pad) + y >= slopeY(sx, 820) + 33;
      if (lower === upper) r.stray++; else r.own++;
    }
  }
  return r;
};
const inks = pair.length === 2 ? [inkOf(pair[0], true), inkOf(pair[1], false)] : [];
check('sloped: two touching sloped lines give two boxes', pair.length === 2 && pair.every((l) => l.regions.length === 1), JSON.stringify(slp.lines.map((l) => l.box)));
check('sloped: each crop holds only its own line', inks.length === 2 && inks.every((k) => k.own > 2000 && k.stray <= 0.02 * k.own), JSON.stringify(inks));

// 11. Labels scattered at staggered heights with wide gaps (no empty row or column between them): one region each
const labels = shifted();
[[60, 900, 120], [330, 870, 60], [540, 935, 120], [810, 880, 60], [1020, 920, 110]].forEach(([x, y, len]) => line(labels, x, y, [len]));
soften(labels);
const lab = regionsOf(plan(labels)).filter((r) => r.box.y > 760);
check('labels: staggered labels far apart are separate regions', lab.length === 5 && lab.every((r) => r.box.w < 150), JSON.stringify(lab.map((r) => r.box)));

// 12. One line with tall capitals (crossbars high above the x-height) is not cut in two
const caps = shifted();
let capX = 150;
WORDS.forEach((len, k) => {
  if (k % 3 === 0) { // a slanted stem (a straight one would pass for a ruled margin) under a crossbar
    for (let t = 0; t < 110; t++) rect(caps, capX + (t >> 3), 870 - t, 4, 1, 40);
    rect(caps, capX - 4, 870 - 112, 30, 4, 40);
  }
  capX += word(caps, capX, 870, len) + 16;
});
soften(caps);
const cl = plan(caps).lines.slice(TOPS.length);
check('capitals: a single line with tall capitals stays one line', cl.length === 1 && cl[0].regions.length === 1 && cl[0].box.h > 120, JSON.stringify(cl.map((l) => l.box)));

// 13. The worker core reads exactly the plan, with cropFor crops
(async () => {
  const seen = [];
  const engine = { name: 'mock', load: async () => ({ available: true }), recognise: async (c) => { seen.push(c); return { text: 'word', confidence: 0.9 }; } };
  const out = [];
  const h = core.createHandler({ engine, post: (m) => out.push(m), raster, segmenter });
  await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: photo.g, width: W, height: H, scale: 1 });
  const done = out.find((m) => m.type === 'page-done');
  check('worker core: page-done with the planned lines', !!done && done.result.lines.length === pp.lines.length && done.result.lines.every((l, i) => JSON.stringify(l.box) === JSON.stringify(pp.lines[i].box)), out.map((m) => m.type).join());
  check('worker core: every crop is soft gray dark-on-white', seen.length === regionsOf(pp).length && seen.every((c) => new Set(c.data).size > 8 && Math.min(...c.data) <= 80), String(seen.length));
  console.log(`handwriting_prep_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

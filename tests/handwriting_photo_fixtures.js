/**
 * Photo / scan clean-up fixtures (Node): page polarity and illumination flattening, thresholds, rule / gutter /
 * speck removal, hysteresis, valley line cuts and soft crop normalisation. Synthetic bitmaps only.
 * Run: node tests/handwriting_photo_fixtures.js
 */
const path = require('path');
const hw = (f) => require(path.join(__dirname, '..', 'src', 'hw', f));
const flatten = hw('page-flatten.js');
const clean = hw('clean.js');
const rules = hw('rule-strip.js');
const split = hw('line-split.js');
const prep = hw('page-prep.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const W = 600;
const H = 900;
const ROWS = [120, 180, 240, 300]; // top of each text row; rows are 30 px tall, 60 px apart
function rect(g, x, y, w, h, v, gw = W) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j * gw + i] = v; }
const ink = (b, x0, y0, x1, y1) => { let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) n += b.data[y * b.w + x]; return n; };

/** A "photo": noisy paper under a light gradient, a faint rule, a dark desk corner, a page edge and 4 touching rows. */
function photoPage() {
  const g = new Uint8Array(W * H);
  let seed = 12345;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      g[y * W + x] = 150 + Math.round((x / W) * 60) + ((seed >> 16) % 13) - 6; // 144..216, brighter to the right
    }
  }
  rect(g, 0, 700, 220, 200, 35); // desk corner
  rect(g, 560, 20, 3, 640, 60); // page edge
  for (let y = 400; y < 402; y++) for (let x = 20; x < 540; x++) g[y * W + x] -= 9; // faint ruled line
  ROWS.forEach((y, r) => {
    for (let k = 0; k < 6; k++) {
      const x = 60 + k * 75;
      for (const dx of [0, 12, 24, 36, 46]) rect(g, x + dx, y, 4, 30, 50); // a word: five pen strokes...
      rect(g, x, y + 26, 50, 4, 50); // ...joined along the baseline
      if (r < ROWS.length - 1 && k % 2 === 0) rect(g, x + 10, y + 30, 4, 20, 50); // tail reaching down
      if (r > 0 && k % 2 === 1) rect(g, x + 30, y - 18, 4, 18, 50); // ascender reaching up
    }
  });
  return g;
}

// 1. Polarity and flattening
const photo = photoPage();
const { flat, inverted } = flatten.flatten(photo, W, H);
check('flatten: paper is white on the dim and the bright side', !inverted && flat[500 * W + 300] >= 240 && flat[500 * W + 30] >= 240 && flat[500 * W + 540] >= 240, `${flat[500 * W + 30]} ${flat[500 * W + 540]}`);
check('flatten: strokes stay dark on both sides', flat[130 * W + 61] < 140 && flat[130 * W + 436] < 140, `${flat[130 * W + 61]} ${flat[130 * W + 436]}`);
check('flatten: a dark area touching the page edge becomes paper', flat[850 * W + 100] === 255 && flat[702 * W + 5] === 255, `${flat[850 * W + 100]}`);
const night = photo.map((v) => 255 - v);
check('isDarkPage: light ink on a dark page is detected, a paper page is not', flatten.isDarkPage(night) && !flatten.isDarkPage(photo));
const thr = flatten.inkThreshold(flat, false);
const weak = flatten.weakThreshold(flat, thr);
check('thresholds: strong in a sane band, weak a little above', thr >= 110 && thr <= 215 && weak >= thr && weak <= 225, `${thr} ${weak}`);

// 2. Ink mask: words kept, page edge / desk / rule gone, rows not merged by noise
const mask = clean.inkMask(flat, W, H, thr, weak);
const bin = mask.bin;
check('inkMask: words are ink, page edge and rule are not', bin.data[130 * W + 61] === 1 && ink(bin, 556, 20, 566, 660) === 0 && ink(bin, 20, 400, 540, 402) === 0, `${ink(bin, 556, 20, 566, 660)} ${ink(bin, 20, 400, 540, 402)}`);
check('inkMask: paper grain stays out', ink(bin, 0, 450, W, 690) < 50, String(ink(bin, 0, 450, W, 690)));

// 3. Rules: a long thin rule is erased, a stroke crossing it keeps its pixels
const rg = new Uint8Array(W * H).fill(250);
rect(rg, 0, 100, W, 3, 120);
rect(rg, 300, 80, 4, 40, 40); // upright stroke through the rule
const rb = clean.threshold(rg, W, H, 200);
rules.stripRules(rb, W / 1650);
check('stripRules: the rule goes, the crossing stroke stays whole', ink(rb, 0, 100, 290, 103) === 0 && ink(rb, 300, 80, 304, 120) === 160, `${ink(rb, 0, 100, 290, 103)} ${ink(rb, 300, 80, 304, 120)}`);
const dg = new Uint8Array(W * H).fill(250);
for (let y = 20; y < H - 20; y += 40) rect(dg, 520, y, 3, 28, 40); // dashed margin rule
rect(dg, 60, 300, 200, 30, 40);
const db = clean.threshold(dg, W, H, 200);
rules.stripRules(db, W / 1650);
check('stripRules: a dashed vertical rule goes, writing beside it stays', ink(db, 515, 0, 528, H) === 0 && ink(db, 60, 300, 260, 330) === 6000, String(ink(db, 515, 0, 528, H)));

// 4. Gutter bands, specks, hysteresis
const gg = new Uint8Array(W * H).fill(250);
for (let y = 0; y < H; y++) for (let x = 540; x < 580; x++) if ((x * 7 + y * 3) % 11 < 7) gg[y * W + x] = 60; // streaky gutter
for (let x = 548; x < 572; x += 6) rect(gg, x, 0, 2, H, 50);
ROWS.forEach((y) => rect(gg, 60, y, 300, 4, 40));
ROWS.forEach((y) => { for (let x = 60; x < 360; x += 10) rect(gg, x, y, 3, 30, 40); });
rect(gg, 200, 600, 2, 2, 40); // isolated speck
rect(gg, 100, ROWS[0] - 9, 3, 3, 40); // i-dot just above a word
rect(gg, 400, 700, 30, 3, 200); // faint stroke with no dark core
const gm = clean.inkMask(gg, W, H, 160, 215);
check('inkMask: a streaky gutter along the page is blanked', ink(gm.bin, 535, 0, 585, H) === 0, String(ink(gm.bin, 535, 0, 585, H)));
check('inkMask: writing beside the gutter stays', ink(gm.bin, 60, ROWS[0], 360, ROWS[0] + 30) > 1000);
check('inkMask: isolated speck dropped, i-dot near a word kept', ink(gm.bin, 198, 598, 204, 604) === 0 && ink(gm.bin, 100, ROWS[0] - 9, 103, ROWS[0] - 6) === 9);
check('inkMask: faint marks with no dark core are not ink (hysteresis)', ink(gm.bin, 400, 700, 430, 703) === 0);

// 5. Line cuts
const prof = new Float64Array(600);
for (let i = 0; i < 600; i++) prof[i] = i % 60 < 30 ? 100 : 5;
check('linePitch finds the row spacing, 0 for a flat profile', Math.abs(split.linePitch(prof, 12, 200) - 60) <= 2 && split.linePitch(new Float64Array(300).fill(7), 12, 100) === 0, String(split.linePitch(prof, 12, 200)));
const two = new Float64Array(80);
for (let i = 0; i < 80; i++) two[i] = i < 36 || i > 44 ? 50 : 4;
check('valley: cut between two touching lines, none in a single line', Math.abs(split.valley(two, 40) - 40) <= 4 && split.valley(new Float64Array(50).fill(30), 40) === -1, String(split.valley(two, 40)));
const lonely = new Float64Array(80);
for (let i = 0; i < 80; i++) lonely[i] = i < 60 ? 50 : i > 66 ? 2 : 0.5;
check('valley: a lone descender row is not cut off as a line', split.valley(lonely, 40) === -1, String(split.valley(lonely, 40)));
const lv = split.leaves(bin, 60, { lineH: 40 });
check('leaves: the 4 touching photo rows come out as 4 leaves', lv.length === ROWS.length && lv.every((b, i) => Math.abs(b.y - ROWS[i]) <= 20), JSON.stringify(lv));
const fr = { data: new Uint8Array(300 * 200), w: 300, h: 200 };
rect(fr.data, 110, 80, 40, 16, 1, 300); rect(fr.data, 100, 99, 60, 2, 1, 300); rect(fr.data, 110, 104, 40, 16, 1, 300);
check('leaves: a fraction stays one leaf', split.leaves(fr, 24).length === 1, JSON.stringify(split.leaves(fr, 24)));

// 6. The plan on the photo page and soft crops
const pl = prep.plan(photo, W, H);
check('plan: photo page gives one line per row', pl.lines.length === ROWS.length && pl.lines.every((l, i) => Math.abs(l.box.y - ROWS[i]) <= 22), JSON.stringify(pl.lines.map((l) => l.box)));
const faint = { data: new Uint8Array(400).fill(240), w: 20, h: 20 };
for (let i = 100; i < 160; i++) faint.data[i] = 180 + (i % 3) * 10;
const soft = clean.normaliseCrop(faint, false);
check('normaliseCrop: faint ink darkened by a gain, paper stays white, gray levels kept', soft.data[0] === 255 && soft.data[100] < 120 && new Set(soft.data).size >= 3, Array.from(new Set(soft.data)).join());
const chalk = { data: new Uint8Array(400).fill(15), w: 20, h: 20 };
for (let i = 100; i < 160; i++) chalk.data[i] = 240;
const flipped = clean.normaliseCrop(chalk, true);
check('normaliseCrop: light-on-dark becomes dark-on-light', flipped.data[0] === 255 && flipped.data[120] < 40, `${flipped.data[0]} ${flipped.data[120]}`);
const crisp = { data: new Uint8Array(400).fill(255), w: 20, h: 20 };
for (let i = 100; i < 160; i++) crisp.data[i] = 10 + (i % 5) * 30;
const kept = clean.normaliseCrop(crisp, false);
check('normaliseCrop: crisp ink keeps its levels (no blow-out)', kept.data.slice(100, 160).every((v, i) => v === crisp.data[100 + i]), Array.from(kept.data.slice(100, 106)).join());
const prepared = clean.prepare(photo, W, H);
check('prepare(): flattened, cleaned page mask with polarity', prepared.mode === 'flattened' && prepared.inverted === false && prepared.data[130 * W + 61] === 1);

console.log(`handwriting_photo_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

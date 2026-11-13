/**
 * Print and column fixtures (Node): typeset print versus handwriting (print-detect.js), printed letterheads on a
 * handwritten page, scanned book pages, reading order of two-column pages (columns.js), the larger piece limit
 * for printed pages in the worker core, short plain lines versus math, and bullets read as "#".
 * Run: node tests/handwriting_print_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const pd = src('hw', 'print-detect.js');
const cols = src('hw', 'columns.js');
const prep = src('hw', 'page-prep.js');
const core = src('hw', 'hw-worker-core.js');
const util = src('hw', 'engine-util.js');
const ocr = src('pdf', 'ocr-lines.js');
const { mockEngine } = require('./hw_synth.js');

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// ---- strokes: one entry per connected stroke, as clean.js reports them ----
/** A row of separate letters on a straight (optionally sloped) baseline; every third one is an ascender. */
function printedRow(x, base, n, xh, slope = 0) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const x0 = x + k * Math.round(xh * 0.9);
    const y1 = Math.round(base + slope * (x0 - x));
    const tall = k % 3 === 0;
    out.push({ x0, x1: x0 + Math.round(xh * 0.6), y0: y1 - (tall ? Math.round(xh * 1.45) : xh), y1, keep: true });
  }
  return out;
}
/** Joined-up words: wide strokes whose bottoms and tops wander. */
function cursiveRow(x, base, words, xh) {
  const out = [];
  for (let k = 0; k < words; k++) {
    const x0 = x + k * xh * 6;
    const dy = [0, 7, -5, 9, -8, 4][k % 6];
    out.push({ x0, x1: x0 + xh * 5, y0: base + dy - xh - (k % 2) * 9, y1: base + dy, keep: true });
  }
  return out;
}
/** Separate hand-printed letters: bottoms and tops scatter by a quarter of the letter height. */
function handPrintedRow(x, base, n, xh) {
  const jig = [0, 6, -5, 8, -7, 3, -4, 7, -6, 5];
  return Array.from({ length: n }, (_, k) => {
    const x0 = x + k * xh;
    return { x0, x1: x0 + Math.round(xh * 0.6), y0: base + jig[k % 10] - xh - jig[(k + 3) % 10], y1: base + jig[k % 10], keep: true };
  });
}
const boxOf = (strokes) => {
  const x = Math.min(...strokes.map((s) => s.x0)); const y = Math.min(...strokes.map((s) => s.y0));
  return { x, y, w: Math.max(...strokes.map((s) => s.x1)) - x, h: Math.max(...strokes.map((s) => s.y1)) - y };
};

{
  const p = printedRow(100, 200, 30, 14);
  check('measure: a row of typeset letters is print', pd.measure(p, boxOf(p)).print === true);
  const tilted = printedRow(100, 200, 40, 14, 0.008);
  check('measure: a slightly turned scan is still print', pd.measure(tilted, boxOf(tilted)).print === true);
  const c = cursiveRow(100, 200, 6, 24);
  check('measure: joined-up handwriting is not print', pd.measure(c, boxOf(c)).print === false);
  const h = handPrintedRow(100, 200, 20, 24);
  check('measure: uneven hand-printed letters are not print', pd.measure(h, boxOf(h)).print === false);
  const two = printedRow(100, 200, 18, 10).concat(printedRow(120, 226, 16, 10));
  check('measure: two rows of small print in one box are print', pd.measure(two, boxOf(two)).print === true);
  check('measure: too few letters cannot be judged', pd.measure(printedRow(0, 50, 3, 14), { x: 0, y: 30, w: 40, h: 20 }).print === false);
  check('measure: reports the letter height', pd.measure(p, boxOf(p)).size === 14, String(pd.measure(p, boxOf(p)).size));
  const fit = pd.fitLine([[0, 10], [100, 12], [200, 14], [300, 16], [150, 40]], 20);
  check('fitLine: robust to one stray point', Math.abs(fit.m - 0.02) < 0.005 && Math.abs(fit.c - 10) < 1.5, JSON.stringify(fit));
}

/** Builds review() input from rows of strokes: every row is one line with one box. */
function pageOf(rows, height) {
  const comps = [];
  const owner = [];
  const regionOf = new Map();
  const lines = rows.map((strokes, i) => {
    const b = boxOf(strokes);
    regionOf.set(`${b.x},${b.y},${b.w},${b.h}`, i);
    for (const s of strokes) { comps.push(s); owner.push(i); }
    return { index: i, box: b, regions: [{ box: b }] };
  });
  return { lines, ctx: { comps, owner: Int32Array.from(owner), regionOf, height } };
}
const handPage = (top) => top.concat(Array.from({ length: 8 }, (_, k) => cursiveRow(120, 520 + k * 110, 6, 30)));

{
  // letterhead: a large printed name, small print under it, then eight handwritten lines
  const lh = pageOf(handPage([printedRow(500, 120, 16, 30), printedRow(520, 170, 28, 9)]), 1500);
  const r = pd.review(lh.lines, lh.ctx);
  check('letterhead: both printed lines are taken out', r.letterhead.length === 2 && r.lines.length === 8, `${r.letterhead.length}/${r.lines.length}`);
  check('letterhead: remaining lines are renumbered from 0', r.lines.every((l, i) => l.index === i) && r.lines[0].box.y > 400);
  check('letterhead: the page is not called printed', r.printed === false);

  const title = pageOf(handPage([printedRow(300, 120, 16, 30)]), 1500);
  const rt = pd.review(title.lines, title.ctx);
  check('letterhead: a lone print-like title without small print is kept', rt.letterhead.length === 0 && rt.lines.length === 9);

  // a staple through the small print: wide stroke, so not strictly print, but small and above the printed name
  const stapled = printedRow(80, 100, 8, 9).concat([{ x0: 150, x1: 240, y0: 70, y1: 110, keep: true }]);
  const st = pageOf(handPage([stapled, printedRow(500, 190, 16, 30)]), 1500);
  const rs = pd.review(st.lines, st.ctx);
  check('letterhead: damaged small print above a printed line goes too', rs.letterhead.length === 2 && rs.lines.length === 8, String(rs.letterhead.length));

  const low = pageOf([cursiveRow(120, 100, 6, 30), printedRow(500, 700, 16, 30), printedRow(520, 750, 28, 9)].concat(
    Array.from({ length: 6 }, (_, k) => cursiveRow(120, 860 + k * 100, 6, 30))), 1500);
  check('letterhead: print in the middle of the page is left alone', pd.review(low.lines, low.ctx).letterhead.length === 0);

  const foot = pageOf(Array.from({ length: 8 }, (_, k) => cursiveRow(120, 150 + k * 110, 6, 30)).concat([printedRow(400, 1440, 30, 9), printedRow(420, 1470, 30, 9)]), 1500);
  const rf = pd.review(foot.lines, foot.ctx);
  check('letterhead: a printed footer is taken out', rf.letterhead.length === 2 && rf.lines.length === 8, String(rf.letterhead.length));

  const book = pageOf(Array.from({ length: 12 }, (_, k) => printedRow(100, 120 + k * 40, 50, 14)).concat([printedRow(100, 30, 20, 8)]), 1500);
  const rb = pd.review(book.lines, book.ctx);
  check('printed page: every line is kept and the page is marked printed', rb.printed === true && rb.letterhead.length === 0 && rb.lines.length === 13);
}

// ---- reading order ----
const box = (x, y, w, h = 30) => ({ x, y, w, h });
const firstX = (lines) => lines.map((l) => l.regions[0].box.x);
{
  const title = box(100, 50, 1300, 40);
  const left = Array.from({ length: 8 }, (_, k) => box(100, 150 + k * 40, 560 + (k % 3) * 20));
  const right = Array.from({ length: 8 }, (_, k) => box(820, 152 + k * 40, 540 + (k % 2) * 30));
  const out = cols.lines([...right, title, ...left], 30);
  check('columns: title, then the whole left column, then the right', out.length === 17 && out[0].box.w === 1300
    && firstX(out.slice(1, 9)).every((x) => x === 100) && firstX(out.slice(9)).every((x) => x === 820), JSON.stringify(firstX(out)));
  check('columns: lines are numbered in reading order', out.every((l, i) => l.index === i) && out[9].box.y < out[8].box.y);
  check('columns: each column is its own block', out[0].column !== out[1].column && out[1].column !== out[9].column);

  const single = cols.lines(Array.from({ length: 10 }, (_, k) => box(100, 100 + k * 40, 900 + (k % 4) * 60)), 30);
  check('columns: one column stays top to bottom', single.length === 10 && single.every((l, i) => !i || l.box.y > single[i - 1].box.y));

  // table cells and a list of terms with meanings: narrow pieces side by side are read across
  const cells = [];
  for (let r = 0; r < 6; r++) for (const x of [100, 600, 1000]) cells.push(box(x, 100 + r * 50, 120));
  const table = cols.lines(cells, 30);
  check('columns: table rows are read across', table.length === 6 && table.every((l) => l.regions.length === 3), String(table.length));
  const terms = [];
  for (let r = 0; r < 8; r++) { terms.push(box(100, 100 + r * 60, 150 + (r % 3) * 30)); terms.push(box(520, 102 + r * 60, 700)); }
  const list = cols.lines(terms, 30);
  check('columns: a term and its meaning stay on one line', list.length === 8 && list.every((l) => l.regions.length === 2), String(list.length));

  const band = Array.from({ length: 4 }, (_, k) => box(100, 100 + k * 40, 1250)).concat(
    Array.from({ length: 6 }, (_, k) => box(100, 300 + k * 40, 580)), Array.from({ length: 6 }, (_, k) => box(800, 300 + k * 40, 560)));
  const mixed = cols.lines(band, 30);
  check('columns: full-width paragraph first, then left, then right', mixed.length === 16 && mixed[3].box.w === 1250
    && firstX(mixed.slice(4, 10)).every((x) => x === 100) && firstX(mixed.slice(10)).every((x) => x === 800), JSON.stringify(firstX(mixed)));
  check('columns: no boxes, no lines', cols.lines([], 30).length === 0);
}

// ---- the real plan on a drawn two-column page of small "print" ----
{
  const W = 1400; const H = 1000;
  const g = new Uint8Array(W * H).fill(250);
  const glyph = (x, y, w, h) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) g[j * W + i] = 30; };
  const textLine = (x, base, n) => { for (let k = 0; k < n; k++) { const tall = k % 3 === 0; if (k % 7 !== 6) glyph(x + k * 14, base - (tall ? 22 : 15), 9, tall ? 22 : 15); } };
  for (let r = 0; r < 9; r++) { textLine(80, 150 + r * 44, 40); textLine(760, 150 + r * 44, 40); }
  const plan = prep.plan(g, W, H);
  const xs = plan.lines.map((l) => l.box.x < 700);
  check('plan: a printed two-column page is marked printed', plan.printed === true && plan.letterhead.length === 0);
  check('plan: left column is read before the right one', plan.lines.length === 18 && xs.slice(0, 9).every(Boolean) && xs.slice(9).every((v) => !v), `${plan.lines.length} ${xs.join(',')}`);
}

// ---- a ruled box on a slightly turned scan: the rule is a staircase of runs, short steps included ----
{
  const W = 1200; const H = 400;
  const draw = () => {
    const d = new Uint8Array(W * H);
    for (let x = 100; x < 1080; x++) { const y = 100 + Math.floor((x - 100) / 140); d[y * W + x] = 1; d[(y + 1) * W + x] = 1; d[(y + 2) * W + x] = 1; }
    for (let y = 100; y < 330; y++) { d[y * W + 100] = 1; d[y * W + 101] = 1; } // the box's left side crosses the first step
    for (let k = 0; k < 6; k++) for (let y = 150; y < 180; y++) for (let x = 300 + k * 30; x < 312 + k * 30; x++) d[y * W + x] = 1; // letters
    return { data: d, w: W, h: H };
  };
  const bin = draw();
  src('hw', 'rule-strip.js').stripRules(bin, 1);
  let rule = 0; let letters = 0;
  for (let y = 95; y < 115; y++) for (let x = 110; x < 1100; x++) rule += bin.data[y * W + x];
  for (let y = 150; y < 180; y++) for (let x = 300; x < 480; x++) letters += bin.data[y * W + x];
  check('rules: every step of a slanted rule is erased, short end steps too', rule === 0, String(rule));
  check('rules: letters near the rule are untouched', letters === 6 * 12 * 30, String(letters));
}

// ---- short plain lines are not math; bullets ----
{
  const yes = ['do this.', 'A thin membrane', 'Solving a problem', 'I remain', 'Limits and continuity', 'Definition: A function is continuous at c'];
  const no = ['x', 'dx', '2c', 'sin x', 'dy dx', 'x = 2', 'to be', 'a b c', '42', 'lim', 'f(x) + 2', ''];
  check('proseLike: short plain lines read as prose', yes.every((t) => util.proseLike(t)), yes.filter((t) => !util.proseLike(t)).join('|'));
  check('proseLike: short math-like lines do not', no.every((t) => !util.proseLike(t)), no.filter((t) => util.proseLike(t)).join('|'));

  const reg = (text, x, kind = 'text') => ({ id: `r${x}`, kind, box: { x, y: 10, w: 200, h: 30 }, text, confidence: 0.9 });
  const res = { pageNumber: 1, scale: 1, width: 800, height: 600, lines: [
    { index: 0, box: { x: 0, y: 10, w: 700, h: 30 }, regions: [reg('# Speed tells how fast', 20), reg('# 5 is odd', 300)] },
    { index: 1, box: { x: 0, y: 60, w: 700, h: 30 }, regions: [reg('# 7 items', 20)] },
  ] };
  const lines = ocr.toPageLines(res, { width: 800, height: 600 });
  check('bullet: a leading "#" before a word becomes a bullet', lines[0].text.startsWith('• Speed tells') && lines[0].hasBullet === true, lines[0].text);
  check('bullet: only at the start of the line, never before a number', lines[0].text.includes('# 5 is odd') && lines[1].text === '# 7 items', lines[1].text);
}

// ---- worker core: a printed page may hold more pieces ----
(async () => {
  const fakePrep = (n, printed, letterhead) => ({
    plan: () => ({ bin: {}, medH: 20, printed, letterhead, lines: Array.from({ length: n }, (_, i) => ({ index: i, box: box(0, i * 3, 50, 2), regions: [{ box: box(0, i * 3, 50, 2) }] })) }),
    cropFor: () => ({ data: new Uint8Array(4).fill(255), w: 2, h: 2 }),
  });
  const run = async (n, printed, letterhead = []) => {
    const out = []; const engine = mockEngine();
    const h = core.createHandler({ engine, segmenter: { classifyRegion: () => 'text' }, prep: fakePrep(n, printed, letterhead), post: (m) => out.push(m) });
    await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: new Uint8Array(4), width: 2, height: 2, scale: 1 });
    return { result: out.find((m) => m.type === 'page-done').result, calls: engine.calls.length };
  };
  const n = core.MAX_REGIONS + 30;
  const hand = await run(n, false);
  check('core: a handwritten page over the limit is skipped', hand.calls === 0 && hand.result.skippedReason === 'too-many-regions');
  const book = await run(n, true);
  check('core: a printed page with the same pieces is read', book.calls === n && !book.result.skippedReason && book.result.printed === true, String(book.calls));
  const huge = await run(core.MAX_PRINTED + 1, true);
  check('core: a printed page still has a limit', huge.calls === 0 && huge.result.skippedReason === 'too-many-regions');
  const lh = await run(5, false, [box(0, 0, 10, 10), box(0, 20, 10, 10)]);
  check('core: the result says how many letterhead lines were left out', lh.result.letterhead === 2 && hand.result.letterhead === undefined);
  console.log(`handwriting_print_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

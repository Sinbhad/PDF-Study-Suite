/**
 * Handwriting fixtures (Node): raster, segmenter, worker core (mock engine), client (fake Worker),
 * ink detection, recognised-text-to-lines, and an end-to-end run on a synthetic ink PDF (tests/hw_e2e.js).
 * Run: node tests/handwriting_fixtures.js
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
const { raster, segmenter } = S;
const inside = (outer, box) => box.x >= outer.x - 1 && box.y >= outer.y - 1 && box.x + box.w <= outer.x + outer.w + 1 && box.y + box.h <= outer.y + outer.h + 1;

function rasterTests() {
  const g = raster.toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]), 3, 1);
  check('toGray: length, white, black, red in between', g.length === 3 && g[0] === 255 && g[1] === 0 && g[2] > 40 && g[2] < 110, String(Array.from(g)));
  const bi = new Uint8Array(1000).fill(220).fill(30, 0, 200);
  const t = raster.otsu(bi);
  check('otsu separates 30 / 220', t >= 30 && t < 220, `t=${t}`);
  check('otsu on a flat image does not throw', Number.isFinite(raster.otsu(new Uint8Array(50).fill(200))));
  const img = S.bitmap(100, 60);
  S.rect(img, 10, 10, 30, 10);
  const b = S.binarised(img);
  check('binarise: ink = 1 and not inverted', b.inverted === false && b.data[15 * 100 + 20] === 1 && b.data[0] === 0 && b.data.reduce((a, v) => a + v, 0) === 300);
  const d = S.binarised(S.invert(S.copy(img)));
  check('binarise: dark paper sets inverted', d.inverted === true);
  check('binarise: dark paper gives the same ink mask', d.data.every((v, i) => v === b.data[i]));
  const grid = { data: Uint8Array.from({ length: 100 }, (_, i) => i), w: 10, h: 10 };
  let c = raster.crop(grid.data, 10, 10, { x: 2, y: 3, w: 3, h: 2 }, 1);
  check('crop: size with padding', c.w === 5 && c.h === 4 && c.data.length === 20);
  check('crop: content', c.data[0] === 21 && c.data[c.w + 1] === 32, String(Array.from(c.data)));
  c = raster.crop(grid.data, 10, 10, { x: 0, y: 0, w: 3, h: 3 }, 2);
  check('crop: clamped at top-left', c.w === 5 && c.h === 5 && c.data[0] === 0);
  c = raster.crop(grid.data, 10, 10, { x: 8, y: 8, w: 2, h: 2 }, 3);
  check('crop: clamped at bottom-right', c.w === 5 && c.h === 5 && c.data[c.data.length - 1] === 99);
  c = raster.crop(grid.data, 10, 10, { x: 4, y: 4, w: 2, h: 2 });
  check('crop: no pad argument', c.w === 2 && c.h === 2);
}

function segmenterTests() {
  const img = S.bitmap(600, 400);
  const rows = [45, 125, 205, 285].map((y) => S.wordRow(img, 50, y, 24, 4));
  const lines = segmenter.segmentPage(S.binarised(img));
  check('segment: 4 rows -> 4 lines', lines.length === 4, `got ${lines.length}`);
  check('segment: top-to-bottom order', lines.every((l, i) => l.index === i && (i === 0 || l.box.y > lines[i - 1].box.y)));
  check('segment: boxes contain the drawn rows', lines.length === 4 && lines.every((l, i) => inside(l.box, rows[i]) && inside(rows[i], l.box)), JSON.stringify(lines.map((l) => l.box)));
  const ruled = S.copy(img);
  S.ruledPaper(ruled, 40);
  check('segment: ruled paper lines are not lines', segmenter.segmentPage(S.binarised(ruled)).length === 4);
  const speck = S.copy(img);
  S.rect(speck, 500, 350, 2, 2);
  S.rect(speck, 300, 10, 1, 1);
  check('segment: specks ignored', segmenter.segmentPage(S.binarised(speck)).length === 4);
  const gap = S.bitmap(600, 100);
  S.wordRow(gap, 20, 30, 20, 2);
  S.wordRow(gap, 400, 30, 20, 2);
  const g = segmenter.segmentPage(S.binarised(gap));
  check('segment: wide gap -> one line, two regions left to right', g.length === 1 && g[0].regions.length === 2 && g[0].regions[0].box.x < g[0].regions[1].box.x, JSON.stringify(g));
  const fr = S.bitmap(300, 200);
  S.fraction(fr, 100, 80);
  const fb = S.binarised(fr);
  const fl = segmenter.segmentPage(fb);
  check('segment: fraction -> one line', fl.length === 1 && fl[0].regions.length === 1, JSON.stringify(fl));
  check('classifyRegion: fraction is math', fl.length === 1 && segmenter.classifyRegion(fb, fl[0].regions[0].box) === 'math');
  const tb = S.binarised(img);
  check('classifyRegion: word rows are text', segmenter.segmentPage(tb).every((l) => segmenter.classifyRegion(tb, l.regions[0].box) === 'text'));
  check('segment: blank page -> []', segmenter.segmentPage(S.binarised(S.bitmap(200, 200))).length === 0);
  const big = S.bitmap(1650, 2340);
  for (let y = 100; y < 2200; y += 55) S.wordRow(big, 120, y, 28, 10, 70, 20);
  const t0 = Date.now();
  const bl = segmenter.segmentPage(S.binarised(big));
  const ms = Date.now() - t0;
  check('segment: 1650x2340 page < 1500 ms (binarise + segment)', ms < 1500, `${ms} ms, ${bl.length} lines`);
}

async function workerCoreTests() {
  const page = S.bitmap(600, 300);
  S.wordRow(page, 40, 30, 24, 4);
  S.fraction(page, 100, 100);
  S.wordRow(page, 40, 200, 24, 4);
  const run = async (engine, extra) => {
    const out = [];
    const h = S.core.createHandler({ engine, raster, segmenter, post: (m) => { out.push(m); if (extra) extra(m, h); } });
    await h.handle({ type: 'init' });
    await h.handle({ type: 'page', jobId: 7, pageNumber: 3, gray: page.gray.slice(), width: 600, height: 300, scale: 2 });
    return out;
  };
  const eng = S.mockEngine({ progress: true });
  const msgs = await run(eng);
  const types = msgs.map((m) => m.type);
  check('core: order ready ... progress* ... page-done', types.indexOf('ready') >= 0 && types[types.length - 1] === 'page-done' && types.filter((t) => t === 'progress').length === 3 && types.indexOf('ready') < types.indexOf('progress'), types.join(','));
  check('core: model-progress forwarded', msgs.some((m) => m.type === 'model-progress' && m.loaded === 5 && m.total === 10 && m.file === 'model.bin'));
  const ready = msgs.find((m) => m.type === 'ready');
  check('core: ready engine info', ready.engine.name === 'mock' && ready.engine.available === true);
  const prog = msgs.filter((m) => m.type === 'progress');
  check('core: progress done counts 1..3 of 3', prog.every((m, i) => m.done === i + 1 && m.total === 3 && m.jobId === 7 && m.pageNumber === 3));
  const res = msgs.find((m) => m.type === 'page-done').result;
  const regs = res.lines.flatMap((l) => l.regions);
  check('core: result shape', res.pageNumber === 3 && res.scale === 2 && res.width === 600 && res.height === 300 && res.lines.length === 3);
  check('core: ids p{page}-l{line}-r{n}', res.lines.every((l) => l.regions.every((r, n) => r.id === `p3-l${l.index}-r${n}`)), regs.map((r) => r.id).join(','));
  check('core: region fields', regs.every((r) => ['text', 'math'].includes(r.kind) && r.box && r.box.w > 0 && typeof r.text === 'string' && r.confidence >= 0 && r.confidence <= 1 && r.source === 'model'));
  check('core: kinds text/math/text with canned text', res.lines.map((l) => l.regions[0].kind).join() === 'text,math,text' && regs[1].text === '\\frac{a}{b}' && regs[0].text.startsWith('word'));
  const nm = await run(require('../src/hw/null-engine.js'));
  const nr = nm.find((m) => m.type === 'page-done').result.lines.flatMap((l) => l.regions);
  check('core null engine: available false', nm.find((m) => m.type === 'ready').engine.available === false);
  check('core null engine: empty manual regions', nr.length === 3 && nr.every((r) => r.text === '' && r.confidence === 0 && r.source === 'manual'));
  const th = await run(S.mockEngine({ throwOn: 2 }));
  const tr = th.find((m) => m.type === 'page-done');
  check('core: throwing engine does not lose the page', !!tr && tr.result.lines.flatMap((l) => l.regions).length === 3 && tr.result.lines[1].regions[0].text === '' && tr.result.lines[0].regions[0].text !== '', th.map((m) => m.type).join());
  const cm = await run(S.mockEngine(), (m, h) => { if (m.type === 'progress' && m.done === 1) h.handle({ type: 'cancel', jobId: 7 }); });
  check('core: cancel -> cancelled, no page-done', cm.some((m) => m.type === 'cancelled' && m.jobId === 7 && m.pageNumber === 3) && !cm.some((m) => m.type === 'page-done'), cm.map((m) => m.type).join());
  for (const [conf, want] of [[1.7, 1], [-0.5, 0], [NaN, 0]]) {
    const r = await run(S.mockEngine({ confidence: conf }));
    check(`core: confidence ${conf} clamps to ${want}`, r.find((m) => m.type === 'page-done').result.lines.flatMap((l) => l.regions).every((x) => x.confidence === want));
  }
}

async function clientTests() {
  const { hwClient } = { hwClient: src('hw', 'hw-client.js') };
  const page = S.bitmap(600, 200);
  [20, 80, 140].forEach((y) => S.wordRow(page, 40, y, 24, 4));
  const payload = () => ({ pageNumber: 1, gray: page.gray.slice(), width: 600, height: 200, scale: 1 });
  const stats = S.newStats();
  const client = hwClient.create({ workerFactory: S.fakeWorkerFactory(S.mockEngine(), stats) });
  check('client: no worker before init()', stats.created === 0);
  const info = await client.init();
  check('client: init creates the worker once', stats.created === 1 && info.available === true);
  await client.init();
  check('client: second init reuses it', stats.created === 1);
  const seen = [];
  const res = await client.recognisePage(payload(), (p) => seen.push(p.done));
  check('client: recognisePage resolves with the result', res.pageNumber === 1 && res.lines.length === 3 && seen.length === 3);
  const p = client.recognisePage(payload(), () => client.cancel());
  let err = null;
  try { await p; } catch (e) { err = e; }
  check('client: cancel() rejects with AbortError', !!err && err.name === 'AbortError', String(err));
  check('client: usable after a cancel', (await client.recognisePage(payload())).lines.length === 3);
  client.dispose();
  check('client: dispose terminates the worker', stats.terminated === 1);
}

function inkTests() {
  const ink = src('pdf', 'ink-detect.js');
  const w = (n) => ({ lines: n ? [{ wordCount: n }] : [] });
  let a = ink.assess(w(0), { pathOps: 40, imageOps: 0 });
  check('ink: 0 words / 40 paths -> no-text', a.reason === 'no-text' && a.needsRecognition === true && a.pathOps === 40);
  a = ink.assess(w(0), { pathOps: 0, imageOps: 1 });
  check('ink: 0 words / 1 image -> no-text', a.reason === 'no-text' && a.needsRecognition === true);
  a = ink.assess(w(200), { pathOps: 40, imageOps: 3 });
  check('ink: 200 words -> has-text', a.reason === 'has-text' && a.needsRecognition === false);
  a = ink.assess(w(0), { pathOps: 0, imageOps: 0 });
  check('ink: nothing -> blank', a.reason === 'blank' && a.needsRecognition === false);
  check('ink: 19 path ops is not enough', ink.assess(w(0), { pathOps: 19, imageOps: 0 }).reason === 'blank');
  check('ink: margin text does not count', ink.assess({ lines: [{ wordCount: 50, isMargin: true }] }, { pathOps: 30, imageOps: 0 }).needsRecognition === true);
  const z = ink.opStats(null, { stroke: 1 });
  check('ink: opStats(null) -> zeros', z.pathOps === 0 && z.imageOps === 0);
  const OPS = { constructPath: 3, stroke: 1, fill: 2, paintImageXObject: 4 };
  const st = ink.opStats({ fnArray: [3, 1, 3, 4, 2], argsArray: [[[0], []], [], [OPS.stroke, [], []], [], []] }, OPS);
  check('ink: opStats counts path and image ops', st.pathOps === 3 && st.imageOps === 1, JSON.stringify(st));
  const pg = (n, ink2) => ({ pageNumber: n, ink: ink2, lines: [] });
  const doc = { pageCache: new Map([[1, pg(1, { needsRecognition: true })], [2, pg(2, { needsRecognition: true, recognised: true })], [3, pg(3, { needsRecognition: false })], [4, pg(4, { needsRecognition: true })]]) };
  check('ink: pagesNeeding skips recognised and text pages', ink.pagesNeeding(doc, 1, 4).join() === '1,4' && ink.pagesNeeding(doc, 2, 3).length === 0 && ink.pagesNeeding(doc, 2, 4).join() === '4');
  const s = ink.summarise(doc);
  check('ink: summarise loaded/needing/share', s.loaded === 4 && s.needing === 2 && s.share === 0.5, JSON.stringify(s));
}

function ocrTests() {
  const ocr = src('pdf', 'ocr-lines.js');
  const reg = (id, kind, x, w, text, confidence, source = 'model') => ({ id, kind, box: { x, y: 0, w, h: 30 }, text, confidence, source });
  const mk = (index, y, h, regions) => ({ index, box: { x: 100, y, w: 400, h }, regions: regions.map((r) => ({ ...r, box: { ...r.box, y, h } })) });
  const result = {
    pageNumber: 1, scale: 2, width: 1224, height: 1584,
    lines: [
      mk(0, 200, 30, [reg('p1-l0-r0', 'text', 100, 400, 'A limit describes the value', 0.9)]),
      mk(1, 300, 60, [reg('p1-l1-r0', 'math', 100, 200, 'x^2 + 1', 0.8)]),
      mk(2, 400, 30, [reg('p1-l2-r1', 'math', 600, 100, 'a+b', 0.7), reg('p1-l2-r0', 'text', 100, 300, 'where', 0.9)]),
      mk(3, 500, 30, [reg('p1-l3-r0', 'text', 100, 300, '', 0, 'manual')]),
      mk(4, 600, 30, [reg('p1-l4-r0', 'text', 100, 300, 'unclear scribble here', 0.3)]),
    ],
  };
  const page = { pageNumber: 1, width: 612, height: 792, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', pathOps: 40, imageOps: 0 } };
  const L = ocr.toPageLines(result, page);
  const LA = ocr.toPageLines(result, page, { includeLow: true });
  check('ocr: empty line dropped; low line only with includeLow', L.length === 3 && LA.length === 4, `${L.length} ${LA.length}`);
  const fields = 'text cleanText formattedText x0 textX0 x1 topY bottomY fontSize isBold hasBullet hasMath isCode wordCount pageWidth pageHeight'.split(' ');
  check('ocr: every line-builder field present', L.every((l) => fields.every((f) => f in l && l[f] !== undefined)), fields.filter((f) => !(f in (L[0] || {}))).join());
  check('ocr: coordinates divided by scale', L[0].x0 === 50 && L[0].x1 === 250 && L[0].topY === 100 && L[0].bottomY === 115 && L[0].pageWidth === 612, JSON.stringify(L[0]));
  check('ocr: single math region -> $$..$$ + hasMath', L[1].text === '$$x^2 + 1$$' && L[1].hasMath === true);
  check('ocr: mixed line -> inline $..$ in x order', L[2].text === 'where $a+b$' && L[2].hasMath === true, L[2].text);
  check('ocr: text line has no math', L[0].hasMath === false && L[0].wordCount === 5);
  check('ocr: confidence is min over regions, low below 0.6', L[2].ocr.confidence === 0.7 && L[2].ocr.low === false && LA[3].ocr.low === true && LA[3].ocr.lineIndex === 4);
  check('ocr: regionIds carried', L[2].ocr.regionIds.length === 2 && L[0].ocr.regionIds[0] === 'p1-l0-r0');
  ocr.applyToPage(page, result);
  check('ocr: applyToPage sets lines, wordCount, kind, ink', page.lines.length === 3 && page.wordCount === page.lines.reduce((s, l) => s + l.wordCount, 0) && page.wordCount > 0 && typeof page.kind !== 'undefined' && page.ink.recognised === true && page.ink.result === result);
  const low = ocr.lowConfidence(page);
  check('ocr: lowConfidence lists manual/empty and low regions with pageNumber', low.length === 2 && low.every((r) => r.pageNumber === 1) && low.map((r) => r.id).join() === 'p1-l3-r0,p1-l4-r0', JSON.stringify(low));
  check('ocr: applyCorrection unknown id -> false', ocr.applyCorrection(page, 'nope', 'x') === false);
  check('ocr: applyCorrection -> true', ocr.applyCorrection(page, 'p1-l4-r0', 'A corrected sentence is here.') === true);
  const fixed = result.lines[4].regions[0];
  check('ocr: correction sets confidence 1 / user and rebuilds lines', fixed.confidence === 1 && fixed.source === 'user' && page.lines[3].text === 'A corrected sentence is here.' && page.lines[3].ocr.low === false);
  check('ocr: lowConfidence shrinks after correction', ocr.lowConfidence(page).length === 1);
}

(async () => {
  rasterTests();
  segmenterTests();
  await workerCoreTests();
  await clientTests();
  inkTests();
  ocrTests();
  await require('./hw_e2e.js').run(check);
  console.log(`handwriting_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL uncaught: ${e && e.stack || e}`); process.exit(1); });

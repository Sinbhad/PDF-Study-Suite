/**
 * Picture noise and what a read page is taken for (Node, no model, no PDF.js):
 * the rule that discards pieces a student could not correct (src/pdf/ocr-noise.js), counts and review lists
 * that hold only what remains, a page of unsure lines being held for correcting while a page of fragments is
 * dropped as a picture (src/pdf/ocr-merge.js), and text size taken from the written line on a turned page.
 * Every text here is invented for the test.
 * Run: node tests/handwriting_noise_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const detect = src('pdf', 'ink-detect.js');
const summary = src('pdf', 'ink-summary.js');
const noise = src('pdf', 'ocr-noise.js');
const merge = src('pdf', 'ocr-merge.js');
const ocr = src('pdf', 'ocr-lines.js');
const reading = src('ui', 'study-reading.js');

const W = 800;
const H = 600;
const typedLine = (text, x, y, w = 300) => ({
  text, formattedText: text, cleanText: text, x0: x, textX0: x, x1: x + w, topY: y, bottomY: y + 14,
  fontSize: 12, wordCount: text.split(/\s+/).length, pageWidth: W, pageHeight: H,
});
/** A slide that is one picture, with an optional short typed title. */
const imagePage = (n, title) => {
  const page = { pageNumber: n, width: W, height: H, lines: title ? [typedLine(title, 60, 30, 120)] : [] };
  page.wordCount = page.lines.reduce((s, l) => s + l.wordCount, 0);
  page.ink = detect.assess(page, { pathOps: 3, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 80, w: 680, h: 460 }], paths: [], pathsMeasured: true } });
  return page;
};
const piece = (text, confidence, extra) => Object.assign({ id: 'x', kind: 'text', box: { x: 0, y: 0, w: 100, h: 16 }, text, confidence, source: 'model' }, extra);
/** rows: [text, confidence, x, y, w?, extra?] -> a page result with one piece per line. */
const resultOf = (pageNumber, rows) => ({
  pageNumber, scale: 1, width: W, height: H, engine: 'ppocr-v5',
  lines: rows.map(([text, confidence, x, y, w, extra], i) => {
    const box = { x, y, w: w || 300, h: 16 };
    return { index: i, box, regions: [Object.assign({ id: `p${pageNumber}-l${i}-r0`, kind: 'text', box, text, confidence, source: 'model' }, extra)] };
  }),
});
/** The fragments a photograph or diagram comes back as: one or two characters, low confidence, some read as nothing. */
const FRAGMENTS = ['l', '7', '..', 'I1', 'o', '|', 'a.', '-', 'J', 'eo', '', '', 'x', '1', ':'];
const fragmentRows = (n) => Array.from({ length: n }, (_, i) => [FRAGMENTS[i % FRAGMENTS.length], 0.05 + (i % 9) * 0.05, 80 + (i % 8) * 80, 100 + Math.floor(i / 8) * 40, 30]);

function ruleTests() {
  const s = noise.shape('Lateral cord, 12 mm');
  check('shape: letters, digits, words and runs are counted', s.chars === 15 && s.letters === 13 && s.words === 3 && s.run === true, JSON.stringify(s));
  check('shape: isolated symbols have no run', noise.shape('a . 1 | x').run === false && noise.shape('a . 1 | x').chars === 3);
  check('lineLike: two words, or five letters and digits', noise.lineLike('two words') && noise.lineLike('nerve') && noise.lineLike('x^2 + 3y = 10') && !noise.lineLike('nerv') && !noise.lineLike('C5 12'));

  check('rule 1: fewer than three letters or digits is noise at any confidence', noise.isNoise(piece('C5', 0.99)) && noise.isNoise(piece('7', 0.9)) && noise.isNoise(piece('~~ l1 |', 0.2)));
  check('rule 1: a piece read as nothing is noise', noise.isNoise(piece('', 0)) && noise.isNoise(piece('   ', 0.4)));
  check('rule 2: a row of isolated symbols is noise even when sure', noise.isNoise(piece('A B C D', 0.95)) && noise.isNoise(piece('1 . 2 . 3', 0.9)));
  check('rule 3: unsure and not line-like is noise', noise.isNoise(piece('eft', 0.3)) && noise.isNoise(piece('nerv', 0.59)) && noise.isNoise(piece('12 mm', 0.4)));
  check('kept: a sure short label', !noise.isNoise(piece('12 mm', 0.9)) && !noise.isNoise(piece('Ulna', 0.7)));
  check('kept: an unsure piece that looks like a line stays for review', !noise.isNoise(piece('smudged words in the corner', 0.2)) && !noise.isNoise(piece('unsure tail', 0.3)) && !noise.isNoise(piece('anaesthetic', 0.1)));
  check('kept: an unsure short formula stays for review (no words, five letters and digits)', !noise.isNoise(piece('x^2 + 3y = 10', 0.35)) && !noise.isNoise(piece('f(x) = 2x + 1', 0.35)) && noise.isNoise(piece('x = 2', 0.35)));
  check('kept: what the student typed or confirmed, however short', !noise.isNoise(piece('pH', 1, { source: 'user' })) && !noise.isNoise(piece('', 1, { source: 'user' })));
  check('kept: a piece waiting to be typed in (no reader ran)', !noise.isNoise(piece('', 0, { source: 'manual' })));
  check('kept: maths that was read as something', !noise.isNoise(piece('x', 0.4, { kind: 'math' })) && noise.isNoise(piece('', 0, { kind: 'math' })));
  check('rule: the numbers are named constants', noise.MIN_CHARS === 3 && noise.LINE_WORDS === 2 && noise.LINE_CHARS === 5 && noise.LOW_CONFIDENCE === merge.LOW_CONFIDENCE && noise.LOW_CONFIDENCE === ocr.LOW_CONFIDENCE);
}

function stripTests() {
  const clean = resultOf(1, [['A line of real words.', 0.9, 100, 100], ['Another line that reads well.', 0.8, 100, 140]]);
  check('strip: nothing to discard -> the same object, no noise count', noise.strip(clean) === clean && clean.noise === undefined);
  const mixed = resultOf(2, [['A line of real words.', 0.9, 100, 100], ['l', 0.1, 400, 300, 20], ['', 0, 500, 300, 20], ['eo', 0.3, 600, 300, 20]]);
  mixed.lines[0].regions.push({ id: 'p2-l0-r1', kind: 'text', box: { x: 420, y: 100, w: 20, h: 16 }, text: '|', confidence: 0.2, source: 'model' });
  const out = noise.strip(mixed);
  check('strip: noise pieces go, a line left empty goes with them', out.lines.length === 1 && out.lines[0].regions.length === 1 && out.noise === 4, JSON.stringify(out.lines.map((l) => l.regions.length)));
  check('strip: the reader\'s result is not changed, ids and line indices are kept', mixed.lines.length === 4 && mixed.lines[0].regions.length === 2 && out.lines[0].index === 0 && out.lines[0].regions[0].id === 'p2-l0-r0');
  check('strip: stripping again discards nothing more', noise.strip(out) === out);
  check('strip: no result, no lines -> returned as given', noise.strip(null) === null && noise.strip({}).lines === undefined);
}

function photoSlideTests() {
  // a slide of photographs with two real captions: what the three real decks mostly hold
  const slide = imagePage(1);
  const rows = fragmentRows(40).concat([
    ['Needle tip lateral to the artery.', 0.93, 100, 520, 400],
    ['Spread of local anaesthetic.', 0.88, 100, 550, 400],
  ]);
  const result = resultOf(1, rows);
  ocr.applyToPage(slide, result);
  const listed = slide.ink.result.lines.flatMap((l) => l.regions);
  check('photo slide: only the captions are kept in the page result', listed.length === 2 && slide.ink.result.noise === 40, `${listed.length} kept, noise ${slide.ink.result.noise}`);
  check('photo slide: nothing is listed for review', ocr.lowConfidence(slide).length === 0);
  check('photo slide: the captions become study lines', slide.lines.map((l) => l.text).join('|') === 'Needle tip lateral to the artery.|Spread of local anaesthetic.' && slide.ink.picture === false && slide.ink.held === false);
  check('photo slide: the reader\'s own result is kept whole for remembering', slide.ink.raw === result && result.lines.length === 42);
  const stats = reading.count({ pages: [slide] });
  check('photo slide: counts hold only what remains', stats.pages === 1 && stats.regions === 2 && stats.low === 0, JSON.stringify(stats));

  // nothing but fragments: a photograph. Not listed, not counted, and not mistaken for a blank page
  const photo = imagePage(2);
  ocr.applyToPage(photo, resultOf(2, fragmentRows(60)));
  check('photograph: only noise -> a picture, nothing listed', photo.ink.picture === true && photo.ink.held === false && photo.ink.emptyRender === false && photo.ink.result.lines.length === 0 && ocr.lowConfidence(photo).length === 0);
  check('photograph: it counts as decorative, not as an empty page', summary.classOf(photo) === 'decorative' && photo.ink.pictureResult.lines.length === 60);
  const both = reading.count({ pages: [slide, photo] });
  check('photograph: a read picture adds a page but no pieces', both.pages === 2 && both.regions === 2 && both.low === 0, JSON.stringify(both));

  // one unsure real line among the fragments: it is the one thing the student is asked about
  const doubt = imagePage(3);
  ocr.applyToPage(doubt, resultOf(3, fragmentRows(30).concat([
    ['Median nerve lies deep to the tendon.', 0.92, 100, 500, 400],
    ['Ulnar artery runs beside the nerve here.', 0.9, 100, 530, 400],
    ['label half hidden by the probe', 0.35, 100, 560, 300],
  ])));
  check('one doubtful line: exactly that line is listed for review', ocr.lowConfidence(doubt).length === 1 && ocr.lowConfidence(doubt)[0].text === 'label half hidden by the probe' && doubt.lines.length === 2);

  // a correction to a kept piece still works when the result was stripped, and is judged from the whole result
  ocr.applyCorrection(doubt, 'p3-l32-r0', 'Label: flexor retinaculum.');
  check('correction: applied to a stripped page, the page is rebuilt from the reader\'s result', doubt.lines.length === 3 && ocr.lowConfidence(doubt).length === 0 && doubt.ink.corrected === true && doubt.ink.raw.lines.length === 33);
  check('correction: an unknown piece changes nothing', ocr.applyCorrection(doubt, 'p3-l0-r0', 'x') === false);
}

function heldOrPictureTests() {
  // handwriting the reader could not make out: every piece unsure, but they are lines
  const unsureLines = [
    ['the cords are narned for their relation', 0.41, 80, 100, 500],
    ['to the axilary artery', 0.38, 80, 140, 320],
    ['lateral cord forrns the rnusculocutaneous', 0.33, 80, 180, 520],
    ['posterior cord gives axilary and radial', 0.45, 80, 220, 500],
    ['rnedial cord gives the ulnar nerve', 0.29, 80, 260, 460],
    ['both rnedial and lateral forrn the rnedian', 0.36, 80, 300, 540],
  ];
  const notes = imagePage(1);
  ocr.applyToPage(notes, resultOf(1, unsureLines.concat(fragmentRows(5))));
  check('unsure handwriting: the page is held, not taken for a picture', notes.ink.held === true && notes.ink.picture === false && notes.lines.length === 0);
  check('unsure handwriting: its lines are listed for review, the fragments are not', ocr.lowConfidence(notes).length === 6, String(ocr.lowConfidence(notes).length));
  check('unsure handwriting: the page still counts as needing reading', summary.classOf(notes) === 'needsReading');
  const v = merge.judge(noise.strip(resultOf(1, unsureLines)));
  check('judge: reports the unsure lines it saw', v.lowLines === 6 && v.held === true && v.picture === false && v.lowShare === 1, JSON.stringify(v));
  for (let i = 0; i < 5; i++) ocr.applyCorrection(notes, `p1-l${i}-r0`, unsureLines[i][0].replace(/rn/g, 'm'));
  check('unsure handwriting: correcting most of it releases the page', notes.ink.held === false && notes.lines.length === 5 && ocr.lowConfidence(notes).length === 1, `${notes.lines.length} lines`);

  // a diagram with two half-read labels and nothing sure: still a picture, dropped without a word
  const diagram = imagePage(2);
  ocr.applyToPage(diagram, resultOf(2, fragmentRows(25).concat([['superior trunk', 0.3, 200, 200, 150], ['rniddle trunk', 0.35, 200, 300, 150]])));
  check('diagram: fewer unsure lines than HOLD_MIN_LINES and no sure words -> picture', diagram.ink.picture === true && diagram.ink.held === false && ocr.lowConfidence(diagram).length === 0 && merge.HOLD_MIN_LINES === 3);

  // exactly at the line count: held
  const three = imagePage(3);
  ocr.applyToPage(three, resultOf(3, unsureLines.slice(0, 3)));
  check('hold: HOLD_MIN_LINES unsure lines are enough to hold the page', three.ink.held === true && three.ink.picture === false && ocr.lowConfidence(three).length === 3);

  // a stopped reading and a too-busy page decide nothing
  const stopped = Object.assign(resultOf(4, fragmentRows(10)), { partial: true });
  const busy = Object.assign(resultOf(5, []), { skippedReason: 'too-many-regions' });
  check('judge: a reading that was stopped is not called a picture or an empty page', !merge.judge(noise.strip(stopped)).picture && !merge.judge(noise.strip(stopped)).emptyRender && !merge.judge(busy).emptyRender);
  const bare = imagePage(6);
  ocr.applyToPage(bare, resultOf(6, []));
  check('empty page: nothing found at all is still an empty page', bare.ink.emptyRender === true && bare.ink.picture === false && summary.classOf(bare) === 'empty');
}

function fontSizeTests() {
  // a page that was straightened before reading: `box` is the upright rectangle around a sloping line (tall,
  // and taller the longer the line), `size` is the line itself
  const sloped = (text, y, w, lineH) => [text, 0.9, 60, y, w, { box: { x: 60, y, w, h: lineH + Math.round(w * 0.09) }, size: { w, h: lineH } }];
  const rows = [
    sloped('Brachial plexus', 60, 260, 34),
    sloped('Five roots join to make three trunks above the clavicle.', 130, 620, 22),
    sloped('Each trunk splits into two divisions.', 180, 420, 22),
    sloped('The divisions regroup as three cords.', 230, 430, 22),
    sloped('Cords', 280, 70, 22),
  ];
  const turned = resultOf(1, rows);
  turned.lines.forEach((l) => { l.box = l.regions[0].box; });
  const lines = ocr.toPageLines(turned, { width: W, height: H });
  const sizes = lines.map((l) => l.fontSize);
  check('turned page: the title is found by the height of its writing', sizes[0] === 16 && sizes.slice(1).every((s) => s >= 9 && s <= 12), JSON.stringify(sizes));
  check('turned page: a short line is body text although its box is the smallest', sizes[4] === 11 && sizes[1] === 11, JSON.stringify(sizes));
  check('turned page: positions still come from the page rectangle', lines[1].bottomY - lines[1].topY === 22 + Math.round(620 * 0.09));

  // the same boxes without `size` (the old behaviour): the title is missed, and the longest body line,
  // whose rectangle is the tallest, comes out larger than the title
  const noSize = resultOf(2, rows.map((r) => [r[0], r[1], r[2], r[3], r[4], { box: r[5].box }]));
  const old = ocr.toPageLines(noSize, { width: W, height: H }).map((l) => l.fontSize);
  check('turned page: without the written height the sizes follow the rectangles instead', old[0] < 16 && old[1] > old[0] && old[4] < 11, JSON.stringify(old));

  // a level page carries no `size` and is sized from its boxes as before
  const level = resultOf(3, [
    ['Brachial plexus', 0.9, 60, 60, 260, { box: { x: 60, y: 60, w: 260, h: 34 } }],
    ['Five roots join to make three trunks.', 0.9, 60, 130, 500, { box: { x: 60, y: 130, w: 500, h: 22 } }],
    ['Each trunk splits into two divisions.', 0.9, 60, 180, 420, { box: { x: 60, y: 180, w: 420, h: 22 } }],
  ]);
  check('level page: sizes come from the boxes', ocr.toPageLines(level, { width: W, height: H }).map((l) => l.fontSize).join() === '16,11,11');
}

for (const [name, fn] of [['rule', ruleTests], ['strip', stripTests], ['photo slide', photoSlideTests], ['held or picture', heldOrPictureTests], ['font size', fontSizeTests]]) {
  try { fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
}
console.log(`handwriting_noise_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

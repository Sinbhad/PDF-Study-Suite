/**
 * "Check what was read" screen, the parts with no DOM (Node): hw-check-model.js (rows, page states, the
 * queue of lines to check), hw-check-text.js (strings), hw-check-keys.js (key map), hw-page-geometry.js
 * (box placement, zoom, strip crop) and the state markup of hw-check-states.js.
 * Run: node tests/hw_check_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const lines = src('pdf', 'ocr-lines.js');
const E = src('pdf', 'ocr-edits.js');
const M = src('ui', 'hw-check-model.js');
const T = src('ui', 'hw-check-text.js');
const K = src('ui', 'hw-check-keys.js');
const G = src('ui', 'hw-page-geometry.js');
const States = src('ui', 'hw-check-states.js');
const review = src('ui', 'hw-review.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const WORDS = ['Cell respiration notes here', 'glycolysis splits glucose in two', 'happens in the cytoplasm', 'net gain of two ATP', 'the Krebs cycle follows', 'oxygen accepts the electrons'];
function readPage(n, confs, kinds) {
  const result = {
    pageNumber: n, width: 1200, height: 1600, scale: 2,
    lines: confs.map((c, i) => ({
      index: i,
      regions: [{ id: `p${n}-l${i}-r0`, text: WORDS[i], confidence: c, kind: (kinds && kinds[i]) || 'text', source: 'model', box: { x: 100, y: 100 + i * 120, w: 800, h: 60 } }],
    })),
  };
  const page = { pageNumber: n, width: 600, height: 800, lines: [], wordCount: 0, ink: { needsRecognition: true } };
  lines.applyToPage(page, result);
  return page;
}
const docOf = (pages) => ({ numPages: 24, pages, pageCache: new Map(pages.map((p) => [p.pageNumber, p])) });
const ON = { available: true };

// 1. Rows: numbering without gaps, states as words, parts
let page = readPage(3, [0.9, 0.2, 0.9, 0.3, 0.9, 0.9], ['text', 'math']);
let rows = M.rows(page);
check('rows: one per line, states from confidence', rows.length === 6 && rows.map((r) => r.state).join() === 'confident,check,confident,check,confident,confident');
check('fieldName: maths line to check', T.fieldName(rows[1]) === 'Line 2, maths, needs checking', T.fieldName(rows[1]));
check('fieldName: plain confident line', T.fieldName(rows[5]) === 'Line 6');
check('tags: state then Maths', T.tags(rows[1]).join() === 'Check,Maths' && T.tags(rows[0]).length === 0);
E.setText(page, 'p3-l3-r0', 'net gain of two ATP');
E.removeRegion(page, 'p3-l0-r0');
E.setRegionKind(page, 'p3-l4-r0', 'picture');
E.addRegion(page, 'p3-l5-r0', 'typed by the student');
rows = M.rows(page);
check('rows: removed line gone, numbers close up', rows.length === 6 && rows[0].id === 'p3-l1-r0' && rows.map((r) => r.line).join() === '1,2,3,4,5,6');
check('rows: checked / picture / added states', rows.map((r) => r.state).join() === 'check,confident,checked,picture,confident,added', rows.map((r) => r.state).join());
check('tags: Checked, Picture, Added', T.tags(rows[2])[0] === 'Checked' && T.tags(rows[3])[0] === 'Picture' && T.tags(rows[5])[0] === 'Added');
const two = readPage(4, [0.9, 0.9, 0.9]);
two.ink.result.lines[1].regions.push({ id: 'p4-l1-r1', text: 'x^2', confidence: 0.9, kind: 'math', source: 'user', box: { x: 950, y: 220, w: 100, h: 60 } });
check('fieldName: second part of a line', T.fieldName(M.rows(two)[2]) === 'Line 2, part 2, maths, checked', T.fieldName(M.rows(two)[2]));

// 2. Page states
check('status: lines', M.status(readPage(1, [0.9, 0.9, 0.3, 0.9, 0.9, 0.9]), ON) === 'lines');
const held = readPage(2, [0.2, 0.3, 0.9, 0.9, 0.9, 0.9]);
check('status: a page held for review is hard until its lines are shown', held.ink.held === true && M.status(held, ON) === 'hard');
E.releasePicture(held);
check('status: shown -> lines', M.status(held, ON) === 'lines');
// A picture page is one where the reader found only fragments (pdf/ocr-noise.js): the page keeps them as guesses
const pic = { pageNumber: 5, width: 600, height: 800, lines: [], wordCount: 0, ink: { needsRecognition: true } };
lines.applyToPage(pic, { pageNumber: 5, width: 1200, height: 1600, scale: 2, lines: ['ab', 'x.', 'qz'].map((text, i) => ({
  index: i, regions: [{ id: `p5-l${i}-r0`, text, confidence: 0.2, kind: 'text', source: 'model', box: { x: 100, y: 100 + i * 120, w: 80, h: 60 } }],
})) });
check('status: picture page with guesses is hard, counts nothing', M.status(pic, ON) === 'hard' && M.entry(pic, ON).toCheck === 0 && M.guesses(pic) === 3);
const blank = { pageNumber: 6, width: 600, height: 800, lines: [], wordCount: 0, ink: { needsRecognition: true } };
lines.applyToPage(blank, { pageNumber: 6, width: 1200, height: 1600, scale: 2, lines: [] });
check('status: nothing found', M.status(blank, ON) === 'empty');
E.keepPageAsPicture(blank, true);
check('status: page kept as a picture', M.status(blank, ON) === 'picture');
const waiting = { pageNumber: 7, width: 600, height: 800, lines: [], ink: { needsRecognition: true, reading: true } };
check('status: still reading', M.status(waiting, ON) === 'reading');
const never = { pageNumber: 8, width: 600, height: 800, lines: [], ink: { needsRecognition: true } };
check('status: unread page is listed only where pages cannot be read', M.status(never, ON) === 'none' && M.status(never, { available: false }) === 'unread');
check('status: typed page is not listed', M.status({ pageNumber: 9, lines: [{ text: 'typed' }], ink: { needsRecognition: false } }, ON) === 'none');
const passedBy = readPage(10, [0.9, 0.2, 0.9, 0.9, 0.9, 0.9]);
E.skipPage(passedBy, true);
check('status: skipped, still counted', M.status(passedBy, ON) === 'skipped' && M.entry(passedBy, ON).toCheck === 1);

// 3. Page list, tally, where to open
const p1 = readPage(1, [0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
const p3 = readPage(3, [0.9, 0.2, 0.9, 0.3, 0.9, 0.9]);
const p11 = readPage(11, [0.9, 0.9, 0.2, 0.9, 0.9, 0.9]);
const doc = docOf([p11, p3, p1, blank, waiting, never, passedBy]);
const list = M.pages(doc, ON);
check('pages: page order, unlisted pages left out', list.map((e) => e.pageNumber).join() === '1,3,6,7,10,11', list.map((e) => e.pageNumber).join());
check('tally: pages read, lines left, skipped pages, pages being read', JSON.stringify(M.tally(doc, ON)) === JSON.stringify({ pages: 5, low: 4, passed: 1, reading: 1 }), JSON.stringify(M.tally(doc, ON)));
check('startPage: first page with work in the selected range', M.startPage(list, { startPage: 1, endPage: 24 }) === 3 && M.startPage(list, { startPage: 10, endPage: 24 }) === 11);
check('startPage: nothing to do in range -> first with work anywhere', M.startPage(list, { startPage: 1, endPage: 1 }) === 3);

// 4. The queue of lines to check
rows = M.rows(p3);
check('nextOnPage: forward, then round to the first', M.nextOnPage(rows, 'p3-l1-r0', 1) === 'p3-l3-r0' && M.nextOnPage(rows, 'p3-l3-r0', 1) === 'p3-l1-r0');
check('nextOnPage: back', M.nextOnPage(rows, 'p3-l3-r0', -1) === 'p3-l1-r0');
E.setText(p3, 'p3-l1-r0', WORDS[1]);
check('nextOnPage: null when the line itself is the last one', M.nextOnPage(M.rows(p3), 'p3-l3-r0', 1) === null);
check('neighbour: any state, no going round', M.neighbour(M.rows(p3), 'p3-l0-r0', 1) === 'p3-l1-r0' && M.neighbour(M.rows(p3), 'p3-l0-r0', -1) === null);
check('nextUnsure: crosses to the next page, past the skipped one', JSON.stringify(M.nextUnsure(doc, ON, { pageNumber: 3, id: 'p3-l3-r0' }, 1)) === '{"pageNumber":11,"id":"p11-l2-r0"}');
check('nextUnsure: goes round to earlier pages', JSON.stringify(M.nextUnsure(doc, ON, { pageNumber: 11, id: 'p11-l2-r0' }, 1)) === '{"pageNumber":3,"id":"p3-l3-r0"}');
check('nextUnsure: from a page with no list', JSON.stringify(M.nextUnsure(doc, ON, { pageNumber: 6, id: null }, -1)) === '{"pageNumber":3,"id":"p3-l3-r0"}');
E.setText(p3, 'p3-l3-r0', WORDS[3]);
E.setText(p11, 'p11-l2-r0', WORDS[2]);
check('nextUnsure: null when nothing is left', M.nextUnsure(doc, ON, { pageNumber: 3, id: 'p3-l3-r0' }, 1) === null);

// 5. Strings
check('progress: lines to check', T.progress({ pageNumber: 3, status: 'lines', toCheck: 5 }, 24, 0) === 'Page 3 of 24 · 5 lines to check');
check('progress: nothing left to check, pages still being read', T.progress({ pageNumber: 3, status: 'lines', toCheck: 0 }, 24, 4) === 'Page 3 of 24 · nothing left to check · 4 pages still being read');
const labels = [['lines', 5, 'Page 3 · 5 to check'], ['lines', 0, 'Page 3 · nothing to check'], ['reading', 0, 'Page 3 · still reading'], ['empty', 0, 'Page 3 · nothing found'], ['skipped', 2, 'Page 3 · skipped']];
check('optionLabel: every state', labels.every(([status, toCheck, want]) => T.optionLabel({ pageNumber: 3, status, toCheck }) === want));
check('pageAnnouncement', T.pageAnnouncement({ pageNumber: 3, status: 'lines', toCheck: 5 }, 24) === 'Page 3 of 24. 5 lines to check.');
check('checkedAnnouncement', T.checkedAnnouncement({ line: 3 }, 4, 3) === 'Line 3 checked. 4 left on this page.' && T.checkedAnnouncement({ line: 3 }, 0, 3) === 'All lines on page 3 checked.');
check('looksRightNote', T.looksRightNote(4) === 'Accepts the 4 lines left to check on this page.');
check('doneMessage', T.doneMessage({ lines: 12, pictures: 0, typed: 0 }) === '12 lines corrected · cards updated'
  && T.doneMessage({ lines: 1, pictures: 1, typed: 2 }) === '1 line corrected · cards updated · 1 picture kept · 2 pages typed in');
const notice = review.noticeHtml({ pages: 6, low: 38, passed: 2, skipped: 0, engine: { available: true } });
check('notice: counts, skipped pages named, Check text', notice.includes('Read text from 6 picture pages. 38 lines may be wrong and are left out until you check them. 2 pages skipped.') && notice.includes('>Check text<'), notice);
check('notice: nothing left', review.noticeHtml({ pages: 6, low: 0, skipped: 0, engine: { available: true } }).includes('No lines look doubtful.'));
const shown = [notice, review.noticeHtml({ pages: 2, low: 0, engine: { available: false } })].concat(['reading', 'empty', 'hard', 'picture', 'skipped', 'unread', 'type']
  .map((k) => States.html(k, { pageNumber: 3, total: 24, left: 2, guesses: 3, reason: 'not installed' }))).join(' ').replace(/<[^>]+>/g, ' ');
check('no reader jargon on screen', !/\b(OCR|model|confidence|regions?)\b/i.test(shown), shown.match(/\b(OCR|model|confidence|regions?)\b/i));
check('states: each has a focusable title and a way on', ['reading', 'empty', 'hard', 'picture', 'skipped'].every((k) => {
  const h = States.html(k, { pageNumber: 3, total: 24, left: 2, guesses: 3 });
  return h.includes('id="hwStateTitle" tabindex="-1"') && /data-act="/.test(h);
}));

// 6. Keys
const key = (k, mods) => Object.assign({ key: k, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false }, mods);
const map = [
  ['Enter', {}, 'field', 'accept'], ['Enter', { shiftKey: true }, 'field', 'back'], ['Enter', { ctrlKey: true }, 'field', 'add'],
  ['Enter', { metaKey: true }, 'field', 'add'], ['Enter', { ctrlKey: true, shiftKey: true }, 'field', 'accept-page'],
  ['ArrowDown', { altKey: true }, 'field', 'next-line'], ['ArrowUp', { altKey: true }, 'field', 'prev-line'], ['ArrowDown', {}, 'field', null],
  ['F8', {}, 'field', 'next-unsure'], ['F8', { shiftKey: true }, 'other', 'prev-unsure'], ['F8', {}, 'image', 'next-unsure'],
  ['ArrowLeft', {}, 'image', 'pan-left'], ['+', {}, 'image', 'zoom-in'], ['-', {}, 'image', 'zoom-out'], ['0', {}, 'image', 'fit'],
  ['Enter', {}, 'other', null], ['a', {}, 'field', null], ['0', {}, 'field', null],
];
check('keys: the whole map', map.every(([k, mods, where, want]) => K.actionFor(key(k, mods), where) === want), map.filter(([k, mods, where, want]) => K.actionFor(key(k, mods), where) !== want).map((m) => m[0]).join());

// 7. Geometry
const size = G.readSize({ width: 1200, height: 1600, scale: 2 }, { width: 600, height: 800 });
check('readSize: from the result, else page points times scale', size.w === 1200 && G.readSize({ scale: 2 }, { width: 600, height: 800 }).h === 1600);
check('boxPercent: a box as shares of the page', JSON.stringify(G.boxPercent({ x: 120, y: 400, w: 600, h: 80 }, size)) === '{"left":10,"top":25,"width":50,"height":5}');
check('boxPercent: kept on the page, null without a box', G.boxPercent({ x: 1100, y: 0, w: 400, h: 10 }, size).width < 8.4 && G.boxPercent(null, size) === null);
check('zoom: steps of 20 between 70% and 240%', G.zoomStep(1, 1) === 1.2 && G.zoomStep(0.7, -1) === 0.7 && G.zoomStep(2.4, 1) === 2.4 && G.zoomLabel(1.2) === '120%');
check('pinchZoom: fingers twice as far apart, capped', G.pinchZoom(1, 100, 200) === 2 && G.pinchZoom(2, 100, 300) === 2.4);
check('hitPad: small boxes get room, large ones none', G.hitPad(10, 40).x === 7 && G.hitPad(10, 40).y === 0);
const rect = G.stripRect({ x: 200, y: 800, w: 900, h: 60 }, { w: 1600, h: 2200 }, 343 / 112);
check('stripRect: the line with context, in the strip\'s shape, on the page', rect.w >= 900 && rect.h >= 90 && Math.abs(rect.w / rect.h - 343 / 112) < 0.05 && rect.x >= 0 && rect.x + rect.w <= 1600 && rect.y < 800 && rect.y + rect.h > 860, JSON.stringify(rect));
check('stripRect: a line at the top edge stays on the page', G.stripRect({ x: 0, y: 0, w: 1600, h: 40 }, { w: 1600, h: 2200 }, 3).y === 0);
check('scaleBox: read pixels to another rendering', JSON.stringify(G.scaleBox({ x: 120, y: 400, w: 600, h: 80 }, size, 1600)) === JSON.stringify({ x: 160, y: 400 * (1600 / 1200), w: 800, h: 80 * (1600 / 1200) }));
check('centreScroll: line in the middle, never past the ends', JSON.stringify(G.centreScroll({ left: 100, top: 900, width: 400, height: 40 }, { width: 600, height: 500 }, { width: 600, height: 1500 })) === '{"left":0,"top":670}'
  && G.centreScroll({ left: 0, top: 1480, width: 10, height: 20 }, { width: 600, height: 500 }, { width: 600, height: 1500 }).top === 1000);

console.log(`hw_check_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

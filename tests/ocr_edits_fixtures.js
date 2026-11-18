/**
 * Edits to a read page (Node): src/pdf/ocr-edits.js, ocr-page-edits.js and ocr-edit-record.js.
 * Remove / restore, add a line, keep as picture, accept a page, type a page in, show a picture page's
 * lines, the onChange seam, and serialise / restore onto a page that was read again.
 * Run: node tests/ocr_edits_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const lines = src('pdf', 'ocr-lines.js');
const E = src('pdf', 'ocr-edits.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const TEXTS = ['Cell respiration notes', 'glycolysis splits glucose in two', 'happens in the cytoplasm', 'net gain of two ATP', 'the Krebs cycle follows'];
/** A read page: one region per line; `confs` gives each line's confidence, `sources` (optional) each line's source. */
function readPage(n, confs, texts, sources) {
  const result = {
    pageNumber: n, width: 1200, height: 1600, scale: 2,
    lines: confs.map((c, i) => ({
      index: i,
      regions: [{ id: `p${n}-l${i}-r0`, text: (texts || TEXTS)[i], confidence: c, kind: 'text', source: (sources && sources[i]) || 'model', box: { x: 100, y: 100 + i * 120, w: 800, h: 60 } }],
    })),
  };
  const page = { pageNumber: n, width: 600, height: 800, lines: [], wordCount: 0, ink: { needsRecognition: true } };
  lines.applyToPage(page, result);
  return page;
}
const textOf = (page) => page.lines.map((l) => l.text);
const ids = (regions) => regions.map((r) => r.id);

// 1. Remove then restore gives the same study lines
let page = readPage(1, [0.9, 0.9, 0.3, 0.9, 0.9]);
const before = JSON.stringify(textOf(page));
check('read page: confident lines are study text, the unsure one is not', page.lines.length === 4 && !before.includes('cytoplasm'), before);
check('toCheck: the unsure line, in reading order', JSON.stringify(ids(E.toCheck(page))) === '["p1-l2-r0"]');
check('removeRegion: true, line leaves the study text', E.removeRegion(page, 'p1-l1-r0') && page.lines.length === 3 && !JSON.stringify(textOf(page)).includes('glycolysis'));
check('removeRegion: a removed line is not listed to check', E.toCheck(page).length === 1 && lines.lowConfidence(page).length === 1);
check('removeRegion twice: false', E.removeRegion(page, 'p1-l1-r0') === false);
check('restoreRegion: identical study lines', E.restoreRegion(page, 'p1-l1-r0') && JSON.stringify(textOf(page)) === before, JSON.stringify(textOf(page)));

// 2. Accepting text: reuses applyCorrection; a draft stays to be checked
check('setText: accepted line joins the study text', E.setText(page, 'p1-l2-r0', 'happens in the\ncytoplasm ') && textOf(page).includes('happens in the cytoplasm') && E.toCheck(page).length === 0);
check('setText: source user, confidence 1', E.find(page, 'p1-l2-r0').region.source === 'user' && E.find(page, 'p1-l2-r0').region.confidence === 1);
page = readPage(1, [0.9, 0.9, 0.3, 0.9, 0.9]);
E.setText(page, 'p1-l2-r0', 'a draft', { accept: false });
check('setText accept:false keeps the line to check with its new text', E.toCheck(page).length === 1 && E.toCheck(page)[0].text === 'a draft' && !textOf(page).includes('a draft'));

// 3. Picture lines stay out of the study text and are listed by pictures()
check('setRegionKind picture: out of the lines, in pictures()', E.setRegionKind(page, 'p1-l3-r0', 'picture') && !JSON.stringify(textOf(page)).includes('ATP')
  && JSON.stringify(E.pictures(page)) === JSON.stringify([{ pageNumber: 1, box: { x: 100, y: 460, w: 800, h: 60 }, scale: 2 }]), JSON.stringify(E.pictures(page)));
check('setRegionKind text: the words come back', E.setRegionKind(page, 'p1-l3-r0', 'text') && JSON.stringify(textOf(page)).includes('ATP') && E.pictures(page).length === 0);
E.keepPageAsPicture(page, true);
check('keepPageAsPicture: the whole page is a picture', E.pictures(page).length === 1 && E.pictures(page)[0].box.w === 1200);
E.keepPageAsPicture(page, false);

// 4. Adding a line: after the given line, no box, renumbered, sorted into place
const added = E.addRegion(page, 'p1-l0-r0', 'a line the reader missed');
const res = E.resultOf(page);
check('addRegion: id m-1, second line, indexes renumbered', added === 'm-1' && res.lines[1].regions[0].id === 'm-1' && res.lines.every((l, i) => l.index === i), JSON.stringify(res.lines.map((l) => l.index)));
const made = res.lines[1].regions[0];
check('addRegion: manual, confidence 1, no box', made.text === 'a line the reader missed' && made.confidence === 1 && made.box === null && made.kind === 'text' && made.source === 'manual', JSON.stringify(made));
check('addRegion: its text is the second study line', textOf(page)[1] === 'a line the reader missed', JSON.stringify(textOf(page)));
check('addRegion: next id is m-2, at the end when no line is named', E.addRegion(page, null, 'last') === 'm-2' && E.resultOf(page).lines.slice(-1)[0].regions[0].id === 'm-2');

// 5. confirmPage: one re-derive, nothing left to check, and it can be taken back
page = readPage(2, [0.2, 0.9, 0.3, 0.1, 0.9], ['First unsure line here', 'A sure line of words', 'Second unsure line here', '', 'Another sure line'], [0, 0, 0, 'manual']);
// The empty line is one waiting to be typed in (source 'manual'): an empty piece from the reader is noise and never listed
let merges = 0;
const realApply = lines.applyToPage;
lines.applyToPage = (...a) => { merges++; return realApply(...a); };
const prior = E.confirmPage(page);
lines.applyToPage = realApply;
check('confirmPage: toCheck empty after one merge', E.toCheck(page).length === 0 && merges === 1, `merges ${merges}`);
check('confirmPage: returns the three lines it touched', JSON.stringify(ids(prior)) === '["p2-l0-r0","p2-l2-r0","p2-l3-r0"]');
check('confirmPage: accepted lines are study text, the empty one is removed', page.lines.length === 4 && E.isRemoved(E.find(page, 'p2-l3-r0').region));
E.undoConfirm(page, prior);
check('undoConfirm: the same three are to check again', E.toCheck(page).length === 3 && E.find(page, 'p2-l0-r0').region.source === 'model');

// 6. The seam: every change calls ocrEdits.onChange once; the default saves through ocrStore when there is one
const saved = [];
globalThis.PDFStudy.ocrStore = { savePage: (p) => saved.push(p.pageNumber) };
E.removeRegion(page, 'p2-l1-r0');
E.skipPage(page, true);
check('onChange default: ocrStore.savePage(page) after each change', JSON.stringify(saved) === '[2,2]', JSON.stringify(saved));
delete globalThis.PDFStudy.ocrStore;
const seen = [];
const realChange = E.onChange;
E.onChange = (p) => seen.push(p.pageNumber);
E.restoreRegion(page, 'p2-l1-r0');
E.onChange = realChange;
check('onChange can be replaced (one call per change)', JSON.stringify(seen) === '[2]');
E.skipPage(page, false);

// 7. A page judged to be a picture (the reader found only fragments, pdf/ocr-noise.js): its lines come back to
// be checked and stay while they are edited
page = readPage(3, [0.2, 0.3, 0.1], ['ab', 'x.', 'qz']);
check('picture page: nothing listed until shown', page.ink.picture === true && page.ink.result.lines.length === 0 && E.toCheck(page).length === 0);
check('releasePicture: all lines to check', E.releasePicture(page) && E.toCheck(page).length === 3 && page.ink.result.lines.length === 3);
E.setText(page, 'p3-l0-r0', 'Mitosis');
check('one checked word: the other lines are still on the page', page.ink.result.lines.length === 3 && E.toCheck(page).length === 2);
E.setText(page, 'p3-l1-r0', 'the cell divides in two');
check('enough checked words: they become study text', textOf(page).includes('the cell divides in two') && page.ink.picture === false);

// 8. Typing a page in, and taking it back
page = readPage(4, [0.2, 0.3, 0.1, 0.2], ['ab', 'cd', 'e.', 'gh']);
check('typePage: one line per non-empty line', E.typePage(page, 'First typed line\n\n  Second typed line  \r\nThird') === 3 && JSON.stringify(textOf(page)) === '["First typed line","Second typed line","Third"]', JSON.stringify(textOf(page)));
check('typePage: nothing to check, old result kept', E.toCheck(page).length === 0 && page.ink.typedIn === true && page.ink.replacedResult.lines.length === 4);
check('typePage: empty text changes nothing', E.typePage(readPage(9, [0.9]), '  \n ') === 0);
check('undoTypePage: back to a page taken for a picture, not shown', E.undoTypePage(page) && page.ink.typedIn === false && page.ink.picture === true && E.toCheck(page).length === 0 && page.lines.length === 0);
const unread = { pageNumber: 7, width: 600, height: 800, lines: [], wordCount: 0 };
check('typePage on a page that was never read', E.typePage(unread, 'Typed by hand') === 1 && unread.ink.recognised === true && textOf(unread)[0] === 'Typed by hand');

// 9. serialise / restore: edits survive a second reading of the page, and applying twice changes nothing
page = readPage(5, [0.9, 0.3, 0.9, 0.2, 0.9]);
check('serialise: null for a page with no edits', E.serialise(page) === null);
E.setText(page, 'p5-l1-r0', 'glycolysis splits glucose');
E.removeRegion(page, 'p5-l2-r0');
E.setRegionKind(page, 'p5-l4-r0', 'picture');
E.addRegion(page, 'p5-l0-r0', 'an added line');
E.skipPage(page, true);
const data = JSON.parse(JSON.stringify(E.serialise(page)));
const want = JSON.stringify(textOf(page));
const again = readPage(5, [0.9, 0.3, 0.9, 0.2, 0.9]);
check('restore: true, same study lines as the edited page', E.restore(again, data) && JSON.stringify(textOf(again)) === want, `${JSON.stringify(textOf(again))} vs ${want}`);
check('restore: flags, picture and remaining unsure line', again.ink.checkSkipped === true && E.pictures(again).length === 1 && JSON.stringify(ids(E.toCheck(again))) === '["p5-l3-r0"]');
E.restore(again, data);
check('restore twice: no second added line', E.resultOf(again).lines.length === 6 && JSON.stringify(textOf(again)) === want);
check('restore: the removed line can still be brought back', E.restoreRegion(again, 'p5-l2-r0') && textOf(again).includes(TEXTS[2]));
check('restore: wrong version or nothing -> false', E.restore(readPage(5, [0.9]), null) === false && E.restore(readPage(5, [0.9]), { v: 99 }) === false);
const typed = readPage(6, [0.2, 0.2, 0.2], ['x y z', 'x y z', 'x y z']);
E.typePage(typed, 'Line one typed\nLine two typed');
E.removeRegion(typed, 'm-2');
const typedData = JSON.parse(JSON.stringify(E.serialise(typed)));
const typedAgain = readPage(6, [0.2, 0.2, 0.2], ['x y z', 'x y z', 'x y z']);
E.restore(typedAgain, typedData);
check('restore: a typed-in page with a later edit', JSON.stringify(textOf(typedAgain)) === '["Line one typed"]' && typedAgain.ink.typedIn === true && E.restoreRegion(typedAgain, 'm-2'), JSON.stringify(textOf(typedAgain)));

console.log(`ocr_edits_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

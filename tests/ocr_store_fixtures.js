/**
 * Edits from "Check what was read" are remembered with the page's reading (Node, in-memory document store):
 * PDFStudy.ocrStore.savePage (src/ui/ocr-cache.js) after every change, and ocrCache.restore putting the
 * reading back with the edits on top. Text fixes, removed, added and kept-as-picture lines, a page kept as a
 * picture, "Looks right", a skipped page and a typed-in page all come back on a new copy of the document; a
 * new reader version drops line edits but keeps a typed-in page; the noise rule keeps what the student touched.
 * Every text here is invented for the test.
 * Run: node tests/ocr_store_fixtures.js
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

const ocr = src('pdf', 'ocr-lines.js');
const noise = src('pdf', 'ocr-noise.js');
const E = src('pdf', 'ocr-edits.js');
const pipe = src('hw', 'hw-pipeline.js');
const store = src('ui', 'doc-store.js');
const cache = src('ui', 'ocr-cache.js');
const P = globalThis.PDFStudy;

store.configure({ memoryOnly: true });
let openDoc = 'doc-edits';
P.docSession = { id: () => openDoc };

const TEXTS = [
  ['Notes on the cell cycle', 0.95],
  ['interphase comes before mitosis', 0.4],
  ['the spindle pulls chromatids apart', 0.92],
  ['a line written over a drawing', 0.9],
  ['cytokinesis splits the cell in two', 0.35],
];
const resultFor = (n) => ({
  pageNumber: n, scale: 2, width: 1200, height: 1600, engine: 'ppocr-v5',
  lines: TEXTS.map(([text, confidence], i) => {
    const box = { x: 100, y: 100 + i * 120, w: 800, h: 60 };
    return { index: i, box, regions: [{ id: `p${n}-l${i}-r0`, kind: 'text', box, text: `${text} ${n}`, confidence, source: 'model' }] };
  }),
});
const blankPage = (n) => ({ pageNumber: n, width: 600, height: 800, lines: [], wordCount: 0, ink: { needsRecognition: true, reason: 'no-text', pathOps: 0, imageOps: 1 } });
const docOf = (count) => {
  const pages = Array.from({ length: count }, (_, i) => blankPage(i + 1));
  return { numPages: count, pages, pageCache: new Map(pages.map((p) => [p.pageNumber, p])) };
};
const textOf = (page) => page.lines.map((l) => l.text);
const idle = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // A first session: three pages read, each saved as the reader gave it
  const first = docOf(3);
  for (const n of [1, 2, 3]) {
    ocr.applyToPage(first.pageCache.get(n), resultFor(n));
    await cache.save(first, n);
  }
  check('the seam the correction screen calls is installed', P.ocrStore && typeof P.ocrStore.savePage === 'function');

  // Page 1: fix a line, remove one, add one, keep one as a picture
  const p1 = first.pageCache.get(1);
  E.setText(p1, 'p1-l1-r0', 'interphase comes before mitosis');
  E.removeRegion(p1, 'p1-l2-r0');
  E.addRegion(p1, 'p1-l0-r0', 'a line the reader missed');
  E.setRegionKind(p1, 'p1-l3-r0', 'picture');
  // Page 2: "Looks right" on the whole page, and the page skipped for now
  const p2 = first.pageCache.get(2);
  E.confirmPage(p2);
  // Page 3: typed in
  const p3 = first.pageCache.get(3);
  E.typePage(p3, 'First line typed by the student\nSecond line typed by the student');
  await idle();
  const want = [1, 2, 3].map((n) => JSON.stringify(textOf(first.pageCache.get(n))));
  const pictures1 = JSON.stringify(E.pictures(p1));

  check('removed and picture lines stay in the result (the noise rule keeps what the student touched)',
    E.find(p1, 'p1-l2-r0') && E.isRemoved(E.find(p1, 'p1-l2-r0').region) && E.find(p1, 'p1-l3-r0') && E.isPicture(E.find(p1, 'p1-l3-r0').region));
  check('noise rule: removed, kept, added and edited pieces are never noise',
    !noise.isNoise({ text: '', confidence: 1, source: 'model', removed: { text: 'x' } })
    && !noise.isNoise({ text: '', confidence: 1, source: 'model', kind: 'picture', kept: { text: 'x' } })
    && !noise.isNoise({ text: 'ab', confidence: 0.2, source: 'model', edited: true })
    && !noise.isNoise({ text: 'q', confidence: 1, source: 'manual', added: true })
    && noise.isNoise({ text: 'ab', confidence: 0.2, source: 'model' }));

  // Reopen: a new copy of the document gets every page back, with the edits, and no reader
  const again = docOf(3);
  const n = await cache.restore(again, [1, 2, 3]);
  const back = [1, 2, 3].map((k) => JSON.stringify(textOf(again.pageCache.get(k))));
  check('reopen: all three pages come back as read', n === 3 && [1, 2, 3].every((k) => again.pageCache.get(k).ink.recognised && again.pageCache.get(k).ink.remembered), String(n));
  check('reopen: page 1 study lines are the edited ones', back[0] === want[0], `${back[0]} vs ${want[0]}`);
  check('reopen: fixed text, added line, no removed line, picture line out', back[0].includes('interphase comes before mitosis 1') === false
    && back[0].includes('interphase comes before mitosis') && back[0].includes('a line the reader missed')
    && !back[0].includes('spindle') && !back[0].includes('drawing'), back[0]);
  const a1 = again.pageCache.get(1);
  check('reopen: the removed line can still be brought back', E.isRemoved(E.find(a1, 'p1-l2-r0').region));
  check('reopen: the picture line is still listed as a picture', JSON.stringify(E.pictures(a1)) === pictures1, JSON.stringify(E.pictures(a1)));
  check('reopen: "Looks right" holds: nothing left to check on page 2', back[1] === want[1] && E.toCheck(again.pageCache.get(2)).length === 0);
  check('reopen: the typed-in page is the typed text', back[2] === want[2] && again.pageCache.get(3).ink.typedIn === true, back[2]);
  const stored = await store.get('doc-edits', 'ocr', cache.keyOf(1));
  check('reopen: the stored reading is still the reader\'s own (edits are kept apart)',
    stored.result.lines[1].regions[0].text === 'interphase comes before mitosis 1' && stored.result.lines[2].regions[0].text.includes('spindle'));

  // Whole-page flags: kept as a picture and skipped
  E.keepPageAsPicture(a1, true);
  E.skipPage(again.pageCache.get(2), true);
  await idle();
  const third = docOf(3);
  await cache.restore(third, [1, 2, 3]);
  check('reopen: a page kept as a picture and a skipped page keep their flags',
    third.pageCache.get(1).ink.keepAsPicture === true && third.pageCache.get(2).ink.checkSkipped === true);
  check('restore applies once: restoring again finds nothing to do', (await cache.restore(third, [1, 2, 3])) === 0);

  // Undo everything on page 1 of the third copy: an empty record is stored, the next copy is as read
  const t1 = third.pageCache.get(1);
  E.keepPageAsPicture(t1, false);
  E.restoreRegion(t1, 'p1-l2-r0');
  E.setRegionKind(t1, 'p1-l3-r0', 'text');
  await idle();
  const fourth = docOf(3);
  await cache.restore(fourth, [1]);
  check('taken back: the removed line returns after reopening', textOf(fourth.pageCache.get(1)).some((t) => t.includes('spindle')));

  // A new reader version: line edits go with the old reading, a typed-in page stays and is not read again
  const version = pipe.READER_VERSION;
  pipe.READER_VERSION = `${version}-next`;
  const fifth = docOf(3);
  const kept = await cache.restore(fifth, [1, 2, 3]);
  check('new reader version: only the typed-in page comes back, as typed', kept === 1 && fifth.pageCache.get(3).ink.recognised === true
    && JSON.stringify(textOf(fifth.pageCache.get(3))) === want[2] && !fifth.pageCache.get(1).ink.recognised, `${kept} restored`);
  pipe.READER_VERSION = version;

  // Read again under the same version (the reading slot was lost): the edits are put back on the new reading
  openDoc = 'doc-reread';
  const lost = docOf(1);
  ocr.applyToPage(lost.pageCache.get(1), resultFor(1));
  E.removeRegion(lost.pageCache.get(1), 'p1-l4-r0');
  await idle();
  const reread = docOf(1);
  ocr.applyToPage(reread.pageCache.get(1), resultFor(1));
  check('reapply: edits come back on a page read again', (await cache.reapply(reread, 1)) === true && E.isRemoved(E.find(reread.pageCache.get(1), 'p1-l4-r0').region));

  // No open document: edits change the page and nothing throws
  openDoc = null;
  const loose = docOf(1);
  ocr.applyToPage(loose.pageCache.get(1), resultFor(1));
  check('without an open document the edit still applies and savePage answers false',
    E.removeRegion(loose.pageCache.get(1), 'p1-l0-r0') && (await P.ocrStore.savePage(loose.pageCache.get(1))) === false);

  console.log(`ocr_store_fixtures: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

/**
 * Which pages are sent to the reader, and how recognised text joins typed text (Node, no model, no PDF.js):
 * page assessment with geometry and annotation ink, the per-range selection, the load-then-decide order in
 * buildMaterials, merging on mixed pages, the page-level hold, picture pages and the empty-export verdict.
 * Run: node tests/handwriting_scope_fixtures.js
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

const geo = src('pdf', 'ink-geometry.js');
const detect = src('pdf', 'ink-detect.js');
const summary = src('pdf', 'ink-summary.js');
const merge = src('pdf', 'ocr-merge.js');
const ocr = src('pdf', 'ocr-lines.js');

const W = 800;
const H = 600;
/** A typed line (line-builder.js shape) with `words` words at (x, y). */
const typedLine = (text, x, y, w = 300) => ({
  text, formattedText: text, cleanText: text, x0: x, textX0: x, x1: x + w, topY: y, bottomY: y + 14,
  fontSize: 12, wordCount: text.split(/\s+/).length, pageWidth: W, pageHeight: H,
});
const SENTENCE = 'The brachial plexus supplies the upper limb with motor fibres.';
const typedPage = (n, lines = 6) => {
  const page = { pageNumber: n, width: W, height: H, lines: Array.from({ length: lines }, (_, i) => typedLine(SENTENCE, 60, 80 + i * 30)) };
  page.wordCount = page.lines.reduce((s, l) => s + l.wordCount, 0);
  page.ink = detect.assess(page, { pathOps: 2, imageOps: 0 });
  return page;
};
/** A page with only a picture (a photographed page, a screenshot of text) and at most a two-word title. */
const imagePage = (n, title) => {
  const page = { pageNumber: n, width: W, height: H, lines: title ? [typedLine(title, 60, 30, 120)] : [] };
  page.wordCount = page.lines.reduce((s, l) => s + l.wordCount, 0);
  page.ink = detect.assess(page, { pathOps: 3, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 80, w: 680, h: 460 }], paths: [], pathsMeasured: true } });
  return page;
};
const docOf = (pages, extra) => Object.assign({ numPages: pages.length, pages, pageCache: new Map(pages.map((p) => [p.pageNumber, p])) }, extra);

/** One recognised line in result (pixel) coordinates. */
const region = (id, text, confidence, box, kind = 'text', source = 'model') => ({ id, kind, box, text, confidence, source });
const resultOf = (pageNumber, scale, rows) => ({
  pageNumber, scale, width: W * scale, height: H * scale,
  lines: rows.map(([text, confidence, x, y, w], i) => {
    const box = { x: x * scale, y: y * scale, w: (w || 300) * scale, h: 16 * scale };
    return { index: i, box, regions: [region(`p${pageNumber}-l${i}-r0`, text, confidence, box)] };
  }),
});

function geometryTests() {
  const OPS = { save: 1, restore: 2, transform: 3, constructPath: 4, stroke: 5, fill: 6, paintImageXObject: 7, endPath: 8 };
  // viewport transform of an 800x600 page: flips y so the origin is the top-left corner
  const base = [1, 0, 0, -1, 0, H];
  const opList = {
    fnArray: [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.constructPath, OPS.stroke, OPS.constructPath, OPS.endPath],
    argsArray: [[], [400, 0, 0, 300, 100, 200], ['img1', 400, 300], [], [[], [], [10, 30, 500, 520]], [], [[], [], [0, 5, 0, 5]], []],
  };
  const g = geo.measure(opList, OPS, base);
  const img = g.images[0];
  check('geometry: image box follows the current transform, in top-left page coordinates',
    g.images.length === 1 && img.x === 100 && img.y === 100 && img.w === 400 && img.h === 300, JSON.stringify(g.images));
  const p = g.paths[0];
  check('geometry: a painted path is measured after restore; an unpainted one is not kept',
    g.paths.length === 1 && g.pathsMeasured && p.x === 10 && p.w === 20 && p.y === 80 && p.h === 20, JSON.stringify(g.paths));
  check('geometry: no operator list -> nothing', geo.measure(null, OPS).images.length === 0);

  const anns = [
    { subtype: 'Ink', rect: [100, 100, 300, 200], inkLists: [[], [], []] },
    { subtype: 'Ink', rect: [100, 300, 300, 400], inkLists: [[], []] },
    { subtype: 'Highlight', rect: [0, 0, 10, 10] },
    { subtype: 'Link', rect: [0, 0, 10, 10] },
  ];
  const a = geo.inkAnnotations(anns, base);
  check('geometry: only Ink annotations count, one stroke per ink list', a.strokes === 5 && a.boxes.length === 2 && a.boxes[0].y === 400, JSON.stringify(a));
}

function assessTests() {
  const page = typedPage(1);
  const plain = detect.assess(page, { pathOps: 2, imageOps: 0 }, { annotationInk: { strokes: 0, boxes: [] }, geometry: { images: [], paths: [], pathsMeasured: true } });
  check('assess: typed page with nothing else needs no reading', plain.reason === 'has-text' && plain.needsRecognition === false);

  const annotated = detect.assess(page, { pathOps: 2, imageOps: 0 }, { annotationInk: { strokes: 12, boxes: [{ x: 400, y: 300, w: 200, h: 100 }] } });
  check('assess: annotation ink over typed text is flagged', annotated.needsRecognition === true && annotated.reason === 'mixed' && annotated.mixed === 'annotation-ink' && annotated.annotationStrokes === 12, JSON.stringify(annotated));
  const tick = detect.assess(page, { pathOps: 2, imageOps: 0 }, { annotationInk: { strokes: 2, boxes: [] } });
  check('assess: two stray annotation strokes are not writing', tick.needsRecognition === false);
  const inkOnly = detect.assess({ width: W, height: H, lines: [] }, { pathOps: 0, imageOps: 0 }, { annotationInk: { strokes: 30, boxes: [] } });
  check('assess: a page with only annotation ink is a no-text ink page, not blank', inkOnly.reason === 'no-text' && inkOnly.needsRecognition === true);

  // a slide with a title, a short caption and a large picture that has no words over it
  const slide = { width: W, height: H, lines: [typedLine('Landmarks of the interscalene block', 60, 30), typedLine('See the figure', 60, 560, 100)] };
  const picture = { images: [{ x: 60, y: 80, w: 680, h: 460 }], paths: [], pathsMeasured: true };
  const mixed = detect.assess(slide, { pathOps: 3, imageOps: 1 }, { geometry: picture });
  check('assess: title + large un-texted picture is mixed/image with the picture as read box', mixed.reason === 'mixed' && mixed.mixed === 'image' && mixed.readBoxes.length === 1, JSON.stringify(mixed));

  // the same picture as a background with the typed text over it is not worth reading
  const over = { width: W, height: H, lines: [typedLine('Landmarks of the interscalene block', 100, 200), typedLine('See the figure below', 100, 300, 100)] };
  check('assess: picture with the typed words over it is left alone', detect.assess(over, { pathOps: 3, imageOps: 1 }, { geometry: picture }).needsRecognition === false);
  check('assess: a logo-sized picture is left alone', detect.assess(slide, { pathOps: 3, imageOps: 1 }, { geometry: { images: [{ x: 700, y: 10, w: 80, h: 60 }], paths: [] } }).needsRecognition === false);
  check('assess: a wordy page with a picture is left alone', detect.assess(typedPage(2), { pathOps: 3, imageOps: 1 }, { geometry: picture }).needsRecognition === false);

  // handwriting drawn as vector strokes over a typed page: many small paths away from the text lines
  const strokes = Array.from({ length: 200 }, (_, i) => ({ x: 420 + (i % 20) * 15, y: 300 + Math.floor(i / 20) * 20, w: 10, h: 12 }));
  const drawn = detect.assess(page, { pathOps: 200, imageOps: 0 }, { geometry: { images: [], paths: strokes, pathsMeasured: true } });
  check('assess: many loose strokes beside typed text are mixed/paths', drawn.reason === 'mixed' && drawn.mixed === 'paths', JSON.stringify(drawn));
  const underlines = Array.from({ length: 200 }, (_, i) => ({ x: 60 + (i % 20) * 10, y: 92 + (i % 6) * 30, w: 8, h: 0 }));
  const rules = [{ x: 0, y: 400, w: 800, h: 1 }];
  check('assess: marks on the text lines and long rules are not loose strokes', detect.assess(page, { pathOps: 201, imageOps: 0 }, { geometry: { images: [], paths: underlines.concat(rules), pathsMeasured: true } }).needsRecognition === false);
}

function selectionTests() {
  const deck = docOf(Array.from({ length: 10 }, (_, i) => typedPage(i + 1)).concat([imagePage(11, 'Summary')]));
  check('select: slide deck reads its one picture-only slide', detect.selectForReading(deck, 1, 11, { slides: true }).join() === '11');
  check('select: pagesNeeding agrees', detect.pagesNeeding(deck, 1, 11).join() === '11');
  check('select: a book leaves one stray figure page in a typed chapter', detect.selectForReading(deck, 1, 11, {}).length === 0 && detect.pagesNeeding(deck, 1, 11).length === 0);
  check('select: the same page selected on its own is read', detect.selectForReading(deck, 11, 11, {}).join() === '11' && detect.pagesNeeding(deck, 11, 11).join() === '11');
  check('select: force reads it inside the chapter too', detect.selectForReading(deck, 1, 11, { force: true }).join() === '11');

  const pages = Array.from({ length: 40 }, (_, i) => (i >= 20 && i < 23 ? imagePage(i + 1) : typedPage(i + 1)));
  const book = docOf(pages);
  check('select: three text-less pages in a row are read even in a long typed range', detect.selectForReading(book, 1, 40, {}).join() === '21,22,23');

  const annotated = typedPage(5);
  annotated.ink = detect.assess(annotated, { pathOps: 0, imageOps: 0 }, { annotationInk: { strokes: 20, boxes: [] } });
  const figure = typedPage(6, 1);
  figure.ink = detect.assess(figure, { pathOps: 0, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 200, w: 680, h: 380 }], paths: [] } });
  const mixedBook = docOf([typedPage(1), typedPage(2), typedPage(3), typedPage(4), annotated, figure]);
  check('select: fixture pages are mixed', annotated.ink.mixed === 'annotation-ink' && figure.ink.mixed === 'image');
  check('select: a book reads annotation ink but not a figure beside typed text', detect.selectForReading(mixedBook, 1, 6, {}).join() === '5');
  check('select: a slide deck reads both', detect.selectForReading(mixedBook, 1, 6, { slides: true }).join() === '5,6');
  check('summarise: mixed pages do not make a document look handwritten', detect.summarise(mixedBook).needing === 0);
}

async function pipelineTests() {
  for (const f of ['hw/hw-client.js', 'hw/hw-pipeline.js', 'ui/study-pipeline.js']) src(...f.split('/'));
  const P = globalThis.PDFStudy;
  const origRecognise = P.hwPipeline.ensureRecognised;
  const origLoader = P.pdfLoader;
  const calls = [];
  const events = [];
  P.hwPipeline.ensureRecognised = async (parsed, s, e) => {
    events.push('read');
    calls.push(detect.pagesNeeding(parsed, s, e));
    return { pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null };
  };
  const run = async (parsed, mode, s, e, opts) => {
    calls.length = 0;
    events.length = 0;
    const st = { parsedPdf: parsed, selectedScope: { title: 't', startPage: s, endPage: e }, activeMode: mode, quizCount: 5, quizSeed: 0, generated: {} };
    try { await P.studyPipeline.buildMaterials(st, s, e, () => {}, opts || {}); } catch (_e) { /* later stages need the full app; only the reading decision matters */ }
    return calls.slice();
  };
  try {
    const deckPages = Array.from({ length: 10 }, (_, i) => typedPage(i + 1)).concat([imagePage(11, 'Summary')]);
    const c1 = await run(docOf(deckPages), 'slide_deck', 1, 11);
    check('pipeline: image-only slide inside a typed deck gets read', c1.length === 1 && c1[0].join() === '11', JSON.stringify(c1));
    check('pipeline: handwriting false still wins', (await run(docOf([imagePage(1), imagePage(2)]), 'slide_deck', 1, 2, { handwriting: false })).length === 0);

    const bookPages = Array.from({ length: 30 }, (_, i) => typedPage(i + 1));
    bookPages[7] = typedPage(8, 1); // a figure page: one typed line and a large picture
    bookPages[7].ink = detect.assess(bookPages[7], { pathOps: 0, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 200, w: 680, h: 380 }], paths: [] } });
    bookPages[19] = imagePage(20); // one full-page figure
    check('pipeline: fixture book has a mixed figure page and a text-less one', bookPages[7].ink.mixed === 'image' && bookPages[19].ink.reason === 'no-text');
    check('pipeline: typed book never starts the reader', (await run(docOf(bookPages), 'book', 1, 30)).length === 0);
    check('pipeline: typed deck never starts the reader', (await run(docOf(Array.from({ length: 12 }, (_, i) => typedPage(i + 1))), 'slide_deck', 1, 12)).length === 0);

    // Lazy book: only sample pages (all typed) are loaded; pages 41-50 are an image-only chapter
    const all = new Map();
    for (let n = 1; n <= 120; n++) all.set(n, n >= 41 && n <= 50 ? imagePage(n) : typedPage(n));
    const samples = [5, 15, 25, 35, 55, 65, 75, 85, 95, 105, 115, 120].map((n) => all.get(n));
    const lazy = { numPages: 120, isLazy: true, pdfDoc: {}, pages: samples, pageCache: new Map(samples.map((p) => [p.pageNumber, p])) };
    P.pdfLoader = {
      ensurePagesLoaded: async (parsed, s, e) => {
        events.push('load');
        for (let n = s; n <= e; n++) if (!parsed.pageCache.has(n)) parsed.pageCache.set(n, all.get(n));
        return [];
      },
    };
    check('pipeline: lazy book samples alone say "typed"', detect.summarise(lazy).needing === 0 && detect.pagesNeeding(lazy, 41, 50).length === 0);
    const c2 = await run(lazy, 'book', 41, 50);
    check('pipeline: lazy book with an image-only chapter is read when that chapter is selected', c2.length === 1 && c2[0].join() === '41,42,43,44,45,46,47,48,49,50', JSON.stringify(c2));
    check('pipeline: the range is loaded before the reading decision', events[0] === 'load' && events.indexOf('read') > 0, events.join());
    const c3 = await run(lazy, 'book', 60, 70);
    check('pipeline: a typed chapter of the same book does not start the reader', c3.length === 0 && lazy.pageCache.has(66));
  } finally {
    P.hwPipeline.ensureRecognised = origRecognise;
    P.pdfLoader = origLoader;
  }
}

function mergeTests() {
  // typed title and caption; the picture between them holds two lines of text and a stray label
  const page = { pageNumber: 3, width: W, height: H, lines: [typedLine('Landmarks of the interscalene block', 60, 30), typedLine('Source: course notes', 60, 560, 150)] };
  page.wordCount = 8;
  page.ink = detect.assess(page, { pathOps: 3, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 80, w: 680, h: 460 }], paths: [], pathsMeasured: true } });
  const result = resultOf(3, 2, [
    ['Landmarks of the interscalene block', 0.95, 60, 29, 300], // the reader re-reading the typed title
    ['The needle enters lateral to the sternocleidomastoid.', 0.9, 100, 200, 500],
    ['Aspirate before every injection of anaesthetic.', 0.85, 100, 260, 500],
    ['C5', 0.9, 400, 400, 30], // a diagram label: not two real words
    ['smudged words in the corner', 0.3, 100, 480, 300],
    ['Source: course notes', 0.9, 60, 559, 150], // the typed caption again
  ]);
  ocr.applyToPage(page, result);
  const texts = page.lines.map((l) => l.text);
  check('merge: typed lines are kept and recognised lines go between them by position',
    texts.join('|') === 'Landmarks of the interscalene block|The needle enters lateral to the sternocleidomastoid.|Aspirate before every injection of anaesthetic.|Source: course notes', texts.join('|'));
  check('merge: no typed line is duplicated', texts.filter((t) => t === 'Landmarks of the interscalene block').length === 1 && texts.filter((t) => t === 'Source: course notes').length === 1);
  check('merge: typed lines carry no ocr mark, added lines do', !page.lines[0].ocr && !!page.lines[1].ocr && page.wordCount === 8 + 7 + 6, String(page.wordCount));
  check('merge: re-read typed text is not listed for review', ocr.lowConfidence(page).map((r) => r.text).join() === 'smudged words in the corner');
  check('merge: page is marked read, neither picture nor held', page.ink.recognised === true && page.ink.picture === false && page.ink.held === false);
  ocr.applyCorrection(page, 'p3-l4-r0', 'Inject slowly in small portions.');
  check('merge: a correction is merged in place, typed lines still once', page.lines.map((l) => l.text).join('|').includes('anaesthetic.|Inject slowly in small portions.|Source: course notes') && page.lines.length === 5);

  // a photo slide: many confident but wordless labels, and more lines than the cap
  const photo = { pageNumber: 4, width: W, height: H, lines: [typedLine('Ultrasound view of the plexus', 60, 30)] };
  photo.ink = detect.assess(photo, { pathOps: 0, imageOps: 1 }, { geometry: { images: [{ x: 60, y: 80, w: 680, h: 480 }], paths: [] } });
  const many = Array.from({ length: 20 }, (_, i) => [`Label text number ${i}`, 0.7 + (i % 10) / 100, 100, 100 + i * 20, 200]);
  ocr.applyToPage(photo, resultOf(4, 1, many.concat([['A1', 0.99, 500, 100, 20], ['12 mm', 0.99, 500, 140, 40]])));
  const addedLines = photo.lines.filter((l) => l.ocr);
  check('merge: additions next to typed text are capped', addedLines.length === merge.MAX_ADDED_LINES, String(addedLines.length));
  check('merge: wordless labels are not added', addedLines.every((l) => /Label text/.test(l.text)));

  // an image-only slide with a two-word typed title keeps the title
  const slide = imagePage(8, 'Nerve roots');
  ocr.applyToPage(slide, resultOf(8, 1, [['Nerve roots', 0.9, 60, 30, 120], ['C5 and C6 join to form the upper trunk.', 0.9, 100, 200, 500]]));
  check('merge: image-only slide keeps its typed title and gains the read text', slide.lines.map((l) => l.text).join('|') === 'Nerve roots|C5 and C6 join to form the upper trunk.', slide.lines.map((l) => l.text).join('|'));
}

function holdTests() {
  const page = imagePage(1);
  const result = resultOf(1, 1, [
    ['Local anaesthetics block sodium channels.', 0.9, 100, 100, 500],
    ['scrawl that the reader could not make out at all', 0.3, 100, 140, 500],
    ['another unsure line of handwriting', 0.4, 100, 180, 500],
  ]);
  ocr.applyToPage(page, result);
  check('hold: a page with more than a third of its characters unsure is held whole', page.ink.held === true && page.lines.length === 0 && page.wordCount === 0, JSON.stringify(page.lines.map((l) => l.text)));
  check('hold: the held page is listed for review', ocr.lowConfidence(page).length === 2 && page.ink.result === result);
  check('hold: threshold is a named, provisional constant', merge.PAGE_HOLD_LOW_SHARE > 0.3 && merge.PAGE_HOLD_LOW_SHARE < 0.4 && merge.judge(result).lowShare > merge.PAGE_HOLD_LOW_SHARE);
  ocr.applyCorrection(page, 'p1-l1-r0', 'Lidocaine acts within a few minutes.');
  check('hold: confirming enough of it releases the page', page.ink.held === false && page.lines.length === 2, JSON.stringify(page.lines.map((l) => l.text)));

  const mostlySure = resultOf(2, 1, [
    ['Local anaesthetics block sodium channels.', 0.9, 100, 100, 500],
    ['Lidocaine acts within a few minutes.', 0.8, 100, 140, 500],
    ['unsure tail', 0.3, 100, 180, 200],
  ]);
  const ok = imagePage(2);
  ocr.applyToPage(ok, mostlySure);
  check('hold: one short unsure piece only drops that piece', ok.ink.held === false && ok.lines.length === 2);

  // cover / photo: the reader read it and found no confident words
  const cover = imagePage(3);
  ocr.applyToPage(cover, resultOf(3, 1, [['~~ l1 |', 0.2, 100, 100, 100], ['oo', 0.3, 300, 300, 50], ['7', 0.9, 500, 500, 20]]));
  check('picture: no confident words -> picture, no lines, nothing listed for review', cover.ink.picture === true && cover.lines.length === 0 && ocr.lowConfidence(cover).length === 0 && cover.ink.result.lines.length === 0);
  check('picture: the reader\'s result is kept aside', cover.ink.pictureResult.lines.length === 3 && summary.classOf(cover) === 'decorative');

  // no model installed: pieces are unread ("type it in"), which is neither a picture nor a hold
  const manual = imagePage(4);
  const unread = { pageNumber: 4, scale: 1, width: W, height: H, lines: [{ index: 0, box: { x: 0, y: 0, w: 100, h: 20 }, regions: [region('p4-l0-r0', '', 0, { x: 0, y: 0, w: 100, h: 20 }, 'text', 'manual')] }] };
  ocr.applyToPage(manual, unread);
  check('picture: unread pieces stay listed for typing in', manual.ink.picture === false && manual.ink.held === false && ocr.lowConfidence(manual).length === 1);

  const bare = imagePage(5);
  ocr.applyToPage(bare, { pageNumber: 5, scale: 1, width: W, height: H, lines: [] });
  check('empty render: a page with no ink found counts as empty', bare.ink.emptyRender === true && summary.classOf(bare) === 'empty');
}

async function summaryTests() {
  const blank = (n) => {
    const page = { pageNumber: n, width: W, height: H, lines: [], wordCount: 0 };
    page.ink = detect.assess(page, { pathOps: 1, imageOps: 0 });
    return page;
  };
  const cover = { pageNumber: 1, width: W, height: H, lines: [], wordCount: 0 };
  cover.ink = detect.assess(cover, { pathOps: 302, imageOps: 0 });
  const exported = summary.attach(docOf([cover].concat(Array.from({ length: 12 }, (_, i) => blank(i + 2)))));
  const s = exported.inkSummary;
  check('summary: counts by kind', s.pages === 13 && s.known === 13 && s.empty === 12 && s.needsReading === 1 && s.typed === 0, JSON.stringify(s));
  check('verdict: a cover and empty pages is an empty export', summary.verdict(s) === 'empty-export');
  cover.ink.recognised = true;
  cover.ink.picture = true;
  check('summary: recounted on every read; a cover read as a picture is decorative', exported.inkSummary.decorative === 1 && summary.verdict(exported.inkSummary) === 'empty-export');

  const v = (counts) => summary.verdict(Object.assign({ typed: 0, needsReading: 0, mixed: 0, empty: 0, decorative: 0 }, counts));
  check('verdict: typed', v({ typed: 40, empty: 2 }) === 'typed');
  check('verdict: handwritten notes with some blank pages need reading', v({ needsReading: 9, empty: 20 }) === 'needs-reading');
  check('verdict: typed deck with a few picture slides is mixed', v({ typed: 38, needsReading: 9, mixed: 4 }) === 'mixed');
  check('verdict: nothing classified yet is unknown', v({}) === 'unknown' && summary.verdict(null) === 'unknown');

  // Lazy document whose samples are all blank: the rest is counted by operators, with no page parsing
  const OPS = { constructPath: 1, fill: 2, showText: 3, paintImageXObject: 4 };
  const opsFor = { blank: { fnArray: [1, 2], argsArray: [[], []] }, typed: { fnArray: [3, 3, 3, 3], argsArray: [[], [], [], []] }, scan: { fnArray: [4], argsArray: [[]] } };
  let fetched = 0;
  const fakeDoc = (kindOf) => ({ getPage: async (n) => { fetched++; return { getOperatorList: async () => opsFor[kindOf(n)] }; } });
  const lazyOf = (numPages, kindOf) => {
    const samples = [10, 20, 30].map(blank);
    return summary.attach({ numPages, isLazy: true, pdfDoc: fakeDoc(kindOf), pages: samples, pageCache: new Map(samples.map((p) => [p.pageNumber, p])) });
  };
  const empty = lazyOf(136, () => 'blank');
  await summary.surveyIfTextless(empty, OPS);
  check('survey: blank export -> every page known, verdict empty-export', empty.inkSummary.known === 136 && empty.inkSummary.empty === 136 && summary.verdict(empty.inkSummary) === 'empty-export', JSON.stringify(empty.inkSummary));

  fetched = 0;
  const scanned = lazyOf(1377, (n) => (n === 10 || n === 20 || n === 30 ? 'blank' : 'scan'));
  await summary.surveyIfTextless(scanned, OPS);
  check('survey: a scanned book stops after two ink pages', fetched === 2 && summary.verdict(scanned.inkSummary) === 'needs-reading', `${fetched} ${JSON.stringify(scanned.inkSummary)}`);

  fetched = 0;
  const book = summary.attach(docOf([typedPage(100), typedPage(200)], { numPages: 1377, isLazy: true, pdfDoc: fakeDoc(() => 'typed') }));
  await summary.surveyIfTextless(book, OPS);
  check('survey: a typed textbook is never walked', fetched === 0 && book.inkSummary.known === 2 && book.inkSummary.pages === 1377 && summary.verdict(book.inkSummary) === 'typed');
}

(async () => {
  for (const [name, fn] of [['geometry', geometryTests], ['assess', assessTests], ['selection', selectionTests], ['pipeline', pipelineTests], ['merge', mergeTests], ['hold', holdTests], ['summary', summaryTests]]) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  console.log(`handwriting_scope_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

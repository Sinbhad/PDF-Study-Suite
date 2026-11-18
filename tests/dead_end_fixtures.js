/**
 * Dead-end fixtures (Node): the pure checks behind the explained empty states. Blank exports and
 * pictures of text (doc-verdict), the 25-page window arithmetic (scope-pager), why a typed section
 * gave few results (thin-results), photos wrapped into a PDF (image-pdf) and file-opening messages
 * (open-messages), plus the state markup itself (study-states).
 * Run: node tests/dead_end_fixtures.js
 */
const path = require('path');
const ui = (f) => require(path.join(__dirname, '..', 'src', 'ui', f));

ui('study-views.js');
const dv = ui('doc-verdict.js');
const pager = ui('scope-pager.js');
const thin = ui('thin-results.js');
const ipdf = ui('image-pdf.js');
const om = ui('open-messages.js');
const states = ui('study-states.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const page = (n, reason, words, extra) => ({
  pageNumber: n,
  wordCount: words,
  lines: [],
  ink: Object.assign({ reason, needsRecognition: reason === 'no-text', pathOps: 1, imageOps: 0 }, extra || {}),
});
const doc = (pages) => ({ numPages: pages.length, pages, outline: [] });

// 1. Document verdicts: the real blank notebook export is a cover plus blank pages
const blankExport = doc([page(1, 'no-text', 0)].concat(Array.from({ length: 12 }, (_x, i) => page(i + 2, 'blank', 0))));
check('blank export behind a cover is blank', dv.documentVerdict(blankExport).kind === 'blank', JSON.stringify(dv.documentVerdict(blankExport)));
check('all-blank sample of a long file is blank', dv.documentVerdict(doc([page(5, 'blank', 0), page(17, 'blank', 0)])).kind === 'blank', '');
check('scanned pages are pictures', dv.documentVerdict(doc([page(1, 'no-text', 0), page(2, 'no-text', 2), page(3, 'blank', 0)])).kind === 'pictures', '');
check('one typed page makes it text', dv.documentVerdict(doc([page(1, 'no-text', 0), page(2, 'has-text', 120)])).kind === 'text', '');
check('pages without ink data count by words', dv.documentVerdict(doc([{ pageNumber: 1, wordCount: 55, lines: [] }])).kind === 'text', '');
check('empty document is not called blank', dv.documentVerdict(doc([])).kind === 'text', '');

// 2. Scope verdicts
const mixed = doc([page(1, 'has-text', 200), page(2, 'no-text', 3), page(3, 'no-text', 0, { recognised: true }), page(4, 'blank', 0)]);
check('scope: typed', dv.scopeVerdict(mixed, 1, 2).kind === 'text', '');
check('scope: picture', dv.scopeVerdict(mixed, 2, 2).kind === 'pictures', '');
check('scope: read picture', dv.scopeVerdict(mixed, 2, 3).kind === 'read' && dv.scopeVerdict(mixed, 2, 3).read === 1, '');
check('scope: blank', dv.scopeVerdict(mixed, 4, 4).kind === 'blank', '');
check('scope: nothing loaded', dv.scopeVerdict(mixed, 9, 12).kind === 'unknown', '');

// 3. Doubtful slides/textbook call
const cls = (confidence, words) => ({ confidence, metrics: { medianWordsPerPage: words } });
check('low confidence is doubtful', dv.typeDoubt({ classification: cls(58, 120), mode: 'slide_deck', numPages: 30, hasOutline: false }), '');
check('short sparse "textbook" without outline is doubtful', dv.typeDoubt({ classification: cls(90, 90), mode: 'book', numPages: 20, hasOutline: false }), '');
check('dense short paper is not doubtful', !dv.typeDoubt({ classification: cls(95, 420), mode: 'book', numPages: 12, hasOutline: false }), '');
check('"slides" with 300+ words a page are doubtful', dv.typeDoubt({ classification: cls(80, 340), mode: 'slide_deck', numPages: 60, hasOutline: false }), '');
check('confident deck is not doubtful', !dv.typeDoubt({ classification: cls(99, 40), mode: 'slide_deck', numPages: 60, hasOutline: false }), '');

// 4. Page windows over a 60-page chapter read 25 pages at a time
const chapter = { id: 'ch3', type: 'chapter', title: 'Chapter 3', startPage: 101, endPage: 160 };
let win = pager.windowOf(chapter, { startPage: 101, endPage: 125 });
check('first window', win && win.prev === 0 && win.next === 25 && pager.describe(win) === 'Showing pages 101–125 of 101–160', JSON.stringify(win));
const second = pager.shift(chapter, { startPage: 101, endPage: 125 }, 'next');
check('next window is a page range that remembers its chapter', second.type === 'custom_range' && second.startPage === 126 && second.endPage === 150 && second.parent.id === 'ch3' && second.context === 'Chapter 3', JSON.stringify(second));
const third = pager.shift(second, { startPage: 126, endPage: 150 }, 'next');
win = pager.windowOf(third, { startPage: 151, endPage: 160 });
check('last window is the remainder', third.startPage === 151 && third.endPage === 160 && win.next === 0 && win.prev === 25, JSON.stringify(win));
check('previous from the last window', pager.shift(third, { startPage: 151, endPage: 160 }, 'prev').startPage === 126, '');
check('previous from the second window is the chapter itself', pager.shift(second, { startPage: 126, endPage: 150 }, 'prev') === chapter, '');
check('nothing to page when all is shown', pager.windowOf(chapter, { startPage: 101, endPage: 160 }) === null && pager.shift(chapter, { startPage: 101, endPage: 160 }, 'next') === null, '');

// 5. Why a typed selection gave few results
check('short section', thin.reasonFor({ words: 60, pages: 1, thinPages: 0 }) === 'short', '');
check('exercise section', thin.reasonFor({ words: 900, pages: 3, thinPages: 0, exerciseWords: 700 }) === 'exercises', '');
check('worked examples', thin.reasonFor({ words: 900, pages: 3, thinPages: 0, blocks: 5, exampleBlocks: 4 }) === 'exercises', '');
check('figure pages', thin.reasonFor({ words: 70, pages: 4, thinPages: 4 }) === 'figures', '');
check('plain prose', thin.reasonFor({ words: 1500, pages: 4, thinPages: 0 }) === 'plain', '');
check('sentence agrees in number', /^These slides are short \(about 60 words\)/.test(thin.sentence('short', 'these slides', { words: 61 })) && /^This section has no clear/.test(thin.sentence('plain', 'this section', {})), '');
check('a selection that gave some questions is not called empty of definitions',
  /has only a few clear definitions/.test(thin.fewNote(2, 'this section', { words: 1500, pages: 2, thinPages: 0 }))
  && /has only a few clear/.test(thin.sentence('plain', 'this section', { found: 3 })), '');
check('few-questions note only for 1 or 2', thin.fewNote(2, 'this section', { words: 60 }).startsWith('Only 2 questions here.') && thin.fewNote(1, 'this section', {}).startsWith('Only 1 question here.') && thin.fewNote(0, 'this section', {}) === '' && thin.fewNote(3, 'this section', {}) === '', '');

// 6. Photos wrapped into a PDF: one page per JPEG, offsets in the cross-reference table are exact
function fakeJpeg(w, h, n, orientation) {
  const exif = orientation
    ? [0xff, 0xe1, 0x00, 0x22, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01,
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    : [];
  const frame = [0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, n, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8].concat(exif, frame, [0xff, 0xd9]));
}
const upright = ipdf.jpegInfo(fakeJpeg(1200, 1600, 3));
check('jpeg size and channels', upright.w === 1200 && upright.h === 1600 && upright.n === 3 && upright.orientation === 1 && ipdf.embeddable(upright), JSON.stringify(upright));
const turned = ipdf.jpegInfo(fakeJpeg(1600, 1200, 3, 6));
check('rotated phone photo is not embedded as is', turned.orientation === 6 && !ipdf.embeddable(turned), JSON.stringify(turned));
check('CMYK is not embedded as is', !ipdf.embeddable(ipdf.jpegInfo(fakeJpeg(10, 10, 4))), '');
let threw = false;
try { ipdf.jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])); } catch (_e) { threw = true; }
check('a PNG is not mistaken for a JPEG', threw, '');
const shots = [fakeJpeg(1200, 1600, 3), fakeJpeg(800, 600, 1)].map((bytes) => Object.assign({ bytes }, ipdf.jpegInfo(bytes)));
const pdfBytes = ipdf.buildPdf(shots);
const pdfText = Buffer.from(pdfBytes).toString('latin1');
const offsets = [...pdfText.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
check('two photos make two pages', pdfText.startsWith('%PDF-1.4') && /\/Count 2 /.test(pdfText) && (pdfText.match(/\/Type \/Page /g) || []).length === 2 && /\/DeviceGray/.test(pdfText) && /MediaBox \[0 0 595 793\]/.test(pdfText), pdfText.slice(0, 300));
check('xref offsets point at their objects', offsets.length === 8 && offsets.every((o, i) => pdfText.startsWith(`${i + 1} 0 obj`, o)) && pdfText.startsWith('xref', Number(/startxref\n(\d+)/.exec(pdfText)[1])), offsets.join(','));

// 7. File kinds and failure wording (no jargon, always a next step)
const f = (name, type) => ({ name, type: type || '' });
check('file kinds', om.kindOf(f('a.PDF')) === 'pdf' && om.kindOf(f('IMG_1.JPG')) === 'jpeg' && om.kindOf(f('x', 'image/png')) === 'png' && om.kindOf(f('IMG_2.HEIC')) === 'heic' && om.kindOf(f('a.webp')) === 'image' && om.kindOf(f('notes.docx')) === 'other', '');
check('one pdf opens', om.plan([f('a.pdf')]).pdf.name === 'a.pdf' && om.plan([f('a.pdf')]).problem === '', '');
check('several photos open together', om.plan([f('1.jpg'), f('2.png')]).images.length === 2, '');
check('HEIC is explained', /HEIC/.test(om.plan([f('1.heic'), f('2.jpg')]).problem) && /JPEG or PNG/.test(om.plan([f('1.heic')]).problem), '');
check('other files are explained', /not a PDF or a photo/.test(om.plan([f('notes.docx')]).problem) && /one PDF at a time/.test(om.plan([f('a.pdf'), f('b.pdf')]).problem), '');
check('password wording', /password-protected/.test(om.forError({ name: 'PasswordException', message: 'No password given' }, {})), '');
check('damaged wording', /not a readable PDF/.test(om.forError({ name: 'InvalidPDFException', message: 'Invalid PDF structure.' }, { size: 10 })), '');
check('too-big wording', /too big/.test(om.forError(new RangeError('Array buffer allocation failed'), { size: 10 })) && /too big/.test(om.forError(new Error('x'), { size: 2 * 1024 * 1024 * 1024 })), '');
check('empty file wording', /empty/.test(om.forError(new Error('x'), { size: 0 })), '');
const all = [om.forError(new Error('boom'), {}), om.forImageError('p.jpg'), om.plan([f('a.gif')]).problem].join(' ');
check('no jargon in messages', !/OCR|text layer|xref|exception/i.test(all.replace('(boom)', '')), all);

// 8. State markup: a title, the explanation, primary action first, everything escaped
const html = states.stateHtml({ kind: 'pictures', title: 'These pages are <pictures>', text: 'No text.', tip: 'A tip.', actions: [{ act: 'open', label: 'Open another file' }, { act: 'reader', label: 'Look at the pages' }], detail: 'x' });
check('state markup', /data-state="pictures"/.test(html) && html.includes('&lt;pictures&gt;') && /btn-primary" type="button" data-state-act="open"/.test(html) && /btn-secondary" type="button" data-state-act="reader"/.test(html) && /empty-tip/.test(html) && /empty-detail/.test(html), html);

console.log(`dead_end_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * Summary fixtures (Node): the DOM-free outline core and its rendering.
 *   summary-statements.js  dangling / incomplete / glued rejection, domain-neutral scoring, length scaling
 *   book-sections.js       headings (numbered, by type size), running heads, examples, margin notes, box labels
 *   book-outline.js        per-heading definitions, boxes and key statements, each with its page
 *   deck-sections.js       non-content slides, objectives, cases, header slides, repeated titles
 *   deck-outline.js        verbatim bullets nested under their parent, tables, no handwriting layer, linked terms
 *   summary-view.js        <details> outline, first two open, every line linked, term links resolve
 * All text below is written for these fixtures (an imaginary course on pumps and pipes).
 * Run: node tests/summary_fixtures.js
 */
const path = require('path');
const nlp = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
const ui = (f) => require(path.join(__dirname, '..', 'src', 'ui', f));

['math-text.js', 'stem-noise.js', 'noise-filter.js', 'tokenizer.js', 'bold-terms.js', 'definition-miner.js', 'keywords.js',
  'key-terms.js', 'graph-rank.js', 'stem-cards.js', 'slide-model.js', 'slide-quiz.js', 'slide-units.js', 'deck-terms.js', 'book-blocks.js'].forEach(nlp);
const st = nlp('summary-statements.js');
const bs = nlp('book-sections.js');
const bo = nlp('book-outline.js');
const ds = nlp('deck-sections.js');
const dout = nlp('deck-outline.js');
const summarizer = nlp('summarizer.js');
['math-renderer.js', 'rich-text.js', 'rich-blocks.js', 'study-views.js', 'summary-outline.js'].forEach(ui);
const sumView = ui('summary-view.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// ---------- 1. Statements: what may stand alone ----------
const REJECT = {
  'This means that the pressure doubles at the outlet.': 'dangling',
  'It is pumped through the main line every hour of the day.': 'dangling',
  'Such valves are common in older buildings and farms.': 'dangling',
  'Sentences 1 and 2 describe valves that are always closed.': 'dangling',
  'Instead, the fluid is stored in a tank above the pump.': 'dangling',
  'The flow rate of a pump is computed as follows:': 'incomplete',
  'The pump draws water from the tank and then': 'incomplete',
  'What is the difference between a valve and a pump?': 'question',
  'To understand the role of valves in a closed water circuit': 'objective',
  'In this section we will study how valves control the flow.': 'meta',
  'Suppose you want to move water up a tall building quickly.': 'setup',
  'Pumps and Valves A pump moves fluid from one place to another.': 'glued',
  'CENTRIFUGAL AND PISTON PUMPS We can classify pumps by how they move fluid.': 'glued',
  '**(Flow, Head) S Power** Here the power depends on both flow and head.': 'glued',
  '$Apump$ is a machine that moves fluid through a pipe.': 'mangled',
  'A pipe of **dia- meter** two inches carries the main flow today.': 'mangled',
  'count = count + 1; total = total + count; return total;': 'code',
};
for (const [s, why] of Object.entries(REJECT)) {
  check(`statement rejected (${why}): ${s.slice(0, 40)}`, st.rejectReason(s) !== null, `got ${st.rejectReason(s)}`);
}
const KEEP = [
  'A valve is a device that controls the flow of fluid through a pipe.',
  'In general, a wider pipe lowers the friction loss for the same flow rate.',
  'A centrifugal pump adds energy to the fluid by spinning it outward from the center.',
  'The head of a pump is the height to which it can raise a column of water.',
];
for (const s of KEEP) check(`statement kept: ${s.slice(0, 40)}`, st.rejectReason(s) === null, `got ${st.rejectReason(s)}`);

// Scoring: topic sentence first, cue and defined term count, meta talk does not.
const plain = 'Pipes are often made from copper or plastic in modern homes.';
check('score: first in paragraph beats later', st.score(plain, { indexInParagraph: 0 }) > st.score(plain, { indexInParagraph: 3 }));
check('score: a defined term counts', st.score('A gate valve stops the flow completely when it is closed.', { indexInParagraph: 2, terms: ['gate valve'] }) >
  st.score('The workers closed the main line before lunch on most days.', { indexInParagraph: 2, terms: ['gate valve'] }));
check('score: structural cue counts', st.score('A check valve is defined as a valve that lets fluid pass one way.', { indexInParagraph: 2 }) >
  st.score('A check valve sits near the pump on most farm systems today.', { indexInParagraph: 2 }));
check('score: no subject word list', st.score('The integral of the derivative is a function with a limit.', { indexInParagraph: 2 }) ===
  st.score('The garden of the neighbour is a meadow with a fence.', { indexInParagraph: 2 }));

// Length scales with the scope: one per 250 words, at least 3, at most 25.
check('budget: short scope gets the minimum', st.budget(120) === 3, st.budget(120));
check('budget: 2500 words -> 10', st.budget(2500) === 10, st.budget(2500));
check('budget: long scope is capped', st.budget(40000) === 25, st.budget(40000));
const shares = st.allocate([{ words: 1000, available: 9 }, { words: 200, available: 4 }, { words: 50, available: 0 }], 4);
check('allocate: proportional, capped, empty sections get none', shares[0] >= shares[1] && shares[1] >= 1 && shares[2] === 0 && shares.every((n) => n <= 3) && shares.reduce((a, b) => a + b, 0) === 4, JSON.stringify(shares));

// ---------- 2. Book sections ----------
const L = (text, extra = {}) => ({ text, fontSize: 10, isBold: false, x0: 72, topY: 0, ...extra });
const page10 = [
  L('12 CHAPTER 1 / Pumps and Pipes', { fontSize: 9, topY: 20 }),
  L('1.1 Pumps', { fontSize: 14, isBold: true, topY: 60 }),
  L('A pump is a machine that moves fluid from a low place to a high place by adding', { topY: 80 }),
  L('energy to it. Pumps are used in homes, farms and factories.', { topY: 92 }),
  L('In general, a pump that turns faster raises water to a greater height than a slow', { x0: 84, topY: 104 }),
  L('one. The height a pump can reach is called the head of the pump.', { topY: 116 }),
  L('EXAMPLE 1', { isBold: true, topY: 130 }),
  L('A farm pump lifts water to a tank that is ten meters above the ground today.', { topY: 142 }),
  L('The pump runs for two hours and fills the tank completely before noon. ◂', { topY: 154 }),
  L('Definition 1', { isMargin: true, x0: 10, topY: 170 }),
  L('A valve is a device that controls the flow of fluid through a pipe or a channel.', { topY: 170 }),
  L('Henry Pumpwright (1801–1870) was born on a farm and later built the first pumps.', { isMargin: true, x0: 10, topY: 200 }),
];
const page11 = [
  L('Valves and Fittings', { fontSize: 12.5, topY: 60 }),
  L('A check valve lets fluid pass in one direction only and closes when the flow turns', { topY: 80 }),
  L('back. Every pump line needs a check valve near the outlet of the pump.', { topY: 92 }),
  L('The gate valve is used when the line must be closed completely for repairs.', { x0: 84, topY: 104 }),
  L('13 CHAPTER 1 / Pumps and Pipes', { fontSize: 9, topY: 20 }),
];
const pages = [{ pageNumber: 10, height: 792, lines: page10 }, { pageNumber: 11, height: 792, lines: page11 }];
// The cleaned scope text the text cleaner would produce: dropped example label, margin notes after the flow.
const scopeText = [
  '12 CHAPTER 1 / Pumps and Pipes',
  '1.1 Pumps',
  'A pump is a machine that moves fluid from a low place to a high place by adding',
  'energy to it. Pumps are used in homes, farms and factories.',
  'In general, a pump that turns faster raises water to a greater height than a slow',
  'one. The height a pump can reach is called the head of the pump.',
  'A farm pump lifts water to a tank that is ten meters above the ground today.',
  'The pump runs for two hours and fills the tank completely before noon. ◂',
  'A valve is a device that controls the flow of fluid through a pipe or a channel.',
  'Valves and Fittings',
  'A check valve lets fluid pass in one direction only and closes when the flow turns',
  'back. Every pump line needs a check valve near the outlet of the pump.',
  'The gate valve is used when the line must be closed completely for repairs.',
  '13 CHAPTER 1 / Pumps and Pipes',
  'Definition 1',
  'Henry Pumpwright (1801–1870) was born on a farm and later built the first pumps.',
].join('\n');
const secs = bs.split(scopeText, { pages, startPage: 10 });
const titles = secs.map((s) => s.title);
check('sections: numbered heading and a heading by type size', titles.includes('1.1 Pumps') && titles.includes('Valves and Fittings'), JSON.stringify(titles));
check('sections: running heads are not sections', !titles.some((t) => /CHAPTER/.test(t)), JSON.stringify(titles));
check('sections: pages from the raw lines', secs.find((s) => s.title === 'Valves and Fittings').page === 11);
const pumps = secs.find((s) => s.title === '1.1 Pumps');
const kinds = pumps.paragraphs.map((p) => p.kind);
check('sections: example region set apart', kinds.includes('example') && pumps.paragraphs.find((p) => p.kind === 'example').text.includes('farm pump'), JSON.stringify(kinds));
check('sections: margin notes set apart', secs.some((s) => s.paragraphs.some((p) => p.kind === 'margin' && /Pumpwright/.test(p.text))));
check('sections: a margin box label opens its box', pumps.paragraphs.some((p) => p.box && p.box.number === '1' && /valve is a device/.test(p.text)), JSON.stringify(pumps.paragraphs.map((p) => [p.kind, p.box, p.text.slice(0, 30)])));
check('sections: without pages, only numbered headings', bs.split(scopeText, { startPage: 10 }).map((s) => s.title).filter(Boolean).every((t) => /^\d/.test(t)));

// ---------- 3. Book outline ----------
const book = bo.build(scopeText, { pages, startPage: 10, endPage: 11, title: 'Pumps' });
check('book: honest lead names the pages', book.lead === 'Key points from pages 10–11, in the book\'s own words.', book.lead);
const allText = JSON.stringify(book);
check('book: nothing from the example', !/farm pump lifts/.test(allText));
check('book: nothing from the biography', !/Pumpwright/.test(allText));
const pumpSec = book.sections.find((s) => s.title === '1.1 Pumps');
check('book: definition box under its heading', pumpSec && pumpSec.blocks.some((b) => b.label === 'Definition 1' && b.title === 'Valve' && b.page === 10), JSON.stringify(pumpSec && pumpSec.blocks));
check('book: "is called" definition found', book.sections.some((s) => s.definitions.some((d) => /^Head/i.test(d.term))), JSON.stringify(book.sections.map((s) => s.definitions)));
const statements = book.sections.flatMap((s) => s.statements);
check('book: at least the minimum statements', statements.length >= 3 || book.sections.reduce((n, s) => n + s.definitions.length + s.blocks.length + s.statements.length, 0) >= 3, JSON.stringify(statements));
check('book: every statement stands alone', statements.every((s) => st.rejectReason(s.text) === null), JSON.stringify(statements));
check('book: every item has a page', book.sections.every((s) => [...s.blocks, ...s.definitions, ...s.formulas, ...s.statements].every((x) => x.page >= 10 && x.page <= 11)));
check('book: never more than three statements per heading', book.sections.every((s) => s.statements.length <= 3));
check('book: key terms point at entries', book.terms.length >= 1 && book.terms.every((t) => t.ref && t.page));
const viaSummarizer = summarizer.summarizeText(scopeText, { outline: { pages, startPage: 10, endPage: 11, title: 'Pumps' } });
check('summarizeText: keeps its sentences and adds the outline', Array.isArray(viaSummarizer.sentences) && viaSummarizer.outline && viaSummarizer.outline.kind === 'book');
check('summarizeText: no outline unless asked (quiz callers)', summarizer.summarizeText(scopeText, { topK: 3 }).outline === undefined);

// ---------- 4. Deck sections and outline ----------
const nb = (text, level, fontSize = 20, extra = {}) => ({ text, formattedText: text, level, fontSize, ...extra });
const deck = [
  { slideNumber: 1, title: 'Pumps for Small Farms', bullets: ['Dr. A. Example, PhD', 'a.example@school.edu'] },
  { slideNumber: 2, title: 'Learning Objectives', bullets: ['Explain how a centrifugal pump raises water', 'Choose a valve for a farm line'] },
  { slideNumber: 3, title: 'Pump impellers', bullets: [], kind: 'section' },
  { slideNumber: 4, title: 'Impeller', bullets: ['The impeller spins the water outward', 'Faster spin gives more head', 'Vane', 'Casing'],
    nestedBullets: [nb('The impeller spins the water outward', 0), nb('Faster spin gives more head', 1), nb('Vane', 0, 11), nb('Casing', 0, 11)] },
  { slideNumber: 5, title: 'Impeller (cont)', bullets: ['Worn vanes lower the head', 'pumpy fasterr', 'Head = height the pump can lift water'],
    nestedBullets: [nb('Worn vanes lower the head', 0), nb('pumpy fasterr', 0, 20, { isAnnotation: true }), nb('**Head** = height the pump can lift water', 0)] },
  { slideNumber: 6, title: 'Case 1: Dry trough', bullets: ['A 6-year-old pump on a hill farm', 'Trough empty each morning'] },
  { slideNumber: 7, title: 'Case 1: Dry trough', bullets: ['Check valve found stuck open'] },
  { slideNumber: 8, title: 'Kahoot Question', bullets: ['Pumpy'] },
  { slideNumber: 9, title: 'Valves', bullets: [], kind: 'section' },
  { slideNumber: 10, title: 'Valve types', bullets: ['Gate valve: closes the line fully', 'Check valve: one direction only'],
    table: { rows: [['Valve', 'Use'], ['Gate', 'Shut-off'], ['Check', 'Stop backflow']] } },
  { slideNumber: 11, title: 'Valve flow by pipe size', bullets: ['Pipe | Flow', '1 inch | 20 L/min', '2 inch | 80 L/min'] },
  { slideNumber: 12, title: 'References', bullets: ['https://example.org/pumps'] },
  { slideNumber: 13, title: 'Questions?', bullets: [] },
];
check('deck role: title slide skipped', ds.role(deck[0], 0) === 'skip');
check('deck role: objectives', ds.role(deck[1], 1) === 'objectives');
check('deck role: header slide', ds.role(deck[2], 2) === 'header');
check('deck role: case slide', ds.role(deck[5], 5) === 'case');
// The student's pen notes: shown only when they read as real words (the deck prints them), never debris.
const notesLib = nlp('annotation-notes.js');
const noteVocab = notesLib.vocabulary(deck);
const shownNotes = notesLib.readable([{ text: 'spin gives head' }, { text: 'pumpy fasterr^2' }, { text: 'to the' }, { text: 'Vane' }, { text: 'spin gives head' }], noteVocab);
check('pen notes: readable ones kept once, debris and function words dropped', JSON.stringify(shownNotes) === JSON.stringify(['spin gives head']), JSON.stringify(shownNotes));
check('deck role: quiz game skipped', ds.role(deck[7], 7) === 'skip');
check('deck role: references and closing skipped', ds.role(deck[11], 11) === 'skip' && ds.role(deck[12], 12) === 'skip');
check('deck: same topic across "(cont)"', ds.sameTopic('Impeller', 'Impeller (cont)') && !ds.sameTopic('Impeller', 'Valve types'));

const outline = dout.build(deck);
const secTitles = outline.sections.map((s) => s.title);
check('deck outline: sections from header slides', JSON.stringify(secTitles) === JSON.stringify(['Pump impellers', 'Valves']), JSON.stringify(secTitles));
check('deck outline: objectives listed once at the top', outline.covers.length === 2 && outline.covers[0].page === 2);
const deckText = JSON.stringify(outline);
check('deck outline: no handwriting layer', !/pumpy fasterr/.test(deckText));
check('deck outline: no case, quiz-game or contact text', !/Dry trough|stuck open|Pumpy"|school\.edu/.test(deckText));
check('deck outline: figure labels dropped', !/"Vane"|"Casing"/.test(deckText));
const impeller = outline.sections[0].topics[0];
check('deck outline: repeated titles form one topic', impeller.slides.length === 2 && impeller.slides.map((e) => e.page).join() === '4,5');
check('deck outline: nested bullet under its parent', impeller.slides[0].bullets[0].children.includes('Faster spin gives more head'), JSON.stringify(impeller.slides[0]));
const sourceLines = new Set(deck.flatMap((s) => [...(s.bullets || []), ...((s.nestedBullets || []).map((b) => b.formattedText))]));
const shown = outline.sections.flatMap((s) => s.topics.flatMap((t) => t.slides.flatMap((e) => e.bullets.flatMap((b) => [b.text, ...b.children]))));
check('deck outline: every line verbatim from a slide (no stitched sentences)', shown.length > 0 && shown.every((t) => sourceLines.has(t)), JSON.stringify(shown));
const valveSlide = outline.sections[1].topics.flatMap((t) => t.slides).find((e) => e.page === 10);
check('deck outline: extraction table kept as a table', valveSlide && valveSlide.table && valveSlide.table.rows.length === 3);
const pipeSlide = outline.sections[1].topics.flatMap((t) => t.slides).find((e) => e.page === 11);
check('deck outline: " | " rows rebuilt into a table', pipeSlide && pipeSlide.table && pipeSlide.table.rows[1][1] === '20 L/min' && !pipeSlide.bullets.length, JSON.stringify(pipeSlide));
check('deck outline: every slide entry has its slide', outline.sections.every((s) => s.topics.every((t) => t.slides.every((e) => e.page > 0))));
check('deck outline: emphasised or "=" terms link to their bullet', outline.terms.some((t) => t.term === 'Head' && t.page === 5), JSON.stringify(outline.terms));
const tableBlock = dout.tableOf({ blocks: [{ kind: 'table', header: ['A', 'B'], rows: [['1', '2']] }] }, { bullets: [] });
check('deck outline: table blocks with a header row', tableBlock && tableBlock.rows[0][0] === 'A' && tableBlock.rows.length === 2);
check('deck outline: contentFilter absent is fine; present it is consulted', (() => {
  // The real filter with one answer overridden: slide-model.js also calls it, so a bare stub is not enough.
  const real = require('../src/nlp/content-filter.js');
  globalThis.PDFStudy.contentFilter = Object.assign({}, real, { slideKind: () => 'content', isStudyContent: (s) => s.slideNumber !== 4 });
  const o = dout.build(deck);
  globalThis.PDFStudy.contentFilter = real;
  return !JSON.stringify(o).includes('impeller spins');
})());
check('summarizeSlides: outline alongside the earlier fields', (() => {
  const s = summarizer.summarizeSlides(deck, 7);
  return s.outline && s.outline.kind === 'deck' && Array.isArray(s.slideBreakdown) && Array.isArray(s.overviewSentences);
})());

// ---------- 5. Rendering ----------
const html = sumView.outlineHtml(outline);
check('render: sections are <details>, first two open', (html.match(/<details class="sum-sec"/g) || []).length === 2 && (html.match(/<details class="sum-sec" open>/g) || []).length === 2, html.slice(0, 400));
check('render: lead sentence shown', html.includes('Outline of slides'));
check('render: slide links', /data-jump-page="4">Slide&nbsp;4/.test(html) && /data-jump-page="11"/.test(html));
check('render: covers under their heading', html.includes('What this lecture covers'));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
const hrefs = [...html.matchAll(/data-sum-ref="([^"]+)"/g)].map((m) => m[1]);
check('render: every key term link resolves', hrefs.length > 0 && hrefs.every((h) => ids.has(h)), JSON.stringify([hrefs, [...ids]]));
check('render: table rendered as a table', /<table class="data-table">/.test(html));
const bookHtml = sumView.outlineHtml(book);
check('render: book items linked to pages', /View p\.&nbsp;10/.test(bookHtml) && /View p\.&nbsp;11/.test(bookHtml));
const many = { kind: 'book', lead: 'x', terms: [], sections: [1, 2, 3, 4].map((i) => ({ title: `Part ${i}`, page: i, blocks: [], definitions: [], formulas: [], statements: [{ text: 'A pump moves water from a low tank to a high tank.', page: i }] })) };
const manyHtml = sumView.outlineHtml(many);
check('render: only the first two parts open', (manyHtml.match(/ open>/g) || []).length === 2 && (manyHtml.match(/<details/g) || []).length === 4);
check('render: empty outline gives nothing (caller shows the empty state)', sumView.outlineHtml({ kind: 'book', sections: [], terms: [] }) === '');

// ---------- 6. Nothing dropped silently, pairing by layout, damaged notation, real terms ----------
const kt = nlp('key-terms.js');
const bblocks = nlp('book-blocks.js');
const lines9 = ['Pumps need priming before the first start', 'A dry pump overheats within minutes', 'Seals wear faster when run dry',
  'Check the intake strainer every week', 'Keep the suction line short and straight', 'Mount the pump below the tank level',
  'Fit a foot valve on a lift line', 'Bleed trapped air at the casing vent', 'Log the run hours for each pump'];
const longDeck = [{ slideNumber: 2, title: 'Pump care', bullets: lines9, nestedBullets: lines9.map((t) => nb(t, 0)) }];
const care = dout.build(longDeck).sections[0].topics[0].slides[0];
const listed = [...care.bullets, ...care.more].map((b) => b.text);
check('deck: every line is shown or held back, none dropped', lines9.every((t) => listed.includes(t)), JSON.stringify(care));
check('deck: the held lines are counted for "N more on this slide"', care.held === care.more.length && care.held === lines9.length - care.bullets.length && care.held > 0, JSON.stringify(care));
check('deck: shown points follow the slide order', care.bullets.map((b) => lines9.indexOf(b.text)).every((v, i, a) => !i || v > a[i - 1]));

// Two side-by-side columns, each with "Pros:" and "Cons:": items stay with their own column's block.
const col = (text, column) => nb(text, 0, 20, { layoutColumn: column });
const twoCol = [{ slideNumber: 3, title: 'Choosing a pump', bullets: [],
  nestedBullets: [col('Centrifugal pump', 1), col('Pros:', 1), col('High flow', 1), col('Cons:', 1), col('Needs priming', 1),
    col('Piston pump', 2), col('Pros:', 2), col('High head', 2), col('Cons:', 2), col('Pulsing flow', 2)] }];
const pick = dout.build(twoCol).sections[0].topics[0].slides[0].bullets;
const unitOf = (head) => pick.find((b) => b.text === head) || { children: [] };
check('deck: column blocks keep their own pros and cons', unitOf('Centrifugal pump').children.join('|') === 'Pros: High flow|Cons: Needs priming' &&
  unitOf('Piston pump').children.join('|') === 'Pros: High head|Cons: Pulsing flow', JSON.stringify(pick));

// A title that swallowed the first label, a body line at title size, short labels over glyph items.
const glyphSlide = [{ slideNumber: 4, title: 'Low flow •Clean the strainer', bullets: [],
  nestedBullets: [nb('•Check the float switch', 1, 15), nb('Medium flow', 1, 15), nb('•Replace the impeller •Check the seals', 1, 15),
    nb('Pump faults $•Reset$ breaker', 0, 27), nb('No flow', 1, 15), nb('•Call the installer', 1, 15)] }];
const fault = dout.build(glyphSlide).sections[0].topics[0];
const faultUnits = Object.fromEntries(fault.slides[0].bullets.map((b) => [b.text, b.children]));
check('deck: labels own the glyph items under them', JSON.stringify(faultUnits['Low flow']) === JSON.stringify(['Clean the strainer; Check the float switch']) || (faultUnits['Low flow'] || []).join(' ').includes('float switch'), JSON.stringify(faultUnits));
check('deck: each label keeps its own block', (faultUnits['Medium flow'] || []).join(' ').includes('Replace the impeller') && (faultUnits['No flow'] || []).join(' ').includes('Call the installer') &&
  !(faultUnits['Low flow'] || []).join(' ').includes('impeller'), JSON.stringify(faultUnits));
check('deck: a title-size body line names the slide', fault.title === 'Pump faults', fault.title);

// A badge repeated on every slide and a web address run into a table cell are not content.
const badgeDeck = [5, 6, 7].map((n) => ({ slideNumber: n, title: `Valve ${['gate', 'globe', 'ball'][n - 5]} details`, bullets: [],
  nestedBullets: [nb(`The ${['gate', 'globe', 'ball'][n - 5]} valve suits a farm line`, 0), nb('Safety First', 0)],
  table: n === 7 ? { rows: [['Valve', 'Use'], ['Ball', 'Shut-off http://example.org/valves']] } : null }));
const badgeOut = JSON.stringify(dout.build(badgeDeck));
check('deck: a badge on every slide is dropped', !/Safety First/.test(badgeOut), badgeOut.slice(0, 300));
check('deck: a web address is removed from a table cell', /"Shut-off"/.test(badgeOut) && !/example\.org/.test(badgeOut));
// A picture slide's title does not claim the next, unrelated topic as its section.
const picDeck = [{ slideNumber: 1, title: 'Farm Visit', bullets: [], kind: 'section' },
  { slideNumber: 2, title: 'Gate valves', bullets: ['A gate valve shuts the line fully', 'Never throttle with a gate valve'] }];
check('deck: an unrelated header slide opens no section', dout.build(picDeck).sections[0].title === 'Gate valves', JSON.stringify(dout.build(picDeck).sections.map((s) => s.title)));

// Notation whose complement bar was lost reads as a falsehood: known damage is caught, true lines are not.
check('math: "X + X = 1" is damaged', st.mathDamage('By the complement law, X + X = 1 for any variable X.') === 'complement');
check('math: "Q = 1 and Q = 0" is damaged', st.mathDamage('In the set state Q = 1 and Q = 0 at the outputs.') === 'complement');
check('math: an operator glyph read as "#" is damaged', st.mathDamage('so that F = X # Y + Z holds') === 'operator');
check('math: intact notation passes', !st.mathDamage("By the complement law, X + X' = 1 for any variable X.") && !st.mathDamage('The output is the same for both X = 0 and X = 1.') &&
  !st.mathDamage('$\\overline{X} + X = 1$ always holds.'));
check('math: a damaged statement is not lifted', st.rejectReason('By the complement law, X + X = 1 for any variable in the pump circuit.') === 'math');
check('statements: an analogy or a dated aside is not lifted', st.rejectReason('Like a valve that opens under pressure, a fuse breaks the circuit.') === 'aside' &&
  st.rejectReason('In 1902, an engineer published a paper on pumps and valves.') === 'aside');
check('statements: names from a worked example are not lifted', st.rejectReason('The PumpCost depends on the NumberOfValves in the order.') === 'identifier');
check('mangled: prose between two math spans is not read as math', !st.isMangled('If $A$ and $B$ are pumps, then $A$ and $B$ share a line.'));

check('terms: real names pass', kt.realTerm("Hansen's type 1") && kt.realTerm('Relational operator') && kt.realTerm('Check valve'));
check('terms: identifiers, file names and furniture fail', !kt.realTerm('CookieCost') && !kt.realTerm('sec01/Pump.java') && !kt.realTerm('Kahoot Question') && !kt.realTerm('Learning Objectives'));
check('terms: a hyphen-broken fragment fails', !kt.realTerm('Tab char-') && !kt.realTerm('Acters', 'set the **tab char-** **acters** to spaces') && !kt.realTerm('Tab char- acters'));

// ---------- 7. Book blocks from the extraction (scope.blocks / scope.tables / scope.lines) ----------
const defBlock = bblocks.item({ kind: 'definition', category: 'Definition', id: 'b1', title: 'Definition 3', body: 'A valve is said to be closed if no fluid passes it.', pageNumber: 12 });
check('book blocks: a numbered definition is titled by its term', defBlock && defBlock.title === 'Closed' && defBlock.label === 'Definition 3', JSON.stringify(defBlock));
const subjectDef = bblocks.item({ kind: 'definition', category: 'Definition', id: 'b2', title: 'Definition 4', body: 'Let $p$ be a pump. The head of $p$, denoted by $h(p)$, is the height it can lift water.', pageNumber: 12 });
check('book blocks: the subject of "The X of p, denoted by ..., is" is the term', subjectDef && subjectDef.title === 'Head', JSON.stringify(subjectDef));
check('book blocks: tips and walkthroughs are not shown', bblocks.item({ kind: 'sidebar', category: 'Programming Tip', id: 'b3', title: 'Tip 1', body: 'Indent with spaces.' }) === null &&
  bblocks.item({ kind: 'example', category: 'Worked Example', id: 'b4', title: 'Example 1', body: 'A farm pump ...' }) === null);
const errCtx = bblocks.context([
  { text: '**Common Error 2.1**', kind: 'heading', blockId: 'e1', pageNumber: 13 },
  { text: '**Running a Pump Dry**', kind: 'heading', blockId: 'e1', pageNumber: 13 },
  { text: 'If you start the pump with', kind: 'prose', blockId: 'e1', pageNumber: 13 },
  { text: '```\npump.start()\n```', kind: 'code', blockId: 'e1', pageNumber: 13 },
  { text: 'the seals burn. Never start a pump before the casing is full of water.', kind: 'prose', blockId: 'e1', pageNumber: 13 },
]);
const errBlock = bblocks.item({ kind: 'sidebar', category: 'Common Error', id: 'e1', title: 'Common Error 2.1', body: 'Running a Pump Dry', pageNumber: 13 }, errCtx);
check('book blocks: a common error shows its subtitle and its point, never prose glued across code', errBlock && errBlock.title === 'Running a Pump Dry' &&
  /Never start a pump/.test(errBlock.body) && !/start the pump with the seals/.test(errBlock.body), JSON.stringify(errBlock));
const lostBar = bblocks.item({ kind: 'theorem', category: 'Theorem', id: 't1', title: 'Theorem 2', body: 'For every signal X, X + X = 1.', pageNumber: 14 });
check('book blocks: a box with damaged notation is flagged', lostBar && lostBar.flag === 'symbols', JSON.stringify(lostBar));
check('book blocks: sample records are not a table', bblocks.table({ pageNumber: 12, header: ['100', 'Ann', 'ann@example.com'], rows: [['200', 'Bob', 'bob@example.com'], ['300', 'Cy', 'cy@example.com']] }) === null);
const teach = bblocks.table({ pageNumber: 12, header: ['Valve', 'Use'], rows: [['Gate', 'Shut-off'], ['Check', 'Stop backflow']] });
check('book blocks: a table with a header of words is kept with its page', teach && teach.rows.length === 3 && teach.page === 12);
check('book blocks: a table whose header lost its complement marks is dropped', bblocks.table({ pageNumber: 12, header: ['X', 'X'], rows: [['0', '1'], ['1', '0']] }) === null);

// Book outline with the scope's tagged lines: a box's heading is not a section; its block shows under its heading.
const taggedText = ['1.2 Valves', 'A valve controls the flow of fluid through a pipe in every farm line.', '**Programming Tip 1.1**', '**Label Your Valves**',
  'Mark each valve with its line.', 'A check valve stops backflow when the pump stops running at night.'].join('\n');
const taggedLines = [
  { text: '1.2 Valves', kind: 'heading', blockId: null, pageNumber: 12, inText: true },
  { text: 'A valve controls the flow of fluid through a pipe in every farm line.', kind: 'prose', blockId: null, pageNumber: 12, inText: true },
  { text: '**Programming Tip 1.1**', kind: 'heading', blockId: 'p1', pageNumber: 12, inText: true },
  { text: '**Label Your Valves**', kind: 'heading', blockId: 'p1', pageNumber: 12, inText: true },
  { text: 'Mark each valve with its line.', kind: 'prose', blockId: 'p1', pageNumber: 12, inText: true },
  { text: 'A check valve stops backflow when the pump stops running at night.', kind: 'prose', blockId: null, pageNumber: 12, inText: true },
];
const taggedBook = bo.build(taggedText, { startPage: 12, endPage: 12, lines: taggedLines,
  didacticBlocks: [{ kind: 'key-concept', category: 'Key Concept', id: 'k1', body: 'A check valve lets fluid pass one way only.', pageNumber: 12 },
    { kind: 'sidebar', category: 'Programming Tip', id: 'p1', title: 'Programming Tip 1.1', body: 'Label Your Valves Mark each valve with its line.', pageNumber: 12 }] });
check('book: a box heading is not a section', taggedBook.sections.every((s) => !/Label Your Valves|Programming Tip/.test(s.title)), JSON.stringify(taggedBook.sections.map((s) => s.title)));
const valveSec = taggedBook.sections.find((s) => s.title === '1.2 Valves');
check('book: key concept shown before lifted statements, tip left out', valveSec && valveSec.blocks.length === 1 && valveSec.blocks[0].category === 'Key concept' &&
  !JSON.stringify(taggedBook).includes('Mark each valve'), JSON.stringify(valveSec));

// ---------- 8. Rendering the new parts ----------
const heldHtml = sumView.outlineHtml(dout.build(longDeck));
check('render: held points behind "N more points on this slide"', new RegExp(`<details class="sum-more"><summary>${care.held} more points on this slide</summary>`).test(heldHtml) &&
  lines9.every((t) => heldHtml.includes(t)), heldHtml.slice(0, 300));
const flagHtml = sumView.outlineHtml({ kind: 'book', lead: 'x', terms: [], sections: [{ title: 'Laws', page: 14, blocks: [{ ...lostBar }], definitions: [], formulas: [], tables: [], statements: [] }] });
check('render: a flagged box says its symbols were lost and keeps its page', /class="sum-flag"/.test(flagHtml) && /were lost/.test(flagHtml) && /View p\.&nbsp;14/.test(flagHtml), flagHtml);
const defHtml = sumView.outlineHtml({ kind: 'book', lead: 'x', terms: [], sections: [{ title: 'Valves', page: 12, blocks: [defBlock], definitions: [], formulas: [], tables: [teach], statements: [] }] });
check('render: definition badge keeps the book label, title is the term', /<span class="badge">Definition 3<\/span>/.test(defHtml) && /Closed/.test(defHtml) && /<table class="data-table">/.test(defHtml), defHtml);

// ---------- 9. Displayed results: numbered laws and named displays (book-formulas.js) ----------
const bf = nlp('book-formulas.js');
const lawParas = [
  { kind: 'prose', page: 30, text: '**pressure laws of the loop**' },
  { kind: 'table', page: 30, text: '1. P + 0 = P | 2. P ⋅ 1 = P 3. P + 1 = 1 | 4. P ⋅ 0 = 0' },
  { kind: 'list', page: 30, text: '5. $P + Q = Q + P$' },
  { kind: 'list', page: 30, text: '6. $P(QR) = (PQ)R$7.$PQ = QP$ The six laws above can be checked by substitution.' },
  { kind: 'prose', page: 31, text: 'Taken together, the two outlet rules are referred to as follows.' },
  { kind: 'math', page: 31, text: '$$F + G = G + F$$' },
  { kind: 'prose', page: 31, text: 'are referred to as the swap law of the loop. It is used everywhere.' },
  { kind: 'prose', page: 31, text: 'The following example shows how the swap law can be applied:' },
  { kind: 'math', page: 31, text: '$$A + B = B + A$$' },
  { kind: 'prose', page: 32, text: 'Along with the results above, the following merge theorem is useful when sizing a pump:' },
  { kind: 'math', page: 32, text: '$$PQ + RS = RS + PQ$$' },
  { kind: 'math', page: 32, text: '$$= SR + QP$$' },
];
const picked = bf.pick(lawParas);
const lawList = picked.find((f) => /^1\. /.test(f.body));
check('formulas: a numbered run of equations is one list under its caption', lawList && lawList.title === 'Pressure laws of the loop' &&
  lawList.body.split('\n').length === 7 && lawList.body.includes('7. $PQ = QP$') && lawList.body.includes('6. $P(QR) = (PQ)R$') && !/checked/.test(lawList.body), JSON.stringify(lawList));
check('formulas: a display named by the next line takes that name', picked.some((f) => f.title === 'Swap law' && f.body === '$F + G = G + F$'), JSON.stringify(picked));
check('formulas: a worked example\'s display is not a stated result', !picked.some((f) => /A \+ B/.test(f.body)), JSON.stringify(picked));
check('formulas: a display whose next line continues "= ..." is a derivation', !picked.some((f) => /merge/i.test(f.title)), JSON.stringify(picked));
check('formulas: a numbered list with a damaged item drops that item only', bf.pick([
  { kind: 'list', page: 1, text: '1. $A + B = B + A$' }, { kind: 'list', page: 1, text: '2. $A + A = 1$' },
  { kind: 'list', page: 1, text: '3. $AB = BA$' }, { kind: 'list', page: 1, text: '4. $A(BC) = (AB)C$' }]).every((f) => !/A \+ A = 1/.test(f.body)));

// ---------- 10. Slide units: numbered steps across columns, bold labels, label columns ----------
const su = nlp('slide-units.js');
const stepNode = (text, column) => ({ text, level: 0, fontSize: 12, column, glyph: false });
const cycle = su.units([stepNode('1. Water enters the inlet', 0), stepNode('3. Pressure builds in the casing', 0), stepNode('3. Pressure builds', 0),
  stepNode('2. The impeller spins it outward', 1), stepNode('4. Water leaves the outlet', 1)]);
check('units: numbered steps in two columns are one ordered list; a cut-short copy is dropped', cycle.map((u) => u.node.text).join('|') ===
  '1. Water enters the inlet|2. The impeller spins it outward|3. Pressure builds in the casing|4. Water leaves the outlet', JSON.stringify(cycle));
const boldUnits = su.units([{ text: '**Small pumps**', level: 0, fontSize: 24 }, { text: 'Gear pumps are used for oil.', level: 0, fontSize: 24 },
  { text: '**Large pumps**', level: 0, fontSize: 24 }, { text: 'Turbine pumps move river water.', level: 0, fontSize: 24 }, { text: 'Their seals need yearly checks.', level: 0, fontSize: 24 }]);
check('units: short bold lines own the sentences under them', boldUnits.length === 2 && boldUnits[1].children.length === 2, JSON.stringify(boldUnits));
const g = (text, column, glyph) => ({ text, level: 0, fontSize: 24, column, glyph });
const labelCols = su.units([g('Rotary pumps', 0, false), g('gear', 0, true), g('vane', 0, true), g('Piston pumps', 0, false), g('plunger', 0, true),
  g('Jet pumps', 1, false), g('steam', 1, true), g('water', 1, true)]);
check('units: a column of labelled lists gives one unit per label', labelCols.map((u) => `${u.node.text}:${u.children.map((c) => c.text).join(',')}`).join('|') ===
  'Rotary pumps:gear,vane|Piston pumps:plunger|Jet pumps:steam,water', JSON.stringify(labelCols));

// ---------- 11. Regression guards: page provenance, keyFormulas fallback, deck-terms filtering, table dedupe & subheading context ----------
const formulaBookText = [
  '1.1 Pipe Flow Basics',
  'A pump that moves liquid by spinning vanes is called a centrifugal pump.',
  'Taken together, the two continuity equations are written below.',
  '$$Q_1 + Q_2 = Q_3$$',
  'are referred to as the continuity law of the loop.',
].join('\n\n');
const bookSum = summarizer.summarizeText(formulaBookText, {
  headings: ['1.1 Pipe Flow Basics'],
  outline: {
    pages: [{ pageNumber: 12, lines: [
      { text: '1.1 Pipe Flow Basics', fontSize: 18, pageNumber: 12, x0: 40, topY: 40 },
      { text: 'Taken together, the two continuity equations are written below.', fontSize: 11, pageNumber: 12, x0: 40, topY: 80 },
      { text: '$$Q_1 + Q_2 = Q_3$$', fontSize: 11, pageNumber: 12, x0: 80, topY: 110 },
      { text: 'are referred to as the continuity law of the loop.', fontSize: 11, pageNumber: 12, x0: 40, topY: 140 },
    ] }],
    startPage: 12, endPage: 12, title: 'Pipes',
  },
});
check('summarizer: mined definition carries page and keyFormulas populates from outline formulas',
  bookSum.definitions.some((d) => d.term === 'Centrifugal pump' && d.page === 12) &&
  bookSum.keyFormulas.some((f) => f.title === 'Continuity law' && /Q_1 \+ Q_2/.test(f.body)), JSON.stringify([bookSum.definitions, bookSum.keyFormulas]));

const dtMod = nlp('deck-terms.js');
check('deck-terms: unbolded copula/genus definition is extracted while generic/case headings are rejected',
  dtMod.labelledTerm('Cavitation: vapor bubble process that erodes bronze impeller blades') === 'Cavitation' &&
  !dtMod.labelledTerm('Clinical Findings: mild vibration is noted under load') &&
  !dtMod.labelledTerm('Dogs: 5 mg/kg twice daily is the standard dose') &&
  !dtMod.labelledTerm('At shows: do not run pumps without suction water'));

const snb = (text, level = 0, glyph = true) => ({ text, formattedText: text, level, x0: 40 + level * 20, topY: 100, fontSize: 14, glyph });
const dupTableSlides = [
  { slideNumber: 2, title: 'Centrifugal Pump',
    bullets: ['Seal Assembly', 'Primary ring:', 'o Graphite face prevents dry friction', 'Secondary spring maintains axial load'],
    nestedBullets: [snb('Seal Assembly', 0, false), snb('Primary ring:', 1, true), snb('o Graphite face prevents dry friction', 2, true), snb('Secondary spring maintains axial load', 1, true)],
    blocks: [{ kind: 'table', header: ['Part', 'Material'], rows: [['Impeller', 'Bronze'], ['Casing', 'Cast iron']] }],
    tables: [{ header: ['Part', 'Material'], rows: [['Impeller', 'Bronze'], ['Casing', 'Cast iron']] }] },
  { slideNumber: 3, title: 'Centrifugal Pump (cont.)',
    bullets: ['Adverse Effects', 'Cavitation pitting erodes impeller blades under low intake head'],
    nestedBullets: [snb('Adverse Effects', 0, false), snb('Cavitation pitting erodes impeller blades under low intake head', 1, true)],
    blocks: [{ kind: 'table', header: ['Part', 'Material'], rows: [['Impeller', 'Bronze'], ['Casing', 'Cast iron']] }],
    tables: [{ header: ['Part', 'Material'], rows: [['Impeller', 'Bronze'], ['Casing', 'Cast iron']] }] },
];
const dedupOut = dout.build(dupTableSlides);
const slideSum = summarizer.summarizeSlides(dupTableSlides, 2);
check('deck outline: colon-child collapses cleanly, duplicate adjacent table drops, and overview prefixes slide subject',
  dedupOut.sections[0].topics[0].slides[0].bullets[0].children.includes('Primary ring: o Graphite face prevents dry friction') &&
  Boolean(dedupOut.sections[0].topics[0].slides[0].table) && !dedupOut.sections[0].topics[0].slides[1].table &&
  slideSum.overviewSentences.some((s) => /^Centrifugal Pump — Adverse Effects:/.test(s)), JSON.stringify([dedupOut.sections[0].topics[0].slides, slideSum.overviewSentences]));

const qTitleDeck = [
  { slideNumber: 2, title: 'Which of the Following is Valid?', bullets: ['A pump runs smoothly at low pressure without noisy vibration.'] },
  { slideNumber: 3, title: 'A flow rate depends strictly on rotor speed and head pressure.', bullets: ['Flow scales directly with speed when fluid viscosity stays constant.'] },
];
const qSum = summarizer.summarizeSlides(qTitleDeck, 4);
check('summarizer: question-form topic titles are never prepended onto slide overview statements',
  !qSum.overviewSentences.some((s) => /\?\s*—/.test(s)), JSON.stringify(qSum.overviewSentences));

console.log(`${failed ? 'FAIL' : 'PASS'}  summary fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

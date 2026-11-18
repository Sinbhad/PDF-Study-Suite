/**
 * Summary shape fixtures (Node): how the Summary keeps the material's own shape.
 *   math-runs.js        a formula inside prose comes out whole ("$p \to q$", "$|x|$", "$A \to C$."), a lone
 *                       operator between words is text, code-font "==" is never a formula
 *   book-blocks.js      side-by-side tables cut apart, truth tables kept, captions that run together reduced to labels
 *   book-law-table.js   a two-column numbered list of laws with names laid out as the book's table
 *   book-placement.js   a table filed where the text names it; a closing box filed under its numbered section
 *   book-sections.js    bold sub-headings at body size, two-line chapter titles, sentence-case lines in a numbered book
 *   book-outline.js     a box ending "Hence," keeps the display after it; an example's aside dropped from a definition
 *   slide-units.js      a bulleted list item in smaller type stays; a dose line is not garbled; a Title Case line
 *                       after a labelled group starts the next group
 *   deck-outline.js     packed table columns cut apart; a statement title becomes the slide's first point
 *   summary-damage.js   the unreadable-glyph mark never reaches the student
 *   printed-pages.js    the printed page number from page labels or from agreeing folios
 * All text is written for these fixtures (an imaginary course on pumps, valves and switches).
 * Run: node tests/summary_shape_fixtures.js
 */
const path = require('path');
const src = (dir, f) => require(path.join(__dirname, '..', 'src', dir, f));
['math-tex.js', 'math-runs.js', 'span-format.js'].forEach((f) => src('pdf', f));
const ML = src('pdf', 'math-line.js');
const PP = src('pdf', 'printed-pages.js');
['math-text.js', 'stem-noise.js', 'noise-filter.js', 'tokenizer.js', 'summary-statements.js', 'key-terms.js', 'definition-miner.js',
  'page-lines.js', 'slide-model.js', 'deck-terms.js'].forEach((f) => src('nlp', f));
const bb = src('nlp', 'book-blocks.js');
const law = src('nlp', 'book-law-table.js');
const place = src('nlp', 'book-placement.js');
const bs = src('nlp', 'book-sections.js');
const bo = src('nlp', 'book-outline.js');
const su = src('nlp', 'slide-units.js');
const dout = src('nlp', 'deck-outline.js');
const dmg = src('nlp', 'summary-damage.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// ---------- 1. Formulas inside prose ----------
const sp = (text, x0, x1, o = {}) => ({ text, x0, x1, fontSize: 10, baselineY: 100, topY: 90, bottomY: 100, isBold: false, isItalic: false, ...o });
const fmt = (spans) => ML.formatLine(spans).formattedText;
check('runs: an italic variable at the end of prose joins the formula after it',
  fmt([sp('the valve rule v', 10, 90, { isItalic: true }), sp('→', 92, 100, { isMath: true }), sp('w', 102, 107, { isItalic: true }), sp('holds here', 110, 160)]) === 'the valve rule $v \\to w$ holds here',
  fmt([sp('the valve rule v', 10, 90, { isItalic: true }), sp('→', 92, 100, { isMath: true }), sp('w', 102, 107, { isItalic: true }), sp('holds here', 110, 160)]));
check('runs: capital operands around an arrow in upright prose join it, the period stays outside',
  fmt([sp('so: IF A', 10, 60), sp('→', 62, 70, { isMath: true }), sp('B and B', 72, 110), sp('→', 112, 120, { isMath: true }), sp('C.', 122, 132)]) === 'so: IF $A \\to B$ and $B \\to C$.',
  fmt([sp('so: IF A', 10, 60), sp('→', 62, 70, { isMath: true }), sp('B and B', 72, 110), sp('→', 112, 120, { isMath: true }), sp('C.', 122, 132)]));
check('runs: bars on both sides enclose the formula', fmt([sp('the size |', 10, 60), sp('x', 61, 66, { isItalic: true }), sp('| of it', 67, 100)]) === 'the size $|x|$ of it',
  fmt([sp('the size |', 10, 60), sp('x', 61, 66, { isItalic: true }), sp('| of it', 67, 100)]));
check('runs: a lone operator between bold names is text', !/\$/.test(fmt([sp('Pump', 10, 40, { isBold: true }), sp('→', 42, 50, { isMath: true }), sp('Flow', 52, 80, { isBold: true })])),
  fmt([sp('Pump', 10, 40, { isBold: true }), sp('→', 42, 50, { isMath: true }), sp('Flow', 52, 80, { isBold: true })]));
check('runs: an operator set in the program font is code in a sentence', !/\$/.test(fmt([sp('the', 10, 30), sp('==', 32, 44, { isCode: true }), sp('test', 46, 70)])));
check('runs: an italic phrase of short words is emphasis, not a product', !/\$/.test(fmt([sp('a valve is open if', 10, 90), sp('it is in use', 92, 150, { isItalic: true }), sp('today.', 152, 180)])));

// ---------- 2. Tables ----------
const sideBySide = { pageNumber: 3, header: ['a', 'b', 'a ∧ b', 'a', 'b', 'a ∨ b'],
  rows: [['T', 'T', 'T', 'T', 'T', 'T'], ['T', 'F', 'F', 'T', 'F', 'T'], ['F', 'T', 'F', 'F', 'T', 'T'], ['F', 'F', 'F', 'F', 'F', 'F']] };
const ctx = bb.context([{ kind: 'caption', pageNumber: 3, text: 'TABLE 2 Valve truth TABLE 3 Switch truth' }]);
const apart = bb.separateTables([sideBySide], ctx);
check('tables: two tables printed side by side are cut apart', apart.length === 2 && apart[1].header.join('|') === 'a|b|a ∨ b', JSON.stringify(apart.map((t) => t.header)));
const shown = apart.map((t) => bb.table(t, ctx));
check('tables: a truth table is kept although its header is notation', shown.every(Boolean), JSON.stringify(shown));
check('tables: captions that run together give each table its label only', shown[0] && shown[0].title === 'Table 2' && shown[1].title === 'Table 3', JSON.stringify(shown.map((t) => t && t.title)));
check('tables: a grid of truth values without input columns is not a truth table', !bb.table({ pageNumber: 1, rows: [['0', '1', '1'], ['1', '0', '1'], ['1', '1', '0']] }, {}));

// ---------- 3. Law tables ----------
const line = (text, topY, extra = {}) => ({ text, x0: 70, x1: 300, topY, isMargin: false, ...extra });
const lawPages = [{ pageNumber: 7, lines: [
  line('1. P + 0 = P 2. P · 1 = P', 100, { segments: [{ text: '1. P + 0 = P', x0: 70 }, { text: '2. P · 1 = P', x0: 220 }] }),
  line('3. P + Q = Q + P 4. PQ = QP', 112, { segments: [{ text: '3. P + Q = Q + P', x0: 70 }, { text: '4. PQ = QP', x0: 220 }] }),
  line('5. P(QR) = (PQ)R 6. P + (Q + R) = (P + Q) + R', 124),
  { text: 'Swapping', x0: 360, x1: 400, topY: 112, isMargin: true },
  { text: 'Grouping', x0: 360, x1: 400, topY: 124, isMargin: true },
] }];
const cells = new Map([1, 2, 3, 4, 5, 6].map((n) => [n, `${n}. law ${n}`]));
const laid = law.build(lawPages, cells, { paired: true, title: 'Table 1 Switch laws' });
check('laws: two columns of numbered laws become a table with the dual beside each law', laid && laid.rows.length === 4 && laid.rows[1][1] === '2. law 2' && laid.rows[3][1] === '6. law 6', JSON.stringify(laid));
check('laws: the names printed beside rows stay on their rows', laid && laid.rows[0].join('|') === 'Law|Dual|Name' && laid.rows[2][2] === 'Swapping' && laid.rows[3][2] === 'Grouping', JSON.stringify(laid && laid.rows));
check('laws: a one-column numbered list is not a table', !law.build([{ pageNumber: 1, lines: [line('1. a = b', 10), line('2. c = d', 22), line('3. e = f', 34)] }], new Map([[1, 'x'], [2, 'y'], [3, 'z']])));

// ---------- 4. Placement ----------
const sec = (title, page, paragraphs) => ({ title, page, paragraphs });
const split = [
  sec('4.1 Valves', 10, [{ kind: 'prose', page: 10, text: 'A valve stops flow.' }]),
  sec('4.1.1 Gate valves', 10, [{ kind: 'prose', page: 10, text: 'Table 4 lists the gate valve sizes in use.' }]),
  sec('4.1.2 Check valves', 11, [{ kind: 'prose', page: 11, text: 'A check valve lets water pass one way only.' }, { kind: 'box', page: 12, blockId: 'b9', text: 'Common error' }]),
  sec('4.2 Pumps', 13, [{ kind: 'prose', page: 13, text: 'A pump moves water.' }]),
];
const tablesBy = place.tables(split, [{ pageNumber: 12, rows: [['Size', 'Use']] }], () => 'Table 4');
check('placement: a table goes under the heading whose text names it', (tablesBy.get(split[1]) || []).length === 1, [...tablesBy.keys()].map((s) => s.title).join(','));
const blocksBy = place.blocks(split, [{ id: 'b9', kind: 'sidebar', body: 'Common error' }], []);
check('placement: a box closing the last subsection is filed under its numbered section', (blocksBy.get(split[0]) || []).length === 1 && blocksBy.get(split[0])[0].id === 'b9',
  [...blocksBy].map(([s, l]) => `${s.title}:${l.map((b) => b.id)}`).join(','));

// ---------- 5. Sections and outline ----------
const page = (n, lines) => ({ pageNumber: n, lines: lines.map(([text, fontSize, isBold, topY]) => ({ text, fontSize, isBold, topY, x0: 72 })) });
const text = ['Pumps and Valves', '', '2 and Their Care', '', 'Water systems use pumps of many kinds. A pump must be primed before use.',
  '', 'Priming the Pump', 'However, a dry pump can still be primed with a bucket of water poured in slowly.', ''].join('\n');
const pages = [page(1, [['Pumps and Valves', 26, true, 80], ['2 and Their Care', 120, true, 110],
  ['Water systems use pumps of many kinds. A pump must be primed before use.', 10, false, 200], ['Priming the Pump', 10, true, 230],
  ['However, a dry pump can still be primed with a bucket of water poured in slowly.', 10, false, 245]])];
const parts = bs.split(text, { pages, startPage: 1 });
check('sections: a title set on two lines is one heading', parts[0].title === 'Pumps and Valves and Their Care', JSON.stringify(parts.map((p) => p.title)));
check('sections: a bold line at body size between sentences is a sub-heading', parts.some((p) => p.title === 'Priming the Pump'), JSON.stringify(parts.map((p) => p.title)));
const numbered = ['7.1 Valves', '', 'A valve stops the flow of water in a pipe when it is closed.', '', 'Turn the handle', '',
  'The handle is turned until it stops.', '', '7.2 Pumps', '', 'A pump moves water.'].join('\n');
const npages = [page(1, [['7.1 Valves', 14, true, 50], ['A valve stops the flow of water in a pipe when it is closed.', 10, false, 70],
  ['Turn the handle', 12, false, 90], ['The handle is turned until it stops.', 10, false, 110], ['7.2 Pumps', 14, true, 130], ['A pump moves water.', 10, false, 150]])];
check('sections: in a numbered book a sentence-case line in larger type is not a heading',
  !bs.split(numbered, { pages: npages, startPage: 1 }).some((p) => p.title === 'Turn the handle'), JSON.stringify(bs.split(numbered, { pages: npages, startPage: 1 }).map((p) => p.title)));
check('outline: an example tucked into a definition is left out', bo.withoutAside('The valve on the left, here valve A, is called the inlet.') === 'The valve on the left is called the inlet.');
check('outline: a worked example that ends "This is called" defines nothing',
  !bo.usableDefinition({ term: 'Water hammer', definition: 'If, say, a valve shuts fast, the pipe bangs. This is called water hammer.' }));

// ---------- 6. Slides ----------
check('units: a bulleted list item set smaller is kept', !su.lineNoise({ text: 'Gate valve', fontSize: 16, glyph: true, level: 1 }, 24, 24));
check('units: a dose line is not garbled', !su.lineNoise({ text: '10-20 mL above', fontSize: 24, glyph: true, level: 1 }, 24, 24));
const grouped = su.units([g('Uses', false), g('Moves water uphill', true), g('Fills tanks', true), g('Upkeep', false), g('Oil the shaft yearly', false)]);
function g(text, glyph) { return { text, level: 0, fontSize: 24, column: 0, glyph }; }
check('units: a Title Case line after a labelled group starts the next group', grouped.length === 2 && grouped[1].node.text === 'Upkeep' && grouped[1].children.length === 1,
  JSON.stringify(grouped.map((u) => [u.node.text, u.children.map((c) => c.text)])));
const packed = dout.tableOf({ table: { rows: [['Valve', 'Gate Check'], ['A', '1:10 1:20'], ['B', '<1:5 1:40'], ['C', '1:80 <1:5']] } }, { bullets: [] });
check('deck: a column holding two narrow columns is cut back apart', packed && packed.rows[0].join('|') === 'Valve|Gate|Check' && packed.rows[2].join('|') === 'B|<1:5|1:40', JSON.stringify(packed));
const names = dout.pickBullets({ nestedBullets: [{ text: 'Pump makers', level: 0, fontSize: 24 }, { text: 'Aquarius minor Rotorus spp.', level: 1, fontSize: 24 }] },
  { slideNumber: 1, bullets: [] }, new Set());
check('deck: names printed in two columns and read across are listed apart', JSON.stringify(names.shown).includes('"Aquarius minor"') && JSON.stringify(names.shown).includes('"Rotorus spp."'), JSON.stringify(names.shown));
const deck = [
  { slideNumber: 1, title: 'Pump course', bullets: [] },
  { slideNumber: 2, title: 'Gate valves', bullets: ['Close the line fully', 'Turn slowly to avoid water hammer'] },
  { slideNumber: 3, title: 'Check valves: a flap can serve as a check valve in small pipes', bullets: [] },
];
const out = dout.build(deck);
const points = JSON.stringify(out.sections);
check('deck: a slide titled with a statement shows the statement', /a flap can serve as a check valve/.test(points), points);

// ---------- 7. Unreadable glyphs ----------
const damaged = dmg.clean({ overviewSentences: ['¿meter: reads the flow', 'The gauge shows ¿ bar'], keyTerms: ['¿meter', 'Gauge'],
  outline: { sections: [{ title: 'Gauges', topics: [{ title: 'Gauges', slides: [{ title: 'Gauges', bullets: [{ text: '¿meter: reads the flow', children: [] }, { text: 'Gauge needle drift of ¿ is common', children: [] }], more: [] }] }] }] } });
const dtext = JSON.stringify(damaged);
check('damage: the mark never reaches the student', !/¿/.test(dtext), dtext);
check('damage: an item whose heading is unreadable is dropped, elsewhere the word is marked', damaged.outline.sections[0].topics[0].slides[0].bullets.length === 1 &&
  /\[unreadable symbol\]/.test(damaged.outline.sections[0].topics[0].slides[0].bullets[0].text) && damaged.keyTerms.join() === 'Gauge', dtext);

// ---------- 8. Printed page numbers ----------
check('pages: a page label from the PDF is the printed number', PP.printed({ pageLabels: ['i', 'ii', '1', '2'] }, 3) === '1' && PP.printed({ pageLabels: ['1', '2'] }, 2) === '');
const folio = (n, num) => ({ pageNumber: n, height: 800, lines: [{ text: `${num}`, topY: 20 }, { text: 'Pumps move water.', topY: 300 }] });
const parsed = { pageCache: new Map([[20, folio(20, 12)], [21, folio(21, 13)], [22, folio(22, 14)]]) };
check('pages: folios that agree give every page its printed number', PP.printed(parsed, 30) === '22', PP.printed(parsed, 30));
const cited = PP.relabel(parsed, 'Pumps (p. 21) and valves (p. 22); see also (p. 95).', [20, 30]);
check('pages: the app\'s own citations inside the pages studied read in printed numbers', cited === 'Pumps (p. 13) and valves (p. 14); see also (p. 95).', cited);
check('pages: a printed range for a PDF range', PP.printedRange(parsed, 20, 22) === 'p. 12–14' && PP.printedRange(parsed, 21, 21) === 'p. 13' && PP.printedRange({ pages: [] }, 3, 4) === '', PP.printedRange(parsed, 20, 22));
check('pages: no mapping leaves the citation as it is', PP.relabel({ pages: [] }, 'Gauge (p. 8)', [1, 9]) === 'Gauge (p. 8)');
// A card cites the page its own sentence is on, not an earlier page that prints its short back too.
['math-text', 'stem-noise', 'tokenizer', 'noise-filter', 'bold-terms', 'keywords', 'summarizer', 'stem-cards', 'slide-cards', 'flashcard-engine']
  .forEach((m) => require(`../src/nlp/${m}.js`));
const pageLines = [
  [11, ['Valve Basics', 'A gate valve has a wedge that slides across the flow.', 'A motor turns the impeller and the shaft at high speed.']],
  [12, ['Pump Housings', 'The pump housing holds the impeller and the shaft.', 'A worn housing leaks water at the joints.']],
].flatMap(([n, ls]) => ls.map((text) => ({ text, pageNumber: n })));
const placedCards = globalThis.PDFStudy.flashcardEngine.extractBookFlashcards(pageLines.map((l) => l.text).join('\n'), 'Pumps', [], { lines: pageLines });
const housing = placedCards.find((c) => /pump housing holds/.test(c.front));
check('pages: a card cites the page of its own sentence', housing && housing.pageNumber === 12, JSON.stringify(placedCards.map((c) => [c.pageNumber, c.front])));

console.log(`${failed ? 'FAIL' : 'PASS'}  summary shape fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

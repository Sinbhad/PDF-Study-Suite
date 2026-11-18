/**
 * Text Structure Fixtures (Node: `node tests/text_structure_fixtures.js`).
 * Line-level synthetic input (invented text, no real book content) for the extraction structure steps:
 * line kinds, numbered block labels, paragraphs and scope.lines, grid tables, side-by-side slide columns,
 * prose inside math, complement bars, glyph and hyphen repairs. Each step has a positive and a negative case.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

globalThis.window = globalThis;
['tokenizer', 'noise-filter'].forEach((m) => require(path.join(ROOT, `src/nlp/${m}.js`)));
['math-glyphs', 'math-tex', 'span-format', 'font-decoder', 'math-line', 'overline-builder', 'formula-builder', 'column-layout',
  'line-builder', 'line-kinds', 'page-kind', 'scope-lines', 'figure-filter', 'block-headings', 'block-labels', 'didactic-blocks',
  'math-prose', 'margin-notes', 'scope-emitter', 'scope-blocks', 'table-grid', 'text-cleaner', 'slide-columns', 'slide-lines',
  'slide-reveal', 'slide-extractor']
  .forEach((m) => require(path.join(ROOT, `src/pdf/${m}.js`)));
const S = globalThis.PDFStudy;

const results = [];
const check = (name, ok, detail = '') => results.push({ name: `[structure] ${name}`, ok: Boolean(ok), detail });
const W = 612;
const H = 792;

/** A page line as line-builder makes it. */
function L(text, topY, o = {}) {
  const fontSize = o.fontSize || 10;
  return {
    text: text.replace(/\*\*|\$/g, ''), formattedText: text, cleanText: text.replace(/\*\*|\$/g, ''), topY, bottomY: topY + fontSize,
    fontSize, x0: 150, x1: 540, isBold: false, isMargin: false, column: 0, wordCount: text.split(/\s+/).length, ...o,
  };
}
const M = (text, topY, o = {}) => L(text, topY, { isMargin: true, column: 1, x0: 60, x1: 135, ...o });
const page = (n, lines) => ({ pageNumber: n, width: W, height: H, lines });

function checkLineKinds() {
  const p = page(4, [
    L('4 Chapter 2 Counting Things', 30, { fontSize: 9 }),
    L('A grouping of objects is called a collection, and every collection has a size that can be counted.', 80),
    L('Table 1 lists the sizes of the collections described in this section, one per row.', 92),
    L('**FIGURE 2** A Collection of Three Shapes', 300, { fontSize: 9, isBold: true }),
    L('drawn as overlapping circles', 311, { fontSize: 9 }),
    L('Visit www.example-course.org/notes for the worked solutions.', 400, { fontSize: 9 }),
    L('JANE EXAMPLE (1801–1870) Jane Example was born in a small town and studied counting', 500, { fontSize: 8 }),
    L('for most of her life before writing the first textbook on the subject.', 510, { fontSize: 8 }),
    L('Learning Objectives', 600, { isBold: true, fontSize: 12 }),
    L('To count the members of a finite collection', 616),
    L('5', 770, { fontSize: 9, x0: 300, x1: 306 }),
  ]);
  S.lineKinds.tagPage(p);
  const k = (i) => p.lines[i].kind;
  check('caption label and its wrapped line are captions', k(3) === 'caption' && k(4) === 'caption', `${k(3)} ${k(4)}`);
  check('"Table 1 lists ..." in a sentence stays prose', !k(2), k(2));
  check('running head and folio are folio', k(0) === 'folio' && k(10) === 'folio', `${k(0)} ${k(10)}`);
  check('URL line is url', k(5) === 'url', k(5));
  check('smaller biography box is biography', k(6) === 'biography' && k(7) === 'biography', `${k(6)} ${k(7)}`);
  check('objectives heading and list are objective', k(8) === 'objective' && k(9) === 'objective', `${k(8)} ${k(9)}`);
  check('ordinary prose has no kind', !k(1), k(1));
  const code = page(5, [
    L('`1 public class Counter`', 100, { isCode: true, fontSize: 8 }), L('**2**', 110, { fontSize: 8, isBold: true }),
    L('3 // count the members', 120, { fontSize: 8 }), L('`4 int size = 0;`', 130, { isCode: true, fontSize: 8 }),
  ]);
  S.lineKinds.tagPage(code);
  check('listing line numbers and comment rows between code rows are code', code.lines.every((l) => l.kind === 'code'), code.lines.map((l) => l.kind).join(','));
}

function checkBlocksAndScope() {
  const p1 = page(10, [
    L('Counting starts with naming the things that are counted, as Example 5 illustrates later on.', 60),
    L('Let $A$ be a collection. The size of $A$ is the number of distinct members it holds.', 100, { x0: 156, fontSize: 10.5 }),
    M('Definition 1', 101, { fontSize: 12.5 }),
    L('A collection with no members has size zero.', 113, { x0: 156, fontSize: 10.5 }),
    L('Every example in this section uses small collections so that the counts are easy to check.', 160),
    L('**EXAMPLE 2** What is the size of the collection of vowels in the word "banana"?', 200, { x0: 150 }),
    L('Solution: The vowels are a and a and a, so the collection holds one distinct member. ◂', 212),
    L('Sizes add up when two collections share no member, which is the main fact of this section.', 260),
    L('That fact is used throughout the chapter.', 272),
    L('A new paragraph starts here with a first-line indent below the previous one.', 284, { x0: 168 }),
    M('Sizes add when collections share no member at all.', 300, { fontSize: 7.5 }),
  ]);
  const p2 = page(11, [L('The next page continues with ordered collections and their sizes.', 60)]);
  const out = S.textCleaner.processSectionPages([p1, p2]);
  const def = out.blocks.find((b) => b.kind === 'definition');
  check('margin "Definition 1" opens a definition block with its body', def && /size of \$A\$/.test(def.body) && /size zero/.test(def.body), JSON.stringify(out.blocks));
  check('definition block is also a legacy didactic block', out.didacticBlocks.some((b) => b.title === 'Definition 1'), JSON.stringify(out.didacticBlocks.map((b) => b.title)));
  const ex = out.blocks.find((b) => b.kind === 'example');
  check('bold EXAMPLE label opens an example block that ends at its end mark', ex && /banana/.test(ex.body) && !/main fact/.test(ex.body), JSON.stringify(ex));
  check('example rows stay out of scope text but are listed in scope.lines', !/banana/.test(out.text) && out.lines.some((l) => /banana/.test(l.text) && !l.inText && l.kind === 'example'), out.text);
  check('a prose mention "as Example 5 illustrates" is not a label', out.blocks.filter((b) => b.kind === 'example').length === 1, JSON.stringify(out.blocks.map((b) => b.title)));
  check('paragraph break: blank line before an indented first line', /chapter\.\n\nA new paragraph/.test(out.text), out.text);
  check('scope.lines carry page numbers', out.lines.every((l) => l.pageNumber === 10 || l.pageNumber === 11), JSON.stringify(out.lines.map((l) => l.pageNumber)));
  const marginAt = out.text.indexOf('Sizes add when');
  check('margin note stays with its page (before the next page text)', marginAt > 0 && marginAt < out.text.indexOf('The next page continues'), out.text);
  check('full-sentence margin note becomes a key-concept block', out.blocks.some((b) => b.kind === 'key-concept' && /share no member/.test(b.body)), JSON.stringify(out.blocks.map((b) => b.kind)));
  const lineOfDef = out.lines.find((l) => /size zero/.test(l.text));
  check('definition rows carry the block id', lineOfDef && lineOfDef.blockId === def.id, JSON.stringify(lineOfDef));

  const tip = page(12, [
    L('**Programming Tip 3.1**', 100, { isBold: true }), L('**Name Things Well**', 114, { isBold: true }),
    L('Short names save typing but cost the reader time, so pick names that say what they hold.', 130, { fontSize: 9.5 }),
    L('Back in the main text, the next idea is the loop.', 200, { fontSize: 10.5 }),
  ]);
  const t = S.textCleaner.processSectionPages([tip]);
  const side = t.blocks.find((b) => b.kind === 'sidebar');
  check('Programming Tip sidebar ends when the body size returns', side && /pick names/.test(side.body) && !/main text/.test(side.body), JSON.stringify(t.blocks));
}

function checkTables() {
  const seg = (cells, x0 = 160, step = 60) => cells.map((c, i) => ({ text: c, x0: x0 + i * step, x1: x0 + i * step + 10 }));
  const rows = [['p', 'q', 'p or q'], ['T', 'T', 'T'], ['T', 'F', 'T'], ['F', 'F', 'F']];
  const p = page(20, [L('The table below lists every case of the operation on two statements here.', 60)]
    .concat(rows.map((r, i) => L(r.join(' '), 100 + i * 13, { fontSize: 9, segments: seg(r), x0: 160, x1: 290 })))
    .concat([L('Each row of the table is one combination of truth values for the two statements.', 170)]));
  const out = S.textCleaner.processSectionPages([p]);
  check('aligned cell rows become one table', out.tables.length === 1 && out.tables[0].rows.length === 3 && out.tables[0].header.join(',') === 'p,q,p or q', JSON.stringify(out.tables));
  check('table text form: one row per line, cells joined by " | "', /p \| q \| p or q\nT \| T \| T/.test(out.text), out.text);
  check('table cells never glue onto prose', !/statements here\. ?T/.test(out.text) && !/T T T/.test(out.text), out.text);
  const prose = [0, 1, 2, 3].map((i) => L('a b', 300 + i * 12, { segments: [
    { text: 'Two columns of running text that wrap', x0: 72, x1: 290 }, { text: 'across the page are not a table at all', x0: 320, x1: 540 }] }));
  check('two prose columns on shared baselines are not a table', S.tableGrid.fromSegments(prose, 21).length === 0);

  const cell = (text, x0, topY, o = {}) => L(text, topY, { x0, x1: x0 + text.length * 9, fontSize: 18, ...o });
  const slide = { pageNumber: 3, width: 960, height: 540, lines: [
    cell('Host Overview', 60, 40, { fontSize: 36, isBold: true, x1: 400 }),
    cell('Species', 60, 140, { isBold: true }), cell('Main host', 360, 140, { isBold: true }), cell('Stage', 660, 140, { isBold: true }),
    cell('Alpha worm', 60, 190), cell('Dogs', 360, 190), cell('Adult', 660, 190),
    cell('Beta worm', 60, 240), cell('Cattle and', 360, 232), cell('sheep', 360, 254), cell('Larva', 660, 240),
  ] };
  const s = S.slideExtractor.extractSlidePage(slide);
  const tb = (s.tables || [])[0];
  check('slide header band + stacked cells become a table; wrapped cell stays whole', tb && tb.rows.length === 2 && tb.rows[1][1] === 'Cattle and sheep', JSON.stringify(s.tables));
  check('table cells do not leak into slide bullets', !s.bullets.some((b) => /Dogs|Cattle/.test(b)) && s.table && s.table.rows.length === 3, JSON.stringify(s.bullets));
  const plainSlide = { pageNumber: 4, width: 960, height: 540, lines: [
    cell('Plain Slide', 60, 40, { fontSize: 36, isBold: true }), cell('• First point about hosts', 60, 140), cell('• Second point about stages', 60, 190)] };
  check('a plain bullet slide has no table', !(S.slideExtractor.extractSlidePage(plainSlide).tables || []).length);
}

function checkSlideColumns() {
  const row = (topY, left, right, indent, o = {}) => L(`${left} ${right}`, topY, { fontSize: 20, x0: 40 + indent, x1: 760, ...o,
    segments: [{ text: left, x0: 40 + indent, x1: 330 }, { text: right, x0: 420 + indent, x1: 720 }] });
  const slide = { pageNumber: 9, width: 960, height: 540, lines: [
    L('Two Kinds of Lesion', 40, { fontSize: 36, isBold: true, x0: 40, x1: 500 }),
    row(150, '**Early lesion** (first days)', '**Late lesion** (after weeks)', 0, { isBold: true }),
    row(185, '• Swelling', '• Scar tissue', 30),
    row(215, '• Redness', '• Loss of material', 30),
  ] };
  const s = S.slideExtractor.extractSlidePage(slide);
  const t = s.nestedBullets.map((b) => `${b.level}:${b.text}`);
  check('side-by-side lists read left column fully, then right', t.join('|') === '0:Early lesion (first days)|1:Swelling|1:Redness|0:Late lesion (after weeks)|1:Scar tissue|1:Loss of material', t.join('|'));
  check('each column keeps its own heading as parent and a column index', s.nestedBullets[3].column === 1 && s.nestedBullets[0].column === 0, JSON.stringify(s.nestedBullets));
  const single = { pageNumber: 10, width: 960, height: 540, lines: [L('One Column', 40, { fontSize: 36, isBold: true }), L('• Only point', 150, { fontSize: 20, x0: 40 })] };
  check('single-column slide unchanged', S.slideExtractor.extractSlidePage(single).bullets.join('|') === 'Only point');
}

function checkGlyphsAndMath() {
  const u = S.mathProse.unwrapProse;
  check('\\text{} words leave inline math', u('$\\text{Let}p$ be a statement') === 'Let $p$ be a statement' && u('$p\\,\\text{and}\\,q$') === '$p$ and $q$', u('$\\text{Let}p$ be a statement'));
  check('a sentence wrapped in math falls back to plain text', u('$This panel skips the floor$') === 'This panel skips the floor');
  check('real formulas are untouched', ['$x + 1 = 2$', '$m = \\lfloor (low + high) / 2 \\rfloor$', '$$\\frac{p(c)}{q(c)}$$', '$[low, high]$'].every((f) => u(f) === f));
  const spans = [{ text: 'X', x0: 100, x1: 107, baselineY: 322, topY: 312, bottomY: 322, fontSize: 10 }];
  const bar = S.overlineBuilder.overlines(spans, [{ x0: 99.5, x1: 107.5, y: 313.7 }], new Set());
  check('short rule just above a variable becomes \\overline', bar.length === 1 && bar[0].tex === '\\overline{X}' && bar[0].plain === "X'", JSON.stringify(bar));
  const axis = S.overlineBuilder.overlines(spans, [{ x0: 40, x1: 300, y: 313.7 }], new Set());
  check('a long axis rule over a label is not a complement bar', !axis[0].tex);
  const G = S.mathGlyphs;
  check('MATHPRO symbol subset: "S" is the arrow', G.decodeString('S', G.familyInfo('PearsonMATHPRO08')) === '→');
  check('Wingdings arrow is kept, ordinary fonts unchanged', G.decodeString('', G.familyInfo('ABCDEF+Wingdings-Regular')) === '→' && G.decodeString('S', G.familyInfo('Times-Roman')) === 'S');
  const out = ['The study of cause-and-'];
  S.scopeLines.pushProseLine(out, 'effect links is old.');
  const plain = ['A straight-'];
  S.scopeLines.pushProseLine(plain, 'forward case.');
  check('hyphen break inside a compound keeps its hyphen; a plain wrap is mended', out[0] === 'The study of cause-and-effect links is old.' && plain[0] === 'A straightforward case.', `${out[0]} / ${plain[0]}`);
}

/** Slide layouts the outline once misread (synthetic slides, made-up subject: pumps). */
function checkSlideLayouts() {
  const cell = (text, x0, topY, o = {}) => L(text, topY, { x0, x1: x0 + text.length * 9, fontSize: 18, isBold: true, ...o });
  // A header line run across two columns, and a picture caption plus a link to the right of the table
  const slide = { pageNumber: 5, width: 960, height: 540, lines: [
    cell('Pump Tests', 60, 40, { fontSize: 36 }),
    cell('Test', 20, 120), cell('Sample', 220, 120), cell('Target Notes', 420, 120, { x1: 640 }),
    cell('Flow check', 20, 170), cell('Water', 220, 170), cell('Volume', 420, 170), cell('Needs a meter', 560, 170),
    cell('Seal check', 20, 220), cell('Oil', 220, 220), cell('Leaks', 420, 220), cell('Done cold', 560, 220),
    cell('Gear pump', 780, 180, { fontSize: 14 }), cell('https://example.org/pumps', 760, 260, { fontSize: 10, kind: 'url' }),
  ] };
  const t = (S.slideExtractor.extractSlidePage(slide).tables || [])[0];
  check('slide table: a header run across two columns is cut; a caption beside the table is no cell',
    t && t.header.join('|') === 'Test|Sample|Target|Notes' && t.rows[0].join('|') === 'Flow check|Water|Volume|Needs a meter' &&
    !JSON.stringify(t).includes('Gear pump') && !JSON.stringify(t).includes('example.org'), JSON.stringify(t));
  // A large side title on a baseline shared with a list item; tier labels over glyph items
  const tiers = { pageNumber: 6, width: 960, height: 540, lines: [
    cell('Light duty', 420, 60, { fontSize: 15 }), cell('• Small impeller', 420, 90, { fontSize: 15 }),
    cell('Heavy duty', 420, 150, { fontSize: 15 }), cell('• Large impeller', 420, 180, { fontSize: 15 }),
    L('Pump • Twin seals', 230, { x0: 100, x1: 640, fontSize: 27, isBold: true, segments: [{ text: 'Pump', x0: 100, x1: 190, fontSize: 27 }, { text: '• Twin seals', x0: 420, x1: 640, fontSize: 15 }] }),
    cell('choice', 100, 262, { fontSize: 27 }),
  ] };
  const ts = S.slideExtractor.extractSlidePage(tiers);
  check('a large side title beats a list label at the top; the item on its baseline stays in the list', ts.title === 'Pump choice' &&
    ts.nestedBullets.some((b) => b.text === 'Twin seals' && b.bullet), `${ts.title} ${JSON.stringify(ts.nestedBullets)}`);
  // A term drawn partly as a picture: the line starts a term's width to the right, in lower case
  const lost = { pageNumber: 7, width: 960, height: 540, lines: [
    cell('Seal Terms', 60, 40, { fontSize: 36 }),
    cell('Lipseal: A seal with a soft lip', 90, 150, { fontSize: 26 }),
    cell('seal: A seal with a hard face', 160, 182, { fontSize: 26 }),
  ] };
  const ls = S.slideExtractor.extractSlidePage(lost);
  check('a "term:" line that lost its drawn prefix is marked damaged, its sibling kept whole', ls.nestedBullets.length === 2 &&
    ls.nestedBullets[0].text === 'Lipseal: A seal with a soft lip' && /^¿seal:/.test(ls.nestedBullets[1].text), JSON.stringify(ls.nestedBullets));
  // Diagram labels under a sentence and a bold label over its sentence are not wrapped lines
  const labels = { pageNumber: 8, width: 960, height: 540, lines: [
    cell('Valve Sites', 60, 40, { fontSize: 36 }),
    cell('Inject the sealant just below the second flange', 60, 120, { fontSize: 20 }),
    cell('F4 F3 F2 F1', 60, 142, { fontSize: 20 }),
    cell('Housings', 60, 200, { fontSize: 20 }),
    cell('Cast housings crack when frozen and must be drained', 60, 222, { fontSize: 20 }),
  ] };
  const lb = S.slideExtractor.extractSlidePage(labels).nestedBullets.map((b) => b.text);
  check('a diagram label row and a short heading line are not joined to their neighbours', lb.includes('F4 F3 F2 F1') && lb.includes('Housings') &&
    lb.includes('Inject the sealant just below the second flange'), JSON.stringify(lb));
}

for (const fn of [checkLineKinds, checkBlocksAndScope, checkTables, checkSlideColumns, checkGlyphsAndMath, checkSlideLayouts]) {
  try {
    fn();
  } catch (err) {
    check(`${fn.name} threw`, false, err && err.stack);
  }
}
const passed = results.every((r) => r.ok);
console.log(results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`).concat([passed ? 'PASS' : 'FAIL']).join('\n'));
process.exit(passed ? 0 : 1);

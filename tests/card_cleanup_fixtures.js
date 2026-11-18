/**
 * Card Cleanup Fixtures (Node: `node tests/card_cleanup_fixtures.js`). The text-structure and card-gate rules
 * of the second card review: slide layouts read by structure (side-by-side halves, a side title, picture labels,
 * a title-only frame), slide cards that keep a lead-in's qualifier and a parent's name, lines and slides that are
 * not study material, and textbook prose (rule boxes, worked-example props, broken sentences, named laws,
 * notation, contrasts, completions without a subject). All sample text is written for these fixtures.
 */
const path = require('path');

function load() {
  globalThis.window = globalThis;
  const pdf = ['slide-columns', 'slide-captions', 'slide-lines', 'slide-reveal', 'table-grid', 'slide-extractor', 'math-prose'];
  const nlp = ['tokenizer', 'noise-filter', 'stem-noise', 'card-quality', 'abbreviations', 'bold-terms', 'definition-miner', 'definition-rules',
    'prose-definitions', 'self-contained', 'content-filter', 'slide-kinds', 'slide-subjects', 'slide-model', 'aspect-groups',
    'slide-line-shapes', 'note-patterns', 'table-cards', 'slide-structure-cards', 'contrast-cards', 'card-fields', 'slide-cards',
    'key-statements', 'boxed-cards', 'stem-cards', 'flashcard-engine'];
  pdf.forEach((m) => require(path.join(__dirname, '..', 'src', 'pdf', `${m}.js`)));
  nlp.forEach((m) => require(path.join(__dirname, '..', 'src', 'nlp', `${m}.js`)));
  return globalThis.PDFStudy;
}

/** One slide line: text at (x0, top) in a font size; bullets start with "• ". */
const line = (text, x0, top, size, x1) => ({
  text, cleanText: text, formattedText: text, x0, textX0: x0, x1: x1 || x0 + text.length * size * 0.5,
  topY: top, bottomY: top + size, fontSize: size, isBold: false, wordCount: text.split(/\s+/).length,
});
const page = (n, lines) => ({ pageNumber: n, width: 960, height: 540, lines });

function run() {
  const S = load();
  const results = [];
  const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail: ok ? '' : detail });
  const ex = S.slideExtractor;

  // 1. Two procedures side by side, each with centred "Pros:" / "Cons:" lists that never share a baseline.
  const twoUp = ex.extractSlidePage(page(3, [
    line('Ways to Close a Wound', 70, 40, 40, 760),
    line('Sutures (aka Stitches)', 120, 140, 28, 400), line('Pros:', 230, 180, 28, 300), line('• Strong hold', 190, 220, 28, 340),
    line('• Cheap', 215, 260, 28, 315), line('Cons:', 228, 300, 28, 302), line('• Slow to place on a large wound', 110, 340, 28, 420),
    line('Staples (aka Clips)', 560, 141, 28, 820), line('Pros:', 655, 181, 28, 725), line('• Fast to place', 610, 221, 28, 770),
    line('• Even tension', 615, 261, 28, 765), line('Cons:', 653, 301, 28, 727), line('• Need a remover afterwards', 545, 341, 28, 835),
  ]));
  const cols = twoUp.nestedBullets;
  const sideOf = (t) => (cols.find((b) => b.text === t) || {}).column;
  check('slides: side-by-side halves get a column each', sideOf('Strong hold') === 0 && sideOf('Fast to place') === 1, JSON.stringify(cols));
  check('slides: a centred half nests its points under "Pros:" under its heading',
    cols.find((b) => b.text === 'Sutures (aka Stitches)').level === 0 && cols.find((b) => b.text === 'Pros:').level === 1 && cols.find((b) => b.text === 'Strong hold').level === 2,
    JSON.stringify(cols.map((b) => [b.text, b.level])));
  const twoUpCards = S.flashcardEngine.extractSlideFlashcards([{ slideNumber: 1, title: 'Wound care', bullets: ['Clean before closing'] }, twoUp]);
  const sutures = twoUpCards.find((c) => /Sutures \(aka Stitches\)$/.test(c.front));
  check('cards: a half becomes one card with its pros and cons, never a "Uses" field',
    sutures && /Pros: Strong hold; Cheap/.test(sutures.back) && /Cons: Slow to place on a large wound/.test(sutures.back) && !twoUpCards.some((c) => /Staples/.test(c.back)),
    twoUpCards.map((c) => `${c.front} => ${c.back}`).join(' | '));

  // 2. A title set beside its list, larger than every bullet; the list starts above the title's first line.
  const side = ex.extractSlidePage(page(4, [
    line('• First reason', 320, 290, 28, 520), line('Why Trim', 45, 340, 36, 230), line('• Second reason', 320, 365, 28, 540),
    line('Hooves?', 45, 380, 36, 160), line('• Third reason', 320, 440, 28, 530),
  ]));
  check('slides: a side title is the title, the list keeps its first line', side.title === 'Why Trim Hooves?' && side.bullets.includes('First reason'),
    `${side.title} | ${side.bullets.join(' | ')}`);

  // 3. A small plain line beside the list labels a picture; a small line right under a point continues it.
  const captioned = ex.extractSlidePage(page(5, [
    line('Fungal Disease', 10, 60, 40, 330), line('• Spread by spores', 20, 140, 17, 230), line('• Causes granulomas', 50, 165, 15, 260),
    line('Granulomas in a lung section', 460, 290, 11.5, 780), line('• Treated with azoles', 20, 220, 17, 240),
    line('Seen mostly in young dogs', 60, 241, 13, 300),
  ]));
  const kinds = Object.fromEntries(captioned.nestedBullets.map((b) => [b.text, b.kind || '']));
  check('slides: a small picture label is tagged a caption, a small sub-point is not',
    kinds['Granulomas in a lung section'] === 'caption' && kinds['Seen mostly in young dogs'] === '', JSON.stringify(kinds));

  // 4. A title-only frame (picture) followed by the frame with the text: the text's page is the slide's page.
  const deck = ex.extractSlideDeck({ pages: [
    page(7, [line('Spinal Block', 100, 40, 40, 400)]),
    page(8, [line('Spinal Block', 100, 40, 40, 400), line('• Numbs the hind half', 120, 140, 28, 500), line('• Halve the dose in fluid', 120, 180, 28, 520)]),
  ] });
  const block = deck.slides.find((s) => s.title === 'Spinal Block');
  check('slides: the merged slide links to the page its text is on', block && block.slideNumber === 8 && block.pages.join() === '7,8', JSON.stringify(block && block.pages));

  // 4b. Numbered labels around a picture, read column by column, come back in the order of their numbers.
  const cycle = ex.extractSlidePage(page(9, [
    line('Life Cycle', 10, 60, 40, 300),
    line('4. Larvae hatch', 150, 180, 12, 230), line('in water', 165, 194, 12, 215), line('1. Eggs are passed', 140, 400, 12, 240),
    line('in the feces', 160, 414, 12, 220), line('3. Eggs reach', 480, 180, 12, 560), line('a pond', 500, 194, 12, 540),
    line('2. Eggs survive', 470, 400, 12, 570), line('the winter', 495, 414, 12, 545),
  ]));
  check('slides: numbered labels of a cycle are read in their order, each with its wrapped line',
    cycle.bullets.slice(0, 4).join(' | ') === '1. Eggs are passed in the feces | 2. Eggs survive the winter | 3. Eggs reach a pond | 4. Larvae hatch in water', cycle.bullets.join(' | '));

  // 5. Slide cards: a "KNOW ..." lead-in qualifies the lines after it; a line takes its parent's name.
  const nested = (items) => items.map(([level, text]) => ({ level, text, formattedText: text }));
  const slides = [
    { slideNumber: 1, title: 'Local Anaesthetics', bullets: ['Used for regional blocks'] },
    { slideNumber: 2, title: 'Anesthetic', nestedBullets: nested([[0, '2% Procaine'], [1, 'KNOW MAXIMUM DOSES!'], [1, 'Ponies: 3 mg/kg'], [1, 'Mules: 6 mg/kg']]) },
    { slideNumber: 3, title: 'Wound Infection', nestedBullets: nested([[0, 'Cellulitis: spreading infection of the dermis and fat'], [1, 'Swelling of the limb'], [1, 'Treatment: warm packs and antibiotics for a week']]) },
    { slideNumber: 4, title: 'Spore Facts', nestedBullets: nested([[0, 'Spores resist heat and drying'], [0, 'Do not memorize the list below'], [0, 'Spores survive boiling for hours']]) },
    { slideNumber: 5, title: 'Barriers', nestedBullets: nested([[0, 'Gut-lymph barrier'], [1, 'Gut-blood barrier'], [0, 'Reality: no barrier is perfect']]) },
    { slideNumber: 6, title: 'Rodent Fever', nestedBullets: nested([[0, 'Gram (-), motile'], [0, 'Drug of choice: doxycycline'],
      [0, 'Kidney disease – tubular nephritis in older rats'], [0, 'Bedding change: weekly']]) },
  ];
  const cards = S.flashcardEngine.extractSlideFlashcards(slides.map((s) => ({ ...s, bullets: s.bullets || s.nestedBullets.map((b) => b.text) })));
  const show = cards.map((c) => `${c.front} => ${c.back}`).join(' | ');
  check('cards: a lead-in\'s qualifier stays on the card ("maximum doses")', cards.some((c) => /maximum doses/.test(c.front) && /Ponies: 3 mg\/kg/.test(c.back)), show);
  check('cards: a line under a named parent is asked about the parent', cards.some((c) => c.front === 'Cellulitis — Treatment'), show);
  check('cards: a slide marked "do not memorize" gives no card', !cards.some((c) => /Spores/.test(`${c.front} ${c.back}`)), show);
  check('cards: two names that share a word are not a question and its answer', !cards.some((c) => /Gut-blood barrier/.test(c.back) && /Gut-lymph/.test(c.front)), show);
  check('cards: a "Reality:" aside is never an answer', !cards.some((c) => /Reality:/.test(c.back)), show);
  check('cards: the drug of choice and the Gram stain are cards of their own',
    cards.some((c) => c.front === 'Rodent Fever — drug of choice' && c.back === 'doxycycline') && cards.some((c) => c.front === 'Rodent Fever — Gram stain'), show);
  check('cards: a general term on a subject\'s slide is asked under the subject; a one-word note is no answer',
    cards.some((c) => c.front === 'Rodent Fever — Kidney disease') && !cards.some((c) => /Bedding change/.test(c.front)), show);

  // 6. Tables: a row name two tables share names its table's subject; a merged header column is left out.
  const tableSlide = (n, subject, rows) => ({ slideNumber: n, kind: 'table', title: subject, bullets: [],
    table: { rows: [['Assay', 'Sample', 'Assay target Notes'], ...rows] } });
  const tCards = S.flashcardEngine.extractSlideFlashcards([
    { slideNumber: 1, title: 'Diagnostics', bullets: ['Two agents compared'] },
    tableSlide(2, 'Agent Alpha', [['Culture', 'Blood', 'Bacteria slow'], ['Smear', 'Urine', 'Fast cheap']]),
    tableSlide(3, 'Agent Beta', [['Culture', 'Joint fluid', 'Bacteria rare'], ['Titre', 'Serum', 'Host antibodies']]),
  ]);
  const tShow = tCards.map((c) => `${c.front} => ${c.back}`).join(' | ');
  check('cards: a shared row name is qualified by its table\'s subject', tCards.some((c) => c.front === 'Culture (Agent Beta) — Sample' && c.back === 'Joint fluid') &&
    tCards.some((c) => c.front === 'Smear — Sample'), tShow);
  check('cards: a column whose header merged two headers gives no card', !tCards.some((c) => /Assay target Notes/.test(c.front)), tShow);

  // 7. Textbook prose.
  const book = (text, blocks = []) => S.flashcardEngine.extractBookFlashcards(text, 'Fixture', blocks);
  const fronts = (list) => list.map((c) => `${c.front} => ${c.back}`).join(' | ');
  const rule = book('Loops repeat statements.', [{ kind: 'sidebar', title: 'Common Error 3.2', pageNumber: 9,
    text: 'Using = in a Condition If you write `if (count = 5)` the program assigns instead of comparing. You must never use = to compare two values. Always use == in a condition.' }]);
  check('book: a "Common Error" box gives a rule card', rule.some((c) => c.front === 'Using = in a Condition (common error)' && /must never use = to compare/.test(c.back)), fronts(rule));
  const tip = book('Loops repeat statements.', [{ kind: 'sidebar', title: 'Programming Tip 3.1',
    text: 'Indent With Care Most editors can indent for you. You should set your editor to insert spaces when you press the Tab key.' }]);
  check('book: a tip about the editor gives no card', !tip.some((c) => /Indent/.test(c.front)), fronts(tip));
  const prop = book('5.3 Many Branches\n\nFor example, consider a program that reports the effect of a storm, as measured by the Beaufort scale. The Beaufort scale is a measurement of wind speed on a scale of twelve steps. A branch is chosen by testing each condition in turn.');
  check('book: a worked example\'s prop is not a term', !prop.some((c) => /Beaufort/.test(c.front)), fronts(prop));
  const broken = book('Alternative Names\n\ntion are called **records** in the older literature. A field is a single item of data stored in a record.');
  check('book: a sentence that lost its start at a hyphen break gives no card', !broken.some((c) => /^Tion|^tion/.test(c.back)), fronts(broken));
  const law = book('Laws\n\nIdentities 4 and 5, the absorption laws, state that a variable combined with a term containing it reduces to the variable, as follows: two cases.');
  check('book: a named law and what it states', law.some((c) => c.front === 'Absorption laws' && /^A variable combined with a term containing it reduces to the variable\.?$/.test(c.back)), fronts(law));
  const notation = book('Related Forms\n\nThe dual of $p \\wedge q$ is the proposition $p \\vee q$. Each form has its own name.');
  check('book: "The T of <math> is <math>" is a card for T', notation.some((c) => c.front === 'Dual' && c.back === 'The dual of $p \\wedge q$ is $p \\vee q$.'), fronts(notation));
  const contrast = book('Variables\n\nA numeric variable stores a quantity that may have many digits, whereas a boolean variable holds only true or false.');
  check('book: a "whereas" sentence about two kinds of one thing is a contrast card', contrast.some((c) => c.front === 'Numeric variable vs boolean variable'), fronts(contrast));
  const ks = S.keyStatements;
  check('book: completions with a bare or hedged subject, or a one-word participle, are not asked',
    !ks.completion('The output is high when both inputs are high.') && !ks.completion('Most compilers have a switch that turns warnings into errors.') &&
    !ks.completion('When the loop ends, the next statement is executed.') && Boolean(ks.completion('A queue stores its items in the order they arrived.')));
  const glued = S.mathProse.unwrapProse('The set $Bis a$ subset of $C$ and $Aset$ is a collection.');
  check('extraction: a variable or an article glued to the words after it leaves the math', glued === 'The set $B$ is a subset of $C$ and A set is a collection.', glued);
  const boxes = S.boxedCards.fromBlocks([{ kind: 'definition', title: 'Definition 2', pageNumber: 4,
    body: 'A bag is an unordered collection of objects that may repeat, called items of the bag. A bag is finite when it holds finitely many items.' }]);
  check('book: a definition box is named by the subject it opens with', boxes.boxes.some((c) => c.front === 'Bag'), JSON.stringify(boxes.boxes));

  return results;
}

if (require.main === module) {
  const results = run();
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  [cleanup] ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`card_cleanup_fixtures: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
module.exports = { run };

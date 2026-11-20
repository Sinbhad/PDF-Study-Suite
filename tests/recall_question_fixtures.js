/**
 * Self-graded recall questions (Node): the slide nesting a labelled recall reads (recall-outline.js), the template
 * each kind of answer gets (recall-labels.js), definitions and completions (recall-statements.js), one fact asked
 * once in any form (quiz-assembly.js), and the eval lints for these patterns (tools/eval-quiz-recall-lints.js).
 * All text is synthetic. Run: node tests/recall_question_fixtures.js
 */
const path = require('path');

globalThis.window = globalThis;
const src = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
for (const f of ['tokenizer.js', 'math-text.js', 'stem-distractors.js', 'quiz-facts.js', 'quiz-subjects.js', 'slide-line-shapes.js', 'stem-noise.js']) {
  try { src(f); } catch (_e) { /* a helper a module loads on demand */ }
}
const outline = src('recall-outline.js');
const labels = src('recall-labels.js');
const statements = src('recall-statements.js');
const assembly = src('quiz-assembly.js');
const L = require(path.join(__dirname, '..', 'tools', 'eval-quiz-recall-lints.js'));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  [recall] ${name}${!cond && detail ? `  (${detail})` : ''}`);
}

// A slide: [level, text] with a trailing '*' on the level for a bulleted line ("0*").
const slide = (n, title, lines) => ({
  slideNumber: n, title,
  nestedBullets: lines.map(([lv, text]) => ({ level: parseInt(lv, 10), bullet: String(lv).endsWith('*'), text })),
});
const card = (n, front, back, kind = 'label') => ({ front, back, pageNumber: n, sourceKind: kind });
const ask = (c, scope) => labels.labelled(c, scope);
const show = (r) => (r ? `${r.prompt} => ${r.answer}` : 'null');

// 1. A label's content on its slide, and when it cannot be trusted.
const pump = slide(3, 'Drug Zed (Zedmax®)', [
  ['0', 'Absorption'], ['0*', 'Taken by mouth'], ['0*', 'Peaks in two hours'],
  ['0', 'Adverse effects'], ['0', 'None seen at three times the dose.'],
]);
const loose = slide(4, 'Drug Kay', [
  ['0', 'Absorption'], ['0*', 'Taken by mouth'], ['0*', 'Peaks in two hours'],
  ['0', 'Spreads to the brain and the eye'], ['0', 'Metabolism'], ['0*', 'Cleared by the liver'],
]);
const scope = { slides: [pump, loose], ctx: { repeated: new Set() } };
let r = ask(card(3, 'Drug Zed — Absorption', 'x'), scope);
check('outline: a plain label over bullets, asked as an aspect of its subject', r && r.prompt === 'Describe the absorption of Drug Zed (2 points).' &&
  r.answer === '• Taken by mouth\n• Peaks in two hours', show(r));
r = ask(card(3, 'Drug Zed — Adverse effects', 'x'), scope);
check('outline: a label with no deeper line takes the sentence under it', r && r.prompt === 'What are the adverse effects of Drug Zed?' &&
  r.answer === 'None seen at three times the dose.', show(r));
check('outline: a sentence at the label\'s indent after its bullets could be its point: not asked', ask(card(4, 'Drug Kay — Absorption', 'x'), scope) === null);
check('outline: a label the slide does not print is not asked', ask(card(3, 'Drug Zed — Elimination', 'x'), scope) === null);

// 2. A case needs a parent that names what is given; cases are short names side by side.
const uses = slide(5, 'Drug Zed', [
  ['0', 'Indications'], ['0*', 'Goats: lungworm and tapeworm'], ['0*', 'Sheep: liver fluke'],
]);
const fever = slide(6, 'Pond fever', [['0', 'In the water'], ['1', 'Warm shallow ponds'], ['1', 'Muddy banks'], ['0', 'In the fish'], ['1', 'Gills'], ['1', 'Kidney']]);
const outcome = slide(7, 'Prognosis', [['0', 'Mild case'], ['1', 'Full return to work'], ['0', 'Severe case'], ['1', 'Half return to work']]);
const signs = slide(8, 'Clinical signs of pond fever', [['0', 'Early stage'], ['1', 'Slow swimming, pale gills'], ['0', 'Late stage'], ['1', 'Floating at the surface']]);
const cases = { slides: [uses, fever, outcome, signs], ctx: { repeated: new Set() } };
r = ask(card(5, 'Drug Zed — Goats', 'x'), cases);
check('case: a species under an aspect heading is asked with that heading', r && r.prompt === 'What are the indications of Drug Zed for goats?' && r.answer === 'lungworm and tapeworm', show(r));
check('case: a setting under a title that names no aspect is not asked ("In the fish")', ask(card(6, 'Pond fever — In the fish', 'x'), cases) === null);
r = ask(card(7, 'Prognosis — Severe case', 'x'), cases);
check('case: "prognosis" is one thing (-is), asked "what is"', r && r.prompt === 'What is the prognosis for severe case?' && r.subject === 'Severe case', show(r));
r = ask(card(8, 'Clinical signs of pond fever — Early stage', 'x'), cases);
check('case: an aspect title "<aspect> of X" asks the aspect of the case', r && r.prompt === 'What are the clinical signs of early stage?', show(r));
const rel = slide(9, 'Gill rot', [['0', 'Other causes of gill rot'], ['1*', 'Cold water'], ['1*', 'Low oxygen']]);
const care = slide(10, 'Supportive therapy', [['0', 'At the dock'], ['1*', 'Shade'], ['1*', 'Fresh water'], ['0', 'In the tank'], ['1*', 'Aeration']]);
const careOf = slide(17, 'Supportive therapy of gill rot', [['0', 'At the dock'], ['1*', 'Shade'], ['1*', 'Fresh water'], ['0', 'In the tank'], ['1*', 'Aeration']]);
const careSub = slide(18, 'Gill rot', [['0', 'Supportive therapy'], ['1', 'At the dock'], ['2*', 'Shade'], ['2*', 'Fresh water'], ['1', 'In the tank'], ['2*', 'Aeration']]);
const caseScope = { slides: [rel, care, careOf, careSub], ctx: { repeated: new Set() } };
check('set: a relative label ("Other causes ...") is not asked', ask(card(9, 'Gill rot — Other causes of gill rot', 'x'), caseScope) === null);
check('case: prepositional setting under a generic heading with no subject is not asked', ask(card(10, 'Supportive therapy — At the dock', 'x'), caseScope) === null);
r = ask(card(17, 'Supportive therapy of gill rot — At the dock', 'x'), caseScope);
check('case: prepositional setting under an aspect-of-subject title includes the subject', r && r.prompt === 'List the supportive therapy of gill rot at the dock (2 points).', show(r));
r = ask(card(18, 'Gill rot — At the dock', 'x'), caseScope);
check('case: prepositional setting under a generic heading includes the slide subject', r && r.prompt === 'List the supportive therapy of Gill rot at the dock (2 points).', show(r));
const compSub = slide(19, 'Complications of gill rot: 20%', [
  ['0', 'Acute shock'], ['1', 'Fever'],
  ['0', 'Fin necrosis'], ['1*', 'Secondary clotting'], ['1*', 'Muscle sloughing'],
]);
r = ask(card(19, 'Gill rot — Fin necrosis', 'x'), { slides: [compSub], ctx: { repeated: new Set() } });
check('case: member aspect heading phrases as features rather than reversing owner',
  r && r.prompt === 'List the features of fin necrosis (complications of gill rot) (2 points).' &&
  !/complications of fin necrosis/i.test(r.prompt), show(r));

// 3. Steps, sets, labelled points, filler, a label that goes on over another slide.
const steps = slide(11, 'Hoof care', [['0', 'Technique'], ['1', 'Clean the sole'], ['1', 'Trim the wall'], ['1', 'Wrap the hoof']]);
const split1 = slide(12, 'Claw care', [['0', 'Technique'], ['1', 'Clean the sole']]);
const split2 = slide(13, 'Claw care', [['0', 'Technique'], ['1', 'Wrap the hoof']]);
const kinds = slide(14, 'Filters', [['0*', 'Two kinds of filter'], ['1*', 'Sand: coarse bed'], ['1*', 'Carbon: fine bed'], ['0*', 'Possible faults'], ['1*', 'Clogging']]);
const blocks = slide(15, 'Blocks for the flank', [['0', 'Line method'], ['1', 'Pros:'], ['2', 'Quick'], ['2', 'Cheap'], ['1', 'Cons:'], ['2', 'Large volume'], ['0', 'Ring method'], ['1', 'Pros: Small volume']]);
const etc = slide(16, 'Repairs', [['0', 'Surgical options'], ['1', 'Seal swap'], ['1', 'Bearing swap'], ['1', 'Etc.']]);
const more = { slides: [steps, split1, split2, kinds, blocks, etc], ctx: { repeated: new Set() } };
r = ask(card(11, 'Hoof care — Technique', 'x'), more);
check('steps: a technique is asked in order with its count', r && r.prompt === 'What are the steps of the Hoof care technique, in order? (3 steps)', show(r));
check('continued: the same label under the same title on another slide is not asked', ask(card(12, 'Claw care — Technique', 'x'), more) === null);
r = ask(card(14, 'Filters — Two kinds of filter', 'x'), more);
check('set: a label that names its set is listed with its count', r && r.prompt === 'List the two kinds of filter (2 points).', show(r));
check('set: one short item under a plural label is not the set', ask(card(14, 'Filters — Possible faults', 'x'), more) === null);
r = ask(card(15, 'Blocks for the flank — Line method', 'x'), more);
check('labelled points: "Pros:" and "Cons:" name what is asked', r && r.prompt === 'What are the pros and cons of Line method?', show(r));
check('filler: a list that ends in "Etc." is not the whole set', ask(card(16, 'Repairs — Surgical options', 'x'), more) === null);

// 4. Arrows: a chain or a causal verb asks what follows; a single arrow does not; a case arrow asks its value.
const arrows = slide(21, 'Gill rot', [
  ['0*', 'Possible lesions'], ['1*', 'Gill patch → grey tissue on the arch'],
  ['0*', 'Spread'], ['1*', 'Spores in the water → gill invasion → loss of filaments'],
  ['0*', 'Diagnostic testing'], ['1*', 'Live fish → gill smear'], ['1*', 'Dead fish → culture'],
]);
const arrowScope = { slides: [arrows], ctx: { repeated: new Set() } };
check('arrow: a single arrow with no causal verb is not asked as a consequence',
  ask(card(21, 'Gill rot: Gill patch → ?', 'grey tissue on the arch'), arrowScope) === null);
r = ask(card(21, 'Gill rot: Spores in the water → ?', 'gill invasion → loss of filaments'), arrowScope);
check('arrow: a chain asks what it leads to', r && r.prompt === 'In Gill rot, what does spores in the water lead to?', show(r));
r = ask(card(21, 'Gill rot: Spores are shed into the water → ?', 'gill invasion → loss of filaments'), arrowScope);
check('arrow: a clause on the left asks what happens when', r && r.prompt === 'In Gill rot, what happens when spores are shed into the water?', show(r));
r = ask(card(21, 'Gill rot: Live fish → ?', 'gill smear'), arrowScope);
check('arrow: a case arrow under an aspect asks the aspect for that case', r && r.prompt === 'What is the diagnostic testing of Gill rot for live fish?', show(r));
check('arrow: an aspect over a broad generic event ("Routes of infection") is refused',
  ask(card(21, 'Routes of infection: Middle chamber → ?', 'inner chamber → brain'), arrowScope) === null);
r = ask(card(21, 'Pathogenesis of gill rot: Spores in water → ?', 'gill invasion → filament loss'), arrowScope);
check('arrow: "<aspect> of <subject>" unwraps to the concrete subject', r && r.prompt === 'In gill rot, what does spores in water lead to?', show(r));
check('arrow: a parenthetical "cause of" note does not make a single arrow causal',
  ask(card(21, 'Pond blight: Snails → ?', 'Parasite alpha (cause of pond blight)'), arrowScope) === null);

// 5. A contrast, a table cell, a badge under a sentence.
r = ask(card(0, "Kell's type 1 vs type 2 — how do they differ?", '• type 1: fast\n• type 2: slow', 'list'), { slides: [] });
check('contrast: both names in full', r && r.prompt === "How does Kell's type 1 differ from Kell's type 2?", show(r));
const cell = (header, column, entity) => ({ table: { header, column, entity, key: 't1' } });
check('table: both headers named', labels.cellPrompt(cell(['Assay', 'Sample'], 'Sample', 'Swab test')) === 'What is the sample for the assay "Swab test"?');
check('table: an abbreviated header is not asked', labels.cellPrompt(cell(['Main.', 'Side.'], 'Side.', 'Carp')) === '');
check('table: a header naming the table\'s own parts is not asked', labels.cellPrompt(cell(['Table', 'Column'], 'Column', 'Relation')) === '');
check('table: a row named by a lower-case fragment is not asked', labels.cellPrompt(cell(['Species', 'Host'], 'Host', 'hepatica')) === '');
check('table: a method row qualifies with its specific subject in cellPrompt',
  labels.cellPrompt({ table: { header: ['Assay', 'Sample'], column: 'Sample', entity: 'PCR', subject: 'Pond blight', key: 't2' } }) ===
  'What is the sample for the assay "PCR (Pond blight)"?');
const badge = slide(31, 'Drug Zed', [['0', 'Pharmacodynamics'], ['0', 'Blocks the pump in the gut wall.'], ['1', 'One Health']]);
r = ask(card(31, 'Drug Zed — Pharmacodynamics', 'x'), { slides: [badge], ctx: { repeated: new Set(['one health']) } });
check('outline: a deck-wide badge under a sentence is no sub-point', r && r.answer === 'Blocks the pump in the gut wall.', show(r));
check('outline: tree nests a bulleted line under a plain heading at its indent',
  outline.tree(pump).filter((n) => n.parent && n.parent.text === 'Absorption').length === 2);
const capTree = { slideNumber: 22, title: 'Gill rot', nestedBullets: [
  { text: 'Signs', level: 0 },
  { text: 'Pale gills', level: 1, bullet: true },
  { text: 'GILL PIC', level: 0, kind: 'caption' },
  { text: 'Frayed fins', level: 1, bullet: true },
] };
const rCap = ask(card(22, 'Gill rot — Signs', 'x'), { slides: [capTree], ctx: { repeated: new Set() } });
check('outline: caption nodes do not split sibling bullets under a heading', rCap && rCap.prompt === 'List the signs of Gill rot (2 points).' &&
  rCap.answer === '• Pale gills\n• Frayed fins', show(rCap));

// 6. Definitions and completions.
check('completion: a defining noun phrase after "is" becomes "What is"', statements.completionPrompt('The relay is …', 'a switch worked by a coil') === 'What is the relay?');
check('completion: "states that" becomes "What does … state?"', statements.completionPrompt("Ohm's rule states that …", 'voltage is current times resistance') === "What does Ohm's rule state?");
check('completion: "is called" asks what it is called', statements.completionPrompt('A loop with no exit is called …', 'an infinite loop') === 'What is a loop with no exit called?');
check('completion: any other stem has many right endings', statements.completionPrompt('Copying the reference yields …', 'a second reference') === '' &&
  statements.completionPrompt('An index must …', 'be at least zero') === '');
check('completion: an open is-stem is refused', statements.completionPrompt('Lowered pins are …', 'used when the gate is shut') === '');
const eq = statements.definitionPrompt('Equal', 'Two tanks are equal if and only if they hold the same fish; equal tanks share one label.');
check('definition: a one-word predicate term is asked with what it is said of', eq && eq.prompt === 'When are two tanks equal?', JSON.stringify(eq));
check('completion: an unqualified plural definite subject is refused', statements.completionPrompt('The storage elements are …', 'devices that store data') === '');
check('definition: the book\'s example told in the first person is no definition',
  statements.definitionPrompt('Spill anomaly', 'When we delete one row, we lose facts about two things.') === '');
check('definition: a formula with letters it never introduces is no definition', statements.definitionPrompt('Mirror', 'The relation $b \\to a$.') === '');
const ok = statements.definitionPrompt('Gate valve', 'A valve that opens by lifting a flat gate out of the flow.');
check('definition: a plain definition is asked "Define"', ok && ok.prompt === 'Define "Gate valve".', JSON.stringify(ok));
const xorLeak = statements.definitionPrompt('Exclusive or', 'The exclusive or of $a$ and $b$, written $a$ XOR $b$, is true when exactly one holds.');
check('definition: an inline acronym leak refuses blanking and asks Define', xorLeak && xorLeak.prompt === 'Define "Exclusive or".', JSON.stringify(xorLeak));
const unrelatedAcronym = statements.definitionPrompt('Cache line', 'A cache line is a fixed-size block stored inside fast CPU memory.');
check('definition: an unrelated acronym does not block term recall', unrelatedAcronym && /^Name the term:/.test(unrelatedAcronym.prompt), JSON.stringify(unrelatedAcronym));

// 7. One fact once, in any form.
const rv = (question, answer, extra = {}) => ({ type: 'reveal', question, answer, options: [], ...extra });
const typed = (question, answer) => ({ type: 'typed', question, answer, options: [] });
let set = assembly.createSet(10, { avoid: [typed('Type the missing term: "The ________ of two sets is the set of pairs."', 'cartesian product')] });
check('repeat: a recall with the answer a quiz question typed is refused', set.refusal(rv('Name the term: "Let A and B be sets. The ________ of A and B is ..."', 'Cartesian product')) === 'asked elsewhere (answer)');
set = assembly.createSet(10, {});
set.accept(rv('What is the mirror of $a \\to b$?', '$b \\to a$ (p. 3)', { source: 'card m' }));
check('repeat: a recall whose formula answer another question prints is refused',
  set.refusal(rv('Name the term: "The ________ of $a \\to b$ is $b \\to a$."', 'Mirror', { source: 's2' })) === 'same formula');
set = assembly.createSet(10, {});
set.accept(rv('What is the sample for the assay "A"?', 'Swab', { recallGroup: 'table|t', source: 'c1' }));
set.accept(rv('What is the sample for the assay "B"?', 'Blood', { recallGroup: 'table|t', source: 'c2' }));
check('repeat: a set recalls at most two cells of one table', set.refusal(rv('What is the sample for the assay "C"?', 'Urine', { recallGroup: 'table|t', source: 'c3' })) === 'figure asked enough');
set = assembly.createSet(10, { avoid: [rv('Define "Gate valve".', 'A valve that opens by lifting a flat gate out of the flow.')] });
check('repeat: a True/False cut from the sentence a recall answered is that sentence again',
  set.refusal({ type: 'true_false', question: 'True or False: "A ball valve is a valve that opens by lifting a flat gate out of the flow."', answer: 'False',
    options: ['True', 'False'], source: 'A gate valve is a valve that opens by lifting a flat gate out of the flow.' }) === 'asked elsewhere (sentence)');
set = assembly.createSet(10, {});
set.accept({ type: 'multiple_choice', question: 'Which law is this?', answer: 'commutative laws', options: ['commutative laws', 'a', 'b', 'c'], source: 's9' });
check('repeat: an answer with its identity number and page is the same answer', set.refusal(rv('Which law is $X + Y = Y + X$?', 'Commutative law (identity 10) (p. 66)')) === 'same answer');
set = assembly.createSet(10, { reviewOf: [typed('Type the missing term: "The ________ resets the latch."', 'direct reset')] });
check('review: a recall of the same term over the same sentence is the quiz\'s own form',
  set.refusal(rv('Name the term: "The ________ resets the latch."', 'Direct reset')) === 'same form as before');

// 8. Lints for these patterns.
const lint = (fn, q, ...rest) => fn(q, ...rest);
check('lint: recall_vague_prompt', lint(L.lintRecallVaguePrompt, rv('Explain: Drug Zed — dogs.', 'x')) && lint(L.lintRecallVaguePrompt, rv('What follows? Gill rot: Patch → ?', 'x')) &&
  lint(L.lintRecallVaguePrompt, rv('Complete: "An index must …"', 'x')) && lint(L.lintRecallVaguePrompt, rv('Name the 3 key points about "Hoof care" on slide 4.', 'x')) &&
  !lint(L.lintRecallVaguePrompt, rv('List the adverse effects of Drug Zed (2 points).', '• a\n• b')));
check('lint: recall_count_mismatch', lint(L.lintRecallCountMismatch, rv('List the faults (3 points).', '• a\n• b')) &&
  !lint(L.lintRecallCountMismatch, rv('List the faults (2 points).', '• a\n   – sub\n• b')));
check('lint: recall_single_arrow', lint(L.lintRecallSingleArrow, rv('In Gill rot, what does gill patch lead to?', 'grey tissue on the arch')) &&
  !lint(L.lintRecallSingleArrow, rv('In Gill rot, what does spores lead to?', 'invasion → loss')));
check('lint: recall_table_header', lint(L.lintRecallTableHeader, rv('What is the column for the table "Relation"?', 'Attribute')) &&
  !lint(L.lintRecallTableHeader, rv('What is the sample for the assay "PCR"?', 'Blood')));
check('lint: fact_repeat_any_form', lint(L.lintAnyFormRepeat, rv('Name the term: "..."', 'Contrapositive'), [{ type: 'multiple_choice', question: 'Which term ...?', answer: 'contrapositive' }]) &&
  lint(L.lintAnyFormRepeat, rv('Define "mirror".', 'The relation $b \\to a$.'), [rv('What is the mirror of $a \\to b$?', '$b \\to a$ (p. 3)')]) &&
  !lint(L.lintAnyFormRepeat, rv('Define "valve".', 'A gate in a pipe that is opened by hand.'), [rv('Define "pump".', 'A machine that moves water.')]));
const crossed = L.lintCrossSetRepeats([typed('Type the missing term: "The ________ resets."', 'direct reset')],
  [{ ...rv('Name the term: "The ________ resets."', 'Direct reset'), review: true, source: 'x' }, rv('Define "pump".', 'A machine that moves water.')]);
check('lint: review_same_form and a clean test question', crossed[0] && crossed[0].lint === 'review_same_form' && crossed[1] === null, JSON.stringify(crossed));

console.log(`recall_question_fixtures: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

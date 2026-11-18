/**
 * Quiz Review Fixtures (node tests/quiz_review_fixtures.js).
 * The defects the second blind review found in generated questions, each with an authored imitation (no text of a
 * real document): a course slide carried from a procedure, a line nested under another head, kinds set against each
 * other, a wrong option that names its owner, a bare predicate under a subject of another kind, completions that pin
 * no answer, extraction debris, a worked example's domain, a slide marked "Do not memorize", a class cell beside
 * its members, a textbook aside, and a practice test that re-offers the quiz's options.
 */
['math-text', 'stem-noise', 'noise-filter', 'tokenizer', 'summarizer', 'flashcard-engine', 'option-sets', 'quiz-content', 'quiz-subjects',
  'content-filter', 'slide-subjects', 'quiz-facts', 'fact-statements', 'subject-claims', 'quiz-kinds', 'quiz-rank', 'deck-facts',
  'fact-questions', 'recall-questions', 'table-questions', 'cloze-questions', 'quiz-assembly', 'quiz-scope', 'quiz-engine', 'test-engine']
  .forEach((m) => require(`../src/nlp/${m}.js`));
const S = globalThis.PDFStudy;
const R = require('../tools/eval-quiz-review-lints.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [quiz-review] ${name}${detail ? `  (${detail})` : ''}`);
}
const show = (list) => list.map((q) => `${String(q.question).replace(/\n/g, ' / ')} => ${q.answer}`).join(' | ');

// 1. A course slide ("Complications", "Prognosis") is not about a procedure an earlier course slide listed, nor
//    about a list of alternatives; it is still about a disease or a drug it follows.
const COURSE = [
  { slideNumber: 1, title: 'Gill rot', bullets: ['A fungal disease of farmed fish in warm ponds.', 'Spreads through shared nets and water.'] },
  { slideNumber: 2, title: 'Supportive therapy', bullets: ['Salt baths', 'Pond aeration', 'Net disinfection'] },
  { slideNumber: 3, title: 'Pond aeration', bullets: ['Paddle wheels raise dissolved oxygen overnight.', 'Run the wheels before dawn.'] },
  { slideNumber: 4, title: 'Complications', bullets: ['Secondary bacterial infection of the gills', 'Stunted growth in survivors'] },
  { slideNumber: 5, title: 'Scraping/Biopsy/Culture', bullets: ['Taken from the gill margin under sedation.'] },
  { slideNumber: 6, title: 'Prognosis', bullets: ['Mild cases: most fish recover within two weeks'] },
  { slideNumber: 7, title: 'Drug Kappa', bullets: ['Kills fungal spores in the water column.'] },
  { slideNumber: 8, title: 'Pharmacokinetics', bullets: ['Absorbed through the gills within an hour.'] },
];
const chain = S.slideSubjects.chain(COURSE, COURSE.map(() => 'content'));
check('a course slide after a procedure an earlier course slide listed is not about the procedure', chain[3].subject === '', JSON.stringify(chain[3]));
check('a course slide after a list of alternatives is not about it', chain[5].subject === '', JSON.stringify(chain[5]));
check('an aspect slide after a drug is still about the drug', chain[7].subject === 'Drug Kappa', JSON.stringify(chain[7]));
check('"Complications of X" carries X to the next aspect slide', S.slideSubjects.chain([
  { title: 'Complications of gill rot: 10%', bullets: ['Stunting'] }, { title: 'Prevention', bullets: ['Quarantine new stock'] }], ['content', 'content'])[1].subject === 'gill rot');
const index = S.deckFacts.subjectIndex(COURSE, {});
const at = (n) => index.find((e) => e.slide.slideNumber === n);
check('deck facts: no subject is carried onto the course slides', !at(4) && !at(6), index.map((e) => `${e.slide.slideNumber}:${e.subject}`).join(' | '));
check('deck facts: a procedure slide records the topic whose course it is part of', at(3) && at(3).topic === 'Gill rot', JSON.stringify(at(3) && at(3).topic));

// 2. A line nested under a label that names something else is not a fact of the slide's subject.
const NESTED = [{ slideNumber: 1, title: 'Gill rot', bullets: ['A fungal disease of farmed fish in warm ponds.', 'Chronic gill rot: lesions that last for months', 'Treatment with prolonged antifungal baths'],
  nestedBullets: [{ level: 0, text: 'A fungal disease of farmed fish in warm ponds.' }, { level: 0, text: 'Chronic gill rot: lesions that last for months' },
    { level: 1, text: 'Treatment with prolonged antifungal baths' }] },
{ slideNumber: 2, title: 'Gill rot', bullets: ['Spreads through shared nets and water.', 'Young fish die within days of infection.'] }];
const points = S.deckFacts.fromSlides(NESTED, {});
check('a line under another label is not a point about the slide subject', !points.some((f) => /prolonged antifungal/.test(f.statement)), points.map((f) => f.statement).join(' | '));

// 3. Kinds: a clause that links two terms makes them kinds of one another; a compound or an attribute does not.
const kinds = S.quizKinds.index(['The simplest memory cells are toggles, from which registers are built.', 'In the master toggle the state is held.',
  'Fast buses that use a strobe signal are called strobed buses.', 'The toggle is in the reset state.', 'Logic cells are electronic circuits that switch quickly.']);
check('"memory cells are toggles" links a T toggle to memory cells', kinds.related('T toggle', 'memory cells'));
check('a naming clause with its subject first links the two', kinds.related('fast buses', 'strobed buses'));
check('a compound ("master toggle") is no link', !kinds.related('toggle', 'master'));
check('an attribute ("is in the reset state") is no link', !kinds.related('toggle', 'reset state'));
check('one describing word may stand before the second name', kinds.related('logic cells', 'digital circuits'));

// 4. Wrong options and Falses: no owner named, no predicate under a subject of another kind, no kinds against each other.
const fact = (subject, statement, extra = {}) => ({ ...S.quizFacts.makeFact(subject, statement, { kind: 'point', category: 'Lecture Point', ...extra }), id: subject + statement });
const FACTS = [
  fact('Drug Kappa', 'Kills fungal spores in the water column within a day.', { order: 1 }),
  fact('Drug Lambda', 'Lambdacillin is effective against gill flukes in carp.', { order: 2 }),
  fact('Pond rot', 'Caused by pond fungus 2: within the water mould family.', { order: 3 }),
  fact('Drug Mu', 'Given once by bath to trout in cold water.', { order: 4 }),
];
const claims = S.subjectClaims.fromScope({ facts: FACTS, sentences: [] });
const ctx = { facts: FACTS, seed: 0, forms: S.optionSets.textForms(FACTS.map((f) => f.statement).join('\n')), claims, claimed: new Set(), shown: new Set() };
const tfKappa = S.factQuestions.trueFalse(FACTS[0], ctx, false);
check('a False never borrows a statement that opens on another name', !tfKappa || !/Lambdacillin/.test(tfKappa.question), tfKappa && tfKappa.question);
const rot = fact('Gill rot', 'A fungal disease of farmed fish in warm ponds.', { order: 5 });
const tfRot = S.factQuestions.trueFalse(rot, { ...ctx, facts: [...FACTS, rot] }, false);
check('a False never borrows a statement naming its owner ("pond fungus" for "Pond rot")', !tfRot || !/pond fungus/i.test(tfRot.question), tfRot && tfRot.question);
const latch = { ...S.quizFacts.makeFact('T toggle', 'Holds one bit until it is clocked.', { kind: 'point' }), id: 't' };
const cells = { ...S.quizFacts.makeFact('memory cells', 'Are circuits that can hold binary values.', { kind: 'point' }), id: 'm' };
const theorem = { ...S.quizFacts.makeFact('Merge rule', 'Can be extended to any number of inputs.', { kind: 'point' }), id: 'r' };
const kctx = { facts: [latch, cells, theorem], seed: 0, kinds, claimed: new Set(), shown: new Set() };
const tfLatch = S.factQuestions.trueFalse(latch, kctx, false);
check('a False never sets a kind\'s statement under its member, nor a bare predicate under a subject of another kind', !tfLatch, tfLatch && tfLatch.question);
const sibling = { ...S.quizFacts.makeFact('D toggle', 'Follows its input transparently while the clock is high.', { kind: 'point' }), id: 'd' };
const tfSibling = S.factQuestions.trueFalse(latch, { ...kctx, facts: [latch, cells, theorem, sibling] }, false);
// A sibling's point that the scope never contradicts for this subject is no False: not being said of it is not enough.
check('an uncontradicted sibling statement is not keyed False', !tfSibling, tfSibling && tfSibling.question);
// Under a label both subjects have, a different value contradicts it: that False is fair.
const tOut = { ...S.quizFacts.makeFact('T toggle', 'Output: holds one bit until it is clocked.', { kind: 'point' }), id: 'to' };
const dOut = { ...S.quizFacts.makeFact('D toggle', 'Output: follows its input transparently while the clock is high.', { kind: 'point' }), id: 'do' };
const outClaims = S.subjectClaims.fromScope({ facts: [tOut, dOut], sentences: [] });
const tfOut = S.factQuestions.trueFalse(tOut, { facts: [tOut, dOut], seed: 0, kinds, claims: outClaims, claimed: new Set(), shown: new Set() }, false);
check('a sibling statement under a label the subject answers otherwise may stand as the False', Boolean(tfOut) && /follows its input/i.test(tfOut.question), tfOut && tfOut.question);
const B = require('../src/nlp/borrowed-statements.js');
const routes = S.subjectClaims.create();
routes.add('beta', 'Route: given by injection under the skin.');
routes.add('beta', 'Binds tubulin in the gut.');
const askBeta = { kind: 'point', subjectKey: 'beta', subject: 'Drug Beta' };
check('contradicts: a labelled value the subject gives otherwise', B.contradicts(askBeta, { statement: 'Route: given by mouth once a day.' }, { claims: routes }));
check('contradicts: never an unlabelled point, nor the same value', !B.contradicts(askBeta, { statement: 'Paralyses the worm by opening calcium channels.' }, { claims: routes }) &&
  !B.contradicts(askBeta, { statement: 'Route: given by injection under the skin daily.' }, { claims: routes }));
routes.add('beta', 'Dose: per drug alpha.');
check('inherits: "per <name>" ties a subject to the one it follows', routes.inherits('beta', 'Drug Alpha') && !routes.inherits('beta', 'Drug Gamma'));
const vague = { ...S.quizFacts.makeFact('E toggle', 'Signs vary based on the inputs used.', { kind: 'point' }), id: 'e' };
const tfVague = S.factQuestions.trueFalse(latch, { ...kctx, facts: [latch, vague] }, false);
check('a generic point ("Signs vary based on ...") is never borrowed as a False', !tfVague, tfVague && tfVague.question);

// 5. Recall: a completion must pin one answer; "Define" must define.
const card = (front, back, extra = {}) => ({ front, back, sourceKind: 'key-concept', category: 'Key Statement', kind: 'concept', page: 1, ...extra });
const recallScope = { facts: [], counts: new Map(), recurs: (t) => /register/i.test(t), allCards: [
  card('A binary search halves the range until a match is …', 'found'),
  card('Some editors even have …', 'an option to convert tabs to spaces'),
  card('Error You cannot …', 'compare a word to a number'),
  card('A register is …', 'a small fast store inside the processor'),
  card('When comparing two registers, test …', 'every bit in turn'),
  { front: 'Odd table', back: 'Do not fall into a common trap.', sourceKind: 'definition', category: 'Definition', subject: 'Odd table', page: 1 },
  { front: 'Kidney disease', back: 'Protein loss', sourceKind: 'definition', category: 'Definition', subject: 'Kidney disease', page: 1 },
] };
const recalls = S.recallQuestions.candidates(recallScope);
check('completions that pin no single answer are not asked', !recalls.some((q) => /halves the range|Some editors|Error You/.test(q.question)), show(recalls));
// "A register is …" => "a small fast store ..." is asked as the question it answers; a completion whose grammar
// gives no question ("When comparing two registers, test …") is asked as the statement to complete.
check('completions about a term the scope uses, or with an opening clause, are asked', recalls.some((q) => q.question === 'What is a register?') &&
  recalls.some((q) => /When comparing two registers/.test(q.question)), show(recalls));
check('"Define" with a bare name or advice is not asked', !recalls.some((q) => /Define "(?:Odd table|Kidney disease)"/.test(q.question)), show(recalls));

// 6. Stems: extraction debris and worked-example talk are refused; a run-in heading is cut off.
const N = S.stemNoise;
const debris = ['While the key is nice, some editors use tab separa- tion for alignment.', 'A(n) relation is in 2NF if and only if $it is in 1NF$ and more.',
  'Error You cannot compare a word to a number.', 'Data limits 5NF, XY/NF XY/NF: make every rule follow from keys.', 'Tion are called tuples in this book.'];
check('extraction debris is recognised', debris.every((s) => N.hasExtractionDebris(s)), debris.filter((s) => !N.hasExtractionDebris(s)).join(' | '));
check('a dash after a label is not debris', !N.hasExtractionDebris('Mild signs- let it run its course with rest.'));
const talk = ['Further, if we assign the order to a buyer, we would add four rows.', 'In the earlier example, the key is not part of the table.', 'Because vals is an array, each vals[i] is a number.'];
check('worked-example talk is recognised', talk.every((s) => N.isExampleTalk(s)), talk.filter((s) => !N.isExampleTalk(s)).join(' | '));
check('a run-in heading in capitals is cut off', N.stripRunInHeading('THE NULL SET There is a special set with no elements.') === 'There is a special set with no elements.');
check('a single acronym opening a sentence is kept', N.stripRunInHeading('PCR Testing is fast.') === 'PCR Testing is fast.');

// 7. A worked example's domain and a textbook aside are not asked; core boxes come first.
const BOOK = [
  'A loop repeats a block of statements while a condition holds.',
  'For example, consider a program that converts readings on the Beaufort scale into descriptions.',
  'The Beaufort scale is a measure of wind speed at sea.',
  'A counter is a variable that is incremented on every pass of a loop.',
  'A sentinel is a value that marks the end of the input.',
].join('\n');
const LINES = [
  { text: '**Style Note 4.1**', kind: 'heading', blockId: 'b1' }, { text: '**Programming Tip 4.1**', kind: 'heading', blockId: 'b2' },
  { text: 'A sentinel is a value that marks the end of the input.', kind: 'prose', blockId: 'b2' },
  { text: '**Common Error 4.1**', kind: 'heading', blockId: 'b3' }, { text: 'A counter is a variable that is incremented on every pass of a loop.', kind: 'prose', blockId: 'b3' },
];
const rank = S.quizRank.ranker(LINES);
check('an aside box is never asked', rank.isAside('A sentinel is a value that marks the end of the input.'));
check('a core box is asked first', rank.order(['A loop repeats a block.', 'A counter is a variable that is incremented on every pass of a loop.'])[0].startsWith('A counter'));
const bookQuiz = S.quizEngine.generateQuiz(BOOK, { mode: 'book', maxQuestions: 10, lines: LINES });
check('nothing about the example\'s domain or from an aside', !bookQuiz.some((q) => /Beaufort|sentinel/i.test(q.question + q.answer + (q.options || []).join(' '))), show(bookQuiz));

// 8. A slide marked "Do not memorize" gives no question; a class cell is not set against its members.
check('"Do not memorize" in ink marks a slide', S.contentFilter.isNotToMemorise({ title: 'Worms of fish', bullets: [], annotations: [{ text: 'Do not memorize', isAnnotation: true }] }));
check('"FYI" marks a slide', S.contentFilter.isNotToMemorise({ title: 'Spore counts by state', bullets: ['FYI'] }));
check('an ordinary slide is not marked', !S.contentFilter.isNotToMemorise({ title: 'Drug Kappa', bullets: ['Kills fungal spores.'] }));
const tableCard = (entity, value, i) => ({ front: `${entity} — Host`, back: value, sourceKind: 'table', page: 3, table: { key: 't1', column: 'Host', columnIndex: 1, entity } });
const hosts = [['Worm A', 'Pike, Perch'], ['Worm B', 'Predators'], ['Worm C', 'Carp'], ['Worm D', 'Trout, Salmon'], ['Worm E', 'Eels']].map(([e, v], i) => tableCard(e, v, i));
const tableQs = S.tableQuestions.candidates(hosts, { seed: 0 });
check('a lone class cell is never beside a list of members', tableQs.every((q) => !(q.options.includes('Predators') && q.options.some((o) => /,/.test(o)))), show(tableQs));

// 9. The practice test does not re-offer the quiz's options.
const set = S.quizAssembly.createSet(5, { avoid: [{ type: 'multiple_choice', question: 'What is the host for "Worm A"?', options: ['Carp', 'Eels', 'Pike', 'Trout'], answer: 'Pike', factKey: 'a' }] });
check('the same options as a quiz question are refused', set.refusal({ type: 'multiple_choice', question: 'What is the host for "Worm C"?', options: ['Trout', 'Pike', 'Eels', 'Carp'], answer: 'Carp', factKey: 'c' }) === 'options shown elsewhere');

// 10. The review lints find each pattern.
const lint = (fn, q, c) => Boolean(fn(q, c));
check('lint: stem_debris', lint(R.lintStemDebris, { type: 'cloze', question: 'Complete the statement:\n"Some ________ use tab separa- tion for alignment."' }));
check('lint: open_completion', lint(R.lintOpenCompletion, { type: 'reveal', question: 'Complete: "A binary search halves the range until a match is …"', answer: 'found' }));
check('lint: define_not_definition', lint(R.lintDefineNotDefinition, { type: 'reveal', question: 'Define "Kidney disease".', answer: 'Protein loss' }));
check('lint: swap_names_owner', lint(R.lintSwapNamesOwner, { type: 'true_false', answer: 'False', question: 'True or False: the following is true of "Feline pox".\n"Caused by bovine pox virus 2"',
  explanation: 'False. This is true of "Bovine pox", not of "Feline pox".' }));
check('lint: swap_number_mismatch', lint(R.lintSwapNumberMismatch, { type: 'true_false', answer: 'False', question: 'True or False: the following is true of "T toggle".\n"Are circuits that hold bits."' }));
check('lint: class_beside_members', lint(R.lintClassBesideMembers, { type: 'multiple_choice', question: 'What is the host for "Worm A"?', options: ['Pike, Perch', 'Predators', 'Carp'], answer: 'Pike, Perch' }));
check('lint: option_kind_of_answer', lint(R.lintOptionKindOfAnswer, { type: 'cloze', question: 'Complete the statement:\n"The ________ holds one bit."', options: ['T toggle', 'memory cells', 'strobed buses'], answer: 'T toggle' },
  R.buildReviewIndex('The simplest memory cells are toggles, from which registers are built.')));
check('lint: pseudo_term', lint(R.lintPseudoTerm, { type: 'cloze', question: 'Complete the statement:\n"Perhaps the most ________ is a missing bound."', answer: 'common error' }));
check('lint: clean questions pass', !R.REVIEW_LINTS.some((fn) => fn({ type: 'cloze', question: 'Complete the statement:\n"A ________ is a variable that is incremented on every pass of a loop."',
  options: ['counter', 'sentinel', 'flag'], answer: 'counter' }, R.buildReviewIndex(BOOK))));

console.log(failures ? `\n${failures} quiz-review fixture(s) FAILED` : '\nAll quiz-review fixtures passed');
process.exit(failures ? 1 : 0);

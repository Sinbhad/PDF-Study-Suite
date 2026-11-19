/**
 * Third Review Fixtures (node tests/third_review_fixtures.js).
 * The defects the third blind review found, each with an authored imitation (no text of a real document): a deck
 * True/False that only tests which slide a line sits on, a heading or subjectless remark used as a statement, a
 * False built honestly by changing one detail, completion cards that are fragments, a catch-all table column, a
 * card's "A → ?" prompt left in a statement, a cloze option that completes the sentence too, the section's topic
 * word as a blank, True/False balance, and quiz and test filled from the cards when choice questions run out.
 * Also every lint of tools/eval-quiz-third-lints.js on one bad and one good question.
 */
['math-text', 'stem-noise', 'noise-filter', 'tokenizer', 'summarizer', 'flashcard-engine', 'option-sets', 'quiz-content', 'quiz-subjects',
  'content-filter', 'slide-subjects', 'quiz-facts', 'fact-statements', 'subject-claims', 'subject-peers', 'altered-statements', 'quiz-kinds',
  'quiz-rank', 'deck-facts', 'fact-questions', 'recall-questions', 'table-questions', 'table-cards', 'key-statements', 'cloze-questions',
  'quiz-assembly', 'quiz-scope', 'quiz-engine', 'test-engine']
  .forEach((m) => require(`../src/nlp/${m}.js`));
const S = globalThis.PDFStudy;
const L = require('../tools/eval-quiz-third-lints.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [third-review] ${name}${detail ? `  (${detail})` : ''}`);
}
const show = (list) => list.map((q) => `${String(q.question).replace(/\n/g, ' / ')} => ${q.answer}`).join(' | ');

// 1. Peers: two diseases told over several aspect slides are entities of one kind; a one-slide management topic is not.
const DECK = [
  { slideNumber: 1, kind: 'content', title: 'Gill rot', bullets: ['A fungal disease of farmed trout in warm ponds.', 'Spreads through shared nets and pond water.'] },
  { slideNumber: 2, kind: 'content', title: 'Diagnosis', bullets: ['Wet mounts of gill clippings show branching hyphae.', 'Culture on fungal agar confirms the agent.'] },
  { slideNumber: 3, kind: 'content', title: 'Treatment of gill rot', bullets: ['Salt baths for 10 minutes reduce the fungal load.', 'Raise dissolved oxygen with paddle wheels.'] },
  { slideNumber: 4, kind: 'content', title: 'Pond hygiene', bullets: ['Disinfect nets between ponds with an iodine dip.', 'Keep a log of every transfer between farms.'] },
  { slideNumber: 5, kind: 'content', title: 'Fin blister', bullets: ['A viral disease of young carp in spring.', 'Blisters rupture and leave open sores on the fins.'] },
  { slideNumber: 6, kind: 'content', title: 'Diagnosis', bullets: ['Electron microscopy of blister fluid shows the virus.', 'PCR on fin tissue detects viral DNA within a day.'] },
  { slideNumber: 7, kind: 'content', title: 'Treatment of fin blister', bullets: ['No antiviral exists; cull the worst affected fish.', 'Cool the water to slow viral replication.'] },
];
const scope = S.quizScope.gather(DECK, { mode: 'slides', maxQuestions: 10 });
const key = (name) => S.quizSubjects.subjectKey(name);
const keyOf = (name) => (scope.facts.find((f) => f.subject === name) || {}).subjectKey || key(name);
check('peers: two diseases told over aspect slides are peers', scope.peers.peers(keyOf('Gill rot'), keyOf('Fin blister')));
check('peers: a one-slide management topic is no entity and no peer', !scope.peers.isEntity(keyOf('Pond hygiene')) &&
  !scope.peers.peers(keyOf('Pond hygiene'), keyOf('Gill rot')));
const quiz = S.quizEngine.generateQuiz(DECK, { mode: 'slides', maxQuestions: 10 });
const test = S.testEngine.generateTest(DECK, { mode: 'slides', maxQuestions: 20 });
const both = [...quiz, ...test.questions];
const swaps = both.filter((q) => q.type === 'true_false' && q.answer === 'False' && q.construction === 'sibling_swap');
check('swaps: no False sets a pond-hygiene line under a disease, or a disease line under pond hygiene',
  !swaps.some((q) => /Pond hygiene/.test(q.question) || /Disinfect nets|log of every transfer/.test(q.question)), show(swaps));
const tfs = both.filter((q) => q.type === 'true_false');
check('balance: True never outnumbers False in a set', [quiz, test.questions].every((set) => set.filter((q) => q.type === 'true_false' && q.answer === 'True').length <=
  set.filter((q) => q.type === 'true_false' && q.answer === 'False').length), tfs.map((q) => q.answer[0]).join(''));
check('swaps: a False on a deck names the aspect it is about', swaps.every((q) => /the (?:diagnosis|treatment) of/i.test(q.question.split('\n')[0]) ||
  !/Diagnosis|Treatment/.test(q.explanation)), show(swaps));

// 2. Statements: headings, subjectless remarks and lines that continue another are no statements.
const FS = S.factStatements;
check('statements: a heading is not a point', !FS.isPointStatement('Upper and Lower Gill Arches'));
check('statements: "Great for ..." and a bare comparative are not points', !FS.isPointStatement('Great for spotting sores, blisters') &&
  !FS.isPointStatement('Less volume of salt needed'));
check('statements: a short gerund heading is not a point', !FS.isPointStatement('Screening to find silent carriers'));
check('statements: a finding stated as a phrase still is', FS.isPointStatement('Blister formation on the dorsal and caudal fins'));
check('statements: a line opening on a link to the line before is not standalone', !FS.isStandalone('Alternatively, about a third of fish recover within weeks'));

// 3. Honest Falses: one quantity or one direction changed; a recommended minimum is left alone.
const A = S.alteredStatements;
const moved = A.alter('Replace the dressing in 4-6 days', { text: '' });
check('altered: a range moves well outside itself', moved && moved.statement === 'Replace the dressing in 12-18 days', moved && moved.statement);
check('altered: a percentage shifts by forty points', (A.alter('About 20% of carriers shed again', { text: '' }) || {}).statement === 'About 60% of carriers shed again');
// A direction flips only when the scope sets the two words against each other on one line about the same thing.
const contrastText = 'Gill pressure: increased tears the filaments, decreased slows breathing';
check('altered: a direction word flips', (A.alter('Increased gill pressure causes rupture', { text: contrastText }) || {}).statement === 'Decreased gill pressure causes rupture');
check('altered: no contrast in the scope, no direction swap (upper/lower may both hold)', !A.alter('History of upper airway infections in the pond', { text: 'Ponds hold fish.' }) &&
  !A.alter('Increased gill pressure causes rupture', { text: '' }));
check('altered: a recommended minimum, a name with digits, or a printed value is not altered', !A.alter('Ponds should be dried 3 weeks', { text: '' }) &&
  !A.alter('Inject at sites L1 and L2 with 5 mL', { text: '' }) && !A.alter('Signs appear within 2 days', { text: 'signs appear within 6 days in carp' }));

// 4. Completion cards: one answer, one sentence, no echo of the prompt, no open clause, no example name.
const K = S.keyStatements;
check('completion: one noun after an article is no answer', !K.completion('Every pond filter contains a cartridge.'));
const twoNotes = K.completion('Pond comparators compare water levels across two tanks. The float switch reports overflow.');
check('completion: the answer stops at its own sentence', twoNotes && twoNotes.back === 'water levels across two tanks', twoNotes && twoNotes.back);
check('completion: a split inside an open clause is refused', !K.completion('In a hatchery, before an egg can hatch, the shell must soften in warm water.'));
check('completion: an answer repeating the prompt is refused', !K.completion('If the tank has a single outlet, the outlet is a single-outlet drain.'));
const moved2 = K.completion('The paddle aerator is used to keep the dissolved oxygen above six parts per million.');
check('completion: a leading participle goes to the prompt', moved2 && /used to …$/.test(moved2.front) && /^keep the dissolved/.test(moved2.back), moved2 && `${moved2.front} ${moved2.back}`);
check('completion: a hedged opener or a bare modal front is refused', !K.completion('Sometimes the grading method is used to sort fish by size.') && !K.completion('Ponds may have several inlets at once.'));

// 5. A catch-all table column gives no card; a card's "A → ?" prompt never reaches a statement.
const table = { header: ['Test', 'Sample', 'Notes'], rows: [['Culture', 'Gill swab', 'Slow growth on agar'], ['PCR', 'Fin tissue', 'Fast but costly'], ['Serology', 'Clotted blood', 'Needs paired samples']] };
const tcards = S.tableCards.rowCards(table, { subject: 'Fin blister tests' });
check('table: a Notes column gives no card', tcards.length > 0 && !tcards.some((c) => /Notes$/.test(c.front)), tcards.map((c) => c.front).join(' | '));
const arrowFacts = S.quizFacts.fromCards([{ front: 'Fin blister: Rupture of a blister → ?', back: 'open sore that admits bacteria', sourceKind: 'label', subject: 'Fin blister', pageNumber: 5 }], '', {});
check('facts: an arrow prompt becomes the chain it asks for', arrowFacts.every((f) => !/→\s*\?/.test(f.statement)), arrowFacts.map((f) => f.statement).join(' | '));

// 6. Cloze: a sibling on the answer's head word may complete a sentence that does not name its blank.
const C = S.clozeQuestions;
const forms = S.optionSets.textForms('digital circuits analog circuits mixed circuits logic gates flip flops');
const term = (text, rank = 0) => ({ text, rank });
const q6 = C.forSentence('Engineers test digital circuits with a logic probe before shipping the board.', {
  terms: [term('digital circuits'), term('analog circuits'), term('mixed circuits'), term('logic gates'), term('flip flops'), term('shift registers')],
  seed: 0, forms, sentences: [] });
check('cloze: no option shares the answer\'s head word in a sentence that does not name it', !q6 || !q6.options.some((o) => o !== q6.answer && /circuits$/i.test(o)), q6 ? q6.options.join(' | ') : 'no question');

// 7. Fill: when no choice question can be built, recall questions fill the set from the cards.
const RULES = [['Trout', 'Cold water below sixteen degrees keeps them feeding'], ['Carp', 'Warm shallow ponds with soft mud bottoms suit them'],
  ['Tilapia', 'Tolerate brackish water and crowding better than most species'], ['Catfish', 'Feed at night and hide under floating cover by day'],
  ['Salmon', 'Return from the sea to spawn in gravel streams'], ['Sturgeon', 'Grow slowly and mature only after many winters'],
  ['Perch', 'Hunt in schools along weedy margins at dawn'], ['Eel', 'Migrate across the ocean to breed far offshore']];
// (A labelled card is recalled from its slide's nesting: each fish has a slide with its "Management" label and line.)
const CARDS = RULES.map(([fish, back], i) => ({ front: `${fish} — Management`, back, sourceKind: 'label', subject: fish, pageNumber: i + 1 }));
const FISH_SLIDES = RULES.map(([fish, back], i) => ({ slideNumber: i + 1, kind: 'content', title: fish, bullets: ['Management', back],
  nestedBullets: [{ level: 0, text: 'Management' }, { level: 1, text: back }] }));
const filled = S.quizEngine.generateQuiz(FISH_SLIDES, { mode: 'slides', maxQuestions: 6, cards: CARDS });
check('fill: recall questions fill every slot the choice questions leave', filled.length === 6, `${filled.length}: ${show(filled)}`);

// 8. Lints: each flags its bad example and passes its good one.
const tf = (s, answer = 'True') => ({ type: 'true_false', question: `True or False:\n"${s}"`, options: ['True', 'False'], answer, page: 1 });
const cloze = (s, options, answer) => ({ type: 'cloze', question: `Complete the statement:\n"${s}"`, options, answer, page: 1 });
const reveal = (question, answer) => ({ type: 'reveal', question, answer, options: [], page: 1 });
function pair(lint, name, bad, good, ctx) {
  const hit = lint(bad, ctx);
  check(`${name} flags the bad example`, Boolean(hit) && hit.lint === name, hit ? hit.detail : 'not flagged');
  const miss = lint(good, ctx);
  check(`${name} passes the good example`, miss === null, miss ? miss.detail : '');
}
pair(L.lintArrowResidue, 'arrow_residue', { type: 'multiple_choice', question: 'Which statement is true of "Fin blister"?', options: ['Rupture → ?: open sore', 'Spreads in spring', 'Kills adults', 'Lives in salt'], answer: 'Rupture → ?: open sore' },
  { type: 'multiple_choice', question: 'Which statement is true of "Fin blister"?', options: ['Rupture → open sore', 'Spreads in spring', 'Kills adults', 'Lives in salt'], answer: 'Rupture → open sore' });
pair(L.lintTfNotAClaim, 'tf_not_a_claim', tf('Upper and Lower Gill Arches'), tf('Blisters rupture and leave open sores on the fins'));
pair(L.lintTfNotAClaim, 'tf_not_a_claim', tf('Great for spotting sores, blisters'), tf('Salt baths reduce the fungal load'));
pair(L.lintCatchAllPrompt, 'catch_all_prompt', reveal('Recall: "Serology — Notes".', 'Needs paired samples'), reveal('Recall: "Serology — Sample".', 'Clotted blood'));
pair(L.lintCompletionFragment, 'completion_fragment', reveal('Complete: "Every pond filter contains …"', 'a cartridge'), reveal('Complete: "Every pond filter contains …"', 'a cartridge of activated carbon and gravel'));
pair(L.lintCompletionFragment, 'completion_fragment', reveal('Complete: "Trout need …"', 'cold water. Carp prefer warm ponds'), reveal('Complete: "Trout need …"', 'cold, well-oxygenated water'));
const sentences = Array.from({ length: 50 }, (_, i) => (i % 2 ? `A pond holds fish of size ${i}.` : `The inlet of tank ${i} carries water in.`));
pair(L.lintTopicWordBlank, 'topic_word_blank', cloze('Every ________ needs an outlet.', ['pond', 'filter', 'aerator', 'pump'], 'pond'),
  cloze('Every pond needs a(n) ________.', ['outlet', 'filter', 'aerator', 'pump'], 'outlet'), { sentences });
pair(L.lintHeadSiblingOption, 'head_sibling_option', cloze('Engineers probe ________ before shipping the board.', ['digital circuits', 'analog circuits', 'logic gates', 'flip flops'], 'digital circuits'),
  cloze('Transistor circuits on one chip are called ________.', ['integrated circuits', 'analog circuits', 'logic gates', 'flip flops'], 'integrated circuits'));

console.log(failures ? `${failures} third-review fixture(s) FAILED` : 'All third-review fixtures passed');
process.exit(failures ? 1 : 0);

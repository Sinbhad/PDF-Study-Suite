/**
 * Quiz Lint Fixtures (node tests/eval_quiz_lint_fixtures.js).
 * Checks the question-quality lints of tools/eval-quiz-lints.js themselves: for every lint one question
 * that must be flagged and one that must pass, plus the guessability solver and the baseline gate.
 * The questions are hand-written in the shape the quiz engine emits; nothing here calls src/.
 */
const L = require('../tools/eval-quiz-lints.js');
const solver = require('../tools/eval-quiz-solver.js');
const report = require('../tools/eval-quiz-report.js');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [quiz-lint] ${name}${detail ? `  (${detail})` : ''}`);
};

const cloze = (statement, options, answer) => ({ type: 'cloze', question: `Complete the statement:\n"${statement}"`, options, answer });
const mcq = (statement, options, answer) => ({
  type: 'multiple_choice', question: `Which concept, theorem, or term best matches the following statement?\n"${statement}"`, options, answer,
});
const tf = (statement, answer) => ({ type: 'true_false', question: `True or False:\n"${statement}"`, options: ['True', 'False'], answer });

/** Asserts `lint` flags `bad` under its own name and passes `good`; extra args go to the lint. */
function pair(lint, name, bad, good, ...extra) {
  const hit = lint(bad, ...extra);
  check(`${name} flags the bad example`, Boolean(hit) && hit.lint === name, hit ? hit.detail : 'not flagged');
  const miss = lint(good, ...extra);
  check(`${name} passes the good example`, miss === null, miss ? miss.detail : '');
}

const TERMS = ['osmosis', 'diffusion', 'active transport', 'facilitated diffusion'];
const GOOD_CLOZE = cloze('Water crosses a selectively permeable membrane toward the higher solute concentration by ________.', TERMS, 'osmosis');

// Stem lints
pair(L.lintUnresolvedReference, 'unresolved_reference',
  cloze('During this process the cell converts pyruvate into ________.', TERMS, 'osmosis'), GOOD_CLOZE);
pair(L.lintUnresolvedReference, 'unresolved_reference',
  cloze('There it is converted into ________ before the cycle begins.', TERMS, 'osmosis'),
  cloze('When the membrane is damaged, it leaks ________ into the surrounding fluid.', TERMS, 'osmosis'));
pair(L.lintUnresolvedReference, 'unresolved_reference',
  tf('As shown above, the reaction releases heat.', 'True'),
  tf('It is important to distinguish a movement along the curve from a shift of the curve.', 'True'));
check('template words are not linted ("the following statement")',
  L.lintUnresolvedReference(mcq('The total time a process spends in the ready queue.', TERMS, 'osmosis')) === null);

pair(L.lintClozeLeadingBlank, 'cloze_leading_blank',
  cloze('________ occur when older memories disrupt the recall of newer material in a list.', TERMS, 'osmosis'),
  cloze('________ is defined as the net movement of water across a selectively permeable membrane.', TERMS, 'osmosis'));
check('cloze_leading_blank flags a discourse word after the blank',
  Boolean(L.lintClozeLeadingBlank(cloze('________ however remains constant during the whole reaction.', TERMS, 'osmosis'))));

pair(L.lintThinStem, 'thin_stem',
  cloze('The geometric multiplicity is the dimension of its ________.', TERMS, 'osmosis'), GOOD_CLOZE);

pair(L.lintAnswerLeak, 'answer_leak',
  cloze('In priority scheduling the CPU goes to the process with the ________.', ['highest priority', 'ready queue', 'time quantum', 'context switch'], 'highest priority'),
  GOOD_CLOZE);
check('answer_leak ignores a word every option shares',
  L.lintAnswerLeak(cloze('Short-term memory holds about seven items, unlike ________, which has no fixed limit.',
    ['long-term memory', 'sensory memory', 'working memory', 'implicit memory'], 'long-term memory')) === null);

pair(L.lintWholeBlockStem, 'whole_block_stem',
  mcq('lone pair - pair of valence electrons not shared bonding pair = shared pair formal charge = valence minus nonbonding', TERMS, 'osmosis'),
  GOOD_CLOZE);
check('whole_block_stem flags a bullet glyph and a 300+ character stem',
  Boolean(L.lintWholeBlockStem(mcq('Merge sort • divides the array • merges the halves', TERMS, 'osmosis'))) &&
  Boolean(L.lintWholeBlockStem(mcq('The membrane regulates transport. '.repeat(10), TERMS, 'osmosis'))));

// Option lints
pair(L.lintOptionNotNounPhrase, 'option_not_noun_phrase',
  cloze('A market is any arrangement that ________ and sellers of a good together.', ['brings buyers', 'higher price', 'price rises', 'flow back'], 'brings buyers'),
  cloze('The kernel saves the registers during a ________ between two ready processes.', ['context switch', 'operating system', 'time quantum', 'ready queue'], 'context switch'));
const reasons = L.lintOptionNotNounPhrase(cloze('The kernel ________ the registers.', ['brings buyers', 'price rises', 'flow back', 'usually when'], 'x'));
check('option_not_noun_phrase names each reason', /starts with a verb/.test(reasons.detail) && /ends in a verb/.test(reasons.detail) &&
  /ends in a preposition/.test(reasons.detail) && /starts with an adverb/.test(reasons.detail), reasons.detail);

pair(L.lintOptionCaseMix, 'option_case_mix',
  cloze('The kernel performs a ________ when the CPU moves to another process.', ['Response time', 'Waiting time', 'context switch', 'Time quantum'], 'context switch'),
  cloze('The enzyme that attaches a phosphate group to ADP is called ________.', ['ATP synthase', 'pyruvate', 'lactate', 'NADH'], 'ATP synthase'));

pair(L.lintOptionNumberMix, 'option_number_mix',
  cloze('The ________ is never greater than the algebraic multiplicity of the eigenvalue.',
    ['geometric multiplicity', 'characteristic polynomial', 'distinct eigenvalues', 'null space'], 'geometric multiplicity'),
  cloze('The ________ is never greater than the algebraic multiplicity of the eigenvalue.',
    ['geometric multiplicity', 'characteristic polynomial', 'characteristic equation', 'null space'], 'geometric multiplicity'));

pair(L.lintOptionArticleMismatch, 'option_article_mismatch',
  cloze('A nonzero vector that the matrix only rescales is called an ________ of the matrix.', ['eigenvector', 'eigenspace', 'diagonal entry', 'null space'], 'eigenvector'),
  cloze('A nonzero vector that the matrix only rescales is called an ________ of the matrix.', ['eigenvector', 'eigenspace', 'inverse', 'orthogonal basis'], 'eigenvector'));

pair(L.lintAnswerLengthTell, 'answer_length_tell',
  mcq('Halves a sorted search interval at each step.', ['binary search', 'merge sort', 'heapsort', 'divide-and-conquer recurrence relation'], 'binary search'),
  mcq('Halves a sorted search interval at each step.', ['binary search', 'merge sort', 'heapsort', 'quicksort'], 'binary search'));

const formula = (options) => ({ type: 'multiple_choice', question: 'Which expression gives the time complexity of merge sort?', options, answer: options[0] });
pair(L.lintMalformedMath, 'malformed_math',
  formula(['$O(n \\log n)$ time', '-$O(n \\log n)$ time', '$O(n^{2})$ time', '$O(n)$ time']),
  formula(['$O(n \\log n)$', '$O(n^{2})$', '$O(\\log n)$', '$O(n)$']));
check('malformed_math flags an unbalanced "$" and a formula/prose mix',
  /unbalanced/.test((L.lintMalformedMath(formula(['$O(n)$', '$O(n^{2}', '$O(1)$', '$O(n!)$'])) || {}).detail || '') &&
  /mixed/.test((L.lintMalformedMath(formula(['$O(n)$', 'linear time', '$O(1)$', '$O(n!)$'])) || {}).detail || ''));

// True/False tells against the source text
const SOURCE = [
  'Fermentation is an anaerobic pathway that regenerates NAD+ so that glycolysis can continue.',
  'A very small quantum improves response time but increases the overhead of context switches.',
  'Partition balance increases when randomized pivot selection decreases worst-case splits.',
].join('\n');
pair(L.lintTrueFalseCopied, 'tf_copied_true',
  tf('Fermentation is an anaerobic pathway that regenerates NAD+ so that glycolysis can continue.', 'True'),
  tf('Fermentation lets glycolysis continue without oxygen by regenerating NAD+.', 'True'), SOURCE);
// A sibling-swap True is the source's sentence by design; it is only excused after a swap False in the same set.
const swapTrue = { ...tf('Fermentation is an anaerobic pathway that regenerates NAD+ so that glycolysis can continue.', 'True'), construction: 'sibling_swap' };
const swapFalse = { ...tf('Glycolysis is an anaerobic pathway that regenerates NAD+ so that fermentation can continue.', 'False'), construction: 'sibling_swap' };
check('tf_copied_true excuses a swap True that follows a swap False', L.lintTrueFalseCopied(swapTrue, SOURCE, [swapFalse]) === null);
check('tf_copied_true still flags a swap True with no swap False before it',
  Boolean(L.lintTrueFalseCopied(swapTrue, SOURCE, [])) && Boolean(L.lintTrueFalseCopied(swapTrue, SOURCE, [tf('Some other statement.', 'False')])));
check('answer_leak is not applied to a question without options',
  L.lintAnswerLeak({ type: 'reveal', question: 'What is meant by "osmosis"?', options: [], answer: 'Osmosis is the movement of water across a membrane.' }) === null);
pair(L.lintTrueFalseAntonymSwap, 'tf_antonym_swap',
  tf('A very small quantum improves response time but decreases the overhead of context switches.', 'False'),
  tf('A very small quantum has no effect on the overhead of context switches.', 'False'), SOURCE);
pair(L.lintTrueFalseDoubleAntonym, 'tf_double_antonym',
  tf('Partition balance decreases when randomized pivot selection decreases worst-case splits.', 'False'),
  tf('Partition balance increases when randomized pivot selection decreases worst-case splits.', 'True'));

// Repeats inside one set
const first = { id: 'q-1', ...cloze('The ________ is the interval from the submission of a job to its completion.', ['turnaround time', 'waiting time', 'response time', 'time quantum'], 'turnaround time') };
pair(L.lintDuplicateFact, 'duplicate_fact',
  mcq('The interval from the submission of a job to its completion.', ['Turnaround time', 'Throughput', 'Aging', 'Starvation'], 'Turnaround time'),
  mcq('The number of processes completed per unit of time.', ['Turnaround time', 'Throughput', 'Aging', 'Starvation'], 'Throughput'), [first]);
pair(L.lintReusedOptionSet, 'reused_option_set',
  cloze('The ________ is the total time a process spends in the ready queue.', ['Waiting time', 'time quantum', 'turnaround time', 'response time'], 'Waiting time'),
  cloze('The ________ is the total time a process spends in the ready queue.', ['waiting time', 'throughput', 'turnaround time', 'response time'], 'waiting time'), [first]);

// Content lints (tools/eval-quiz-content-lints.js). An authored deck: two drugs, each slide with a
// generic sub-heading, and a case slide; and an authored book page with a biography sidebar.
const DECK_TEXT = [
  'Drug Alpha\nPharmacokinetics\nGiven by mouth once daily\nCleared by the kidneys within hours\nNot approved for food animals',
  'Drug Beta\nPharmacokinetics\nGiven by injection every week\nStored in fat tissue for months\nKills adult worms only',
  'Case 1\nRex 8y/o M/N Beagle\nVomiting for two days',
].join('\n\n');
const DECK = L.buildContentIndex(DECK_TEXT);
const about = (subject, statement, options, answer) => ({ type: 'multiple_choice', question: `Which statement is true of "${subject}"?`, options, answer, subject });
const claim = (subject, statement, answer) => ({
  type: 'true_false', question: `True or False: the following is true of "${subject}".\n"${statement}"`, options: ['True', 'False'], answer, subject,
});
const ALPHA_OPTIONS = ['Given by mouth once daily.', 'Stored in fat tissue for months.', 'Kills adult worms only.'];

pair(L.lintAttributionStem, 'attribution_stem',
  { type: 'multiple_choice', question: 'Which point does the lecture make about "Drug Alpha"?', options: ALPHA_OPTIONS, answer: ALPHA_OPTIONS[0] },
  about('Drug Alpha', '', ALPHA_OPTIONS, ALPHA_OPTIONS[0]));
check('attribution_stem flags "Which topic is this lecture point about?"',
  Boolean(L.lintAttributionStem(mcq('Given by mouth once daily', ['Drug Alpha', 'Drug Beta', 'Case 1'], 'Drug Alpha'))) === false &&
  Boolean(L.lintAttributionStem({ type: 'multiple_choice', question: 'Which topic is this lecture point about?\n"Given by mouth once daily"', options: ['Drug Alpha', 'Drug Beta'], answer: 'Drug Alpha' })));
pair(L.lintGenericSubject, 'generic_subject', about('Pharmacokinetics', '', ALPHA_OPTIONS, ALPHA_OPTIONS[0]), about('Drug Alpha', '', ALPHA_OPTIONS, ALPHA_OPTIONS[0]), DECK);
check('generic_subject flags a heading the scope prints under several titles',
  Boolean(L.lintGenericSubject(about('Dosing', '', ALPHA_OPTIONS, ALPHA_OPTIONS[0]), L.buildContentIndex('Drug Alpha\nDosing\nOnce daily by mouth\n\nDrug Beta\nDosing\nWeekly by injection'))));
pair(L.lintOptionsSameSubject, 'options_same_subject',
  about('Drug Alpha', '', ['Given by mouth once daily.', 'Cleared by the kidneys within hours.', 'Kills adult worms only.'], 'Given by mouth once daily.'),
  about('Drug Alpha', '', ALPHA_OPTIONS, ALPHA_OPTIONS[0]), DECK);
pair(L.lintFalseTrueOfSubject, 'tf_false_true_of_subject',
  claim('Drug Alpha', 'Cleared by the kidneys within hours', 'False'), claim('Drug Alpha', 'Stored in fat tissue for months', 'False'), DECK);
pair(L.lintBadDefinition, 'bad_definition',
  { type: 'multiple_choice', question: 'Which statement defines "Update anomaly"?', options: ['A situation in which an update anomaly occurs.', 'A key of two columns.', 'A rule that limits values.'], answer: 'A situation in which an update anomaly occurs.' },
  { type: 'multiple_choice', question: 'Which statement defines "Update anomaly"?', options: ['A change that leaves stored copies of a value inconsistent.', 'A key of two columns.', 'A rule that limits values.'], answer: 'A change that leaves stored copies of a value inconsistent.' });
check('bad_definition flags a definition that leans on "this condition"',
  Boolean(L.lintBadDefinition({ type: 'multiple_choice', question: 'Which statement defines "Update anomaly"?', options: ['This condition makes the data inconsistent.', 'A key.', 'A rule.'], answer: 'This condition makes the data inconsistent.' })));
pair(L.lintGarbledToken, 'garbled_token',
  claim('Drug Alpha', "Don'heed^(to) know the enzymes", 'True'), claim('Drug Alpha', 'Given by mouth once daily', 'True'), DECK);
pair(L.lintFillerSubject, 'filler_subject',
  claim('Case 1', 'Rex 8y/o M/N Beagle', 'True'), claim('Drug Alpha', 'Given by mouth once daily', 'True'), DECK);
const BOOK = L.buildContentIndex('A set is an unordered collection of objects.\nGEORGE EXAMPLEMAN (1801–1870) Exampleman was born in a small town. He tutored the sons of a merchant.');
check('filler_subject flags a person from a biography sidebar in a non-history scope',
  Boolean(L.lintFillerSubject(cloze('The set was first studied by ________ in the town of his birth.', ['Exampleman', 'Cantor', 'Venn'], 'Exampleman'), BOOK)));
const QUIZ_SET = [claim('Drug Alpha', 'Given by mouth once daily', 'True')];
const overlap = L.lintQuizTestOverlap(QUIZ_SET, [claim('Drug Alpha', 'Given by mouth once daily', 'True'), claim('Drug Beta', 'Kills adult worms only', 'True')]);
check('quiz_test_overlap flags a test question that re-asks a quiz fact, and only that one',
  overlap[0] && overlap[0].lint === 'quiz_test_overlap' && overlap[1] === null, JSON.stringify(overlap));

// lintSet: every finding carries a known lint name, and a clean question yields none
const findings = L.lintSet([first, GOOD_CLOZE, tf('Fermentation is an anaerobic pathway that regenerates NAD+ so that glycolysis can continue.', 'True')], SOURCE);
check('lintSet returns one findings list per question', findings.length === 3 && findings[1].length === 0 &&
  findings[2].some((f) => f.lint === 'tf_copied_true'), JSON.stringify(findings.map((f) => f.map((x) => x.lint))));
check('every finding uses a listed lint name', findings.flat().every((f) => L.LINT_NAMES.includes(f.lint)));

// Guessability solver
check('solver: True unless an antonym-pair word is present',
  solver.guess(tf('Glycolysis occurs in the cytoplasm.', 'True')).pick === 'True' &&
  solver.guess(tf('The quotient diverges when the denominator approaches zero.', 'False')).pick === 'False');
check('solver: picks the only option that fits "an"',
  solver.guess(cloze('The derivative is positive on an ________ around the point.', ['limit ratio', 'open interval', 'common ratio', 'Riemann sum'], 'open interval')).pick === 'open interval');
check('solver: picks the only capitalised option for a blank that opens the statement',
  solver.guess(cloze('________ gives each process a fixed slice of CPU time.', ['Round robin', 'waiting time', 'ready queue', 'time quantum'], 'Round robin')).pick === 'Round robin');
check('solver: no tell means no guess, scored at chance', solver.guess(GOOD_CLOZE) === null &&
  Math.abs(solver.score([GOOD_CLOZE]).expected - 0.25) < 1e-9);

// Baseline gate
const rec = (defectPct) => ({ total: { defectPct, lints: { answer_leak: 3 } } });
check('baseline gate fails only above a 2-point rise',
  report.compare(rec(52.5), rec(50), false).failed && !report.compare(rec(52), rec(50), false).failed &&
  !report.compare(rec(60), rec(50), true).failed);

console.log(failures ? 'FAIL' : 'PASS');
process.exit(failures ? 1 : 0);

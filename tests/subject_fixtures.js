/**
 * Subject Fixtures (node tests/subject_fixtures.js).
 * Checks that questions test what a scope teaches about a real subject, never where a line was printed:
 * the content gate (quiz-content.js), subject resolution (quiz-subjects.js), the claims index that keeps
 * wrong options false (subject-claims.js), lecture facts of a deck (deck-facts.js), the quiz/test split,
 * the student's "bad question" flags (excludeSources), and the human-graded regression tool.
 * All slides and passages are authored imitations; none is taken from a real document.
 */
['math-text', 'stem-noise', 'noise-filter', 'tokenizer', 'summarizer', 'flashcard-engine', 'option-sets', 'quiz-content', 'quiz-subjects',
  'quiz-facts', 'subject-claims', 'deck-facts', 'fact-questions', 'quiz-assembly', 'quiz-scope', 'quiz-engine', 'test-engine', 'study-keys']
  .forEach((m) => require(`../src/nlp/${m}.js`));
const S = globalThis.PDFStudy;
const grades = require('../tools/eval-quiz-grades.js');

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [subject] ${name}${detail ? `  (${detail})` : ''}`);
}

// 1. Content gate
const C = S.quizContent;
const filler = ['Rex 8y/o M/N Beagle presented for vomiting', 'Take a deep BREATH', 'Hint…Hint…', 'See https://example.org/notes',
  'Functional dependencies are the heart of the database design process.', 'In this chapter we will study sets.',
  'Doses were set by trial (Smith et al. 1999)', 'description = "Most structures fall";', 'Remember your anatomy!'];
check('filler lines are refused', filler.every((t) => C.isFillerText(t)), filler.filter((t) => !C.isFillerText(t)).join(' | '));
const content = ['Inhibits microtubule assembly in the parasite.', 'A relation R on a set A is reflexive if xRx for every x in A.',
  'Streptococcus equi equi causes abscesses of the lymph nodes.', "DeMorgan's theorem applies to three or more variables."];
check('study lines pass', content.every((t) => !C.isFillerText(t)), content.filter((t) => C.isFillerText(t)).join(' | '));
check('a case slide is not content', !C.slideIsContent({ kind: 'content', title: 'Polyuria in cats', bullets: ['History of weight loss', 'All had small kidneys', 'Owner noticed thirst'] }));
check('a teaching slide is content', C.slideIsContent({ kind: 'content', title: 'Drug Alpha', bullets: ['Given by mouth once daily', 'Cleared by the kidneys'] }));
const BOOK_PAGE = [
  'A proposition is a declarative sentence that is either true or false.',
  'All the following declarative sentences are propositions.',
  '1. Paris is the capital of France.',
  '2. 1 + 1 = 2.',
  'A tautology is a compound proposition that is always true.',
  'JANE EXAMPLE (1801–1870) Jane Example was born in a small town.',
  'Her father kept a shop, and she taught herself logic.',
].join('\n');
const incidental = C.exampleTester(BOOK_PAGE);
check('a sample list and a biography sidebar are incidental', incidental('Paris is the capital of France.') && incidental('Her father kept a shop, and she taught herself logic.'));
check('the defining sentences are not', !incidental('A tautology is a compound proposition that is always true.') && !incidental('A proposition is a declarative sentence that is either true or false.'));
const counts = C.wordCounts('The drug is given orally. The drug is cleared fast.');
check('a token shaped like no word and printed once is garbled', C.isGarbled("Don'heed^(to) know it", counts) && !C.isGarbled('The drug is cleared fast.', counts));

// 2. Subjects
const Q = S.quizSubjects;
const specific = [['Treatment of strangles', 'strangles'], ['Leptospira spp. Transmission', 'Leptospira spp'], ['Clorsulon (cont.)', 'Clorsulon'],
  ['Feline infectious peritonitis (part 2)', 'Feline infectious peritonitis'], ['Streptococcus equi aka Strangles', 'Streptococcus equi']];
check('a heading names its specific subject', specific.every(([h, s]) => Q.specificOf(h, {}) === s), specific.map(([h]) => Q.specificOf(h, {})).join(' | '));
const generic = ['Pharmacokinetics', 'Overview', 'Diagnosis', 'Clinical signs and treatment', 'Types of inflammation', 'Variety of ways', 'The most helpful diagnostic…'];
check('a generic or category heading names none', generic.every((h) => Q.specificOf(h, {}) === null), generic.filter((h) => Q.specificOf(h, {}) !== null).join(' | '));
check('a heading printed under several titles is generic', Q.isGenericHeading('Dosing', { repeated: Q.repeatedHeadings([
  { title: 'Drug Alpha', bullets: ['Dosing'] }, { title: 'Drug Beta', bullets: ['Dosing'] }]) }));
const merged = Q.mergeKeys(['Leptospira spp', 'Leptospira spp small animals', 'strangles', 'Streptococcus equi aka Strangles', 'Drug Alpha', 'Drug Beta']);
check('names one inside the other, or tied by an alias, are one subject', merged.get('leptospira spp') === merged.get(Q.subjectKey('Leptospira spp small animals')) &&
  merged.get(Q.subjectKey('strangles')) === merged.get(Q.subjectKey('Streptococcus equi aka Strangles')) && merged.get(Q.subjectKey('Drug Alpha')) !== merged.get(Q.subjectKey('Drug Beta')));

// 3. A deck: lecture facts about drugs, wrong options false of the asked drug. Each drug is told over two slides (its
//    own and a pharmacokinetics slide), which makes the drugs entities of one kind (subject-peers.js).
const DECK = [
  { slideNumber: 1, kind: 'title', title: 'Agents Against Worms', bullets: ['A. Lecturer, DVM'] },
  { slideNumber: 2, kind: 'content', title: 'Learning Objectives', bullets: ['Explain how each drug works and how it is cleared.'] },
  { slideNumber: 3, kind: 'content', title: 'Drug Alpha', bullets: ['Paralyses the worm by opening calcium channels.', 'Completely absorbed from the gut after an oral dose.', 'Approved for dogs and cats only.'] },
  { slideNumber: 4, kind: 'content', title: 'Pharmacokinetics', bullets: ['Cleared by the liver within three hours.', 'Crosses into the brain at high doses.'] },
  { slideNumber: 5, kind: 'content', title: 'Drug Beta', bullets: ['Binds tubulin and starves the worm of glucose.', 'Poorly absorbed, so it acts inside the gut.', 'Approved for cattle, sheep and goats.'] },
  { slideNumber: 6, kind: 'content', title: 'Pharmacokinetics', bullets: ['Longer residence in the rumen raises efficacy.', 'Excreted mostly in the feces unchanged.'] },
  { slideNumber: 7, kind: 'content', title: 'Drug Gamma', bullets: ['Blocks glycolysis in flukes that feed on blood.', 'Given under the skin to cattle.', 'Not effective against flukes younger than eight weeks.'] },
  { slideNumber: 8, kind: 'content', title: 'Pharmacokinetics', bullets: ['Stored in the liver for several weeks after one dose.'] },
  { slideNumber: 9, kind: 'content', title: 'Drug Delta', bullets: ['Damages the outer coat of tapeworms within minutes.', 'Given by injection to horses.', 'Removed by the kidneys within a day.'] },
  { slideNumber: 10, kind: 'content', title: 'Pharmacokinetics', bullets: ['Peak blood levels are reached within an hour.'] },
  { slideNumber: 11, kind: 'content', title: 'Case 1: Lame Calf', bullets: ['Rex 8y/o M/N calf presented for limping', 'History of wet pasture'] },
];
const quiz = S.quizEngine.generateQuiz(DECK, { mode: 'slides', maxQuestions: 10 });
const test = S.testEngine.generateTest(DECK, { mode: 'slides', maxQuestions: 20 });
const both = [...quiz, ...test.questions];
const show = (list) => list.map((q) => `${q.question.replace(/\n/g, ' / ')} => ${q.answer}`).join(' | ');
// (Each drug slide is a run of points under a drug's name: no label says what to recall, so only the aspect slides
// are asked, "Describe the pharmacokinetics of Drug Alpha (2 points)", never "Name the 3 key points about Drug Alpha".)
check('deck: questions are built, none a whole slide\'s "key points"', quiz.length >= 2 && !quiz.some((q) => /key points about/.test(q.question)), `${quiz.length}: ${show(quiz)}`);
check('deck: no stem asks where a line sat', !both.some((q) => /\blecture\b|\bslide\b|which topic/i.test(q.question.split('\n')[0])), show(both));
check('deck: no generic heading, title or case is a subject', !both.some((q) => /^(?:Pharmacokinetics|Learning Objectives|Agents Against Worms|Case 1)/.test(q.subject || '')),
  both.map((q) => q.subject).join(' | '));
check('deck: a generic slide is asked under the drug before it', both.some((q) => q.subject === 'Drug Alpha' && /liver within three hours|brain at high doses/.test(q.question + q.answer)) ||
  both.some((q) => q.subject === 'Drug Beta' && /rumen|feces/.test(q.question + q.answer)), show(both));
check('deck: nothing from the case slide', !both.some((q) => /8y\/o|wet pasture|limping/.test(q.question + q.answer)));
const owner = (statement) => DECK.find((s) => s.bullets.some((b) => statement.includes(b.replace(/\.$/, ''))));
const subjectOfSlide = (slide) => (slide && slide.title === 'Pharmacokinetics' ? DECK[DECK.indexOf(slide) - 1].title : slide && slide.title);
const falses = both.filter((q) => q.type === 'true_false' && q.answer === 'False');
// (This deck's points carry no labels the drugs share, so the scope contradicts none of them for another drug: a False,
// if any, can only be an altered statement or a definition. quiz_review_fixtures builds a labelled contradiction.)
check('deck: every False puts a statement under a subject it does not belong to',
  falses.every((q) => subjectOfSlide(owner(q.question)) !== q.subject), falses.map((q) => `${q.subject}: ${q.question.split('\n')[1]}`).join(' | '));
const choices = both.filter((q) => q.type === 'multiple_choice' && /^Which statement/.test(q.question));
check('deck: every wrong option of "which statement" comes from another subject', choices.every((q) => q.options.filter((o) => o !== q.answer)
  .every((o) => subjectOfSlide(owner(o)) !== q.subject)), show(choices));
check('deck: the test asks no fact the quiz asks, except as a flagged review in another form', test.questions.every((q) => (q.review && /^Review/.test(q.badge)) ?
  quiz.filter((k) => k.factKey === q.factKey).every((k) => k.type !== q.type) : !quiz.some((k) => k.factKey === q.factKey)), `${test.total} test questions`);

// 4. A flagged source is not asked again
const flagged = quiz[0];
const key = S.studyKeys.sourceKey(flagged);
const again = S.quizEngine.generateQuiz(DECK, { mode: 'slides', maxQuestions: 10, excludeSources: new Set([key]) });
check('excludeSources: a flagged source is skipped at generation time', flagged && !again.some((q) => S.studyKeys.sourceKey(q) === key), flagged && flagged.source);
const testAgain = S.testEngine.generateTest(DECK, { mode: 'slides', maxQuestions: 20, excludeSources: new Set([key]) });
check('excludeSources: the practice test skips it too', !testAgain.questions.some((q) => S.studyKeys.sourceKey(q) === key));

// 5. Human-graded regression tool
const graded = [
  { doc: 'd', kind: 'quiz', grade: 'BAD', stem: 'Which topic is this lecture point about?\n"Rex 8y/o"', answer: 'Case 1' },
  { doc: 'd', kind: 'quiz', grade: 'GOOD', stem: 'Which statement is true of "Drug Alpha"?', answer: 'Approved for dogs and cats only.' },
];
const now = [{ question: 'Which statement is TRUE of "Drug Alpha"?', answer: 'Approved for dogs and cats only' }];
const res = grades.compareGrades(graded, now);
check('grades: a BAD question no longer generated is not counted, a GOOD one still generated is (case and punctuation ignored)',
  res.byGrade.BAD.still === 0 && res.byGrade.GOOD.still === 1 && res.stillBad.length === 0, JSON.stringify(res.byGrade));

console.log(failures ? `\n${failures} subject fixture(s) FAILED` : '\nAll subject fixtures passed');
process.exitCode = failures ? 1 : 0;

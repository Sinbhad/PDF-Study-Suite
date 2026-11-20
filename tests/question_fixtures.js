/**
 * Question-Building Fixtures (node tests/question_fixtures.js).
 * Unit checks for the modules that turn a scope into questions: stopword kinds and keyphrases, the
 * self-containedness gate, option-set normalising, sentence terms, facts, the three fact forms, cloze,
 * naming True/False and the assembly rules; then one authored passage through the whole engine.
 */
['math-text', 'stem-noise', 'noise-filter', 'tokenizer', 'keywords', 'summarizer', 'flashcard-engine', 'phrase-shape', 'quiz-gate',
  'quiz-options', 'stem-distractors', 'stem-questions', 'option-sets', 'sentence-terms', 'quiz-facts', 'fact-questions', 'marked-terms',
  'cloze-questions', 'naming-questions', 'quiz-assembly', 'quiz-scope', 'quiz-engine', 'test-engine', 'table-cards', 'table-questions'].forEach((m) => require(`../src/nlp/${m}.js`));
const S = globalThis.PDFStudy;

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  [question] ${name}${detail ? `  (${detail})` : ''}`);
}

// An authored passage: six terms defined in prose, with no bold type and no "Definition" boxes.
const GLACIERS = [
  'A glacier is a body of dense ice that moves slowly under its own weight.',
  'A lateral moraine is a ridge of rock debris that forms along the side of a glacier.',
  'A terminal moraine is a ridge of rock debris that marks the farthest advance of the ice.',
  'A snow bridge is a thin arch of wind-packed snow that hides the opening of a deep crack.',
  'The area where yearly snowfall exceeds yearly melting is called the accumulation zone.',
  'The area where yearly melting exceeds yearly snowfall is called the ablation zone.',
  'Meltwater that reaches the bed lowers friction, and geologists call the faster motion that results basal sliding.',
  'Geologists map every lateral moraine and every terminal moraine to reconstruct how far the ice once reached.',
  'Climbers probe each snow bridge with a pole because a glacier can hide a crack under fresh snow.',
  'When the accumulation zone shrinks for many years in a row, the front of the glacier retreats up the valley.',
  'Most of the ice that a glacier loses in summer melts in the ablation zone near its front.',
  'This is why the snowline is watched so closely.',
].join(' ');

// 1. Stopword kinds and keyphrases
const T = S.tokenizer;
check('publisher nouns are weightless but do not break a phrase', T.STOPWORDS.has('rights') && T.STOPWORDS.has('table') &&
  !T.PHRASE_BREAK_WORDS.has('rights') && !T.PHRASE_BREAK_WORDS.has('table') && T.PHRASE_BREAK_WORDS.has('the') && T.PHRASE_BREAK_WORDS.has('using'));
const phrases = S.keywords.extractRakeKeyphrases('Property rights are legal rules. Secure owners keep property rights. The truth table lists outputs. ' +
  'A truth table has one row per input. All rights reserved. Figure 3 shows the circuit.', 3, 30).map((r) => r.lower);
check('RAKE keeps "property rights" and "truth table" whole', phrases.includes('property rights') && phrases.includes('truth table'), phrases.join(', '));
check('RAKE drops footer and callout phrases', !phrases.some((p) => /^rights reserved$|^figure/.test(p)), phrases.join(', '));

// 2. Self-containedness
const sn = S.stemNoise;
const pointing = [
  'The cell then uses this gradient to make ATP.',
  'In that case the reaction stops.',
  'Such pathways release far less energy.',
  'They deliver electrons to the final stage.',
  'The table below lists the three stages.',
  'The enzyme (arrow) binds the substrate.',
  'A very small one improves response time.',
  'A flip-flop stores one bit, as explained in Section 4-9.',
];
check('statements that point outside themselves are caught', pointing.every((s) => sn.hasUnresolvedReference(s)), pointing.filter((s) => !sn.hasUnresolvedReference(s)).join(' | '));
const standing = [
  'A process enters the ready queue when it becomes runnable.',
  'Oxygen is the final electron acceptor of the chain.',
  'It follows that every bounded sequence has a convergent subsequence.',
  'A one-to-one function maps distinct inputs to distinct outputs.',
];
check('self-contained statements pass', standing.every((s) => !sn.hasUnresolvedReference(s)), standing.filter((s) => sn.hasUnresolvedReference(s)).join(' | '));

// 3. Option sets
const O = S.optionSets;
const forms = O.textForms('Waiting time is short. A context switch costs time, and context switches add up. Next comes the Krebs cycle. ' +
  'Latches hold a bit; a latch is simple. ATP synthase makes ATP. Each gate has a delay.');
const inside = O.termSet('context switch', ['Waiting time', 'Krebs cycle', 'gate delay', 'ATP synthase'], { stem: 'the kernel performs a here', position: 'inside', forms });
check('a term the source never lowers makes the whole set capitalised', inside && [inside.answer, ...inside.distractors].every((o) => /^[A-Z]/.test(o)),
  inside && [inside.answer, ...inside.distractors].join(' | '));
const lowered = O.termSet('context switch', ['Waiting time', 'gate delay', 'ATP synthase'], { stem: 'the kernel performs a here', position: 'inside', forms });
check('inside a sentence, sentence-case terms are lowered and an acronym is left alone', lowered && lowered.distractors.includes('waiting time') &&
  lowered.distractors.includes('ATP synthase') && lowered.answer === 'context switch', lowered && lowered.distractors.join(' | '));
const plural = O.termSet('context switches', ['latch', 'Waiting time', 'gate delay'], { stem: 'many add up', position: 'inside', number: 'plural', forms });
check('a plural slot only takes forms the source uses in the plural', plural === null || plural.distractors.every((d) => O.isPlural(d)), JSON.stringify(plural));
check('a singular answer never fills a plural slot', O.termSet('latch', ['gate delay', 'context switch'], { number: 'plural', forms }) === null);
const named = O.termSet('context switch', ['Squeeze Theorem', 'gate delay', 'waiting time', 'ready queue'], { forms });
check('a named result is never offered beside plain terms', named && !named.distractors.some((d) => /Theorem/.test(d)), named && named.distractors.join(' | '));
const adjectives = O.termSet('reflexive', ['symmetric', 'transitive', 'equivalence relation', 'functionally dependent', 'antisymmetric'], {});
check('adjective terms only face adjective terms', adjectives && adjectives.distractors.every((d) => !/relation/.test(d)), adjectives && adjectives.distractors.join(' | '));
const headRepeat = O.termSet('foreign key', ['primary key', 'candidate key', 'update anomaly', 'surrogate key'], { stem: 'the key of another table' });
check('a word of the answer repeated in the stem must be in every option', headRepeat && headRepeat.distractors.every((d) => /key$/.test(d)), headRepeat && headRepeat.distractors.join(' | '));
check('a(n) replaces the article before a blank', O.neutralArticle('It is called a ________ of A, and An ________ follows.') === 'It is called a(n) ________ of A, and A(n) ________ follows.');
const long = 'A winding ridge of sand and gravel that a stream under the ice deposited over many seasons.';
const statements = O.statementSet('A deep crack in the ice.', [long, 'A ridge of debris.', 'A thin arch of packed snow.', 'A body of dense ice.']);
check('statement options are of comparable length and end alike', statements && !statements.distractors.includes(long) &&
  [statements.answer, ...statements.distractors].every((s) => /\.$/.test(s)), statements && statements.distractors.join(' | '));

// 4. Sentence terms
const st = S.sentenceTerms;
const copula = st.definedIn('A lateral moraine is a ridge of rock debris that forms along the side of a glacier.')[0];
check('copula sentence gives term and statement', copula && copula.term === 'lateral moraine' && /^A ridge of rock debris/.test(copula.statement), JSON.stringify(copula));
const namings = ['The protons flow through an enzyme called ATP synthase.', 'The period is known as the Reign of Terror.', 'The union of $A$ and $B$, denoted by $A \\cup B$, is the set of all elements.']
  .map((s) => (st.definedIn(s).find((d) => d.how === 'naming') || {}).term);
check('naming sentences give the named term', namings.join('|') === 'ATP synthase|Reign of Terror|union', namings.join('|'));
check('a pointing subject is not a term', st.definedIn('This is a common mistake in the lab.').length === 0 && st.definedIn('The result is a net gain of two ATP.').length === 0);

// 5. Facts and their three forms
const F = S.quizFacts;
const cards = [
  { front: 'Binary Heap', back: 'A complete binary tree that keeps the heap-order property at every node.', kind: 'definition', category: 'Key Term' },
  { front: 'Moraine', back: 'A ridge of rock debris that a glacier leaves behind when it melts back.', kind: 'definition', category: 'Key Term' },
  { front: 'Crevasse', back: 'A deep crack that opens in the brittle upper layer of moving ice.', kind: 'definition', category: 'Key Term' },
  { front: 'Esker', back: 'A winding ridge of sand and gravel laid down by a stream under the ice.', kind: 'definition', category: 'Key Term' },
  { front: 'Cirque', back: 'A bowl-shaped hollow that a glacier carves at the head of a valley.', kind: 'definition', category: 'Key Term' },
  { front: 'Drumlin', back: 'An oval hill of packed till that a glacier shapes as it flows over it.', kind: 'definition', category: 'Key Term' },
  { front: 'Length', back: 'The number of elements is called the length of the array.', kind: 'definition', category: 'Key Term' },
  { front: 'Tan rule', back: '$\\sec^{2} x$', kind: 'formula', category: 'Formula' },
];
const facts = F.fromCards(cards, '');
const byTerm = (t) => facts.find((f) => f.term === t);
check('formula cards are not facts', facts.length === 7 && !byTerm('Tan rule'));
check('a term repeated in its definition makes the fact sibling-only', byTerm('Binary Heap').siblingOnly && !byTerm('Moraine').siblingOnly);
check('a definition that contains its term is self-naming', byTerm('Length').selfNaming);
const ctx = { facts, seed: 0, forms: O.textForms(''), claimed: new Set() };
const FQ = S.factQuestions;
const describe = FQ.describe(byTerm('Moraine'), ctx);
check('term -> statement: sibling statements as options, answer among them', describe && describe.options.length >= 3 && describe.options.includes(describe.answer) &&
  /^Which statement defines "Moraine"\?$/.test(describe.question), describe && describe.question);
const nameQ = FQ.name(byTerm('Crevasse'), ctx);
check('statement -> term: sibling terms as options', nameQ && nameQ.answer === 'Crevasse' && nameQ.options.every((o) => facts.some((f) => f.term === o)), nameQ && nameQ.options.join(' | '));
check('a sibling-only or self-naming fact is never asked itself', FQ.describe(byTerm('Binary Heap'), ctx) === null && FQ.name(byTerm('Length'), ctx) === null &&
  FQ.trueFalse(byTerm('Binary Heap'), ctx, true) === null);
const falseQ = FQ.trueFalse(byTerm('Esker'), ctx, false);
const trueQ = FQ.trueFalse(byTerm('Esker'), ctx, true);
check('False = a sibling\'s statement under this term; the explanation names the sibling', falseQ && falseQ.answer === 'False' &&
  /"Esker"/.test(falseQ.question.split('\n')[0]) && !falseQ.question.includes(byTerm('Esker').statement) &&
  /^False\. This defines "(?!Esker)[^"]+", not "Esker"/.test(falseQ.explanation) && falseQ.construction === 'sibling_swap', falseQ && falseQ.explanation);
check('True = own statement under its own term', trueQ && trueQ.answer === 'True' && /"Esker"/.test(trueQ.question.split('\n')[0]));
const notes = F.fromNoteLines(['Bonding notes', 'ionic bond - transfer of electrons, metal to nonmetal', 'covalent bond = sharing of electron pairs',
  'metallic bond: sea of delocalised electrons', 'mnemonic: Please Do Not Throw Sausage Pizza Away', '- increases across a period'].join('\n'));
check('note lines become facts; labels and bullets do not', notes.length === 3 && notes[0].term === 'ionic bond' && /^Transfer of electrons/.test(notes[0].statement), notes.map((n) => n.term).join(' | '));

// 6. Cloze and naming True/False
const scope = S.quizScope.gather(GLACIERS, { maxQuestions: 10, mode: 'book', didacticBlocks: [], seedOffset: 0 });
const terms = S.quizScope.clozeTerms(scope);
const termTexts = terms.map((t) => t.text.toLowerCase());
check('terms defined in prose are marked', ['lateral moraine', 'terminal moraine', 'snow bridge', 'accumulation zone', 'ablation zone'].every((t) => termTexts.includes(t)), termTexts.join(' | '));
const sentenceCtx = { terms, seed: 0, variant: 0, forms: O.textForms(GLACIERS) };
// A cloze needs four options of the answer's own kind: in the passage only two terms are zones, so the naming
// sentence is not asked as a choice; among more zones it is, and only zones are offered.
check('no cloze when fewer than three wrong options of the same kind exist',
  S.clozeQuestions.forSentence('The area where yearly snowfall exceeds yearly melting is called the accumulation zone.', sentenceCtx) === null);
const zoneTerms = ['accumulation zone', 'ablation zone', 'percolation zone', 'runoff zone', 'snow bridge', 'terminal moraine', 'basal sliding']
  .map((text, order) => ({ text, rank: 0, order }));
const zoneCtx = { terms: zoneTerms, seed: 0, variant: 0, forms: O.textForms(GLACIERS) };
const cloze = S.clozeQuestions.forSentence('The area where yearly snowfall exceeds yearly melting is called the accumulation zone.', zoneCtx);
check('cloze blanks a marked term and offers four marked terms of its kind', cloze && /________/.test(cloze.question) && cloze.options.includes(cloze.answer) &&
  cloze.options.length === 4 && cloze.options.every((o) => / zone$/.test(o)), cloze && `${cloze.question} :: ${cloze.options.join(' | ')}`);
check('a sentence that does not name its blank offers no sibling of the same head (it could complete it too)',
  S.clozeQuestions.forSentence('When the accumulation zone shrinks for many years in a row, the front of the glacier retreats up the valley.', zoneCtx) === null);
const zoneTerms5 = [...zoneTerms, { text: 'firn zone', rank: 0, order: 8 }, { text: 'meltwater zone', rank: 0, order: 9 }];
const echo = S.clozeQuestions.forSentence('Meltwater soaks the area where yearly snowfall exceeds yearly melting, which is called the accumulation zone.',
  { ...zoneCtx, terms: zoneTerms5 });
check('a wrong option that repeats a word of the stem is not offered', echo && !echo.options.includes('meltwater zone') && echo.options.length === 4,
  echo && echo.options.join(' | '));
const compoundTerms = ['gate delay', 'wire delay', 'pin delay', 'net delay'].map((text, order) => ({ text, rank: 0, order }));
const compoundStem = 'The table a designer reads for each cell of the adder is called the gate delay model of the cell.';
const compoundCtx = (text) => ({ terms: compoundTerms, seed: 0, variant: 0, forms: O.textForms(text), text });
const allModels = 'A gate delay model, a wire delay model, a pin delay model and a net delay model are kept apart.';
const oneModel = 'A gate delay model is kept per cell. Wire delay grows with length. Pin delay is small. Net delay adds up.';
check('a blank before a noun takes terms the text writes before that noun',
  Boolean(S.clozeQuestions.forSentence(compoundStem, compoundCtx(allModels))));
check('a blank before a noun takes no term the text never writes before it', S.clozeQuestions.forSentence(compoundStem, compoundCtx(oneModel)) === null);
check('a stem that names its category offers only that category',
  S.clozeQuestions.forSentence('Packed snow over a hidden crack forms a fragile arch called a snow bridge that climbers must probe with care.', zoneCtx) === null);
check('no cloze from a thin stem', S.clozeQuestions.forSentence('The glacier is a snow bridge.', sentenceCtx) === null);
check('no cloze from a sentence that points outside itself', S.clozeQuestions.forSentence('This is why the accumulation zone of the glacier is watched so closely by geologists each year.', sentenceCtx) === null);
const namingFalse = S.namingQuestions.forSentence('The area where yearly melting exceeds yearly snowfall is called the ablation zone.', sentenceCtx, false);
check('naming False swaps in a sibling term and says which', namingFalse && namingFalse.answer === 'False' && !/ablation zone/.test(namingFalse.question) &&
  /names "ablation zone" here, not "/.test(namingFalse.explanation), namingFalse && namingFalse.question);
check('naming needs a sentence that names the term', S.namingQuestions.forSentence('Most of the ice that a glacier loses in summer melts in the ablation zone near its front.', sentenceCtx, false) === null);
check('article agrees with the swapped-in term', S.namingQuestions.agreeArticle('It is called a ', 'esker') === 'It is called an ' && S.namingQuestions.agreeArticle('An ', 'moraine') === 'A ');

// 7. Assembly
const A = S.quizAssembly;
const set = A.createSet(10);
const mc = (question, answer, options) => ({ type: 'multiple_choice', question, answer, options });
const swap = (statement, answer) => ({ type: 'true_false', question: `True or False:\n"${statement}"`, answer, options: ['True', 'False'], construction: 'sibling_swap' });
check('a lone swap True is refused', !set.accept(swap('A crevasse is a deep crack in moving ice.', 'True')));
const three = mc('Which term is defined as follows?\n"A deep crack in the upper layer of moving ice"', 'Icefall', ['Icefall', 'Esker', 'Moraine']);
check('a choice question with three options is refused', set.refusal(three) === 'too few options' && !set.accept(three));
check('first question kept', set.accept(mc('Which term is defined as follows?\n"A deep crack in the upper layer of moving ice"', 'Icefall', ['Icefall', 'Esker', 'Moraine', 'Kame'])));
check('same answer refused', set.refusal(mc('Complete the statement:\n"Climbers fear the hidden ________ on the upper glacier in spring and early summer."', 'icefalls', ['icefalls', 'eskers', 'kames', 'drumlins'])) === 'same answer');
check('same options refused', set.refusal(mc('Which term is defined as follows?\n"A winding ridge of sand and gravel under the ice"', 'Esker', ['Moraine', 'Esker', 'Icefall', 'Kame'])) === 'same options');
check('same fact refused', !set.accept(swap('A deep crack in the upper layer of moving ice.', 'False')));
check('swap True kept once a swap False is in the set', set.accept(swap('A ridge of rock debris left behind by retreating ice.', 'False')) &&
  set.accept(swap('A winding ridge of sand and gravel laid down by a stream.', 'True')) && set.size() === 3);

// 8. The whole engine on the authored passage
const quiz = S.quizEngine.generateQuiz(GLACIERS, { maxQuestions: 10 });
const test = S.testEngine.generateTest(GLACIERS, { maxQuestions: 20 });
const all = [...quiz, ...test.questions];
const show = (list) => list.map((q) => q.question.replace(/\n/g, ' / ')).join(' | ');
// Six terms, two of them mirror images of each other ("snowfall exceeds melting" / "melting exceeds
// snowfall"): the second of such a pair is the same fact again, so four or five questions is right.
check('engine: several questions from prose that defines its terms', quiz.length >= 4, `${quiz.length}: ${show(quiz)}`);
const choice = all.filter((q) => q.type !== 'true_false' && q.type !== 'reveal');
check('engine: answer among options, 4 options, no repeats in a set', choice.every((q) => q.options.length === 4 && q.options.includes(q.answer) &&
  new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length));
const caseMixed = choice.filter((q) => new Set(q.options.map((o) => /^[A-Z]/.test(o))).size > 1);
check('engine: one leading case per option set', caseMixed.length === 0, caseMixed.map((q) => q.options.join('/')).join(' | '));
const numberMixed = choice.filter((q) => q.type === 'cloze' && new Set(q.options.map((o) => O.isPlural(o))).size > 1);
check('engine: one grammatical number per cloze option set', numberMixed.length === 0, numberMixed.map((q) => q.options.join('/')).join(' | '));
check('engine: no stem points outside itself', !all.some((q) => /\bThis is why\b|\bthis\b|\bthese\b/i.test((q.question.match(/\n"([\s\S]*)"$/) || [])[1] || '')), show(all));
const tf = quiz.filter((q) => q.type === 'true_false');
const firstTrue = tf.findIndex((q) => q.answer === 'True');
check('engine: every True/False is a sibling swap, False first', tf.every((q) => q.construction === 'sibling_swap') && (firstTrue === -1 || tf.slice(0, firstTrue).some((q) => q.answer === 'False')));
check('engine: True and False roughly even', Math.abs(tf.filter((q) => q.answer === 'True').length * 2 - tf.length) <= 2, `${tf.filter((q) => q.answer === 'True').length} True of ${tf.length}`);
const answers = quiz.filter((q) => q.type !== 'true_false').map((q) => q.answer.toLowerCase());
check('engine: no answer asked twice in a quiz', new Set(answers).size === answers.length, answers.join(', '));
const asText = (list) => list.map((q) => q.question).join('\n');
// The passage has about six facts and the quiz asks most of them: the test asks what is left, and is
// short for it, rather than asking the quiz's facts again.
const quizFacts = new Set(quiz.map((q) => q.factKey));
check('engine: the practice test asks no fact the quiz asks', test.total >= 1 &&
  test.questions.every((q) => q.review || !quizFacts.has(q.factKey)), `${test.total} test questions: ${show(test.questions)}`);
// When the facts run out, the test may come back to a quiz fact, flagged as review and in another question type.
const reviews = test.questions.filter((q) => q.review);
check('engine: a review question is flagged and asks its quiz fact in another form', reviews.every((q) => /^Review/.test(q.badge) &&
  quiz.filter((k) => k.factKey === q.factKey).every((k) => k.type !== q.type)), show(reviews));
const recalls = quiz.filter((q) => q.type === 'reveal');
check('engine: recall questions are labelled and stay within a third of the quiz', recalls.every((q) => q.badge === 'Recall' && q.answer) &&
  (recalls.length === quiz.length || recalls.length <= Math.ceil(10 / 3)), show(recalls));
check('engine: every question names its source and fact', all.every((q) => q.source && q.factKey), show(all.filter((q) => !q.source || !q.factKey)));
check('engine: nothing built from an antonym swap', !all.some((q) => /the source text states "/.test(q.explanation || '')));

// A comparison table asked down one column: the other rows' values are the wrong options, never one that
// overlaps the answer ("Dogs" against "Dogs, Cats").
const tableCards = S.tableCards.rowCards({ header: ['Assay', 'Sample', 'Target'], rows: [
  ['Serology', 'Clotted blood', 'Host antibodies'], ['PCR', 'Whole blood, urine', 'Bacterial DNA'],
  ['Culture', 'Urine', 'Live bacteria'], ['Histology', 'Kidney tissue', 'Bacterial antigen'], ['Biopsy', 'Liver tissue', 'Fixed cells']] });
const tableQs = S.tableQuestions.candidates(tableCards, { seed: 0 });
const pcrSample = tableQs.find((q) => /Assay is "PCR", what is the Sample\?$/.test(q.question));
check('table: one column asked with other rows\' values as options', pcrSample && pcrSample.answer === 'Whole blood, urine' &&
  pcrSample.options.includes('Clotted blood') && !pcrSample.options.includes('Urine') && pcrSample.options.length === 4, pcrSample && pcrSample.options.join(' | '));
check('table: the stem names the column asked and the column its value sits in', pcrSample && /^In the row where Assay is "PCR", what is the Sample\?$/.test(pcrSample.question),
  pcrSample && pcrSample.question);
// A host table: a row that lists the stem's value in another column is never an option, a value two rows share is
// not asked, and a table whose first header cell is empty names no column for its row values.
const hostRows = [['cattle', 'sheep', 'Alpha'], ['goats', 'cattle', 'Beta'], ['horses', 'pigs', 'Gamma'], ['dogs', 'cats', 'Delta'], ['rats', 'mice', 'Epsilon']];
const hostQs = S.tableQuestions.candidates(S.tableCards.rowCards({ header: ['Main host', 'Other host', 'Strain'], rows: hostRows }), { seed: 0 });
const cattle = hostQs.find((q) => /Main host is "cattle", what is the Strain/.test(q.question));
check('table: a row holding the stem value in another column is never an option', cattle && !cattle.options.includes('Beta') && cattle.options.length === 4,
  cattle && cattle.options.join(' | '));
const noHeader = S.tableQuestions.candidates(S.tableCards.rowCards({ header: ['', 'Other host', 'Strain'], rows: hostRows }), { seed: 0 });
check('table: no question when the row values have no header', noHeader.length === 0, noHeader.map((q) => q.question).join(' | '));
const shared = S.tableQuestions.candidates(S.tableCards.rowCards({ header: ['Main host', 'Other host', 'Strain'],
  rows: [['cattle', 'sheep', 'Alpha'], ['cattle, goats', 'pigs', 'Beta'], ['horses', 'pigs', 'Gamma'], ['dogs', 'cats', 'Delta'], ['rats', 'mice', 'Epsilon']] }), { seed: 0 });
check('table: a stem value two rows list is not asked', !shared.some((q) => /Main host is "cattle"/.test(q.question)), shared.map((q) => q.question).join(' | '));
const assayTbl = { header: ['Assay', 'Sample'], rows: [['PCR', 'Blood'], ['ELISA', 'Serum']] };
const qualifiedAssay = S.tableCards.rowCards(assayTbl, { subject: 'Pond blight' });
const genericAssay = S.tableCards.rowCards(assayTbl, { subject: 'Diagnosis' });
check('table: method column rows qualify with a specific subject in question stems without changing card fronts',
  qualifiedAssay[0].front === 'PCR — Sample' &&
  qualifiedAssay[0].table.subject === 'Pond blight' &&
  S.tableQuestions.stemFor(qualifiedAssay[0]) === 'In the row where Assay is "PCR (Pond blight)", what is the Sample?' &&
  genericAssay[0].table.subject === undefined &&
  S.tableQuestions.stemFor(genericAssay[0]) === 'In the row where Assay is "PCR", what is the Sample?',
  qualifiedAssay[0] && S.tableQuestions.stemFor(qualifiedAssay[0]));

// Regression guards: disparate containment (0.9), review notOwner dedupe, test recallGroup budget (4), opener guard.
const qa = S.quizAssembly;
const shortSet = new Set(['surface', 'protein', 'antigen', 'gene', 'host', 'membrane', 'cycle', 'outer']);
const longDisparate = new Set(['describe', 'surface', 'protein', 'antigen', 'gene', 'host', 'membrane', 'cycle', 'bacterium', 'evasion', 'immune', 'response', 'tick', 'midgut', 'saliva', 'transmission']);
check('assembly: disparate multi-point answer (7/8 < 0.90) is not treated as same fact', !qa.sameFact(shortSet, longDisparate));
const longMatched = new Set([...shortSet, 'bacterium', 'evasion', 'immune', 'response', 'tick', 'midgut', 'saliva', 'transmission']);
check('assembly: disparate multi-point answer enclosing >= 0.90 of short set is caught', qa.sameFact(shortSet, longMatched));

const reviewSet = qa.createSet(20, {
  reviewOf: [{ type: 'true_false', answer: 'False', factKey: 'pump|not|valve|controls reverse flow', source: 'Valve: controls reverse flow', question: 'True or False: this statement defines "Pump".\n"controls reverse flow"' }],
});
check('assembly: review refuses a second swapped-False true_false on the same subject',
  reviewSet.refusal({ type: 'true_false', answer: 'False', factKey: 'pump|not|impeller|rotates inside casing', source: 'Impeller: rotates inside casing', question: 'True or False: this statement defines "Pump".\n"rotates inside casing"' }) === 'same form as before');

const quizTableSet = qa.createSet(10);
const testTableSet = qa.createSet(20);
const tableCell = (i) => ({ type: 'reveal', answer: `Cell ${i} value`, question: `Cell ${i} prompt?`, options: [], recallGroup: 'table|fixture' });
for (let i = 1; i <= 4; i++) { quizTableSet.accept(tableCell(i)); testTableSet.accept(tableCell(i)); }
check('assembly: quiz caps one table at 2 recall cells while a 20-question test allows 4',
  quizTableSet.list().length === 2 && testTableSet.list().length === 4 && testTableSet.refusal(tableCell(5)) === 'figure asked enough');

const pumpFact = { kind: 'point', subject: 'Pump', term: 'Pump', identity: 'pump|raises head', source: 'Pump: raises head', statement: 'Raises head against backpressure' };
const ventFact = { kind: 'point', subject: 'Vent', term: 'Vent', identity: 'vent|stays open', source: 'Vent stays open during priming', statement: 'Vent stays open during priming' };
const tfScope = S.quizScope.gather('Pump: raises head\nVent: Vent stays open during priming', { mode: 'book' });
check('factQuestions: alteredFalse skips capitalized non-pronoun opener absent from target subject',
  S.factQuestions.trueFalse(pumpFact, { ...tfScope, facts: [pumpFact, ventFact] }, false) === null);

console.log(failures ? `\n${failures} question fixture(s) FAILED` : '\nAll question fixtures passed');
process.exitCode = failures ? 1 : 0;

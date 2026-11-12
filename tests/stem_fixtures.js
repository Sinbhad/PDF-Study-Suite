/**
 * STEM Quality Fixtures (node tests/stem_fixtures.js, or tests/quality.html in a browser).
 * Math spans stay atomic, exercise/label garbage is rejected, theorem/formula/complexity cards are
 * built, formula answers get typed distractors, and the Practice Test engine grades correctly.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  if (IS_NODE) {
    ['math-text', 'stem-noise', 'tokenizer', 'noise-filter', 'bold-terms', 'keywords', 'summarizer', 'stem-cards',
      'slide-cards', 'flashcard-engine', 'quiz-gate', 'quiz-options', 'stem-distractors', 'stem-questions',
      'quiz-engine', 'test-engine'].forEach((m) => require(`../src/nlp/${m}.js`));
  }
  const S = root.PDFStudy;
  let failures = 0;
  const check = (name, ok, detail = '') => {
    if (!ok) failures++;
    const line = `${ok ? 'PASS' : 'FAIL'}  [stem] ${name}${detail ? `  (${detail})` : ''}`;
    if (IS_NODE) console.log(line);
    else (root.__stemResults = root.__stemResults || []).push(line);
  };

  const CALC = [
    '2.3 Product and Quotient Rules',
    'The Quotient Rule: $\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right] = \\frac{g(x)f\'(x) - f(x)g\'(x)}{[g(x)]^{2}}$',
    'The derivative of $\\tan x$ is $\\sec^{2} x$.',
    'The derivative of $\\sin x$ is $\\cos x$.',
    'The Mean Value Theorem states that if $f$ is continuous on $[a, b]$ and differentiable on $(a, b)$, then there exists $c$ in $(a, b)$ such that $f\'(c) = \\frac{f(b) - f(a)}{b - a}$.',
    'A function is differentiable at $x = c$ when the limit $\\lim_{h \\to 0} \\frac{f(c + h) - f(c)}{h}$ exists. Fig. 2.1 shows a value of 3.14 near the tangent.',
    'Find the derivative of $f(x) = x^{3} - 4x$.',
    '15. $\\lim_{x \\to 2} (x^{2} - 4)$',
    'In Exercises 1–8, evaluate the integral.',
    'As shown in Figure 2.3, the tangent line approximates the curve.',
    'This means that the slope is positive.',
    'Gottfried Leibniz (1646–1716) was born in Leipzig.',
    'The Chain Rule states that if $y = f(u)$ is differentiable and $u = g(x)$ is differentiable, then $\\frac{dy}{dx} = \\frac{dy}{du} \\cdot \\frac{du}{dx}$.',
  ].join('\n');
  const CS = [
    'Sorting Algorithms',
    'Merge sort runs in $O(n \\log n)$ time in the worst case.',
    'The running time of binary search is $O(\\log n)$.',
    'The recurrence for merge sort is $T(n) = 2T(n/2) + O(n)$.',
    'A graph is a set of vertices together with a set of edges that join pairs of vertices.',
    'A spanning tree is a subgraph that includes every vertex of the graph and is a tree.',
    'A binary heap is a complete binary tree in which every parent key is at most the keys of its children.',
    'A hash table is a data structure that maps keys to values using a hash function to compute bucket indexes.',
  ].join('\n');

  // 1. Math-safe sentence splitting
  const sents = S.tokenizer.splitSentences(CALC);
  check('formula never split mid-span', sents.every((s) => S.mathText.isBalanced(s)), sents.length + ' sentences');
  check('Fig. 2.1 and 3.14 do not end a sentence', sents.some((s) => /Fig\. 2\.1 shows a value of 3\.14/.test(s)));
  const pdfMathSample = 'Suppose $\\lim_{x \\to c^{+}}f(x) = L.$ Then $f$ is continuous from the right at $x = c$.';
  check('period inside $... .$ ends sentence cleanly', S.tokenizer.splitSentences(pdfMathSample).length === 2);

  // 2. Garbage gate
  const sn = S.stemNoise;
  check('exercise prompt rejected', sn.isStemNoise('Find the derivative of $f(x) = x^{3} - 4x$.'));
  check('numbered homework rejected', sn.isStemNoise('15. $\\lim_{x \\to 2} (x^{2} - 4)$'));
  check('"In Exercises 1–8" rejected', sn.isStemNoise('In Exercises 1–8, evaluate the integral.'));
  check('figure callout rejected', sn.isStemNoise('As shown in Figure 2.3, the tangent line approximates the curve.'));
  check('biography rejected', sn.isStemNoise('Gottfried Leibniz (1646–1716) was born in Leipzig.'));
  check('dangling pronoun rejected', sn.isUnusableSentence('This means that the slope is positive.'));
  const labels = ['Solution', 'Proof', 'Remark', 'Note', 'Example 2', 'Theorem 1.3', 'Check', 'Step 1', 'Exploration', 'x', 'Case 1', 'Base Case', 'CSCI 2226', 'The'];
  check('structural labels never terms', labels.every((l) => sn.isLabelTerm(l)), labels.filter((l) => !sn.isLabelTerm(l)).join(','));
  check('real STEM terms survive', ['Mean Value Theorem', 'Spanning tree', 'Derivative of $\\tan x$'].every((t) => !sn.isLabelTerm(t)));
  check('real definition sentence survives', !sn.isUnusableSentence('A graph is a set of vertices together with a set of edges that join pairs of vertices.'));

  // 3. STEM flashcards
  const cards = S.flashcardEngine.extractBookFlashcards(CALC + '\n' + CS, 'Fixture');
  const byFront = (re) => cards.find((c) => re.test(c.front));
  const show = cards.map((c) => `${c.front} => ${c.back.slice(0, 40)} [${c.kind}]`).join(' | ');
  const qr = byFront(/^Quotient Rule$/);
  check('Quotient Rule formula card with exact TeX', qr && qr.kind === 'formula' && qr.back.includes('[g(x)]^{2}'), show);
  check('derivative card "Derivative of $\\tan x$"', (byFront(/^Derivative of \$\\tan x\$$/) || {}).back === '$\\sec^{2} x$');
  check('Mean Value Theorem theorem card', (byFront(/^Mean Value Theorem$/) || {}).kind === 'theorem');
  check('merge sort complexity card', /O\(n \\log n\)/.test((byFront(/^Time complexity of Merge sort$/i) || {}).back || ''));
  check('merge sort recurrence card', /T\(n\) = 2T\(n\/2\)/.test((byFront(/^Recurrence for merge sort$/i) || {}).back || ''));
  check('no garbage fronts', !cards.some((c) => sn.isLabelTerm(c.front) || /^(?:Find|Evaluate|This|As shown)/.test(c.front)), show);
  check('no exercise backs', !cards.some((c) => /Find the derivative|Exercises 1|Figure 2\.3|born in/.test(c.back)));

  // 4. Typed distractors
  const sd = S.stemDistractors;
  const qAns = "$\\frac{g(x)f'(x) - f(x)g'(x)}{[g(x)]^{2}}$";
  const fd = sd.selectDistractors(qAns, ['A spanning tree', 'binary heap'], '', 3);
  check('formula answer gets 3 formula distractors', fd.length === 3 && fd.every((d) => S.mathText.isFormula(d) && d !== qAns), fd.join(' ; '));
  const cd = sd.selectDistractors('$O(n \\log n)$', [], '', 3);
  check('complexity answer gets sibling classes', cd.length === 3 && cd.every((d) => /^\$O\(/.test(d)) && cd.some((d) => /n\^\{2\}|\(n\)/.test(d)), cd.join(' ; '));
  const pd = sd.typedPool('spanning tree', ['$O(n)$', 'binary heap', '$x^{2}$']);
  check('prose answer never gets formula distractors', pd.length === 1 && pd[0] === 'binary heap');

  // 5. Quiz + Practice Test
  const quiz = S.quizEngine.generateQuiz(CALC + '\n' + CS, { maxQuestions: 10 });
  const formulaQs = quiz.filter((q) => q.skill === 'formula' || q.skill === 'complexity');
  check('quiz contains formula/complexity questions', formulaQs.length >= 1, quiz.map((q) => q.question.split('\n')[0]).join(' | '));
  check('formula questions have only formula options', formulaQs.every((q) => q.options.every((o) => S.mathText.isFormula(o))));
  check('no quiz stem from exercises/callouts', !quiz.some((q) => /Find the derivative|Figure 2\.3|This means|Exercises 1/.test(q.question)));
  const test = S.testEngine.generateTest('', { maxQuestions: 12, sections: [{ name: 'Calculus', text: CALC }, { name: 'Algorithms', text: CS }] });
  check('practice test has sections and questions', test.sections.length >= 1 && test.total >= 4, `${test.total} q, skills ${JSON.stringify(test.skills)}`);
  check('practice test ids unique', new Set(test.questions.map((q) => q.id)).size === test.total);
  check('practice test mixes skills', Object.keys(test.skills).length >= 2, JSON.stringify(test.skills));
  const perfect = Object.fromEntries(test.questions.map((q) => [q.id, q.answer]));
  const g1 = S.testEngine.gradeTest(test, perfect);
  const g0 = S.testEngine.gradeTest(test, {});
  check('gradeTest perfect = 100%', g1.percent === 100 && g1.missed.length === 0);
  check('gradeTest blank = 0% with missed review', g0.score === 0 && g0.missed.length === test.total && Object.keys(g0.bySkill).length >= 1);
  check('generatePracticeTest alias', S.testEngine.generatePracticeTest === S.testEngine.generateTest);

  // 6. Real-PDF regression checks (#26)
  const sliced = S.mathText.safeSlice('First derivative is ' + 'very '.repeat(50) + '$y\'\'\', \\quad f^{(4)}(x) = 0$ end.', 260);
  check('safeSlice never leaves odd $', S.mathText.isBalanced(sliced), sliced.slice(-40));
  const recDist = sd.selectDistractors('$T(n) = 2T(n/2) + O(n)$', [qAns], 'Recurrence for Merge Sort', 3);
  check('recurrence never pairs with d/dx', recDist.length === 3 && recDist.every((d) => /\bT\(/.test(d)), recDist.join(' ; '));
  const brkDist = sd.formulaDistractors('$\\frac{d}{dx}[5x - 2]$', 3);
  check('bracketed formula distractors stay balanced', brkDist.every((d) => S.mathText.isBalanced(d)), brkDist.join(' ; '));
  const quadCards = S.stemCards.extractStemCards([
    '$$\\frac{d}{dx}[\\tan x] = \\sec^{2}x \\quad \\frac{d}{dx}[\\cot x] = -\\csc^{2}x$$',
    '$\\frac{d}{dx}[\\frac{5x - 2}{x^{2} + 1}] = \\frac{(x^{2}+1)\\frac{d}{dx}[5x-2]}{1}$',
    '$\\frac{d}{dx}[F(x)] = f(x)$',
    '$\\frac{d}{dx}[x^{n}] = \\frac{d}{dx}[\\frac{1}{x^{k}}]$',
  ].join('\n'));
  check('\\quad derivatives split & worked examples skipped', quadCards.length === 2 && quadCards[1].front === 'Derivative of $\\cot x$', quadCards.map((c) => c.front).join(','));
  const schedCards = S.flashcardEngine.extractSlideFlashcards([{ slideNumber: 1, title: 'Interval Scheduling Example', bullets: ['Dutchess 4:00 pm 6:00 pm', 'Marist 5:00 pm 7:00 pm'] }]);
  check('clock-time schedule slide skipped', schedCards.length === 0, JSON.stringify(schedCards));
  const slTxt = S.slideCards.slidesToText([{ title: 'Bounds', bullets: ['Big-O holds for $n \\ge n_{0}.$', 'Tight bound.'] }]);
  check('slidesToText has no double period', !/(?<!\.)\.\.(?!\.)/.test(slTxt), slTxt);
  const ansKey = ['Section 1.1 (page 47)', '1. 300 ft', '3. Slope = 2', '5. (a) Domain: (0, 100)', '7. Answers will vary.', '9. Nonremovable discontinuity at x = 2 41.', '11. Sample answer: y = 2x', '13. Proof', '15. Limit exists.'].join('\n');
  check('answer-key section yields 0 cards & 0 quiz', S.flashcardEngine.extractBookFlashcards(ansKey).length === 0 && S.quizEngine.generateQuiz(ansKey).length === 0);
  check('axis debris & truncated theorem rejected', !S.quizGate.isQuizSentence('$y$ $x$ $-\\pi$ $-3$ $(a)f$ is discontinuous at every integer multiple.') && sn.isFragment('If $f$ is integrable on $[a, b]$, and'));
  check('verb/determiner phrases fail isNounPhrase', ['camelina oil became', 'take many lines', 'math easier', 'whose nickname', 'First form'].every((p) => !S.quizGate.isNounPhrase(p) || sn.isLabelTerm(p)));
  const arcsinDist = sd.formulaDistractors('$\\frac{1}{\\sqrt{1 - x^{2}}}$', 3);
  check('arcsin radical swap keeps x^{2} intact', arcsinDist.some((d) => d.includes('x^{2} - 1')) && arcsinDist.every((d) => !/\^\s*[-+]/.test(d)), arcsinDist.join(' ; '));
  const badMeta = [
    'If none of the three conditions is true, then the function $f$ is called continuous at $c$, as indicated in the important definition below.',
    'The theorem says that if a power. series converges, it is a Taylor series.',
  ];
  check('dangling conditions / definition-below / power. series rejected', badMeta.every((s) => sn.isUnusableSentence(s)));
  const guideBack = S.stemCards.didacticBack({ body: '1. Find an antiderivative $F$ of $f$. When applying the Fundamental Theorem of Calculus, the notation shown below is convenient. $b$' });
  check('didacticBack strips trailing shown-below note', !/shown below|\$b\$/.test(guideBack), guideBack);
  const badKeyTerms = ['along steepest descent', 'Partition-based sort running', 'underpins trigonometric differentiation',
    'next theorem deals', 'Discontinuities fall', 'word secant comes', 'Though Riemann sums', 'besides worst-case analysis', 'greedy algorithm finds', 'Function'];
  check('#30 verb/prep/generic phrases fail isNounPhrase', badKeyTerms.every((p) => !S.quizGate.isNounPhrase(p)), badKeyTerms.filter((p) => S.quizGate.isNounPhrase(p)).join(' | '));

  // 7. Study-content layer on synthetic slides (extraction fields present on some slides, absent on others)
  const R = '{(1, 1), (1, 2)}';
  const DECK = [
    { slideNumber: 1, kind: 'title', title: 'Relations', bullets: ['CSCI 2226'] },
    { slideNumber: 2, kind: 'content', title: 'Properties Of Relations', bullets: ['Def: A relation R on a set A is called reflexive if xRx for every x in A', 'Def: A relation R on a set A is called symmetric if whenever xRy, then yRx'],
      definitions: [{ term: 'reflexive', definition: 'A relation R on a set A is called reflexive if xRx for every x in A' }, { term: 'symmetric', definition: 'A relation R on a set A is called symmetric if whenever xRy, then yRx' }] },
    { slideNumber: 3, title: 'More Properties', bullets: ['Def: A relation R on a set A is called transitive if whenever xRy and yRz, then xRz', 'Def: A relation on a set A is called an equivalence relation if it is reflexive, symmetric, and transitive.',
      'Def: Two elements a and b that are related by an equivalence relation are called equivalent. The notation a ~ b is often used.', 'The domain of R is defined as {a | (a, b) in R}'] },
    { slideNumber: 4, pages: [4, 5], kind: 'question', title: 'Which of the Following is Reflexive?', qa: { question: 'Which of the Following is Reflexive?', answer: 'R_1 and R_3' },
      bullets: ['Def: A relation R on a set A is called reflexive if xRx for every x in A', `R_1 = ${R}`, 'R_2 = {(1, 2)}', 'R_3 = {(1, 1), (2, 2)}', 'R_4 = {(2, 1)}'] },
    { slideNumber: 6, title: 'Which of the Following is Symmetric?', bullets: [`R_1 = ${R}`, 'R_2 = {(1, 2)}', 'R_3 = {(1, 1), (2, 2)}', 'R_4 = {(2, 1)}'] },
    { slideNumber: 7, title: 'Which of the Following is Symmetric? R_3', bullets: [`R_1 = ${R}`, 'R_2 = {(1, 2)}', 'R_3 = {(1, 1), (2, 2)}', 'R_4 = {(2, 1)}'] },
    { slideNumber: 8, title: 'A relation R is defined on Z by xRy if xy >= 0', bullets: ['Prove or Disprove: Reflexive, Symmetric', 'Reflexive: Since xx >= 0 for every integer x, R is reflexive.', 'Symmetric: Since xy = yx, R is symmetric.'] },
    { slideNumber: 9, title: 'Why Relations Matter', bullets: ['Databases store their records as relations between sets.', 'Ordering tasks by priority is described by a relation.'] },
    { slideNumber: 10, kind: 'table', title: 'Truth Table', bullets: [], table: { rows: [['x', 'y'], ['0', '1']] } },
  ];
  const sCards = S.flashcardEngine.extractSlideFlashcards(DECK);
  const fronts = sCards.map((c) => c.front);
  const kinds = sCards.map((c) => c.kind);
  check('slide cards: term -> definition first, given and inferred definitions deduped by lemma',
    kinds.slice(0, 6).every((k) => k === 'definition') && ['Reflexive', 'Symmetric', 'Transitive', 'Equivalence relation', 'Equivalent', 'Domain of R'].every((t) => fronts.includes(t)) &&
    fronts.filter((f) => f === 'Reflexive').length === 1, fronts.join(' | '));
  check('slide cards: the defined term is never a clipped sentence half', !fronts.some((f) => /\bthat$|^Two elements/.test(f)), fronts.join(' | '));
  const qaCard = sCards.find((c) => c.kind === 'qa' && c.back === 'R_1 and R_3');
  check('slide cards: lecturer question -> answer card carries the candidates', qaCard && /Reflexive\?\n• R_1 = /.test(qaCard.front) && !/Def:/.test(qaCard.front), qaCard && qaCard.front);
  check('slide cards: revealed-answer title pair collapses into one Q -> A card', sCards.filter((c) => /Symmetric\?/.test(c.front)).length === 1 && sCards.some((c) => c.back === 'R_3'));
  check('slide cards: worked problem = prompt front, labelled steps back', sCards.some((c) => c.category === 'Worked Example' && /Prove or Disprove/.test(c.front) && /^• Reflexive: /.test(c.back) && /\n• Symmetric: /.test(c.back)));
  const overview = sCards.filter((c) => c.kind === 'overview');
  check('slide cards: "key points" only as a last resort, never for question/example/title slides, never a clip',
    overview.length === 1 && /Why Relations Matter/.test(overview[0].front) && sCards[sCards.length - 1] === overview[0] && sCards.every((c) => !('clip' in c) && c.back && c.front));
  const sQuiz = S.quizEngine.generateQuiz(DECK, { mode: 'slides', maxQuestions: 10 });
  const optsOk = (q) => q.type === 'reveal' ? q.options.length === 0 && q.answer.length > 0
    : q.options.length >= 2 && new Set(q.options.map((o) => o.toLowerCase())).size === q.options.length && q.options.includes(q.answer) && q.options.every((o) => o.trim());
  check('slide quiz: a real section quiz with ids, pages and sound options', sQuiz.length >= 8 && sQuiz.every((q, i) => q.id === `q-${i + 1}` && q.page && optsOk(q)), `${sQuiz.length}: ${sQuiz.filter((q) => !optsOk(q)).map((q) => q.question).join(' | ')}`);
  const completion = sQuiz.find((q) => /^Complete the definition/.test(q.question));
  check('slide quiz: definition completion offers sibling conditions only', completion && completion.options.length === 4 && completion.options.every((o) => /xR|reflexive, symmetric/.test(o)), completion && completion.options.join(' | '));
  const lecture = sQuiz.find((q) => q.badge === 'Lecture Question' && /Reflexive\?/.test(q.question));
  check('slide quiz: lecture question becomes MCQ over the listed candidates', lecture && lecture.answer === 'R_1 and R_3' && lecture.options.every((o) => /^R_\d(?:(?:, | and |, and )R_\d)*$/.test(o)), lecture && lecture.options.join(' | '));
  check('slide quiz: worked problem is a reveal item; no question is built from a table or title slide', sQuiz.some((q) => q.type === 'reveal' && /Prove or Disprove/.test(q.question)) && sQuiz.every((q) => q.page !== 1 && q.page !== 10));
  const scoped = S.quizEngine.generateQuiz(DECK.slice(1, 3), { mode: 'slides', maxQuestions: 10 });
  check('slide quiz: follows the selected slide range', scoped.length >= 4 && scoped.every((q) => q.page === 2 || q.page === 3), scoped.map((q) => q.page).join(','));
  const sSum = S.summarizer.summarizeSlides(DECK, 5);
  check('slide summary: definitions[], defining statements first, lemma-deduped concept key terms', sSum.definitions.length === 6 && sSum.definitions[0].page === 2 && /is called reflexive if/.test(sSum.overviewSentences[0]) &&
    !sSum.overviewSentences.some((s) => /Since xx|Prove or/.test(s)) && sSum.keyTerms.slice(0, 3).join() === 'Reflexive,Symmetric,Transitive' && sSum.keyTerms.includes('Domain') && sSum.keyFormulas.length === 0, JSON.stringify([sSum.overviewSentences, sSum.keyTerms]));
  const bd = sSum.slideBreakdown;
  check('slide summary: breakdown skips the title slide and passes qa / table through', !bd.some((b) => b.slideNumber === 1) && bd.find((b) => b.slideNumber === 4).qa[0].answer === 'R_1 and R_3' && bd.find((b) => b.slideNumber === 10).table.rows.length === 2);
  check('key terms: lemma dedupe and no filler bigrams', S.keyTerms.rank({ definitions: [{ term: 'Equivalence Classes' }, { term: 'equivalence class' }], text: 'The pair belongs here. Like factors cancel. The pair belongs there. Like factors remain.' }).join() === 'Equivalence Classes');

  // 8. Textbook section quiz from didactic blocks
  const thm = (n, name, body, formulas = []) => ({ category: 'Theorem', title: `Theorem 1.${n} — ${name}`, body, formulas, pageNumber: 80 + n });
  const BLOCKS = [
    thm(1, 'Some Basic Limits', 'Let $b$ and $c$ be real numbers.\n1. $\\lim_{x \\to c}b = b$\n2. $\\lim_{x \\to c}x = c$\n3. $\\lim_{x \\to c}x^{n} = c^{n}$', ['\\lim_{x \\to c}b = b', '\\lim_{x \\to c}x = c', '\\lim_{x \\to c}x^{n} = c^{n}']),
    thm(2, 'Properties of Limits', 'Let $f$ and $g$ have limits $L$ and $K.$ 1. Scalar multiple: $\\lim_{x \\to c}[b f(x)] = bL$ 2. Product: $\\lim_{x \\to c}[f(x)g(x)] = LK$ 3. Power: $\\lim_{x \\to c}[f(x)]^{n} = L^{n}$'),
    thm(4, 'The Limit of a Function Involving a Radical', 'Let $n$ be a positive integer. $$\\lim_{x \\to c}\\sqrt[n]{x} = \\sqrt[n]{c}$$', ['\\lim_{x \\to c}\\sqrt[n]{x} = \\sqrt[n]{c}']),
    thm(8, 'The Squeeze Theorem', 'If $h(x) \\le f(x) \\le g(x)$ near $c$ and both outer limits equal $L,$ then $\\lim_{x \\to c}f(x)$ exists and is equal to $L.$'),
    { category: 'Guideline', title: 'A Strategy for Finding Limits', body: '1. Learn which limits can be evaluated by direct substitution. 2. Otherwise find a function that agrees at all but one point. 3. Use a graph to reinforce your conclusion.', pageNumber: 85 },
  ];
  const bQuiz = S.quizEngine.generateQuiz('The limit of a polynomial is found by direct substitution.', { mode: 'book', didacticBlocks: BLOCKS, maxQuestions: 12 });
  const fQs = bQuiz.filter((q) => q.badge === 'Formula');
  check('block quiz: 8+ questions from four theorems, every question sound', bQuiz.length >= 8 && bQuiz.every(optsOk), `${bQuiz.length}: ${bQuiz.map((q) => q.badge).join(',')}`);
  check('block quiz: formula completion pits formula against formula', fQs.length >= 2 && fQs.every((q) => /= ________$/.test(q.question) && q.options.every((o) => /^\$[^$]+\$$/.test(o) && S.mathText.isBalanced(o))), fQs.map((q) => q.options.join(' ; ')).join(' | '));
  const which = bQuiz.filter((q) => /^Which theorem/.test(q.question));
  check('block quiz: theorem <-> statement / formula matching uses theorem titles only', which.length >= 2 && which.every((q) => q.options.every((o) => /^Theorem 1\.\d/.test(o))), which.map((q) => q.options.join(' ; ')).join(' | '));
  check('block quiz: which-property, true/false and step-recall items', bQuiz.some((q) => q.type === 'true_false' && /^True or False \(/.test(q.question)) && bQuiz.some((q) => q.type === 'reveal' && /^1\. Learn[^\n]+\n2\. /.test(q.answer)) &&
    S.blockQuiz.build(BLOCKS, { maxQuestions: 30 }).some((q) => /which property/.test(q.question) && q.options.includes('Product')));
  const chain = S.blockQuiz.splitEq('\\lim_{x \\to c}r(x) = r(c) = \\frac{p(c)}{q(c)}.');
  check('block quiz: formulas split only at a top-level "=" (chains ask for the final form)', chain && chain.lhs === '\\lim_{x \\to c}r(x)' && chain.rhs === '\\frac{p(c)}{q(c)}' && S.blockQuiz.splitEq('\\frac{a=b}{c}') === null);
  const worked = 'Limits describe the behavior of a function near a point. $\\lim_{x \\to 2}(4x^{2} + 3) = \\lim_{x \\to 2}4x^{2} + \\lim_{x \\to 2}3$ Property 2, Theorem 1.2 $= 19$ Simplify. An expression such as $0/0$ is called an **indeterminate form** because you cannot determine the limit from the form alone. The **like factors** remark is desirable quality filler.';
  const bSum = S.summarizer.summarizeText(worked, { didacticBlocks: BLOCKS });
  check('book summary: derivation lines dropped, definitions[] mined, emphasised + named terms first', !bSum.sentences.some((s) => /Simplify\.|Property 2/.test(s)) && bSum.definitions[0].term === 'Indeterminate form' &&
    bSum.keyTerms[0] === 'Indeterminate form' && bSum.keyTerms.includes('Squeeze Theorem'), JSON.stringify([bSum.sentences, bSum.keyTerms, bSum.definitions]));

  if (IS_NODE) {
    console.log(failures ? `\n${failures} STEM fixture(s) FAILED` : '\nAll STEM fixtures passed');
    process.exitCode = failures ? 1 : 0;
  }
})(typeof window !== 'undefined' ? window : globalThis);

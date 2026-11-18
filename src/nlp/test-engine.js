/**
 * Practice Test / Exam Generator (PDFStudy.testEngine) — ratified contract (#9/#13 on the swarm board).
 * generateTest(input, { maxQuestions, mode, didacticBlocks, sections, scopeTitle, seedOffset,
 *                       quizCount, quizSeed, excludeSources, cards })
 *   -> { title, sections: [{ name, questions }], questions, total, skills }
 *   quizCount / quizSeed  the quiz the app shows for the same scope (default 10 questions, seedOffset)
 *   excludeSources        flagged sources, as for quizEngine.generateQuiz
 *   cards                 the flashcards the app shows for the scope, as for quizEngine.generateQuiz
 *   lines                 extraction's scope.lines, so a question from running text knows its page
 * Questions share the quizEngine shape plus `skill` ('formula'|'theorem'|'definition'|'complexity'|'recall'),
 * `section`, `pageNumber`. Every question comes from quizEngine.generateQuiz, drawn as the test variant
 * (see TEST_VARIANT below) and refusing the facts the quiz asks: another fact about the same subject is fine.
 * Keyed questions (choice, True/False, typed) are drawn first: the sections' own, then, when those run out, a
 * "Review" section that asks quiz facts again, each in another form than the quiz used (a True/False where the
 * quiz had a choice), with `review: true` and a "Review" badge so the student knows it is a second look. Only
 * then do self-graded recall questions (a card's front shown, its back revealed) fill the slots left, the
 * sections' own first, then quiz facts recalled in another form; when the test must be cut down, recall
 * questions go before choice ones.
 * gradeTest(test, answers) scores it ('got' / 'missed' for a self-graded question).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qe = () => dep('quizEngine', './quiz-engine.js');
  const mt = () => dep('mathText', './math-text.js');

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  // The quiz of the same scope runs at the user's seed with variant 0. The test must not be that quiz
  // again: it is built after the quiz of the same scope and refuses every fact the quiz asks (same
  // subject + predicate, same source, or the same content words), so it covers other facts, and when the
  // scope has no more facts the test is shorter rather than a re-run. It also draws with its own seed and
  // with variant 1, which leads with other forms and families.
  const TEST_SEED_SHIFT = 7;
  const REVIEW_SEED_SHIFT = 13;
  const TEST_VARIANT = 1;
  const DEFAULT_QUIZ_LENGTH = 10;
  const REVIEW_SECTION = 'Review';
  const SPARE = 4;
  // A typed question has no options but is checked by the app (typed-check.js): it is not self-graded.
  const isSelfGraded = (q) => q.type === 'reveal' || (q.type !== 'typed' && (!Array.isArray(q.options) || q.options.length < 2));

  /** The quiz the app shows for this scope (its length and seed, when the caller says them). */
  function scopeQuiz(input, opts) {
    const { mode = 'book', didacticBlocks = [], seedOffset = 0, excludeSources, cards, lines } = opts;
    return qe().generateQuiz(input, {
      maxQuestions: opts.quizCount || DEFAULT_QUIZ_LENGTH,
      mode,
      didacticBlocks,
      seedOffset: Number.isFinite(opts.quizSeed) ? opts.quizSeed : seedOffset,
      excludeSources,
      cards,
      lines,
    });
  }

  /**
   * avoid: the questions asked already (the quiz, and the sections built before this one). maxSelfGraded: how many
   * recall questions the section may hold (0 while the keyed rounds run; the room left when recall tops it up).
   */
  function buildSection(name, input, opts, budget, avoid, maxSelfGraded) {
    const { mode = 'book', didacticBlocks = [], seedOffset = 0, excludeSources, cards, lines } = opts;
    const questions = qe().generateQuiz(input, {
      maxQuestions: budget,
      mode,
      didacticBlocks,
      seedOffset: seedOffset + TEST_SEED_SHIFT,
      variant: TEST_VARIANT,
      excludeSources,
      avoid,
      cards,
      lines,
      ...(Number.isFinite(maxSelfGraded) ? { maxSelfGraded } : {}),
    });
    return { name, questions: questions.map((q) => ({ skill: 'definition', ...q, section: name })) };
  }

  /**
   * Quiz facts asked once more, each in another form than the quiz asked it. avoid: the test so far (no
   * repeat inside the test); reviewOf: the quiz (a question whose fact the quiz asked must differ in type).
   */
  function buildReview(input, opts, budget, testSoFar, quiz, maxSelfGraded) {
    const { mode = 'book', didacticBlocks = [], seedOffset = 0, excludeSources, cards, lines } = opts;
    const questions = qe().generateQuiz(input, {
      maxQuestions: budget,
      mode,
      didacticBlocks,
      seedOffset: seedOffset + REVIEW_SEED_SHIFT,
      variant: TEST_VARIANT,
      excludeSources,
      avoid: testSoFar,
      reviewOf: quiz,
      maxSelfGraded,
      cards,
      lines,
    });
    const badge = (q) => `Review · ${String(q.badge || (isSelfGraded(q) ? 'Recall' : 'Question')).replace(/^Multiple Choice\s*[•·]\s*/, '')}`;
    return { name: REVIEW_SECTION, questions: questions.map((q) => ({ skill: 'definition', ...q, badge: badge(q), review: true, section: REVIEW_SECTION })) };
  }

  /** Round-robin by skill so a test mixes formulas, theorems, definitions and complexity items. */
  function interleave(questions) {
    const groups = new Map();
    for (const q of questions) {
      if (!groups.has(q.skill)) groups.set(q.skill, []);
      groups.get(q.skill).push(q);
    }
    const lists = [...groups.values()];
    const out = [];
    for (let i = 0; out.length < questions.length; i++) lists.forEach((l) => l[i] && out.push(l[i]));
    return out;
  }

  /** A section's own cards: the cards whose answer its text prints (all of them for a one-section test). */
  function sectionCards(cards, input, single) {
    if (!Array.isArray(cards) || single) return cards;
    // A section of a deck (or of mind-map pages) is a list of slides: its text is their titles and lines.
    const text = Array.isArray(input) ? input.map((s) => [s.title, ...(s.bullets || [])].join(' ')).join(' ') : input;
    const flat = norm(text);
    // A rule card's back is written out by the card (a law with its number and page): the text it quotes, or
    // the notation it states, is what the section prints.
    const printed = (c) => (c.rule ? c.quote || c.rule.lhsTex || c.back : c.back);
    return cards.filter((c) => flat.includes(norm(printed(c)).slice(0, 40)));
  }

  /**
   * Brings the sections down to maxQuestions: self-graded questions go first (the last one of the section that
   * holds the most), so a choice question is never cut while a recall question stays; then every section is
   * trimmed in proportion to its size.
   */
  function trimTo(built, maxQuestions) {
    let over = built.reduce((n, s) => n + s.questions.length, 0) - maxQuestions;
    while (over > 0) {
      const counts = built.map((s) => s.questions.filter(isSelfGraded).length);
      const most = counts.indexOf(Math.max(...counts));
      if (counts[most] === 0) break;
      const qs = built[most].questions;
      const last = qs.map(isSelfGraded).lastIndexOf(true);
      built[most].questions = [...qs.slice(0, last), ...qs.slice(last + 1)];
      over--;
    }
    const total = built.reduce((n, s) => n + s.questions.length, 0);
    const share = Math.min(1, maxQuestions / Math.max(1, total));
    for (const s of built) s.questions = s.questions.slice(0, Math.max(1, Math.round(s.questions.length * share)));
  }

  function generateTest(input, options = {}) {
    const { maxQuestions = 20, scopeTitle = 'Practice Test', sections } = options;
    const specs = Array.isArray(sections) && sections.length
      ? sections.map((s, i) => ({ name: s.name || s.title || `Section ${i + 1}`, input: s.text || s.input || '', blocks: s.didacticBlocks }))
      : [{ name: scopeTitle, input, blocks: options.didacticBlocks }];
    const per = Math.max(4, Math.ceil(maxQuestions / specs.length));
    const seen = new Set();
    // Sections are built in turn, each refusing what the quiz and the earlier sections asked.
    const quiz = scopeQuiz(input, options);
    const asked = [...quiz];
    // One gate over the whole test: sections and the review round are drawn apart, so a question one of them
    // keeps may repeat another's answer, options or fact; the test as a whole asks each once.
    const gate = dep('quizAssembly', './quiz-assembly.js').createSet(Infinity, {});
    const keep = (q) => {
      const key = norm(q.question) + '|' + norm(q.answer);
      if (seen.has(key) || (!isSelfGraded(q) && q.type !== 'typed' && q.options.length < 2)) return false;
      if (!gate.accept(q)) return false;
      seen.add(key);
      return true;
    };
    const sectionOpts = specs.map((s) => ({ ...options, cards: sectionCards(options.cards, s.input, specs.length === 1), didacticBlocks: s.blocks || [] }));
    const count = () => built.reduce((n, s) => n + s.questions.length, 0);
    // Keyed questions come first, recall only fills what they leave (the slots a scope with few facts has):
    //   1. each section's choice and typed questions;
    //   2. quiz facts asked again in another keyed form ("Review"), when the sections ran out of them;
    //   3. recall questions of each section;
    //   4. quiz facts recalled in another form.
    const built = specs.map((s, i) => {
      const sec = buildSection(s.name, s.input, sectionOpts[i], per, [...asked], 0);
      asked.push(...sec.questions);
      sec.questions = interleave(sec.questions).filter(keep);
      return sec;
    });
    trimTo(built, maxQuestions);
    const review = { name: REVIEW_SECTION, questions: [] };
    // The test's own gate may still refuse a few of a round's questions (a True too many, an option set seen),
    // so each round draws SPARE more than the room it fills; trimTo cuts what runs over.
    const roomLeft = () => maxQuestions - count() - review.questions.length;
    const addReview = (maxSelfGraded) => {
      const room = roomLeft();
      if (room <= 0) return;
      const more = buildReview(input, options, room + SPARE, [...built.flatMap((s) => s.questions), ...review.questions], quiz, maxSelfGraded === null ? room + SPARE : maxSelfGraded);
      for (const q of more.questions) if (roomLeft() > 0 && keep(q)) review.questions.push(q);
    };
    addReview(0);
    specs.forEach((s, i) => {
      const room = roomLeft();
      if (room <= 0) return;
      const sec = buildSection(s.name, s.input, sectionOpts[i], room + SPARE, [...asked, ...review.questions], room + SPARE);
      asked.push(...sec.questions);
      for (const q of sec.questions) if (roomLeft() > 0 && keep(q)) built[i].questions.push(q);
    });
    addReview(null);
    if (review.questions.length) built.push(review);
    // Trim to maxQuestions, then number questions t-1..t-N across the whole test.
    trimTo(built, maxQuestions);
    let n = 0;
    for (const s of built) s.questions = s.questions.map((q) => ({ ...q, id: `t-${++n}` }));
    const sectionsOut = built.filter((s) => s.questions.length);
    const questions = sectionsOut.flatMap((s) => s.questions).slice(0, maxQuestions);
    const skills = questions.reduce((m, q) => ({ ...m, [q.skill]: (m[q.skill] || 0) + 1 }), {});
    return { title: scopeTitle, sections: sectionsOut, questions, total: questions.length, skills };
  }

  /** A typed answer: the text, or { typed, override } when the student marked a rejected answer as right. */
  function typedRight(q, given) {
    if (given && typeof given === 'object') return Boolean(given.override) || typedRight(q, given.typed);
    const tc = dep('typedCheck', './typed-check.js');
    return Boolean(tc) && tc.check(q, given).correct;
  }

  /** answers: { [questionId]: chosenOptionString | typedText | 'got' | 'missed' } or an array aligned with test.questions. */
  function gradeTest(test, answers = {}) {
    const qs = (test && (test.questions || (test.sections || []).flatMap((s) => s.questions))) || [];
    const bySkill = {};
    const bySection = {};
    const missed = [];
    let score = 0;
    const same = (a, b) => (mt().isFormula(a) ? mt().formulaKey(a) === mt().formulaKey(b) : norm(a) === norm(b));
    qs.forEach((q, i) => {
      const given = Array.isArray(answers) ? answers[i] : answers[q.id];
      const answered = given !== undefined && given !== null;
      const ok = answered && (isSelfGraded(q) ? given === 'got' : q.type === 'typed' ? typedRight(q, given) : same(given, q.answer));
      for (const [map, key] of [[bySkill, q.skill || 'definition'], [bySection, q.section || 'Test']]) {
        map[key] = map[key] || { correct: 0, total: 0 };
        map[key].total++;
        if (ok) map[key].correct++;
      }
      if (ok) score++;
      else missed.push({ id: q.id, question: q.question, answer: q.answer, given: given ?? null, explanation: q.explanation, skill: q.skill, pageNumber: q.pageNumber || null });
    });
    const total = qs.length;
    return { score, total, percent: total ? Math.round((score / total) * 100) : 0, bySkill, bySection, missed };
  }

  const api = { generateTest, generatePracticeTest: generateTest, gradeTest };
  PDFStudy.testEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

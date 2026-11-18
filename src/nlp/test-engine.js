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
 * Like the quiz, it asks self-graded recall questions (a card's front shown, its back revealed) in the slots
 * its choice questions leave; when it must be cut down, recall questions go before choice ones.
 * When the scope has no other facts left, a short "Review" section asks quiz facts again, each in another
 * form than the quiz used (a True/False where the quiz had a choice, a recall where it had a cloze), with
 * `review: true` and a "Review" badge so the student knows it is a second look.
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
  const isSelfGraded = (q) => q.type === 'reveal' || !Array.isArray(q.options) || q.options.length < 2;

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

  /** avoid: the questions asked already (the quiz, and the sections built before this one). */
  function buildSection(name, input, opts, budget, avoid) {
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
    return cards.filter((c) => flat.includes(norm(c.back).slice(0, 40)));
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
      if (seen.has(key) || (!isSelfGraded(q) && q.options.length < 2)) return false;
      if (!gate.accept(q)) return false;
      seen.add(key);
      return true;
    };
    const built = specs.map((s) => {
      const cards = sectionCards(options.cards, s.input, specs.length === 1);
      const sec = buildSection(s.name, s.input, { ...options, cards, didacticBlocks: s.blocks || [] }, per, [...asked]);
      asked.push(...sec.questions);
      sec.questions = interleave(sec.questions).filter(keep);
      return sec;
    });
    // Trim to maxQuestions, then number questions t-1..t-N across the whole test.
    trimTo(built, maxQuestions);
    const sofar = built.flatMap((s) => s.questions);
    if (sofar.length < maxQuestions) {
      const room = maxQuestions - sofar.length;
      const review = buildReview(input, options, room, sofar, quiz, room);
      review.questions = review.questions.filter(keep);
      built.push(review);
    }
    let n = 0;
    for (const s of built) s.questions = s.questions.map((q) => ({ ...q, id: `t-${++n}` }));
    const sectionsOut = built.filter((s) => s.questions.length);
    const questions = sectionsOut.flatMap((s) => s.questions).slice(0, maxQuestions);
    const skills = questions.reduce((m, q) => ({ ...m, [q.skill]: (m[q.skill] || 0) + 1 }), {});
    return { title: scopeTitle, sections: sectionsOut, questions, total: questions.length, skills };
  }

  /** answers: { [questionId]: chosenOptionString | 'got' | 'missed' } or an array aligned with test.questions. */
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
      const ok = answered && (isSelfGraded(q) ? given === 'got' : same(given, q.answer));
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

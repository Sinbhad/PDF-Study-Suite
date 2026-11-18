/**
 * Structured Gate: which of the questions that slide-quiz.js and block-quiz.js build may be asked, and in
 * what form. Those builders read a deck's definitions and lecture Q&A, or a book's theorem blocks; this
 * module only keeps or reshapes what they return:
 *   - a question with a link in it, a "define the term" prompt for something that is not a term or whose
 *     definition contains the term or points outside itself, or a reveal with no real answer is dropped
 *   - a question with filler or recognition debris in its stem or answer (quiz-content.js) is dropped
 *   - a lecture question that could only be revealed becomes multiple choice when the lecturer's answers
 *     to questions of the same kind ("How is X treated?" / "How is Y treated?") can stand beside it
 *   - every True/False they build keeps or swaps a sibling's part, and is tagged as such
 *
 * gate(built, { isTerm, counts, seedOffset }) -> questions
 *   isTerm(term)  the scope's own term test; counts: quizContent.wordCounts of the whole scope
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const content = () => dep('quizContent', './quiz-content.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const os = () => dep('optionSets', './option-sets.js');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const URL_RE = /https?:\/\/|www\.[a-z]/i;
  const MIN_REVEAL_ANSWER_CHARS = 12;

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** slide-quiz and block-quiz build every True/False by keeping or swapping a sibling's part. */
  function tagSwap(q) {
    const swapped = q.type === 'true_false' && (q.options || []).join('|') === 'True|False';
    return swapped ? { ...q, construction: 'sibling_swap' } : q;
  }

  /**
   * A structured question is dropped when its answer is a link, when a "define the term" prompt names
   * something that is not a term ("Lameness is the 3rd most"), or when a self-graded lecture question
   * has no real answer to reveal.
   */
  function isSound(q, acceptTerm) {
    if (URL_RE.test(String(q.answer)) || URL_RE.test(String(q.question))) return false;
    if (q.type !== 'reveal') return true;
    const answer = String(q.answer || '').trim();
    if (answer.length < MIN_REVEAL_ANSWER_CHARS || /\?\s*$/.test(answer)) return false;
    if (q.badge !== 'Define the Term') return true;
    const term = (String(q.question).match(/"([^"]+)"/) || [])[1];
    return Boolean(term) && acceptTerm(term);
  }

  /**
   * Filler or recognition debris in the stem or answer, or a "define the term" prompt whose definition
   * contains the term itself or points outside itself ("Hemorrhage and edema are a space-occupying lesion").
   */
  function isFiller(q, counts) {
    const C = content();
    const first = String(q.question || '').split('\n')[0];
    const body = String(q.question || '').slice(first.length);
    const answer = Array.isArray(q.answer) ? q.answer.join(' ') : String(q.answer || '');
    if (C.isFillerText(body || first) || (q.type !== 'true_false' && C.isFillerText(answer))) return true;
    if (C.isGarbled(`${body} ${answer}`, counts)) return true;
    if (q.badge !== 'Define the Term') return false;
    const term = (first.match(/"([^"]+)"/) || [])[1] || '';
    return !qf().isStandalone(answer) || Boolean(term && new RegExp(`\\b${escapeRe(term)}`, 'i').test(answer));
  }

  /**
   * A lecture question that slide-quiz.js could only ask as "reveal the answer" becomes multiple choice
   * when the lecturer's answers to other questions of the same kind can stand beside its own answer:
   * nearest slides first, comparable length.
   */
  function withLectureChoices(questions, seedOffset) {
    const isLecture = (q) => q.badge === 'Lecture Question' && q.type !== 'true_false';
    const oneLine = (q) => qf().isStandalone(String(q.answer || ''));
    // An answer that repeats a word of its own question would be picked for that word alone.
    const echoes = (q) => {
      const asked = new Set(qf().contentStems(String(q.question).split('\n')[0]));
      return qf().contentStems(q.answer).some((w) => asked.has(w));
    };
    const answered = questions.filter((q) => isLecture(q) && oneLine(q));
    // Only the answer to a question of the same kind ("How is X treated?" beside "How is Y treated?") is
    // the same kind of thing; the answer to any other lecture question would be a give-away.
    const frame = dep('factQuestions', './fact-questions.js').sameFrame;
    const distance = (a, q) => Math.abs((a.page || 0) - (q.page || 0));
    return questions.map((q) => {
      if (!isLecture(q) || q.type !== 'reveal' || !oneLine(q) || echoes(q)) return q;
      const others = answered.filter((o) => o !== q && frame(q.question, o.question)).sort((a, b) => distance(a, q) - distance(b, q));
      const set = os().statementSet(q.answer, others.map((o) => o.answer));
      if (!set) return q;
      return { ...q, type: 'multiple_choice', answer: set.answer, options: shuffle([set.answer, ...set.distractors], q.question, seedOffset) };
    });
  }

  function gate(built, ctx) {
    const kept = (built || []).filter((q) => isSound(q, ctx.isTerm) && !isFiller(q, ctx.counts));
    return withLectureChoices(kept, ctx.seedOffset).map(tagSwap);
  }

  const api = { gate, isSound, isFiller, withLectureChoices, tagSwap };
  PDFStudy.structuredGate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

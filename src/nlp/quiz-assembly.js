/**
 * Quiz Assembly: decides which candidate questions go into one quiz or practice test.
 * The builders propose; this module refuses a question when the set already
 *   - asks the same question in the same words, or for the same answer (a term or formula asked twice),
 *   - offers the same options (each answer would rule itself out of the next question), or
 *   - tests the same fact (stem + answer share most of their content words with an earlier question, or
 *     both carry the same `sourceKey`, the sentence they were cut from).
 * A True/False whose answer is True is only kept while the set holds more Falses than Trues: True and False
 * stay balanced, and a lone copied True would teach "sounds like the book, so True".
 *
 * A question whose fact was asked elsewhere (opts.avoid: the quiz, when the practice test is built), that
 * offers the same options as a question there, or whose source the student flagged (opts.excludeSources)
 * is refused as well. A review set (opts.reviewOf)
 * may repeat a fact of those questions, but only in another question type.
 *
 * createSet(max, opts) -> { accept(q), refusal(q), asked(answer), allowSelfGraded(n), graded(), isFull(), size(), list() }
 * fill(set, families, pattern)   families: { key: () => boolean }, each given a turn in `pattern` order
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');

  const SAME_FACT_JACCARD = 0.7;
  const SAME_FACT_CONTAINMENT = 0.85;
  const MIN_FACT_WORDS = 4;
  const SHORT_ANSWER_WORDS = 8; // longer answers are statements; those are compared as facts instead
  const MAX_TRUE_FALSE_SHARE = 0.4; // 4 of 10, 8 of 20

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // A typed question (typed-questions.js) has no options but is checked by the app: it is not self-graded.
  const isTyped = (q) => q.type === 'typed';
  const isSelfGraded = (q) => q.type === 'reveal' || (!isTyped(q) && (!q.options || q.options.length < 2));
  const CHOICE_OPTIONS = 4;
  const isChoice = (q) => !isSelfGraded(q) && !isTyped(q) && q.type !== 'true_false';
  const isSwap = (q, answer) => q.type === 'true_false' && q.construction === 'sibling_swap' && q.answer === answer;
  const isTrueFalse = (q, answer) => q.type === 'true_false' && q.answer === answer;

  /** The statement a student reads: the quoted part, or what follows the template line. */
  function stemBody(q) {
    const text = String(q.question || '');
    const quoted = text.match(/\n"([\s\S]*)"\s*$/);
    if (quoted) return quoted[1];
    const nl = text.indexOf('\n');
    return nl >= 0 ? text.slice(nl + 1) : text;
  }

  /** Content words of the fact a question tests: its stem with the blank filled in, plus a term answer. */
  function factWords(q) {
    const body = stemBody(q);
    const answer = q.type === 'true_false' ? '' : String(q.answer || '');
    const text = /_{4,}/.test(body) ? body.replace(/_{4,}/, answer) : `${body} ${answer}`;
    return new Set(qf().contentStems(text));
  }

  function sameFact(a, b) {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    if (small.size < MIN_FACT_WORDS) return false;
    let shared = 0;
    for (const w of small) if (large.has(w)) shared++;
    return shared / (small.size + large.size - shared) >= SAME_FACT_JACCARD || shared / small.size >= SAME_FACT_CONTAINMENT;
  }

  const MIN_SHORT_FACT_WORDS = 2;

  /** The smaller set has at least two words and nearly all of them are in the larger one. */
  function containedIn(a, b) {
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    if (small.size < MIN_SHORT_FACT_WORDS) return false;
    let shared = 0;
    for (const w of small) if (large.has(w)) shared++;
    return shared / small.size >= SAME_FACT_CONTAINMENT;
  }

  /** Key of a short answer ("tangent line" == "Tangent lines", "$O(n)$" == "O(n)"), or '' for a statement. */
  function answerKey(q) {
    const answer = String(q.answer || '');
    if (q.type === 'true_false' || q.type === 'reveal' || !answer) return '';
    if (mt().isFormula(answer)) return `f:${mt().formulaKey(answer)}`;
    if (answer.split(/\s+/).length > SHORT_ANSWER_WORDS) return '';
    return `t:${norm(answer).replace(/(?:es|s)\b/g, '')}`;
  }

  const optionKey = (q) => ((q.options || []).length >= 3 ? q.options.map(norm).sort().join(' | ') : '');

  // A lecture point offered again and again as the wrong one ("Any opportunistic bacteria can ...") becomes known as
  // the wrong one: a question about a point (q.pointOptions, fact-questions.js describe) may bring back at most one
  // option the set (or the questions it avoids) offered already. A glossary's definitions are fewer and recur by nature.
  const MIN_STATEMENT_OPTION_WORDS = 4;
  const MAX_REPEATED_OPTIONS = 1;
  const statementDistractors = (q) => (q.type === 'multiple_choice' && q.pointOptions ? (q.options || []) : [])
    .filter((o) => o !== q.answer && String(o).split(/\s+/).length >= MIN_STATEMENT_OPTION_WORDS).map(norm);

  /** A student's flag on this question's source: by key ('s…', studyKeys.sourceKey) or by the source text itself. */
  function isExcluded(q, excluded, sourceKey) {
    if (!excluded || !excluded.size) return false;
    if (sourceKey && excluded.has(sourceKey(q))) return true;
    return Boolean(q.source) && excluded.has(norm(q.source));
  }

  /**
   * opts: { avoid: questions asked elsewhere (their facts, sources and fact words are refused here too),
   *         excludeSources: Set of flagged source keys or texts, sourceKey: (q) => key,
   *         gradedOnly: refuse self-graded questions,
   *         selfGradedRoom: how many self-graded questions (type 'reveal') the set may hold; 0 while the
   *         choice questions are drawn, raised by allowSelfGraded(n) for the recall round }
   */
  function createSet(max, opts = {}) {
    const kept = [];
    const answers = new Set();
    const optionSets = new Set();
    const facts = [];
    const avoid = opts.avoid || [];
    const avoidFacts = new Set(avoid.map((q) => q.factKey).filter(Boolean));
    const avoidSources = new Set(avoid.map((q) => norm(q.source)).filter(Boolean));
    const avoidWords = avoid.map(factWords);
    // The same options again (another row of the same table column, the same statements reshuffled) show the
    // student what they have seen: refused like the same fact.
    const avoidOptions = new Set(avoid.map(optionKey).filter(Boolean));
    const offered = new Set(avoid.flatMap(statementDistractors));
    const sourceOf = (q) => norm(q.source || q.sourceKey);
    // A review set (opts.reviewOf) may ask those questions' facts again, but never in the form they were asked.
    const reviewOf = opts.reviewOf || [];
    const reviewWords = reviewOf.map((q) => ({ q, words: factWords(q) }));
    let selfGradedRoom = Number.isFinite(opts.selfGradedRoom) ? opts.selfGradedRoom : Infinity;

    /** Why the set refuses this question ('' when it does not): the reasons, for a maintainer's trace too. */
    function refusal(q) {
      if (!q) return 'none';
      if (kept.length >= max) return 'full';
      // A choice question offers four options: with three, one implausible option leaves a coin toss.
      // (Options are told apart as written: "$\overline{A}\overline{B}$" and "$\overline{A} + \overline{B}$" differ.)
      if (isChoice(q) && new Set(q.options.map((o) => String(o).replace(/\s+/g, ' ').trim().toLowerCase())).size < CHOICE_OPTIONS) return 'too few options';
      const aKey = answerKey(q);
      const oKey = optionKey(q);
      if (aKey && answers.has(aKey)) return 'same answer';
      if (oKey && optionSets.has(oKey)) return 'same options';
      if (statementDistractors(q).filter((o) => offered.has(o)).length > MAX_REPEATED_OPTIONS) return 'options offered before';
      if (kept.some((k) => norm(k.question) === norm(q.question))) return 'same question';
      // Two questions cut from one source sentence, or about one subject + predicate, test one fact,
      // however their wording differs.
      if (q.sourceKey && kept.some((k) => k.sourceKey === q.sourceKey)) return 'same source';
      // A typed question and any other question cut from the same card or sentence test one fact.
      if (sourceOf(q) && kept.some((k) => (isTyped(q) || isTyped(k)) && sourceOf(k) === sourceOf(q))) return 'same source';
      if (q.factKey && kept.some((k) => k.factKey === q.factKey)) return 'same fact';
      const words = factWords(q);
      if (facts.some((f) => sameFact(words, f))) return 'same fact words';
      // About one subject, even a short statement repeated with a word more is the same fact.
      if (q.subject && kept.some((k) => k.subject === q.subject && containedIn(words, factWords(k)))) return 'same subject fact';
      if (avoid.length) {
        if (q.factKey && avoidFacts.has(q.factKey)) return 'asked elsewhere';
        if (oKey && avoidOptions.has(oKey)) return 'options shown elsewhere';
        // A False that borrows a statement tests whether it belongs to this subject: its own fact key says
        // whether that was asked; the borrowed statement's source and words were shown in another role.
        const borrowed = isSwap(q, 'False') && /\|not\|/.test(q.factKey || '');
        if (!borrowed && sourceOf(q) && avoidSources.has(sourceOf(q))) return 'asked elsewhere';
        if (!borrowed && avoidWords.some((f) => sameFact(words, f))) return 'asked elsewhere (words)';
      }
      if (reviewOf.length) {
        const sameForm = (k) => k.type === q.type || norm(k.question) === norm(q.question);
        const twins = reviewWords.filter(({ q: k, words: w }) => (q.factKey && k.factKey === q.factKey) ||
          (sourceOf(q) && sourceOf(k) === sourceOf(q)) || sameFact(words, w));
        if (twins.some(({ q: k }) => sameForm(k))) return 'same form as before';
      }
      if (isExcluded(q, opts.excludeSources, opts.sourceKey)) return 'flagged source';
      if (isSelfGraded(q) && (opts.gradedOnly || kept.filter(isSelfGraded).length >= selfGradedRoom)) return 'self-graded';
      // True and False stay balanced: a True only joins a set that holds more Falses than Trues, so the set never
      // teaches "sounds like the book, so True".
      if (isTrueFalse(q, 'True') && kept.filter((k) => isTrueFalse(k, 'True')).length >= kept.filter((k) => isTrueFalse(k, 'False')).length) return 'more True than False';
      // A set of mostly True/False asks little: they fill at most this share of a set of known length.
      if (q.type === 'true_false' && Number.isFinite(max) && kept.filter((k) => k.type === 'true_false').length >= Math.ceil(max * MAX_TRUE_FALSE_SHARE)) return 'enough True/False';
      return '';
    }

    function accept(q) {
      if (refusal(q)) return false;
      kept.push(q);
      if (answerKey(q)) answers.add(answerKey(q));
      if (optionKey(q)) optionSets.add(optionKey(q));
      for (const o of statementDistractors(q)) offered.add(o);
      facts.push(factWords(q));
      return true;
    }

    /** Has a question with this short answer already been kept? */
    const asked = (answer) => answers.has(answerKey({ answer }));

    const allowSelfGraded = (n) => {
      selfGradedRoom = n;
    };
    const graded = () => kept.filter((q) => !isSelfGraded(q)).length;
    return { accept, refusal, asked, allowSelfGraded, graded, isFull: () => kept.length >= max, size: () => kept.length, list: () => [...kept] };
  }

  /** A family that offers the questions of a ready-made list in order. */
  function listFamily(set, questions) {
    const queue = [...questions];
    return () => {
      while (queue.length) {
        if (set.accept(queue.shift())) return true;
      }
      return false;
    };
  }

  /**
   * Gives each family a turn in pattern order until the set is full or every family has run dry.
   * A family is a function that places its next acceptable question in the set and returns true, or
   * returns false when it has none left; a refused candidate therefore never costs the family its turn.
   */
  function fill(set, families, pattern) {
    const turns = pattern.filter((key) => typeof families[key] === 'function');
    const dry = new Set();
    for (let i = 0; turns.length && !set.isFull() && dry.size < new Set(turns).size; i++) {
      const key = turns[i % turns.length];
      if (!dry.has(key) && !families[key]()) dry.add(key);
    }
    return set;
  }

  const api = { createSet, listFamily, fill, sameFact, factWords, answerKey, isSelfGraded, isTyped };
  PDFStudy.quizAssembly = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

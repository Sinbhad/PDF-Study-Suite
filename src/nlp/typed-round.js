/**
 * Typed Round: after the choice families of quiz-engine.js have run dry, the slots left are offered to typed
 * questions (an answer the student types and the app checks) before anything is asked self-graded. The set
 * (quiz-assembly.js) still refuses a typed question whose fact, source or answer a choice question already took.
 *
 * fill(set, parts)
 *   parts: { scope (quizScope.gather), ctx (quiz-engine's sentence context), placed(q, sentence), ruleCards,
 *            factOf(source), seed, variant }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Typed worked answers join the choice ones; together they stay a minority of the set (quiz-engine MAX_WORKED_SHARE).
  const MAX_TYPED_WORKED = 2;
  // Definitions and table cells first (they replace the self-graded "Define" and table recalls), then sentences.
  const TURNS = ['defined', 'table', 'cloze', 'number', 'worked', 'defined', 'cloze'];

  function fill(set, parts) {
    const assembly = dep('quizAssembly', './quiz-assembly.js');
    const terms = dep('typedQuestions', './typed-questions.js');
    const values = dep('typedValues', './typed-values.js');
    if (!terms || !values || set.isFull()) return set;
    const { scope, ctx, placed } = parts;
    const subjects = dep('quizSubjects', './quiz-subjects.js');
    const specific = (s) => Boolean(subjects && subjects.specificOf(s, scope.ctx || {}));

    let clozeAt = 0;
    const nextCloze = () => {
      while (clozeAt < ctx.sentences.length) {
        const sentence = ctx.sentences[clozeAt++];
        if (set.accept(placed(terms.forSentence(sentence, ctx), sentence))) return true;
      }
      return false;
    };
    let workedTaken = 0;
    const nextWorked = assembly.listFamily(set, values.worked(parts.ruleCards || [], { seed: parts.seed, variant: parts.variant }));
    return assembly.fill(set, {
      defined: assembly.listFamily(set, terms.candidates(scope, ctx)),
      table: assembly.listFamily(set, values.tables(scope.allCards, { factOf: parts.factOf })),
      cloze: nextCloze,
      number: assembly.listFamily(set, values.numbers(scope.allCards, { specific, isDeck: scope.isDeck })),
      worked: () => workedTaken < MAX_TYPED_WORKED && nextWorked() && ++workedTaken > 0,
    }, TURNS);
  }

  const api = { fill };
  PDFStudy.typedRound = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

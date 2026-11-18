/**
 * Naming True/False: a sentence that introduces a term by name ("A set with one element is called a
 * singleton set", "A latch is a storage element that ...") is shown as written (True) or with a sibling
 * term standing where the named one stood (False). Only the sentence that defines a term is used: there a
 * swapped term makes the statement false, whereas in a passing mention it might still be true.
 * The sibling is another marked term of the same number and shape (option-sets.termSet), an "a"/"an"
 * before it is made to agree, and the explanation names the term that was swapped out. A term the scope calls
 * a kind of the named one (quiz-kinds.js) is never swapped in: the statement could stay true.
 *
 * forSentence(sentence, ctx, isTrue) -> question | null      ctx: { terms (markedTerms.collect), seed, forms, kinds }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');
  const tok = () => dep('tokenizer', './tokenizer.js');
  const os = () => dep('optionSets', './option-sets.js');
  const marked = () => dep('markedTerms', './marked-terms.js');
  const sentenceTerms = () => dep('sentenceTerms', './sentence-terms.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');

  const MAX_STATEMENT_CHARS = 240;
  const VOWEL_SOUND_RE = /^(?:[aeiou]|hour|honest|honor|heir)/i;
  const CONSONANT_SOUND_RE = /^(?:uni|use|usu|eu|one|once)/i;

  /** "a"/"an" right before the swapped-in term, made to agree with it; the capital is kept. */
  function agreeArticle(before, term) {
    return before.replace(/\b([Aa])n?(\s+)$/, (all, a, space) => {
      const vowel = VOWEL_SOUND_RE.test(term) && !CONSONANT_SOUND_RE.test(term);
      return `${a}${vowel ? 'n' : ''}${space}`;
    });
  }

  // A swapped-in term must look like the same kind of thing: one head word ("composite key" / "foreign key"), or a
  // like ending and shape ("inverse" / "converse"). "Bounds error" called a "linear search" is false at a glance.
  const MIN_SWAP_TYPE_SCORE = 3;

  function forSentence(sentence, ctx, isTrue) {
    const clean = tok().cleanMarkdown(sentence);
    if (clean.length > MAX_STATEMENT_CHARS || sn().hasUnresolvedReference(clean)) return null;
    const namedHere = new Set(sentenceTerms().definedIn(clean).map((d) => os().termKey(d.term)));
    if (!namedHere.size) return null;
    const { text: masked, spans } = mt().mask(clean);
    const { present, absent } = marked().locate(masked, ctx.terms);

    for (const { term, hit } of present) {
      if (!namedHere.has(os().termKey(hit[0])) && !namedHere.has(os().termKey(term.text))) continue;
      const before = masked.slice(0, hit.index);
      const after = masked.slice(hit.index + hit[0].length);
      // Only a term of the same kind may stand in: "the delay, called a clocked sequential circuit" is
      // false for a reason the student need not know the subject to see.
      // A term the scope calls a kind of this one ("a latch is a storage element") could make the swap true.
      const sameKind = marked().nearest(absent, term, ctx.seed).map((t) => t.text)
        .filter((t) => subjects().typeScore(hit[0], t) >= MIN_SWAP_TYPE_SCORE && !(ctx.kinds && ctx.kinds.related(hit[0], t)));
      const set = os().termSet(hit[0], sameKind, {
        stem: `${before} ${after}`,
        position: before.trim() ? 'inside' : 'start',
        forms: ctx.forms,
        count: 1,
        min: 1,
      });
      if (!set) continue;
      const sibling = set.distractors[0];
      const statement = isTrue ? clean : mt().unmask(`${agreeArticle(before, sibling)}${sibling}${after}`, spans);
      return {
        type: 'true_false',
        badge: 'True / False',
        question: `True or False:\n"${statement}"`,
        options: ['True', 'False'],
        answer: isTrue ? 'True' : 'False',
        explanation: isTrue
          ? `True. Source statement: "${clean}"`
          : `False. The source names "${hit[0]}" here, not "${sibling}"; the term was swapped. Source statement: "${clean}"`,
        skill: 'definition',
        construction: 'sibling_swap',
      };
    }
    return null;
  }

  const api = { forSentence, agreeArticle };
  PDFStudy.namingQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

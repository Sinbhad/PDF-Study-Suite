/**
 * Cloze (fill-in-the-blank) Questions.
 * A blank only ever replaces a marked term (marked-terms.js): one the text defines, sets in bold, that
 * fronts a flashcard, or that the summariser lists as a key term. A bare keyphrase is never blanked.
 * What is left of the sentence must still be a question:
 *   - self-contained (stem-noise.hasUnresolvedReference) and at least MIN_CONTENT_WORDS content words long
 *   - a word of the answer may stay elsewhere in it only if every option repeats that word (option-sets.js)
 *   - a leading blank is followed by a finite verb ("________ is ..."), never a discourse word or bare verb
 *   - "a"/"an" before the blank becomes "a(n)"
 * Options are other marked terms, nearest in the document first, normalised by option-sets.js; never a term
 * the scope calls a kind of the answer (quiz-kinds.js), which could complete the sentence as well.
 *
 * forSentence(sentence, ctx) -> question | null
 *   ctx: { terms (markedTerms.collect), seed, variant, forms, kinds (quizKinds.index), skip: (termText) => boolean }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');
  const tok = () => dep('tokenizer', './tokenizer.js');
  const os = () => dep('optionSets', './option-sets.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const marked = () => dep('markedTerms', './marked-terms.js');
  const kinds = () => dep('termKinds', './term-kinds.js');
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const BLANK = '________';
  const MIN_CONTENT_WORDS = 6;
  const MAX_TERM_SHARE = 0.4; // of the sentence's length
  const MATH_TOKEN_RE = /⟦M\d+⟧/g;

  // After a blank that opens the statement, only a finite verb keeps it a sentence.
  const VERB_AFTER_LEADING_BLANK_RE =
    /^(?:is|are|was|were|has|have|can|may|must|will|does|do|refers|means|denotes|describes|states|occurs|consists|measures|represents|determines|requires|contains|produces|converts|stores|controls)\b/i;
  // A blank right after one of these would cut a named compound in two ("partial ________").
  const COMPOUND_LEAD_RE =
    /\b(?:partial|nth|first|second|third|infinite|finite|definite|indefinite|improper|geometric|taylor|maclaurin|power|alternating|riemann|one-sided|local|global)\s+$/i;
  const SINGULAR_BEFORE = new Set(['a', 'an', 'each', 'every', 'one']);
  const PLURAL_BEFORE = new Set(['many', 'several', 'both', 'few', 'two', 'three', 'four']);
  const SINGULAR_AFTER = new Set(['is', 'was', 'has', 'does']);
  const PLURAL_AFTER = new Set(['are', 'were', 'have', 'do']);

  // Words that are in every sentence and tell a student nothing about which term is missing.
  const WEAK_WORD_LIST = ('one two three four five six seven eight nine ten always never often usually sometimes ' +
    'almost nearly quite rather still already again every another several many much less least true false').split(' ');
  let weakStems = null;
  const isWeak = (wordStem) => {
    if (!weakStems) weakStems = new Set(WEAK_WORD_LIST.map(os().stem));
    return weakStems.has(wordStem);
  };

  /** What the words around the blank demand of whatever fills it: 'singular', 'plural' or null. */
  function demandedNumber(before, after) {
    const prev = (before.toLowerCase().match(/([a-z]+)\s+$/) || [])[1] || '';
    const next = (after.toLowerCase().match(/^\s+([a-z]+)/) || [])[1] || '';
    if (SINGULAR_BEFORE.has(prev) || SINGULAR_AFTER.has(next)) return 'singular';
    if (PLURAL_BEFORE.has(prev) || PLURAL_AFTER.has(next)) return 'plural';
    return null;
  }

  /** Distinct content words left in a stem, a formula counting as one; number and frequency words do not count. */
  function informativeWords(rest) {
    const distinct = new Set(qf().contentStems(rest).filter((w) => !isWeak(w)));
    return distinct.size + (rest.match(MATH_TOKEN_RE) || []).length;
  }

  /** The stem left after cutting the term out at `hit`, or null when it would not stand as a question. */
  function blankAt(masked, hit, term) {
    const before = masked.slice(0, hit.index);
    const after = masked.slice(hit.index + hit[0].length);
    if (COMPOUND_LEAD_RE.test(before)) return null;
    // "the ________–slave flip-flop": a blank joined to a word by a dash cuts a compound in two.
    if (/^[–—-]\w/.test(after) || /\w[–—-]$/.test(before)) return null;
    // A bold or key term followed directly by another content word is the front of a longer compound here.
    const next = after.match(/^\s+(⟦M\d+⟧|[a-z]{4,})\b/);
    if (term.rank > 0 && next && !tok().PHRASE_BREAK_WORDS.has(next[1])) return null;
    if (!before.trim() && !VERB_AFTER_LEADING_BLANK_RE.test(after.trim())) return null;
    const rest = `${before} ${after}`;
    if (informativeWords(rest) < MIN_CONTENT_WORDS) return null;
    return { before, after, rest };
  }

  // A sentence that names or defines its blank ("... devices called ________") admits one term; any other sentence
  // may hold for a sibling of the answer as well.
  const NAMING_STEM_RE = /\b(?:called|known\s+as|termed|named|refers?\s+to|(?:is|are)\s+defined|denoted)\b/i;
  const SAID_OF_SHARE = 0.5;
  const DEFINITION_GENUS_WORDS = 14;
  const words = (s) => String(s || '').replace(/\$[^$]*\$/g, ' ').split(/\s+/).filter(Boolean);
  const MIN_SAID_WORDS = 3;
  const headWord = (t) => os().lemma((String(t).toLowerCase().match(/[a-z]+/g) || []).pop() || '');

  /**
   * Would this wrong option make the sentence true as well? Yes when it is a sibling on the answer's head word
   * ("integrated circuits" beside "digital circuits") in a sentence that does not name its blank, or when another
   * sentence of the scope says most of this stem's predicate about the option itself.
   */
  function alsoCompletes(option, answer, stem, source, ctx) {
    if (!NAMING_STEM_RE.test(stem) && headWord(option) === headWord(answer)) return true;
    // The scope defines the option as a kind of the answer's head ("The conditional statement p → q is the
    // proposition ..." beside "compound propositions"): a general claim about the answer holds for it too.
    const own = (ctx.definitions || []).find((d) => os().termKey(d.term) === os().termKey(option));
    const genus = own ? words(own.statement).slice(0, DEFINITION_GENUS_WORDS).map((w) => os().lemma(w.toLowerCase().replace(/[^a-z]/g, ''))) : [];
    if (!NAMING_STEM_RE.test(stem) && genus.includes(headWord(answer))) return true;
    return saidOf(option, stem, source, ctx);
  }

  /**
   * Does another sentence of the scope say most of this stem's predicate about `option` itself? With ctx.sameMath (a
   * typed question, which has no options to compare) a stem's formulas count too: "The ____ of p and q, denoted by
   * $p \wedge q$" is not said of the disjunction by a sentence that writes $p \vee q$.
   */
  function saidOf(option, stem, source, ctx) {
    const want = new Set(qf().contentStems(stem));
    if (want.size < MIN_SAID_WORDS) return false;
    const re = new RegExp(`(?<![A-Za-z])${option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?![A-Za-z])`, 'i');
    const formulas = ctx.sameMath ? formulasOf(stem) : [];
    return (ctx.sentences || []).some((s) => s !== source && re.test(s) &&
      qf().contentStems(s).filter((w) => want.has(w)).length / want.size >= SAID_OF_SHARE &&
      formulas.every((f) => formulasOf(s).includes(f)));
  }
  const formulasOf = (text) => (mt().mask(String(text || '')).spans || []).map((sp) => String(sp && (sp.text || sp.raw || sp)).replace(/\s+/g, ''));

  // A law, theorem or rule names a statement, not a thing: offered beside "logic gates" it is the wrong category.
  const STATEMENT_HEAD_RE = /\b(?:laws?|theorems?|rules?|principles?|postulates?|axioms?|identit(?:y|ies)|lemmas?|corollar(?:y|ies))$/i;
  const isStatementName = (t) => STATEMENT_HEAD_RE.test(String(t).trim());
  const COMPLEMENT_RE = /\bcomplement|\bnegat|\binver[st]|\boverbar|\bprimed?\b/i;

  /**
   * The places a sentence may be blanked, in turn order: every marked term whose cut leaves a question standing.
   * -> { clean, spans, absent, list: [{ term, hit, cut }] } or null when the sentence cannot be completed at all.
   */
  function slots(sentence, ctx) {
    const clean = tok().cleanMarkdown(sentence);
    // "Ataxia, circling, seizures, etc. 'Old dog ...'": a list run into another line is no sentence to complete.
    if (sn().hasUnresolvedReference(clean) || /\betc\.\s+\S/.test(clean)) return null;
    const { text: masked, spans } = mt().mask(clean);
    // "X and Z are complemented ... to obtain X and Z": the same formula twice beside a complement lost its bars
    // in extraction, and the sentence now says nothing.
    const formulas = (spans || []).map((sp) => String(sp && (sp.text || sp.raw || sp)).replace(/\s+/g, ''));
    if (COMPLEMENT_RE.test(clean) && formulas.some((f, i) => f && formulas.indexOf(f) !== i)) return null;
    const { present, absent } = marked().locate(masked, ctx.terms);
    // The practice test (variant 1) starts from the next term, so a sentence holding two marked terms
    // is not blanked at the same place as in the quiz.
    const turn = present.length ? (ctx.variant || 0) % present.length : 0;
    const inTurn = [...present.slice(turn), ...present.slice(0, turn)];
    const list = [];
    for (const { term, hit } of inTurn) {
      if (hit[0].length < 3 || hit[0].length > clean.length * MAX_TERM_SHARE || (ctx.skip && ctx.skip(term.text))) continue;
      const cut = blankAt(masked, hit, term);
      if (!cut) continue;
      // "... is ________ to ...": the slot wants an adjective, and a noun answer there is a word cut from a phrase.
      if (kinds().slotWants(cut.before, cut.after) === 'adjective' && !dep('phraseShape', './phrase-shape.js').isAdjectival(hit[0])) continue;
      list.push({ term, hit, cut });
    }
    return { clean, spans, absent, list };
  }

  function forSentence(sentence, ctx) {
    const found = slots(sentence, ctx);
    if (!found) return null;
    const { clean, spans, absent } = found;
    for (const { term, hit, cut } of found.list) {
      // Every option must be the same kind of thing as the answer (term-kinds.js): one head noun or one genus in the
      // scope's definitions, or the category the stem itself names before the blank ("a timing device called ...").
      const category = kinds().stemCategory(cut.before);
      const answerKinds = kinds().kindsOf(hit[0], ctx.definitions);
      const ofKind = (t) => {
        const own = kinds().kindsOf(t, ctx.definitions);
        return [...own].some((k) => answerKinds.has(k)) || (Boolean(category) && own.has(category));
      };
      // A term the scope calls a kind of the answer ("candidate key" beside "primary key") may complete it as well.
      // "the ________ operator": a blank that modifies the next noun takes only terms the scope writes before that
      // noun ("conjunction operator"), never one that reads as nonsense there ("compound proposition operator").
      // A wrong option that repeats a word the stem already uses ("biconditional" in a list naming the biconditional
      // operator) is told apart by that word.
      const modified = (cut.after.match(/^\s+([a-z]{3,})\b/) || [])[1];
      const fitsBefore = (t) => !modified || tok().PHRASE_BREAK_WORDS.has(modified) || !ctx.text ||
        new RegExp(`(?<![A-Za-z])${escapeRe(t)}\\s+${modified}`, 'i').test(ctx.text);
      const stemWords = new Set(qf().contentStems(cut.rest));
      const answerWords = new Set(qf().contentStems(hit[0]));
      const echoesStem = (t) => qf().contentStems(t).some((w) => stemWords.has(w) && !answerWords.has(w));
      const others = marked().nearest(absent, term, ctx.seed).map((t) => t.text)
        .filter((t) => ofKind(t) && fitsBefore(t) && !echoesStem(t) && !(ctx.kinds && ctx.kinds.related(hit[0], t)) &&
          !alsoCompletes(t, hit[0], cut.rest, clean, ctx) && isStatementName(t) === isStatementName(hit[0]));
      const set = os().termSet(hit[0], others, {
        stem: cut.rest,
        position: cut.before.trim() ? 'inside' : 'start',
        number: demandedNumber(cut.before, cut.after),
        forms: ctx.forms,
      });
      if (!set) continue;
      const blanked = os().neutralArticle(mt().unmask(`${cut.before}${BLANK}${cut.after}`, spans));
      return {
        type: 'cloze',
        badge: 'Fill in the Blank',
        question: `Complete the statement:\n"${blanked}"`,
        options: shuffle([set.answer, ...set.distractors], blanked, ctx.seed),
        answer: set.answer,
        explanation: `Source statement: "${clean}"`,
        skill: 'definition',
      };
    }
    return null;
  }

  const api = { forSentence, slots, alsoCompletes, saidOf, informativeWords, demandedNumber, BLANK, NAMING_STEM_RE, MIN_CONTENT_WORDS };
  PDFStudy.clozeQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Fact Questions: three ways to ask one fact (quiz-facts.js), each with options of one kind.
 *   describe   subject -> statement   "Which statement defines "Entropy"?"     options = sibling statements
 *   name       statement -> subject   "Which term is defined as follows? ..."  options = sibling subjects
 *   trueFalse  the fact's statement under its own subject (True), or a sibling's statement under this
 *              subject (False); the explanation names the subject the statement really belongs to
 * Every wrong option must be false for the subject the question names (subject-claims.js): it comes from
 * another subject, the scope never says it about this one, and it is not a paraphrase of the answer.
 * Options name the same kind of thing (quiz-subjects.sameType). A builder returns null when the siblings
 * cannot supply such a set: no question beats a bad one.
 * A wrong option also may not name the subject it really belongs to (namesItsOwner), and a False may not set a
 * statement under a subject the scope calls a kind of its owner, or with a verb of the wrong number (fitsSubject).
 * ctx: { facts, seed, forms, claimed, claims, kinds } - every fact of the scope, the reshuffle seed,
 * optionSets.textForms(text), the subject keys already named in a True/False of this set (each such
 * question reports its own in `claims`), the subject-claims index and the quiz-kinds index of the scope.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const os = () => dep('optionSets', './option-sets.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);
  const borrowed = () => dep('borrowedStatements', './borrowed-statements.js');

  const NEAR_WINDOW = 6; // a reshuffle only reorders the nearest siblings, it never reaches for far ones
  const QA_FRAME_SHARE = 0.4; // two lecture questions this alike ask the same kind of thing

  const WORDING = {
    definition: {
      describe: (t) => `Which statement defines ${t}?`,
      name: 'Which term is defined as follows?',
      claim: (t) => `this statement defines ${t}`,
      wrong: (right, asked) => `This defines "${right}", not "${asked}".`,
      badge: 'Definition',
    },
    theorem: {
      describe: (t) => `Which statement correctly states ${t}?`,
      name: 'Which theorem states the following?',
      claim: (t) => `this is what ${t} states`,
      wrong: (right, asked) => `This is what "${right}" states, not "${asked}".`,
      badge: 'Theorem',
    },
    algorithm: {
      describe: (t) => `Which statement describes ${t}?`,
      name: 'Which algorithm or method is described here?',
      claim: (t) => `this statement describes ${t}`,
      wrong: (right, asked) => `This describes "${right}", not "${asked}".`,
      badge: 'Algorithm',
    },
    point: {
      describe: (t, n) => [`Which statement is true of ${t}?`, `Which statement about ${t} is correct?`, `Which statement applies to ${t}?`][n % 3],
      name: 'The following is true of which of these?',
      claim: (t) => `the following is true of ${t}`,
      wrong: (right, asked) => `This is true of "${right}", not of "${asked}".`,
      badge: 'Fact',
    },
    qa: { badge: 'Self-Check' },
  };

  /** A numbered result reads as a name ("Theorem 1.2 — ..."); anything else is quoted. */
  const named = (term) => (/^(?:Theorem|Lemma|Corollary|Proposition)\s+[A-Z0-9]/.test(term) ? term : `"${term}"`);
  const skillOf = (fact) => (fact.kind === 'theorem' ? 'theorem' : fact.kind === 'algorithm' ? 'complexity' : 'definition');
  // A context that only names the selected pages ("Pages 188-210") tells the student nothing: left out
  const PAGE_RANGE_RE = /^(?:pages?|slides?)\s+\d+(?:\s*[-–]\s*\d+)?$/i;
  const where = (fact) => (fact.context && !PAGE_RANGE_RE.test(String(fact.context).trim()) ? `${fact.term} (${fact.context})` : fact.term);
  const subjectOf = (f) => f.subject || f.term;
  /** Key of a statement in ctx.shown: case, spacing, markup and punctuation folded. */
  const shownKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * Siblings that may stand beside this fact: same kind of thing; for points the same kind of subject;
   * for a definition on a slide deck one of the same topic (a deck's definitions of vascular events and
   * of kinds of inflammation are not alternatives to each other).
   */
  function nearSiblings(fact, ctx) {
    const sameTopic = fact.kind === 'definition' && fact.topic && fact.page;
    // Points trade statements only between peers (subject-peers.js): entities of one kind, never two slide titles.
    const sameKind = (o) => (ctx.peers ? ctx.peers.peers(fact.subjectKey, o.subjectKey)
      : subjects().sameType(subjectOf(fact), subjectOf(o), fact.sourceKind, o.sourceKind));
    const sibs = qf().siblings(fact, ctx.facts).filter((o) => (fact.kind !== 'point' || sameKind(o)) && (!sameTopic || o.topic === fact.topic));
    if (!ctx.seed) return sibs;
    return [...shuffle(sibs.slice(0, NEAR_WINDOW), fact.id, ctx.seed), ...sibs.slice(NEAR_WINDOW)];
  }

  /** Is `other`'s statement a wrong answer about `fact`'s subject? Without a claims index only the subject differs. */
  const falseFor = (fact, other, ctx) => (ctx.claims ? ctx.claims.isFalseFor(fact, other) : other.subjectKey !== fact.subjectKey) &&
    !borrowed().inherited(fact, other, ctx);
  // The rules a borrowed statement must pass live in borrowed-statements.js.
  const namesItsOwner = (...a) => borrowed().namesItsOwner(...a);
  const fitsSubject = (...a) => borrowed().fitsSubject(...a);
  const partlySaid = (...a) => borrowed().partlySaid(...a);
  const isPredicate = (s) => borrowed().isPredicate(s);
  const agrees = (fact, s) => borrowed().agrees(fact, s);
  const kindOf = (...a) => borrowed().kindOf(...a);
  const sameAspectAs = (...a) => borrowed().sameAspect(...a);

  function base(fact, type, badge, question, options, answer, explanation) {
    return {
      type, badge, question, options, answer, explanation,
      skill: skillOf(fact), category: fact.category, page: fact.page, pageNumber: fact.page, factId: fact.id,
      subject: subjectOf(fact), source: fact.source || `${fact.term}: ${fact.statement}`, factKey: fact.identity,
    };
  }

  /** Two lecture questions that ask the same kind of thing ("How is X treated?" / "How is Y treated?"). */
  function sameFrame(a, b) {
    const first = (q) => String(q).toLowerCase().split(/\s+/).slice(0, 2).join(' ');
    if (first(a) !== first(b)) return false;
    const sa = new Set(qf().contentStems(a));
    const sb = new Set(qf().contentStems(b));
    const shared = [...sa].filter((w) => sb.has(w)).length;
    return shared / Math.max(1, Math.min(sa.size, sb.size)) >= QA_FRAME_SHARE;
  }

  /**
   * Something only the statement's own subject could own (fact-statements.isSpecificClaim); a long technical word
   * counts only when no other subject's material uses it ("supportive" is said of several diseases).
   */
  const isSpecific = (o, ctx) => dep('factStatements', './fact-statements.js').isSpecificClaim(o.statement,
    ctx.claims && ctx.claims.isDistinctive ? (word) => ctx.claims.isDistinctive(o.subjectKey, word) : null);

  /** subject -> statement */
  function describe(fact, ctx) {
    if (fact.selfNaming || fact.siblingOnly) return null;
    const termWords = new Set(qf().contentStems(fact.term));
    // A sibling statement that mentions this subject's own words would read as the answer.
    // A generic point ("Signs vary based on regions affected") may be true of the asked subject too: not offered.
    const specific = (o) => fact.kind !== 'point' || isSpecific(o, ctx);
    // Options of one grammatical shape: a bare predicate ("Are circuits that ...") beside full sentences, or a verb
    // of the wrong number for the subject, marks the odd one out.
    const sameShape = (o) => isPredicate(o.statement) === isPredicate(fact.statement) && (!isPredicate(o.statement) || agrees(fact, o.statement));
    // An identity line (what the subject is, from its own title slide) only faces identity lines: beside clinical
    // signs or etiology it is the one option that describes a thing (borrowed-statements.sameStanding).
    const sibs = nearSiblings(fact, ctx).filter((o) => falseFor(fact, o, ctx) && !namesItsOwner(fact, o, ctx) && !kindOf(fact, o, ctx) &&
      specific(o) && sameShape(o) && borrowed().sameStanding(fact, o, ctx) && borrowed().fairBeside(fact, o, ctx) && (fact.kind !== 'qa' || sameFrame(fact.term, o.term)));
    const others = sibs.map((o) => o.statement).filter((s) => !qf().contentStems(s).some((w) => termWords.has(w)));
    const set = os().statementSet(fact.statement, others);
    if (!set) return null;
    const wording = WORDING[fact.kind];
    // A subject with many points may be asked about more than once in a set; each time in other words.
    const asked = (ctx.described && ctx.described.get(fact.subjectKey)) || 0;
    const question = fact.kind === 'qa' ? fact.term : wording.describe(named(subjectOf(fact)), asked);
    const badge = fact.kind === 'qa' ? wording.badge : `Multiple Choice • ${wording.badge}`;
    return {
      ...base(fact, 'multiple_choice', badge, question, shuffle([set.answer, ...set.distractors], question, ctx.seed), set.answer, `${where(fact)}: ${fact.statement}`),
      pointOptions: fact.kind === 'point',
    };
  }

  /** statement -> subject. Every other subject offered must be one the scope does not say this of. */
  function name(fact, ctx) {
    if (fact.selfNaming || fact.siblingOnly || fact.kind === 'qa') return null;
    const strict = fact.kind === 'point';
    const candidates = nearSiblings(fact, ctx).filter((o) => (!ctx.claims ||
      ctx.claims.isFalseOf(o.subjectKey, subjectOf(o), fact.statement, strict)) && !kindOf(fact, o, ctx) && !borrowed().inherited(fact, o, ctx));
    const terms = [...new Map(candidates.map((o) => [o.subjectKey, subjectOf(o)])).values()];
    const set = os().termSet(subjectOf(fact), terms, { stem: fact.statement, position: 'list', forms: ctx.forms });
    if (!set) return null;
    const wording = WORDING[fact.kind];
    const question = `${wording.name}\n"${fact.statement}"`;
    return base(fact, 'multiple_choice', `Multiple Choice • ${wording.badge}`, question,
      shuffle([set.answer, ...set.distractors], question, ctx.seed), set.answer, `${where(fact)}: ${fact.statement}`);
  }

  /** Joins a subject with a bare predicate ("Digital circuits" + "Are hardware ..." -> "Digital circuits are hardware ..."). */
  const completePredicate = (subject, statement) => `${subject} ${String(statement || '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase())}`;

  /**
   * True: the fact's statement under its own subject. False: a sibling's statement under this subject,
   * only when the scope says nothing like it about this subject; the explanation names the sibling.
   */
  function trueFalse(fact, ctx, isTrue) {
    if (fact.selfNaming || fact.siblingOnly || fact.kind === 'qa') return null;
    const wording = WORDING[fact.kind];
    // A defined term that the set has already asked about is not named in a True/False as well: the
    // earlier question showed which statement defines it. A subject with many points may recur.
    const taken = (term) => fact.kind !== 'point' && Boolean(ctx.claimed) && ctx.claimed.has(subjects().subjectKey(term));
    if (taken(subjectOf(fact))) return null;
    const subjectWords = new Set(qf().contentStems(subjectOf(fact)));
    if (isTrue) {
      const question = isPredicate(fact.statement)
        ? `True or False:\n"${completePredicate(subjectOf(fact), fact.statement)}"`
        : `True or False: ${wording.claim(claimSubject(fact, fact, ctx))}.\n"${fact.statement}"`;
      return {
        ...base(fact, 'true_false', 'True / False', question, ['True', 'False'], 'True', `True. ${where(fact)}: ${fact.statement}`),
        construction: 'sibling_swap',
        claims: fact.subjectKey,
      };
    }
    // An honest False first: the fact's own statement with one committed detail changed (a number, a direction).
    const altered = alteredFalse(fact, ctx, wording);
    if (altered) return altered;
    // The borrowed statement must not name this subject, and must be false of it by the claims index, in every
    // clause ("Not metabolized, not distributed" is half true of a drug the scope calls unmetabolized). It comes
    // from a peer taught in the same aspect (subject-peers.js). A statement another question shows already is
    // not borrowed: shown twice, the second is a repeat. A borrowed point is only False when the scope contradicts it
    // for this subject (a line of its own under the same label, saying something else: borrowed-statements.js).
    const shown = ctx.shown || new Set();
    const specific = (o) => fact.kind !== 'point' || isSpecific(o, ctx);
    // A False needs a fact that contradicts it: the asked subject is taught in the borrowed statement's aspect, and
    // the asked fact itself sits in that aspect (its own statement there is what makes the borrowed one false).
    const sameAspect = (o) => fact.kind !== 'point' || !ctx.peers || (ctx.peers.fitsAspect(fact.subjectKey, o) && sameAspectAs(fact, o, ctx));
    // (For a point the contradiction is the test: its own line under the same label must say otherwise, and nothing
    // the scope says of it may say the borrowed statement; the claims index's label rule would refuse every such line.)
    const isFalse = (o) => (fact.kind === 'point'
      ? borrowed().contradicts(fact, o, ctx) && !borrowed().inherited(fact, o, ctx) && !(ctx.claims && ctx.claims.says(fact.subjectKey, o.statement))
      : falseFor(fact, o, ctx));
    const openerMatch = (s) => String(s || '').match(/^([A-Z][a-z]{5,})\s+(?:is|are|was|were|has|have|can|cannot|does|do)\b/);
    const swapsOpener = (o) => {
      const m = openerMatch(o.statement);
      return Boolean(m) && !qf().contentStems(m[1]).some((w) => subjectWords.has(w));
    };
    const donor = nearSiblings(fact, ctx).find((o) => !taken(subjectOf(o)) && !shown.has(shownKey(o.statement)) && specific(o) && isFalse(o) &&
      !qf().contentStems(o.statement).some((w) => subjectWords.has(w)) && !namesItsOwner(fact, o, ctx) && !swapsOpener(o) && fitsSubject(fact, o, ctx) &&
      sameAspect(o) && !partlySaid(fact, o, ctx));
    if (!donor) return null;
    const question = isPredicate(donor.statement)
      ? `True or False:\n"${completePredicate(subjectOf(fact), donor.statement)}"`
      : `True or False: ${wording.claim(claimSubject(fact, donor, ctx))}.\n"${donor.statement}"`;
    const explanation = `False. ${wording.wrong(subjectOf(donor), subjectOf(fact))} ${where(donor)}: ${donor.statement}`;
    return {
      ...base(fact, 'true_false', 'True / False', question, ['True', 'False'], 'False', explanation),
      // The fact tested is "this statement is not about this subject": its own identity, so a test may ask
      // it although the quiz showed the borrowed statement in another role.
      factKey: `${fact.subjectKey}|not|${donor.identity}`,
      source: donor.source || `${donor.term}: ${donor.statement}`,
      // The explanation quotes the borrowed statement, so the page link goes where that statement is printed.
      page: donor.page || fact.page, pageNumber: donor.page || fact.page,
      shows: donor.statement,
      construction: 'sibling_swap',
      claims: fact.subjectKey,
    };
  }

  /**
   * The subject a True/False names: on a deck a point carries the aspect its line sits under, so the claim is
   * about "the prevention of "strangles"" rather than strangles at large. `from` is the fact the statement comes from.
   */
  function claimSubject(fact, from, ctx) {
    const aspect = fact.kind === 'point' && ctx.peers ? ctx.peers.aspectPhrase(from) : '';
    return aspect ? `the ${aspect} of ${named(subjectOf(fact))}` : named(subjectOf(fact));
  }

  /** A False that changes one detail of the fact's own statement (altered-statements.js), or null. */
  function alteredFalse(fact, ctx, wording) {
    const statements = dep('factStatements', './fact-statements.js');
    if (fact.kind === 'point' && !statements.isSpecificClaim(fact.statement)) return null;
    const alt = dep('alteredStatements', './altered-statements.js').alter(fact.statement, { text: ctx.text || '' });
    if (!alt) return null;
    // A point whose statement opens with another capitalized noun ("Incision is...") would attach that statement
    // to a different subject's claim line as if it named the same owner.
    const opener = fact.kind === 'point' && String(alt.statement || '').match(/^([A-Z][a-z]{5,})\s+(?:is|are|was|were|has|have|can|cannot|does|do)\b/);
    if (opener) {
      const subjectWords = new Set(qf().contentStems(subjectOf(fact)));
      if (!qf().contentStems(opener[1]).some((w) => subjectWords.has(w))) return null;
    }
    const question = isPredicate(alt.statement)
      ? `True or False:\n"${completePredicate(subjectOf(fact), alt.statement)}"`
      : `True or False: ${wording.claim(claimSubject(fact, fact, ctx))}.\n"${alt.statement}"`;
    const explanation = `False. The material says "${alt.from}", not "${alt.to}". ${where(fact)}: ${fact.statement}`;
    return {
      ...base(fact, 'true_false', 'True / False', question, ['True', 'False'], 'False', explanation),
      construction: 'altered',
      claims: fact.subjectKey,
    };
  }

  const api = { describe, name, trueFalse, sameFrame };
  PDFStudy.factQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

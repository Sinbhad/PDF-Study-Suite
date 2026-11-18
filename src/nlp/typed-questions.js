/**
 * Typed Questions (terms): a prompt with one short answer the student types and the app checks (typed-check.js).
 * No wrong options are needed, so a fact no choice form can ask honestly is still checked rather than self-graded.
 * Built only where exactly one term is right:
 *   blank      a marked term blanked out of the sentence that defines or names it ("... devices called ________."),
 *              from a definition that names its own term or from a cloze sentence the choice form could not ask
 *              for lack of four options; every cloze rule still holds (cloze-questions.js slots), and
 *   defined    "Which term is defined as: <definition>?", from a definition whose text does not contain the term.
 * Never when the sentence is hedged or about an example, when a word of the answer (or its initials) stays in the
 * prompt, when the term is not one the scope marks (quizScope.clozeTerms: never the topic word), or when another
 * term of the scope could fill the blank as well (the scope says the same of it, or calls one a kind of the other).
 * Table cells, numbers and worked answers: typed-values.js.
 *
 * candidates(scope, ctx)      -> [question] from the scope's definition facts, best first
 * forSentence(sentence, ctx)  -> question | null   (a cloze sentence; ctx is quiz-engine's sentence context)
 * The shape of a typed question, other names of its answer and names the prompt shows: typed-shape.js.
 * question: { type: 'typed', badge, question, answer, accept, form, others, shown, explanation, skill, source,
 *             factKey, subject?, page, pageNumber }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');
  const os = () => dep('optionSets', './option-sets.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const cloze = () => dep('clozeQuestions', './cloze-questions.js');
  const kinds = () => dep('termKinds', './term-kinds.js');
  const st = () => dep('sentenceTerms', './sentence-terms.js');
  const statements = () => dep('factStatements', './fact-statements.js');
  const shape = () => dep('typedShape', './typed-shape.js');
  const make = (fields) => shape().make(fields);
  const aliasesOf = (term, text) => shape().aliasesOf(term, text);
  const shownAfter = (after) => shape().shownAfter(after);

  const BLANK = '________';
  const MAX_ANSWER_WORDS = 4;
  const MIN_DEFINITION_WORDS = 4;
  const MAX_DEFINITION_WORDS = 45;
  const MIN_NAMING_WORDS = 4;
  // A hedged sentence ("is often called", "may be") or one that leans on an example admits other answers.
  const HEDGE_RE = /\b(?:may|might|could|often|usually|sometimes|typically|generally|commonly|frequently|rarely|mostly|some|e\.g\.|for\s+example|for\s+instance|such\s+as|etc)\b/i;
  // The blank is named right where it stands: "called a ________", "known as the ________".
  const NAMED_HERE_RE = /\b(?:called|known\s+as|termed|named|referred\s+to\s+as|denoted\s+by)\s+(?:a|an|the|a\(n\))?\s*$/i;
  const LEADING_PRONOUN_RE = /^(?:it|its|they|their|this|these|those|such)\b/i;
  // "Very thin and porous", "Large, marked size variation": a description of the thing, not a genus that names its kind.
  const DESCRIPTION_START_RE = /^(?:very|quite|rather|extremely|highly|large|small|big|thin|thick|long|short|usually|often|mostly|any|some|all|each|every)$/i;
  // Where the opening noun phrase of a definition ends: a participle, a relative word or a preposition.
  const LEAD_END_RE = /\s+(?:characteri[sz]ed|caused|resulting|marked|defined|consisting|containing|that|which|who|whose|with|of|in|by|for|from|to|on|at)\b/i;
  const MAX_LEAD_WORDS = 5;
  const OTHER_SUBJECT_RE = /^([A-Z][\w-]*(?:\s+[A-Z0-9][\w-]*){0,2})\s+(?:is|are|was|were|has|have|requires?|contains?|causes?|uses?|includes?)\b/;

  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => String(s || '').replace(/\$[^$]*\$/g, ' M ').split(/\s+/).filter(Boolean);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** The scope's marked term that `text` is (in either number), or null. */
  function markedTerm(text, terms) {
    const key = os().termKey(text);
    return (terms || []).find((t) => os().termKey(t.text) === key) || null;
  }


  /**
   * May the blanked statement be asked typed? Not hedged, about an example or leaning on another sentence; no word of
   * the answer (nor its initials) left in it; and no other term of the scope that fits the blank as well.
   */
  function blankHolds(answer, before, after, source, ctx, minWords = cloze().MIN_CONTENT_WORDS) {
    const why = blankRefusal(answer, before, after, source, ctx, minWords);
    if (why && ctx.trace) ctx.trace(answer, why);
    return !why;
  }

  /**
   * Words of the answer the text gives away: any but its head noun ("propositional" of "propositional calculus" beside
   * "propositional logic"). The head alone is the category ("New propositions, called compound propositions"), which
   * leaves the distinguishing word to recall; a one-word answer has nothing but its head, so it may not appear at all.
   */
  function leakedWords(answer, text) {
    const stems = new Set(qf().contentStems(text));
    const own = qf().contentStems(answer);
    const head = own.length > 1 ? own[own.length - 1] : '';
    return own.filter((w) => w !== head && stems.has(w));
  }

  /** Why the blank may not be asked typed ('' when it may). minWords: content words the stem must keep. */
  function blankRefusal(answer, before, after, source, ctx, minWords) {
    const rest = `${before} ${after}`;
    if (HEDGE_RE.test(source)) return 'hedged';
    if (sn().isExampleTalk(source) || sn().hasUnresolvedReference(`${before}${BLANK}${after}`)) return 'example or reference';
    if (cloze().informativeWords(mt().mask(rest).text) < minWords) return 'thin stem';
    if (leakedWords(answer, rest).length) return 'answer word in stem';
    const initials = words(answer).length >= 2 ? words(answer).map((w) => w[0]).join('').toUpperCase() : '';
    if (initials && new RegExp(`(?<![A-Za-z])${initials}s?(?![A-Za-z])`).test(rest)) return 'initials in stem';
    const sibling = siblingFits(answer, rest, source, ctx, before);
    return sibling ? `sibling fits: ${sibling}` : '';
  }

  /**
   * Another marked term that could stand in the blank: one the stem does not already name, of the answer's kind (its
   * head noun or its genus, term-kinds.js) or of the category the stem names, that the scope calls a kind of the answer
   * (or the other way round) or says the same of (cloze-questions.js alsoCompletes). '' when there is none.
   */
  function siblingFits(answer, stem, source, ctx, before = '') {
    const own = new Set([os().termKey(answer), ...aliasesOf(answer, ctx.text).map(os().termKey)]);
    const inStem = new Set(dep('markedTerms', './marked-terms.js').locate(mt().mask(stem).text, ctx.terms || []).present.map((p) => os().termKey(p.term.text)));
    const answerKinds = kinds().kindsOf(answer, ctx.definitions);
    const category = before ? kinds().stemCategory(before) : '';
    const ofKind = (t) => {
      const theirs = kinds().kindsOf(t, ctx.definitions);
      return [...theirs].some((k) => answerKinds.has(k)) || (Boolean(category) && theirs.has(category));
    };
    const hit = (ctx.terms || []).find((t) => !own.has(os().termKey(t.text)) && !inStem.has(os().termKey(t.text)) && ofKind(t.text) &&
      ((ctx.kinds && ctx.kinds.related(answer, t.text)) || cloze().alsoCompletes(t.text, answer, stem, source, { ...ctx, sameMath: true })));
    return hit ? hit.text : '';
  }

  const otherTerms = (ctx) => (ctx.terms || []).map((t) => t.text).filter((t) => words(t).length <= MAX_ANSWER_WORDS);

  /** A blank cut from a cloze sentence the choice form could not ask (fewer than four fitting options). */
  function forSentence(sentence, ctx) {
    const found = cloze().slots(sentence, ctx);
    if (!found) return null;
    for (const { hit, cut } of found.list) {
      const answer = hit[0];
      if (words(answer).length > MAX_ANSWER_WORDS) continue;
      // The sentence must define or name the blanked term: "... called ________", or the term's own definition.
      const defines = NAMED_HERE_RE.test(cut.before) ||
        st().definedIn(found.clean).some((d) => os().termKey(d.term) === os().termKey(answer)) ||
        (ctx.definitions || []).some((d) => os().termKey(d.term) === os().termKey(answer) && norm(found.clean).includes(norm(d.statement)));
      if (!defines || !blankHolds(answer, cut.before, cut.after, found.clean, ctx)) continue;
      const blanked = os().neutralArticle(mt().unmask(`${cut.before}${BLANK}${cut.after}`, found.spans));
      return make({
        question: `Type the missing term:\n"${blanked}"`, answer: tidyTerm(answer, ctx), accept: aliasesOf(answer, ctx.text),
        others: otherTerms(ctx), shown: shownAfter(cut.after), explanation: `Source statement: "${found.clean}"`,
      });
    }
    return null;
  }

  /** The term in the case the scope writes it inside a sentence ("Clock skew" -> "clock skew" when lowered there). */
  const tidyTerm = (term, ctx) => {
    const t = String(term).trim();
    const running = ctx.forms ? ctx.forms.running(t) : null;
    return running || t;
  };

  /** A definition that names its own term, asked with the term blanked. */
  function namingQuestion(fact, ctx) {
    const re = new RegExp(`(?<![A-Za-z-])${escapeRe(fact.term)}(?:e?s)?(?![A-Za-z-])`, 'i');
    const statement = String(fact.statement).trim();
    const hit = statement.match(re);
    if (!hit || re.test(statement.slice(hit.index + hit[0].length)) || re.test(statement.slice(0, hit.index))) return null;
    const before = statement.slice(0, hit.index);
    const after = statement.slice(hit.index + hit[0].length);
    // A definition names exactly its own term, so its stem may be shorter than a running sentence's.
    if (!blankHolds(fact.term, before, after, statement, ctx, MIN_NAMING_WORDS)) return null;
    const blanked = os().neutralArticle(`${before}${BLANK}${after}`);
    return make({
      question: `Type the missing term:\n"${blanked}"`, answer: tidyTerm(hit[0], ctx), accept: aliasesOf(fact.term, ctx.text),
      others: otherTerms(ctx), shown: shownAfter(after), explanation: `Source statement: "${statement}"`,
    });
  }

  /**
   * The noun a definition opens with when term-kinds.js finds no genus because a participle follows a long noun phrase
   * ("aseptic necrotizing autoimmune vasculitis characterized by ..." -> "vasculitis"); '' when it opens otherwise.
   */
  function leadNoun(def) {
    const lead = String(def).replace(/^(?:an?|the)\s+/i, '').split(LEAD_END_RE)[0].trim().split(/\s+/);
    const last = (lead[lead.length - 1] || '').toLowerCase();
    if (lead.length > MAX_LEAD_WORDS || !/^[a-z]{4,}$/.test(last) || /(?:ed|ly|ing|ous|ive|al|ic|ent|ant|ful|less|able|ible)$/.test(last)) return '';
    return last;
  }

  /** Why a definition cannot be asked "which term is defined as" ('' when it can). */
  function definedRefusal(fact, def, ctx) {
    const n = words(def).length;
    if (leakedWords(fact.term, def).length) return 'definition shares a word with its term';
    if (n < MIN_DEFINITION_WORDS || n > MAX_DEFINITION_WORDS) return `${n} words`;
    if (LEADING_PRONOUN_RE.test(def) || sn().hasUnresolvedReference(def)) return 'leans on another sentence';
    if (HEDGE_RE.test(def)) return 'hedged';
    if (!statements().isDefinitionText(def)) return 'not a definition';
    // "Strepvax II requires a series of injections" under "Killed vaccine": a sentence about another name.
    const opener = def.match(OTHER_SUBJECT_RE);
    if (opener && !norm(fact.term).includes(norm(opener[1])) && !norm(opener[1]).includes(norm(fact.term))) return 'about another name';
    // "Large, marked size variation", "very thin and porous": a description, not a definition with a genus.
    const first = (def.match(/^[A-Za-z]+[,]?/) || [''])[0];
    if (!(kinds().genusOf(def, fact.term) || leadNoun(def)) || /,$/.test(first) || DESCRIPTION_START_RE.test(first.replace(/,$/, ''))) return 'no genus';
    const sibling = siblingFits(fact.term, `called ${def}`, def, ctx);
    if (sibling) return `sibling fits: ${sibling}`;
    // Two terms defined alike cannot be told apart by their definition.
    const twin = (ctx.definitions || []).find((d) => os().termKey(d.term) !== os().termKey(fact.term) &&
      dep('quizAssembly', './quiz-assembly.js').sameFact(new Set(qf().contentStems(d.statement)), new Set(qf().contentStems(def))));
    return twin ? `defined like ${twin.term}` : '';
  }

  /** "Which term is defined as: ...": a definition with a noun genus that does not contain its term. */
  function definedQuestion(fact, ctx) {
    const def = String(fact.statement).replace(/\s+/g, ' ').trim();
    const why = definedRefusal(fact, def, ctx);
    if (why) {
      if (ctx.trace) ctx.trace(fact.term, why);
      return null;
    }
    return make({
      question: `Which term is defined as:\n"${os().tidyStatement(def)}"`, answer: tidyTerm(fact.term, ctx), accept: aliasesOf(fact.term, ctx.text),
      others: otherTerms(ctx), explanation: `Source: ${fact.term}: ${def}`,
    });
  }

  /**
   * A deck's definition cards ("Encephalitis: Inflammation of the brain") as definition facts: slide-quiz.js asks them,
   * so they are not among the scope's facts. Their front is the term the lecturer marked by defining it.
   */
  function deckDefinitions(scope) {
    if (!scope.isDeck) return [];
    const subjects = dep('quizSubjects', './quiz-subjects.js');
    const known = new Set((scope.facts || []).map((f) => os().termKey(f.term)));
    const out = [];
    for (const card of scope.allCards || []) {
      if (card.category !== 'Definition' && card.sourceKind !== 'definition') continue;
      // The front as printed: a tidied subject drops what tells two terms apart ("Hansen's type 1" / "type 2").
      const term = String(card.front || '').replace(/\s*\([^)]+\)$/, '').trim();
      const back = String(card.back || '').replace(/\s*\n\s*/g, ' ').trim();
      if (!term || !back || /[—–:?]/.test(term) || known.has(os().termKey(term)) || !subjects.specificOf(term, scope.ctx || {})) continue;
      known.add(os().termKey(term));
      // A slide's definition is often a bare phrase in lower case ("inflammation of the brain"): taken as printed.
      const source = `${card.front}: ${back}`;
      const selfNaming = new RegExp(`(?<![A-Za-z])${escapeRe(term)}(?:e?s)?(?![A-Za-z])`, 'i').test(back);
      out.push({
        term, subject: term, statement: back, kind: 'definition', selfNaming, siblingOnly: false, marked: true,
        page: card.pageNumber || card.page || null, source, identity: `r|${norm(source)}`,
      });
    }
    return out;
  }

  /** Definition facts of the scope asked typed, in the scope's order. ctx: quiz-engine's sentence context. */
  function candidates(scope, ctx) {
    const out = [];
    const cardFacts = deckDefinitions(scope);
    // The deck's defined terms are terms of the scope too: typed, one of them is never right for another.
    const terms = [...(ctx.terms || []), ...cardFacts.filter((f) => !markedTerm(f.term, ctx.terms)).map((f) => ({ text: f.term, rank: 0, order: 0 }))];
    ctx = { ...ctx, terms };
    for (const fact of [...(scope.facts || []), ...cardFacts]) {
      if (fact.kind !== 'definition') continue;
      if (words(fact.term).length > MAX_ANSWER_WORDS || !(fact.marked || markedTerm(fact.term, ctx.terms))) {
        if (ctx.trace) ctx.trace(fact.term, 'not a marked term of 1-4 words');
        continue;
      }
      const q = fact.selfNaming ? namingQuestion(fact, ctx) : definedQuestion(fact, ctx);
      if (!q) continue;
      const page = fact.page || (scope.pageOf ? scope.pageOf(fact.source) || scope.pageOf(fact.statement) : null);
      if (scope.isDeck && !page) continue;
      out.push({ ...q, subject: fact.subject, source: fact.source, factKey: fact.identity, page, pageNumber: page });
    }
    return out;
  }

  const api = { candidates, forSentence, HEDGE_RE };
  PDFStudy.typedQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Quiz Scope: reads the selected slides or textbook section once and hands the question builders what
 * they need, already gated:
 *   gather(input, opts) -> { isDeck, text, headingWords, sentences, structured, cards, allCards, facts, claims, named, summary,
 *                            pageOf, usable, counts, ctx }
 *     opts.cards  the flashcards the app shows for this scope (asked as they are); mined from the input when absent
 *     structured  questions from slide-quiz.js / block-quiz.js that structured-gate.js keeps
 *                 (filler, debris, dangling definitions dropped; lecture reveals given same-kind choices)
 *     cards       flashcards of the scope (formula cards included; quiz-engine asks those by name)
 *     allCards    the same plus the deck's own definition cards (which slide-quiz.js asks), for recall questions
 *     counts      word -> times printed (quizContent.wordCounts), for the garbled-token check
 *     facts       subject -> statement pairs: flashcards (definitions, labelled points, table rows, the
 *                 lecturer's self-check Q&A), "A <term> is a ..." sentences, note lines, lecture points
 *                 (deck-facts.js); each with a real subject, never a generic heading
 *     claims      what the scope says about each subject (subject-claims.js), for checking wrong options
 *     peers       which subjects are entities of one kind (subject-peers.js): only peers trade statements
 *     kinds       which terms the scope calls kinds of one another (quiz-kinds.js): never offered against each other
 *     usable      (sentence) => may this sentence be asked (stands alone, study content, not an example)
 *     named       terms a sentence introduces by name ("... is called X", "... known as X")
 *     titlePages  (title) => the slide numbers a deck prints that title on (a recall names its slide when > 1)
 *   clozeSentences(scope, seed) -> sentences a blank may be cut from, best first
 *   clozeTerms(scope)           -> terms a blank may replace or offer (marked-terms.js)
 * Returns null for a back-of-book answer key: there is nothing to learn from one. A slide the lecturer marked
 * as not to be learned (contentFilter.isNotToMemorise: "Do not memorize", "FYI") gives no question.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  function getDeps() {
    return {
      tokenizer: dep('tokenizer', './tokenizer.js'),
      summarizer: dep('summarizer', './summarizer.js'),
      flashcardEngine: dep('flashcardEngine', './flashcard-engine.js'),
      noiseFilter: dep('noiseFilter', './noise-filter.js'),
      stemNoise: dep('stemNoise', './stem-noise.js'),
      gate: dep('quizGate', './quiz-gate.js'),
      options: dep('quizOptions', './quiz-options.js'),
      optionSets: dep('optionSets', './option-sets.js'),
      shuffle: dep('stemDistractors', './stem-distractors.js').deterministicShuffle,
      stemQuestions: dep('stemQuestions', './stem-questions.js'),
      keyTerms: dep('keyTerms', './key-terms.js'),
      sentenceTerms: dep('sentenceTerms', './sentence-terms.js'),
      facts: dep('quizFacts', './quiz-facts.js'),
      markedTerms: dep('markedTerms', './marked-terms.js'),
      content: dep('quizContent', './quiz-content.js'),
      subjects: dep('quizSubjects', './quiz-subjects.js'),
      deckFacts: dep('deckFacts', './deck-facts.js'),
      claims: dep('subjectClaims', './subject-claims.js'),
      structured: dep('structuredGate', './structured-gate.js'),
    };
  }

  const PROOF_TALK_RE = /\bproofs?\b|\bprov(?:e|en|es|ing)\b|^(?:Let|Learn|Use|Try|Choose|Remember)\b/i;
  const TAUTOLOGY_RE = /^(?:the\s+|an?\s+)?(.{4,40}?)\s+(?:is|are)\s+(?:an?|the)\s+\1\b/i; // "X is an X"
  const SHOUTED_RUN_RE = /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){2,}\b/; // "... is BY THE WAY paired ...": figure text caught in a sentence
  const LABELLED_LINE_RE =/^[A-Z][^:.]{1,40}:\s/; // "Binary Search: halves ..." is a glossary line, asked as a fact
  const NOT_A_CARD_TERM_RE = /^(?:Slide Overview|Key Concept|Worked Example|Question)$/;
  // "Common error", "serious problem": a remark about how often or how bad, not a term ("bounds error" is the term).
  const PSEUDO_TERM_RE =
    /^(?:most\s+)?(?:common|typical|usual|frequent|main|major|important|serious|good|bad|best|worst|simple|other)\s+(?:errors?|mistakes?|problems?|issues?|cases?|ways?|reasons?|things?|examples?|ideas?|points?|parts?|steps?)$/i;
  const MIN_DECK_SUBJECT_USES = 2;
  const TOPIC_WORD_SHARE = 0.4; // a term in this share of the scope's sentences is its topic word
  const MIN_TOPIC_SENTENCES = 40;
  const ALIAS_TITLE_RE = /\b(?:aka|a\.k\.a\.|also\s+(?:called|known\s+as))\b/i;
  const SHORT_SUBJECT_USES = 3;

  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** -> (sentence) => number of the slide the sentence stands on, or null. */
  function slideFinder(slides) {
    const pages = (slides || []).filter(Boolean).map((s) => ({
      page: s.slideNumber || (s.pages && s.pages[0]) || null,
      key: normKey([s.title, ...(s.bullets || [])].join(' ')),
    }));
    return (sentence) => {
      const key = normKey(sentence).slice(0, 40);
      const hit = key ? pages.find((p) => p.key.includes(key)) : null;
      return hit ? hit.page : null;
    };
  }

  /** Lecture points in turn, one per slide per pass, so no single slide fills the quiz. */
  function spreadByPage(facts) {
    const byPage = new Map();
    for (const f of facts) byPage.set(f.page, [...(byPage.get(f.page) || []), f]);
    const columns = [...byPage.values()];
    const out = [];
    for (let i = 0; out.length < facts.length; i++) {
      for (const column of columns) {
        if (column[i]) out.push(column[i]);
      }
    }
    return out;
  }

  /** Standalone, non-dangling, non-exercise sentences only; "X is an X" tautologies are never quizzed. */
  function isUsableSentence(sentence) {
    const { gate, stemNoise } = getDeps();
    if (PROOF_TALK_RE.test(sentence) || TAUTOLOGY_RE.test(sentence) || LABELLED_LINE_RE.test(sentence)) return false;
    if (SHOUTED_RUN_RE.test(sentence) || stemNoise.hasExtractionDebris(sentence) || stemNoise.isExampleTalk(sentence)) return false;
    return gate.isQuizSentence(sentence) && !stemNoise.isUnusableSentence(sentence);
  }

  function gather(allInput, opts) {
    const { maxQuestions, mode, didacticBlocks, seedOffset } = opts;
    const D = getDeps();
    const isDeck = mode === 'slides' && Array.isArray(allInput);
    // A slide the lecturer marked "Do not memorize" / "FYI" is not asked from, nor are its cards.
    const cf = dep('contentFilter', './content-filter.js');
    const unlearned = new Set(isDeck && cf && cf.isNotToMemorise ? allInput.filter(cf.isNotToMemorise).map((s) => s.slideNumber) : []);
    const input = unlearned.size ? allInput.filter((s) => !unlearned.has(s.slideNumber)) : allInput;
    const learnedCard = (c) => !unlearned.has(c.pageNumber || c.page);
    // What a card is about: a key statement's own subject ("The window is …" -> "window"), else its subject or front.
    const cardSubject = (c) => (c.sourceKind === 'key-concept' && dep('keyStatements', './key-statements.js').subjectOf(c.front)) || c.subject || c.front;
    const slideQuiz = isDeck ? dep('slideQuiz', './slide-quiz.js') : null;
    const rawText = isDeck ? slideQuiz.studyText(input) : String(input || '');
    if (mode !== 'slides' && D.stemNoise.isAnswerKeySection(rawText)) return null;

    // Chapter/section headings never become question text, answers or distractors.
    const { body: text, headingWords } = D.gate.splitHeadings(rawText);
    const profile = D.options.buildProfile(text);
    const forms = D.optionSets.textForms(text);
    // Words as the whole scope prints them (every slide on a deck, question slides included): a token
    // printed once and shaped like no word is recognition debris.
    const counts = D.content.wordCounts(isDeck ? input.map((s) => [s.title, ...(s.bullets || [])].join('\n')).join('\n') : rawText);
    const inExample = D.content.exampleTester(rawText);
    const lower = text.toLowerCase();
    const timesUsed = (term) => (lower.match(new RegExp(`(?<![a-z])${escapeRe(term.toLowerCase())}(?![a-z])`, 'g')) || []).length;
    const recurs = (term) => timesUsed(term) >= 2;
    const isTerm = (term) => D.gate.isGoodDistractor(term, false) && D.options.acceptTerm(term, profile, true) &&
      !(D.noiseFilter && D.noiseFilter.isTermNoise(term));
    // A textbook's boxes: core boxes (Definition, Common Error) first, side topics last, narrative asides never.
    const quizRank = dep('quizRank', './quiz-rank.js');
    const rank = quizRank.ranker(isDeck ? [] : opts.lines);
    const sentencesOfText = D.tokenizer.splitSentences(text);
    // Read with the headings: "Example 2-1 ... Power Windows" opens the example that brings "window" in.
    const exampleTerm = quizRank.exampleTerms(isDeck ? sentencesOfText : D.tokenizer.splitSentences(rawText));
    // A sentence may be asked when it stands alone, is study content, is not the incidental content of an
    // Example block or an aside, holds no recognition debris and is not about a worked example's own domain.
    const printedWord = (w) => counts.has(w);
    const usable = (s) => isUsableSentence(s) && D.content.lineIsContent(s) && !inExample(s) && !rank.isAside(s) &&
      !D.content.isGarbled(s, counts) && !exampleTerm.mentionedIn(s) && !D.stemNoise.hasExtractionDebris(s, printedWord);

    const built = isDeck
      ? slideQuiz.build(input, { seedOffset, maxQuestions })
      : dep('blockQuiz', './block-quiz.js').build(didacticBlocks, { seedOffset, maxQuestions });

    // On a deck the definitions are already asked by slide-quiz.js; overview cards are whole slides.
    // A card from a case, title or objectives slide carries that slide's filler; a lecture question's card
    // comes from a question slide and is kept.
    const slideAt = new Map(isDeck ? input.map((s) => [s.slideNumber, s]) : []);
    const fromContentSlide = (c) => {
      const slide = slideAt.get(c.pageNumber || c.page);
      return !slide || c.kind === 'qa' || D.content.slideIsContent({ ...slide, kind: slide.kind === 'question' ? 'content' : slide.kind });
    };
    // The cards the student sees (opts.cards, from the app's own card mining with every extraction field) are
    // the ones asked; without them the engine mines the input itself.
    const minedCards = Array.isArray(opts.cards) ? opts.cards.filter(learnedCard)
      : isDeck ? D.flashcardEngine.extractSlideFlashcards(input) : D.flashcardEngine.extractBookFlashcards(text, 'Section', didacticBlocks);
    const allCards = isDeck ? minedCards.filter(fromContentSlide)
      : rank.order(minedCards.filter((c) => !inExample(String(c.back || '')) && !exampleTerm.is(cardSubject(c))), (c) => c.back);
    const rawCards = isDeck ? allCards.filter((c) => c.kind !== 'overview' && c.category !== 'Definition') : allCards;
    const cards = seedOffset > 0 ? D.shuffle(rawCards, 'cards', seedOffset) : rawCards;
    const repeated = isDeck ? D.subjects.repeatedHeadings(input) : new Set();
    const ctx = { repeated, deck: isDeck };

    const sentences = rank.order(sentencesOfText.flatMap((s) => D.tokenizer.cleanMarkdown(s).split(/\s+•\s+/)).map(D.stemNoise.stripRunInHeading));
    // A sentence-initial subject is written the way the scope writes it elsewhere ("Fermentation is ..."
    // names "fermentation"); a capitalised subject the scope never lowers is an example, not a term.
    // "A <subject> is a ..." already shows the subject is a noun, so a short one-word subject the shape
    // rules cannot vouch for ("esker", "latch") is accepted when the scope uses it at least three times.
    const subjectTerm = (subject) => {
      const term = /^[A-Z]/.test(subject) && !D.optionSets.hasFixedCase(subject) ? forms.running(subject) : subject;
      if (!term || !isTerm(term) || !recurs(term)) return null;
      const vouched = D.gate.isNounPhrase(term) || (!term.includes(' ') && timesUsed(term) >= SHORT_SUBJECT_USES);
      return vouched ? term : null;
    };
    // Definitions name a term the scope keeps using; a point or a lecture question names a subject that
    // the subject rules (quiz-subjects.js) already vouched for.
    const cardFacts = D.facts.fromCards(cards, text, ctx).filter((f) => f.kind === 'point' || f.kind === 'qa' || f.kind === 'theorem' || isTerm(f.term))
      .filter((f) => !D.content.isGarbled(`${f.term} ${f.statement}`, counts))
      // A key concept is asked about the concept it names only when the scope keeps using that name; a concept
      // the book itself boxed as a key concept, or one the section names at least SHORT_SUBJECT_USES times ("if
      // statement"), need not pass the distractor-shape rules.
      .filter((f) => !f.concept || (recurs(f.term) &&
        (f.category === 'Key Concept' || isTerm(f.term) || timesUsed(f.term) >= SHORT_SUBJECT_USES)));
    // A term is asked from its strongest source only: a flashcard before a note line before a sentence.
    const known = new Set(cardFacts.map((f) => f.subjectKey));
    const fresh = (f) => {
      if (known.has(f.subjectKey)) return false;
      known.add(f.subjectKey);
      return true;
    };
    const noteFacts = isDeck ? [] : D.facts.fromNoteLines(text).filter((f) => isTerm(f.term) && fresh(f));
    const sentenceFacts = D.facts.fromSentences(sentences.filter(usable), text, subjectTerm).filter(fresh);
    const cardLines = new Set(cards.map((c) => normKey(c.back)));
    const points = isDeck ? D.deckFacts.fromSlides(input, { repeated, cardLines }).filter((f) => !D.content.isGarbled(f.statement, counts)) : [];
    const gathered = [...cardFacts, ...noteFacts, ...sentenceFacts, ...spreadByPage(seedOffset > 0 ? D.shuffle(points, 'points', seedOffset) : points)];
    // On a deck the subject of a point is printed at least twice, or the lecture makes at least two points
    // about it: a title printed once with a single line under it is usually a mis-recognised title or a
    // pen note ("zyme disease"), not a subject the lecture teaches. A defined term is its own evidence.
    const deckWords = isDeck ? ` ${normKey(input.map((s) => [s.title, ...(s.bullets || [])].join(' ')).join(' '))} ` : '';
    const printed = (name) => deckWords.split(` ${normKey(name)} `).length - 1;
    const pointsAbout = new Map();
    for (const f of gathered) pointsAbout.set(f.subjectKey, (pointsAbout.get(f.subjectKey) || 0) + 1);
    const taught = (f) => printed(f.subject) >= MIN_DECK_SUBJECT_USES || pointsAbout.get(f.subjectKey) >= MIN_DECK_SUBJECT_USES;
    // Facts from core boxes are asked before the exposition, side topics after it; an example's domain never.
    const facts = rank.order(gathered.filter((f) => (!isDeck || f.kind !== 'point' || taught(f)) && !exampleTerm.is(f.subject)), (f) => f.statement);
    // A definition that shares only the section's topic word with its term ("Empty set" / "a set with no
    // elements" in a section on sets) gives nothing away: every option of that section says "set" as well.
    const topic = topicStems(sentencesOfText);
    for (const f of facts) {
      if (!f.siblingOnly) continue;
      const own = new Set(D.facts.contentStems(f.term));
      if (D.facts.contentStems(f.statement).every((w) => !own.has(w) || topic.has(w))) f.siblingOnly = false;
    }
    // Subjects whose names are one inside the other are one subject (quizSubjects.mergeKeys); a title that
    // gives a name and its alias ("X aka Y") ties the two.
    const aliasTitles = isDeck ? input.map((s) => String(s.title || '')).filter((t) => ALIAS_TITLE_RE.test(t)) : [];
    const merged = D.subjects.mergeKeys([...facts.filter((f) => f.kind !== 'qa').map((f) => f.subject), ...aliasTitles]);
    const keyOf = (name) => merged.get(D.subjects.subjectKey(name)) || D.subjects.subjectKey(name);
    for (const f of facts) if (f.kind !== 'qa') f.subjectKey = keyOf(f.subject);

    // A lecture question may be both a slide-quiz question and a qa fact: the set keeps whichever comes
    // first, and a practice test (auto-graded only) takes the qa fact's multiple choice over a reveal.
    const structured = D.structured.gate(built, { isTerm, counts, seedOffset });

    const subjectSlides = isDeck ? D.deckFacts.subjectIndex(input, ctx) : [];
    const claims = D.claims.fromScope({ facts, subjectSlides, sentences, keyOf });
    // Which subjects are entities of one kind (subject-peers.js): only those trade statements in a False or an option.
    const peers = dep('subjectPeers', './subject-peers.js').index({
      facts, subjectSlides: subjectSlides.map((s) => ({ ...s, key: keyOf(s.subject) })), cards: allCards, ctx, keyOf,
      lines: isDeck ? input.flatMap((s) => [s.title, ...(s.bullets || [])]) : sentences,
    });
    // Which terms the scope calls kinds of one another (a latch is a storage element): never set against each other.
    const kinds = dep('quizKinds', './quiz-kinds.js').index(isDeck ? input.flatMap((s) => [s.title, ...(s.bullets || [])]) : sentences);
    const definedHere = sentences.filter(usable).flatMap((s) => D.sentenceTerms.definedIn(s));
    const named = definedHere.filter((d) => d.how === 'naming').map((d) => d.term)
      .filter((term) => isTerm(term) && D.gate.isNounPhrase(term));
    // The subject of "A truth table is a table of ..." is a term the prose defines, even without bold type
    // or a card; it may be blanked and offered like a bold term once the scope uses it again.
    const subjectsDefined = definedHere.filter((d) => d.how === 'copula').map((d) => subjectTerm(d.term)).filter(Boolean);
    const summary = D.summarizer.summarizeText(text, { topK: Math.max(12, maxQuestions * 2), didacticBlocks });
    const pageOf = isDeck ? slideFinder(input) : dep('cardFields', './card-fields.js').pageLocator(opts.lines);
    // The slides that print a title ("Claw Amputation" on five slides): a recall of one of them names its slide.
    const titleKey = (t) => normKey(D.subjects.tidySubject(t));
    const titled = new Map();
    for (const s of isDeck ? input : []) titled.set(titleKey(s.title), [...(titled.get(titleKey(s.title)) || []), s.slideNumber]);
    const titlePages = (title) => titled.get(titleKey(title)) || [];
    // Key concepts (a margin note, a stand-alone key statement): the statement is a cloze sentence and the
    // concept it is about, when the scope keeps naming it, is the term blanked ("________ compare values").
    const concepts = conceptCloze(allCards, (term) => isTerm(term) && recurs(term));
    return {
      isDeck, text, headingWords, profile, recurs, isTerm, usable, pageOf, sentences, structured, cards, facts, claims, peers, kinds, named, summary,
      subjectsDefined, allCards, counts, ctx, concepts, rank, exampleTerm, titlePages,
    };
  }

  /** Content stems printed in at least TOPIC_WORD_SHARE of a long scope's sentences: its topic words ("set", "array"). */
  function topicStems(sentences) {
    const out = new Set();
    if (sentences.length < MIN_TOPIC_SENTENCES) return out;
    const counts = new Map();
    for (const s of sentences) for (const w of new Set(getDeps().facts.contentStems(s))) counts.set(w, (counts.get(w) || 0) + 1);
    for (const [w, n] of counts) if (n / sentences.length >= TOPIC_WORD_SHARE) out.add(w);
    return out;
  }

  /** Key-concept cards -> { terms, sentences }: the concept each is about and the whole statement. */
  function conceptCloze(cards, isConcept) {
    const ks = dep('keyStatements', './key-statements.js');
    const terms = [];
    const sentences = [];
    for (const c of cards || []) {
      if (c.sourceKind !== 'key-concept' || !/…$/.test(String(c.front || ''))) continue;
      const subject = ks.subjectOf(c.front);
      if (!subject || !isConcept(subject)) continue;
      terms.push(subject);
      sentences.push(`${String(c.front).replace(/\s*…$/, '')} ${String(c.back || '').replace(/[.\s]+$/, '')}.`);
    }
    return { terms, sentences };
  }

  /** Sentences a cloze may be cut from: defining statements, key concepts, then the summary's picks, then the rest. */
  function clozeSentences(scope, seedOffset) {
    const D = getDeps();
    const defining = scope.facts.filter((f) => f.selfNaming).map((f) => f.statement);
    const picked = scope.summary.sentences || [];
    const ranked = seedOffset > 0 ? D.shuffle(picked, 'sents', seedOffset) : picked;
    const seen = new Set();
    const concepts = (scope.concepts && scope.concepts.sentences) || [];
    const usable = [...defining, ...concepts, ...ranked, ...scope.sentences].map((s) => D.stemNoise.stripRunInHeading(D.tokenizer.cleanMarkdown(s))).filter((s) => {
      const key = normKey(s);
      if (seen.has(key)) return false;
      seen.add(key);
      return scope.usable ? scope.usable(s) : isUsableSentence(s);
    });
    return scope.rank ? scope.rank.order(usable) : usable;
  }

  /**
   * Terms a cloze may blank or offer, strongest evidence first: defined terms and card fronts, then
   * bold terms, then the summariser's key terms. A key term comes from keyphrase statistics, so it must
   * also read as a noun phrase, recur in the scope and not be a piece of a heading.
   */
  function clozeTerms(scope) {
    const D = getDeps();
    // Only cards that name a defined term: a slide fact's front is "Topic — label", and its label
    // ("Dogs", "Pharmacokinetics") is no term to blank or offer.
    const fronts = scope.cards.filter((c) => !D.stemQuestions.isFormulaCard(c) && !NOT_A_CARD_TERM_RE.test(c.category || '') &&
      D.facts.factKindOf(c) === 'definition' && D.content.cardIsContent(c)).map((c) => c.front);
    const defined = (scope.summary.definitions || []).map((d) => d.term);
    // The section's own topic word ("array" in a chapter on arrays) is named in nearly every sentence: blanked, any
    // sentence gives it away, and offered, it is the obvious pick.
    const sentenceCount = Math.max(1, scope.sentences.length);
    const isTopicWord = (term) => {
      // Singular and plural alike: "arrays" is the topic word of a chapter that says "array" in every other sentence.
      const one = term.length <= 4 ? term : /(?:ch|sh|ss|x)es$/i.test(term) ? term.slice(0, -2) : term.replace(/(?<!s)s$/i, '');
      const re = new RegExp(`(?<![A-Za-z])${escapeRe(one)}(?:e?s)?(?![A-Za-z])`, 'i');
      return scope.sentences.length >= MIN_TOPIC_SENTENCES && scope.sentences.filter((s) => re.test(s)).length / sentenceCount >= TOPIC_WORD_SHARE;
    };
    // A category ("variety of ways") or an example's identifier ("NumberOfBoxes") is no term to offer.
    const accept = (term, rank) => {
      if (!scope.isTerm(term) || !D.subjects.specificOf(term, {}) || D.content.isFillerText(term) || PSEUDO_TERM_RE.test(term)) return false;
      if (scope.exampleTerm && scope.exampleTerm.is(term)) return false;
      if (/[a-z]{2,}[A-Z]/.test(term)) return false; // a program's identifier ("StudentIDs"), not a term ("mRNA" is)
      if (isTopicWord(term)) return false;
      if (rank === 0) return true;
      if (!D.gate.isNounPhrase(term)) return false;
      return rank === 1 || (scope.recurs(term) && !D.gate.isHeadingFragment(term, scope.headingWords));
    };
    const groups = [
      [...scope.facts.filter((f) => f.kind !== 'point' && f.kind !== 'qa').map((f) => f.term), ...fronts, ...defined, ...scope.named],
      [...D.keyTerms.boldTerms(scope.text), ...(scope.subjectsDefined || []), ...((scope.concepts && scope.concepts.terms) || [])],
      scope.summary.keyTerms || [],
    ];
    return D.markedTerms.collect(groups, scope.text, accept);
  }

  const api = { gather, clozeSentences, clozeTerms, isUsableSentence };
  PDFStudy.quizScope = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Deterministic Non-AI Quiz Generator (Multiple Choice, Cloze, True/False)
 * Prioritizes STEM Theorems & Definitions, Filters Distractor Noise, and Supports Quiz Reshuffling.
 * Every answer and distractor passes the quiz-gate.js shape checks; each answer and each source
 * sentence is used at most once, so a short section yields fewer but cleaner questions.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const ANTONYM_PAIRS = [
    ['increases', 'decreases'], ['increase', 'decrease'], ['increasing', 'decreasing'],
    ['higher', 'lower'], ['highest', 'lowest'], ['faster', 'slower'], ['positive', 'negative'],
    ['maximum', 'minimum'], ['internal', 'external'], ['synchronous', 'asynchronous'],
    ['symmetric', 'asymmetric'], ['direct', 'inverse'], ['directly', 'inversely'],
    ['volatile', 'non-volatile'], ['parallel', 'serial'], ['static', 'dynamic'],
    ['primary', 'secondary'], ['endothermic', 'exothermic'], ['aerobic', 'anaerobic'],
    ['continuous', 'discontinuous'], ['converges', 'diverges'], ['bounded', 'unbounded'],
  ];

  function getDeps() {
    return {
      tokenizer: PDFStudy.tokenizer || (typeof require === 'function' ? require('./tokenizer.js') : null),
      keywords: PDFStudy.keywords || (typeof require === 'function' ? require('./keywords.js') : null),
      summarizer: PDFStudy.summarizer || (typeof require === 'function' ? require('./summarizer.js') : null),
      flashcardEngine: PDFStudy.flashcardEngine || (typeof require === 'function' ? require('./flashcard-engine.js') : null),
      noiseFilter: PDFStudy.noiseFilter || (typeof require === 'function' ? require('./noise-filter.js') : null),
      quizGate: PDFStudy.quizGate || (typeof require === 'function' ? require('./quiz-gate.js') : null),
      quizOptions: PDFStudy.quizOptions || (typeof require === 'function' ? require('./quiz-options.js') : null),
    };
  }

  // Shuffling and typed (formula / complexity / prose) distractor selection live in stem-distractors.js.
  const sd = () => PDFStudy.stemDistractors || (typeof require === 'function' ? require('./stem-distractors.js') : null);
  const mt = () => PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);
  const sn = () => PDFStudy.stemNoise || (typeof require === 'function' ? require('./stem-noise.js') : null);
  const deterministicShuffle = (...a) => sd().deterministicShuffle(...a);
  /** ctx: { trusted (lowercase card terms), headingWords, profile (quizOptions.buildProfile) }. */
  const selectDistractors = (...a) => sd().selectDistractors(...a);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ansKey = (s) => normKey(s).replace(/(?:es|s)\b/g, ''); // "tangent line" == "tangent lines"

  function generateQuiz(input, options = {}) {
    const { maxQuestions = 10, mode = 'book', didacticBlocks = [], seedOffset = 0 } = options;
    const { tokenizer, keywords, summarizer, flashcardEngine, noiseFilter } = getDeps();
    const gate = getDeps().quizGate;

    const isDeck = mode === 'slides' && Array.isArray(input);
    const need = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
    const rawText = isDeck ? need('slideQuiz', './slide-quiz.js').studyText(input) : String(input || '');
    if (mode !== 'slides' && sn().isAnswerKeySection(rawText)) return [];
    // Structured questions first (slide definitions / Q&A / worked problems, or textbook didactic blocks);
    // the keyword-based generators below only fill what is left of the budget.
    const structured = isDeck
      ? need('slideQuiz', './slide-quiz.js').build(input, { seedOffset, maxQuestions })
      : need('blockQuiz', './block-quiz.js').build(didacticBlocks, { seedOffset, maxQuestions });
    const lead = structured.slice(0, isDeck ? maxQuestions : Math.ceil(maxQuestions * 0.7));
    // Chapter/section headings never become question text, answers or distractors.
    const { body: text, headingWords } = gate.splitHeadings(rawText);
    const rawCards = isDeck
      ? flashcardEngine.extractSlideFlashcards(input).filter((c) => !/^(?:qa|overview)$/.test(c.kind) && c.category !== 'Definition')
      : flashcardEngine.extractBookFlashcards(text, 'Section', didacticBlocks);
    const cards = seedOffset > 0 ? deterministicShuffle(rawCards, 'cards', seedOffset) : rawCards;
    const cardTerm = (c) => c.front.replace(/\s*\([^)]+\)$/, '').trim();
    const isDidactic = (c) => /^(?:Definition|Theorem|Guideline|Rule|Law|Corollary|Lemma)$/.test(c.category || '');
    const sq = PDFStudy.stemQuestions || (typeof require === 'function' ? require('./stem-questions.js') : null);
    // Slide overviews and RAKE "Key Concept" cards (raw keyphrases, already in rakeList) are never trusted.
    const opts = getDeps().quizOptions;
    const profile = opts.buildProfile(text); // section statistics: recurrence, co-occurrence, line ends
    const goodCards = cards.filter((c) => !/^(?:Slide Overview|Key Concept)$/.test(c.category || '') && (sq.isFormulaCard(c) ||
      ((isDidactic(c) || gate.isNounPhrase(cardTerm(c))) && opts.acceptTerm(cardTerm(c), profile, true))));
    const formulaPool = goodCards.filter(sq.isFormulaCard).map((c) => c.back.trim());
    const trusted = new Set(goodCards.map((c) => cardTerm(c).toLowerCase()));
    const rakeList = keywords
      .extractRakeKeyphrases(noiseFilter ? noiseFilter.filterText(text) : text, 3, 45)
      .filter((r) => r.phrase.length >= 4 && gate.isNounPhrase(r.phrase) && opts.acceptTerm(r.phrase, profile))
      .filter((r) => !gate.isHeadingFragment(r.phrase, headingWords));
    const summaryObj = summarizer.summarizeText(text, { topK: Math.max(12, maxQuestions * 2), didacticBlocks });
    const summarySentences =
      seedOffset > 0
        ? deterministicShuffle(summaryObj.sentences || [], 'sents', seedOffset)
        : summaryObj.sentences || [];

    // Answer/distractor pool: flashcard terms & didactic titles first, then filtered RAKE phrases.
    const termPool = [...goodCards.filter((c) => !sq.isFormulaCard(c)).map(cardTerm), ...rakeList.map((r) => r.phrase)];
    const ctx = { trusted, headingWords, profile };
    const questions = [...lead];
    const usedAnswers = new Set();
    const usedSources = [];
    const sourceUsed = (s) => usedSources.some((u) => normKey(s).includes(u) || u.includes(normKey(s)));
    const claim = (answer, source) => {
      if (answer) usedAnswers.add(ansKey(answer));
      usedSources.push(normKey(source));
    };
    for (const q of structured) claim(q.type === 'true_false' ? null : q.answer, q.explanation);

    // 1. Multiple Choice Questions from Definitions, Theorems & Key Terms
    for (const card of goodCards) {
      if (questions.length >= Math.ceil(maxQuestions * 0.45)) break;
      const cleanTerm = cardTerm(card);
      if (usedAnswers.has(ansKey(cleanTerm)) || sourceUsed(card.back) || (structured.length && isDidactic(card))) continue;
      const fq = sq.formulaQuestion(card, formulaPool, `q-${questions.length + 1}`, seedOffset);
      if (fq || sq.isFormulaCard(card)) { // formula cards are asked name -> expression, never the reverse
        if (fq) { claim(cleanTerm, card.back); questions.push(fq); }
        continue;
      }
      if (new RegExp(`\\b${escapeRe(cleanTerm)}\\b`, 'i').test(card.back)) continue; // stem gives it away
      if (noiseFilter && (noiseFilter.isNoise(card.back) || noiseFilter.isTermNoise(cleanTerm))) continue;
      const distractors = selectDistractors(cleanTerm, termPool, card.back, 3, seedOffset, ctx);
      if (distractors.length === 3) {
        const qText = `Which concept, theorem, or term best matches the following statement?\n"${card.back}"`;
        claim(cleanTerm, card.back);
        questions.push({
          id: `q-${questions.length + 1}`,
          type: 'multiple_choice',
          badge: `Multiple Choice • ${card.category || 'Concept'}`,
          question: qText,
          options: deterministicShuffle([cleanTerm, ...distractors], qText, seedOffset),
          answer: cleanTerm,
          explanation: `"${cleanTerm}" (${card.context}): ${card.back}`,
          skill: sq.skillOf(card), category: card.category, pageNumber: card.pageNumber || null,
        });
      }
    }

    // 2. Cloze (Fill-in-the-Blank) from gated sentences; blank a card term, else a noun-phrase keyphrase
    const rank = (p) => (trusted.has(p.toLowerCase()) ? 0 : p.split(' ').length); // card terms, then short phrases
    const blankable = [...termPool].sort((a, b) => rank(a) - rank(b));
    // Standalone, non-dangling, non-exercise sentences only; "X is an X" tautologies never quizzed.
    const usable = (s) => gate.isQuizSentence(s) && !sourceUsed(s) && !sn().isUnusableSentence(s) && !/\bproofs?\b|\bprov(?:e|en|es|ing)\b|^(?:Let|Learn|Use|Try|Choose|Remember)\b/i.test(s) &&
      !/^(?:the\s+|an?\s+)?(.{4,40}?)\s+(?:is|are)\s+(?:an?|the)\s+\1\b/i.test(s);
    for (const sent of summarySentences) {
      if (questions.length >= Math.ceil(maxQuestions * 0.78)) break;
      const cleanSent = tokenizer.cleanMarkdown(sent);
      if (!usable(cleanSent)) continue;
      const { text: masked, spans } = mt().mask(cleanSent); // never blank inside a $...$ formula
      const target = blankable.find((p) => {
        if (p.length < 4 || p.length > cleanSent.length * 0.4 || usedAnswers.has(ansKey(p))) return false;
        const m = masked.match(new RegExp(`\\b(${escapeRe(p)})\\b`, 'i'));
        // An untrusted phrase must end where it is blanked: no formula or head noun right after ("familiar precalculus | concepts").
        const next = m && masked.slice(m.index + m[0].length).match(/^\s*(\u27E6M\d+\u27E7|[a-z]{4,}\b)/);
        if (!m || (!trusted.has(p.toLowerCase()) && next && !tokenizer.STOPWORDS.has(next[1]))) return false;
        return !/\b(?:partial|nth|first|second|third|infinite|finite|definite|indefinite|improper|geometric|taylor|maclaurin|power|alternating|riemann|one-sided|local|global)\s+$/i.test(masked.slice(0, m.index));
      });
      if (!target) continue;
      const re = new RegExp(`\\b(${escapeRe(target)})\\b`, 'i');
      const exactTarget = masked.match(re)[1];
      const blanked = mt().unmask(masked.replace(re, '________'), spans);
      const distractors = selectDistractors(exactTarget, termPool, blanked, 3, seedOffset, ctx);
      if (distractors.length === 3) {
        claim(exactTarget, cleanSent);
        questions.push({
          id: `q-${questions.length + 1}`,
          type: 'cloze',
          badge: 'Fill in the Blank',
          question: `Complete the statement:\n"${blanked}"`,
          options: deterministicShuffle([exactTarget, ...distractors], blanked, seedOffset),
          answer: exactTarget,
          explanation: `Source statement: "${cleanSent}"`,
          skill: 'definition',
        });
      }
    }

    // 3. True / False: antonym-perturbed (False) plus a capped few conceptual declaratives (True)
    const maxTrue = Math.max(1, Math.round(maxQuestions * 0.15));
    let trueCount = 0;
    const pushTrueFalse = (statement, answer, explanation) =>
      questions.push({
        id: `q-${questions.length + 1}`,
        type: 'true_false',
        badge: 'True / False',
        question: `True or False:\n"${statement}"`,
        options: ['True', 'False'],
        answer,
        explanation,
        skill: 'theorem',
      });
    for (let i = 0; i < summarySentences.length && questions.length < maxQuestions; i++) {
      const cleanSent = tokenizer.cleanMarkdown(summarySentences[i]);
      if (!usable(cleanSent)) continue;
      // Perturbing a cited theorem ("Theorem 9.23 says ... converges") would falsify the citation itself.
      const pair = !/\bTheorem\s+[A-Z]?\d/i.test(cleanSent) &&
        ANTONYM_PAIRS.find(([w1]) => new RegExp(`\\b${w1}\\b`, 'i').test(mt().mask(cleanSent).text));
      if (pair) {
        const [w1, w2] = pair;
        const perturbed = cleanSent.replace(new RegExp(`\\b${w1}\\b`, 'i'), w2);
        claim(null, cleanSent);
        pushTrueFalse(perturbed, 'False', `False — the source text states "${w1}" instead of "${w2}": "${cleanSent}"`);
      } else if (trueCount < maxTrue && gate.isConceptualDeclarative(cleanSent)) {
        trueCount++;
        claim(null, cleanSent);
        pushTrueFalse(cleanSent, 'True', `True — the source text states this directly: "${cleanSent}"`);
      }
    }

    // Top up from the structured questions held back, then number everything q-1..q-N.
    return [...questions, ...structured.slice(lead.length)].slice(0, maxQuestions)
      .map((q, i) => ({ ...q, id: `q-${i + 1}`, page: q.page || q.pageNumber || null }));
  }

  const getShapeBucket = (t) => getDeps().quizGate.getShapeBucket(t); // kept for API compatibility
  PDFStudy.quizEngine = { generateQuiz, selectDistractors, getShapeBucket };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.quizEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

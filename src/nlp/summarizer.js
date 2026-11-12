/**
 * Hybrid Extractive Summarizer (TextRank + LexRank + Luhn + TF-IDF + MMR)
 * Prioritizes Conceptual Exposition, Theorems, Formulas & Algorithms while Filtering STEM/Publisher Noise.
 * Ranking kernels live in graph-rank.js and are re-exported here.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  function getDeps() {
    return {
      tokenizer: dep('tokenizer', './tokenizer.js'),
      noiseFilter: dep('noiseFilter', './noise-filter.js'),
      stemNoise: dep('stemNoise', './stem-noise.js'),
      stemCards: dep('stemCards', './stem-cards.js'),
      graphRank: dep('graphRank', './graph-rank.js'),
    };
  }

  /** Worked-example algebra: "$\lim ... = ...$ Property 2 $= 19$ Simplify." or a line that is mostly formula. */
  function isDerivation(text) {
    const s = String(text || '').trim();
    const spans = s.match(/\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/g) || [];
    const mathLen = spans.reduce((n, x) => n + x.length, 0);
    if (/^[\[(]|^\$\$|^\$[A-Z][a-z]+\$/.test(s) || (/^\$/.test(s) && /=/.test(s) && spans.length >= 2)) return true;
    if (/\((?:Sections?|Chapters?|Exercises?)\s+\d[^)]*\)\s+[A-Z]/.test(s)) return true; // list item glued to the next sentence
    if (/\b[a-z]{3,}\.\s+[a-z]{3,}\b/.test(s.replace(/\$[^$]*\$/g, 'X').replace(/\b(?:vs|etc|approx|resp)\./g, ''))) return true; // two glued fragments
    if ((spans.length >= 2 && mathLen / s.length > 0.5 && /=/.test(s)) || spans.filter((x) => /^\$\$/.test(x)).length >= 2) return true;
    return /\$\s+(?:Factor|Simplify|Multiply|Divide|Apply|Use|Substitute|Rewrite|Rationalize|Propert(?:y|ies)|Direct)\b[^$]{0,60}\.$/.test(s);
  }

  function isNoise(text) {
    const { noiseFilter, stemNoise } = getDeps();
    if (noiseFilter && (noiseFilter.isNoise(text) || noiseFilter.isGarbled(text))) return true;
    return Boolean(stemNoise && stemNoise.isFragment(text)) || isDerivation(text);
  }

  /** Deduped { term, definition, page? } list: definition blocks first, then "is called / is defined as" statements. */
  function collectDefinitions(text, didacticBlocks, splitSentences) {
    const { stemNoise, stemCards } = getDeps();
    const dm = dep('definitionMiner', './definition-miner.js');
    const out = [];
    const seen = new Set();
    const add = (term, definition, page) => {
      const key = dm.termKey(term);
      if (!key || seen.has(key) || !definition) return;
      seen.add(key);
      out.push(page ? { term, definition, page } : { term, definition });
    };
    for (const b of didacticBlocks || []) {
      if (/^Definition/i.test(b.category || '') && b.title) add(String(b.title).replace(/^Definitions?\s+of\s+(?:the\s+|an?\s+)?/i, ''), stemCards.didacticBack(b), b.pageNumber);
    }
    for (const d of dm.mineText(text, splitSentences)) {
      if (!stemNoise.isUnusableSentence(d.definition) && !isDerivation(d.sentence)) add(d.term, d.definition);
    }
    return out;
  }

  const scoreLuhn = (...a) => getDeps().graphRank.scoreLuhn(...a);
  const scoreGraphCentrality = (...a) => getDeps().graphRank.scoreGraphCentrality(...a);

  function summarizeText(text, options = {}) {
    const { topK = 7, headings = [], didacticBlocks = [] } = options;
    const { tokenizer, stemNoise, stemCards, graphRank } = getDeps();
    const { STOPWORDS, tokenize, cleanMarkdown, splitSentences, computeTfIdfVectors, cosineSim } = tokenizer;
    const { normalizeScores } = graphRank;

    // Inline list bullets are separate statements; a run-in question heading ("What Is Calculus? ...") is dropped.
    const rawSentences = splitSentences(text)
      .flatMap((s) => cleanMarkdown(s).split(/\s+•\s+/))
      .map((s) => s.replace(/^(?:[A-Z][\w'’-]*\s+){1,5}[\w'’-]+\?\s+(?=[A-Z])/, '').trim())
      .filter((s) => s.length >= 25 && !isNoise(s));
    const definitions = options.definitions || collectDefinitions(text, didacticBlocks, splitSentences);
    const blockNames = didacticBlocks.map((b) => String(b.title || '').replace(/^.*?\s[—–]\s/, ''));
    const keyTerms = dep('keyTerms', './key-terms.js').rank({ definitions, text, blockNames, titles: options.titles || [], max: 12 });
    const keyFormulas = stemCards
      ? stemCards.extractStemCards(text, splitSentences).filter((c) => c.category !== 'Definition').map((c) => ({
          category: c.category,
          title: c.front,
          body: c.back,
          formula: c.kind === 'formula' ? c.back : undefined,
        }))
      : [];

    if (rawSentences.length <= topK) {
      return { sentences: rawSentences, keyTerms, didacticBlocks, keyFormulas, definitions };
    }

    const { tokenized, vectors } = computeTfIdfVectors(rawSentences);
    const headingWords = new Set(tokenize(headings.join(' ')).filter((w) => !STOPWORDS.has(w) && w.length > 2));
    const nLuhn = normalizeScores(scoreLuhn(tokenized));
    const nTextRank = normalizeScores(scoreGraphCentrality(vectors, cosineSim, 0));
    const nLexRank = normalizeScores(scoreGraphCentrality(vectors, cosineSim, 0.12));
    const nTfIdf = normalizeScores(
      vectors.map((vec, i) => Object.values(vec).reduce((a, b) => a + b, 0) / Math.max(8, Math.pow(tokenized[i].length, 0.7)))
    );

    const scored = rawSentences.map((s, i) => {
      const base = 0.35 * nTextRank[i] + 0.25 * nLexRank[i] + 0.2 * nLuhn[i] + 0.2 * nTfIdf[i];
      const relPos = i / rawSentences.length;
      const posWeight = i === 0 || relPos < 0.16 ? 1.25 : relPos > 0.85 ? 1.12 : 1.0;
      const overlap = tokenized[i].filter((w) => headingWords.has(w)).length;
      const headingWeight = headingWords.size > 0 ? 1 + 0.45 * (overlap / Math.min(5, headingWords.size)) : 1.0;
      const cueBonus =
        /\b(defined as|refers to|theorem|algorithm|complexity|recurrence|continuous|differentiable|limit|derivative|integral|function|property|principle|means that|states that)\b/i.test(s)
          ? 1.32
          : 1.0;
      const danglingPenalty = stemNoise && (stemNoise.isDangling(s) || /^(?:In\s+such|Another|One\s+way)\b/.test(s)) ? 0.25 : 1.0;
      // Worked-example / proof narration ("you can apply Theorem 1.7 to conclude ...") explains one exercise, not the section.
      const narration = /\byou\s+can\s+(?:apply|conclude|rewrite|divide|write|use)\b|\b(?:Examples?|Exercises?)\s+\d|\bTo\s+prove\b|\bthe\s+proofs?\b/.test(s) ? 0.4 : 1.0;
      return { index: i, text: s, score: base * posWeight * headingWeight * cueBonus * danglingPenalty * narration };
    });

    const selected = [];
    const candidates = [...scored].sort((a, b) => b.score - a.score);
    const lambda = 0.72;
    while (selected.length < topK && candidates.length > 0) {
      let bestIdx = 0;
      let bestMmr = -Infinity;
      for (let i = 0; i < candidates.length; i++) {
        const cand = candidates[i];
        const maxSim = selected.reduce((max, sel) => Math.max(max, cosineSim(vectors[cand.index], vectors[sel.index])), 0);
        const mmr = lambda * cand.score - (1 - lambda) * maxSim;
        if (mmr > bestMmr) {
          bestMmr = mmr;
          bestIdx = i;
        }
      }
      selected.push(candidates.splice(bestIdx, 1)[0]);
    }

    selected.sort((a, b) => a.index - b.index);
    return { sentences: selected.map((x) => x.text), keyTerms, didacticBlocks, keyFormulas, definitions };
  }

  /**
   * Deck summary: the defining statements come first (one per slide before a slide's second), then ranked
   * prose from plain content slides. Worked problems, Q&A slides and tables never feed the overview.
   */
  function summarizeSlides(slides, topK = 8) {
    const model = dep('slideModel', './slide-model.js').normalize(slides);
    const sq = dep('slideQuiz', './slide-quiz.js');
    const definitions = model.definitions.map((d) => ({ term: d.term, definition: d.definition, page: d.page }));
    const topical = model.slides.filter((s) => (s.kind === 'content' && !s.isExample) || s.kind === 'section');
    const overview = summarizeText(sq.studyText(slides), { topK, headings: topical.map((s) => s.title), titles: topical.map((s) => s.title), definitions });
    const firstPerSlide = model.slides.flatMap((s) => s.definitions.slice(0, 1));
    const rest = model.slides.flatMap((s) => s.definitions.slice(1));
    const picked = new Set([...firstPerSlide, ...rest].slice(0, topK));
    const defining = model.definitions.filter((d) => picked.has(d)).map((d) => (/[.!?})\]]$/.test(d.statement) ? d.statement : `${d.statement}.`));
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const extra = overview.sentences.filter((s) => !defining.some((d) => norm(d).includes(norm(s).slice(0, 40)) || norm(s).includes(norm(d).slice(0, 40))));
    const slideBreakdown = model.slides
      .filter((s) => s.kind !== 'title' && s.kind !== 'section' && (s.bullets.length || s.qa.length || s.table))
      .map((s) => ({
        slideNumber: s.slideNumber, title: s.title, kind: s.kind,
        takeaways: s.kind === 'table' ? [] : s.bullets.filter((t) => !s.qa.some((q) => q.question === t || q.answer === t)).slice(0, s.qa.length || s.kind === 'question' ? 12 : 6),
        ...(s.qa.length ? { qa: s.qa.map((q) => ({ question: q.question, answer: q.answer })) } : {}),
        ...(s.table ? { table: s.table } : {}),
      }));
    return {
      overviewSentences: [...defining, ...extra].slice(0, topK),
      keyTerms: overview.keyTerms,
      keyFormulas: overview.keyFormulas,
      definitions,
      slideBreakdown,
      didacticBlocks: [],
    };
  }

  PDFStudy.summarizer = { summarizeText, summarizeSlides, scoreLuhn, scoreGraphCentrality };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.summarizer;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Hybrid Extractive Summarizer (TextRank + LexRank + Luhn + TF-IDF + MMR)
 * Prioritizes Conceptual Exposition, Theorems, Formulas & Algorithms while Filtering STEM/Publisher Noise.
 * Ranking kernels live in graph-rank.js and are re-exported here.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const damage = () => dep('summaryDamage', './summary-damage.js');

  function getDeps() {
    return {
      tokenizer: dep('tokenizer', './tokenizer.js'),
      noiseFilter: dep('noiseFilter', './noise-filter.js'),
      stemNoise: dep('stemNoise', './stem-noise.js'),
      stemCards: dep('stemCards', './stem-cards.js'),
      graphRank: dep('graphRank', './graph-rank.js'),
      statements: dep('summaryStatements', './summary-statements.js'),
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
    const bb = dep('bookBlocks', './book-blocks.js');
    const out = [];
    const seen = new Set();
    const said = [];
    const textKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 60);
    const add = (term, definition, page) => {
      const key = dm.termKey(term);
      // One entry per term, and one per defining sentence: a box and the sentence mined from it are the same definition
      if (!key || seen.has(key) || !definition || said.some((k) => k && textKey(definition).includes(k.slice(0, 40)))) return;
      seen.add(key);
      said.push(textKey(definition));
      out.push(page ? { term, definition, page } : { term, definition });
    };
    for (const b of didacticBlocks || []) {
      if (!/^Definition/i.test(b.category || '') || !b.title) continue;
      // "Definition 4" is the box's number, not its term: the term is read from the box's own wording
      const named = String(b.title).replace(/^Definitions?\s+of\s+(?:the\s+|an?\s+)?/i, '');
      const term = /^Definitions?\s*\d/i.test(named) ? (bb ? bb.boxTerm(b.body || '') : '') : named;
      if (term) add(term, stemCards.didacticBack(b), b.pageNumber);
    }
    for (const d of dm.mineText(text, splitSentences)) {
      if (!stemNoise.isUnusableSentence(d.definition) && !isDerivation(d.sentence)) add(d.term, d.definition);
    }
    return out;
  }

  // Ranking weight of a sentence carrying a structural cue (the ranked `sentences` the quiz draws from).
  const CUE_WEIGHT = 1.32;

  const scoreLuhn = (...a) => getDeps().graphRank.scoreLuhn(...a);
  const scoreGraphCentrality = (...a) => getDeps().graphRank.scoreGraphCentrality(...a);

  function summarizeText(text, options = {}) {
    const { topK = 7, headings = [], didacticBlocks = [] } = options;
    const { tokenizer, stemNoise, stemCards, graphRank, statements } = getDeps();
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

    const outline = options.outline ? bookOutlineOf(text, didacticBlocks, options.outline) : undefined;
    // The Summary's overview is the outline's own lead statements (complete, checked sentences, one per
    // section in reading order); ranking whole-scope sentences is for the quiz, which builds no outline.
    if (outline) {
      const lead = overviewOf(outline, topK);
      // The key terms are the ones the outline links to their definitions, never words ranked from examples
      const linked = (outline.terms || []).map((t) => t.term);
      // The Summary's list of definitions holds only those that read on their own, as the outline's do: never
      // an example passage that ends "This condition is called ..."
      const bo = dep('bookOutline', './book-outline.js');
      const readable = definitions
        // a definition box (it carries its page) is the book's own; a mined sentence must read on its own
        .filter((d) => d.page || bo.usableDefinition(d))
        // "is said to be in the set state" names "set state", not "In the set state"
        .map((d) => ({ ...d, term: String(d.term || '').replace(/^(?:in|into|at|on)\s+(?:the\s+|an?\s+)?/i, '').replace(/^[a-z]/, (c) => c.toUpperCase()), definition: bo.withoutAside(d.definition) }));
      // ... and every term the outline defines under its heading
      const key = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      for (const sec of outline.sections || []) {
        for (const d of sec.definitions || []) {
          if (!readable.some((r) => key(r.term) === key(d.term))) readable.push({ term: d.term, definition: d.text, page: d.page });
        }
      }
      return damage().clean({ sentences: lead, keyTerms: linked, didacticBlocks, keyFormulas, definitions: readable, outline });
    }
    if (rawSentences.length <= topK) {
      return { sentences: rawSentences, keyTerms, didacticBlocks, keyFormulas, definitions, outline };
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
      // Structural cue ("is defined as", "means that", "in general" ...): the same rule for every subject.
      const cueBonus = statements && statements.hasCue(s) ? CUE_WEIGHT : 1.0;
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
    return { sentences: selected.map((x) => x.text), keyTerms, didacticBlocks, keyFormulas, definitions, outline };
  }

  /**
   * Overview of a book outline: the first statement of each section, then second statements, in reading
   * order, up to topK. Every one already passed summary-statements.rejectReason in book-outline.js.
   */
  function overviewOf(outline, topK) {
    const secs = (outline.sections || []).map((s) => (s.statements || []).map((x) => x.text));
    const picked = [];
    for (let round = 0; picked.length < topK && secs.some((list) => list.length > round); round++) {
      secs.forEach((list, i) => { if (list[round] && picked.length < topK) picked.push({ text: list[round], i, round }); });
    }
    return picked.sort((a, b) => a.i - b.i || a.round - b.round).map((p) => p.text);
  }

  /**
   * The structured book summary (book-outline.js). scope: { parsedPdf?, pages?, startPage, endPage, title,
   * blocks?, tables?, lines? }; the raw pages give every statement its page and confirm headings by type size;
   * the extraction's tagged blocks, tables and line kinds (scope-builder.js) say what each line is.
   */
  function bookOutlineOf(text, didacticBlocks, scope) {
    const bo = dep('bookOutline', './book-outline.js');
    if (!bo) return undefined;
    const parsed = scope.parsedPdf;
    const pageOf = (n) => (parsed && parsed.pageCache && parsed.pageCache.get(n)) || ((parsed && parsed.pages) || []).find((p) => p && p.pageNumber === n);
    const pages = scope.pages || [];
    if (!pages.length && parsed && scope.startPage) {
      for (let n = scope.startPage; n <= (scope.endPage || scope.startPage); n++) if (pageOf(n)) pages.push(pageOf(n));
    }
    const blocks = scope.blocks && scope.blocks.length ? scope.blocks : didacticBlocks;
    // The page numbers printed in the book, for the lead line ("pages 146–168")
    const pp = dep('printedPages', '../pdf/printed-pages.js');
    const printed = pp && parsed ? { start: pp.printed(parsed, scope.startPage), end: pp.printed(parsed, scope.endPage) } : null;
    return bo.build(text, { pages, startPage: scope.startPage, endPage: scope.endPage, printed, didacticBlocks: blocks, tables: scope.tables, lines: scope.lines, title: scope.title });
  }

  /**
   * Deck summary: the defining statements come first (one per slide before a slide's second), then ranked
   * prose from plain content slides. Worked problems, Q&A slides and tables never feed the overview.
   */
  // A defined term is a name: a few words, never a clause ("Lameness is the 3rd most")
  const TERM_MAX_WORDS = 5;
  const realDefinition = (d) => {
    const term = String(d.term || '').replace(/\*\*/g, '').trim();
    return term && term.split(/\s+/).length <= TERM_MAX_WORDS && !/\b(?:is|are|was|were|the)\s*$|\b(?:is|are|was|were)\b/i.test(term);
  };

  function summarizeSlides(slides, topK = 8) {
    const model = dep('slideModel', './slide-model.js').normalize(slides);
    const sq = dep('slideQuiz', './slide-quiz.js');
    const definitions = model.definitions.filter(realDefinition).map((d) => ({ term: d.term, definition: d.definition, page: d.page }));
    const topical = model.slides.filter((s) => (s.kind === 'content' && !s.isExample) || s.kind === 'section');
    const overview = summarizeText(sq.studyText(slides), { topK, headings: topical.map((s) => s.title), titles: topical.map((s) => s.title), definitions });
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const outline = dep('deckOutline', './deck-outline.js').build(slides, { model });
    // One point per slide, in lecture order: the slide's defining statement when it has one, else the outline's
    // first point that reads as a statement (never a heading, a label or a scrap). The overview then takes
    // points spread over the whole lecture.
    const defining = new Map();
    model.slides.forEach((s) => {
      const d = (s.definitions || []).find(realDefinition);
      if (d) defining.set(s.slideNumber, /[.!?})\]]$/.test(d.statement) ? d.statement : `${d.statement}.`);
    });
    const points = [...defining].map(([page, text]) => ({ page, text }));
    deckStatements(outline).forEach((p) => {
      if (!defining.has(p.page) && !points.some((q) => norm(q.text).includes(norm(p.text).slice(0, 40)) || norm(p.text).includes(norm(q.text).slice(0, 40)))) points.push(p);
    });
    const lead = spread(points.sort((a, b) => a.page - b.page), topK).map((p) => p.text);
    const slideBreakdown = model.slides
      .filter((s) => s.kind !== 'title' && s.kind !== 'section' && (s.bullets.length || s.qa.length || s.table))
      .map((s) => ({
        slideNumber: s.slideNumber, title: s.title, kind: s.kind,
        // Every point of the slide: the topic-by-topic view (canvas pages) shows them all.
        takeaways: s.kind === 'table' ? [] : s.bullets.filter((t) => !s.qa.some((q) => q.question === t || q.answer === t)),
        ...(s.qa.length ? { qa: s.qa.map((q) => ({ question: q.question, answer: q.answer })) } : {}),
        ...(s.table ? { table: s.table } : {}),
      }));
    // A glyph the extraction could not read ("¿") is never shown: summary-damage.js
    return damage().clean({
      overviewSentences: lead,
      // Terms the outline links to their slides; without any, the ranked terms that are not a slide's title
      // ("Course objectives", "Mild disease" name slides, not concepts)
      keyTerms: (outline.terms || []).length
        ? outline.terms.map((t) => t.term)
        : overview.keyTerms.filter((t) => !model.slides.some((s) => norm(s.title || '') === norm(t))),
      keyFormulas: overview.keyFormulas,
      definitions,
      slideBreakdown,
      didacticBlocks: [],
      outline,
    });
  }

  // A point that states something: six words or more, mostly in running (lower-case) words, not a label.
  const STATEMENT_MIN_WORDS = 6;
  function readsAsStatement(text) {
    const t = String(text || '').replace(/\*\*|__/g, '').replace(/\$[^$]*\$/g, 'x').replace(/\s+/g, ' ').trim();
    const words = t.split(' ');
    if (words.length < STATEMENT_MIN_WORDS || /[:?]$/.test(t) || /¿|\s\|\s/.test(t)) return false;
    if (/\b(?:and|or|of|the|a|an|to|with|by|in|for|from|that|is|are)$/i.test(t)) return false; // cut off by the slide layout
    const lower = words.filter((w) => /^[a-z]/.test(w)).length;
    return lower / words.length >= 0.5;
  }

  /**
   * The first point of each slide in the deck outline that reads as a statement, in lecture order. A point
   * that does not name its subject ("Very poor absorption from the GI tract") is led by its topic's name.
   */
  function deckStatements(outline) {
    const out = [];
    const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 3);
    for (const sec of (outline && outline.sections) || []) {
      for (const tp of sec.topics || []) {
        // The slide's name without its brand names or asides: "Epsiprantel (Cestex®)" -> "Epsiprantel"
        const nameOf = (t) => String(t || '').replace(/\*\*/g, '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
        for (const e of tp.slides || []) {
          const subject = nameOf(e.title || tp.title || sec.title);
          const texts = (e.bullets || []).flatMap((b) => [b.text, ...(b.children || []).map((c) => (typeof c === 'string' ? c : c.text))]);
          const first = texts.find(readsAsStatement);
          if (!first) continue;
          const text = String(first).replace(/\*\*/g, '').trim();
          const named = words(subject).some((w) => words(text).includes(w));
          out.push({ page: e.slide || e.page, text: named || !subject || subject.split(' ').length > 6 ? text : `${subject} — ${text}` });
        }
      }
    }
    return out;
  }

  /** k items spread evenly over a list in order: the overview covers the whole lecture, not its first slides. */
  function spread(list, k) {
    if (list.length <= k) return list;
    return Array.from({ length: k }, (_, i) => list[Math.round((i * (list.length - 1)) / Math.max(1, k - 1))]);
  }

  PDFStudy.summarizer = { summarizeText, summarizeSlides, scoreLuhn, scoreGraphCentrality };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.summarizer;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Study material generation pipeline (extracted from main.js): builds summaries, flashcards,
 * quick quizzes, and full practice tests for the active slide or textbook scope.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function buildPracticeTest(input, text, opts = {}) {
    const { didacticBlocks = [], sections, mode = 'book', slides = [], seedOffset = 0, scopeTitle = '' } = opts;
    const eng = PDFStudy.testEngine;
    const gen = eng && (eng.generateTest || eng.generatePracticeTest);
    if (gen) {
      try {
        // Slide decks are passed as slide objects (kind / qa / definitions / table intact), never flattened to text.
        const arg = mode === 'slides' && Array.isArray(input) ? input : text;
        const callOpts = { didacticBlocks, mode, slides, seedOffset, maxQuestions: 20, scopeTitle };
        if (Array.isArray(sections) && sections.length) callOpts.sections = sections;
        const res = gen.call(eng, arg, callOpts);
        if (res) return res;
      } catch (_e) { /* fall back to quizEngine */ }
    }
    if (!PDFStudy.quizEngine) return null;
    const qs = PDFStudy.quizEngine.generateQuiz(input, {
      maxQuestions: 20,
      mode,
      didacticBlocks,
      seedOffset: seedOffset + 7,
    });
    return { title: `Practice test: ${scopeTitle}`, sections: [{ name: scopeTitle || 'Questions', questions: qs }], total: qs.length };
  }

  function testQuestionCount(testObj) {
    if (!testObj) return 0;
    if (Number.isFinite(testObj.total)) return testObj.total;
    if (Array.isArray(testObj)) return testObj.length;
    if (Array.isArray(testObj.questions)) return testObj.questions.length;
    if (Array.isArray(testObj.sections)) {
      return testObj.sections.reduce((sum, s) => sum + ((s.questions && s.questions.length) || 0), 0);
    }
    return 0;
  }

  /** Re-extract the slide deck from every loaded page (lazy documents and freshly recognised handwriting). */
  function refreshSlideDeck(appState) {
    const parsed = appState.parsedPdf;
    if (!parsed.isLazy || !parsed.pageCache) {
      appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck(parsed);
      return;
    }
    const loaded = Array.from(parsed.pageCache.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck({ pages: loaded });
  }

  /** Recount recognised handwriting over every loaded page (pages recognised earlier stay counted). */
  function countHandwriting(parsed) {
    const pages = loadedPages(parsed);
    const stats = { pages: 0, regions: 0, low: 0, skipped: 0 };
    for (const p of pages) {
      if (!p || !p.ink) continue;
      if (p.ink.skipped && !p.ink.recognised) stats.skipped++;
      if (!p.ink.recognised) continue;
      stats.pages++;
      for (const l of (p.ink.result && p.ink.result.lines) || []) stats.regions += (l.regions || []).length;
      if (PDFStudy.ocrLines) stats.low += PDFStudy.ocrLines.lowConfidence(p).length;
    }
    return stats;
  }

  function loadedPages(parsed) {
    const cache = parsed.pageCache;
    return cache && cache.size ? Array.from(cache.values()) : parsed.pages || [];
  }

  /** Share of loaded pages that look like ink (no text layer), whether or not they were read yet. */
  function inkShare(parsed) {
    const pages = loadedPages(parsed).filter(Boolean);
    if (!pages.length) return 1; // nothing loaded yet: cannot tell, let recognition decide
    return pages.filter((p) => p.ink && p.ink.needsRecognition).length / pages.length;
  }

  const countOf = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);

  /** Runs handwriting recognition for the scope (no-op for normal PDFs) and records appState.handwriting. */
  async function recogniseHandwriting(appState, startPage, endPage, opts) {
    const hwp = PDFStudy.hwPipeline;
    if (!hwp || !appState.parsedPdf) return;
    if (!opts.forceHandwriting && opts.handwriting === false) return;
    const current = () => !opts.isCurrent || opts.isCurrent();
    if (!opts.forceHandwriting && inkShare(appState.parsedPdf) < 0.2) { // a stray figure page in a typed document
      if (!appState.handwriting) appState.handwriting = { pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null };
      return;
    }
    let hw;
    try {
      hw = await hwp.ensureRecognised(appState.parsedPdf, startPage, endPage, {
        onProgress: opts.onHandwriting, onPageLoad: opts.onPageLoad, signal: opts.signal, retrySkipped: !!opts.retrySkipped,
      });
    } catch (err) {
      hw = { pages: 0, cancelled: false, engine: null, errors: [{ message: String((err && err.message) || err) }] };
    }
    if (!current()) return;
    const prev = appState.handwriting;
    if (!hw.pages && !hw.cancelled && !hw.engine && !hw.errors && !countOf(hw.skipped)) {
      if (!prev) appState.handwriting = { pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null };
      return;
    }
    const counted = countHandwriting(appState.parsedPdf);
    appState.handwriting = Object.assign(counted, {
      skipped: Math.max(counted.skipped, countOf(hw.skipped)),
      cancelled: !!hw.cancelled,
      engine: hw.engine || (prev && prev.engine) || null,
      failed: hw.errors ? hw.errors.length : 0,
    });
    if (hw.pages > 0 && appState.activeMode === 'slide_deck') refreshSlideDeck(appState);
  }

  const pageOf = (parsed, n) => (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n);

  /** Slides of the selected range; a recognised canvas page contributes one slide per block. */
  function scopeSlides(appState) {
    const { startPage, endPage } = appState.selectedScope;
    const slides = appState.slideDeck.slides.filter((s) => s.slideNumber >= startPage && s.slideNumber <= endPage);
    const cs = PDFStudy.ocrCanvasScope;
    return cs ? cs.expandSlides(slides, (n) => pageOf(appState.parsedPdf, n)) : slides;
  }

  /** Summary, cards, quiz and test from slide-shaped input; `sections` splits the test by topic. */
  function slideMaterials(appState, slides, title, sections) {
    const slideText = slides.map((s) => `${s.title}. ${(s.bullets || []).join('. ')}`).join('\n\n');
    const summary = PDFStudy.summarizer.summarizeSlides(slides, 7);
    const cs = PDFStudy.ocrCanvasScope;
    if (cs && slides.some((s) => s.pairs)) cs.decorateSummary(summary, slides);
    let flashcards = PDFStudy.flashcardEngine.extractSlideFlashcards(slides);
    if (cs && sections) flashcards = cs.completeCards(slides, flashcards);
    let quiz = PDFStudy.quizEngine.generateQuiz(slides, { maxQuestions: appState.quizCount, mode: 'slides', seedOffset: appState.quizSeed });
    let test = buildPracticeTest(slides, slideText, { mode: 'slides', slides, sections, scopeTitle: title });
    if (cs && sections) {
      const whole = buildPracticeTest(slides, slideText, { mode: 'slides', slides, scopeTitle: title });
      test = cs.mergeTests(test, whole, 20, 'Across topics');
      quiz = cs.topUpQuiz(quiz, test, appState.quizCount);
      summary.byTopic = true; // every topic is on the same page: number topics, not slides
      for (const c of flashcards) if (c && typeof c.context === 'string') c.context = c.context.replace(/^Slide \d+(: |$)/, '') || title;
    }
    appState.generated = { summary: { ...summary, sentences: summary.overviewSentences }, flashcards, quiz, test };
  }

  /** opts: { signal, onHandwriting, isCurrent?: () => boolean, retrySkipped?, forceHandwriting?, handwriting? }; stale runs commit nothing. */
  async function buildMaterials(appState, startPage, endPage, onProgress, opts = {}) {
    const { title } = appState.selectedScope;
    const current = () => !opts.isCurrent || opts.isCurrent();
    await recogniseHandwriting(appState, startPage, endPage, { ...opts, onPageLoad: onProgress });
    if (!current()) return;
    if (appState.activeMode === 'slide_deck') {
      if (appState.parsedPdf.isLazy && PDFStudy.pdfLoader.ensurePagesLoaded) {
        await PDFStudy.pdfLoader.ensurePagesLoaded(appState.parsedPdf, startPage, endPage, onProgress);
        if (!current()) return;
        refreshSlideDeck(appState);
      }
      slideMaterials(appState, scopeSlides(appState), title);
      return;
    }

    const scopeObj = await PDFStudy.bookHierarchy.extractScopeTextAsync(appState.parsedPdf, startPage, endPage, onProgress);
    if (!current()) return;
    appState.lastScopeObj = scopeObj;
    const cs = PDFStudy.ocrCanvasScope;
    if (cs && cs.useSlides(scopeObj)) { // mind-map pages: each block is a titled list of short notes, like a slide
      slideMaterials(appState, scopeObj.canvas.slides, title, cs.sectionsOf(scopeObj.canvas.topics));
      return;
    }
    const blocks = scopeObj.didacticBlocks || [];
    const summary = PDFStudy.summarizer.summarizeText(scopeObj.text, { topK: 7, headings: [title], didacticBlocks: blocks });
    const flashcards = PDFStudy.flashcardEngine.extractBookFlashcards(scopeObj.text, title, blocks);
    const quiz = PDFStudy.quizEngine.generateQuiz(scopeObj.text, { maxQuestions: appState.quizCount, mode: 'book', didacticBlocks: blocks, seedOffset: appState.quizSeed });
    const test = buildPracticeTest(scopeObj.text, scopeObj.text, { mode: 'book', didacticBlocks: blocks, sections: scopeObj.sections, scopeTitle: title });
    appState.generated = { summary, flashcards, quiz, test };
  }

  function regenerateQuiz(appState, newCount, newSeed) {
    appState.quizCount = newCount || 10;
    appState.quizSeed = newSeed || 0;
    const cs = PDFStudy.ocrCanvasScope;
    const canvas = appState.activeMode !== 'slide_deck' && cs && cs.useSlides(appState.lastScopeObj);
    const isSlide = appState.activeMode === 'slide_deck' || canvas;
    const input = canvas ? appState.lastScopeObj.canvas.slides
      : isSlide ? scopeSlides(appState) : (appState.lastScopeObj && appState.lastScopeObj.text) || '';
    const blocks = (!isSlide && appState.lastScopeObj && appState.lastScopeObj.didacticBlocks) || [];
    const quiz = PDFStudy.quizEngine.generateQuiz(input, {
      maxQuestions: appState.quizCount,
      mode: isSlide ? 'slides' : 'book',
      didacticBlocks: blocks,
      seedOffset: appState.quizSeed,
    });
    appState.generated.quiz = canvas ? cs.topUpQuiz(quiz, appState.generated.test, appState.quizCount) : quiz;
  }

  PDFStudy.studyPipeline = { buildMaterials, regenerateQuiz, buildPracticeTest, testQuestionCount, refreshSlideDeck };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyPipeline;
})(typeof window !== 'undefined' ? window : globalThis);

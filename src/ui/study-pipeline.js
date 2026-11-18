/**
 * Study material generation pipeline (extracted from main.js): builds summaries, flashcards,
 * quick quizzes, and full practice tests for the active slide or textbook scope.
 * Picture pages of the scope are read through study-reading.js. With opts.defer the typed text is built
 * first and the pages still to be read are handed back; readPending() reads them and rebuild() builds again.
 * What the engines are given (cards, tagged blocks and tables, flagged sources) is study-inputs.js: the quiz and
 * the practice test ask from the flashcards the student sees, and never ask again what the student flagged.
 *   practiceTest(appState, seed)  a new practice test for the scope (the Practice test tab's "New test")
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const reading = () => PDFStudy.studyReading || (typeof require === 'function' ? require('./study-reading.js') : null);
  const inputs = () => PDFStudy.studyInputs || (typeof require === 'function' ? require('./study-inputs.js') : null);

  function buildPracticeTest(input, text, opts = {}) {
    const { didacticBlocks = [], sections, mode = 'book', slides = [], seedOffset = 0, scopeTitle = '', cards, lines, excludeSources } = opts;
    const eng = PDFStudy.testEngine;
    const gen = eng && (eng.generateTest || eng.generatePracticeTest);
    if (gen) {
      try {
        // Slide decks are passed as slide objects (kind / qa / definitions / table intact), never flattened to text.
        const arg = mode === 'slides' && Array.isArray(input) ? input : text;
        const callOpts = { didacticBlocks, mode, slides, seedOffset, maxQuestions: 20, scopeTitle, cards, lines, excludeSources };
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
      cards,
      lines,
      excludeSources,
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

  /** Re-extract the slide deck from every loaded page (lazy documents and pages that were just read). */
  function refreshSlideDeck(appState) {
    const parsed = appState.parsedPdf;
    if (!parsed.isLazy || !parsed.pageCache) {
      appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck(parsed);
      return;
    }
    const loaded = Array.from(parsed.pageCache.values()).sort((a, b) => a.pageNumber - b.pageNumber);
    appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck({ pages: loaded });
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
    const ask = { cards: flashcards, excludeSources: inputs().excludedSources(appState) };
    let quiz = PDFStudy.quizEngine.generateQuiz(slides, { maxQuestions: appState.quizCount, mode: 'slides', seedOffset: appState.quizSeed, ...ask });
    let test = buildPracticeTest(slides, slideText, { mode: 'slides', slides, sections, scopeTitle: title, ...ask });
    if (cs && sections) {
      const whole = buildPracticeTest(slides, slideText, { mode: 'slides', slides, scopeTitle: title, ...ask });
      test = cs.mergeTests(test, whole, 20, 'Across topics');
      quiz = cs.topUpQuiz(quiz, test, appState.quizCount);
      summary.byTopic = true; // every topic is on the same page: number topics, not slides
      for (const c of flashcards) if (c && typeof c.context === 'string') c.context = c.context.replace(/^Slide \d+(: |$)/, '') || title;
    }
    appState.generated = { summary: { ...summary, sentences: summary.overviewSentences }, flashcards, quiz, test };
  }

  /** Reads the scope's picture pages (study-reading.js) and brings the slide deck up to date with what was read. */
  async function readPictures(appState, startPage, endPage, opts) {
    const R = reading();
    if (!R || !appState.parsedPdf) return { changed: false, pending: [] };
    const res = await R.read(appState, startPage, endPage, opts);
    const current = !opts.isCurrent || opts.isCurrent();
    if (current && res.changed && appState.activeMode === 'slide_deck') refreshSlideDeck(appState);
    return res;
  }

  /**
   * opts: { signal, onHandwriting, isCurrent?: () => boolean, retrySkipped?, forceHandwriting?, handwriting?, defer? }
   * Stale runs commit nothing. Resolves to { pending }: with opts.defer, the picture pages left to read after
   * the typed text was built (read them with readPending); otherwise always [].
   */
  async function buildMaterials(appState, startPage, endPage, onProgress, opts = {}) {
    const { title } = appState.selectedScope;
    const current = () => !opts.isCurrent || opts.isCurrent();
    const parsed = appState.parsedPdf;
    const loader = PDFStudy.pdfLoader;
    const lazyLoad = Boolean(parsed && parsed.isLazy && loader && loader.ensurePagesLoaded);
    const done = { pending: [] };
    // Load the selected range first: which of its pages need reading can only be judged once they are parsed
    // (a large document starts with a dozen sample pages, which say nothing about the pages selected here).
    if (lazyLoad) {
      await loader.ensurePagesLoaded(parsed, startPage, endPage, onProgress);
      if (!current()) return done;
    }
    await inputs().loadFlags(appState);
    if (!current()) return done;
    const read = await readPictures(appState, startPage, endPage, { ...opts, onPageLoad: onProgress });
    if (!current()) return done;
    done.pending = read.pending;
    if (appState.activeMode === 'slide_deck') {
      if (lazyLoad) refreshSlideDeck(appState);
      slideMaterials(appState, scopeSlides(appState), title);
      return done;
    }

    const scopeObj = await PDFStudy.bookHierarchy.extractScopeTextAsync(appState.parsedPdf, startPage, endPage, onProgress);
    if (!current()) return done;
    appState.lastScopeObj = scopeObj;
    const cs = PDFStudy.ocrCanvasScope;
    if (cs && cs.useSlides(scopeObj)) { // mind-map pages: each block is a titled list of short notes, like a slide
      slideMaterials(appState, scopeObj.canvas.slides, title, cs.sectionsOf(scopeObj.canvas.topics));
      return done;
    }
    const blocks = scopeObj.didacticBlocks || [];
    const summary = PDFStudy.summarizer.summarizeText(scopeObj.text, { headings: [title], didacticBlocks: blocks, outline: { parsedPdf: appState.parsedPdf, startPage: scopeObj.startPage, endPage: scopeObj.endPage, title, blocks: scopeObj.blocks, tables: scopeObj.tables, lines: scopeObj.lines } });
    // Cards read every tagged block (key concepts, self-checks, syntax boxes, numbered definitions) and table.
    const flashcards = PDFStudy.flashcardEngine.extractBookFlashcards(scopeObj.text, title, inputs().bookCardBlocks(scopeObj), { lines: scopeObj.lines });
    const ask = { cards: flashcards, lines: scopeObj.lines, excludeSources: inputs().excludedSources(appState) };
    const quiz = PDFStudy.quizEngine.generateQuiz(scopeObj.text, { maxQuestions: appState.quizCount, mode: 'book', didacticBlocks: blocks, seedOffset: appState.quizSeed, ...ask });
    const test = buildPracticeTest(scopeObj.text, scopeObj.text, { mode: 'book', didacticBlocks: blocks, sections: scopeObj.sections, scopeTitle: title, ...ask });
    appState.generated = { summary, flashcards, quiz, test };
    return done;
  }

  /**
   * Reads the pages a deferred build left (same opts as buildMaterials, plus onPageRead(pageNumber)). Builds
   * nothing: call rebuild() to bring the study material up to date, as often as wanted while this runs.
   */
  function readPending(appState, opts = {}) {
    const { startPage, endPage } = appState.selectedScope;
    return readPictures(appState, startPage, endPage, { ...opts, defer: false });
  }

  /** Builds the scope's study material again from the pages as they now are, without starting the reader. */
  async function rebuild(appState, opts = {}) {
    const { startPage, endPage } = appState.selectedScope;
    if (appState.activeMode === 'slide_deck') refreshSlideDeck(appState);
    await buildMaterials(appState, startPage, endPage, () => {}, { isCurrent: opts.isCurrent, handwriting: false });
  }

  function regenerateQuiz(appState, newCount, newSeed) {
    appState.quizCount = newCount || 10;
    appState.quizSeed = newSeed || 0;
    const cs = PDFStudy.ocrCanvasScope;
    const { canvas } = inputs().asSlides(appState);
    const quiz = PDFStudy.quizEngine.generateQuiz(inputs().quizInput(appState, scopeSlides), {
      ...inputs().engineOptions(appState),
      maxQuestions: appState.quizCount,
      seedOffset: appState.quizSeed,
    });
    appState.generated.quiz = canvas ? cs.topUpQuiz(quiz, appState.generated.test, appState.quizCount) : quiz;
  }

  /** A new practice test for the selected scope, drawn with `seed`, from the same inputs as the first build. */
  function practiceTest(appState, seed) {
    const opts = inputs().engineOptions(appState);
    const input = inputs().quizInput(appState, scopeSlides);
    const text = Array.isArray(input) ? input.map((s) => `${s.title}. ${(s.bullets || []).join('. ')}`).join('\n\n') : input;
    const sections = appState.lastScopeObj && opts.mode === 'book' ? appState.lastScopeObj.sections : undefined;
    return buildPracticeTest(input, text, {
      ...opts, slides: Array.isArray(input) ? input : [], sections, seedOffset: seed || 0, scopeTitle: appState.selectedScope.title,
    });
  }

  PDFStudy.studyPipeline = { buildMaterials, readPending, rebuild, regenerateQuiz, practiceTest, buildPracticeTest, testQuestionCount, refreshSlideDeck };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyPipeline;
})(typeof window !== 'undefined' ? window : globalThis);

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

  async function buildMaterials(appState, startPage, endPage, onProgress) {
    const { title } = appState.selectedScope;
    if (appState.activeMode === 'slide_deck') {
      if (appState.parsedPdf.isLazy && PDFStudy.pdfLoader.ensurePagesLoaded) {
        await PDFStudy.pdfLoader.ensurePagesLoaded(appState.parsedPdf, startPage, endPage, onProgress);
        const loaded = Array.from(appState.parsedPdf.pageCache.values()).sort((a, b) => a.pageNumber - b.pageNumber);
        appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck({ pages: loaded });
      }
      const scopedSlides = appState.slideDeck.slides.filter((s) => s.slideNumber >= startPage && s.slideNumber <= endPage);
      const slideText = scopedSlides.map((s) => `${s.title}. ${(s.bullets || []).join('. ')}`).join('\n\n');
      const summary = PDFStudy.summarizer.summarizeSlides(scopedSlides, 7);
      const flashcards = PDFStudy.flashcardEngine.extractSlideFlashcards(scopedSlides);
      const quiz = PDFStudy.quizEngine.generateQuiz(scopedSlides, { maxQuestions: appState.quizCount, mode: 'slides', seedOffset: appState.quizSeed });
      const test = buildPracticeTest(scopedSlides, slideText, { mode: 'slides', slides: scopedSlides, scopeTitle: title });
      appState.generated = { summary: { ...summary, sentences: summary.overviewSentences }, flashcards, quiz, test };
      return;
    }

    const scopeObj = await PDFStudy.bookHierarchy.extractScopeTextAsync(appState.parsedPdf, startPage, endPage, onProgress);
    appState.lastScopeObj = scopeObj;
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
    const isSlide = appState.activeMode === 'slide_deck';
    const input = isSlide
      ? appState.slideDeck.slides.filter(
          (s) => s.slideNumber >= appState.selectedScope.startPage && s.slideNumber <= appState.selectedScope.endPage
        )
      : (appState.lastScopeObj && appState.lastScopeObj.text) || '';
    const blocks = (!isSlide && appState.lastScopeObj && appState.lastScopeObj.didacticBlocks) || [];
    appState.generated.quiz = PDFStudy.quizEngine.generateQuiz(input, {
      maxQuestions: appState.quizCount,
      mode: isSlide ? 'slides' : 'book',
      didacticBlocks: blocks,
      seedOffset: appState.quizSeed,
    });
  }

  PDFStudy.studyPipeline = { buildMaterials, regenerateQuiz, buildPracticeTest, testQuestionCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyPipeline;
})(typeof window !== 'undefined' ? window : globalThis);

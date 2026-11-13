/**
 * Main Application Controller — Coordinates Lazy PDF State, Smart Default Scope, Split View & Study Tabs.
 * Material generation lives in study-pipeline.js. Every render re-syncs the tab bar and the outline
 * selection from appState.activeTab / appState.selectedScope, so the chrome can never drift.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  if (typeof PDFStudy.ENABLE_HANDWRITING !== 'boolean') PDFStudy.ENABLE_HANDWRITING = false;

  const appState = {
    docName: '',
    parsedPdf: null,
    classification: null,
    activeMode: 'slide_deck', // 'slide_deck' | 'book'
    slideDeck: null,
    bookHierarchy: null,
    selectedScope: { id: 'all', type: 'all', title: 'Entire document', startPage: 1, endPage: 1 },
    activeTab: 'summary', // 'summary' | 'flashcards' | 'quiz' | 'test' | 'reader'
    splitView: false,
    currentReaderPage: 1,
    readerScale: 1.3,
    quizCount: 10,
    quizSeed: 0,
    lastScopeObj: null,
    handwriting: null, // { pages, regions, low, cancelled, engine } once handwritten pages were read
    generated: { summary: null, flashcards: [], quiz: [], test: null },
  };

  let runToken = 0;
  let runCtrl = null;

  function abortRun() {
    runToken++; // any run in flight is now stale
    if (runCtrl) runCtrl.abort();
    runCtrl = null;
  }

  async function processLoadedDocument(docName, parsedPdf) {
    abortRun();
    if (PDFStudy.hwPipeline && PDFStudy.hwPipeline.dispose) PDFStudy.hwPipeline.dispose();
    if (PDFStudy.hwReview) PDFStudy.hwReview.close();
    appState.docName = docName;
    appState.parsedPdf = parsedPdf;
    appState.classification = PDFStudy.classifier.classifyDocument(parsedPdf);
    appState.activeMode = appState.classification.type;
    appState.handwriting = null;
    const ink = PDFStudy.inkDetect && PDFStudy.inkDetect.summarise(parsedPdf);
    if (ink && ink.share >= 0.5) { // ink-only pages are prose, not slides
      appState.activeMode = 'book';
      const extra = PDFStudy.ENABLE_HANDWRITING ? ['Handwritten or scanned pages: text is read on this device'] : [];
      appState.classification = Object.assign({}, appState.classification, {
        type: 'book',
        reasons: extra.concat(appState.classification.reasons || []),
      });
    }
    appState.slideDeck = PDFStudy.slideExtractor.extractSlideDeck(parsedPdf);
    appState.bookHierarchy = PDFStudy.bookHierarchy.extractBookHierarchy(parsedPdf);
    appState.quizSeed = 0;
    appState.activeTab = 'summary';
    if (PDFStudy.sidebarTree.resetFilter) PDFStudy.sidebarTree.resetFilter();

    setDefaultScope();
    renderDocumentHeader();
    document.body.classList.add('has-doc');
    document.getElementById('workspaceArea').classList.remove('hidden');
    renderSidebarScopeTree();
    if (PDFStudy.readerControls) PDFStudy.readerControls.initReaderControls(appState);
    await recomputeStudyMaterials();
  }

  function setDefaultScope() {
    const total = appState.parsedPdf ? appState.parsedPdf.numPages : 1;
    if (appState.activeMode === 'slide_deck') {
      appState.selectedScope = { id: 'all-slides', type: 'all_slides', title: `All slides (1–${total})`, startPage: 1, endPage: total };
      appState.currentReaderPage = 1;
      return;
    }
    const chapters = (appState.bookHierarchy && appState.bookHierarchy.chapters) || [];
    const ch1 = chapters.find((c) => !c.isExtra && /\bchapter\s+1\b/i.test(c.title)) || chapters.find((c) => !c.isExtra) || chapters[0];
    if (ch1) {
      const firstSec = (ch1.sections || []).find((s) => !s.isExtra) || (ch1.sections || [])[0];
      appState.selectedScope = firstSec
        ? { id: firstSec.id, type: 'section', title: `${firstSec.title} (${ch1.title})`, label: firstSec.title, context: ch1.title, startPage: firstSec.startPage, endPage: firstSec.endPage }
        : { id: ch1.id, type: 'chapter', title: ch1.title, startPage: ch1.startPage, endPage: ch1.endPage };
      appState.currentReaderPage = appState.selectedScope.startPage;
    } else {
      appState.selectedScope = { id: 'all-book', type: 'all_book', title: `Pages 1–${Math.min(total, 15)}`, startPage: 1, endPage: Math.min(total, 15) };
      appState.currentReaderPage = 1;
    }
  }

  /** Top bar: document title, type badge (opens the "why / switch mode" panel) and page count. */
  function renderDocumentHeader() {
    const isSlide = appState.activeMode === 'slide_deck';
    const pages = appState.parsedPdf.numPages;
    const reasons = (appState.classification.reasons || []).join(' · ');
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; return el; };
    set('docTypeBadge', isSlide ? 'Slides' : 'Textbook');
    const titleEl = set('docTitleText', appState.docName);
    if (titleEl) titleEl.title = appState.docName;
    set('docPagesText', `${pages} ${pages === 1 ? 'page' : 'pages'}`);
    set('docKindText', isSlide ? 'Read as class slides' : 'Read as a textbook');
    set('docReasonsText', reasons || 'Detected from the page layout.');
    set('toggleModeBtn', isSlide ? 'Treat as textbook' : 'Treat as slides');
    document.title = `${appState.docName} · PDF Study Suite`;
  }

  /** Scope selection from the outline; tabName ('quiz') makes "Quiz this section" one click. */
  async function selectScope(newScope, pageNum, tabName) {
    appState.selectedScope = newScope;
    if (pageNum) appState.currentReaderPage = pageNum;
    appState.quizSeed = 0;
    if (tabName) appState.activeTab = tabName;
    if (PDFStudy.shell) PDFStudy.shell.closeDrawer();
    renderSidebarScopeTree();
    root.scrollTo(0, 0);
    await recomputeStudyMaterials();
  }

  function renderSidebarScopeTree() {
    PDFStudy.sidebarTree.renderSidebarScopeTree(appState, selectScope);
  }

  function updateCounts() {
    const g = appState.generated;
    const valid = (list, mod) => (list || []).filter((x) => !PDFStudy[mod] || PDFStudy[mod].isValid(x)).length;
    PDFStudy.tabs.setCounts({
      flashcards: valid(g.flashcards, 'flashcardFaces'),
      quiz: valid(g.quiz, 'quizCard'),
      test: PDFStudy.testView ? PDFStudy.testView.count(g.test, appState.selectedScope.title) : 0,
    });
  }

  async function recomputeStudyMaterials(options) {
    const retrySkipped = !!(options && options.retrySkipped);
    const { startPage, endPage } = appState.selectedScope;
    const L = PDFStudy.loading;
    const P = PDFStudy.studyPipeline;
    const panel = document.getElementById('activeStudyPanel');
    const onProgress = (cur, tot, pNum) => L.update(cur, tot, `Page ${pNum} (${cur} of ${tot})`);
    const hwUi = PDFStudy.hwReview;
    const useHw = !!PDFStudy.ENABLE_HANDWRITING;
    if (runCtrl) runCtrl.abort();
    const token = ++runToken;
    const isCurrent = () => token === runToken;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    runCtrl = ctrl;
    const cancel = ctrl ? () => ctrl.abort() : null;
    const onHandwriting = (p) => {
      if (cancel) L.showCancel(cancel);
      if (hwUi) hwUi.reportProgress(L, p);
    };
    if (PDFStudy.testView && PDFStudy.testView.reset) PDFStudy.testView.reset();
    if (hwUi) { hwUi.close(); hwUi.syncNotice(null); }
    panel.classList.remove('hidden');
    const ink = useHw && PDFStudy.inkDetect && PDFStudy.hwPipeline ? PDFStudy.inkDetect.pagesNeeding(appState.parsedPdf, startPage, endPage) : [];
    L.start(panel, 'Reading pages', ink.length && cancel ? { onCancel: cancel } : undefined);
    try {
      await P.buildMaterials(appState, startPage, endPage, onProgress, { signal: ctrl && ctrl.signal, onHandwriting, isCurrent, retrySkipped, handwriting: useHw });
    } catch (err) {
      if (!isCurrent()) return;
      L.end();
      panel.innerHTML = PDFStudy.studyViews.emptyState("Couldn't build study materials", String((err && err.message) || err));
      PDFStudy.tabs.sync();
      return;
    }
    if (!isCurrent()) return;
    if (runCtrl === ctrl) runCtrl = null;
    L.end();
    if (hwUi) hwUi.syncNotice(useHw ? appState.handwriting : null);
    renderSidebarScopeTree(); // lazy documents refine the slide list while pages load
    updateCounts();
    renderActiveTab();
  }

  function regenerateQuiz(newCount, newSeed) {
    PDFStudy.studyPipeline.regenerateQuiz(appState, newCount, newSeed);
    updateCounts();
    renderActiveTab();
  }

  function renderActiveTab() {
    const viewEl = document.getElementById('activeStudyPanel');
    const readerEl = document.getElementById('pdfReaderPanel');
    const splitWrap = document.getElementById('studyAndReaderSplit');
    if (PDFStudy.hwReview) PDFStudy.hwReview.close(); // leaving the review panel releases its crops
    const scopeTitle = appState.selectedScope.label || appState.selectedScope.title; // views show the short label
    const isReader = appState.activeTab === 'reader';
    const showReader = isReader || appState.splitView;

    PDFStudy.tabs.sync();
    if (PDFStudy.readerControls) PDFStudy.readerControls.syncSplitBtn(appState);
    splitWrap.classList.toggle('split-active', !isReader && appState.splitView);
    viewEl.classList.toggle('hidden', isReader);
    readerEl.classList.toggle('hidden', !showReader);
    if (showReader && PDFStudy.readerControls) PDFStudy.readerControls.renderReaderPage(appState);
    if (isReader) return;

    const sv = PDFStudy.studyViews;
    const g = appState.generated;
    if (appState.activeTab === 'summary') sv.renderSummaryView(viewEl, g.summary, scopeTitle);
    else if (appState.activeTab === 'flashcards') sv.renderFlashcardsView(viewEl, g.flashcards, appState.docName, scopeTitle);
    else if (appState.activeTab === 'quiz') sv.renderQuizView(viewEl, g.quiz, scopeTitle);
    else if (appState.activeTab === 'test') sv.renderTestView(viewEl, scopeTitle, g.test);
  }

  PDFStudy.main = {
    appState,
    processLoadedDocument,
    setDefaultScope,
    renderDocumentHeader,
    renderSidebarScopeTree,
    recomputeStudyMaterials,
    regenerateQuiz,
    renderActiveTab,
    selectScope,
    renderReaderPage: () => PDFStudy.readerControls && PDFStudy.readerControls.renderReaderPage(appState),
  };
})(typeof window !== 'undefined' ? window : globalThis);

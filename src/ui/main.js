/**
 * Main Application Controller — Coordinates Lazy PDF State, Smart Default Scope, Split View & Study Tabs.
 * Material generation lives in study-pipeline.js, the cancellable build around it in build-run.js,
 * and the explained empty states in study-states.js. Every render re-syncs the tab bar and the outline
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
    counts: { flashcards: 0, quiz: 0, test: 0 }, // what the tab counters show (valid items only)
    verdict: null, // docVerdict.documentVerdict: { kind: 'blank' | 'pictures' | 'text', ... }
    shownRange: null, // { startPage, endPage } the last build read (a long selection is read in windows)
    runState: null, // { kind: 'stopped' | 'failed', detail? } when the last build did not finish
    typeChosen: false, // the student switched slides/textbook by hand
  };

  const noMaterials = () => ({ summary: null, flashcards: [], quiz: [], test: null });
  const AVAILABILITY_WAIT_MS = 1500;

  async function processLoadedDocument(docName, parsedPdf) {
    // a file opened in the page's first moments: wait (briefly) until it is known whether pictures can be read
    if (PDFStudy.hwAvailability && PDFStudy.hwAvailability.settled) await PDFStudy.hwAvailability.settled(AVAILABILITY_WAIT_MS);
    PDFStudy.buildRun.abort();
    if (PDFStudy.hwPipeline && PDFStudy.hwPipeline.dispose) PDFStudy.hwPipeline.dispose();
    if (PDFStudy.hwReview) {
      PDFStudy.hwReview.close();
      PDFStudy.hwReview.syncNotice(null);
    }
    appState.docName = docName;
    appState.parsedPdf = parsedPdf;
    appState.classification = PDFStudy.classifier.classifyDocument(parsedPdf);
    appState.activeMode = appState.classification.type;
    appState.handwriting = null;
    appState.verdict = PDFStudy.docVerdict.documentVerdict(parsedPdf);
    appState.generated = noMaterials();
    appState.shownRange = null;
    appState.runState = null;
    appState.typeChosen = false;
    appState.quizSeed = 0;
    appState.activeTab = 'summary';
    if (PDFStudy.sidebarTree.resetFilter) PDFStudy.sidebarTree.resetFilter();
    if (appState.verdict.kind === 'blank') {
      openBlankDocument();
      return;
    }
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

    setDefaultScope();
    if (PDFStudy.docSession) await PDFStudy.docSession.open(appState); // stored progress; may restore the last section and tab
    showWorkspace();
    await recomputeStudyMaterials();
  }

  function showWorkspace() {
    renderDocumentHeader();
    document.body.classList.add('has-doc');
    document.getElementById('workspaceArea').classList.remove('hidden');
    renderSidebarScopeTree();
    if (PDFStudy.readerControls) PDFStudy.readerControls.initReaderControls(appState);
  }

  /**
   * Every page is blank (a notes app exported the notebook without its handwriting): no outline
   * of made-up chapters and nothing to build, just the explanation in every study tab.
   */
  function openBlankDocument() {
    const total = appState.parsedPdf.numPages;
    appState.activeMode = 'book';
    appState.slideDeck = { slides: [] };
    appState.bookHierarchy = { source: 'none', chapters: [] };
    appState.selectedScope = { id: 'all-book', type: 'all_book', title: appState.docName, startPage: 1, endPage: total };
    appState.currentReaderPage = 1;
    showWorkspace();
    updateCounts();
    renderActiveTab();
    PDFStudy.studyStates.announce(PDFStudy.studyStates.deadEnd(appState).title);
  }

  /** Back to the start screen (used when a file opened but could not be worked through). */
  function closeDocument() {
    PDFStudy.buildRun.abort();
    appState.parsedPdf = null;
    appState.docName = '';
    appState.verdict = null;
    appState.generated = noMaterials();
    document.body.classList.remove('has-doc');
    document.getElementById('workspaceArea').classList.add('hidden');
    document.title = 'PDF Study Suite';
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
      const end = Math.min(total, 15);
      appState.selectedScope = { id: 'all-book', type: 'all_book', title: end > 1 ? `Pages 1–${end}` : 'Page 1', startPage: 1, endPage: end };
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
    const toggle = set('toggleModeBtn', isSlide ? 'Treat as textbook' : 'Treat as slides');
    const blank = !!appState.verdict && appState.verdict.kind === 'blank';
    if (toggle) toggle.classList.toggle('hidden', blank); // blank pages are neither slides nor a textbook
    // Nothing to export from blank pages: an empty study guide would be one more dead end.
    document.querySelectorAll('[data-export]').forEach((b) => b.classList.toggle('hidden', blank));
    if (blank) {
      set('docTypeBadge', 'Blank pages');
      set('docKindText', 'Nothing to read');
      set('docReasonsText', 'Every page that was checked is blank.');
    }
    if (PDFStudy.shell) PDFStudy.shell.syncTypeHint(appState);
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
    appState.counts = {
      flashcards: valid(g.flashcards, 'flashcardFaces'),
      quiz: valid(g.quiz, 'quizCard'),
      test: PDFStudy.testView ? PDFStudy.testView.count(g.test, appState.selectedScope.title) : 0,
    };
    PDFStudy.tabs.setCounts(appState.counts);
  }

  /** Builds study material for the selected scope (progress, Cancel and failure handling: build-run.js). */
  function recomputeStudyMaterials(options) {
    return PDFStudy.buildRun.run(options);
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
    if (PDFStudy.docSession) PDFStudy.docSession.afterRender(appState); // remember section + tab, refresh the due badge
    if (PDFStudy.readerControls) PDFStudy.readerControls.syncSplitBtn(appState);
    splitWrap.classList.toggle('split-active', !isReader && appState.splitView);
    viewEl.classList.toggle('hidden', isReader);
    readerEl.classList.toggle('hidden', !showReader);
    if (showReader && PDFStudy.readerControls) PDFStudy.readerControls.renderReaderPage(appState);
    if (isReader) return;
    // Blank export, pictures of text, a stopped or failed build: the pane explains instead of sitting empty
    if (PDFStudy.studyStates.renderDeadEnd(viewEl, appState)) return;

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
    closeDocument,
    updateCounts,
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

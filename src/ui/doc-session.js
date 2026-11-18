/**
 * The open document's study state: loaded once from doc-store.js when the document opens, read
 * synchronously by the views, saved shortly after every change and when the page is hidden.
 *   open(appState)         load (or start) the state, move old localStorage marks over, and put the
 *                          student back on the section and tab they left
 *   afterRender(appState)  remember the section and tab, refresh the Flashcards tab's due badge
 *   state()                the state object (nlp/doc-state.js); always usable, even with no storage
 *   change(fn, { user })   apply fn(state) and save; `user` marks a click or key press
 *   deck(generated)        generated cards merged with stored state for the selected scope
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (name, file) => PDFStudy[name] || (typeof require === 'function' ? require(file) : null);
  const D = () => need('docState', '../nlp/doc-state.js');
  const K = () => need('studyKeys', '../nlp/study-keys.js');
  const M = () => need('deckMerge', '../nlp/deck-merge.js');
  const store = () => need('docStore', './doc-store.js');

  const SAVE_DELAY_MS = 250;
  const TABS = ['summary', 'flashcards', 'quiz', 'test', 'reader'];
  let current = null; // { id, name, pdf, state, loaded }
  let saveTimer = null;
  let warnedNotSaving = false;

  const app = () => (PDFStudy.main && PDFStudy.main.appState) || null;

  function idOf(appState) {
    const pdf = appState.parsedPdf || {};
    const prints = pdf.pdfDoc && pdf.pdfDoc.fingerprints;
    return K().docId({
      fingerprint: prints && prints[0],
      name: appState.docName,
      size: pdf.byteLength || 0,
      numPages: pdf.numPages,
    });
  }

  function flush() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (current && current.loaded) store().saveDoc(current.id, current.state);
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** "Known" marks from the old localStorage format are applied once, then removed from it. */
  function migrateLegacy(session) {
    const legacy = PDFStudy.storage && PDFStudy.storage.takeLegacyKnown;
    const fronts = legacy ? legacy(session.name) : [];
    if (fronts.length && D().migrateLegacyKnown(session.state, fronts)) scheduleSave();
  }

  function scopeStillExists(appState, scope) {
    const total = (appState.parsedPdf && appState.parsedPdf.numPages) || 0;
    if (!scope || !(scope.startPage >= 1) || scope.endPage > total || scope.startPage > scope.endPage) return false;
    if (appState.activeMode === 'slide_deck' || scope.type === 'custom_range' || scope.type === 'all_book') return true;
    const chapters = (appState.bookHierarchy && appState.bookHierarchy.chapters) || [];
    const nodes = chapters.concat(...chapters.map((c) => c.sections || []));
    return nodes.some((n) => n.id === scope.id && n.startPage === scope.startPage && n.endPage === scope.endPage);
  }

  /** Back to where the student left off, when that section still exists in the outline. */
  function restoreView(appState, view) {
    if (!view || view.mode !== appState.activeMode || !scopeStillExists(appState, view.scope)) return;
    appState.selectedScope = { ...view.scope };
    appState.currentReaderPage = view.scope.startPage;
    if (TABS.includes(view.tab)) appState.activeTab = view.tab;
  }

  async function open(appState, opts) {
    flush(); // the previous document's last changes
    const session = { id: idOf(appState), name: appState.docName, pdf: appState.parsedPdf, state: D().empty(), loaded: false };
    current = session;
    const stored = await store().loadDoc(session.id);
    if (current !== session) return; // another document was opened while this one loaded
    session.state = D().upgrade(stored);
    session.loaded = true;
    migrateLegacy(session);
    if (!opts || opts.restore !== false) restoreView(appState, session.state.view);
  }

  function state() {
    const a = app();
    if (a && a.parsedPdf && (!current || current.pdf !== a.parsedPdf)) {
      // The document was not opened through open() (its call in main.js is missing): load it now
      // and redraw once the stored state is in.
      open(a, { restore: false }).then(() => PDFStudy.main.renderActiveTab());
    }
    if (!current) current = { id: 'detached', name: '', pdf: null, state: D().empty(), loaded: false };
    return current.state;
  }

  /** Said once, the first time the student changes something that cannot be kept. */
  function warnIfNotSaving() {
    if (warnedNotSaving || store().mode() !== 'memory' || !PDFStudy.events) return;
    warnedNotSaving = true;
    PDFStudy.events.setStatus('This browser is not saving your progress (private window or blocked storage). It stays until you close this tab.', true);
  }

  function change(fn, opts) {
    const result = fn(state());
    scheduleSave();
    if (opts && opts.user) {
      store().persist();
      warnIfNotSaving();
    }
    return result;
  }

  function scope() {
    const a = app();
    const sc = a && a.selectedScope;
    return sc ? { id: sc.id, startPage: sc.startPage, endPage: sc.endPage } : null;
  }

  const deck = (generated) => M().mergeDeck(generated, state(), scope());

  function afterRender(appState) {
    if (!current || !current.loaded || current.pdf !== appState.parsedPdf) return;
    const sc = appState.selectedScope;
    const view = {
      tab: appState.activeTab,
      mode: appState.activeMode,
      scope: { id: sc.id, type: sc.type, title: sc.title, label: sc.label, context: sc.context, startPage: sc.startPage, endPage: sc.endPage },
    };
    if (D().setView(current.state, view)) scheduleSave();
    if (PDFStudy.dueBadge) PDFStudy.dueBadge.update(appState);
  }

  if (typeof document !== 'undefined') {
    root.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }

  const api = { open, afterRender, state, change, scope, deck, flush, id: () => (current ? current.id : null) };
  PDFStudy.docSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

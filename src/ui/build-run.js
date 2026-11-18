/**
 * One build of study material for the selected scope: progress, Cancel, and an explained ending
 * whichever way it goes (finished, stopped by the student, or failed). Only the newest run may
 * touch the screen; the outline stays usable while it works, so picking another section simply
 * starts a new run. Generation itself is study-pipeline.js; main.js owns appState and rendering.
 * When a selection has typed text and picture pages, the typed text is built and shown first and the
 * pictures are read afterwards without blocking (background-read.js); the run's token and controller
 * stay in force until that reading ends, so Stop, a new selection and a new document all end it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const STOP_GRACE_MS = 4000; // reading pictures stops at the next page; past this the run is dropped

  let runToken = 0;
  let runCtrl = null;

  const emptyMaterials = () => ({ summary: null, flashcards: [], quiz: [], test: null });

  /** Makes any run in flight stale and stops what can be stopped (reading in the background included). */
  function abort() {
    runToken += 1;
    if (runCtrl) runCtrl.abort();
    runCtrl = null;
    if (PDFStudy.backgroundRead) PDFStudy.backgroundRead.hide();
  }

  /** Shows the stopped / failed state; if a view itself is what broke, the state goes in directly. */
  function showRunState(st) {
    const M = PDFStudy.main;
    const panel = document.getElementById('activeStudyPanel');
    try {
      M.updateCounts();
      M.renderActiveTab();
    } catch (_err) {
      panel.classList.remove('hidden');
      PDFStudy.studyStates.renderDeadEnd(panel, st);
    }
    const first = panel.querySelector('[data-state-act]');
    if (first) first.focus();
  }

  function endWith(st, runState) {
    PDFStudy.loading.end();
    st.generated = emptyMaterials();
    st.shownRange = null;
    st.runState = runState;
    showRunState(st);
    const state = PDFStudy.studyStates.deadEnd(st);
    if (state) PDFStudy.studyStates.announce(state.title);
  }

  /** The student pressed Cancel: drop the run and say so, with a way back. */
  function stop(token) {
    if (token !== runToken) return;
    abort();
    endWith(PDFStudy.main.appState, { kind: 'stopped' });
  }

  /** The page range this run read: a long textbook selection is read one window at a time. */
  function rangeRead(st) {
    const { startPage, endPage } = st.selectedScope;
    const obj = st.activeMode === 'book' ? st.lastScopeObj : null;
    if (obj && Number.isFinite(obj.endPage)) return { startPage, endPage: Math.min(endPage, obj.endPage) };
    return { startPage, endPage };
  }

  /** options: { retrySkipped?, forceHandwriting? } (both only matter when pictures of text can be read). */
  async function run(options) {
    const opts = options || {};
    const M = PDFStudy.main;
    const st = M.appState;
    const L = PDFStudy.loading;
    const hwUi = PDFStudy.hwReview;
    const useHw = !!PDFStudy.ENABLE_HANDWRITING; // read on every run: it can change while the app is open
    const { startPage, endPage } = st.selectedScope;
    const panel = document.getElementById('activeStudyPanel');

    if (runCtrl) runCtrl.abort();
    const token = ++runToken;
    const isCurrent = () => token === runToken;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    runCtrl = ctrl;
    let reading = false;
    let finished = false;

    const cancel = () => {
      if (!reading || !ctrl) {
        stop(token);
        return;
      }
      // Reading pictures of text stops through its signal and keeps the pages already read
      ctrl.abort();
      setTimeout(() => { if (!finished) stop(token); }, STOP_GRACE_MS);
    };
    const onProgress = (cur, tot, pNum) => {
      if (isCurrent()) L.update(cur, tot, `Page ${pNum} (${cur} of ${tot})`);
    };
    const onHandwriting = (p) => {
      if (!isCurrent()) return;
      reading = true;
      if (hwUi) hwUi.reportProgress(L, p);
    };

    if (PDFStudy.testView && PDFStudy.testView.reset) PDFStudy.testView.reset();
    if (PDFStudy.backgroundRead) PDFStudy.backgroundRead.hide();
    if (hwUi) {
      hwUi.close();
      hwUi.syncNotice(null);
    }
    panel.classList.remove('hidden');
    st.runState = null;
    L.start(panel, 'Reading pages', { onCancel: cancel, keepOutline: true });

    let later = null; // picture pages left to read once the typed text is on screen
    try {
      const built = await PDFStudy.studyPipeline.buildMaterials(st, startPage, endPage, onProgress, {
        signal: ctrl && ctrl.signal,
        onHandwriting,
        isCurrent,
        retrySkipped: !!opts.retrySkipped,
        forceHandwriting: useHw && !!opts.forceHandwriting,
        handwriting: useHw,
        defer: !!PDFStudy.backgroundRead,
      });
      if (!isCurrent()) return;
      finished = true;
      later = built && built.pending && built.pending.length ? built.pending : null;
      if (runCtrl === ctrl && !later) runCtrl = null; // kept while reading goes on, so a new run can stop it
      L.end();
      st.shownRange = rangeRead(st);
      if (hwUi) hwUi.syncNotice(useHw ? st.handwriting : null);
      M.renderSidebarScopeTree(); // lazy documents refine the slide list while pages load
      M.updateCounts();
      M.renderActiveTab();
    } catch (err) {
      if (!isCurrent()) return;
      finished = true;
      endWith(st, { kind: 'failed', detail: String((err && err.message) || err) });
      return;
    }
    if (PDFStudy.scopeNotes) PDFStudy.scopeNotes.afterRender();
    const state = PDFStudy.studyStates.deadEnd(st);
    if (state) PDFStudy.studyStates.announce(state.title);
    // Cancel while pictures were read ends here too: the Cancel button is gone, so keyboard focus goes to
    // the state's first way on ("Read the rest") instead of falling back to the top of the page.
    const lost = !document.activeElement || document.activeElement === document.body;
    const way = state && lost ? panel.querySelector('[data-state-act]') : null;
    if (way) way.focus({ preventScroll: true });
    if (later) {
      // not awaited: the run is over for the student, reading carries on beside it (background-read.js)
      PDFStudy.backgroundRead.start({
        pages: later,
        ctrl,
        isCurrent,
        options: { retrySkipped: !!opts.retrySkipped, forceHandwriting: useHw && !!opts.forceHandwriting },
        done: () => { if (runCtrl === ctrl) runCtrl = null; },
      });
    }
  }

  PDFStudy.buildRun = { run, abort };
})(typeof window !== 'undefined' ? window : globalThis);

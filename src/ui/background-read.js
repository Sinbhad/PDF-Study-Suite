/**
 * Reading picture pages after the typed text is already on screen. build-run.js shows the first build, then
 * hands the pages still to be read to start(). A strip above the study pane says how far the reading is
 * ("Reading 7 of 24 picture pages…") and carries a Stop button. The study material is built again every
 * BATCH_PAGES pages and once more at the end.
 * An update never takes the keyboard focus and never scrolls the page. The Summary (and any empty tab) is
 * redrawn in place; flashcards, a quiz or a practice test are left exactly as they are, because the student
 * may be in the middle of them, and the strip offers "Show new material" instead.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const BATCH_PAGES = 8;
  const STRIP_ID = 'readProgress';
  let running = Promise.resolve(); // the latest reading; settled when none is in flight
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function strip(create) {
    let el = document.getElementById(STRIP_ID);
    if (el || !create) return el;
    const notice = document.getElementById('hwNotice');
    if (!notice) return null;
    el = document.createElement('div');
    el.id = STRIP_ID;
    el.className = 'hw-notice';
    el.innerHTML = '<p class="hw-notice-text"></p><button class="btn btn-secondary btn-sm" type="button"></button>';
    notice.parentNode.insertBefore(el, notice);
    return el;
  }

  /** Shows the strip. The button is kept (and keeps the focus) while only the text changes. */
  function show(text, action) {
    const el = strip(true);
    if (!el) return;
    el.classList.remove('hidden');
    el.querySelector('.hw-notice-text').textContent = text;
    const btn = el.querySelector('button');
    btn.classList.toggle('hidden', !action);
    if (!action) return;
    btn.disabled = false;
    btn.textContent = action.label;
    btn.onclick = action.run;
  }

  function hide() {
    const el = strip(false);
    if (el) el.classList.add('hidden');
  }

  const say = (text) => PDFStudy.studyStates && PDFStudy.studyStates.announce(text);

  /** The practice test keeps its sheet between renders: true when the student has answered or submitted it. */
  function testInProgress() {
    const view = PDFStudy.testView;
    return !!(view && view.inProgress && view.inProgress());
  }

  /** True when the pane shows something the student may be working through. */
  function busyView(st, panel) {
    if (panel.querySelector('.hw-review')) return true; // the check-what-was-read panel
    if (st.activeTab === 'summary' || st.activeTab === 'reader') return false;
    if (panel.querySelector('.empty')) return false;
    // an untouched practice test can be replaced; flashcards and a quiz keep no such record, so they are left alone
    return st.activeTab === 'test' && PDFStudy.testView && PDFStudy.testView.inProgress ? testInProgress() : true;
  }

  /** Redraws `draw`'s part of the page with the scroll position and the focused control left where they were. */
  function keepingPlace(area, draw) {
    const x = root.scrollX || 0;
    const y = root.scrollY || 0;
    const top = area.scrollTop;
    const focused = document.activeElement;
    const focusId = focused && area.contains(focused) ? focused.id : '';
    draw();
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) again.focus({ preventScroll: true });
    }
    area.scrollTop = top;
    if (root.scrollTo) root.scrollTo(x, y);
  }

  /** A control inside `area` has the focus and could not be found again after a redraw. */
  function focusWouldBeLost(area) {
    const focused = document.activeElement;
    return !!focused && area.contains(focused) && !focused.id;
  }

  /**
   * Puts freshly built material on screen without disturbing the student. Returns true when what is on screen
   * is now up to date, false when it was left alone (the caller then offers "Show new material").
   */
  function showUpdate(st, final) {
    const M = PDFStudy.main;
    const panel = document.getElementById('activeStudyPanel');
    const rail = document.getElementById('outlineRail');
    M.updateCounts();
    if (final && rail && !focusWouldBeLost(rail)) keepingPlace(rail, () => M.renderSidebarScopeTree());
    if (st.activeTab === 'reader') return true;
    if (!panel || busyView(st, panel) || focusWouldBeLost(panel)) return false;
    keepingPlace(panel, () => {
      if (st.activeTab === 'test' && PDFStudy.testView && PDFStudy.testView.reset) PDFStudy.testView.reset();
      M.renderActiveTab();
    });
    return true;
  }

  /** The student asked for the new material: every view starts again from it. */
  function showNow() {
    const M = PDFStudy.main;
    if (PDFStudy.testView && PDFStudy.testView.reset) PDFStudy.testView.reset();
    hide();
    M.updateCounts();
    M.renderActiveTab();
    const tab = document.getElementById(`tab-${M.appState.activeTab}`);
    if (tab) tab.focus();
  }

  function progressText(p, total) {
    if (!p || p.phase === 'model') return 'Getting the page reader ready…';
    const at = Math.min(total, (p.pageIndex || 0) + 1);
    return `Reading ${at} of ${plural(p.pageCount || total, 'picture page')}…`;
  }

  /**
   * Pages waiting for this run carry page.ink.reading = true, so "Check what was read" (hw-check-model.js) shows
   * them as still being read. Each page belongs to the run that marked it last: a run that was replaced never
   * clears the mark a newer run put on the same page.
   */
  const readingBy = new WeakMap();

  function pageOf(parsed, n) {
    if (!parsed) return null;
    return (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n) || null;
  }

  function refreshCheck() {
    if (PDFStudy.hwCheck && PDFStudy.hwCheck.refresh) PDFStudy.hwCheck.refresh();
  }

  function markReading(parsed, numbers, job) {
    for (const n of numbers) {
      const page = pageOf(parsed, n);
      if (!page) continue;
      page.ink = page.ink || { needsRecognition: true, reason: 'no-text', pathOps: 0, imageOps: 0 };
      page.ink.reading = true;
      readingBy.set(page, job);
    }
    refreshCheck();
  }

  function clearReading(parsed, numbers, job) {
    let any = false;
    for (const n of numbers) {
      const page = pageOf(parsed, n);
      if (!page || !page.ink || readingBy.get(page) !== job) continue;
      page.ink.reading = false;
      readingBy.delete(page);
      any = true;
    }
    if (any) refreshCheck();
  }

  /**
   * job: { pages: number[], ctrl: ?AbortController, isCurrent: () => boolean, options: { retrySkipped?, forceHandwriting? }, done: () => void }
   * Resolves when the reading has ended (finished, stopped, or replaced by a newer run). Never rejects.
   */
  function start(job) {
    running = readAndUpdate(job);
    return running;
  }

  async function readAndUpdate(job) {
    const M = PDFStudy.main;
    const SP = PDFStudy.studyPipeline;
    const st = M.appState;
    const total = job.pages.length;
    const options = job.options || {};
    let stopping = false;
    const stop = {
      label: 'Stop',
      run: () => {
        stopping = true;
        show('Stopping…', null); // the reader lets go at its next piece
        if (job.ctrl) job.ctrl.abort();
      },
    };
    let lastText = '';
    const progress = (p) => {
      if (!job.isCurrent() || stopping) return;
      const text = progressText(p, total);
      if (text !== lastText) show(text, job.ctrl ? stop : null);
      lastText = text;
    };
    let sinceUpdate = 0;
    let building = Promise.resolve();
    let upToDate = true;
    const update = (final) => {
      building = building.then(async () => {
        if (!job.isCurrent()) return;
        await SP.rebuild(st, { isCurrent: job.isCurrent });
        if (job.isCurrent()) upToDate = showUpdate(st, final);
      }).catch(() => {});
      return building;
    };

    const parsed = st.parsedPdf;
    markReading(parsed, job.pages, job);
    progress(null);
    say(`Reading ${plural(total, 'picture page')} in the background.`);
    try {
      await SP.readPending(st, {
        signal: job.ctrl && job.ctrl.signal,
        isCurrent: job.isCurrent,
        retrySkipped: !!options.retrySkipped,
        forceHandwriting: !!options.forceHandwriting,
        handwriting: true,
        onHandwriting: progress,
        onPageRead: (pageNumber) => {
          clearReading(parsed, [pageNumber], job);
          sinceUpdate += 1;
          if (sinceUpdate < BATCH_PAGES) return;
          sinceUpdate = 0;
          update(false);
        },
      });
      if (!job.isCurrent()) return;
      await update(true);
      if (!job.isCurrent()) return;
      finish(st, upToDate);
    } catch (_err) {
      if (job.isCurrent()) hide(); // the first build stays on screen
    } finally {
      clearReading(parsed, job.pages, job); // stopped, failed or finished: nothing of this run is still being read
      job.done(); // a run that replaced this one hides the strip itself (build-run.js)
    }
  }

  /** The reading has ended: the notice reports the counts; the strip stays only to offer the new material. */
  function finish(st, upToDate) {
    const hw = st.handwriting || {};
    if (PDFStudy.hwReview) PDFStudy.hwReview.syncNotice(hw);
    const stopped = hw.cancelled || hw.skipped > 0;
    const inTest = testInProgress();
    // a practice test nobody has touched is simply made again; one on screen was already handled by showUpdate
    if (!inTest && st.activeTab !== 'test' && PDFStudy.testView && PDFStudy.testView.reset) PDFStudy.testView.reset();
    if (upToDate && !inTest) {
      hide();
      say(stopped ? 'Reading stopped. The study material includes the pages that were read.' : 'Finished reading. The study material now includes the picture pages.');
      return;
    }
    show('New study material is ready from the pages that were read.', { label: 'Show new material', run: showNow });
    say('New study material is ready from the pages that were read.');
  }

  PDFStudy.backgroundRead = { start, hide, whenIdle: () => running, BATCH_PAGES };
})(typeof window !== 'undefined' ? window : globalThis);

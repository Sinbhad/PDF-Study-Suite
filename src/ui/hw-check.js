/**
 * "Check what was read": the full-screen dialog (index.html #hwCheck) for checking and fixing the text
 * read from pictures, one page at a time, with the page image beside its lines. This file is the frame:
 * opening and closing, which page is shown, the header, focus, what is announced, and
 * noticing pages that finish being read while the dialog is open. What each button and key does to a page
 * is hw-check-actions.js; the views are hw-page-view.js, hw-check-lines.js and hw-check-states.js.
 *   hwCheck.open({ startPage?, opener? })   false when no page was read
 *   hwCheck.close() / hwCheck.isOpen() / hwCheck.refresh()
 * Nothing is rebuilt while the dialog is open; on close hwReview.afterCheck gets what was done.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const POLL_MS = 800; // how often pages still being read are looked at again
  const SHORT_VIEW = 500; // px of visible height below which an on-screen keyboard is taken to be open
  const TYPE_KINDS = ['type', 'unread'];

  const byId = (id) => document.getElementById(id);
  const M = () => PDFStudy.hwCheckModel;
  const T = () => PDFStudy.hwCheckText;
  const L = () => PDFStudy.hwCheckLines;
  const pane = () => byId('hwLinesBody');
  const esc = (s) => PDFStudy.studyViews.escapeHtml(s);
  let S = null; // the open session
  let bound = false;

  /** Whether pictures of text can be read here (a page that cannot be read is typed in instead). */
  function env() {
    const probe = PDFStudy.hwAvailability;
    const hw = PDFStudy.main.appState.handwriting;
    const off = PDFStudy.ENABLE_HANDWRITING === false || (probe && probe.available === false) || (hw && hw.engine && hw.engine.available === false);
    return { available: !off };
  }

  const page = () => M().pageOf(S.parsed, S.pageNumber);
  const entries = () => M().pages(S.parsed, env());
  const rows = () => M().rows(page());
  const total = () => S.parsed.numPages || entries().length;
  const signature = (list) => list.map((e) => `${e.pageNumber}:${e.status}:${e.toCheck}`).join('|');

  function announce(text) {
    const live = byId('hwCheckLive');
    live.textContent = '';
    setTimeout(() => { if (S) live.textContent = text; }, 60);
  }

  function syncHead(list, entry) {
    const select = byId('hwPageSelect');
    const labels = list.map((e) => T().optionLabel(e));
    if (select.getAttribute('data-labels') !== labels.join('|')) {
      select.innerHTML = list.map((e, i) => `<option value="${e.pageNumber}">${esc(labels[i])}</option>`).join('');
      select.setAttribute('data-labels', labels.join('|'));
    }
    select.value = String(S.pageNumber);
    const reading = list.filter((e) => e.status === 'reading').length;
    byId('hwCheckStatus').textContent = T().progress(entry, total(), reading);
    byId('hwPrevPageBtn').disabled = !list.some((e) => e.pageNumber < S.pageNumber);
    byId('hwNextPageBtn').disabled = !list.some((e) => e.pageNumber > S.pageNumber);
    S.view.setCount(T().stateWords(entry, false));
  }

  function setCurrent(id) {
    S.currentId = id;
    L().setCurrent(pane(), id);
    S.view.setCurrent(id);
  }

  /** focus: { id } a line | 'first' | 'primary' | 'title' | null (leave focus where it is). */
  function applyFocus(focus) {
    if (!focus) return;
    const box = pane();
    if (focus.id != null) {
      if (L().focusField(box, focus.id)) {
        if (S.currentId !== focus.id) setCurrent(focus.id); // focus events do not arrive in a window that is not in front
        return;
      }
      const kept = Array.from(box.querySelectorAll('[data-act="use-text"]')).find((b) => b.getAttribute('data-id') === String(focus.id));
      if (kept) {
        setCurrent(focus.id);
        kept.focus();
        return;
      }
    }
    if (focus === 'primary' && byId('hwPrimaryBtn')) {
      byId('hwPrimaryBtn').focus();
      return;
    }
    if (focus === 'first' && S.kind === 'lines') {
      const list = rows();
      const first = list.find((r) => r.state === 'check') || list.find((r) => r.state !== 'picture');
      if (first) {
        applyFocus({ id: first.id });
        return;
      }
    }
    const target = (S.kind === 'type' && byId('hwTypeArea')) || byId('hwLinesTitle') || byId('hwStateTitle') || byId('hwTypeTitle');
    if (target) target.focus();
  }

  /** Draws the lines pane (or the state that stands in for it) and the header for the page being shown. */
  function render(focus) {
    const list = entries();
    const entry = list.find((e) => e.pageNumber === S.pageNumber) || M().entry(page(), env());
    const kind = S.typing ? 'type' : entry.status;
    const last = !list.some((e) => e.pageNumber > S.pageNumber);
    if (kind === 'lines') {
      const shown = rows();
      L().sync(pane(), { pageNumber: S.pageNumber, rows: shown, currentId: S.currentId, left: entry.toCheck, last });
      S.view.setRows(shown);
    } else {
      const now = list.find((e) => e.status === 'reading');
      pane().innerHTML = PDFStudy.hwCheckStates.html(kind, {
        pageNumber: S.pageNumber, total: total(), last, left: entry.toCheck, draft: S.draft,
        guesses: kind === 'hard' && (M().rows(page()).length || M().guesses(page())),
        readingPage: now && now.pageNumber,
        reason: (PDFStudy.hwAvailability && PDFStudy.hwAvailability.reason) || '',
      });
      S.currentId = null;
      S.view.setRows([]);
      S.view.setCurrent(null);
    }
    // Typing a page in needs the whole page in view (on a phone the strip otherwise shows one line)
    const typing = TYPE_KINDS.includes(kind);
    if (typing && !S.wholeForTyping) S.view.setWhole(true);
    if (!typing && S.wholeForTyping) S.view.setWhole(false);
    S.wholeForTyping = typing;
    S.kind = kind;
    byId('hwCheck').setAttribute('data-kind', kind);
    syncHead(list, entry);
    S.sig = signature(list);
    list.forEach((e) => S.seen.set(e.pageNumber, e.status));
    applyFocus(focus);
  }

  function showPage(pageNumber, focus) {
    S.pageNumber = pageNumber;
    S.currentId = null;
    S.typing = false;
    S.draft = '';
    pane().innerHTML = '';
    S.view.show({ pdfDoc: S.parsed.pdfDoc, page: page(), rows: [] });
    render(null);
    const entry = entries().find((e) => e.pageNumber === pageNumber) || M().entry(page(), env());
    announce(T().pageAnnouncement(entry, total()));
    byId('hwLinesPane').scrollTop = 0;
    applyFocus(focus || 'first');
  }

  /** Pages finish being read while the dialog is open: say so, and show the page if it is the one on screen. */
  function poll() {
    if (!S) return;
    if (PDFStudy.main.appState.parsedPdf !== S.parsed) { // another document was opened behind the dialog
      S.quiet = true;
      byId('hwCheck').close();
      return;
    }
    const list = entries();
    if (signature(list) === S.sig) return;
    const ready = list.filter((e) => S.seen.get(e.pageNumber) === 'reading' && e.status !== 'reading');
    const here = ready.some((e) => e.pageNumber === S.pageNumber);
    if (here) showPage(S.pageNumber, byId('hwLinesBody').contains(document.activeElement) ? 'first' : null);
    else render(null);
    if (ready.length && !here) announce(`Page ${ready[0].pageNumber} is ready to check.`);
  }

  /** With an on-screen keyboard up, the dialog ends where the keyboard begins and the strip gets shorter. */
  function onViewport() {
    const vv = root.visualViewport;
    const dialog = byId('hwCheck');
    if (!vv || !S || !dialog) return;
    dialog.style.setProperty('--hw-vh', `${Math.round(vv.height)}px`);
    dialog.classList.toggle('is-short', vv.height < SHORT_VIEW);
  }

  function onKey(e) {
    if (!S || e.isComposing) return;
    const t = e.target;
    const where = t.matches && t.matches('[data-field]') ? 'field' : t.id === 'hwPageScroll' ? 'image' : 'other';
    const action = PDFStudy.hwCheckKeys.actionFor(e, where);
    if (!action) return;
    e.preventDefault();
    if (S.view.act(action)) return;
    const row = t.closest ? t.closest('.hw-line') : null;
    PDFStudy.hwCheckActions.run(action, row ? row.getAttribute('data-id') : S.currentId);
  }

  function finish() {
    if (!S) return;
    clearInterval(S.timer);
    PDFStudy.hwCheckUndo.clear();
    S.view.dispose();
    pane().innerHTML = '';
    const done = { lines: S.done.lines.size, pictures: S.done.pictures.size, typed: S.done.typed.size };
    const { opener, quiet } = S;
    S = null;
    if (!quiet && PDFStudy.hwReview) PDFStudy.hwReview.afterCheck(done, opener);
  }

  function bindOnce(dialog) {
    if (bound) return;
    bound = true;
    const A = PDFStudy.hwCheckActions;
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('[data-act]') : null;
      if (btn && S && !btn.disabled) A.run(btn.getAttribute('data-act'), btn.getAttribute('data-id'));
    });
    byId('hwPageSelect').addEventListener('change', (e) => A.run('goto', Number(e.target.value)));
    dialog.addEventListener('cancel', () => A.flush()); // Esc: what was typed is kept, then the dialog closes itself
    dialog.addEventListener('close', finish);
    L().bind(pane(), {
      focus: (id) => { if (S && S.currentId !== id) setCurrent(id); },
      commit: (id) => { if (S) A.run('commit', id); },
      hover: (id) => { if (S) S.view.setHover(id); },
    });
    if (root.visualViewport) root.visualViewport.addEventListener('resize', onViewport);
  }

  function open(opts) {
    const o = opts || {};
    const dialog = byId('hwCheck');
    const st = PDFStudy.main && PDFStudy.main.appState;
    if (!dialog || !st || !st.parsedPdf || S || typeof dialog.showModal !== 'function') return false;
    const list = M().pages(st.parsedPdf, env());
    if (!list.length) return false;
    bindOnce(dialog);
    S = {
      parsed: st.parsedPdf, opener: o.opener || document.activeElement, pageNumber: null, currentId: null,
      typing: false, draft: '', kind: '', quiet: false, sig: '', seen: new Map(), timer: null,
      done: { lines: new Set(), pictures: new Set(), typed: new Set() },
    };
    byId('hwCheckDoc').textContent = st.docName || '';
    byId('hwStoreNote').classList.toggle('hidden', !(PDFStudy.docStore && PDFStudy.docStore.mode() === 'memory'));
    S.view = PDFStudy.hwPageView.create(byId('hwImagePane'), {
      onPick: (id) => applyFocus({ id }),
      onHover: (id) => L().setHover(pane(), id),
    });
    dialog.showModal();
    onViewport();
    const start = list.some((e) => e.pageNumber === o.startPage) ? o.startPage : M().startPage(list, st.selectedScope);
    showPage(start, 'first');
    S.timer = setInterval(poll, POLL_MS);
    return true;
  }

  function close() {
    if (!S) return;
    PDFStudy.hwCheckActions.flush();
    byId('hwCheck').close();
  }

  PDFStudy.hwCheck = {
    open, close, refresh: poll, isOpen: () => Boolean(S),
    // what hw-check-actions.js works with
    session: () => S, env, page, rows, entries, render, showPage, setCurrent, applyFocus, announce,
  };
})(typeof window !== 'undefined' ? window : globalThis);

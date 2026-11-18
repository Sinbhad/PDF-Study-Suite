/**
 * Notes under the selection title of every study view: which pages of a long selection are
 * showing, with Previous / Next controls (the page arithmetic is scope-pager.js), and a one-line
 * reason when a quiz or practice test came out with only one or two questions.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  let focusAfterRender = ''; // 'prev' | 'next' once a pager button was used

  const state = () => (PDFStudy.main ? PDFStudy.main.appState : null);
  const pages = (n) => (n === 1 ? 'page' : `${n} pages`);

  function currentWindow(st) {
    if (!st || !st.parsedPdf || !PDFStudy.scopePager) return null;
    return PDFStudy.scopePager.windowOf(st.selectedScope, st.shownRange);
  }

  function pagerHtml(st) {
    const win = currentWindow(st);
    if (!win) return '';
    const button = (dir, label) => `<button class="btn btn-secondary btn-sm" type="button" data-scope-shift="${dir}">${label}</button>`;
    return `<div class="scope-pager" role="group" aria-label="Pages of this selection">
        <span class="scope-pager-text nums">${PDFStudy.scopePager.describe(win)}</span>
        ${win.prev ? button('prev', `Previous ${pages(win.prev)}`) : ''}
        ${win.next ? button('next', `Next ${pages(win.next)}`) : ''}
      </div>`;
  }

  function fewHtml(st) {
    const tab = st.activeTab;
    const states = PDFStudy.studyStates;
    if (!states || !PDFStudy.thinResults || (tab !== 'quiz' && tab !== 'test')) return '';
    const count = (st.counts || {})[tab] || 0;
    const ctx = states.thinContext(st);
    const note = PDFStudy.thinResults.fewNote(count, ctx.what, ctx.facts);
    if (!note) return '';
    const esc = PDFStudy.studyViews.escapeHtml;
    const longer = st.activeMode === 'slide_deck' ? 'Pick other slides' : 'Pick a longer section';
    const cards = ctx.cards > 0
      ? ` or <button class="btn-link note-link" type="button" data-state-act="tab:flashcards">review ${ctx.cards} flashcard${ctx.cards === 1 ? '' : 's'}</button>`
      : '';
    return `<p class="view-note">${esc(note)} <button class="btn-link note-link" type="button" data-state-act="outline">${longer}</button>${cards}.</p>`;
  }

  /** Markup appended to the view header ('' when there is nothing to say). */
  function headHtml() {
    const st = state();
    if (!st || !st.parsedPdf) return '';
    return pagerHtml(st) + fewHtml(st);
  }

  function onClick(e) {
    const btn = e.target.closest ? e.target.closest('[data-scope-shift]') : null;
    const st = state();
    if (!btn || btn.disabled || !st) return;
    const dir = btn.getAttribute('data-scope-shift');
    const next = PDFStudy.scopePager.shift(st.selectedScope, st.shownRange, dir);
    if (!next) return;
    focusAfterRender = dir;
    PDFStudy.main.selectScope(next, next.startPage);
  }

  /** After a build: put keyboard focus back on the pager and say which pages are showing. */
  function afterRender() {
    if (!focusAfterRender) return;
    const dir = focusAfterRender;
    focusAfterRender = '';
    const panel = document.getElementById('activeStudyPanel');
    const btn = panel && (panel.querySelector(`[data-scope-shift="${dir}"]`) || panel.querySelector('[data-scope-shift]'));
    if (btn) btn.focus({ preventScroll: true });
    const win = currentWindow(state());
    if (win && PDFStudy.studyStates) PDFStudy.studyStates.announce(PDFStudy.scopePager.describe(win));
  }

  if (typeof document !== 'undefined') document.addEventListener('click', onClick);

  PDFStudy.scopeNotes = { headHtml, afterRender };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.scopeNotes;
})(typeof window !== 'undefined' ? window : globalThis);

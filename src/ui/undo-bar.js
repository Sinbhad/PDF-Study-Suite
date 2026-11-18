/**
 * "Done. Undo" bar for actions that take effect at once (delete a card, remove a bad question).
 * No confirm dialog: the action happens, and for a few seconds one button takes it back.
 *   const pending = undoBar.start({ message, undo, onExpire })   starts the countdown
 *   undoBar.html(pending, { floating })                          markup for the view's own template
 *   undoBar.bind(container, pending, afterUndo)                  wires the Undo button
 *   pending.clear()                                              stops the countdown without undoing
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const UNDO_MS = 7000;
  let started = 0;

  function start(opts) {
    const pending = { id: `undo-${++started}`, message: opts.message, done: false };
    pending.clear = () => {
      clearTimeout(pending.timer);
      pending.done = true;
    };
    pending.undo = () => {
      if (pending.done) return false;
      pending.clear();
      opts.undo();
      return true;
    };
    pending.timer = setTimeout(() => {
      pending.done = true;
      if (opts.onExpire) opts.onExpire();
    }, UNDO_MS);
    return pending;
  }

  /** opts.floating pins the bar to the bottom of the window, for pages that scroll away from the action. */
  function html(pending, opts) {
    if (!pending || pending.done) return '';
    const cls = opts && opts.floating ? 'undo-bar is-floating' : 'undo-bar';
    const esc = PDFStudy.studyViews.escapeHtml;
    return `<div class="${cls}" data-undo-bar="${pending.id}">
        <span class="undo-text">${esc(pending.message)}</span>
        <button class="btn btn-secondary btn-sm" type="button" data-undo title="Shortcut: U">Undo</button>
      </div>`;
  }

  function bind(container, pending, afterUndo) {
    const btn = pending && container.querySelector(`[data-undo-bar="${pending.id}"] [data-undo]`);
    if (!btn) return;
    btn.onclick = () => { if (pending.undo() && afterUndo) afterUndo(); };
  }

  /** Take an expired bar off the screen; focus moves to `focusEl` if it was on the Undo button. */
  function dismiss(container, pending, focusEl) {
    const bar = container.querySelector(`[data-undo-bar="${pending.id}"]`);
    if (!bar) return;
    const hadFocus = bar.contains(document.activeElement);
    bar.remove();
    if (hadFocus && focusEl) focusEl.focus();
  }

  PDFStudy.undoBar = { UNDO_MS, start, html, bind, dismiss };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.undoBar;
})(typeof window !== 'undefined' ? window : globalThis);

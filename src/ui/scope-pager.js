/**
 * Page-window arithmetic for selections longer than one build reads (scope-builder.js reads at
 * most 25 pages of a textbook selection). Works out which pages are showing, and builds the
 * page-range scope for the window before or after it. Pure functions; no DOM.
 *
 * A window scope is an ordinary custom range that remembers where it came from:
 *   parent: { id, title, startPage, endPage, size, scope }   (scope = the original selection)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const range = (a, b) => (b > a ? `${a}–${b}` : `${a}`);

  /** The whole selection a scope belongs to: its parent when it is a window, else itself. */
  function wholeOf(scope) {
    return scope.parent || {
      id: scope.id,
      title: scope.label || scope.title,
      startPage: scope.startPage,
      endPage: scope.endPage,
      size: 0,
      scope,
    };
  }

  /**
   * shown: { startPage, endPage } actually read for `scope`.
   * -> null when every page of the selection is showing, else
   *    { from, to, wholeFrom, wholeTo, prev, next } where prev/next are page counts (0 = none).
   */
  function windowOf(scope, shown) {
    if (!scope || !shown) return null;
    const whole = wholeOf(scope);
    const from = Math.max(whole.startPage, shown.startPage);
    const to = Math.min(whole.endPage, shown.endPage);
    if (from <= whole.startPage && to >= whole.endPage) return null;
    const size = whole.size || to - from + 1;
    return {
      from,
      to,
      wholeFrom: whole.startPage,
      wholeTo: whole.endPage,
      size,
      prev: Math.min(size, from - whole.startPage),
      next: Math.min(size, whole.endPage - to),
    };
  }

  /** The scope for the window before (dir 'prev') or after (dir 'next') the one showing; null at an end. */
  function shift(scope, shown, dir) {
    const win = windowOf(scope, shown);
    if (!win) return null;
    const count = dir === 'prev' ? win.prev : win.next;
    if (!count) return null;
    const whole = wholeOf(scope);
    const start = dir === 'prev' ? Math.max(win.wholeFrom, win.from - win.size) : win.to + 1;
    const end = dir === 'prev' ? win.from - 1 : win.to + count;
    // Back at the first window, the original selection itself is selected again
    if (start === win.wholeFrom && whole.scope) return whole.scope;
    return {
      id: `custom-${start}-${end}`,
      type: 'custom_range',
      title: `Pages ${range(start, end)}`,
      context: whole.title,
      startPage: start,
      endPage: end,
      parent: Object.assign({}, whole, { size: win.size }),
    };
  }

  /** "Showing pages 1–25 of 1–60" */
  function describe(win) {
    return `Showing pages ${range(win.from, win.to)} of ${range(win.wholeFrom, win.wholeTo)}`;
  }

  PDFStudy.scopePager = { windowOf, shift, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.scopePager;
})(typeof window !== 'undefined' ? window : globalThis);

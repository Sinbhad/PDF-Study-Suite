/**
 * Keyboard shortcut registry: one document listener, one handler per study tab.
 * Setting a handler replaces the previous one, so re-rendering a view never stacks listeners.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const handlers = {};

  function onKeyDown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const st = PDFStudy.main && PDFStudy.main.appState;
    const fn = st && handlers[st.activeTab];
    if (!fn) return;
    const t = e.target;
    if (t && t.closest) {
      if (t.closest('input, textarea, select, [contenteditable="true"], [role="tablist"]')) return;
      // Space/Enter on a real button, link or summary already does its own thing
      if ((e.key === ' ' || e.key === 'Enter') && t.closest('button, a, summary')) return;
    }
    if (fn(e) === true) e.preventDefault();
  }

  /** Register fn(e) for a tab name; return true from fn to mark the key as handled. */
  function set(tabName, fn) {
    if (fn) handlers[tabName] = fn;
    else delete handlers[tabName];
  }

  if (typeof document !== 'undefined') document.addEventListener('keydown', onKeyDown);
  PDFStudy.keys = { set };
})(typeof window !== 'undefined' ? window : globalThis);

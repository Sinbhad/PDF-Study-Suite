/**
 * Theme: follows the system by default; the toggle cycles system -> light -> dark and the choice
 * is persisted through the storage module and applied as data-theme on <html>. Loaded in <head>
 * (after storage.js) so a pinned theme is applied before first paint.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const ORDER = ['system', 'light', 'dark'];
  const LABEL = { system: 'Auto', light: 'Light', dark: 'Dark' };

  function current() {
    const v = PDFStudy.storage ? PDFStudy.storage.getPref('theme', 'system') : 'system';
    return ORDER.includes(v) ? v : 'system';
  }
  function apply(mode) {
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    if (mode === 'light' || mode === 'dark') el.setAttribute('data-theme', mode);
    else el.removeAttribute('data-theme');
    const label = document.getElementById('themeLabel');
    if (label) label.textContent = LABEL[mode];
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.setAttribute('aria-label', `Theme: ${LABEL[mode]}. Click to change.`);
  }
  function cycle() {
    const next = ORDER[(ORDER.indexOf(current()) + 1) % ORDER.length];
    if (PDFStudy.storage) PDFStudy.storage.setPref('theme', next);
    apply(next);
    return next;
  }

  apply(current());
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      apply(current());
      const btn = document.getElementById('themeToggleBtn');
      if (btn) btn.onclick = cycle;
    });
  }
  PDFStudy.theme = { current, apply, cycle };
})(typeof window !== 'undefined' ? window : globalThis);

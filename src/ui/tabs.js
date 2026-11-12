/**
 * Study tabs: ARIA tab semantics, roving tabindex, arrow-key navigation and question/card counts.
 * sync() repaints the bar from appState.activeTab (called by main on every render);
 * select() changes the tab and renders it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function tabButtons() {
    return Array.from(document.querySelectorAll('#tabsBar [role="tab"]'));
  }

  function sync() {
    const name = PDFStudy.main.appState.activeTab;
    tabButtons().forEach((b) => {
      const on = b.getAttribute('data-tab') === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on) {
        const panel = document.getElementById('studyAndReaderSplit');
        if (panel) panel.setAttribute('aria-labelledby', b.id);
        if (b.scrollIntoView && b.parentElement.scrollWidth > b.parentElement.clientWidth) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }

  function select(name, focus) {
    const target = tabButtons().find((b) => b.getAttribute('data-tab') === name);
    if (!target) return;
    PDFStudy.main.appState.activeTab = name;
    PDFStudy.main.renderActiveTab(); // calls sync()
    if (focus) target.focus();
    else if (root.scrollY > 0) root.scrollTo(0, 0);
  }

  /** counts: { flashcards, quiz, test } */
  function setCounts(counts) {
    Object.keys(counts || {}).forEach((name) => {
      const el = document.querySelector(`#tabsBar [data-count="${name}"]`);
      if (el) el.textContent = String(counts[name] || 0);
    });
  }

  function onKeyDown(e) {
    const tabs = tabButtons().filter((b) => !b.disabled);
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next].getAttribute('data-tab'), true);
  }

  function init() {
    const bar = document.getElementById('tabsBar');
    if (!bar) return;
    bar.addEventListener('keydown', onKeyDown);
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[role="tab"]');
      if (btn && !btn.disabled) select(btn.getAttribute('data-tab'), false);
    });
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
  PDFStudy.tabs = { select, sync, setCounts, init };
})(typeof window !== 'undefined' ? window : globalThis);

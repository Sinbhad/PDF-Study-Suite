/**
 * App shell behaviour: the outline rail (collapsible on desktop, a drawer under 900px), the
 * document info panel behind the type badge, and the "Wrong? Switch" hint shown when the
 * slides/textbook call is doubtful. Escape closes whichever of the rail or panel is open.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const isNarrow = () => !!(root.matchMedia && root.matchMedia('(max-width: 900px)').matches);
  const $ = (id) => document.getElementById(id);

  function syncToggle() {
    const btn = $('railToggleBtn');
    if (!btn) return;
    const open = isNarrow() ? document.body.classList.contains('rail-open') : !document.body.classList.contains('rail-collapsed');
    btn.setAttribute('aria-expanded', String(open));
  }
  function closeDrawer() {
    document.body.classList.remove('rail-open');
    syncToggle();
  }
  function toggleRail() {
    if (isNarrow()) {
      const open = document.body.classList.toggle('rail-open');
      if (open) {
        const first = document.querySelector('#outlineRail .is-selected .tree-main, #outlineRail input');
        if (first) first.focus();
      }
    } else {
      const collapsed = document.body.classList.toggle('rail-collapsed');
      if (PDFStudy.storage) PDFStudy.storage.setPref('railCollapsed', collapsed);
    }
    syncToggle();
  }

  /** Brings the outline into reach (opens the drawer, or un-collapses the rail) and moves focus into it. */
  function showOutline() {
    if (isNarrow()) {
      document.body.classList.add('rail-open');
    } else if (document.body.classList.contains('rail-collapsed')) {
      document.body.classList.remove('rail-collapsed');
      if (PDFStudy.storage) PDFStudy.storage.setPref('railCollapsed', false);
    }
    syncToggle();
    const target = document.querySelector('#outlineRail .is-selected .tree-main, #outlineRail .tree-main, #outlineRail input');
    if (target) target.focus();
  }

  /** The one quiet line under the top bar: "Reading this as slides. Wrong? Switch to textbook." */
  function syncTypeHint(st) {
    const box = $('docTypeHint');
    if (!box) return;
    const hasText = !st.verdict || st.verdict.kind === 'text';
    const doubt = !!st.parsedPdf && !st.typeChosen && hasText && PDFStudy.docVerdict.typeDoubt({
      classification: st.classification,
      mode: st.activeMode,
      numPages: st.parsedPdf.numPages,
      hasOutline: !!(st.parsedPdf.outline && st.parsedPdf.outline.length),
    });
    box.classList.toggle('hidden', !doubt);
    if (!doubt) return;
    const isSlides = st.activeMode === 'slide_deck';
    $('docTypeHintText').textContent = `Reading this as ${isSlides ? 'slides' : 'a textbook'}. Wrong?`;
    $('docTypeSwitchBtn').textContent = isSlides ? 'Switch to textbook' : 'Switch to slides';
  }

  function setDocPanel(open) {
    const panel = $('docInfoPanel');
    const btn = $('docWhyBtn');
    if (!panel || !btn) return;
    panel.classList.toggle('hidden', !open);
    btn.setAttribute('aria-expanded', String(open));
  }

  function init() {
    if (PDFStudy.storage && PDFStudy.storage.getPref('railCollapsed', false)) document.body.classList.add('rail-collapsed');
    const toggle = $('railToggleBtn');
    if (toggle) toggle.onclick = toggleRail;
    const scrim = $('railScrim');
    if (scrim) scrim.onclick = closeDrawer;
    const why = $('docWhyBtn');
    if (why) why.onclick = () => setDocPanel($('docInfoPanel').classList.contains('hidden'));
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#docInfoPanel, #docWhyBtn') || e.target.closest('#docInfoPanel button')) setDocPanel(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('rail-open')) { closeDrawer(); if (toggle) toggle.focus(); }
      setDocPanel(false);
    });
    if (root.matchMedia) root.matchMedia('(max-width: 900px)').addEventListener('change', closeDrawer);
    syncToggle();
  }

  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
  PDFStudy.shell = { closeDrawer, toggleRail, showOutline, syncTypeHint, setDocPanel };
})(typeof window !== 'undefined' ? window : globalThis);

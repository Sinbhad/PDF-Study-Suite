/**
 * The standing ways into "Check what was read" on a document with pages read from pictures:
 * "Check text" in the top bar (in the document panel on a narrow phone, like Export) and
 * "Check this page" in the Reader toolbar. The notice's own button is hw-review.js.
 *   sync(shown?)   show or hide them for the open document; `false` hides them (a build is running)
 * The buttons are made here, once, so the page markup needs no slot for them.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const TITLE = 'Check and fix the text read from pictures';
  const byId = (id) => document.getElementById(id);
  let made = false;

  function button(id, cls, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = `btn ${cls} hidden`;
    btn.textContent = label;
    return btn;
  }

  function openFrom(btn, startPage) {
    PDFStudy.hwReview.open({ opener: btn, startPage });
  }

  function make() {
    if (made) return;
    made = true;
    const actions = document.querySelector('.topbar-actions');
    if (actions) {
      const top = button('hwCheckTextBtn', 'btn-ghost btn-sm doc-only hw-check-btn', 'Check text');
      top.title = TITLE;
      top.addEventListener('click', () => openFrom(top));
      actions.insertBefore(top, byId('exportMarkdownBtn') || actions.firstChild);
    }
    const panel = byId('docInfoPanel');
    if (panel) {
      const narrow = button('hwCheckTextNarrowBtn', 'btn-ghost btn-sm narrow-only', 'Check text');
      narrow.title = TITLE;
      narrow.addEventListener('click', () => openFrom(narrow));
      panel.appendChild(narrow);
    }
    const bar = document.querySelector('#pdfReaderPanel .reader-toolbar');
    if (bar) {
      const group = document.createElement('div');
      group.className = 'reader-group';
      const here = button('hwCheckPageBtn', 'btn-secondary btn-sm', 'Check this page');
      here.addEventListener('click', () => openFrom(here, PDFStudy.main.appState.currentReaderPage));
      group.appendChild(here);
      bar.appendChild(group);
      // The Reader moves between pages without a full render: look again after each of its controls is used
      const later = () => setTimeout(() => sync(), 0);
      const reader = byId('pdfReaderPanel');
      reader.addEventListener('click', later);
      reader.addEventListener('change', later);
      reader.addEventListener('input', later);
    }
  }

  function sync(shown) {
    if (typeof document === 'undefined') return;
    make();
    const st = PDFStudy.main && PDFStudy.main.appState;
    const can = shown !== false && st && st.parsedPdf && PDFStudy.hwCheck && PDFStudy.hwCheckModel;
    const list = can ? PDFStudy.hwCheckModel.pages(st.parsedPdf, PDFStudy.hwCheck.env()) : [];
    const any = list.length > 0;
    for (const id of ['hwCheckTextBtn', 'hwCheckTextNarrowBtn']) {
      const btn = byId(id);
      if (btn) btn.classList.toggle('hidden', !any);
    }
    const here = byId('hwCheckPageBtn');
    if (here) here.classList.toggle('hidden', !(any && list.some((e) => e.pageNumber === st.currentReaderPage)));
  }

  PDFStudy.hwCheckEntry = { sync };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * DOM event bindings: open/drop a PDF or photos (the whole window is a drop target), sample
 * documents, Larson shortcut, slides/textbook mode toggle, export, and the status line.
 * (Opening itself lives in file-open.js, tabs in tabs.js, the rail and theme in shell.js / theme.js.)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LARSON_NAME = 'Larson Calculus of a Single Variable (10th Ed.).pdf';

  /** Notices fade after a few seconds; an error stays until it is dismissed or replaced. */
  function setStatus(msg, isError) {
    const el = document.getElementById('uploadStatusText');
    if (!el) return;
    clearTimeout(setStatus.timer);
    el.textContent = msg || '';
    el.classList.toggle('status-error', !!isError && !!msg);
    if (!msg) return;
    if (!isError) {
      setStatus.timer = setTimeout(() => { el.textContent = ''; }, 4000);
      return;
    }
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'btn-link status-dismiss';
    dismiss.textContent = 'Dismiss';
    dismiss.onclick = () => setStatus('');
    el.appendChild(dismiss);
  }

  async function larsonAvailable() {
    try {
      // The dev server only answers GET for this path, so cancel the body after the headers.
      const ctrl = new AbortController();
      const resp = await fetch('/local-larson.pdf', { signal: ctrl.signal });
      ctrl.abort();
      return resp.status === 200;
    } catch (_e) {
      return false;
    }
  }

  async function tryLoadLocalLarson() {
    try {
      setStatus('Fetching Larson Calculus from local disk…');
      const resp = await fetch('/local-larson.pdf');
      if (!resp.ok) throw new Error('not found');
      return await PDFStudy.fileOpen.openBuffer(LARSON_NAME, await resp.arrayBuffer(), {});
    } catch (_e) {
      setStatus("Couldn't find the Larson PDF on this computer. Choose it with Open PDF instead.", true);
      return false;
    }
  }

  function loadDemo(name, build) {
    PDFStudy.fileOpen.clearError();
    PDFStudy.main.processLoadedDocument(name, build());
  }

  /**
   * "Photos of pages work too" is only offered while this build can read pictures of text.
   * That can change while the app is open, so it is checked again whenever the start screen is used.
   */
  function syncPhotoHint() {
    const hint = document.getElementById('photoHint');
    if (hint) hint.classList.toggle('hidden', !PDFStudy.ENABLE_HANDWRITING);
  }

  function bindUpload() {
    const fileInput = document.getElementById('pdfFileInput');
    const openBtn = document.getElementById('openPdfBtn');
    const chooseBtn = document.getElementById('choosePdfBtn');
    let dragDepth = 0;

    [openBtn, chooseBtn].forEach((btn) => { if (btn && fileInput) btn.onclick = () => fileInput.click(); });
    const dropzone = document.getElementById('pdfDropzone');
    if (dropzone) {
      dropzone.addEventListener('pointerenter', syncPhotoHint);
      dropzone.addEventListener('focusin', syncPhotoHint);
    }
    syncPhotoHint();
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const picked = Array.from(e.target.files || []);
        e.target.value = '';
        PDFStudy.fileOpen.openFiles(picked);
      });
    }
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const setDrag = (on) => document.body.classList.toggle('drag-active', on);
    document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth += 1; setDrag(true); syncPhotoHint(); } });
    document.addEventListener('dragleave', (e) => { if (hasFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDrag(false); } });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDrag(false);
      PDFStudy.fileOpen.openFiles(e.dataTransfer.files);
    });
  }

  function bindSamples() {
    const slides = document.getElementById('demoSlidesBtn');
    const book = document.getElementById('demoBookBtn');
    if (slides) slides.onclick = () => loadDemo('CS-201 Algorithms Slides.pdf', PDFStudy.demoData.createDemoSlidesPdf);
    if (book) book.onclick = () => loadDemo('Calculus - Limits and Derivatives (Demo).pdf', PDFStudy.demoData.createDemoBookPdf);
    const larson = document.getElementById('loadLarsonBtn');
    if (larson) {
      larson.onclick = tryLoadLocalLarson;
      // Only the local launcher (app.py) serves this file; skip the probe on hosted copies.
      if (root.location && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(root.location.hostname)) {
        larsonAvailable().then((ok) => ok && document.getElementById('larsonLine').classList.remove('hidden'));
      }
    }
  }

  /** Slides <-> textbook, from the badge panel or the "Wrong? Switch" hint. */
  async function switchMode() {
    const M = PDFStudy.main;
    const st = M.appState;
    if (!st.parsedPdf || PDFStudy.loading.isBusy()) return;
    st.activeMode = st.activeMode === 'slide_deck' ? 'book' : 'slide_deck';
    st.typeChosen = true; // the student has decided, so the hint has done its job
    if (PDFStudy.sidebarTree.resetFilter) PDFStudy.sidebarTree.resetFilter();
    M.setDefaultScope();
    M.renderDocumentHeader();
    M.renderSidebarScopeTree();
    await M.recomputeStudyMaterials();
  }

  function bindDocActions() {
    ['toggleModeBtn', 'docTypeSwitchBtn'].forEach((id) => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = switchMode;
    });
    document.querySelectorAll('[data-export]').forEach((btn) => {
      btn.onclick = () => {
        const st = PDFStudy.main.appState;
        if (!st.parsedPdf) return;
        PDFStudy.storage.exportStudyGuideMarkdown({
          docName: st.docName,
          scopeTitle: st.selectedScope.title,
          summary: st.generated.summary,
          flashcards: st.generated.flashcards,
          quiz: st.generated.quiz,
        });
      };
    });
  }

  function initEventListeners() {
    bindUpload();
    bindSamples();
    bindDocActions();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initEventListeners);
  }

  PDFStudy.events = { initEventListeners, tryLoadLocalLarson, setStatus, switchMode };
})(typeof window !== 'undefined' ? window : globalThis);

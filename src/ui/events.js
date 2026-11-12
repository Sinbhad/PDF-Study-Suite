/**
 * DOM event bindings: open/drop a PDF (the whole window is a drop target), sample documents,
 * Larson shortcut, slides/textbook mode toggle, export.
 * (Tabs live in tabs.js, the rail and theme in shell.js / theme.js, loading UI in loading.js.)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LARSON_NAME = 'Larson Calculus of a Single Variable (10th Ed.).pdf';

  function setStatus(msg, isError) {
    const el = document.getElementById('uploadStatusText');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('status-error', !!isError);
    clearTimeout(setStatus.timer);
    if (msg) setStatus.timer = setTimeout(() => { el.textContent = ''; }, isError ? 9000 : 4000);
  }

  async function loadPdfBuffer(name, buffer) {
    const L = PDFStudy.loading;
    const hasDoc = document.body.classList.contains('has-doc');
    setStatus('');
    // First open: progress inside the dropzone. Replacing a document: progress in the study pane.
    if (hasDoc) document.getElementById('activeStudyPanel').classList.remove('hidden');
    L.start(document.getElementById(hasDoc ? 'activeStudyPanel' : 'heroProgress'), `Opening ${name}`);
    let parsed;
    try {
      parsed = await PDFStudy.pdfLoader.loadPdfDocument(buffer, (cur, total) => {
        L.update(cur, total, `Reading page ${cur} of ${total}`);
      });
    } catch (err) {
      L.end();
      if (hasDoc) PDFStudy.main.renderActiveTab();
      const why = String((err && err.message) || err);
      setStatus(/password/i.test(why) ? 'That PDF is password-protected. Remove the password and try again.'
        : /invalid pdf|missing pdf|unexpected/i.test(why) ? "That file isn't a readable PDF. Try exporting it as a PDF again."
        : `Couldn't read that PDF: ${why}`, true);
      return false;
    }
    L.end();
    await PDFStudy.main.processLoadedDocument(name, parsed);
    return true;
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
      return await loadPdfBuffer(LARSON_NAME, await resp.arrayBuffer());
    } catch (_e) {
      setStatus("Couldn't find the Larson PDF on this computer. Choose it with Open PDF instead.", true);
      return false;
    }
  }

  function loadDemo(name, build) {
    setStatus('');
    PDFStudy.main.processLoadedDocument(name, build());
  }

  function bindUpload() {
    const fileInput = document.getElementById('pdfFileInput');
    const openBtn = document.getElementById('openPdfBtn');
    const chooseBtn = document.getElementById('choosePdfBtn');
    let dragDepth = 0;

    async function handleFile(file) {
      if (!file || PDFStudy.loading.isBusy()) return;
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        setStatus('That file is not a PDF.', true);
        return;
      }
      await loadPdfBuffer(file.name, await file.arrayBuffer());
    }

    [openBtn, chooseBtn].forEach((btn) => { if (btn && fileInput) btn.onclick = () => fileInput.click(); });
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
        e.target.value = '';
      });
    }
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const setDrag = (on) => document.body.classList.toggle('drag-active', on);
    document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth += 1; setDrag(true); } });
    document.addEventListener('dragleave', (e) => { if (hasFiles(e)) { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDrag(false); } });
    document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDrag(false);
      handleFile(e.dataTransfer.files[0]);
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

  function bindDocActions() {
    const toggleModeBtn = document.getElementById('toggleModeBtn');
    if (toggleModeBtn) {
      toggleModeBtn.onclick = async () => {
        const st = PDFStudy.main.appState;
        st.activeMode = st.activeMode === 'slide_deck' ? 'book' : 'slide_deck';
        if (PDFStudy.sidebarTree.resetFilter) PDFStudy.sidebarTree.resetFilter();
        PDFStudy.main.setDefaultScope();
        PDFStudy.main.renderDocumentHeader();
        PDFStudy.main.renderSidebarScopeTree();
        await PDFStudy.main.recomputeStudyMaterials();
      };
    }
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

  PDFStudy.events = { initEventListeners, tryLoadLocalLarson, setStatus };
})(typeof window !== 'undefined' ? window : globalThis);

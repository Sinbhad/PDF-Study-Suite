/**
 * Opening what the student picked or dropped: one PDF, or photos of pages (wrapped into a PDF by
 * image-import.js). Every path ends in the document on screen or in a message that says what went
 * wrong and what to do; opening can be stopped at any point. Wording lives in open-messages.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  let openToken = 0; // bumped by every new open and by Cancel, so a late result is dropped

  const $ = (id) => document.getElementById(id);
  const hasDoc = () => document.body.classList.contains('has-doc');

  /** First open: the message sits in the dropzone. With a document open: the status line. */
  function showError(message) {
    const box = $('openError');
    if (hasDoc() || !box) {
      PDFStudy.events.setStatus(message, true);
      return;
    }
    box.textContent = message;
    box.classList.remove('hidden');
  }

  function clearError() {
    const box = $('openError');
    if (box) {
      box.textContent = '';
      box.classList.add('hidden');
    }
    PDFStudy.events.setStatus('');
  }

  /** Progress goes in the dropzone on first open, in the study pane when replacing a document. */
  function progressHost() {
    if (!hasDoc()) return $('heroProgress');
    const panel = $('activeStudyPanel');
    panel.classList.remove('hidden');
    return panel;
  }

  /** Ends the progress bar and puts the screen and keyboard focus back where they were. */
  function restore(invoker) {
    PDFStudy.loading.end();
    if (hasDoc()) PDFStudy.main.renderActiveTab();
    const lostFocus = !document.activeElement || document.activeElement === document.body;
    if (lostFocus && invoker && invoker.isConnected && invoker.focus) invoker.focus();
  }

  /** Starts a progress bar with a working Cancel; returns { stale(), invoker }. */
  function begin(label) {
    const token = ++openToken;
    const invoker = document.activeElement;
    clearError();
    PDFStudy.loading.start(progressHost(), label, {
      onCancel: () => {
        if (token !== openToken) return;
        openToken += 1;
        restore(invoker);
        PDFStudy.events.setStatus('Stopped. Nothing was opened.');
      },
    });
    return { stale: () => token !== openToken, invoker };
  }

  /** info: { size } in bytes, used only to word a failure. Resolves true when the document is on screen. */
  async function openBuffer(name, buffer, info) {
    const L = PDFStudy.loading;
    const run = begin(`Opening ${name}`);
    let parsed;
    try {
      parsed = await PDFStudy.pdfLoader.loadPdfDocument(buffer, (cur, total) => {
        if (!run.stale()) L.update(cur, total, `Reading page ${cur} of ${total}`);
      });
    } catch (err) {
      if (run.stale()) return false;
      restore(run.invoker);
      showError(PDFStudy.openMessages.forError(err, info));
      return false;
    }
    if (run.stale()) {
      if (parsed.pdfDoc && parsed.pdfDoc.destroy) parsed.pdfDoc.destroy();
      return false;
    }
    L.end();
    try {
      await PDFStudy.main.processLoadedDocument(name, parsed);
    } catch (err) {
      L.end();
      PDFStudy.main.closeDocument();
      showError(`That file opened, but its pages could not be worked through. Export it again or try another file. (${String((err && err.message) || err)})`);
      return false;
    }
    return true;
  }

  async function openPdfFile(file) {
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      showError(PDFStudy.openMessages.forError(err, { size: file.size }));
      return false;
    }
    return openBuffer(file.name, buffer, { size: file.size });
  }

  async function openPhotos(files) {
    const L = PDFStudy.loading;
    const run = begin(files.length === 1 ? 'Opening photo' : `Opening ${files.length} photos`);
    let buffer;
    try {
      buffer = await PDFStudy.imageImport.photosToPdf(files, (done, total) => {
        if (!run.stale()) L.update(done, total, `Photo ${done} of ${total}`);
      });
    } catch (err) {
      if (run.stale()) return false;
      restore(run.invoker);
      showError(err && err.fileName ? PDFStudy.openMessages.forImageError(err.fileName) : PDFStudy.openMessages.forError(err, {}));
      return false;
    }
    if (run.stale()) return false;
    L.end();
    return openBuffer(PDFStudy.imageImport.nameFor(files), buffer, { size: buffer.byteLength });
  }

  /** files: a FileList or array from the file input or a drop. */
  async function openFiles(files) {
    if (PDFStudy.loading.isBusy()) {
      PDFStudy.events.setStatus('Still working. Press Cancel to stop, then open the file again.');
      return false;
    }
    const todo = PDFStudy.openMessages.plan(files);
    if (todo.problem) {
      clearError();
      showError(todo.problem);
      return false;
    }
    if (todo.pdf) return openPdfFile(todo.pdf);
    if (todo.images.length) return openPhotos(todo.images);
    return false;
  }

  PDFStudy.fileOpen = { openFiles, openBuffer, showError, clearError };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * PDF reader controls and split-view manager: page input, scrubber, zoom, page jump from study cards.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  async function renderReaderPage(appState) {
    if (!appState || !appState.parsedPdf) return;
    const total = appState.parsedPdf.numPages || 1;
    const pageNum = Math.max(1, Math.min(total, appState.currentReaderPage || 1));
    appState.currentReaderPage = pageNum;
    const scale = appState.readerScale || 1.3;

    const pageInput = document.getElementById('readerPageInput');
    const totalSpan = document.getElementById('readerTotalPages');
    const scrubber = document.getElementById('readerPageScrubber');
    const zoomLabel = document.getElementById('readerZoomLabel');

    if (pageInput) {
      pageInput.max = String(total);
      pageInput.value = String(pageNum);
    }
    if (totalSpan) totalSpan.textContent = `/ ${total}`;
    if (scrubber) {
      scrubber.max = String(total);
      scrubber.value = String(pageNum);
    }
    if (zoomLabel) {
      zoomLabel.textContent = `${Math.round((scale / 1.3) * 100)}%`;
    }

    const canvas = document.getElementById('pdfCanvas');
    const fallbackEl = document.getElementById('readerTextFallback');

    if (appState.parsedPdf.pdfDoc) {
      canvas.classList.remove('hidden');
      fallbackEl.classList.add('hidden');
      canvas.style.maxWidth = scale > 1.31 ? 'none' : '100%'; // fit the pane until the reader zooms in
      await PDFStudy.pdfLoader.renderPageToCanvas(
        appState.parsedPdf.pdfDoc,
        pageNum,
        canvas,
        scale
      );
    } else {
      canvas.classList.add('hidden');
      fallbackEl.classList.remove('hidden');
      const pageObj = (appState.parsedPdf.pages || []).find((p) => p.pageNumber === pageNum);
      const rich = PDFStudy.studyViews.rich || PDFStudy.studyViews.escapeHtml;
      fallbackEl.innerHTML = (pageObj ? pageObj.lines : [])
        .map((l) => rich(l.formattedText || l.text))
        .filter(Boolean)
        .map((html) => `<p>${html}</p>`)
        .join('');
    }
  }

  function syncSplitBtn(st) {
    const btn = document.getElementById('splitViewToggleBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(!!st.splitView));
  }

  function jumpToPage(pageNum) {
    const st = PDFStudy.main && PDFStudy.main.appState;
    if (!st || !st.parsedPdf) return;
    st.currentReaderPage = Math.max(1, Math.min(st.parsedPdf.numPages, parseInt(pageNum, 10) || 1));

    // From a study view: open the page beside it (split view), or switch to the Reader tab when
    // the window is too narrow for two panes.
    const narrow = root.matchMedia && root.matchMedia('(max-width: 900px)').matches;
    if (st.activeTab !== 'reader' && narrow) {
      PDFStudy.tabs.select('reader', false);
    } else if (st.activeTab !== 'reader' && !st.splitView) {
      st.splitView = true;
      PDFStudy.main.renderActiveTab();
    } else {
      renderReaderPage(st);
    }
  }

  function initReaderControls(appState) {
    const prevBtn = document.getElementById('readerPrevBtn');
    const nextBtn = document.getElementById('readerNextBtn');
    const pageInput = document.getElementById('readerPageInput');
    const scrubber = document.getElementById('readerPageScrubber');
    const zoomInBtn = document.getElementById('readerZoomInBtn');
    const zoomOutBtn = document.getElementById('readerZoomOutBtn');
    const splitBtn = document.getElementById('splitViewToggleBtn');

    if (prevBtn) {
      prevBtn.onclick = () => {
        if (appState.currentReaderPage > 1) {
          appState.currentReaderPage--;
          renderReaderPage(appState);
        }
      };
    }
    if (nextBtn) {
      nextBtn.onclick = () => {
        if (appState.parsedPdf && appState.currentReaderPage < appState.parsedPdf.numPages) {
          appState.currentReaderPage++;
          renderReaderPage(appState);
        }
      };
    }
    if (pageInput) {
      pageInput.onchange = () => {
        jumpToPage(pageInput.value);
      };
    }
    if (scrubber) {
      scrubber.oninput = () => {
        appState.currentReaderPage = parseInt(scrubber.value, 10) || 1;
        renderReaderPage(appState);
      };
    }
    if (zoomInBtn) {
      zoomInBtn.onclick = () => {
        appState.readerScale = Math.min(2.4, (appState.readerScale || 1.3) + 0.2);
        renderReaderPage(appState);
      };
    }
    if (zoomOutBtn) {
      zoomOutBtn.onclick = () => {
        appState.readerScale = Math.max(0.7, (appState.readerScale || 1.3) - 0.2);
        renderReaderPage(appState);
      };
    }
    if (splitBtn) {
      splitBtn.onclick = () => {
        appState.splitView = !appState.splitView;
        PDFStudy.main.renderActiveTab();
      };
    }
  }

  PDFStudy.readerControls = { renderReaderPage, jumpToPage, initReaderControls, syncSplitBtn };
})(typeof window !== 'undefined' ? window : globalThis);

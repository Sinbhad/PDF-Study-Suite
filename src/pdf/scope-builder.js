/**
 * Scope Text & Lazy Page Loader for Book Hierarchy
 * Extracted from book-hierarchy.js (Strangler Fig) to keep every PDF module well below 200 LOC.
 * Formats loaded page slices through `textCleaner.processSectionPages`.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const getCleaner = () =>
    PDFStudy.textCleaner || (typeof require === 'function' ? require('./text-cleaner.js') : null);
  const getCanvasScope = () =>
    PDFStudy.ocrCanvasScope || (typeof require === 'function' ? require('./ocr-canvas-scope.js') : null);

  /**
   * Pages that the PDF outline files under front / back matter (cover, title page, copyright, contents,
   * preface, about the authors, answers, index ...) and that no core chapter also covers.
   */
  function fluffPageTest(parsedPdf) {
    try {
      const bh = PDFStudy.bookHierarchy;
      if (!bh || !parsedPdf || !parsedPdf.outline || !parsedPdf.outline.length) return () => false;
      const chapters = bh.extractBookHierarchy({ outline: parsedPdf.outline, numPages: parsedPdf.numPages, pages: [] }).chapters || [];
      const within = (list, n) => list.some((c) => n >= c.startPage && n <= c.endPage);
      const extra = chapters.filter((c) => c.isExtra);
      const core = chapters.filter((c) => !c.isExtra);
      return (n) => within(extra, n) && !within(core, n);
    } catch (_err) {
      return () => false;
    }
  }

  function formatPagesToScope(allPages, startPage, endPage, parsedPdf) {
    const isFluff = fluffPageTest(parsedPdf);
    const pages = (allPages || []).filter((p) => p && !isFluff(p.pageNumber));
    const canvas = getCanvasScope();
    if (canvas && pages.some(canvas.isCanvasPage)) {
      return Object.assign(canvas.formatScope(pages, formatPlain), { pageCount: pages.length, startPage, endPage });
    }
    return Object.assign(formatPlain(pages), { pageCount: pages.length, startPage, endPage });
  }

  /** Ordinary pages -> { text, exerciseText, didacticBlocks } through the text cleaner. */
  function formatPlain(pages) {
    const cleaner = getCleaner();
    if (cleaner && cleaner.processSectionPages) {
      const cleaned = cleaner.processSectionPages(pages);
      return {
        text: cleaned.text,
        exerciseText: cleaned.exerciseText || '',
        didacticBlocks: cleaned.didacticBlocks,
      };
    }
    const paragraphs = pages.map((p) =>
      (p.lines || []).map((l) => l.formattedText || l.text).join('\n')
    );
    return {
      text: paragraphs.join('\n\n'),
      exerciseText: '',
      didacticBlocks: [],
    };
  }

  function extractScopeText(parsedPdf, startPage, endPage) {
    // Cap synchronous page span to 30 pages max to prevent browser freeze on huge chapters
    const cappedEnd = Math.min(endPage, startPage + 29);
    const pages = ((parsedPdf && parsedPdf.pages) || []).filter(
      (p) => p.pageNumber >= startPage && p.pageNumber <= cappedEnd
    );
    return formatPagesToScope(pages, startPage, cappedEnd, parsedPdf);
  }

  async function extractScopeTextAsync(parsedPdf, startPage, endPage, onProgress) {
    // Cap single study scope to 25 pages so even clicking a 60-page chapter stays fast (<1s)
    const cappedEnd = Math.min(endPage, startPage + 24);
    let pages = [];
    if (parsedPdf && parsedPdf.pdfDoc && PDFStudy.pdfLoader && PDFStudy.pdfLoader.ensurePagesLoaded) {
      pages = await PDFStudy.pdfLoader.ensurePagesLoaded(
        parsedPdf,
        startPage,
        cappedEnd,
        onProgress
      );
    } else {
      pages = ((parsedPdf && parsedPdf.pages) || []).filter(
        (p) => p.pageNumber >= startPage && p.pageNumber <= cappedEnd
      );
    }
    return formatPagesToScope(pages, startPage, cappedEnd, parsedPdf);
  }

  PDFStudy.scopeBuilder = {
    formatPagesToScope,
    extractScopeText,
    extractScopeTextAsync,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.scopeBuilder;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * PDF Spatial & Text Loader with Instant Lazy Page Loading (100% Offline, Non-AI)
 * Parses outlines & 12 sample pages immediately (<1s), then lazily parses active sections on demand.
 * Line reconstruction (glyph decoding, 2D formulas, columns) lives in line-builder.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const lineBuilder = () => mod('lineBuilder', './line-builder.js');

  function configureWorker() {
    if (root.pdfjsLib) {
      root.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js?v=20261024b';
    }
  }

  /** Re-export (Strangler Fig): callers and fixtures keep using pdfLoader.reconstructLines. */
  function reconstructLines(items, styles, pageWidth, pageHeight, opts = {}) {
    return lineBuilder().reconstructLines(items, styles, pageWidth, pageHeight, opts);
  }

  async function parseSinglePage(pdfDoc, pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const textContent = await page.getTextContent();
    // The operator list gives real font names + glyph codes (font objects) and fraction-bar strokes
    let opList = null;
    try {
      opList = await page.getOperatorList();
    } catch (_err) {
      opList = null;
    }
    const cache = (pdfDoc.__fontNameCache = pdfDoc.__fontNameCache || new Map());
    const fontNames = await mod('spanFormat', './span-format.js').resolveFontNames(page, textContent.items, cache);
    const lib = root.pdfjsLib || {};
    const fd = mod('fontDecoder', './font-decoder.js');
    const pr = mod('pageRules', './page-rules.js');
    const decoders = fd ? fd.buildDecoders(page, textContent.items, fontNames, opList, lib.OPS) : null;
    const allItems = fd && opList && fd.refineItems ? fd.refineItems(page, textContent.items, opList, lib.OPS) : textContent.items;
    const rules = pr && opList ? pr.extractRules(opList, lib.OPS, viewport.viewBox) : [];
    const lines = reconstructLines(allItems, textContent.styles, viewport.width, viewport.height, {
      fontNames,
      decoders,
      rules,
      viewBox: viewport.viewBox,
    });
    const wordCount = lines.reduce((sum, l) => sum + l.wordCount, 0);
    const pageObj = {
      pageNumber: pageNum, width: viewport.width, height: viewport.height,
      aspectRatio: viewport.width / Math.max(1, viewport.height), lines, wordCount,
    };
    const pk = mod('pageKind', './page-kind.js');
    if (pk) pageObj.kind = pk.classifyPage(pageObj);
    const ink = mod('inkDetect', './ink-detect.js');
    if (ink) pageObj.ink = ink.assess(pageObj, ink.opStats(opList, lib.OPS));
    return pageObj;
  }

  async function extractOutline(pdfDoc) {
    const rawOutline = await pdfDoc.getOutline();
    if (!rawOutline || !rawOutline.length) return [];

    async function resolveItems(items, level) {
      const nodes = [];
      for (const item of items) {
        let pageNumber = 1;
        try {
          let dest = item.dest;
          if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
          if (Array.isArray(dest) && dest[0] !== undefined) {
            const pageIndex =
              typeof dest[0] === 'number' ? dest[0] : await pdfDoc.getPageIndex(dest[0]);
            pageNumber = pageIndex + 1;
          }
        } catch (_err) {
          // Ignore malformed PDF outline destinations
        }
        const children =
          item.items && item.items.length ? await resolveItems(item.items, level + 1) : [];
        nodes.push({
          level,
          title: (item.title || 'Untitled').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled',
          startPage: pageNumber,
          children,
        });
      }
      return nodes;
    }
    return resolveItems(rawOutline, 1);
  }

  async function ensurePagesLoaded(parsedPdf, startPage, endPage, onProgress) {
    if (!parsedPdf || !parsedPdf.pdfDoc) return parsedPdf.pages || [];
    const s = Math.max(1, startPage);
    const e = Math.min(parsedPdf.numPages, endPage);
    const total = e - s + 1;
    const result = [];

    for (let p = s; p <= e; p++) {
      if (!parsedPdf.pageCache.has(p)) {
        if (onProgress) onProgress(p - s + 1, total, p);
        const pageData = await parseSinglePage(parsedPdf.pdfDoc, p);
        parsedPdf.pageCache.set(p, pageData);
      }
      result.push(parsedPdf.pageCache.get(p));
    }
    return result;
  }

  async function loadPdfDocument(arrayBuffer, onProgress) {
    configureWorker();
    // fontExtraProperties exposes glyph names / encodings so math fonts can be decoded correctly
    const loadingTask = root.pdfjsLib.getDocument({ data: arrayBuffer, fontExtraProperties: true });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    const pageCache = new Map();
    const outline = await extractOutline(pdfDoc);

    // If small document (<= 35 pages, e.g. class slides), parse all pages immediately;
    // If large book (> 35 pages), parse 12 evenly-spaced sample pages in <300ms!
    const isSmallDoc = numPages <= 35;
    const pagesToInitialParse = isSmallDoc
      ? Array.from({ length: numPages }, (_, i) => i + 1)
      : Array.from({ length: 12 }, (_, i) =>
          Math.max(1, Math.min(numPages, Math.floor(((i + 0.5) * numPages) / 12)))
        );

    const pages = [];
    for (let i = 0; i < pagesToInitialParse.length; i++) {
      const pNum = pagesToInitialParse[i];
      if (onProgress) onProgress(i + 1, pagesToInitialParse.length, pNum);
      if (!pageCache.has(pNum)) {
        pageCache.set(pNum, await parseSinglePage(pdfDoc, pNum));
      }
      pages.push(pageCache.get(pNum));
    }

    return { pdfDoc, numPages, pages, pageCache, outline, isLazy: !isSmallDoc };
  }

  async function renderPageToCanvas(pdfDoc, pageNumber, canvas, scale = 1.35) {
    if (!pdfDoc || !canvas) return;
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  PDFStudy.pdfLoader = {
    loadPdfDocument,
    ensurePagesLoaded,
    parseSinglePage,
    parsePage: parseSinglePage,
    reconstructLines,
    renderPageToCanvas,
    get BULLET_RE() {
      return lineBuilder().BULLET_RE;
    },
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.pdfLoader;
  }
})(typeof window !== 'undefined' ? window : globalThis);

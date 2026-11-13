/**
 * Ink detection: finds pages with no selectable text but real ink (handwritten notes exported as
 * vector strokes or images), so the handwriting pipeline knows which pages to recognise.
 * Pure functions, no DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_WORDS = 5;
  const MIN_PATH_OPS = 20;
  const MIN_IMAGE_OPS = 1;

  const PATH_NAMES = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'];
  const IMAGE_NAMES = [
    'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintJpegXObject',
    'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup',
  ];

  const idSet = (OPS, names) => {
    const set = new Set();
    for (const n of names) if (OPS && typeof OPS[n] === 'number') set.add(OPS[n]);
    return set;
  };

  /**
   * Counts path-painting and image-painting operators.
   * Old PDF.js: constructPath, then a separate paint op. Newer builds fold the paint op into
   * constructPath's first argument; both are counted once, never double.
   */
  function opStats(opList, OPS) {
    const stats = { pathOps: 0, imageOps: 0 };
    if (!opList || !Array.isArray(opList.fnArray) || !OPS) return stats;
    const paths = idSet(OPS, PATH_NAMES);
    const images = idSet(OPS, IMAGE_NAMES);
    const fns = opList.fnArray;
    const args = opList.argsArray || [];
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      if (fn === OPS.constructPath) {
        const first = args[i] && args[i][0];
        if (typeof first === 'number' && paths.has(first)) stats.pathOps += 1;
      } else if (paths.has(fn)) stats.pathOps += 1;
      else if (images.has(fn)) stats.imageOps += 1;
    }
    return stats;
  }

  /** -> { needsRecognition, reason: 'has-text' | 'blank' | 'no-text', pathOps, imageOps } */
  function assess(pageObj, stats) {
    const pathOps = (stats && stats.pathOps) || 0;
    const imageOps = (stats && stats.imageOps) || 0;
    const words = ((pageObj && pageObj.lines) || [])
      .filter((l) => !l.isMargin)
      .reduce((sum, l) => sum + (l.wordCount || 0), 0);
    const hasInk = pathOps >= MIN_PATH_OPS || imageOps >= MIN_IMAGE_OPS;
    let reason = 'has-text';
    if (words < MIN_WORDS) reason = hasInk ? 'no-text' : 'blank';
    return { needsRecognition: reason === 'no-text', reason, pathOps, imageOps };
  }

  function loadedPages(parsedPdf) {
    if (!parsedPdf) return [];
    const cache = parsedPdf.pageCache;
    if (cache && typeof cache.values === 'function' && cache.size) return Array.from(cache.values());
    return Array.isArray(parsedPdf.pages) ? parsedPdf.pages : [];
  }

  /** Loaded pages in range that need recognition and have not been recognised yet. */
  function pagesNeeding(parsedPdf, startPage, endPage) {
    const out = [];
    for (const p of loadedPages(parsedPdf)) {
      if (!p || p.pageNumber < startPage || p.pageNumber > endPage) continue;
      if (p.ink && p.ink.needsRecognition && !p.ink.recognised) out.push(p.pageNumber);
    }
    return out.sort((a, b) => a - b);
  }

  /** -> { loaded, needing, share } over loaded pages (needing = still unrecognised ink pages). */
  function summarise(parsedPdf) {
    const pages = loadedPages(parsedPdf);
    const needing = pages.filter((p) => p && p.ink && p.ink.needsRecognition && !p.ink.recognised).length;
    return { loaded: pages.length, needing, share: pages.length ? needing / pages.length : 0 };
  }

  PDFStudy.inkDetect = { opStats, assess, pagesNeeding, summarise, MIN_WORDS, MIN_PATH_OPS, MIN_IMAGE_OPS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.inkDetect;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Ink detection: decides, page by page, whether there is writing the text layer does not hold, so the
 * handwriting pipeline knows which pages to read. Three kinds of page need reading:
 *   - 'no-text': fewer than MIN_WORDS typed words but real ink (vector strokes, images or annotation ink);
 *   - 'mixed' / 'annotation-ink': typed text with freehand ink annotations on top;
 *   - 'mixed' / 'image' or 'paths': typed text next to a large picture or many loose strokes with no text
 *     layer of their own (a slide with a title and a photographed page).
 * selectForReading() then chooses among them for one selected page range. Pure functions, no DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const geometry = () => mod('inkGeometry', './ink-geometry.js');

  const MIN_WORDS = 5;
  const MIN_PATH_OPS = 20;
  const MIN_IMAGE_OPS = 1;
  // Freehand annotation strokes that make a page worth reading (a lone tick or underline is not writing)
  const MIN_ANNOTATION_STROKES = 4;
  // A picture next to typed text is read only on a page with few typed words (a title and a caption) ...
  const MIXED_MAX_WORDS = 15;
  // ... when pictures with at most this many typed words over them ...
  const IMAGE_MAX_WORDS_OVER = 3;
  // ... cover at least this share of the page (logos and icons stay well under it)
  const MIXED_IMAGE_SHARE = 0.25;
  // Painted paths away from every text line that mark handwriting drawn over a typed page
  const MIN_LOOSE_PATHS = 150;
  const LOOSE_MAX_SIDE = 0.3; // longer paths are frames, rules and backgrounds, not pen strokes
  // Book mode: text-less pages are read when they are this share of the selected range ...
  const RANGE_SHARE = 0.2;
  // ... or stand in a row this long (a scanned chapter inside a typed book)
  const RANGE_RUN = 3;

  const PATH_NAMES = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'];
  const IMAGE_NAMES = [
    'paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintJpegXObject',
    'paintImageXObjectRepeat', 'paintImageMaskXObjectRepeat', 'paintInlineImageXObjectGroup', 'paintImageMaskXObjectGroup',
  ];
  const TEXT_NAMES = ['showText', 'showSpacedText', 'nextLineShowText', 'nextLineSetSpacingShowText'];

  const idSet = (OPS, names) => {
    const set = new Set();
    for (const n of names) if (OPS && typeof OPS[n] === 'number') set.add(OPS[n]);
    return set;
  };

  /**
   * Counts path-painting, image-painting and text-showing operators.
   * Old PDF.js: constructPath, then a separate paint op. Newer builds fold the paint op into
   * constructPath's first argument; both are counted once, never double.
   */
  function opStats(opList, OPS) {
    const stats = { pathOps: 0, imageOps: 0, textOps: 0 };
    if (!opList || !Array.isArray(opList.fnArray) || !OPS) return stats;
    const paths = idSet(OPS, PATH_NAMES);
    const images = idSet(OPS, IMAGE_NAMES);
    const texts = idSet(OPS, TEXT_NAMES);
    const fns = opList.fnArray;
    const args = opList.argsArray || [];
    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      if (fn === OPS.constructPath) {
        const first = args[i] && args[i][0];
        if (typeof first === 'number' && paths.has(first)) stats.pathOps += 1;
      } else if (paths.has(fn)) stats.pathOps += 1;
      else if (images.has(fn)) stats.imageOps += 1;
      else if (texts.has(fn)) stats.textOps += 1;
    }
    return stats;
  }

  const textLines = (pageObj) => ((pageObj && pageObj.lines) || []).filter((l) => !l.isMargin);

  /** Pictures with (almost) no typed words over them, when together they cover enough of the page. */
  function untextedImages(pageObj, lines, images) {
    const geo = geometry();
    const page = { x: 0, y: 0, w: pageObj.width || 0, h: pageObj.height || 0 };
    const pageArea = page.w * page.h;
    if (!pageArea) return [];
    const boxes = [];
    let covered = 0;
    for (const img of images) {
      const area = geo.overlap(img, page);
      if (!area) continue;
      const wordsOver = lines
        .filter((l) => {
          const cx = (l.x0 + l.x1) / 2;
          const cy = (l.topY + l.bottomY) / 2;
          return cx >= img.x && cx <= img.x + img.w && cy >= img.y && cy <= img.y + img.h;
        })
        .reduce((sum, l) => sum + (l.wordCount || 0), 0);
      if (wordsOver > IMAGE_MAX_WORDS_OVER) continue;
      covered += area;
      boxes.push(img);
    }
    return covered / pageArea >= MIXED_IMAGE_SHARE ? boxes : [];
  }

  /** Painted paths that are stroke-sized and touch no text line (bullets and underlines sit on their line). */
  function loosePaths(pageObj, lines, paths) {
    const geo = geometry();
    const maxW = LOOSE_MAX_SIDE * (pageObj.width || 0);
    const maxH = LOOSE_MAX_SIDE * (pageObj.height || 0);
    const near = lines.map((l) => {
      const b = geo.lineBox(l);
      return { x: b.x - 40, y: b.y - 4, w: b.w + 80, h: b.h + 8 };
    });
    let count = 0;
    for (const p of paths) {
      if (p.w > maxW || p.h > maxH) continue;
      const box = { x: p.x, y: p.y, w: Math.max(p.w, 0.5), h: Math.max(p.h, 0.5) };
      if (!near.some((n) => geo.overlap(n, box) > 0)) count += 1;
    }
    return count;
  }

  /** Why a page with typed text still has something to read: 'annotation-ink' | 'image' | 'paths' | null. */
  function mixedReason(pageObj, words, extra) {
    const annot = (extra && extra.annotationInk) || null;
    if (annot && annot.strokes >= MIN_ANNOTATION_STROKES) return { why: 'annotation-ink', boxes: annot.boxes || [] };
    const geo = extra && extra.geometry;
    if (!geo || !geometry()) return null;
    const lines = textLines(pageObj);
    if (words <= MIXED_MAX_WORDS) {
      const boxes = untextedImages(pageObj, lines, geo.images || []);
      if (boxes.length) return { why: 'image', boxes };
    }
    if (geo.pathsMeasured && loosePaths(pageObj, lines, geo.paths || []) >= MIN_LOOSE_PATHS) return { why: 'paths', boxes: [] };
    return null;
  }

  /**
   * extra (optional): { annotationInk: { strokes, boxes }, geometry: { images, paths, pathsMeasured } } from
   * ink-geometry.js. Without it only the operator counts decide, as before.
   * -> { needsRecognition, reason: 'has-text' | 'blank' | 'no-text' | 'mixed', mixed?, readBoxes?,
   *      pathOps, imageOps, annotationStrokes }
   */
  function assess(pageObj, stats, extra) {
    const pathOps = (stats && stats.pathOps) || 0;
    const imageOps = (stats && stats.imageOps) || 0;
    const annotationStrokes = (extra && extra.annotationInk && extra.annotationInk.strokes) || 0;
    const words = textLines(pageObj).reduce((sum, l) => sum + (l.wordCount || 0), 0);
    const hasInk = pathOps >= MIN_PATH_OPS || imageOps >= MIN_IMAGE_OPS || annotationStrokes >= MIN_ANNOTATION_STROKES;
    const out = { needsRecognition: false, reason: 'has-text', pathOps, imageOps, annotationStrokes };
    if (words < MIN_WORDS) {
      out.reason = hasInk ? 'no-text' : 'blank';
      out.needsRecognition = hasInk;
      return out;
    }
    const mixed = mixedReason(pageObj, words, extra);
    if (mixed) {
      Object.assign(out, { needsRecognition: true, reason: 'mixed', mixed: mixed.why, readBoxes: mixed.boxes });
    }
    return out;
  }

  function loadedPages(parsedPdf) {
    if (!parsedPdf) return [];
    const cache = parsedPdf.pageCache;
    if (cache && typeof cache.values === 'function' && cache.size) return Array.from(cache.values());
    return Array.isArray(parsedPdf.pages) ? parsedPdf.pages : [];
  }

  const unread = (p) => Boolean(p && p.ink && p.ink.needsRecognition && !p.ink.recognised);

  /** Loaded pages in range that are to be read and have not been read yet (selectForReading may pass some over). */
  function pagesNeeding(parsedPdf, startPage, endPage) {
    const out = [];
    for (const p of loadedPages(parsedPdf)) {
      if (!p || p.pageNumber < startPage || p.pageNumber > endPage) continue;
      if (unread(p) && !p.ink.passedOver) out.push(p.pageNumber);
    }
    return out.sort((a, b) => a - b);
  }

  /** Longest row of consecutive page numbers in a sorted list. */
  function longestRun(numbers) {
    let best = 0;
    let run = 0;
    let prev = null;
    for (const n of numbers) {
      run = prev !== null && n === prev + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = n;
    }
    return best;
  }

  /**
   * Chooses the pages of the selected range to read, from the pages of that range only (never from the rest
   * of the document), and marks the others ink.passedOver so pagesNeeding() leaves them alone.
   *   - opts.force: every unread candidate.
   *   - Annotation ink is handwriting on the page: always read.
   *   - opts.slides (slide deck): every candidate, so one picture-only slide in a typed deck is read.
   *   - Book: text-less pages only when they are RANGE_SHARE of the range or RANGE_RUN in a row; a lone
   *     full-page figure in a typed chapter and pictures beside typed text never start the reader.
   * -> sorted page numbers
   */
  function selectForReading(parsedPdf, startPage, endPage, opts) {
    const o = opts || {};
    const inRange = loadedPages(parsedPdf)
      .filter((p) => p && p.pageNumber >= startPage && p.pageNumber <= endPage)
      .sort((a, b) => a.pageNumber - b.pageNumber);
    const candidates = inRange.filter(unread);
    const textless = candidates.filter((p) => p.ink.reason !== 'mixed').map((p) => p.pageNumber);
    const bookReads = textless.length >= RANGE_SHARE * inRange.length || longestRun(textless) >= RANGE_RUN;
    const chosen = [];
    for (const p of candidates) {
      const mixed = p.ink.reason === 'mixed';
      const take = Boolean(o.force || o.slides || p.ink.mixed === 'annotation-ink' || (!mixed && bookReads));
      p.ink.passedOver = !take;
      if (take) chosen.push(p.pageNumber);
    }
    return chosen;
  }

  /**
   * -> { loaded, needing, share } over loaded pages: needing = text-less ink pages still unread. Pages that
   * also hold typed text are not counted, so a typed deck with pictures is not taken for handwritten notes.
   */
  function summarise(parsedPdf) {
    const pages = loadedPages(parsedPdf);
    const needing = pages.filter((p) => unread(p) && p.ink.reason !== 'mixed').length;
    return { loaded: pages.length, needing, share: pages.length ? needing / pages.length : 0 };
  }

  PDFStudy.inkDetect = {
    opStats, assess, pagesNeeding, selectForReading, summarise, loadedPages,
    MIN_WORDS, MIN_PATH_OPS, MIN_IMAGE_OPS, MIN_ANNOTATION_STROKES, MIXED_MAX_WORDS, MIXED_IMAGE_SHARE, MIN_LOOSE_PATHS,
    RANGE_SHARE, RANGE_RUN,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.inkDetect;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Per-document picture of what the pages hold, so the interface can say "this file's pages are empty"
 * instead of building nothing from a notes export whose handwriting did not survive.
 *   classOf(pageObj)       -> 'typed' | 'needsReading' | 'mixed' | 'empty' | 'decorative'
 *   summarise(parsedPdf)   -> { pages, known, typed, needsReading, mixed, empty, decorative }
 *   verdict(summary)       -> 'typed' | 'needs-reading' | 'mixed' | 'empty-export' | 'unknown'
 *   attach(parsedPdf)      defines parsedPdf.inkSummary, recounted on every read as pages load
 *   surveyIfTextless(parsedPdf, OPS) operator-count pass for a lazy document whose sampled pages hold no text
 * `pages` is the document's page count; `known` is how many of them have been classified so far.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const inkDetect = () => mod('inkDetect', './ink-detect.js');

  const CLASSES = ['typed', 'needsReading', 'mixed', 'empty', 'decorative'];
  // An export counts as empty when at least this share of its pages are empty and no page holds text
  const EMPTY_SHARE = 0.8;
  // ... and at most this many pages have ink at all (the decorative notebook cover)
  const EMPTY_MAX_INK_PAGES = 1;
  // A document is called typed / needing reading when that kind is at least this share of its content pages
  const DOMINANT_SHARE = 0.8;
  // The operator pass calls a page typed from this many text-showing operators (no line building is done)
  const SURVEY_TEXT_OPS = 3;
  // The operator pass stops once this many ink pages are seen: the document is clearly not an empty export
  const SURVEY_STOP_INK_PAGES = 2;

  /** One loaded page. A page read as a picture, or rendered with no ink at all, is not content. */
  function classOf(pageObj) {
    const ink = (pageObj && pageObj.ink) || {};
    if (ink.reason === 'mixed') return 'mixed';
    if (ink.reason === 'blank' || ink.emptyRender) return 'empty';
    // Stays 'needsReading' after it was read, so the verdict does not flip while a document is being read
    if (ink.reason === 'no-text') return ink.picture ? 'decorative' : 'needsReading';
    return 'typed';
  }

  function summarise(parsedPdf) {
    const out = { pages: 0, known: 0, typed: 0, needsReading: 0, mixed: 0, empty: 0, decorative: 0 };
    if (!parsedPdf) return out;
    const seen = new Set();
    const add = (pageNumber, cls) => {
      if (seen.has(pageNumber) || !CLASSES.includes(cls)) return;
      seen.add(pageNumber);
      out[cls] += 1;
    };
    for (const p of inkDetect().loadedPages(parsedPdf)) {
      if (p) add(p.pageNumber, classOf(p));
    }
    const survey = parsedPdf.inkSurvey;
    if (survey && typeof survey.forEach === 'function') survey.forEach((cls, pageNumber) => add(pageNumber, cls));
    out.known = seen.size;
    out.pages = parsedPdf.numPages || out.known;
    return out;
  }

  /** Pure: what kind of document the counts describe. */
  function verdict(summary) {
    const s = summary || {};
    const count = (k) => Number(s[k]) || 0;
    const known = CLASSES.reduce((sum, k) => sum + count(k), 0);
    if (!known) return 'unknown';
    const withText = count('typed') + count('mixed');
    const content = withText + count('needsReading');
    if (!content) return 'empty-export';
    if (!withText && count('needsReading') <= EMPTY_MAX_INK_PAGES && count('empty') >= EMPTY_SHARE * known) return 'empty-export';
    if (count('needsReading') >= DOMINANT_SHARE * content) return 'needs-reading';
    if (count('needsReading') + count('mixed') === 0) return 'typed';
    return 'mixed';
  }

  /** parsedPdf.inkSummary: always current, costs one pass over the pages loaded so far. */
  function attach(parsedPdf) {
    if (!parsedPdf || Object.getOwnPropertyDescriptor(parsedPdf, 'inkSummary')) return parsedPdf;
    Object.defineProperty(parsedPdf, 'inkSummary', {
      get: () => summarise(parsedPdf),
      enumerable: false,
      configurable: true,
    });
    return parsedPdf;
  }

  /** Class of an unparsed page from its operator counts alone. */
  function classFromStats(stats) {
    const d = inkDetect();
    if (stats.textOps >= SURVEY_TEXT_OPS) return 'typed';
    if (stats.pathOps >= d.MIN_PATH_OPS || stats.imageOps >= d.MIN_IMAGE_OPS) return 'needsReading';
    return 'empty';
  }

  /**
   * A lazy document parses only a few sample pages. When none of them holds text, the others are counted
   * by operators alone (no text extraction, no line building) into parsedPdf.inkSurvey, which is enough to
   * tell an empty export from scanned pages. A typed document never gets here, and a scanned book stops
   * after SURVEY_STOP_INK_PAGES pages, so a 1,377-page textbook is not walked.
   */
  async function surveyIfTextless(parsedPdf, OPS) {
    if (!parsedPdf || !parsedPdf.isLazy || !parsedPdf.pdfDoc || !OPS) return null;
    const sampled = summarise(parsedPdf);
    if (sampled.typed + sampled.mixed > 0 || sampled.needsReading >= SURVEY_STOP_INK_PAGES) return null;
    const survey = (parsedPdf.inkSurvey = parsedPdf.inkSurvey || new Map());
    let inkPages = sampled.needsReading;
    for (let n = 1; n <= parsedPdf.numPages; n++) {
      if (parsedPdf.pageCache.has(n) || survey.has(n)) continue;
      let cls = null;
      try {
        const page = await parsedPdf.pdfDoc.getPage(n);
        cls = classFromStats(inkDetect().opStats(await page.getOperatorList(), OPS));
        if (page.cleanup) page.cleanup();
      } catch (_err) {
        cls = null; // an unreadable page is left unknown
      }
      if (!cls) continue;
      survey.set(n, cls);
      if (cls === 'needsReading') inkPages += 1;
      if (cls === 'typed' || inkPages >= SURVEY_STOP_INK_PAGES) break;
    }
    return survey;
  }

  PDFStudy.inkSummary = { classOf, summarise, verdict, attach, surveyIfTextless, EMPTY_SHARE, DOMINANT_SHARE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.inkSummary;
  }
})(typeof window !== 'undefined' ? window : globalThis);

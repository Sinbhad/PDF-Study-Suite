/**
 * Verdicts about a loaded document: does it (or a page range of it) hold any text to study, and
 * does the slides/textbook call look shaky? Pure functions over parsed pages (page.ink comes from
 * ink-detect.js); no DOM.
 *
 * Page kinds: 'text' (selectable text), 'read' (a picture whose text was recognised),
 * 'picture' (ink or an image with no selectable text) and 'blank' (nothing drawn).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_WORDS = 5;
  const BLANK_SHARE = 0.9; // a decorative cover in front of blank pages is still a blank export
  const LOW_CONFIDENCE = 65; // classifier confidence is a percentage, 55 at its least sure
  const SHORT_BOOK_PAGES = 40;
  const SPARSE_WORDS_PER_PAGE = 200;
  const DENSE_WORDS_PER_PAGE = 300;

  function loadedPages(parsedPdf) {
    if (!parsedPdf) return [];
    const cache = parsedPdf.pageCache;
    if (cache && typeof cache.values === 'function' && cache.size) return Array.from(cache.values());
    return Array.isArray(parsedPdf.pages) ? parsedPdf.pages : [];
  }

  function wordsOn(page) {
    if (Number.isFinite(page.wordCount)) return page.wordCount;
    return (page.lines || []).reduce((sum, l) => sum + (l.wordCount || 0), 0);
  }

  function pageKind(page) {
    const ink = page && page.ink;
    if (ink && ink.recognised) return 'read';
    if (ink && ink.reason === 'no-text') return 'picture';
    if (ink && ink.reason === 'blank') return 'blank';
    if (ink) return 'text';
    return wordsOn(page) >= MIN_WORDS ? 'text' : 'blank'; // pages built without ink data (the samples)
  }

  function tally(pages) {
    const counts = { pages: 0, text: 0, read: 0, picture: 0, blank: 0 };
    for (const p of pages) {
      if (!p) continue;
      counts.pages += 1;
      counts[pageKind(p)] += 1;
    }
    return counts;
  }

  /** The loader's own verdict, when the build has one: only "blank" is taken from it. */
  function loaderSaysBlank(parsedPdf) {
    // src/pdf/ink-summary.js surveys every page of a text-less document, not only the loaded samples.
    const summary = PDFStudy.inkSummary;
    const fn = summary && typeof summary.verdict === 'function'
      ? (parsed) => summary.verdict(parsed && parsed.inkSummary)
      : PDFStudy.inkDetect && PDFStudy.inkDetect.documentVerdict;
    if (typeof fn !== 'function') return false;
    try {
      const v = fn(parsedPdf);
      const kind = typeof v === 'string' ? v : v && (v.kind || v.verdict || v.type);
      return /^(blank|empty)/i.test(String(kind || ''));
    } catch (_err) {
      return false;
    }
  }

  /**
   * Over every loaded page (all pages of a short document, the samples of a long one).
   * -> { kind: 'blank' | 'pictures' | 'text', pages, text, read, picture, blank }
   */
  function documentVerdict(parsedPdf) {
    const counts = tally(loadedPages(parsedPdf));
    let kind = 'text';
    if (counts.pages > 0 && counts.text === 0 && counts.read === 0) {
      kind = counts.blank / counts.pages >= BLANK_SHARE ? 'blank' : 'pictures';
    }
    if (kind !== 'blank' && loaderSaysBlank(parsedPdf)) kind = 'blank';
    return Object.assign(counts, { kind });
  }

  /**
   * Over the loaded pages of one page range.
   * -> { kind: 'unknown' | 'blank' | 'pictures' | 'read' | 'text', pages, text, read, picture, blank }
   * 'read' means no page had selectable text but at least one picture was recognised.
   */
  function scopeVerdict(parsedPdf, startPage, endPage) {
    const inRange = loadedPages(parsedPdf).filter((p) => p && p.pageNumber >= startPage && p.pageNumber <= endPage);
    const counts = tally(inRange);
    let kind = 'text';
    if (counts.pages === 0) kind = 'unknown';
    else if (counts.blank === counts.pages) kind = 'blank';
    else if (counts.text === 0) kind = counts.read > 0 ? 'read' : 'pictures';
    return Object.assign(counts, { kind });
  }

  /**
   * True when the slides/textbook call deserves a "Wrong? Switch" hint: the classifier was unsure,
   * a "textbook" is short, sparse and has no outline, or "slides" carry a textbook's worth of words.
   * info: { classification, mode: 'slide_deck' | 'book', numPages, hasOutline }
   */
  function typeDoubt(info) {
    const cls = (info && info.classification) || {};
    const words = (cls.metrics && cls.metrics.medianWordsPerPage) || 0;
    if (cls.confidence > 0 && cls.confidence < LOW_CONFIDENCE) return true;
    if (info.mode === 'book') return !info.hasOutline && info.numPages < SHORT_BOOK_PAGES && words < SPARSE_WORDS_PER_PAGE;
    return words > DENSE_WORDS_PER_PAGE;
  }

  PDFStudy.docVerdict = { documentVerdict, scopeVerdict, typeDoubt, pageKind, loadedPages };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.docVerdict;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Printed pages: the page number a student sees printed on a book page ("p. 146"), next to the PDF's own page
 * index (188) that the app navigates by. Read from the PDF's page labels when it has them, otherwise from the
 * numbers printed in the pages' running heads and folios: when the parsed pages agree on one offset between
 * printed number and index, every page in the document gets its number from that offset.
 *   labelsOf(pdfDoc)      -> Promise<string[] | null>  (PDF.js getPageLabels)
 *   printed(parsed, n)    -> '146' | ''   ('' when unknown or when it is the index itself)
 *   relabel(parsed, text, range)       -> the app's "(p. N)" citations in text with printed numbers
 *   printedRange(parsed, first, last)  -> 'p. 146–168' | ''
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Pages that must agree on the offset before it is trusted, and the share of them that must agree
  const MIN_AGREEING = 2;
  const AGREE_SHARE = 0.6;
  const MAX_FOLIO = 5000;
  // A folio line: a bare number, or a running head that opens or closes with one ("38 CHAPTER 2 / ...")
  const BARE_RE = /^\s*(\d{1,4})\s*$/;
  const HEAD_RE = /^\s*(\d{1,4})\s+\D.{3,}$|^.{3,}\D\s+(\d{1,4})\s*$/;

  async function labelsOf(pdfDoc) {
    try {
      const labels = pdfDoc && typeof pdfDoc.getPageLabels === 'function' ? await pdfDoc.getPageLabels() : null;
      return Array.isArray(labels) && labels.some((l, i) => l && l !== String(i + 1)) ? labels : null;
    } catch (_err) {
      return null;
    }
  }

  /** The number printed in a page's top or bottom band, or null. */
  function folioOf(page) {
    const lines = (page && page.lines) || [];
    const h = page && page.height;
    for (const l of lines) {
      if (!l || l.isMargin) continue;
      const inBand = l.kind === 'folio' || (h && Number.isFinite(l.topY) && (l.topY < h * 0.08 || l.topY > h * 0.92));
      if (!inBand) continue;
      const t = String(l.text || '').replace(/[ -‏ ]/g, ' ');
      const m = t.match(BARE_RE) || t.match(HEAD_RE);
      const n = m ? Number(m[1] || m[2]) : NaN;
      if (n > 0 && n < MAX_FOLIO) return n;
    }
    return null;
  }

  /** The offset (printed - index) most of the parsed pages agree on, cached on the document; null when unsure. */
  function offsetOf(parsed) {
    const pages = parsed && parsed.pageCache ? [...parsed.pageCache.values()] : (parsed && parsed.pages) || [];
    const loaded = pages.filter(Boolean).length;
    if (parsed && parsed.__folioOffset && parsed.__folioOffset.loaded === loaded) return parsed.__folioOffset.value;
    const counts = new Map();
    let seen = 0;
    for (const p of pages) {
      const f = p ? folioOf(p) : null;
      if (f === null) continue;
      seen++;
      counts.set(f - p.pageNumber, (counts.get(f - p.pageNumber) || 0) + 1);
    }
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    const value = best && best[1] >= MIN_AGREEING && best[1] >= seen * AGREE_SHARE ? best[0] : null;
    if (parsed) parsed.__folioOffset = { loaded, value };
    return value;
  }

  function printed(parsed, n) {
    const index = Number(n);
    if (!parsed || !(index > 0)) return '';
    const labels = parsed.pageLabels;
    if (Array.isArray(labels)) {
      const label = String(labels[index - 1] || '').trim();
      return label && label !== String(index) ? label : '';
    }
    const offset = offsetOf(parsed);
    if (offset === null || offset === 0 || index + offset < 1) return '';
    return String(index + offset);
  }

  // A page the app cites in its own text: " (p. 228)" after a card's context or a worked answer's explanation.
  const CITED_RE = /\(p\.\s?(\d{1,4})\)/g;

  /**
   * The app's own page citations in a text, with the printed number: "Arrays (p. 368)" -> "Arrays (p. 232)". Only pages
   * inside `range` ([first, last] PDF pages of the material shown) are the app's: the book's own cross-references
   * ("see p. 45") already print its numbers and point elsewhere. A page with no printed number keeps its index.
   */
  function relabel(parsed, text, range) {
    if (text == null) return text;
    return String(text).replace(CITED_RE, (all, n) => {
      const i = Number(n);
      if (Array.isArray(range) && (i < range[0] || i > range[1])) return all;
      const p = printed(parsed, i);
      return p ? `(p. ${p})` : all;
    });
  }

  /** "p. 146–168" for PDF pages 188–210 when both ends have printed numbers; '' otherwise. */
  function printedRange(parsed, first, last) {
    const a = printed(parsed, first);
    const b = printed(parsed, last);
    if (!a || !b) return '';
    return Number(last) > Number(first) ? `p. ${a}–${b}` : `p. ${a}`;
  }

  const api = { labelsOf, printed, folioOf, relabel, printedRange };
  PDFStudy.printedPages = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

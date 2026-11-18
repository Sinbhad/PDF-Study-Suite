/**
 * Edits to a whole page that was read from a picture (the single-line edits are in ocr-edits.js, which also
 * re-exports these): keep the page as a picture, skip it, type its text in, or bring back the lines of a
 * page that was taken for a picture. No DOM. Every change ends in the one seam ocrEdits.changed(page).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const edits = () => mod('ocrEdits', './ocr-edits.js');
  const ocrLines = () => mod('ocrLines', './ocr-lines.js');
  const ocrMerge = () => mod('ocrMerge', './ocr-merge.js');

  const conf = (c) => (typeof c === 'number' && c >= 0 ? Math.min(1, c) : 0);
  const low = () => ocrLines().LOW_CONFIDENCE;
  const inkOf = (page) => edits().inkOf(page);
  const resultOf = (page) => edits().resultOf(page);
  const emptyResult = (page) => edits().emptyResult(page);
  const changed = (page) => edits().changed(page);
  const cleanLine = (text) => edits().cleanLine(text);
  const isPicture = (r) => edits().isPicture(r);
  const isRemoved = (r) => edits().isRemoved(r);

  /** Places kept as pictures: [{ pageNumber, box, scale }] (the whole page when the page itself is kept). */
  function pictures(page) {
    const ink = page && page.ink;
    const result = resultOf(page);
    if (!ink || !result) return [];
    const scale = result.scale > 0 ? result.scale : 1;
    const out = [];
    if (ink.keepAsPicture) out.push({ pageNumber: page.pageNumber, box: { x: 0, y: 0, w: result.width || 0, h: result.height || 0 }, scale });
    for (const line of result.lines || []) {
      for (const r of line.regions || []) {
        if (isPicture(r) && !isRemoved(r) && r.box) out.push({ pageNumber: page.pageNumber, box: r.box, scale });
      }
    }
    return out;
  }

  function keepPageAsPicture(page, on) {
    const ink = inkOf(page);
    if (!ink) return false;
    ink.keepAsPicture = on !== false;
    changed(page);
    return true;
  }

  /** "Skip this page": the page stays unchecked and is named as skipped until it is opened again. */
  function skipPage(page, on) {
    const ink = inkOf(page);
    if (!ink) return false;
    ink.checkSkipped = on !== false;
    changed(page);
    return true;
  }

  function typedLines(texts, height) {
    const step = texts.length ? (height || 0) / texts.length : 0;
    return texts.map((text, i) => ({
      index: i,
      box: { x: 0, y: Math.round(i * step), w: 0, h: 0 },
      regions: [{ id: `m-${i + 1}`, text, confidence: 1, box: null, kind: 'text', source: 'manual', added: true }],
    }));
  }

  /** Everything that was read on the page, whether or not the page was judged a picture. */
  function fullResult(page) {
    const ink = page.ink;
    return (ink.picture && ink.pictureResult) || ink.result || null;
  }

  /** A typed-in page keeps the size of the page it replaces and nothing else of what was read. */
  function typedResult(before, texts) {
    return {
      pageNumber: before.pageNumber,
      width: before.width,
      height: before.height,
      scale: before.scale,
      lines: typedLines(texts, before.height),
    };
  }

  /**
   * Replaces what was read on the page with the student's own text, one line per non-empty line.
   * The result it replaces is kept in ink.replacedResult for undoTypePage. Returns the number of lines.
   */
  function typePage(page, text) {
    const ink = inkOf(page);
    const texts = String(text == null ? '' : text).split(/\r?\n/).map(cleanLine).filter(Boolean);
    if (!ink || !texts.length) return 0;
    const before = fullResult(page) || emptyResult(page);
    ink.replacedResult = before;
    ink.wasShown = !!ink.shown;
    ink.shown = true;
    ink.typedIn = true;
    ink.picture = false; // the student's own text is writing, whatever the page was taken for
    ink.result = typedResult(before, texts);
    changed(page);
    return texts.length;
  }

  function undoTypePage(page) {
    const ink = page && page.ink;
    if (!ink || !ink.replacedResult) return false;
    ink.result = ink.replacedResult;
    ink.shown = !!ink.wasShown;
    delete ink.replacedResult;
    delete ink.wasShown;
    ink.typedIn = false;
    changed(page);
    return true;
  }

  /**
   * "Show the guesses": a page taken for a picture gets its lines back, every one of them to be checked.
   * Lines that only re-read typed text stay out, as they do on every other page.
   */
  function releasePicture(page) {
    const ink = page && page.ink;
    if (!ink) return false;
    ink.shown = true;
    if (ink.picture && ink.pictureResult) {
      const shown = ocrMerge().outsideTyped(ink.pictureResult, ink.typedLines);
      const cap = low() - 0.01;
      for (const line of shown.lines || []) {
        for (const r of line.regions || []) {
          if (r.source !== 'user' && r.source !== 'manual') {
            r.confidence = Math.min(conf(r.confidence), cap);
            r.guess = true; // shown on request: the noise rule (ocr-noise.js) must not discard it again
          }
        }
      }
      ink.pictureResult = shown;
      ink.result = shown;
    }
    changed(page);
    return true;
  }

  PDFStudy.ocrPageEdits = {
    pictures, keepPageAsPicture, skipPage, typePage, undoTypePage, releasePicture, fullResult, typedResult,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.ocrPageEdits;
})(typeof window !== 'undefined' ? window : globalThis);

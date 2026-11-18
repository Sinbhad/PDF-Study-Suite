/**
 * What a student changes on a page that was read from a picture: fix or accept a line, remove a line, add a
 * line, keep a line (or the whole page) as a picture, type the page in, skip the page. Plain functions on
 * `page.ink.result` (shape: ocr-lines.js), no DOM.
 *
 * Nothing here is known to ocr-lines.js or ocr-merge.js, so every edit leaves the result in a shape they
 * already understand:
 *   a removed line   keeps its place with text '' and confidence 1; what it said is in region.removed
 *   a picture line   has kind 'picture', text '' and confidence 1; what it said is in region.kept
 *   an added line    is an ordinary region with source 'manual', confidence 1 and no box
 * Empty text is never study text, and confidence 1 is never listed as unsure, so both stay out of everything.
 *
 * After each change exactly one seam is called: PDFStudy.ocrEdits.onChange(page). By default it re-derives
 * the page's study lines and, when PDFStudy.ocrStore.savePage exists, hands the page to it.
 *
 * This file holds the edits to single lines. Edits to a whole page are in ocr-page-edits.js and the saved
 * form of a page's edits (serialise / restore, for a cache) in ocr-edit-record.js; both are reached through
 * PDFStudy.ocrEdits as well.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const ocrLines = () => mod('ocrLines', './ocr-lines.js');
  const ocrMerge = () => mod('ocrMerge', './ocr-merge.js');

  const VERSION = 1;
  const clampConf = (c) => (typeof c === 'number' && c >= 0 ? Math.min(1, c) : 0);
  const low = () => ocrLines().LOW_CONFIDENCE;

  /** One line of text: line breaks and control characters become spaces (a pasted paragraph stays one line). */
  function cleanLine(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inkOf(page) {
    if (!page) return null;
    if (!page.ink) page.ink = { needsRecognition: true, reason: 'no-text', pathOps: 0, imageOps: 0 };
    return page.ink;
  }

  function emptyResult(page) {
    return { pageNumber: page.pageNumber, width: page.width || 0, height: page.height || 0, scale: 1, lines: [] };
  }

  /** The result being edited. A page judged to be a picture keeps its lines in ink.pictureResult. */
  function resultOf(page) {
    const ink = page && page.ink;
    if (!ink) return null;
    if (ink.picture && ink.shown && ink.pictureResult) return ink.pictureResult;
    return ink.result || null;
  }

  function find(page, regionId) {
    const result = resultOf(page);
    for (const line of (result && result.lines) || []) {
      for (const region of line.regions || []) {
        if (region.id === regionId) return { region, line, result };
      }
    }
    return null;
  }

  const isRemoved = (r) => Boolean(r && r.removed);
  const isPicture = (r) => Boolean(r && r.kind === 'picture');
  const isUnsure = (r) => Boolean(r) && !isRemoved(r) && !isPicture(r) && clampConf(r.confidence) < low();

  /** The lines still to check, in reading order (the regions themselves, not copies). */
  function toCheck(page) {
    const result = resultOf(page);
    const out = [];
    for (const line of (result && result.lines) || []) {
      for (const region of line.regions || []) {
        if (isUnsure(region)) out.push(region);
      }
    }
    return out;
  }

  /**
   * applyToPage empties ink.result when it judges the page a picture (no confident words). A page the
   * student is working on must keep its lines on screen, so they are put back.
   */
  function settle(page) {
    const ink = page.ink;
    if (ink && ink.picture && ink.shown && ink.pictureResult) ink.result = ink.pictureResult;
  }

  /** Re-derives the page's study lines from its (edited) result. */
  function rederive(page) {
    const result = resultOf(page);
    if (!result) return;
    ocrLines().applyToPage(page, result);
    settle(page);
  }

  /** The default seam: study lines again, then the cache (if one is installed). */
  function onChange(page) {
    rederive(page);
    const store = PDFStudy.ocrStore;
    if (store && typeof store.savePage === 'function') store.savePage(page);
  }

  function changed(page) {
    PDFStudy.ocrEdits.onChange(page);
  }

  /**
   * Sets a line's text. Accepting it (the default) marks it checked through ocrLines.applyCorrection;
   * { accept: false } keeps the new text but leaves the line to be checked.
   */
  function setText(page, regionId, text, opts) {
    const hit = find(page, regionId);
    if (!hit || isRemoved(hit.region) || isPicture(hit.region)) return false;
    const clean = cleanLine(text);
    page.ink.shown = true;
    hit.region.edited = true;
    if (opts && opts.accept === false) hit.region.text = clean;
    else {
      settle(page);
      ocrLines().applyCorrection(page, regionId, clean);
      settle(page);
    }
    changed(page);
    return true;
  }

  /**
   * Accepts every line left to check on the page, with one re-derive. A line with no text has nothing to
   * accept and is removed instead. Returns what undoConfirm needs to take it back.
   */
  function confirmPage(page) {
    const regions = toCheck(page);
    if (!regions.length) return [];
    const prior = regions.map((r) => ({ id: r.id, confidence: r.confidence, source: r.source, text: r.text, edited: !!r.edited }));
    page.ink.shown = true;
    for (const r of regions) {
      if (cleanLine(r.text)) {
        r.confidence = 1;
        r.source = 'user';
        r.edited = true;
      } else markRemoved(r);
    }
    changed(page);
    return prior;
  }

  function undoConfirm(page, prior) {
    for (const p of prior || []) {
      const hit = find(page, p.id);
      if (!hit) continue;
      delete hit.region.removed;
      Object.assign(hit.region, { confidence: p.confidence, source: p.source, text: p.text, edited: p.edited });
    }
    changed(page);
  }

  function markRemoved(region) {
    region.removed = { text: region.text, confidence: region.confidence, source: region.source };
    region.text = '';
    region.confidence = 1;
    region.edited = true;
  }

  function removeRegion(page, regionId) {
    const hit = find(page, regionId);
    if (!hit || isRemoved(hit.region)) return false;
    page.ink.shown = true;
    markRemoved(hit.region);
    changed(page);
    return true;
  }

  function restoreRegion(page, regionId) {
    const hit = find(page, regionId);
    if (!hit || !isRemoved(hit.region)) return false;
    Object.assign(hit.region, hit.region.removed);
    delete hit.region.removed;
    changed(page);
    return true;
  }

  function nextManualId(result) {
    let max = 0;
    for (const line of result.lines) {
      for (const r of line.regions || []) {
        const m = /^m-(\d+)$/.exec(String(r.id));
        if (m) max = Math.max(max, Number(m[1]));
      }
    }
    return `m-${max + 1}`;
  }

  /** Box of a result line (its own, else around its regions), or null for a line with no place on the page. */
  function lineBox(line) {
    if (line.box) return line.box;
    const boxes = (line.regions || []).map((r) => r.box).filter(Boolean);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * A line with no box of its own still has to sort into the page: it gets a flat (zero-height) line box
   * just under the line it follows. Zero area also means it can never be taken for a re-read of typed text.
   */
  function manualLine(region, after) {
    const under = after && lineBox(after);
    const line = { index: 0, box: under ? { x: under.x, y: under.y + under.h, w: under.w, h: 0 } : { x: 0, y: 0, w: 0, h: 0 }, regions: [region] };
    if (after && after.cluster !== undefined) line.cluster = after.cluster;
    if (after && after.group !== undefined) line.group = after.group;
    return line;
  }

  function insertLine(result, afterId, region) {
    const at = result.lines.findIndex((l) => (l.regions || []).some((r) => r.id === afterId));
    const line = manualLine(region, at === -1 ? result.lines[result.lines.length - 1] : result.lines[at]);
    result.lines.splice(at === -1 ? result.lines.length : at + 1, 0, line);
    result.lines.forEach((l, i) => { l.index = i; });
  }

  /** Adds a text line (no box) after the line holding `afterId`, or at the end. Returns the new region's id. */
  function addRegion(page, afterId, text) {
    const ink = inkOf(page);
    if (!ink) return null;
    if (!resultOf(page)) ink.result = emptyResult(page);
    const result = resultOf(page);
    const region = { id: nextManualId(result), text: cleanLine(text), confidence: 1, box: null, kind: 'text', source: 'manual', added: true, after: afterId || null };
    ink.shown = true;
    insertLine(result, afterId, region);
    changed(page);
    return region.id;
  }

  /**
   * 'picture' keeps the line's place on the page as a picture and drops its text from study material;
   * 'text' or 'math' on a picture line brings the text back.
   */
  function setRegionKind(page, regionId, kind) {
    const hit = find(page, regionId);
    if (!hit || isRemoved(hit.region)) return false;
    const r = hit.region;
    page.ink.shown = true;
    if (kind === 'picture') {
      if (isPicture(r)) return false;
      r.kept = { text: r.text, confidence: r.confidence, source: r.source, kind: r.kind === 'math' ? 'math' : 'text' };
      Object.assign(r, { kind: 'picture', text: '', confidence: 1, edited: true });
    } else {
      const was = r.kept || {};
      if (isPicture(r)) Object.assign(r, { text: was.text || '', confidence: clampConf(was.confidence), source: was.source || r.source });
      delete r.kept;
      r.kind = kind === 'math' ? 'math' : 'text';
      r.edited = true;
    }
    changed(page);
    return true;
  }

  const pageEdits = () => mod('ocrPageEdits', './ocr-page-edits.js');
  const record = () => mod('ocrEditRecord', './ocr-edit-record.js');

  PDFStudy.ocrEdits = {
    cleanLine, inkOf, resultOf, find, isUnsure, isRemoved, isPicture, toCheck,
    setText, confirmPage, undoConfirm, removeRegion, restoreRegion, addRegion, insertLine, setRegionKind,
    rederive, onChange, changed, emptyResult,
    // Whole-page edits (ocr-page-edits.js) and the saved form of a page's edits (ocr-edit-record.js)
    pictures: (page) => pageEdits().pictures(page),
    keepPageAsPicture: (page, on) => pageEdits().keepPageAsPicture(page, on),
    skipPage: (page, on) => pageEdits().skipPage(page, on),
    typePage: (page, text) => pageEdits().typePage(page, text),
    undoTypePage: (page) => pageEdits().undoTypePage(page),
    releasePicture: (page) => pageEdits().releasePicture(page),
    serialise: (page) => record().serialise(page),
    restore: (page, data) => record().restore(page, data),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.ocrEdits;
})(typeof window !== 'undefined' ? window : globalThis);

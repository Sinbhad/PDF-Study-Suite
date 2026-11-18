/**
 * The saved form of a student's edits to one read page, for a cache: serialise(page) gives plain data and
 * restore(page, data) puts it back on a page that was read again or loaded from the cache. No DOM, and no
 * storage of its own. Reached through PDFStudy.ocrEdits.serialise / restore as well.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const edits = () => mod('ocrEdits', './ocr-edits.js');
  const pageEdits = () => mod('ocrPageEdits', './ocr-page-edits.js');

  const VERSION = 1;
  const FLAGS = ['shown', 'keepAsPicture', 'checkSkipped'];
  const resultOf = (page) => edits().resultOf(page);
  const find = (page, id) => edits().find(page, id);

  const copyRegion = (r) => {
    const out = { id: r.id, text: r.text, kind: r.kind, confidence: r.confidence, source: r.source };
    if (r.removed) out.removed = Object.assign({}, r.removed);
    if (r.kept) out.kept = Object.assign({}, r.kept);
    if (r.added) out.added = true;
    return out;
  };

  /**
   * The student's edits to one page as plain data (JSON-safe), or null when the page has none.
   *   regions  every line that was changed, by id      added  lines put in by the student, in page order
   *   typed    all lines of a page that was typed in   (then regions and added are not needed)
   */
  function serialise(page) {
    const ink = page && page.ink;
    const result = resultOf(page);
    if (!ink) return null;
    const data = { v: VERSION, pageNumber: page.pageNumber, regions: [], added: [], typed: null };
    for (const key of FLAGS) if (ink[key]) data[key] = true;
    const all = ((result && result.lines) || []).flatMap((l) => l.regions || []);
    if (ink.typedIn) data.typed = all.map(copyRegion);
    else {
      for (const r of all) {
        if (r.added) data.added.push(Object.assign(copyRegion(r), { after: r.after || null }));
        else if (r.edited || r.source === 'user' || r.removed || r.kept) data.regions.push(copyRegion(r));
      }
    }
    const any = data.typed || data.regions.length || data.added.length || data.shown || data.keepAsPicture || data.checkSkipped;
    return any ? data : null;
  }

  function applyCopy(region, saved) {
    for (const key of ['text', 'kind', 'confidence', 'source']) if (saved[key] !== undefined) region[key] = saved[key];
    for (const key of ['removed', 'kept']) {
      if (saved[key]) region[key] = Object.assign({}, saved[key]);
      else delete region[key];
    }
    region.edited = true;
  }

  /**
   * Puts serialised edits back on a page (freshly read, or loaded from a cache that may already hold them:
   * applying twice changes nothing). Does not call onChange, so restoring never writes back to the cache.
   * Returns false when there was nothing to apply.
   */
  function restore(page, data) {
    const ink = data && data.v === VERSION ? edits().inkOf(page) : null;
    if (!ink) return false;
    for (const key of FLAGS) if (data[key]) ink[key] = true;
    if (data.typed) {
      const before = pageEdits().fullResult(page) || edits().emptyResult(page);
      if (!ink.typedIn) ink.replacedResult = before;
      ink.typedIn = true;
      ink.picture = false;
      ink.shown = true;
      ink.result = pageEdits().typedResult(before, data.typed.map((r) => r.text));
      ink.result.lines.forEach((line, i) => {
        applyCopy(line.regions[0], data.typed[i]);
        line.regions[0].id = data.typed[i].id;
      });
    } else if ((data.added || []).length || (data.regions || []).length) {
      if (ink.picture && ink.pictureResult && !ink.shown) ink.shown = true;
      if (!resultOf(page)) ink.result = edits().emptyResult(page);
      const result = resultOf(page);
      for (const a of data.added || []) {
        if (find(page, a.id)) continue;
        edits().insertLine(result, a.after, { id: a.id, text: '', confidence: 1, box: null, kind: 'text', source: 'manual', added: true, after: a.after || null });
      }
      for (const saved of (data.added || []).concat(data.regions || [])) {
        const hit = find(page, saved.id);
        if (hit) applyCopy(hit.region, saved);
      }
    }
    edits().rederive(page);
    return true;
  }

  PDFStudy.ocrEditRecord = { VERSION, serialise, restore };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.ocrEditRecord;
})(typeof window !== 'undefined' ? window : globalThis);

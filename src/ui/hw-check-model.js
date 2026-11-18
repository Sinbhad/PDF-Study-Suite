/**
 * What the "Check what was read" screen shows, worked out from the pages alone (no DOM):
 *   rows(page)                 the lines of a read page as the screen lists them
 *   status(page, env)          'lines' | 'hard' | 'empty' | 'picture' | 'skipped' | 'reading' | 'unread' | 'none'
 *   pages(parsed, env)         the pages the screen can open, in page order, each { pageNumber, status, toCheck }
 *   tally(parsed, env)         { pages, low, passed, reading } for the notice
 *   startPage / nextOnPage / nextUnsure   where to open and where "next line to check" goes
 * A page is still being read while page.ink.reading is true (set by whatever reads pages in the background).
 * env: { available } says whether pictures of text can be read in this build.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (name, file) => PDFStudy[name] || (typeof require === 'function' ? require(file) : null);
  const edits = () => need('ocrEdits', '../pdf/ocr-edits.js');

  // A page where at least this share of the lines is unsure is offered for typing in, not line by line
  const HARD_SHARE = 0.8;
  const HARD_MIN_ROWS = 3;

  function loadedPages(parsed) {
    const cache = parsed && parsed.pageCache;
    const list = cache && cache.size ? Array.from(cache.values()) : (parsed && parsed.pages) || [];
    return list.filter(Boolean).sort((a, b) => a.pageNumber - b.pageNumber);
  }

  function pageOf(parsed, n) {
    return (parsed && parsed.pageCache && parsed.pageCache.get(n)) || ((parsed && parsed.pages) || []).find((p) => p && p.pageNumber === n) || null;
  }

  function stateOf(region) {
    const E = edits();
    if (E.isPicture(region)) return 'picture';
    if (E.isUnsure(region)) return 'check';
    if (region.added || region.source === 'manual') return 'added';
    return region.source === 'user' ? 'checked' : 'confident';
  }

  /**
   * One row per piece of a line that is still on the page. `line` counts the lines that are shown, so the
   * numbers on screen have no gaps; a line read in two pieces gives parts 1 and 2 of the same number.
   */
  function rows(page) {
    const E = edits();
    const result = E.resultOf(page);
    const out = [];
    let lineNo = 0;
    for (const line of (result && result.lines) || []) {
      const shown = (line.regions || []).filter((r) => !E.isRemoved(r));
      if (!shown.length) continue;
      lineNo += 1;
      shown.forEach((r, i) => {
        const state = stateOf(r);
        const wasMath = r.kept && r.kept.kind === 'math';
        out.push({
          id: r.id, line: lineNo, part: i + 1, parts: shown.length, state,
          text: String(r.text == null ? '' : r.text),
          math: r.kind === 'math' || Boolean(wasMath),
          box: r.box || null,
        });
      });
    }
    return out;
  }

  /** Lines of a page taken for a picture that hold any text at all. */
  function guesses(page) {
    const result = page.ink && page.ink.pictureResult;
    return ((result && result.lines) || []).flatMap((l) => l.regions || []).filter((r) => String(r.text || '').trim()).length;
  }

  function status(page, env) {
    const ink = page && page.ink;
    if (!ink) return 'none';
    if (ink.reading) return 'reading';
    if (ink.checkSkipped) return 'skipped';
    if (!ink.recognised) return ink.needsRecognition && !ink.passedOver && env && env.available === false ? 'unread' : 'none';
    if (ink.keepAsPicture) return 'picture';
    const list = rows(page);
    if (!list.length) return ink.picture && !ink.shown && guesses(page) ? 'hard' : 'empty';
    if (ink.shown || ink.typedIn) return 'lines';
    const unsure = list.filter((r) => r.state === 'check').length;
    if (ink.held || (list.length >= HARD_MIN_ROWS && unsure / list.length >= HARD_SHARE)) return 'hard';
    return 'lines';
  }

  function entry(page, env) {
    const st = status(page, env);
    const counted = st === 'lines' || st === 'hard' || st === 'skipped';
    return { pageNumber: page.pageNumber, status: st, toCheck: counted ? edits().toCheck(page).length : 0 };
  }

  function pages(parsed, env) {
    return loadedPages(parsed).map((p) => entry(p, env)).filter((e) => e.status !== 'none');
  }

  /** Counts for the notice: pages read, lines left to check, pages the student skipped, pages still being read. */
  function tally(parsed, env) {
    const out = { pages: 0, low: 0, passed: 0, reading: 0 };
    for (const e of pages(parsed, env)) {
      if (e.status === 'reading') out.reading += 1;
      else if (e.status !== 'unread') out.pages += 1;
      if (e.status === 'skipped') out.passed += 1;
      out.low += e.toCheck;
    }
    return out;
  }

  const hasLines = (e) => e.toCheck > 0 && (e.status === 'lines' || e.status === 'hard');
  const isHard = (e) => e.status === 'hard';

  /**
   * The page to open on: the first with lines to check in the selected range, else the first anywhere;
   * failing that a page that was hard to read, then simply the first page of the range.
   */
  function startPage(list, scope) {
    const inScope = (e) => !scope || (e.pageNumber >= scope.startPage && e.pageNumber <= scope.endPage);
    const pick = list.find((e) => inScope(e) && hasLines(e)) || list.find(hasLines)
      || list.find((e) => inScope(e) && isHard(e)) || list.find(isHard) || list.find(inScope) || list[0];
    return pick ? pick.pageNumber : null;
  }

  /** Walks `items` in a circle from index `from` (exclusive) and returns the first one `want` accepts. */
  function scan(items, from, dir, want) {
    const n = items.length;
    for (let step = 1; step <= n; step++) {
      const item = items[(((from + dir * step) % n) + n) % n];
      if (want(item)) return item;
    }
    return null;
  }

  /** The next (dir 1) or previous (dir -1) line to check on the same page, going round; null when none is left. */
  function nextOnPage(list, id, dir) {
    const at = list.findIndex((r) => r.id === id);
    const hit = scan(list, at === -1 ? (dir > 0 ? -1 : list.length) : at, dir, (r) => r.state === 'check' && r.id !== id);
    return hit ? hit.id : null;
  }

  /** The next / previous line of any state on the page (no going round). */
  function neighbour(list, id, dir) {
    const at = list.findIndex((r) => r.id === id);
    const next = list[at + dir];
    return at !== -1 && next ? next.id : null;
  }

  /** The next / previous line to check anywhere in the document: { pageNumber, id } or null. Skipped pages are passed by. */
  function nextUnsure(parsed, env, at, dir) {
    const all = [];
    for (const page of loadedPages(parsed)) {
      const here = page.pageNumber === at.pageNumber;
      const list = status(page, env) === 'lines' ? rows(page) : [];
      for (const r of list) all.push({ pageNumber: page.pageNumber, id: r.id, check: r.state === 'check' });
      if (here && !list.some((r) => r.id === at.id)) all.push({ pageNumber: page.pageNumber, id: null, check: false, mark: true });
    }
    const from = all.findIndex((x) => x.pageNumber === at.pageNumber && (x.mark || x.id === at.id));
    if (from === -1) return null;
    const hit = scan(all, from, dir, (x) => x.check);
    return hit ? { pageNumber: hit.pageNumber, id: hit.id } : null;
  }

  PDFStudy.hwCheckModel = {
    HARD_SHARE, loadedPages, pageOf, rows, guesses, status, entry, pages, tally, startPage, nextOnPage, neighbour, nextUnsure,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCheckModel;
})(typeof window !== 'undefined' ? window : globalThis);

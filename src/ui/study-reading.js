/**
 * Reading the picture pages of a selection, for study-pipeline.js: which pages are read (pdf/ink-detect.js),
 * what was read before (ocr-cache.js), running the reader for the rest (hw/hw-pipeline.js), remembering its
 * results, and the counts the interface shows (appState.handwriting).
 *   read(appState, startPage, endPage, opts) -> { changed, pending }
 *       changed: pages gained text in this call (remembered or newly read)
 *       pending: pages still to be read, when opts.defer left them for later (else [])
 *   count(parsedPdf)                         -> { pages, regions, low, skipped } over every loaded page
 * A range with nothing to read (a typed book, a typed deck) never starts the reader, and neither does a
 * range whose pages are all remembered.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const none = () => ({ pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null });
  const countOf = (v) => (Array.isArray(v) ? v.length : Number(v) || 0);

  function loadedPages(parsed) {
    const cache = parsed.pageCache;
    return cache && cache.size ? Array.from(cache.values()) : parsed.pages || [];
  }

  const pageOf = (parsed, n) => (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n);

  /**
   * Recount what was read over every loaded page (pages read earlier stay counted). Only pieces kept on the
   * pages are counted: picture noise and pages judged to be pictures add nothing (pdf/ocr-lines.js).
   */
  function count(parsed) {
    const stats = { pages: 0, regions: 0, low: 0, skipped: 0 };
    for (const p of loadedPages(parsed)) {
      if (!p || !p.ink) continue;
      if (p.ink.skipped && !p.ink.recognised) stats.skipped++;
      if (!p.ink.recognised) continue;
      stats.pages++;
      for (const l of (p.ink.result && p.ink.result.lines) || []) stats.regions += (l.regions || []).length;
      if (PDFStudy.ocrLines) stats.low += PDFStudy.ocrLines.lowConfidence(p).length;
    }
    return stats;
  }

  /**
   * Pages of the selected range to read, judged from that range alone (ink-detect.js selectForReading): the
   * range must already be loaded, and the rest of the document can never hide a page the user selected.
   */
  function pagesToRead(appState, startPage, endPage, opts) {
    const detect = PDFStudy.inkDetect;
    if (!detect || !detect.selectForReading) return [];
    return detect.selectForReading(appState.parsedPdf, startPage, endPage, {
      slides: appState.activeMode === 'slide_deck',
      force: !!opts.forceHandwriting,
    });
  }

  /** The engine named by a remembered result, so a reopened document reports a reader although none ran. */
  function rememberedEngine(parsed) {
    for (const p of loadedPages(parsed)) {
      const raw = p && p.ink && p.ink.remembered && p.ink.raw;
      if (!raw || !raw.engine) continue;
      return typeof raw.engine === 'string' ? { name: raw.engine, available: true, reason: '' } : raw.engine;
    }
    return null;
  }

  /** True when the range holds typed text, so there is something to show before any picture is read. */
  function hasTypedText(parsed, startPage, endPage) {
    const verdicts = PDFStudy.docVerdict;
    return !!verdicts && verdicts.scopeVerdict(parsed, startPage, endPage).kind === 'text';
  }

  /** Writes appState.handwriting from the pages as they now are. `hw` is ensureRecognised's answer, if it ran. */
  function record(appState, hw, restored) {
    const prev = appState.handwriting;
    const idle = !hw || (!hw.pages && !hw.cancelled && !hw.engine && !hw.errors && !countOf(hw.skipped));
    if (idle && !restored) {
      if (!prev) appState.handwriting = none();
      return;
    }
    const counted = count(appState.parsedPdf);
    appState.handwriting = Object.assign(counted, {
      skipped: Math.max(counted.skipped, countOf(hw && hw.skipped)),
      cancelled: !!(hw && hw.cancelled),
      engine: (hw && hw.engine) || (prev && prev.engine) || rememberedEngine(appState.parsedPdf),
      failed: hw && hw.errors ? hw.errors.length : 0,
    });
  }

  /**
   * opts: the buildMaterials options, plus
   *   defer       when the range also holds typed text, do not read now: return the pages as `pending`
   *   onPageRead  called with the page number each time a page has been read
   * Call after the range's pages are loaded. A stale run (opts.isCurrent() false) records nothing.
   */
  async function read(appState, startPage, endPage, opts) {
    const out = { changed: false, pending: [] };
    const hwp = PDFStudy.hwPipeline;
    const parsed = appState.parsedPdf;
    if (!hwp || !parsed) return out;
    const cache = PDFStudy.ocrCache;
    if (cache) await cache.saveCorrected(parsed); // corrections made since the last build
    if (!opts.forceHandwriting && opts.handwriting === false) return out;
    const current = () => !opts.isCurrent || opts.isCurrent();
    const chosen = pagesToRead(appState, startPage, endPage, opts);
    if (!chosen.length) {
      if (!appState.handwriting) appState.handwriting = none();
      return out;
    }
    const restored = cache ? await cache.restore(parsed, chosen) : 0;
    if (!current()) return out;
    const unread = chosen.filter((n) => {
      const ink = (pageOf(parsed, n) || {}).ink || {};
      return !ink.recognised && (opts.retrySkipped || !ink.skipped);
    });
    if (opts.defer && unread.length && hasTypedText(parsed, startPage, endPage)) {
      record(appState, null, restored);
      return { changed: restored > 0, pending: unread };
    }
    let hw;
    const reapplied = []; // edits remembered for pages read again, put back before anything is counted or built
    try {
      hw = await hwp.ensureRecognised(parsed, startPage, endPage, {
        onProgress: opts.onHandwriting,
        onPageLoad: opts.onPageLoad,
        signal: opts.signal,
        isCurrent: opts.isCurrent,
        retrySkipped: !!opts.retrySkipped,
        onResult: (pageNumber) => {
          if (cache) {
            const saved = cache.save(parsed, pageNumber); // the reader's own result, before any edit is put back
            if (cache.reapply) reapplied.push(saved.then(() => cache.reapply(parsed, pageNumber)));
          }
          if (opts.onPageRead) opts.onPageRead(pageNumber);
        },
      });
    } catch (err) {
      hw = { pages: 0, cancelled: false, engine: null, errors: [{ message: String((err && err.message) || err) }] };
    }
    await Promise.all(reapplied);
    if (!current()) return out;
    record(appState, hw, restored);
    return { changed: restored > 0 || hw.pages > 0, pending: [] };
  }

  PDFStudy.studyReading = { read, count, pagesToRead };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyReading;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Worker message handling, independent of the Worker global so Node tests can drive it.
 * Protocol:
 *   in:  init | page {jobId,pageNumber,gray,width,height,scale} | cancel {jobId}
 *        init-canvas | tile {jobId,pageNumber,rgba,width,height,lineHeight}
 *   out: ready | model-progress | progress | page-done | cancelled {result?: partial page} | error
 *        canvas-ready {engine} | tile-done {jobId,pageNumber,lines,engine}
 * Two engines: `engine` (the handwriting model, loaded by init) and `canvasEngine` (PP-OCR, loaded on first use).
 * PP-OCR reads printed pages and whole tiles; on handwritten pages it gives a second opinion on pieces the
 * handwriting model is unsure of, and reads everything when the handwriting model is not installed.
 * Line and region indices in ids are 0-based: `p${page}-l${line}-r${n}`.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /**
   * A page with more regions than this is a diagram, grid or photo, not handwriting: no engine calls. Regions are
   * whole lines now (a dense real page has 40-60), so 120 leaves room for two-column or split long lines while
   * still catching pages that shatter into fragments (about 1 s per region, so 120 is already two minutes).
   */
  const MAX_REGIONS = 120;
  /** A scanned book page is all print: 60 lines cut in two or three pieces each is normal there, not a sign of clutter. */
  const MAX_PRINTED = 320;
  const clamp01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
  /** The app's review cut: pieces below it are held back for a look. */
  const LOW = 0.6;
  /**
   * A PP-OCR second opinion replaces an unsure handwriting-model read only when its mean character probability is
   * at least this and its own confidence passes LOW. Measured in the app on the 17 real handwritten sample pages
   * with known text: at 0.8 it took 27 reads and two pages got worse; at 0.88 it takes 12 and none does.
   */
  const SECOND_MEAN = 0.88;
  const tick = () => new Promise((res) => (typeof setTimeout === 'function' ? setTimeout(res, 0) : res()));

  /**
   * @param {{engine:object, post:function, raster?:object, segmenter:object, prep?:object, canvasEngine?:object}} deps
   *   prep defaults to hwPagePrep (page plan + crops); segmenter supplies classifyRegion; canvasEngine defaults to
   *   hwPpocrEngine when loaded (null: none)
   * @returns {{handle:function(object):Promise<void>}}
   */
  function createHandler(deps) {
    const { engine, post, segmenter } = deps;
    const prep = deps.prep || PDFStudy.hwPagePrep || (typeof require === 'function' ? require('./page-prep.js') : null);
    const cancelled = new Set();
    const active = new Set(); // jobs in flight: a cancel for any other job is ignored, so nothing lingers
    let info = null;
    let loading = null;
    const canvas = deps.canvasEngine !== undefined ? deps.canvasEngine : PDFStudy.hwPpocrEngine || null;
    let canvasLoading = null;

    function ensureLoaded() {
      if (!loading) {
        loading = Promise.resolve()
          .then(() => engine.load((p) => post({ type: 'model-progress', loaded: p && p.loaded, total: p && p.total, file: p && p.file })))
          .then((r) => {
            info = { name: engine.name, available: !!(r && r.available), reason: (r && r.reason) || '' };
            return info;
          })
          .catch((err) => {
            info = { name: engine.name, available: false, reason: String((err && err.message) || err) };
            return info;
          });
      }
      return loading;
    }

    function ensureCanvas() {
      if (!canvasLoading) {
        const name = (canvas && canvas.name) || 'ppocr-v5';
        canvasLoading = !canvas
          ? Promise.resolve({ name, available: false, reason: 'PP-OCR engine is not available in this browser' })
          : Promise.resolve()
            .then(() => canvas.load())
            .then((r) => ({ name, available: !!(r && r.available), reason: (r && r.reason) || '' }))
            .catch((err) => ({ name, available: false, reason: String((err && err.message) || err) }));
      }
      return canvasLoading;
    }

    async function recogniseRegion(engineInfo, crop, kind, eng) {
      if (!engineInfo.available) return { text: '', confidence: 0 };
      try {
        const r = await (eng || engine).recognise(crop, kind);
        const k = r && (r.kind === 'text' || r.kind === 'math') ? r.kind : null;
        const out = { text: String((r && r.text) || ''), confidence: clamp01(r && r.confidence), kind: k };
        if (r && r.stats) out.stats = r.stats;
        return out;
      } catch (_err) {
        return { text: '', confidence: 0, kind: null };
      }
    }

    const byPpocr = (r) => Object.assign(r, { stats: Object.assign({}, r.stats, { engine: 'ppocr' }) });

    /** One piece: PP-OCR alone (`pp`), or the handwriting model with a PP-OCR second opinion when it is unsure. */
    async function readPiece(engineInfo, pp, crop, kind) {
      if (pp) return byPpocr(await recogniseRegion(pp, crop, kind, canvas));
      const r = await recogniseRegion(engineInfo, crop, kind);
      if (!engineInfo.available || r.confidence >= LOW || !canvas) return r;
      const info = await ensureCanvas();
      if (!info.available) return r;
      const alt = await recogniseRegion(info, crop, kind, canvas);
      const sure = alt.text && alt.confidence >= LOW && alt.stats && alt.stats.mean >= SECOND_MEAN;
      return sure ? byPpocr(alt) : r;
    }

    /** Resolves to { result, cancelled }; result is partial (unprocessed regions empty) when cancelled. */
    async function doPage(msg) {
      const { jobId, pageNumber, width, height, scale } = msg;
      const engineInfo = await ensureLoaded();
      const gray = msg.gray instanceof ArrayBuffer ? new Uint8Array(msg.gray) : msg.gray;
      // the same two calls the evaluation tool makes, so what is read here is exactly what gets measured
      const plan = prep.plan(gray, width, height);
      const { lines, bin, medH } = plan;
      const total = lines.reduce((n, l) => n + l.regions.length, 0);
      const tooMany = total > (plan.printed ? MAX_PRINTED : MAX_REGIONS);
      // PP-OCR reads a printed page, or every page when the handwriting model is not installed
      const ppInfo = canvas && !tooMany && (plan.printed || !engineInfo.available) ? await ensureCanvas() : null;
      const pp = ppInfo && ppInfo.available ? ppInfo : null;
      const source = (engineInfo.available || pp) && !tooMany ? 'model' : 'manual';
      let done = 0;
      let stop = false; // user cancel; a too-busy page is skipped, not cancelled
      const outLines = [];
      for (const line of lines) {
        const regions = [];
        for (const reg of line.regions) {
          if (!stop && cancelled.has(jobId)) stop = true;
          const guess = segmenter.classifyRegion(bin, reg.box, medH);
          const id = `p${pageNumber}-l${line.index}-r${regions.length}`;
          if (stop || tooMany) {
            regions.push({ id, kind: guess, box: reg.box, text: '', confidence: 0, source: 'manual' });
            continue;
          }
          const crop = prep.cropFor(plan, gray, width, height, reg.box); // soft gray, dark ink on white
          const rec = await readPiece(engineInfo, pp, crop, guess);
          const region = { id, kind: rec.kind || guess, box: reg.box, text: rec.text, confidence: rec.confidence, source };
          if (rec.stats) region.stats = rec.stats;
          regions.push(region);
          done++;
          post({ type: 'progress', jobId, pageNumber, done, total });
          await tick();
        }
        outLines.push({ index: line.index, box: line.box, regions });
      }
      const result = { pageNumber, scale, width, height, lines: outLines };
      if (plan.printed) result.printed = true;
      if (plan.letterhead && plan.letterhead.length) result.letterhead = plan.letterhead.length;
      if (tooMany) result.skippedReason = 'too-many-regions';
      if (tooMany || (!stop && !cancelled.has(jobId))) return { result, cancelled: false };
      result.partial = true;
      return { result: done > 0 ? result : null, cancelled: true };
    }

    /** Detect and read a whole RGBA tile with PP-OCR; posts tile-done, or cancelled when stopped. */
    async function doTile(msg) {
      const { jobId, pageNumber, width, height, lineHeight } = msg;
      const info = await ensureCanvas();
      const rgba = msg.rgba instanceof ArrayBuffer ? new Uint8ClampedArray(msg.rgba) : msg.rgba;
      const stop = () => cancelled.has(jobId);
      let lines = [];
      if (info.available && !stop()) lines = ((await canvas.readTile({ rgba, width, height }, { lineHeight, shouldStop: stop })) || {}).lines || [];
      if (stop()) post({ type: 'cancelled', jobId, pageNumber });
      else post({ type: 'tile-done', jobId, pageNumber, lines, engine: info });
    }

    async function doPageJob(msg) {
      const r = await doPage(msg);
      if (!r.cancelled) post({ type: 'page-done', jobId: msg.jobId, result: r.result });
      else {
        const out = { type: 'cancelled', jobId: msg.jobId, pageNumber: msg.pageNumber };
        if (r.result) out.result = r.result;
        post(out);
      }
    }

    /** Handle one inbound message; the returned promise settles when its work is finished. */
    async function handle(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'cancel') {
        if (active.has(msg.jobId)) cancelled.add(msg.jobId);
        return;
      }
      if (msg.type === 'init') {
        post({ type: 'ready', engine: await ensureLoaded() });
        return;
      }
      if (msg.type === 'init-canvas') {
        post({ type: 'canvas-ready', engine: await ensureCanvas() });
        return;
      }
      if (msg.type !== 'page' && msg.type !== 'tile') return;
      active.add(msg.jobId);
      try {
        await (msg.type === 'page' ? doPageJob(msg) : doTile(msg));
      } catch (err) {
        post({ type: 'error', jobId: msg.jobId, message: String((err && err.message) || err) });
      } finally {
        cancelled.delete(msg.jobId);
        active.delete(msg.jobId);
      }
    }

    return { handle };
  }

  PDFStudy.hwWorkerCore = { createHandler, MAX_REGIONS, MAX_PRINTED, LOW, SECOND_MEAN };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwWorkerCore;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

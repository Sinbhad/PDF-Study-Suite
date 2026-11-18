/**
 * Worker message handling, independent of the Worker global so Node tests can drive it.
 * Protocol:
 *   in:  init | page {jobId,pageNumber,gray,width,height,scale,angle?,upright?} | cancel {jobId}
 *        init-canvas | tile {jobId,pageNumber,rgba,width,height,lineHeight,angle?}
 *   out: ready | model-progress | progress | page-done | cancelled {result?: partial page} | error
 *        canvas-ready {engine} | tile-done {jobId,pageNumber,lines,engine}
 * Two engines, each optional: `engine` (the handwriting model) and `canvasEngine` (PP-OCR). `ready` reports the
 * one that will read line crops: the handwriting model when it is installed, otherwise PP-OCR.
 * PP-OCR reads printed pages and whole tiles; on handwritten pages it gives a second opinion on pieces the
 * handwriting model is unsure of, and reads everything when the handwriting model is not installed.
 * A page is straightened and turned upright before it is planned (upright.js); `angle` is the slope of its text
 * lines when the caller has measured it, and `upright: true` says the page is known to be the right way up, so
 * no lines are read to find that out. Boxes in results are always in the pixels of the page as given.
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
  /**
   * On a page PP-OCR reads, a box narrower than this many times its height is not sent to the recogniser. By the
   * proportions of ordinary letters three characters need a box about twice as wide as it is tall, so such a box
   * holds two characters at most, and a piece with fewer than three letters or digits is discarded as picture
   * noise anyway (pdf/ocr-noise.js). Photographs and diagrams shatter into dozens of these. The value is a
   * judgement from letter proportions, not a measurement; three very narrow letters ("ill") can fall under it.
   * The handwriting model's pages keep such boxes: a lone symbol matters in handwritten maths.
   */
  const MIN_READ_ASPECT = 1.2;
  const NOT_READ = { text: '', confidence: 0, kind: null };
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
    const upright = deps.upright || PDFStudy.hwUpright || (typeof require === 'function' ? require('./upright.js') : null);
    const cancelled = new Set();
    const active = new Set(); // jobs in flight: a cancel for any other job is ignored, so nothing lingers
    let info = null;
    let loading = null;
    const canvas = deps.canvasEngine !== undefined ? deps.canvasEngine : PDFStudy.hwPpocrEngine || null;
    let canvasLoading = null;

    const tellProgress = (p) => post({ type: 'model-progress', loaded: p && p.loaded, total: p && p.total, file: p && p.file });

    function ensureLoaded() {
      if (!loading) {
        loading = Promise.resolve()
          .then(() => engine.load(tellProgress))
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
            .then(() => canvas.load(tellProgress))
            .then((r) => ({ name, available: !!(r && r.available), reason: (r && r.reason) || '', threads: canvas.threads ? canvas.threads() : 1 }))
            .catch((err) => ({ name, available: false, reason: String((err && err.message) || err) }));
      }
      return canvasLoading;
    }

    /**
     * The engine that reads line crops, for `ready`: the handwriting model, or PP-OCR when that model is not
     * installed. Not having the handwriting model is normal and is never reported as a problem; when nothing
     * can read, the reason given is PP-OCR's, because that is the reader an install needs first.
     */
    async function ensureReader() {
      const hw = await ensureLoaded();
      if (hw.available || !canvas) return hw;
      const pp = await ensureCanvas();
      return pp.available ? pp : { name: hw.name, available: false, reason: pp.reason || hw.reason };
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
      const pieces = (p) => p.lines.reduce((n, l) => n + l.regions.length, 0);
      const overfull = (p) => pieces(p) > (p.printed ? MAX_PRINTED : MAX_REGIONS);
      // PP-OCR reads a printed page, or every page when the handwriting model is not installed
      const ppFor = async (p) => {
        if (!canvas || overfull(p) || !(p.printed || !engineInfo.available)) return null;
        const info = await ensureCanvas();
        return info.available ? info : null;
      };
      const canRead = engineInfo.available || !!(canvas && (await ensureCanvas()).available);
      const started = Date.now();
      // The page is straightened, and turned the right way up by reading a few of its lines with the engine
      // that reads the page (those reads are reused below). The plan and the crops are the same two page-prep
      // calls the evaluation tool makes, on that upright view.
      const { view, plan, reads, work } = await upright.choose(gray, width, height, {
        angle: msg.angle,
        upright: msg.upright === true,
        plan: prep.plan,
        crop: prep.cropFor,
        read: canRead ? async (crop, p, box) => readPiece(engineInfo, await ppFor(p), crop, segmenter.classifyRegion(p.bin, box, p.medH)) : null,
        skip: overfull,
        stopped: () => cancelled.has(jobId),
      });
      const oriented = Date.now();
      const { lines, bin, medH } = plan;
      const total = pieces(plan);
      const tooMany = overfull(plan);
      const pp = await ppFor(plan);
      const source = (engineInfo.available || pp) && !tooMany ? 'model' : 'manual';
      let done = 0;
      let unreadTiny = 0;
      let stop = false; // user cancel; a too-busy page is skipped, not cancelled
      const outLines = [];
      for (const line of lines) {
        const regions = [];
        for (const reg of line.regions) {
          if (!stop && cancelled.has(jobId)) stop = true;
          const guess = segmenter.classifyRegion(bin, reg.box, medH);
          const id = `p${pageNumber}-l${line.index}-r${regions.length}`;
          const box = upright.pageBox(view, reg.box);
          // a piece already read for the orientation check is not read again (and counts as read after a cancel)
          const early = tooMany ? null : reads.get(upright.keyOf(reg.box));
          if ((stop && !early) || tooMany) {
            regions.push({ id, kind: guess, box, text: '', confidence: 0, source: 'manual' });
            continue;
          }
          // a box with room for two characters at most is not read (PP-OCR pages only: see MIN_READ_ASPECT)
          const tiny = !early && !!pp && reg.box.w < MIN_READ_ASPECT * reg.box.h;
          if (tiny) unreadTiny++;
          const crop = early || tiny ? null : prep.cropFor(plan, view.gray, view.width, view.height, reg.box); // soft gray, dark ink on white
          const rec = early || (tiny ? NOT_READ : await readPiece(engineInfo, pp, crop, guess));
          const region = { id, kind: rec.kind || guess, box, text: rec.text, confidence: rec.confidence, source };
          // on a turned page `box` is the page rectangle around the sloping piece; `size` is the piece itself
          if (view.frame) region.size = { w: reg.box.w, h: reg.box.h };
          if (rec.stats) region.stats = rec.stats;
          regions.push(region);
          done++;
          post({ type: 'progress', jobId, pageNumber, done, total });
          await tick();
        }
        outLines.push({ index: line.index, box: upright.pageBox(view, line.box), regions });
      }
      const result = { pageNumber, scale, width, height, lines: outLines };
      // where the time went (ms): straightening, page plans and the orientation check, then reading the pieces
      result.timing = {
        orient: oriented - started,
        read: Date.now() - oriented,
        plans: (work && work.plans) || 1,
        probes: (work && work.reads) || 0,
        pieces: done,
        tiny: unreadTiny,
      };
      if (view.frame) result.angle = view.angle;
      if (source === 'model') result.engine = pp ? pp.name : engineInfo.name;
      if (plan.printed) result.printed = true;
      if (plan.letterhead && plan.letterhead.length) result.letterhead = plan.letterhead.length;
      if (tooMany) result.skippedReason = 'too-many-regions';
      if (tooMany || (!stop && !cancelled.has(jobId))) return { result, cancelled: false };
      result.partial = true;
      return { result: done > 0 ? result : null, cancelled: true };
    }

    /** Detect and read a whole RGBA tile with PP-OCR; posts tile-done, or cancelled when stopped. */
    async function doTile(msg) {
      const { jobId, pageNumber, width, height, lineHeight, angle } = msg;
      const info = await ensureCanvas();
      const rgba = msg.rgba instanceof ArrayBuffer ? new Uint8ClampedArray(msg.rgba) : msg.rgba;
      const stop = () => cancelled.has(jobId);
      let lines = [];
      if (info.available && !stop()) lines = ((await canvas.readTile({ rgba, width, height }, { lineHeight, angle, shouldStop: stop })) || {}).lines || [];
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
        post({ type: 'ready', engine: await ensureReader() });
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

  PDFStudy.hwWorkerCore = { createHandler, MAX_REGIONS, MAX_PRINTED, LOW, SECOND_MEAN, MIN_READ_ASPECT };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwWorkerCore;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Orchestrates handwriting recognition for a parsed PDF: finds pages needing it, renders each one, sends it to
 * the worker and applies the result to the page lines. An ordinary page goes as one gray bitmap and is read line
 * by line. A canvas page (tiny writing in separate islands, canvas-plan.js) is rendered again enlarged, tile by
 * tile, and read by the tile reader; so is a page the line reader gives up on for having too many pieces.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const LOW_CONFIDENCE = 0.6;
  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const optional = (key, file) => {
    try { return mod(key, file); } catch (_err) { return null; }
  };
  const IDLE_MS = 90000;
  let sharedClient = null;
  let idleTimer = null;

  /** Module-level shared client (created lazily; no worker starts until init()). */
  function getClient() {
    if (!sharedClient) sharedClient = mod('hwClient', './hw-client.js').create({});
    return sharedClient;
  }

  function clearIdle() {
    if (idleTimer !== null && typeof clearTimeout === 'function') clearTimeout(idleTimer);
    idleTimer = null;
  }

  /** Release the shared worker after IDLE_MS without another call (never keeps Node alive). */
  function scheduleIdle() {
    clearIdle();
    if (typeof setTimeout !== 'function') return;
    idleTimer = setTimeout(() => { idleTimer = null; dispose(); }, IDLE_MS);
    if (idleTimer && idleTimer.unref) idleTimer.unref();
  }

  /** Release the shared worker. */
  function dispose() {
    clearIdle();
    if (sharedClient) sharedClient.dispose();
    sharedClient = null;
  }

  /**
   * Render a PDF.js page to a gray bitmap about `targetWidth` px wide (scale capped at 3).
   * @returns {Promise<{gray:Uint8Array,width:number,height:number,scale:number}>}
   */
  async function renderPageGray(pdfDoc, pageNumber, targetWidth) {
    const page = await pdfDoc.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, (targetWidth || 1650) / base.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const gray = mod('hwRaster', './raster.js').toGray(img.data, canvas.width, canvas.height);
      return { gray, width: canvas.width, height: canvas.height, scale };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
      if (page.cleanup) page.cleanup();
    }
  }

  const getPage = (parsed, n) => (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n);

  const hasText = (result) => result.lines.some((l) => l.regions.some((r) => r.text));

  /**
   * Recognise handwritten pages in [startPage, endPage]. A cancelled page keeps the regions already read
   * (err.partial); pages not read because of a cancel get ink.skipped and are ignored until retrySkipped.
   * @param {object} parsedPdf
   * @param {number} startPage
   * @param {number} endPage
   * @param {{onProgress?:function, onPageLoad?:function, signal?:AbortSignal, renderPage?:function, client?:object, retrySkipped?:boolean}} [opts]
   *   onPageLoad(cur, total, pageNumber) keeps the ordinary page-reading progress alive for lazy documents.
   * @returns {Promise<{pages:number,regions:number,low:number,skipped:number,cancelled:boolean,engine:?object,errors?:object[]}>}
   */
  async function ensureRecognised(parsedPdf, startPage, endPage, opts) {
    const o = opts || {};
    const out = { pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null };
    const loader = optional('pdfLoader', '../pdf/pdf-loader.js');
    if (parsedPdf.pdfDoc && loader && loader.ensurePagesLoaded) await loader.ensurePagesLoaded(parsedPdf, startPage, endPage, o.onPageLoad);
    const detect = optional('inkDetect', '../pdf/ink-detect.js');
    const lines = optional('ocrLines', '../pdf/ocr-lines.js');
    if (!detect || !lines || !detect.pagesNeeding) return out;
    const all = detect.pagesNeeding(parsedPdf, startPage, endPage);
    const isSkipped = (n) => { const p = getPage(parsedPdf, n); return !!(p && p.ink && p.ink.skipped); };
    if (o.retrySkipped === true) for (const n of all) if (isSkipped(n)) getPage(parsedPdf, n).ink.skipped = false;
    const needed = all.filter((n) => !isSkipped(n));
    out.skipped = all.length - needed.length;
    if (!needed.length) return out;

    const signal = o.signal;
    const client = o.client || getClient();
    const canvas = o.renderPage ? null : optional('hwCanvasRead', './canvas-read.js');
    const planner = optional('hwCanvasPlan', './canvas-plan.js');
    const tiled = !!(canvas && planner && client.readTile && parsedPdf.pdfDoc); // enlarged tile reading is possible
    const render = o.renderPage || ((doc, n) => renderPageGray(doc, n, 1650));
    const progress = (p) => { if (o.onProgress) o.onProgress(p); };
    let wake = null;
    const aborted = new Promise((res) => { wake = res; });
    const onAbort = () => { out.cancelled = true; client.cancel(); wake(null); };
    if (signal) {
      if (signal.aborted) { out.cancelled = true; return out; }
      signal.addEventListener('abort', onAbort);
    }
    clearIdle();
    const prevHook = client.onModelProgress;
    client.onModelProgress = (m) => progress({ phase: 'model', pageNumber: needed[0], pageIndex: 0, pageCount: needed.length, done: m.loaded, total: m.total });
    const errors = [];
    const count = (result) => {
      lines.applyToPage(getPage(parsedPdf, result.pageNumber), result);
      out.pages++;
      for (const l of result.lines) for (const r of l.regions) { out.regions++; if (r.confidence < LOW_CONFIDENCE) out.low++; }
    };
    const note = (info) => { if (info && !(out.engine && out.engine.available)) out.engine = info; };
    let lineReader = null;
    /** Load the line reader once (a document of canvas pages never needs it). */
    const startLines = () => {
      if (!lineReader) {
        lineReader = Promise.race([client.init(), aborted]).then((info) => {
          if (!info) client.dispose(); // cancelled while the model was loading
          note(info);
        });
      }
      return lineReader;
    };
    /** Overview first; then the tile reader for a canvas page, else the line reader (tiles if it gives up). */
    const readSurveyed = async (n, pageObj, onPage) => {
      const shot = await canvas.renderOverview(parsedPdf.pdfDoc, n, 1650);
      try {
        if (out.cancelled) return null;
        const survey = planner.survey(shot.rgba, shot.width, shot.height);
        const readTiles = async () => {
          const info = await Promise.race([client.initCanvas(), aborted]);
          note(info);
          if (!info || !info.available) return null;
          const r = await canvas.readPage(shot, survey, { pageNumber: n, client, onProgress: onPage, isCancelled: () => out.cancelled });
          return r.lines.length ? r : null;
        };
        if (survey.dense) {
          const r = await readTiles();
          if (r || out.cancelled) return r;
        }
        await startLines();
        if (out.cancelled) return null;
        const raster = mod('hwRaster', './raster.js');
        // drawn ink on a white page keeps its pen colours' contrast; a photo or scan is grayed by brightness
        const gray = (pageObj.ink && !pageObj.ink.imageOps ? raster.inkGray : raster.toGray)(shot.rgba, shot.width, shot.height);
        const result = await client.recognisePage({ pageNumber: n, gray, width: shot.width, height: shot.height, scale: shot.scale }, onPage);
        return (result.skippedReason === 'too-many-regions' && (await readTiles())) || result;
      } finally {
        canvas.release(shot.page);
      }
    };
    try {
      if (!tiled) await startLines();
      for (let i = 0; i < needed.length && !out.cancelled; i++) {
        const n = needed[i];
        const pageObj = getPage(parsedPdf, n);
        if (!pageObj) continue;
        const onPage = (p) => progress({ phase: 'page', pageNumber: n, pageIndex: i, pageCount: needed.length, done: p.done, total: p.total });
        try {
          let result = null;
          if (tiled) result = await readSurveyed(n, pageObj, onPage);
          else {
            const img = await render(parsedPdf.pdfDoc, n);
            if (out.cancelled) break;
            result = await client.recognisePage({ pageNumber: n, ...img }, onPage);
          }
          if (result) count(result);
        } catch (err) {
          if (err && err.name === 'AbortError') {
            out.cancelled = true;
            if (err.partial && hasText(err.partial)) count(err.partial);
          } else errors.push({ pageNumber: n, message: String((err && err.message) || err) });
        }
      }
    } finally {
      if (signal) signal.removeEventListener('abort', onAbort);
      client.onModelProgress = prevHook;
    }
    if (out.cancelled) {
      for (const n of needed) {
        const p = getPage(parsedPdf, n);
        if (p && p.ink && !p.ink.recognised) p.ink.skipped = true;
      }
    }
    out.skipped = all.filter(isSkipped).length;
    if (errors.length) out.errors = errors;
    if (!o.client) scheduleIdle();
    return out;
  }

  PDFStudy.hwPipeline = { ensureRecognised, renderPageGray, getClient, dispose };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPipeline;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

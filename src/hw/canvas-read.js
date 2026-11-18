/**
 * Renders pages for recognition and reads a canvas page (see canvas-plan.js) tile by tile: each tile is drawn
 * straight from the PDF at the enlargement the plan asks for, read by the worker, and the lines of all tiles
 * are put back into the overview's pixel space and into reading order (canvas-order.js).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);

  /** Draw a viewport of `page` on a white canvas of w x h pixels and return its RGBA pixels. */
  async function draw(page, viewport, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, w);
    canvas.height = Math.max(1, h);
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return { rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  /**
   * Whole page about `targetWidth` px wide (scale capped at 3). The page object is returned still open so that
   * tiles can be drawn from it without parsing the page again; call release(page) when done.
   * @returns {Promise<{page:object, rgba:Uint8ClampedArray, width:number, height:number, scale:number}>}
   */
  async function renderOverview(pdfDoc, pageNumber, targetWidth) {
    const page = await pdfDoc.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(3, (targetWidth || 1650) / base.width);
      const viewport = page.getViewport({ scale });
      const shot = await draw(page, viewport, Math.round(viewport.width), Math.round(viewport.height));
      return Object.assign(shot, { page, scale });
    } catch (err) {
      release(page);
      throw err;
    }
  }

  /** One tile: rectangle `rect` of the overview (its pixels), enlarged `rect.zoom` times. */
  function renderTile(page, scale, rect) {
    const z = rect.zoom;
    const viewport = page.getViewport({ scale: scale * z, offsetX: -rect.x * z, offsetY: -rect.y * z });
    return draw(page, viewport, Math.ceil(rect.w * z), Math.ceil(rect.h * z));
  }

  function release(page) {
    if (page && page.cleanup) page.cleanup();
  }

  const round1 = (v) => Math.round(v * 10) / 10;

  /**
   * Page result (the shape ocr-lines.js reads) from lines in overview pixels. The reading order is worked out
   * on `box`; a line of a crooked page also carries `pageBox`, its rectangle on the page as given, and that is
   * the box the result reports.
   */
  function toResult(shot, pageNumber, placed) {
    const order = mod('hwCanvasOrder', './canvas-order.js').arrange(placed);
    const lines = order.lines.map((l, index) => {
      const src = l.pageBox || l.box;
      const box = { x: round1(src.x), y: round1(src.y), w: round1(src.w), h: round1(src.h) };
      const region = { id: `p${pageNumber}-l${index}-r0`, kind: 'text', box, text: l.text, confidence: l.confidence, source: 'model' };
      if (l.pageBox) region.size = { w: round1(l.box.w), h: round1(l.box.h) };
      if (l.stats) region.stats = l.stats;
      return { index, box, cluster: l.cluster, group: l.group, regions: [region] };
    });
    return { pageNumber, scale: shot.scale, width: shot.width, height: shot.height, layout: 'canvas', clusters: order.clusters, groups: order.groups, lines };
  }

  /**
   * Where a line read from a turned tile lies once the whole page is level: its own size (`size`), centred on
   * the page-box centre carried into the page's upright frame. Lines of every tile then share one level space,
   * so the reading order sees straight rows and columns.
   */
  function levelBox(pageFrame, pageBox, size) {
    const c = pageFrame.toFrame(pageBox.x + pageBox.w / 2, pageBox.y + pageBox.h / 2);
    return { x: c.x - size.w / 2, y: c.y - size.h / 2, w: size.w, h: size.h };
  }

  /**
   * Read a surveyed canvas page. A cancel rejects with the AbortError from the client; the tiles read so far
   * ride along as err.partial.
   * @param {{page:object, scale:number, width:number, height:number}} shot from renderOverview
   * @param {object} survey from hwCanvasPlan.survey
   * @param {{pageNumber:number, client:object, angle?:number, onProgress?:function, isCancelled?:function, renderTile?:function}} o
   *   angle: slope of the page's text lines in degrees (skew-angle.js); every tile is read turned level by it
   * @returns {Promise<object>} page result with layout 'canvas'; result.engine is the tile reader's info
   */
  async function readPage(shot, survey, o) {
    const plan = mod('hwCanvasPlan', './canvas-plan.js');
    const rects = plan.tiles(survey, shot.width, shot.height);
    const drawTile = o.renderTile || PDFStudy.hwCanvasRead.renderTile;
    const placed = [];
    let engine = null;
    const turn = mod('hwPageTurn', './page-turn.js');
    const angle = turn && turn.needsTurn(o.angle) ? turn.fold(o.angle) : 0;
    const pageFrame = angle ? turn.frame(shot.width, shot.height, angle) : null;
    const finish = () => {
      const result = Object.assign(toResult(shot, o.pageNumber, placed), { tiles: rects.length, engine });
      if (angle) result.angle = angle;
      return result;
    };
    for (let i = 0; i < rects.length; i++) {
      const rect = rects[i];
      try {
        if (o.isCancelled && o.isCancelled()) throw Object.assign(new Error('Recognition cancelled'), { name: 'AbortError' });
        const tile = await drawTile(shot.page, shot.scale, rect);
        const job = { pageNumber: o.pageNumber, rgba: tile.rgba, width: tile.width, height: tile.height, lineHeight: survey.lineHeight * rect.zoom };
        if (angle) job.angle = angle;
        const read = await o.client.readTile(job);
        engine = read.engine || engine;
        if (engine && engine.available === false) break; // the tile reader is not installed: nothing will be read
        for (const l of read.lines) {
          if (!l || !l.box || !String(l.text || '').trim()) continue;
          const box = { x: rect.x + l.box.x / rect.zoom, y: rect.y + l.box.y / rect.zoom, w: l.box.w / rect.zoom, h: l.box.h / rect.zoom };
          const line = { box, text: l.text, confidence: l.confidence, stats: l.stats };
          if (pageFrame && l.size) {
            line.pageBox = box;
            line.box = levelBox(pageFrame, box, { w: l.size.w / rect.zoom, h: l.size.h / rect.zoom });
          }
          placed.push(line);
        }
      } catch (err) {
        if (err && err.name === 'AbortError' && placed.length) err.partial = Object.assign(finish(), { partial: true });
        throw err;
      }
      if (o.onProgress) o.onProgress({ done: i + 1, total: rects.length });
    }
    return finish();
  }

  PDFStudy.hwCanvasRead = { renderOverview, renderTile, release, readPage, toResult };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCanvasRead;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

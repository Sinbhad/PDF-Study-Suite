/**
 * Canvas pages: one huge page of small writing in separate islands (an infinite-canvas or mind-map export).
 * At the overview size the lines are a few pixels tall, so the page is surveyed here and cut into tiles that
 * are rendered again, enlarged, one island (or a few neighbours) at a time. Pure functions on typed arrays.
 *   survey(rgba, w, h) -> { dense, lineHeight, glyphs, inkShare, clusters:[{x,y,w,h}], grid }
 *   tiles(survey, w, h) -> [{ x, y, w, h, zoom }]   (overview pixels; zoom = enlargement for the second render)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);

  const INK_BELOW = 207; // ink-gray level under which a pixel is ink
  /** Text lines this short (overview px) cannot be read without enlarging; ordinary pages measure 25 or more. */
  const DENSE_LINE = 12;
  const MIN_GLYPHS = 150;
  /** A photo of paper is mostly "ink" by this measure; a canvas is nearly all white. */
  const MAX_INK_SHARE = 0.12;
  const TARGET_LINE = 40; // line height wanted in the enlarged tile (the recogniser reads 48 px rows)
  const MAX_ZOOM = 8;
  const MAX_SIDE = 4096;
  const MAX_PIXELS = 12e6; // one tile is at most 48 MB of RGBA

  /**
   * Connected ink shapes (8-connected): the ink-weighted median height of letter-like shapes and their count.
   * Weighting by ink keeps specks and dotted paper from deciding; shapes far wider than tall are rules.
   */
  function glyphStats(gray, w, h) {
    const n = w * h;
    const seen = new Uint8Array(n);
    const stack = new Int32Array(n);
    const shapes = [];
    let ink = 0;
    for (let start = 0; start < n; start++) {
      if (seen[start] || gray[start] >= INK_BELOW) continue;
      let top = 0;
      let area = 0;
      let x0 = w;
      let x1 = 0;
      let y0 = h;
      let y1 = 0;
      stack[top++] = start;
      seen[start] = 1;
      while (top) {
        const p = stack[--top];
        const px = p % w;
        const py = (p - px) / w;
        area++;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = py + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = px + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!seen[q] && gray[q] < INK_BELOW) { seen[q] = 1; stack[top++] = q; }
          }
        }
      }
      ink += area;
      const gh = y1 - y0 + 1;
      if (area >= 4 && x1 - x0 + 1 <= 20 * gh) shapes.push([gh, area]);
    }
    shapes.sort((a, b) => a[0] - b[0]);
    const total = shapes.reduce((s, g) => s + g[1], 0);
    let acc = 0;
    let height = 0;
    for (const g of shapes) {
      acc += g[1];
      if (acc >= total / 2) { height = g[0]; break; }
    }
    return { glyphs: shapes.length, height, inkShare: n ? ink / n : 0 };
  }

  /** Coarse occupancy grid (cell px) of the ink, and its islands: cells closer than `reach` cells join. */
  function islands(gray, w, h, cell, reach) {
    const gw = Math.ceil(w / cell);
    const gh = Math.ceil(h / cell);
    const occ = new Uint8Array(gw * gh);
    for (let y = 0; y < h; y++) {
      const row = Math.floor(y / cell) * gw;
      for (let x = 0; x < w; x++) if (gray[y * w + x] < INK_BELOW) occ[row + Math.floor(x / cell)] = 1;
    }
    const wide = new Uint8Array(gw * gh); // occupancy grown by `reach` cells, rows then columns
    const tmp = new Uint8Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (!occ[y * gw + x]) continue;
      for (let k = Math.max(0, x - reach); k <= Math.min(gw - 1, x + reach); k++) tmp[y * gw + k] = 1;
    }
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      if (!tmp[y * gw + x]) continue;
      for (let k = Math.max(0, y - reach); k <= Math.min(gh - 1, y + reach); k++) wide[k * gw + x] = 1;
    }
    const label = new Int32Array(gw * gh);
    const stack = [];
    const boxes = [];
    for (let s = 0; s < wide.length; s++) {
      if (!wide[s] || label[s]) continue;
      const id = boxes.length + 1;
      const b = { x0: gw, y0: gh, x1: -1, y1: -1, cells: 0 };
      label[s] = id;
      stack.push(s);
      while (stack.length) {
        const p = stack.pop();
        const px = p % gw;
        const py = (p - px) / gw;
        if (occ[p]) {
          b.cells++;
          b.x0 = Math.min(b.x0, px); b.x1 = Math.max(b.x1, px);
          b.y0 = Math.min(b.y0, py); b.y1 = Math.max(b.y1, py);
        }
        for (const q of [p - 1, p + 1, p - gw, p + gw]) {
          if (q < 0 || q >= wide.length || !wide[q] || label[q]) continue;
          if ((q === p - 1 && px === 0) || (q === p + 1 && px === gw - 1)) continue;
          label[q] = id;
          stack.push(q);
        }
      }
      boxes.push(b);
    }
    const clusters = boxes.filter((b) => b.cells >= 3).map((b) => ({
      x: b.x0 * cell, y: b.y0 * cell, w: Math.min(w, (b.x1 + 1) * cell) - b.x0 * cell, h: Math.min(h, (b.y1 + 1) * cell) - b.y0 * cell,
    }));
    return { clusters, grid: { occ, gw, gh, cell } };
  }

  /** Survey an overview render (RGBA). `dense` means the page needs the enlarged, tile-by-tile reading. */
  function survey(rgba, w, h) {
    const gray = mod('hwRaster', './raster.js').inkGray(rgba, w, h);
    const g = glyphStats(gray, w, h);
    const lineHeight = Math.max(2, 1.5 * g.height); // letter bodies are about two thirds of a line box
    const dense = g.glyphs >= MIN_GLYPHS && lineHeight <= DENSE_LINE && g.inkShare <= MAX_INK_SHARE;
    const cell = Math.max(2, Math.round(lineHeight));
    const isl = islands(gray, w, h, cell, 2);
    return { dense, lineHeight, glyphs: g.glyphs, inkShare: g.inkShare, clusters: isl.clusters, grid: isl.grid };
  }

  const zoomFor = (lineHeight) => Math.max(1, Math.min(MAX_ZOOM, TARGET_LINE / Math.max(1, lineHeight)));
  const fits = (r, zoom) => r.w * zoom <= MAX_SIDE && r.h * zoom <= MAX_SIDE && r.w * r.h * zoom * zoom <= MAX_PIXELS;

  /** Longest run of empty grid rows (or columns) inside rect `r`, away from its edges: where to cut it in two. */
  function widestGap(r, grid, alongY) {
    const { occ, gw, gh, cell } = grid;
    const a0 = Math.floor((alongY ? r.y : r.x) / cell);
    const a1 = Math.min(alongY ? gh : gw, Math.ceil((alongY ? r.y + r.h : r.x + r.w) / cell));
    const b0 = Math.floor((alongY ? r.x : r.y) / cell);
    const b1 = Math.min(alongY ? gw : gh, Math.ceil((alongY ? r.x + r.w : r.y + r.h) / cell));
    let best = null;
    let run = 0;
    for (let a = a0; a <= a1; a++) {
      let empty = a < a1;
      for (let b = b0; empty && b < b1; b++) if (occ[alongY ? a * gw + b : b * gw + a]) empty = false;
      if (empty) { run++; continue; }
      const mid = a - run / 2;
      const edge = Math.min(mid - a0, a1 - mid) / Math.max(1, a1 - a0); // 0 at an edge, 0.5 in the middle
      if (run && edge > 0.15 && (!best || run > best.run)) best = { run, at: Math.round(mid * cell) };
      run = 0;
    }
    return best;
  }

  /** Cut a rectangle that is too big to render in one go: at the widest empty band, else through the middle. */
  function split(r, zoom, grid, pad, out) {
    if (fits(r, zoom)) { out.push(r); return; }
    const gy = widestGap(r, grid, true);
    const gx = widestGap(r, grid, false);
    const tooTall = r.h * zoom > MAX_SIDE;
    let cutY = tooTall; // cut the side that is too long; when both or neither are, across the wider empty band
    if (tooTall === r.w * zoom > MAX_SIDE) cutY = gy && (!gx || gy.run >= gx.run) ? true : gx ? false : r.h > r.w;
    const gap = cutY ? gy : gx;
    const at = gap ? gap.at : Math.round(cutY ? r.y + r.h / 2 : r.x + r.w / 2);
    const lap = gap ? 0 : pad; // a blind cut overlaps, so a line on the cut is whole in one of the halves
    if (cutY) {
      split({ x: r.x, y: r.y, w: r.w, h: at + lap - r.y }, zoom, grid, pad, out);
      split({ x: r.x, y: at - lap, w: r.w, h: r.y + r.h - at + lap }, zoom, grid, pad, out);
    } else {
      split({ x: r.x, y: r.y, w: at + lap - r.x, h: r.h }, zoom, grid, pad, out);
      split({ x: at - lap, y: r.y, w: r.x + r.w - at + lap, h: r.h }, zoom, grid, pad, out);
    }
  }

  const union = (a, b) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  /**
   * Render tiles for a surveyed page: every island padded by a line, oversized ones cut, then neighbours
   * joined while the joined tile still fits and wastes little (each render replays the whole page, so fewer is faster).
   */
  function tiles(sv, w, h) {
    const zoom = zoomFor(sv.lineHeight);
    const pad = Math.ceil(2 * sv.lineHeight);
    const list = [];
    for (const c of sv.clusters) {
      const x = Math.max(0, c.x - pad);
      const y = Math.max(0, c.y - pad);
      split({ x, y, w: Math.min(w, c.x + c.w + pad) - x, h: Math.min(h, c.y + c.h + pad) - y }, zoom, sv.grid, pad, list);
    }
    for (let merged = true; merged && list.length > 1;) {
      merged = false;
      let best = null;
      for (let i = 0; i < list.length; i++) for (let j = 0; j < i; j++) {
        const u = union(list[i], list[j]);
        const waste = (u.w * u.h) / (list[i].w * list[i].h + list[j].w * list[j].h);
        if (fits(u, zoom) && waste <= 1.3 && (!best || waste < best.waste)) best = { i, j, u, waste };
      }
      if (best) {
        list.splice(best.i, 1);
        list[best.j] = best.u;
        merged = true;
      }
    }
    return list.filter((r) => r.w > 0 && r.h > 0).sort((a, b) => a.y - b.y || a.x - b.x).map((r) => Object.assign(r, { zoom }));
  }

  PDFStudy.hwCanvasPlan = { survey, tiles, zoomFor, glyphStats, DENSE_LINE, TARGET_LINE, MAX_SIDE, MAX_PIXELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCanvasPlan;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

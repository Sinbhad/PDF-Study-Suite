/**
 * Page polarity and illumination flattening for the handwriting reader.
 * The paper brightness is estimated per block (a high percentile, so ink does not count), smoothed and divided out:
 * shading, yellowed paper, binding shadows and dark scan edges become white while ink keeps its gray edges.
 * DOM-free; linear in the bitmap size.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PAPER_PCT = 0.8; // share of a block's pixels at or below its paper level (ink is the dark minority)
  const NOT_PAPER = 90; // a block whose paper level is darker than this is a desk, a binding or a border
  const KNEE = 232; // flattened values above this are paper grain and become pure white
  const DARK_PAGE = 100; // median gray below this: light ink on a dark screen or board
  const LIGHT_INK = 200; // minimum ink threshold on an inverted (dark) page
  const WEAK_MAX = 225; // the weak threshold never reaches into paper grain
  const WEAK_GROWTH = 2.5; // ...and lets the ink mask grow at most this much
  const EDGE_DARK = 128; // flattened level below which border-connected areas are cleared

  /** True when most of the page is dark (light ink on a dark background). */
  function isDarkPage(gray) {
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < gray.length; i += 5) { hist[gray[i]]++; n++; }
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc * 2 >= n) return v < DARK_PAGE; }
    return false;
  }

  function median9(a) {
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  }

  /** Paper level per block, median-smoothed: { grid, gw, gh, bs }. */
  function paperGrid(src, w, h, bs) {
    const gw = Math.ceil(w / bs);
    const gh = Math.ceil(h / bs);
    const raw = new Float32Array(gw * gh);
    const hist = new Uint32Array(256);
    for (let by = 0; by < gh; by++) {
      for (let bx = 0; bx < gw; bx++) {
        hist.fill(0);
        const x0 = bx * bs; const x1 = Math.min(w, x0 + bs);
        const y0 = by * bs; const y1 = Math.min(h, y0 + bs);
        for (let y = y0; y < y1; y++) for (let x = x0, o = y * w; x < x1; x++) hist[src[o + x]]++;
        const want = (x1 - x0) * (y1 - y0) * PAPER_PCT;
        let v = 0;
        for (let acc = hist[0]; acc < want && v < 255;) acc += hist[++v];
        raw[by * gw + bx] = v;
      }
    }
    const grid = new Float32Array(gw * gh);
    for (let by = 0; by < gh; by++) {
      for (let bx = 0; bx < gw; bx++) {
        const nb = [];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = by + dy; const xx = bx + dx;
            if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) nb.push(raw[yy * gw + xx]);
          }
        }
        grid[by * gw + bx] = median9(nb);
      }
    }
    return { grid, gw, gh, bs };
  }

  /**
   * Flattened page: dark ink on white, paper at 255, strokes keep their anti-aliased edges.
   * @returns {{flat:Uint8Array, inverted:boolean}}
   */
  function flatten(gray, w, h) {
    const inverted = isDarkPage(gray);
    const src = inverted ? gray.map((g) => 255 - g) : gray;
    const bs = Math.max(12, Math.round(Math.max(w, h) / 60));
    const { grid, gw, gh } = paperGrid(src, w, h, bs);
    const flat = new Uint8Array(w * h);
    const scale = 255 / KNEE;
    for (let y = 0; y < h; y++) {
      const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / bs - 0.5));
      const y0 = Math.floor(fy); const y1 = Math.min(gh - 1, y0 + 1); const ty = fy - y0;
      for (let x = 0; x < w; x++) {
        const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / bs - 0.5));
        const x0 = Math.floor(fx); const x1 = Math.min(gw - 1, x0 + 1); const tx = fx - x0;
        const top = grid[y0 * gw + x0] * (1 - tx) + grid[y0 * gw + x1] * tx;
        const bot = grid[y1 * gw + x0] * (1 - tx) + grid[y1 * gw + x1] * tx;
        const bg = top * (1 - ty) + bot * ty;
        const i = y * w + x;
        if (bg < NOT_PAPER) { flat[i] = 255; continue; }
        const v = (src[i] / bg) * 255 * scale;
        flat[i] = v >= 255 ? 255 : v;
      }
    }
    clearBorderDark(flat, w, h);
    return { flat, inverted };
  }

  /** Dark areas touching the page edge (scan edges, a black backdrop, a binding) are not writing: paint them white. */
  function clearBorderDark(flat, w, h) {
    const stack = [];
    const seed = (i) => { if (flat[i] < EDGE_DARK) { flat[i] = 255; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const p = stack.pop();
      const x = p % w;
      if (x > 0) seed(p - 1);
      if (x < w - 1) seed(p + 1);
      if (p >= w) seed(p - w);
      if (p < w * (h - 1)) seed(p + w);
    }
  }

  /** Otsu threshold over the non-white part of a flattened page, kept in a sane band. */
  function inkThreshold(flat, inverted) {
    const hist = new Float64Array(256);
    const full = new Float64Array(256);
    for (let i = 0; i < flat.length; i += 2) { full[flat[i]] += 2; if (flat[i] < 235) hist[flat[i]]++; }
    let total = 0; let sum = 0;
    for (let t = 0; t < 256; t++) { total += hist[t]; sum += t * hist[t]; }
    let wB = 0; let sB = 0; let best = -1; let thr = 160;
    for (let t = 0; t < 235; t++) {
      wB += hist[t];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sB += t * hist[t];
      const d = sB / wB - (sum - sB) / wF;
      const between = wB * wF * d * d;
      if (between > best) { best = between; thr = t; }
    }
    // a page of faint pencil has no dark mode for Otsu to find: the darkest half percent of the page is ink anyway
    let core = 0;
    for (let acc = 0, want = flat.length * 0.0025; core < 255 && (acc += full[core]) < want;) core++;
    thr = Math.max(Math.min(200, thr), Math.min(215, core + 12));
    // coloured pen on a dark screen is weak in gray (red ink is about 30 % luma): accept fainter strokes there
    return Math.max(inverted ? LIGHT_INK : 110, thr);
  }

  /**
   * Weak (hysteresis) threshold above `thr`: faint stroke parts joined to a dark core count as ink. Capped so that
   * the weak mask stays a small multiple of the strong one (textured paper must not flood it).
   */
  function weakThreshold(flat, thr) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < flat.length; i += 2) hist[flat[i]]++;
    let strong = 0;
    for (let v = 0; v <= thr; v++) strong += hist[v];
    let t = thr;
    const cap = Math.min(WEAK_MAX, Math.round(thr + 0.5 * (255 - thr)));
    for (let acc = strong; t < cap && acc + hist[t + 1] <= WEAK_GROWTH * strong;) acc += hist[++t];
    return t;
  }

  PDFStudy.hwFlatten = { flatten, isDarkPage, inkThreshold, weakThreshold, KNEE };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwFlatten;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Ink mask clean-up for the handwriting reader. Works on the flattened page from page-flatten.js (dark ink on white,
 * paper at 255): threshold, erase ruled lines and gutters (rule-strip.js), label connected strokes and drop what cannot be
 * writing (borders, bindings, filled areas, long rules, paper specks far from any text).
 * DOM-free; linear in the bitmap size.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (ns, file) => PDFStudy[ns] || (typeof require === 'function' ? require(file) : null);

  const SPECK = 10; // components with fewer pixels than this are always noise

  /** Ink = 1 where the flattened page is at or below `thr`. */
  function threshold(flat, w, h, thr) {
    const data = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) if (flat[i] <= thr) data[i] = 1;
    return { data, w, h };
  }

  /** 8-connected components: { label (0 = background, k = comps[k-1]), comps:[{x0,y0,x1,y1,n,cx,cy}] }. */
  function label(bin) {
    const { data, w, h } = bin;
    const lab = new Int32Array(w * h);
    const stack = new Int32Array(w * h);
    const comps = [];
    for (let s = 0; s < data.length; s++) {
      if (!data[s] || lab[s]) continue;
      const id = comps.length + 1;
      let top = 0; let n = 0; let sx = 0; let sy = 0;
      let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
      stack[top++] = s; lab[s] = id;
      while (top) {
        const p = stack[--top];
        const x = p % w; const y = (p - x) / w;
        n++; sx += x; sy += y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (data[q] && !lab[q]) { lab[q] = id; stack[top++] = q; }
          }
        }
      }
      comps.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n, cx: sx / n, cy: sy / n, keep: true });
    }
    return { label: lab, comps };
  }

  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  /** Typical stroke-group height: median height of components that are clearly more than specks. */
  function charHeight(comps, scale) {
    const hs = comps.filter((c) => c.keep && c.n >= 30 * scale && c.y1 - c.y0 >= 6 * scale).map((c) => c.y1 - c.y0);
    return median(hs) || Math.round(20 * scale);
  }

  /** Mark components that cannot be writing (keep = false). */
  function judge(comps, w, h, scale) {
    const typical = charHeight(comps, scale); // before filtering: a few huge blobs do not move the median
    for (const c of comps) {
      const bw = c.x1 - c.x0; const bh = c.y1 - c.y0;
      const m = 0.01 * Math.max(w, h);
      const edge = c.x0 <= m || c.y0 <= m || c.x1 >= w - m || c.y1 >= h - m;
      if (c.n < SPECK * scale * scale) c.keep = false;
      else if ((bh > h * 0.15 && bw < 0.25 * bh) || bw > w * 0.85) c.keep = false; // borders, bindings, frames
      // (tall and wide is kept: cursive whose descenders link words of several lines into one stroke)
      else if (edge && (bh > h * 0.15 || bw > w * 0.3)) c.keep = false; // scan edge remnants (long strips)
      else if (bw > w * 0.15 && bw > 15 * bh) c.keep = false; // rules, long underlines
      else if (bh > h * 0.05 && bh > 12 * bw) c.keep = false; // vertical rules
      else if (bw > 2.5 * typical && bh > 2.5 * typical && c.n > 0.5 * bw * bh) c.keep = false; // filled areas
    }
    const ch = charHeight(comps, scale);
    // small marks (dots, commas, specks) stay only when real writing is close by
    const cell = Math.max(4, Math.round(ch / 2));
    const gw = Math.ceil(w / cell); const gh = Math.ceil(h / cell);
    const near = new Uint8Array(gw * gh);
    const big = (c) => c.keep && (c.y1 - c.y0 >= 0.45 * ch || c.x1 - c.x0 >= 0.8 * ch || c.n >= 0.15 * ch * ch);
    const reach = 2; // cells, about one character height
    for (const c of comps) {
      if (!big(c)) continue;
      const gx0 = Math.max(0, Math.floor(c.x0 / cell) - reach); const gx1 = Math.min(gw - 1, Math.floor((c.x1 - 1) / cell) + reach);
      const gy0 = Math.max(0, Math.floor(c.y0 / cell) - reach); const gy1 = Math.min(gh - 1, Math.floor((c.y1 - 1) / cell) + reach);
      for (let gy = gy0; gy <= gy1; gy++) near.fill(1, gy * gw + gx0, gy * gw + gx1 + 1);
    }
    for (const c of comps) {
      if (!c.keep || big(c)) continue;
      if (!near[Math.floor(c.cy / cell) * gw + Math.floor(c.cx / cell)]) c.keep = false;
    }
    return ch;
  }

  /**
   * Clean ink mask of a flattened page.
   * @returns {{bin:{data,w,h}, label:Int32Array, comps:object[], charH:number}} bin holds kept components only
   */
  function inkMask(flat, w, h, thr, weak) {
    const scale = Math.max(0.3, w / 1650);
    const bin = threshold(flat, w, h, Math.max(thr, weak || thr));
    const rules = need('hwRuleStrip', './rule-strip.js');
    rules.stripDenseBands(bin);
    rules.stripRules(bin, scale);
    const { label: lab, comps } = label(bin);
    // hysteresis: a component needs a few pixels at the strong threshold, otherwise it is paper texture or a faint rule
    const strong = new Int32Array(comps.length);
    for (let i = 0; i < lab.length; i++) if (lab[i] && flat[i] <= thr) strong[lab[i] - 1]++;
    comps.forEach((c, k) => { if (strong[k] < 3) c.keep = false; });
    const charH = judge(comps, w, h, scale);
    for (let i = 0; i < lab.length; i++) if (lab[i] && !comps[lab[i] - 1].keep) bin.data[i] = 0;
    return { bin, label: lab, comps, charH };
  }

  /** Binarise a page for segmentation (flatten, threshold, clean). Ink = 1; `inverted` for light-on-dark pages. */
  function prepare(gray, w, h) {
    const F = need('hwFlatten', './page-flatten.js');
    const { flat, inverted } = F.flatten(gray, w, h);
    const thr = F.inkThreshold(flat, inverted);
    const m = inkMask(flat, w, h, thr, F.weakThreshold(flat, thr));
    return Object.assign(m.bin, { inverted, mode: 'flattened' });
  }

  /**
   * Soft normalisation of a crop for the recogniser: dark ink on white, paper stays white, stroke edges stay gray.
   * Faint ink is darkened by a linear gain (capped), never thresholded. Light-on-dark crops are inverted first.
   */
  function normaliseCrop(crop, inverted) {
    const n = crop.data.length;
    if (!n) return crop;
    const src = inverted ? crop.data.map((g) => 255 - g) : crop.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) hist[src[i]]++;
    let paper = 255;
    for (let acc = 0; paper > 0 && (acc += hist[paper]) < n * 0.5;) paper--; // median: the paper level
    let dark = 0;
    for (let acc = hist[0]; dark < 255 && acc < n * 0.01;) acc += hist[++dark]; // darkest 1 %: the ink core
    const span = Math.max(1, paper - dark);
    const gain = Math.min(4, Math.max(1, (paper - 25) / span));
    const lift = 255 / Math.max(1, paper);
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = 255 - (255 - Math.min(255, src[i] * lift)) * gain;
      data[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
    }
    return { data, w: crop.w, h: crop.h };
  }

  PDFStudy.hwClean = { prepare, inkMask, threshold, label, judge, normaliseCrop };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwClean;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

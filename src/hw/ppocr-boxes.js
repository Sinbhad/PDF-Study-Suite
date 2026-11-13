/**
 * Text boxes for the PP-OCRv5 engine (pure; Node-testable): DB probability map -> boxes, merging the pieces of one
 * written line, reading order, and the overlapping grid used when an image is too large for one detection pass.
 * Boxes are { x0, y0, x1, y1, score } in pixels (x1/y1 exclusive).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** DB post-processing defaults: pixel threshold, minimum mean probability of a box, unclip ratio. */
  const THRESH = 0.3;
  const BOX_THRESH = 0.6;
  const UNCLIP = 1.6;
  /** Line merge: gap at most GAP x the smaller height, vertical overlap at least OVERLAP of it, heights within HEIGHT_RATIO. */
  const GAP = 1.2;
  const OVERLAP = 0.5;
  const HEIGHT_RATIO = 1.8;

  /**
   * Connected components (4-neighbour) of prob > thresh, each with its bounding box and mean probability.
   * Components narrower or shorter than 3 pixels are dropped.
   */
  function components(prob, w, h, thresh) {
    const t = thresh == null ? THRESH : thresh;
    const seen = new Uint8Array(w * h);
    const stack = new Int32Array(w * h);
    const out = [];
    for (let s = 0; s < w * h; s++) {
      if (seen[s] || !(prob[s] > t)) continue;
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      let x0 = w, y0 = h, x1 = -1, y1 = -1, sum = 0, n = 0;
      while (top) {
        const i = stack[--top];
        const x = i % w;
        const y = (i - x) / w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        sum += prob[i];
        n++;
        if (x > 0 && !seen[i - 1] && prob[i - 1] > t) { seen[i - 1] = 1; stack[top++] = i - 1; }
        if (x < w - 1 && !seen[i + 1] && prob[i + 1] > t) { seen[i + 1] = 1; stack[top++] = i + 1; }
        if (y > 0 && !seen[i - w] && prob[i - w] > t) { seen[i - w] = 1; stack[top++] = i - w; }
        if (y < h - 1 && !seen[i + w] && prob[i + w] > t) { seen[i + w] = 1; stack[top++] = i + w; }
      }
      if (x1 - x0 + 1 < 3 || y1 - y0 + 1 < 3) continue;
      out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, score: sum / n });
    }
    return out;
  }

  /** Grow a shrunk DB kernel back to the text outline: w*h*ratio / (2*(w+h)) on every side. */
  function unclip(b, ratio) {
    const w = b.x1 - b.x0;
    const h = b.y1 - b.y0;
    const d = (w * h * (ratio == null ? UNCLIP : ratio)) / (2 * (w + h));
    return { x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d, score: b.score };
  }

  /** Probability map (w x h) -> unclipped boxes clamped to the map. opts: { thresh, boxThresh, unclip }. */
  function dbBoxes(prob, w, h, opts) {
    const o = opts || {};
    const minScore = o.boxThresh == null ? BOX_THRESH : o.boxThresh;
    const clamp = (b) => ({ x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(w, b.x1), y1: Math.min(h, b.y1), score: b.score });
    return components(prob, w, h, o.thresh).filter((b) => b.score >= minScore).map((b) => clamp(unclip(b, o.unclip)));
  }

  /** True when b continues line a: on one baseline band, similar height, and close along the line. */
  function sameLine(a, b, o) {
    const ha = a.y1 - a.y0;
    const hb = b.y1 - b.y0;
    const small = Math.min(ha, hb);
    const big = Math.max(ha, hb);
    const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const gap = Math.max(b.x0 - a.x1, a.x0 - b.x1);
    return small > 0 && overlap >= o.overlap * small && big <= o.heightRatio * small && gap <= o.gap * small;
  }

  /**
   * Merge boxes that are pieces of one written line (a black term and its coloured definition, words the detector
   * split). Two columns side by side stay apart: their gap is several line heights. opts: { gap, overlap, heightRatio }.
   */
  function mergeLines(boxes, opts) {
    const o = Object.assign({ gap: GAP, overlap: OVERLAP, heightRatio: HEIGHT_RATIO }, opts || {});
    const bs = boxes.map((b) => Object.assign({}, b)).sort((a, b) => a.x0 - b.x0);
    const used = new Array(bs.length).fill(false);
    const out = [];
    for (let i = 0; i < bs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const cur = bs[i];
      let grew = true;
      while (grew) {
        grew = false;
        for (let j = 0; j < bs.length; j++) {
          if (used[j] || !sameLine(cur, bs[j], o)) continue;
          const c = bs[j];
          const wa = cur.x1 - cur.x0;
          const wb = c.x1 - c.x0;
          cur.score = (cur.score * wa + c.score * wb) / Math.max(1, wa + wb);
          cur.x0 = Math.min(cur.x0, c.x0);
          cur.y0 = Math.min(cur.y0, c.y0);
          cur.x1 = Math.max(cur.x1, c.x1);
          cur.y1 = Math.max(cur.y1, c.y1);
          used[j] = true;
          grew = true;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /** Reading order: rows of boxes that overlap vertically (by half the smaller height), top to bottom, each left to right. */
  function order(boxes) {
    const bs = boxes.slice().sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
    const rows = [];
    for (const b of bs) {
      const row = rows.length ? rows[rows.length - 1] : null;
      const fits = row && row.some((r) => Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) >= 0.5 * Math.min(r.y1 - r.y0, b.y1 - b.y0));
      if (fits) row.push(b);
      else rows.push([b]);
    }
    return rows.flatMap((r) => r.sort((a, b) => a.x0 - b.x0));
  }

  /**
   * Rows shared with the line above or below (tightly spaced lines overlap once unclipped) are split at the middle
   * of the overlap, so a line's crop does not carry the next line's ascenders and descenders.
   */
  function clipNeighbours(boxes) {
    return boxes.map((b, i) => {
      const c = Object.assign({}, b);
      const cy = (b.y0 + b.y1) / 2;
      boxes.forEach((o, j) => {
        if (j === i || Math.min(o.x1, b.x1) <= Math.max(o.x0, b.x0)) return;
        const oy = (o.y0 + o.y1) / 2;
        if (oy < cy && o.y1 > b.y0 && o.y1 < cy) c.y0 = Math.max(c.y0, (o.y1 + b.y0) / 2);
        if (oy > cy && o.y0 < b.y1 && o.y0 > cy) c.y1 = Math.min(c.y1, (o.y0 + b.y1) / 2);
      });
      return c;
    });
  }

  /** Split one axis of `len` pixels into windows of at most `cap` overlapping by `overlap`; each owns a core span. */
  function spans(len, cap, overlap) {
    if (len <= cap) return [{ a: 0, b: len, c0: 0, c1: len }];
    const n = Math.ceil((len - overlap) / (cap - overlap));
    const step = (len - cap) / (n - 1);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Math.round(i * step);
      out.push({ a, b: Math.min(len, a + cap), c0: 0, c1: len });
    }
    for (let i = 1; i < n; i++) out[i - 1].c1 = out[i].c0 = Math.round((out[i].a + out[i - 1].b) / 2); // middle of each overlap
    return out;
  }

  /** Detection windows over a w x h image: { x, y, w, h, core:{x0,y0,x1,y1} }; one window when it fits within `cap`. */
  function grid(w, h, cap, overlap) {
    const out = [];
    for (const sy of spans(h, cap, overlap)) {
      for (const sx of spans(w, cap, overlap)) out.push({ x: sx.a, y: sy.a, w: sx.b - sx.a, h: sy.b - sy.a, core: { x0: sx.c0, y0: sy.c0, x1: sx.c1, y1: sy.c1 } });
    }
    return out;
  }

  /** Boxes found in one window (window coordinates) -> image coordinates, keeping those whose centre the window owns. */
  function owned(boxes, win) {
    const out = [];
    for (const b of boxes) {
      const g = { x0: b.x0 + win.x, y0: b.y0 + win.y, x1: b.x1 + win.x, y1: b.y1 + win.y, score: b.score };
      const cx = (g.x0 + g.x1) / 2;
      const cy = (g.y0 + g.y1) / 2;
      if (cx >= win.core.x0 && cx < win.core.x1 && cy >= win.core.y0 && cy < win.core.y1) out.push(g);
    }
    return out;
  }

  PDFStudy.hwPpocrBoxes = { THRESH, BOX_THRESH, UNCLIP, GAP, components, unclip, dbBoxes, sameLine, mergeLines, order, clipNeighbours, grid, owned };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPpocrBoxes;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

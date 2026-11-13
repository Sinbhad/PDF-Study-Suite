/**
 * Splitting two written lines that share one box because no straight row between them is empty: sloped,
 * ragged or interleaved lines, or underlines and strikes filling the gap. The box is cut into vertical strips,
 * the valley between the two lines is found in each strip, and a cut is run through those valleys (straight
 * between strip centres, flat past the outer ones). Each piece keeps the cut as its `top` or `bot` boundary,
 * { x0, ys } with one row per column, so stroke ownership and crops follow the cut, not the rectangle. DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const TALL = 1.5; // boxes taller than this many line pitches are checked for a second line
  const AGAIN = 1.2; // ...and pieces of a split box taller than this (three lines packed tightly)
  const STRIP = 2.5; // strip width in line pitches (3 to 10 strips per box)
  const DEEP = 0.55; // a strip valley at or below this share of the smaller peak around it separates two lines
  const SIDE = 0.15; // ...when each side of it holds at least this share of the strip's ink
  const CLEAR = 0.3; // valleys this deep place the cut; shallower ones only vote for a split
  const AGREE = 0.5; // share of the inked strips that must show such a valley on the fitted cut
  const OFF = 0.4; // a strip valley further than this many pitches from both neighbouring valleys is an outlier
  const MIN_PART = 0.2; // each piece keeps at least this share of the box's ink

  const rowAt = (bd, x) => bd.ys[Math.max(0, Math.min(bd.ys.length - 1, x - bd.x0))];
  /** Whether pixel (x, y) lies inside box `b`'s sloped boundaries (the rectangle itself is not checked). */
  const inside = (b, x, y) => (!b.top || y >= rowAt(b.top, x)) && (!b.bot || y < rowAt(b.bot, x));

  /** Deepest two-sided valley of one strip's row profile: { y, ratio } or null. */
  function stripValley(prof, pitch) {
    const n = prof.length;
    const r = Math.max(1, Math.round(pitch / 8));
    const s = new Float64Array(n);
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + prof[i];
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - r); const b = Math.min(n, i + r + 1); s[i] = (cum[b] - cum[a]) / (b - a); }
    const before = new Float64Array(n); const after = new Float64Array(n);
    for (let i = 0, m = 0; i < n; i++) { m = Math.max(m, s[i]); before[i] = m; }
    for (let i = n - 1, m = 0; i >= 0; i--) { m = Math.max(m, s[i]); after[i] = m; }
    let best = null;
    for (let y = 1; y < n - 1; y++) {
      if (Math.min(cum[y], cum[n] - cum[y]) < SIDE * cum[n]) continue;
      const ratio = s[y] / Math.max(1e-9, Math.min(before[y], after[y]));
      if (!best || ratio < best.ratio) best = { y, ratio };
    }
    return best;
  }

  /** Weighted least-squares line y = a + k (x - x0) through points {x, y, wt}. */
  function fitLine(pts, x0) {
    let sw = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    for (const p of pts) { const x = p.x - x0; sw += p.wt; sx += p.wt * x; sy += p.wt * p.y; sxx += p.wt * x * x; sxy += p.wt * x * p.y; }
    const det = sw * sxx - sx * sx;
    const k = Math.abs(det) < 1e-9 ? 0 : Math.max(-0.2, Math.min(0.2, (sw * sxy - sx * sy) / det));
    return { a: (sy - k * sx) / sw, k };
  }

  /** Cut `box` (ink = 1 in bin) into an upper and a lower line, or return null when it holds one line. */
  function splitTwo(bin, box, pitch) {
    if (box.w < 3 * pitch) return null;
    const { data, w } = bin;
    const K = Math.max(3, Math.min(10, Math.round(box.w / (STRIP * pitch))));
    const strips = [];
    for (let k = 0; k < K; k++) {
      const xa = box.x + Math.round((k * box.w) / K); const xb = box.x + Math.round(((k + 1) * box.w) / K);
      const prof = new Float64Array(box.h);
      let tot = 0;
      for (let y = 0; y < box.h; y++) {
        for (let x = xa, o = (box.y + y) * w; x < xb; x++) if (data[o + x] && inside(box, x, box.y + y)) { prof[y]++; tot++; }
      }
      strips.push({ x: (xa + xb) / 2, tot, v: tot ? stripValley(prof, pitch) : null });
    }
    const meanTot = strips.reduce((s, p) => s + p.tot, 0) / K;
    const inked = strips.filter((p) => p.tot >= 0.3 * meanTot);
    let pts = inked.filter((p) => p.v && p.v.ratio <= DEEP).map((p) => ({ x: p.x, y: box.y + p.v.y, wt: p.tot, ratio: p.v.ratio }));
    if (pts.length < Math.max(2, AGREE * inked.length)) return null;
    // a valley far from both neighbouring valleys is a gap inside one line's letters, not the gap between lines
    const near = (p, q) => q && Math.abs(p.y - q.y) <= OFF * pitch;
    pts = pts.filter((p, i, a) => near(p, a[i - 1]) || near(p, a[i + 1]));
    if (pts.length < Math.max(2, AGREE * inked.length)) return null;
    const clear = pts.filter((p) => p.ratio <= CLEAR);
    if (clear.length >= 2) pts = clear;
    const line = fitLine(pts, box.x);
    // the cut runs through the inlier valleys; between them it is straight, past the ends it follows the fitted slope
    const ys = new Int32Array(box.w);
    for (let c = 0, j = 0; c < box.w; c++) {
      const x = box.x + c;
      while (j + 1 < pts.length && pts[j + 1].x <= x) j++;
      const p = pts[j]; const q = pts[Math.min(pts.length - 1, j + 1)];
      const end = x <= pts[0].x ? pts[0] : x >= pts[pts.length - 1].x ? pts[pts.length - 1] : null;
      const y = end ? end.y + line.k * (x - end.x) : p.y + ((q.y - p.y) * (x - p.x)) / Math.max(1, q.x - p.x);
      ys[c] = Math.round(y);
    }
    const cut = { x0: box.x, ys };
    const up = Object.assign({}, box, { bot: cut });
    const dn = Object.assign({}, box, { top: cut });
    const parts = [fitPart(bin, box, up), fitPart(bin, box, dn)];
    if (parts.some((p) => !p || p.ink < MIN_PART * box.ink)) return null;
    return parts;
  }

  /** Bounding box and ink of the pixels of `box` that lie inside `part`'s boundaries; boundaries carried over. */
  function fitPart(bin, box, part) {
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1; let ink = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x, o = y * bin.w; x < box.x + box.w; x++) {
        if (!bin.data[o + x] || !inside(part, x, y)) continue;
        ink++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (!ink) return null;
    const out = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, ink };
    if (part.top) out.top = part.top;
    if (part.bot) out.bot = part.bot;
    return out;
  }

  /** Every box taller than TALL pitches that holds two lines is replaced by its pieces (again, up to 3 times). */
  function splitAll(bin, boxes, pitch) {
    const out = [];
    const walk = (b, depth) => {
      const parts = depth < 3 && b.h > (depth ? AGAIN : TALL) * pitch ? splitTwo(bin, b, pitch) : null;
      if (!parts) { out.push(b); return; }
      for (const p of parts) walk(p, depth + 1);
    };
    for (const b of boxes) walk(b, 0);
    return out;
  }

  PDFStudy.hwSlantSplit = { splitAll, splitTwo, inside };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwSlantSplit;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

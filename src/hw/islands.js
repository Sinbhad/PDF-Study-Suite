/**
 * Labels scattered over a drawing or diagram: a box can hold several short labels at staggered heights with
 * wide empty space between them, yet no straight empty row or column, because other labels fill the gaps.
 * Strokes are grouped into islands (close side by side, or close above and below) and each island becomes its
 * own box. Large hollow outlines (circles drawn around things) are not writing and are dropped. DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const GAP = 2.5; // strokes further apart side by side than this many line heights belong to different labels
  const VGAP = 0.5; // ...and so do strokes further apart than this above and below each other
  const SPREAD = 0.5; // a box is only split when its islands cover at most this share of it (labels far apart)
  const MARK_H = 0.6; // a lone stroke lower than this many line heights...
  const MARK_W = 0.8; // ...and narrower than this is a mark, not writing
  const RING = 1.1; // a stroke at least this many line heights in both directions may be a drawn outline
  const HOLLOW = 0.02; // ...when the middle of its box holds less than this share of its own ink

  /** Ink of each kept stroke inside `b`, from the label image: Map label -> pixels. */
  function strokesIn(b, label, w, comps) {
    const counts = new Map();
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x, o = y * w; x < b.x + b.w; x++) {
        const l = label[o + x];
        if (l && comps[l - 1].keep) counts.set(l, (counts.get(l) || 0) + 1);
      }
    }
    return counts;
  }

  /** A big closed loop with an empty middle (a circle or box drawn around something). */
  function isOutline(c, l, label, w, lineH) {
    const bw = c.x1 - c.x0; const bh = c.y1 - c.y0;
    if (bw < RING * lineH || bh < RING * lineH || bw > 2 * bh || bh > 2 * bw) return false;
    let mid = 0;
    for (let y = c.y0 + (bh >> 2); y < c.y1 - (bh >> 2); y++) {
      for (let x = c.x0 + (bw >> 2), o = y * w; x < c.x1 - (bw >> 2); x++) if (label[o + x] === l) mid++;
    }
    return mid < HOLLOW * c.n;
  }

  /**
   * Boxes split into their islands of strokes; outlines are dropped (keep = false, cleared from `bin`).
   * Boxes holding a single island come back unchanged.
   */
  function split(bin, boxes, label, comps, lineH) {
    const w = bin.w;
    const out = [];
    for (const b of boxes) {
      const counts = strokesIn(b, label, w, comps);
      let ids = [...counts.keys()].filter((l) => counts.get(l) >= 0.5 * comps[l - 1].n);
      const rings = ids.filter((l) => isOutline(comps[l - 1], l, label, w, lineH));
      for (const l of rings) {
        const c = comps[l - 1];
        c.keep = false;
        for (let y = c.y0; y < c.y1; y++) for (let x = c.x0, o = y * w; x < c.x1; x++) if (label[o + x] === l) bin.data[o + x] = 0;
      }
      ids = ids.filter((l) => !rings.includes(l));
      // strokes shared with neighbouring boxes (lines linked by tails) leave the box as it is
      const total = [...counts.values()].reduce((s, n) => s + n, 0);
      const mine = ids.reduce((s, l) => s + counts.get(l), 0);
      if ((ids.length < 2 && !rings.length) || mine < 0.8 * total) { out.push(b); continue; }
      const root = ids.map((_, i) => i);
      const find = (i) => { while (root[i] !== i) i = root[i] = root[root[i]]; return i; };
      for (let i = 0; i < ids.length; i++) {
        const c = comps[ids[i] - 1];
        for (let j = i + 1; j < ids.length; j++) {
          const d = comps[ids[j] - 1];
          const hgap = Math.max(c.x0 - d.x1, d.x0 - c.x1); const vgap = Math.max(c.y0 - d.y1, d.y0 - c.y1);
          // a stroke right above another (an insertion over a word, an underline) stays with it
          if (hgap <= GAP * lineH && (vgap <= VGAP * lineH || (hgap <= 0 && vgap <= lineH))) root[find(i)] = find(j);
        }
      }
      const groups = new Map();
      ids.forEach((l, i) => {
        const c = comps[l - 1];
        const g = groups.get(find(i)) || { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, ink: 0 };
        g.x0 = Math.min(g.x0, c.x0); g.y0 = Math.min(g.y0, c.y0); g.x1 = Math.max(g.x1, c.x1); g.y1 = Math.max(g.y1, c.y1);
        g.ink += counts.get(l);
        groups.set(find(i), g);
      });
      const area = [...groups.values()].reduce((s, g) => s + (g.x1 - g.x0) * (g.y1 - g.y0), 0);
      if (!rings.length && (groups.size < 2 || area > SPREAD * b.w * b.h)) { out.push(b); continue; }
      for (const g of groups.values()) out.push({ x: g.x0, y: g.y0, w: g.x1 - g.x0, h: g.y1 - g.y0, ink: g.ink });
    }
    return out;
  }

  /** Boxes holding one small stroke on their own (a cross or bracket in the margin, a tick) are not lines. */
  function dropMarks(boxes, label, w, comps, lineH) {
    return boxes.filter((b) => b.h >= MARK_H * lineH || b.w >= MARK_W * lineH || strokesIn(b, label, w, comps).size > 1);
  }

  PDFStudy.hwIslands = { split, dropMarks };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwIslands;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

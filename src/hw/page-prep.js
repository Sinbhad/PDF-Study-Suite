/**
 * Page preparation for the handwriting reader: which boxes are read, in which order, and what pixels the
 * recogniser sees for each. The worker and the evaluation tool both call exactly these two functions:
 *   plan(gray, width, height)                    -> { bin, lines, medH, inverted }
 *   cropFor(plan, gray, width, height, box)      -> { data, w, h } soft gray crop, dark ink on white
 * Steps: flattening (page-flatten.js), threshold + clean-up (clean.js), line cuts (line-split.js), scattered labels
 * (islands.js), noise filtering, sloped line pairs (slant-split.js), splitting of very long lines, reading order,
 * print check (print-detect.js), per-stroke ownership so a crop can blank out the neighbours' ink. DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (ns, file) => PDFStudy[ns] || (typeof require === 'function' ? require(file) : null);

  const LONG = 28; // width:height above which a line is cut at a word gap (the model squashes every crop to a square)
  const PAD = 0.15; // crop padding as a share of the box height
  const SLIVER_OWN = 0.4; // a short box keeps its place only if at least this share of its ink is strokes it owns
  const GROW = 0.4; // a box may grow by this many line heights to take in its own descenders and ascenders
  const SHARED = 0.3; // share of another line's stroke that must lie in this line's cut for it to stay in the crop
  const SPARSE = 0.35; // boxes with less ink cover than this share of the page's typical line are noise

  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  /**
   * Line metrics in px: `pitch` (spacing of the lines, from the row-profile rhythm when there is one) drives the cuts;
   * `lineH` (height of one written line, from leaves measured without valley cuts) decides what is a sliver.
   */
  function lineMetrics(bin, charH, split) {
    const rough = split.leaves(bin, Math.max(8, 1.5 * charH), { split: false });
    const lineLike = rough.filter((b) => b.w >= 2 * b.h && b.h >= 0.5 * charH).map((b) => b.h);
    const roughH = median(lineLike.length >= 3 ? lineLike : rough.map((b) => b.h)) || Math.max(8, 1.5 * charH);
    const prof = split.rowProfile(bin, { x: 0, y: 0, w: bin.w, h: bin.h });
    const found = split.linePitch(split.smooth(prof, 2), Math.max(8, Math.round(0.25 * charH)), Math.round(bin.h / 6));
    // the rhythm is the better measure: bands holding two touching lines (or one linked stroke) do not fool it
    const pitch = Math.max(6, found || roughH);
    return { pitch, lineH: Math.max(6, Math.min(pitch, Math.max(0.5 * pitch, roughH))) };
  }

  /** Boxes that are not writing: specks, stray marks, sparse scribbles, solid patches. */
  const fillOf = (b) => b.ink / (b.w * b.h);
  function isNoise(b, medH, pageFill) {
    const fill = fillOf(b);
    if (b.w < 0.5 * medH && b.h < 0.5 * medH) return true;
    if (b.h < 0.33 * medH || b.w < 0.25 * medH) return true; // a lone rule, dash or upright stroke
    if (fill < SPARSE * pageFill) return true; // a few stray marks spread over a big box (thin pens are judged per page)
    return fill > 0.6 && (b.h > 1.5 * medH || b.h < 0.5 * medH);
  }

  /** Small pieces hugging a line from above or below (a broken-off descender loop, accents) join that line. */
  function absorbFragments(boxes, lineH) {
    const out = boxes.slice();
    const frag = (b) => b.h < 0.6 * lineH && b.w < 1.2 * lineH;
    for (let i = out.length - 1; i >= 0; i--) {
      const b = out[i];
      if (!frag(b)) continue;
      let host = -1;
      out.forEach((o, j) => {
        if (j === i || frag(o)) return;
        const gap = Math.max(o.y - (b.y + b.h), b.y - (o.y + o.h));
        const cover = Math.min(o.x + o.w, b.x + b.w) - Math.max(o.x, b.x);
        if (gap <= 0.3 * lineH && cover >= 0.8 * b.w && (host < 0 || o.w > out[host].w)) host = j;
      });
      if (host < 0) continue;
      const o = out[host];
      const x0 = Math.min(o.x, b.x); const y0 = Math.min(o.y, b.y);
      out[host] = { x: x0, y: y0, w: Math.max(o.x + o.w, b.x + b.w) - x0, h: Math.max(o.y + o.h, b.y + b.h) - y0, ink: o.ink + b.ink };
      out.splice(i, 1);
    }
    return out;
  }

  /** Cut a very long line at its widest word gap near the middle, so each half keeps detail when squashed. */
  function splitLong(bin, b, medH, split, out) {
    if (b.w <= LONG * b.h) { out.push(b); return; }
    const cols = split.colProfile(bin, b);
    let best = -1; let bestW = 0;
    for (let x = Math.round(b.w * 0.25); x < b.w * 0.75;) {
      if (cols[x]) { x++; continue; }
      let e = x;
      while (e < b.w && !cols[e]) e++;
      if (e - x > bestW) { bestW = e - x; best = x + ((e - x) >> 1); }
      x = e;
    }
    if (best < 0 || bestW < 0.25 * medH) { out.push(b); return; }
    for (const part of [{ x: b.x, y: b.y, w: best, h: b.h }, { x: b.x + best, y: b.y, w: b.w - best, h: b.h }]) {
      const t = split.tighten(bin, part);
      if (t) splitLong(bin, t, medH, split, out);
    }
  }

  /**
   * Give every kept stroke to the box holding most of its pixels, then fit each box to its own strokes (a descender
   * cut off by a valley cut comes back; the line above's tails go away), growing by at most GROW line heights.
   */
  function assignStrokes(boxes, lab, w, comps, medH, inside) {
    const owner = new Int32Array(comps.length).fill(-1);
    const best = new Int32Array(comps.length);
    boxes.forEach((b, i) => {
      const counts = new Map();
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x, o = y * w; x < b.x + b.w; x++) {
          const l = lab[o + x];
          if (l && inside(b, x, y)) counts.set(l, (counts.get(l) || 0) + 1);
        }
      }
      for (const [l, n] of counts) if (n > best[l - 1]) { best[l - 1] = n; owner[l - 1] = i; }
    });
    const fit = boxes.map((b) => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, b }));
    const ownInk = new Float64Array(boxes.length);
    comps.forEach((c, k) => {
      if (!c.keep || owner[k] < 0) { owner[k] = -1; return; }
      ownInk[owner[k]] += best[k];
      const f = fit[owner[k]];
      f.x0 = Math.min(f.x0, c.x0); f.y0 = Math.min(f.y0, c.y0); f.x1 = Math.max(f.x1, c.x1); f.y1 = Math.max(f.y1, c.y1);
    });
    const m = GROW * medH;
    return {
      owner,
      ownInk,
      boxes: fit.map(({ x0, y0, x1, y1, b }) => {
        if (x0 === Infinity) return b;
        const nx0 = Math.min(b.x, Math.max(x0, b.x - m)); const ny0 = Math.min(b.y, Math.max(y0, b.y - m));
        const nx1 = Math.max(b.x + b.w, Math.min(x1, b.x + b.w + m)); const ny1 = Math.max(b.y + b.h, Math.min(y1, b.y + b.h + m));
        return { x: Math.round(nx0), y: Math.round(ny0), w: Math.round(nx1 - nx0), h: Math.round(ny1 - ny0), ink: b.ink };
      }),
    };
  }

  const keyOf = (b) => `${b.x},${b.y},${b.w},${b.h}`;

  /**
   * Final reading-order list of boxes to recognise.
   * @returns {{bin:object, lines:{index:number, box:object, regions:{box:object}[]}[], medH:number, inverted:boolean}}
   */
  function plan(gray, width, height) {
    const F = need('hwFlatten', './page-flatten.js');
    const clean = need('hwClean', './clean.js');
    const split = need('hwLineSplit', './line-split.js');
    const slant = need('hwSlantSplit', './slant-split.js'); const isl = need('hwIslands', './islands.js');
    const { flat, inverted } = F.flatten(gray, width, height);
    const thr = F.inkThreshold(flat, inverted);
    const weak = F.weakThreshold(flat, thr);
    const mask = clean.inkMask(flat, width, height, thr, weak);
    const bin = Object.assign(mask.bin, { inverted });
    const { pitch, lineH: roughH } = lineMetrics(bin, mask.charH, split);
    let medH = pitch;
    const all = split.leaves(bin, pitch, { lineH: Math.max(roughH, 0.8 * pitch) });
    const lineLike = all.filter((b) => b.w >= 2 * b.h);
    const pageFill = median(lineLike.map(fillOf)) || 0.1;
    // noise is judged against the height of a written line, which is less than the pitch on widely spaced pages
    const lineH = Math.min(medH, median(lineLike.map((b) => b.h)) || medH);
    // scattered labels sharing a (sparse) box become boxes of their own before the noise check
    const kept = isl.split(bin, all, mask.label, mask.comps, lineH).filter((b) => !isNoise(b, lineH, pageFill));
    let long = [];
    // sloped pieces keep their cut as a boundary and are not cut again at word gaps
    for (const b of slant.splitAll(bin, isl.dropMarks(absorbFragments(kept, lineH), mask.label, bin.w, mask.comps, lineH), pitch)) if (b.top || b.bot) long.push(b); else splitLong(bin, b, lineH, split, long);
    let fitted = assignStrokes(long, mask.label, width, mask.comps, medH, slant.inside);
    // slivers made of other lines' tails (sloped or touching lines) own little of their ink: drop them
    const own = long.filter((b, i) => b.h >= 0.8 * lineH || fitted.ownInk[i] >= SLIVER_OWN * b.ink);
    if (own.length < long.length) { long = own; fitted = assignStrokes(long, mask.label, width, mask.comps, medH, slant.inside); }
    const regionOf = new Map();
    fitted.boxes.forEach((b, i) => regionOf.set(keyOf(b), i));
    // a printed letterhead on a handwritten page is not read; a page that is all print is, and is marked as such
    const { lines, letterhead, printed } = need('hwPrintDetect', './print-detect.js').review(need('hwColumns', './columns.js').lines(fitted.boxes, lineH), { comps: mask.comps, owner: fitted.owner, regionOf, height });
    const heights = lines.map((l) => l.box.h);
    if (heights.length >= 3) medH = median(heights);
    return { bin, lines, medH, inverted, thr, weak, flat, label: mask.label, comps: mask.comps, owner: fitted.owner, regionOf, leaves: long, letterhead, printed };
  }

  /**
   * Soft gray crop of `box` for the recogniser: from the flattened page, a little padding, other lines' strokes and
   * removed rules/noise painted white, then a gentle linear contrast lift (no threshold).
   */
  function cropFor(p, gray, width, height, box) {
    const clean = need('hwClean', './clean.js'); const slant = need('hwSlantSplit', './slant-split.js');
    const pad = Math.max(3, Math.round(box.h * PAD));
    const x0 = Math.max(0, box.x - pad); const y0 = Math.max(0, box.y - pad);
    const x1 = Math.min(width, box.x + box.w + pad); const y1 = Math.min(height, box.y + box.h + pad);
    const cw = Math.max(0, x1 - x0); const ch = Math.max(0, y1 - y0);
    const src = p.flat || gray;
    const data = new Uint8Array(cw * ch);
    const foreign = new Uint8Array(cw * ch);
    const me = p.regionOf ? p.regionOf.get(keyOf(box)) : undefined;
    const leaf = me === undefined ? null : p.leaves[me];
    const inLeaf = (x, y) => x >= leaf.x && x < leaf.x + leaf.w && y >= leaf.y && y < leaf.y + leaf.h && slant.inside(leaf, x, y);
    // a stroke owned by another line is kept inside this line's cut when a fair share of it lies there or when it
    // crosses the core rows (a word linked across lines), not when just its tip hangs into the top or bottom rows
    // (a descender from the line above would show as a stray quote mark)
    const share = new Map();
    if (leaf && p.label) {
      for (let y = leaf.y; y < leaf.y + leaf.h; y++) {
        for (let x = leaf.x, o = y * width; x < leaf.x + leaf.w; x++) { const l = p.label[o + x]; if (l && slant.inside(leaf, x, y)) share.set(l, (share.get(l) || 0) + 1); }
      }
    }
    const shared = (lab) => (share.get(lab) || 0) >= SHARED * p.comps[lab - 1].n;
    const edge = leaf ? Math.round(0.25 * leaf.h) : 0;
    const inCore = (y) => !leaf.top && !leaf.bot && y >= leaf.y + edge && y < leaf.y + leaf.h - edge;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y0 + y) * width + x0 + x;
        const j = y * cw + x;
        data[j] = src[i];
        if (!p.label || !leaf) continue;
        const lab = p.label[i];
        // ink inside this line's own cut is kept; outside it only strokes that mostly belong to this line
        const mine = lab && p.comps[lab - 1].keep && (p.owner[lab - 1] === me || (inLeaf(x0 + x, y0 + y) && (shared(lab) || inCore(y0 + y))));
        if (lab ? !mine : src[i] <= p.weak) { data[j] = 255; foreign[j] = 1; }
      }
    }
    // the anti-aliased rim of blanked strokes goes too, unless it belongs to this box's own ink
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const j = y * cw + x;
        if (foreign[j] || data[j] === 255) continue;
        const lab = p.label ? p.label[(y0 + y) * width + x0 + x] : 0;
        if (lab) continue; // kept ink (it would be foreign otherwise)
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy; const xx = x + dx;
            if (yy >= 0 && yy < ch && xx >= 0 && xx < cw && foreign[yy * cw + xx]) { near = true; break; }
          }
        }
        if (near) data[j] = 255;
      }
    }
    return clean.normaliseCrop({ data, w: cw, h: ch }, p.flat ? false : p.inverted);
  }

  PDFStudy.hwPagePrep = { plan, cropFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPagePrep;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

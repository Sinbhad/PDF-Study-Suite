/**
 * Text-line finding on a clean ink mask (ink = 1) by recursive cuts:
 *  1. a block is cut at empty rows into bands (i-dots and descender slivers rejoin their line);
 *  2. a single band is cut at very wide empty columns (two columns, a margin note, scattered labels);
 *  3. a leaf taller than ~1.8 line heights is cut at the deepest valley of its row profile (touching lines),
 *     and each piece is cut again from step 1.
 * Every leaf is meant to be one text line (or one piece of a line). DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const TALL = 1.5; // a leaf taller than this many line pitches holds more than one line
  const FORCE = 2.4; // ...and above this it is cut at its lowest valley even when the valley is shallow
  const COL_GAP = 3; // empty columns wider than this many line heights separate regions
  const DEEP = 0.6; // a valley at or below this share of the smaller neighbouring peak separates two lines
  const MIN_SIDE = 0.15; // each side of a valley cut keeps at least this share of the block's ink
  const NARROW_GAP = 1.5; // ...or this many, inside a block too tall to be one line
  const SLIVER = 0.4; // bands shorter than this share of a line height are fragments (dots, tails)

  function rowProfile(bin, box) {
    const { data, w } = bin;
    const prof = new Float64Array(box.h);
    for (let y = 0; y < box.h; y++) {
      let n = 0;
      const base = (box.y + y) * w + box.x;
      for (let x = 0; x < box.w; x++) n += data[base + x];
      prof[y] = n;
    }
    return prof;
  }

  function colProfile(bin, box) {
    const { data, w } = bin;
    const prof = new Int32Array(box.w);
    for (let y = box.y; y < box.y + box.h; y++) {
      const base = y * w + box.x;
      for (let x = 0; x < box.w; x++) prof[x] += data[base + x];
    }
    return prof;
  }

  function smooth(prof, r) {
    const out = new Float64Array(prof.length);
    let sum = 0;
    for (let i = 0; i < prof.length + r; i++) {
      if (i < prof.length) sum += prof[i];
      if (i - 2 * r - 1 >= 0) sum -= prof[i - 2 * r - 1];
      const c = i - r;
      if (c >= 0 && c < prof.length) out[c] = sum / (Math.min(prof.length - 1, c + r) - Math.max(0, c - r) + 1);
    }
    return out;
  }

  /** Runs of non-zero entries; gaps shorter than `minGap` do not split. Returns [[start, end), ...]. */
  function runs(prof, minGap) {
    const out = [];
    let s = -1; let last = -1;
    for (let i = 0; i < prof.length; i++) {
      if (!prof[i]) continue;
      if (s < 0) s = i;
      else if (i - last > minGap) { out.push([s, last + 1]); s = i; }
      last = i;
    }
    if (s >= 0) out.push([s, last + 1]);
    return out;
  }

  /** Bounding box of the ink inside `box`, with its ink count; null when empty. */
  function tighten(bin, box) {
    const { data, w } = bin;
    let x0 = box.x + box.w; let x1 = box.x - 1; let y0 = box.y + box.h; let y1 = box.y - 1; let ink = 0;
    for (let y = box.y; y < box.y + box.h; y++) {
      const o = y * w;
      for (let x = box.x; x < box.x + box.w; x++) {
        if (!data[o + x]) continue;
        ink++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    return ink ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, ink } : null;
  }

  /**
   * Fold short bands (i-dots, accents, descender tails) into the nearer neighbouring band when it is close.
   * A thin bar with ink close above and below (a fraction) joins both, unless that would make a too-tall band.
   */
  function foldSlivers(bands, medH) {
    const out = bands.map((b) => b.slice());
    for (let changed = true; changed && out.length > 1;) {
      changed = false;
      for (let i = 0; i < out.length; i++) {
        const b = out[i];
        if (b[1] - b[0] >= SLIVER * medH) continue;
        if (b[1] - b[0] <= Math.max(3, 0.2 * medH) && i > 0 && i + 1 < out.length) {
          const a = out[i - 1]; const c = out[i + 1];
          const small = a[1] - a[0] < 0.8 * medH && c[1] - c[0] < 0.8 * medH; // numerator and denominator, not lines
          if (small && b[0] - a[1] <= 0.6 * medH && c[0] - b[1] <= 0.6 * medH && c[1] - a[0] <= 2 * medH) {
            out.splice(i - 1, 3, [a[0], c[1], true]); // flagged: a fraction is never cut apart again
            changed = true;
            break;
          }
        }
        const up = i > 0 ? b[0] - out[i - 1][1] : Infinity;
        const dn = i + 1 < out.length ? out[i + 1][0] - b[1] : Infinity;
        if (Math.min(up, dn) > 0.6 * medH) continue;
        const j = up <= dn ? i - 1 : i + 1;
        out[j] = [Math.min(out[j][0], b[0]), Math.max(out[j][1], b[1]), out[j][2]];
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
    return out;
  }

  /** Row (relative to the box) at the deepest valley between two lines, or -1. */
  function valley(prof, medH) {
    const n = prof.length;
    const s = smooth(prof, Math.max(1, Math.round(medH / 6)));
    const lo = Math.max(1, Math.round(0.6 * medH));
    const hi = n - lo;
    if (hi <= lo) return -1;
    const before = new Float64Array(n); const after = new Float64Array(n);
    for (let i = 0, m = 0; i < n; i++) { m = Math.max(m, s[i]); before[i] = m; }
    for (let i = n - 1, m = 0; i >= 0; i--) { m = Math.max(m, s[i]); after[i] = m; }
    let best = -1; let bestRatio = Infinity; let lowest = -1;
    const cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) cum[i + 1] = cum[i] + prof[i];
    for (let y = lo; y < hi; y++) {
      // both sides must hold real writing: cutting off a lone descender or a dot row is not a line split
      if (Math.min(cum[y], cum[n] - cum[y]) < MIN_SIDE * cum[n]) continue;
      const ratio = s[y] / Math.max(1e-9, Math.min(before[y], after[y]));
      if (ratio < bestRatio) { bestRatio = ratio; best = y; }
      if (lowest < 0 || s[y] < s[lowest]) lowest = y;
    }
    if (bestRatio <= DEEP) return best;
    return n > FORCE * medH ? lowest : -1;
  }

  /**
   * Leaf boxes (each about one text line) of the ink inside `box`, top to bottom.
   * @param {{data:Uint8Array,w:number,h:number}} bin ink = 1
   * @param {number} medH line pitch in px (spacing of the lines): drives the cuts and the column gaps
   * @param {{split?:boolean, lineH?:number}} [opts] split:false skips the valley cuts (used to measure first);
   *   lineH is the height of one written line (defaults to medH): it decides what is a sliver
   */
  function leaves(bin, medH, opts) {
    const split = !opts || opts.split !== false;
    const lineH = Math.min(medH, (opts && opts.lineH) || medH);
    const out = [];
    const minGap = 1;
    const colGap = Math.max(8, Math.round(COL_GAP * Math.min(medH, 1.5 * lineH)));
    const walk = (area, depth, whole) => {
      const box = tighten(bin, area);
      if (!box) return;
      const bands = foldSlivers(runs(rowProfile(bin, box), minGap), lineH);
      if (bands.length > 1 && depth < 60) {
        for (const [a, b, frac] of bands) walk({ x: box.x, y: box.y + a, w: box.w, h: b - a }, depth + 1, frac);
        return;
      }
      const keep = whole || (bands.length === 1 && bands[0][2]);
      const spans = runs(colProfile(bin, box), colGap);
      if (spans.length > 1 && depth < 60) {
        for (const [a, b] of spans) walk({ x: box.x + a, y: box.y, w: b - a, h: box.h }, depth + 1);
        return;
      }
      if (split && !keep && box.h > TALL * medH && depth < 60) {
        const cut = valley(rowProfile(bin, box), medH);
        if (cut > 0) {
          walk({ x: box.x, y: box.y, w: box.w, h: cut }, depth + 1);
          walk({ x: box.x, y: box.y + cut, w: box.w, h: box.h - cut }, depth + 1);
          return;
        }
        // no clean valley: maybe labels side by side at staggered heights, so try a narrower column gap
        const narrow = runs(colProfile(bin, box), Math.max(6, Math.round(NARROW_GAP * Math.min(medH, 1.5 * lineH))));
        if (narrow.length > 1) {
          for (const [a, b] of narrow) walk({ x: box.x + a, y: box.y, w: b - a, h: box.h }, depth + 1);
          return;
        }
      }
      out.push(box);
    };
    walk({ x: 0, y: 0, w: bin.w, h: bin.h }, 0);
    return out;
  }

  /** Dominant line spacing (px) from the autocorrelation of a row profile, or 0 when there is no clear rhythm. */
  function linePitch(prof, minLag, maxLag) {
    const n = prof.length;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += prof[i];
    mean /= n || 1;
    let zero = 0;
    for (let i = 0; i < n; i++) zero += (prof[i] - mean) * (prof[i] - mean);
    if (!zero) return 0;
    const acs = [];
    for (let lag = minLag; lag <= Math.min(maxLag, n - 2); lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += (prof[i] - mean) * (prof[i + lag] - mean);
      acs[lag] = s / zero;
    }
    const peaks = [];
    for (let lag = minLag + 1; lag < acs.length - 1; lag++) {
      if (acs[lag] > acs[lag - 1] && acs[lag] >= acs[lag + 1]) peaks.push(lag);
    }
    const best = Math.max(0, ...peaks.map((l) => acs[l]));
    if (best <= 0.12) return 0;
    // the first strong peak: multiples of the spacing correlate almost as well as the spacing itself
    return peaks.find((l) => acs[l] >= 0.7 * best);
  }

  PDFStudy.hwLineSplit = { leaves, valley, linePitch, rowProfile, colProfile, tighten, smooth };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwLineSplit;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Line and region segmentation of a binarised page (ink = 1), plus a text-vs-math heuristic.
 * Deterministic, DOM-free, linear in the bitmap size.
 *
 * segmentPage pipeline:
 *  1. ruled-paper rules (full-width rows, <= 3px thick) are erased from a working copy;
 *  2. rows with ink are grouped into bands (a 1-row hole does not split a band); specks are dropped;
 *  3. fragments merge into their line: i-dots / small slivers, and fraction numerator + bar + denominator;
 *  4. each line is split into regions at horizontal gaps wider than 1.5x the median line height.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const median = (arr) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[s.length >> 1];
  };

  /** Erase long thin full-width rules; returns { data, counts }. The input bitmap is never mutated. */
  function stripRules(bin) {
    const { w, h } = bin;
    let data = bin.data;
    const counts = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let c = 0;
      const o = y * w;
      for (let x = 0; x < w; x++) c += data[o + x];
      counts[y] = c;
    }
    const limit = w * 0.6;
    let y = 0;
    while (y < h) {
      if (counts[y] <= limit) { y++; continue; }
      let e = y;
      while (e < h && counts[e] > limit) e++;
      if (e - y <= 3) {
        if (data === bin.data) data = bin.data.slice();
        data.fill(0, y * w, e * w);
        counts.fill(0, y, e);
      }
      y = e;
    }
    return { data, counts };
  }

  /** Group ink rows into bands; a single empty row inside a band is tolerated. */
  function findBands(counts, h) {
    const bands = [];
    let start = -1;
    let last = -1;
    for (let y = 0; y <= h; y++) {
      const ink = y < h && counts[y] > 0;
      if (ink) {
        if (start < 0) start = y;
        else if (y - last > 2) { bands.push({ y0: start, y1: last + 1 }); start = y; }
        last = y;
      }
    }
    if (start >= 0) bands.push({ y0: start, y1: last + 1 });
    return bands;
  }

  function measure(data, w, b) {
    let x0 = w;
    let x1 = -1;
    let ink = 0;
    for (let y = b.y0; y < b.y1; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        if (data[o + x]) { ink++; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      }
    }
    b.x0 = x0;
    b.x1 = x1 + 1;
    b.ink = ink;
    return b;
  }

  const isBar = (b, medH) => {
    const h = b.y1 - b.y0;
    const bw = b.x1 - b.x0;
    return h <= 4 && bw >= 0.8 * medH && b.ink >= 0.6 * h * bw;
  };

  /** Merge i-dots, slivers and fraction parts into neighbouring bands. */
  function mergeFragments(bands, medH) {
    const out = [];
    for (const b of bands) {
      const bar = isBar(b, medH);
      const prev = out[out.length - 1];
      if (prev) {
        const gap = b.y0 - prev.y1;
        const overlap = Math.min(prev.x1, b.x1) - Math.max(prev.x0, b.x0);
        const small = (q) => q.y1 - q.y0 < 0.35 * medH;
        if (overlap > 0 && gap <= 0.6 * medH && (prev.endsBar || bar || small(prev) || small(b))) {
          prev.y1 = b.y1;
          prev.x0 = Math.min(prev.x0, b.x0);
          prev.x1 = Math.max(prev.x1, b.x1);
          prev.ink += b.ink;
          prev.endsBar = bar;
          continue;
        }
      }
      b.endsBar = bar;
      out.push(b);
    }
    return out;
  }

  /** Split a line band into regions at wide empty column gaps; boxes are tightened vertically. */
  function splitRegions(data, w, band, gapW) {
    const cols = new Int32Array(w);
    for (let y = band.y0; y < band.y1; y++) {
      const o = y * w;
      for (let x = band.x0; x < band.x1; x++) cols[x] += data[o + x];
    }
    const spans = [];
    let s = -1;
    let last = -1;
    for (let x = band.x0; x <= band.x1; x++) {
      if (x < band.x1 && cols[x] > 0) {
        if (s < 0) s = x;
        else if (x - last > gapW) { spans.push([s, last + 1]); s = x; }
        last = x;
      }
    }
    if (s >= 0) spans.push([s, last + 1]);
    const regions = [];
    for (const [a, b] of spans) {
      let y0 = band.y1;
      let y1 = band.y0;
      let ink = 0;
      for (let y = band.y0; y < band.y1; y++) {
        const o = y * w;
        for (let x = a; x < b; x++) if (data[o + x]) { ink++; if (y < y0) y0 = y; y1 = y + 1; }
      }
      if (ink >= 8) regions.push({ box: { x: a, y: y0, w: b - a, h: y1 - y0 } });
    }
    return regions;
  }

  /**
   * Segment a binarised page into reading-order lines of regions.
   * @param {{data:Uint8Array,w:number,h:number}} bin ink = 1
   * @returns {{index:number, box:object, regions:{box:object}[]}[]} regions carry no text/kind yet
   */
  function segmentPage(bin) {
    const { w, h } = bin;
    const { data, counts } = stripRules(bin);
    let bands = findBands(counts, h).map((b) => measure(data, w, b));
    bands = bands.filter((b) => b.ink >= 12 && !(b.y1 - b.y0 < 3 && b.x1 - b.x0 < 10));
    const probe = bands.filter((b) => b.y1 - b.y0 >= 6);
    const medH = median((probe.length ? probe : bands).map((b) => b.y1 - b.y0)) || 1;
    const lines = [];
    for (const band of mergeFragments(bands, medH)) {
      const regions = splitRegions(data, w, band, Math.max(4, Math.round(1.5 * medH)));
      if (!regions.length) continue;
      const x0 = Math.min(...regions.map((r) => r.box.x));
      const x1 = Math.max(...regions.map((r) => r.box.x + r.box.w));
      const y0 = Math.min(...regions.map((r) => r.box.y));
      const y1 = Math.max(...regions.map((r) => r.box.y + r.box.h));
      lines.push({ index: lines.length, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, regions });
    }
    return lines;
  }

  /** Longest ink run per row of the box, as { len, start } arrays. */
  function rowRuns(bin, box) {
    const len = new Int32Array(box.h);
    const start = new Int32Array(box.h);
    for (let r = 0; r < box.h; r++) {
      const o = (box.y + r) * bin.w + box.x;
      let run = 0;
      for (let c = 0; c <= box.w; c++) {
        if (c < box.w && bin.data[o + c]) run++;
        else {
          if (run > len[r]) { len[r] = run; start[r] = c - run; }
          run = 0;
        }
      }
    }
    return { len, start };
  }

  function inkIn(bin, box, r0, r1, c0, c1) {
    let n = 0;
    for (let r = r0; r < r1; r++) {
      const o = (box.y + r) * bin.w + box.x;
      for (let c = c0; c < c1; c++) n += bin.data[o + c];
    }
    return n;
  }

  /** Thin horizontal bars: runs of rows whose longest ink run is >= minLen and <= maxThick rows tall. */
  function findBars(bin, box, minLen, maxThick) {
    const { len, start } = rowRuns(bin, box);
    const bars = [];
    let r = 0;
    while (r < box.h) {
      if (len[r] < minLen) { r++; continue; }
      let e = r;
      let best = r;
      while (e < box.h && len[e] >= minLen) { if (len[e] > len[best]) best = e; e++; }
      if (e - r <= maxThick) bars.push({ r0: r, r1: e, c0: start[best], c1: start[best] + len[best] });
      r = e;
    }
    return bars;
  }

  /**
   * Heuristic text-vs-math decision (documented weak spots: a wide "E" or a hand-drawn "z" between
   * rules may read as math; slanted fraction bars are missed). math when any of:
   *  - the box is >= 1.6x the median line height (stacked ink, tall integral/root/sum symbols);
   *  - a fraction bar: thin run >= 0.6x box height with >= 0.5x its length in ink above AND below;
   *  - an "=" pattern: two thin bars of similar span, close together, with an ink-free gap between.
   * @param {{data:Uint8Array,w:number,h:number}} bin ink = 1
   * @param {{x:number,y:number,w:number,h:number}} box
   * @param {number} [medianLineH] median line height of the page (defaults to the box height)
   * @returns {'text'|'math'}
   */
  function classifyRegion(bin, box, medianLineH) {
    if (!box || box.w < 1 || box.h < 1) return 'text';
    const medH = medianLineH || box.h;
    if (box.h >= 1.6 * medH && box.h >= 24) return 'math';
    const minLen = Math.max(8, Math.round(0.6 * box.h));
    const bars = findBars(bin, box, minLen, Math.max(4, Math.round(0.15 * box.h)));
    for (const b of bars) {
      const L = b.c1 - b.c0;
      const above = inkIn(bin, box, 0, b.r0, b.c0, b.c1);
      const below = inkIn(bin, box, b.r1, box.h, b.c0, b.c1);
      if (above >= 0.5 * L && below >= 0.5 * L) return 'math';
    }
    for (let i = 0; i + 1 < bars.length; i++) {
      const a = bars[i];
      const b = bars[i + 1];
      const gap = b.r0 - a.r1;
      const overlap = Math.min(a.c1, b.c1) - Math.max(a.c0, b.c0);
      const span = Math.max(a.c1 - a.c0, b.c1 - b.c0);
      if (gap < 1 || gap > 0.5 * box.h || overlap < 0.7 * span) continue;
      const c0 = Math.max(a.c0, b.c0);
      const between = inkIn(bin, box, a.r1, b.r0, c0, c0 + overlap);
      if (between <= 0.05 * overlap * gap) return 'math';
    }
    return 'text';
  }

  PDFStudy.hwSegmenter = { segmentPage, classifyRegion };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwSegmenter;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Removal of ruled lines, frames, margin rules and binding gutters from an ink mask (ink = 1), edited in place.
 * Writing that crosses a rule keeps the pixels where it is thicker than the rule. DOM-free; linear in the bitmap size.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const RULE_THICK = 5; // px at a 1650 px wide page: a ruled line is at most this thick

  /**
   * Erase long thin horizontal and vertical runs (ruled lines, frames, margin rules). Only the thin part of a run is
   * erased, so a stroke crossing a rule keeps the pixels where it is thicker than the rule.
   */
  function stripRules(bin, scale) {
    const { data, w, h } = bin;
    const thick = Math.max(3, Math.round(RULE_THICK * scale));
    const erase = [];
    const thin = (p, crossStep) => {
      let t = 1;
      for (let q = p - crossStep; t <= thick && q >= 0 && data[q]; q -= crossStep) t++;
      for (let q = p + crossStep; t <= thick && q < data.length && data[q]; q += crossStep) t++;
      return t <= thick;
    };
    /**
     * A rule on a slightly turned scan is a staircase of runs, and only the long steps pass the length test. The
     * short steps lie against a long one, on the line next to it: a thin run of STEP px or more there is part of
     * the same rule and goes too, and so on from step to step. Letters resting on a rule are shorter than that.
     */
    const STEP = Math.max(16, Math.round(24 * scale));
    const grow = (runs, lines, len, lineStep, step, crossStep, minLen) => {
      const seen = new Set();
      while (runs.length) {
        const [a, k, e] = runs.pop();
        for (const l of [a - 1, a + 1]) {
          if (l < 0 || l >= lines) continue;
          const base = l * lineStep;
          for (let j = Math.max(0, k - 2); j < Math.min(len, e + 2);) {
            if (!data[base + j * step]) { j++; continue; }
            let s = j;
            while (s > 0 && data[base + (s - 1) * step]) s--;
            let t = j;
            while (t < len && data[base + t * step]) t++;
            j = t;
            if (t - s < STEP || t - s >= minLen || seen.has(l * len + s)) continue;
            seen.add(l * len + s);
            const flat = [];
            for (let q = s; q < t; q++) if (thin(base + q * step, crossStep)) flat.push(base + q * step);
            if (flat.length < 0.8 * (t - s)) continue; // mostly thicker than a rule: a stroke, not a step
            for (const p of flat) erase.push(p);
            runs.push([l, s, t]);
          }
        }
      }
    };
    // walk every run along `step`; a run of >= minLen keeps only pixels thicker than a rule across it
    const sweep = (lines, len, lineStep, step, crossStep, minLen) => {
      const long = [];
      for (let a = 0; a < lines; a++) {
        const base = a * lineStep;
        for (let k = 0; k < len;) {
          if (!data[base + k * step]) { k++; continue; }
          let e = k;
          while (e < len && data[base + e * step]) e++;
          if (e - k >= minLen) {
            for (let j = k; j < e; j++) {
              const p = base + j * step;
              if (thin(p, crossStep)) erase.push(p);
            }
            long.push([a, k, e]);
          }
          k = e;
        }
      }
      grow(long, lines, len, lineStep, step, crossStep, minLen);
    };
    sweep(h, w, w, 1, w, Math.max(40, Math.round(w * 0.12))); // horizontal rules
    sweep(w, h, 1, w, 1, Math.max(40, Math.round(h * 0.08))); // vertical rules and frames
    for (const p of erase) data[p] = 0;
    return erase.length + stripBrokenColumns(bin, thick + 2);
  }

  /**
   * Thick dark bands along whole columns or rows (a binding gutter, the edges of the pages beneath, a shadowed
   * border) hold far more ink than writing ever puts into one column or row: such columns/rows are blanked, growing
   * from the densest ones into their dense neighbours.
   */
  function stripDenseBands(bin) {
    const { data, w, h } = bin;
    const cols = new Int32Array(w);
    const rows = new Int32Array(h);
    const run = new Int32Array(w);
    const colRun = new Int32Array(w); // longest vertical run per column: a gutter has long streaks, text does not
    const rowRun = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      let r = 0;
      for (let x = 0, o = y * w; x < w; x++) {
        if (data[o + x]) {
          cols[x]++; rows[y]++;
          if (++run[x] > colRun[x]) colRun[x] = run[x];
          if (++r > rowRun[y]) rowRun[y] = r;
        } else { run[x] = 0; r = 0; }
      }
    }
    const grow = (count, longest, n, seed, minRun, keep) => {
      const hit = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (count[i] < seed || longest[i] < minRun || hit[i]) continue;
        let a = i; let b = i;
        while (a > 0 && count[a - 1] >= keep) a--;
        while (b + 1 < n && count[b + 1] >= keep) b++;
        hit.fill(1, Math.max(0, a - 2), Math.min(n, b + 3));
      }
      return hit;
    };
    const streak = 100 * Math.max(0.3, w / 1650); // px: longer than any letter stroke
    const badCol = grow(cols, colRun, w, 0.35 * h, Math.max(0.1 * h, streak), 0.12 * h);
    const badRow = grow(rows, rowRun, h, 0.6 * w, Math.max(0.2 * w, streak), 0.3 * w);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      if (badRow[y]) { data.fill(0, o, o + w); continue; }
      for (let x = 0; x < w; x++) if (badCol[x]) data[o + x] = 0;
    }
  }

  /**
   * Broken vertical lines (a binding edge, a dashed margin rule): columns where thin vertical ink adds up to a large
   * share of the page height. Handwriting never stacks that much thin ink in one column.
   */
  function stripBrokenColumns(bin, thin) {
    const { data, w, h } = bin;
    const thinCount = new Int32Array(w);
    const eachThinRun = (fn) => {
      for (let y = 0; y < h; y++) {
        const o = y * w;
        for (let x = 0; x < w;) {
          if (!data[o + x]) { x++; continue; }
          let e = x;
          while (e < w && data[o + e]) e++;
          if (e - x <= thin) for (let k = x; k < e; k++) fn(o, k);
          x = e;
        }
      }
    };
    eachThinRun((o, x) => { thinCount[x]++; });
    const rule = new Uint8Array(w);
    let any = 0;
    for (let x = 0; x < w; x++) if (thinCount[x] >= h * 0.12) { rule[x] = 1; any++; }
    if (!any) return 0;
    const hits = [];
    eachThinRun((o, x) => { if (rule[x] || (x > 0 && rule[x - 1]) || (x + 1 < w && rule[x + 1])) hits.push(o + x); });
    for (const p of hits) data[p] = 0;
    return hits.length;
  }

  PDFStudy.hwRuleStrip = { stripRules, stripDenseBands, stripBrokenColumns };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwRuleStrip;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

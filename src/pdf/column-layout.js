/**
 * Per-page Column / Margin-Note Layout Detector (100% Offline, Non-AI)
 * Finds consistent vertical gutters in the x-positions of PDF.js text spans so two-column pages
 * are read left column first, then right, and narrow outer sidebars/margin notes leave the main flow.
 * Spans: { x0, x1, baselineY, fontSize, ... } as built by pdf-loader.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const BIN = 2; // pt per histogram bin
  const MIN_GUTTER = 7; // narrowest gap (pt) accepted as a column gutter
  const MIN_SIDE_ROWS = 3; // rows of text needed on each side of a gutter
  const MARGIN_WIDTH_RATIO = 0.46; // narrow outer sidebars (<46% of main width); wider columns stay in flow
  const MAX_DEPTH = 2;

  /** Groups spans into visual rows by baseline, then merges each row's spans into segments. */
  function buildRows(spans) {
    const sorted = [...spans].sort((a, b) => a.baselineY - b.baselineY || a.x0 - b.x0);
    const rows = [];
    for (const s of sorted) {
      const last = rows[rows.length - 1];
      if (last && Math.abs(s.baselineY - last.y) <= Math.max(last.fs, s.fontSize) * 0.4) {
        last.spans.push(s);
        last.fs = Math.max(last.fs, s.fontSize);
      } else {
        rows.push({ y: s.baselineY, fs: s.fontSize, spans: [s] });
      }
    }
    for (const row of rows) {
      row.spans.sort((a, b) => a.x0 - b.x0);
      row.segs = [];
      for (const s of row.spans) {
        const seg = row.segs[row.segs.length - 1];
        // Word gaps are ~0.3em; anything wider than ~1em separates two layout segments
        if (seg && s.x0 - seg.x1 <= Math.max(6, s.fontSize * 1.05)) {
          seg.x1 = Math.max(seg.x1, s.x1);
          seg.spans.push(s);
        } else {
          row.segs.push({ x0: s.x0, x1: s.x1, spans: [s] });
        }
      }
    }
    return rows;
  }

  /** Candidate gutters: runs of near-minimal segment coverage inside the content's middle band. */
  function findCandidates(rows) {
    const segs = rows.flatMap((r) => r.segs);
    if (segs.length < MIN_SIDE_ROWS * 2) return [];
    const minX = Math.min(...segs.map((s) => s.x0));
    const maxX = Math.max(...segs.map((s) => s.x1));
    const extent = maxX - minX;
    if (extent < 120) return [];
    const nBins = Math.ceil(extent / BIN) + 1;
    const cover = new Array(nBins).fill(0);
    for (const s of segs) {
      const b0 = Math.max(0, Math.floor((s.x0 - minX) / BIN));
      const b1 = Math.min(nBins - 1, Math.floor((s.x1 - minX - 0.5) / BIN));
      for (let b = b0; b <= b1; b++) cover[b]++;
    }
    const lo = Math.floor((extent * 0.12) / BIN);
    const hi = Math.ceil((extent * 0.88) / BIN);
    const mid = cover.slice(lo, hi + 1);
    const floor = Math.min(...mid);
    const limit = floor + Math.max(1, Math.round(rows.length * 0.04));
    const runs = [];
    let start = -1;
    for (let b = lo; b <= hi + 1; b++) {
      const ok = b <= hi && cover[b] <= limit;
      if (ok && start < 0) start = b;
      if (!ok && start >= 0) {
        // Narrow the run to its emptiest core so ragged line ends don't count as crossing it
        const runMin = Math.min(...cover.slice(start, b));
        let bestS = -1;
        let bestE = -1;
        for (let k = start, s = -1; k <= b; k++) {
          if (k < b && cover[k] <= runMin) {
            if (s < 0) s = k;
          } else if (s >= 0) {
            if (k - s > bestE - bestS) [bestS, bestE] = [s, k];
            s = -1;
          }
        }
        const g0 = minX + bestS * BIN;
        const g1 = minX + bestE * BIN;
        if (bestS >= 0 && g1 - g0 >= MIN_GUTTER) runs.push({ g0, g1 });
        start = -1;
      }
    }
    return runs;
  }

  function sideOf(seg, gutter) {
    if (seg.x1 <= gutter.g0 + BIN) return 'L';
    if (seg.x0 >= gutter.g1 - BIN) return 'R';
    return 'X';
  }

  /** Splits rows into vertical blocks of consecutive non-crossing rows; keeps blocks with text side by side. */
  function evaluate(rows, gutter) {
    const blocks = [];
    let cur = null;
    rows.forEach((row, idx) => {
      const sides = row.segs.map((s) => sideOf(s, gutter));
      if (sides.includes('X')) {
        cur = null;
        return;
      }
      if (!cur) blocks.push((cur = { rows: [] }));
      cur.rows.push({ idx, row, sides });
    });
    const valid = blocks.filter((b) => {
      const left = b.rows.filter((r) => r.sides.includes('L'));
      const right = b.rows.filter((r) => r.sides.includes('R'));
      if (left.length < MIN_SIDE_ROWS || right.length < MIN_SIDE_ROWS) return false;
      const lTop = left[0].row.y;
      const lBot = left[left.length - 1].row.y;
      const rTop = right[0].row.y;
      const rBot = right[right.length - 1].row.y;
      const overlap = Math.min(lBot, rBot) - Math.max(lTop, rTop);
      return overlap >= 0.5 * Math.min(lBot - lTop, rBot - rTop) && overlap > 0;
    });
    const score = valid.reduce((acc, b) => acc + b.rows.length, 0);
    return { gutter, blocks: valid, score };
  }

  function region(spans, column, isMargin) {
    return { spans, column, isMargin };
  }

  function widthOf(segs) {
    return segs.length ? Math.max(...segs.map((s) => s.x1)) - Math.min(...segs.map((s) => s.x0)) : 0;
  }

  /**
   * Returns reading-order regions: [{ spans, column, isMargin }]. Single-column pages come back as
   * one region holding every span, so callers can build lines exactly as before.
   */
  function splitRegions(spans, depth = 0, columnBase = 0) {
    const list = (spans || []).filter((s) => s && Number.isFinite(s.x0) && Number.isFinite(s.x1));
    if (depth > MAX_DEPTH || list.length < MIN_SIDE_ROWS * 2) return [region(list, columnBase, false)];
    const rows = buildRows(list);
    let best = null;
    for (const g of findCandidates(rows)) {
      const ev = evaluate(rows, g);
      if (ev.blocks.length && (!best || ev.score > best.score)) best = ev;
    }
    if (!best) return [region(list, columnBase, false)];

    const { gutter } = best;
    const nonCross = rows.filter((r) => !r.segs.some((s) => sideOf(s, gutter) === 'X'));
    const leftSegs = nonCross.flatMap((r) => r.segs.filter((s) => sideOf(s, gutter) === 'L'));
    const rightSegs = nonCross.flatMap((r) => r.segs.filter((s) => sideOf(s, gutter) === 'R'));
    const lw = widthOf(leftSegs);
    const rw = widthOf(rightSegs);
    // Parallel columns starting on the same header baseline (e.g. "Pseudocode" | "Java") are true columns, not margins
    const lRows = nonCross.filter((r) => r.segs.some((s) => sideOf(s, gutter) === 'L'));
    const rRows = nonCross.filter((r) => r.segs.some((s) => sideOf(s, gutter) === 'R'));
    const alignedHeaders = lRows.length >= 5 && rRows.length >= 5 && Math.abs(lRows[0].y - rRows[0].y) <= 4;
    const marginSide = alignedHeaders ? null : lw < rw * MARGIN_WIDTH_RATIO ? 'L' : rw < lw * MARGIN_WIDTH_RATIO ? 'R' : null;

    if (marginSide) {
      // Route EVERY non-crossing row across the proven margin gutter so edge margin lines never bleed into body rows
      const mainSide = marginSide === 'L' ? 'R' : 'L';
      const mainSpans = [];
      const marginSpans = [];
      for (const row of rows) {
        if (row.spans.some((s) => sideOf(s, gutter) === 'X')) mainSpans.push(...row.spans);
        else for (const s of row.spans) (sideOf(s, gutter) === marginSide ? marginSpans : mainSpans).push(s);
      }
      const mainCol = columnBase + (mainSide === 'L' ? 0 : 1);
      const margCol = columnBase + (marginSide === 'L' ? 0 : 1);
      const out = mainSpans.length ? splitRegions(mainSpans, depth + 1, mainCol * 2) : [];
      return marginSpans.length ? out.concat([region(marginSpans, margCol, true)]) : out;
    }

    const pick = (b, side) => b.rows.flatMap((r) => r.row.segs.filter((s) => sideOf(s, gutter) === side));
    const out = [];
    let flow = [];
    const flush = () => {
      if (flow.length) out.push(region(flow, columnBase, false));
      flow = [];
    };
    // Group all consecutive non-crossing rows so edge lines of a 2-column block stay split too
    const splitRuns = [];
    let curRun = null;
    rows.forEach((row, idx) => {
      if (row.segs.some((s) => sideOf(s, gutter) === 'X')) {
        curRun = null;
      } else {
        if (!curRun) splitRuns.push((curRun = { rows: [] }));
        curRun.rows.push({ idx, row });
      }
    });
    const inBlock = new Map();
    for (const run of splitRuns) {
      const hasL = run.rows.some((r) => r.row.segs.some((s) => sideOf(s, gutter) === 'L'));
      const hasR = run.rows.some((r) => r.row.segs.some((s) => sideOf(s, gutter) === 'R'));
      if (hasL && hasR) run.rows.forEach((r) => inBlock.set(r.idx, run));
    }
    const emitted = new Set();
    rows.forEach((row, idx) => {
      const b = inBlock.get(idx);
      if (!b) {
        flow.push(...row.spans);
        return;
      }
      if (emitted.has(b)) return;
      emitted.add(b);
      flush();
      for (const side of ['L', 'R']) {
        const sideSpans = pick(b, side).flatMap((s) => s.spans);
        if (!sideSpans.length) continue;
        const col = columnBase + (side === 'L' ? 0 : 1);
        out.push(...splitRegions(sideSpans, depth + 1, col * 2));
      }
    });
    flush();
    return out;
  }

  PDFStudy.columnLayout = { splitRegions, buildRows, findCandidates };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.columnLayout;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Side-by-side Slide Columns (100% offline, deterministic).
 * Slides often set two lists side by side ("Acute infarct" | "Chronic infarct", pros | cons). When both
 * columns share baselines, line building glues each pair into one row ("Acute infarct ... Chronic infarct ...",
 * "• Hemorrhage • Tissue loss"). splitPairs finds the gutter those rows share, splits them at it, and
 * returns the slide's lines in reading order: rows above the pair, the whole left column, the whole right
 * column, rows below. Split rows get column ids LEFT_COLUMN / RIGHT_COLUMN so later steps never join a left
 * row onto a right row and nest each column under its own heading.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_PAIRED_ROWS = 2; // rows that must share one gutter
  const GUTTER_ZONE = [0.22, 0.78]; // the gutter lies across the middle band of the slide width
  const LEFT_COLUMN = 1001;
  const RIGHT_COLUMN = 1002;
  const BULLET_RE = /^[\s]*([✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○\-*+]|\d+[.)])\s+/;

  /** Horizontal gaps between a row's segments: [[x1 of left part, x0 of right part]] */
  const gapsOf = (l) => (l.segments || []).slice(1).map((s, i) => [l.segments[i].x1, s.x0]);
  const cx = (o) => (o.x0 + o.x1) / 2;

  /** Picks the x that lies inside a gap of the most rows (at least MIN_PAIRED_ROWS), within the zone. */
  function findGutter(lines, width, zone = GUTTER_ZONE) {
    const gaps = lines.flatMap((l) => gapsOf(l).map((g) => ({ g, l })));
    let best = null;
    for (const { g } of gaps) {
      const x = (g[0] + g[1]) / 2;
      if (x < width * zone[0] || x > width * zone[1]) continue;
      const rows = new Set(gaps.filter((o) => o.g[0] <= x && o.g[1] >= x).map((o) => o.l));
      if (rows.size >= MIN_PAIRED_ROWS && (!best || rows.size > best.rows.size)) best = { x, rows };
    }
    return best;
  }

  /** One half of a glued row as its own line object (retains multi-segment array if >= 2 segments stay together). */
  function half(line, segs, column) {
    const text = segs.map((s) => s.text).join(' ').replace(/\*\*/g, '').trim();
    return {
      ...line, text, formattedText: text, cleanText: text.replace(BULLET_RE, '').trim(),
      segments: segs.length >= 2 ? segs : undefined,
      x0: segs[0].x0, textX0: segs[0].x0, x1: segs[segs.length - 1].x1, column, hasBullet: BULLET_RE.test(text),
      wordCount: text.split(/\s+/).length,
    };
  }

  /** Find a crossing-free cut x within `[lo, hi]` with at least `8pt` clearance, or null. */
  function findClearCut(colLines, lo, hi) {
    const pts = [];
    for (const l of colLines) {
      const spans = l.segments || [l];
      for (const s of spans) {
        if (s.x1 > lo && s.x0 < hi) pts.push([Math.max(lo, s.x0), Math.min(hi, s.x1)]);
      }
    }
    pts.sort((a, b) => a[0] - b[0]);
    let cur = lo;
    let best = null;
    for (const [a, b] of pts) {
      if (a - cur >= 8 && (!best || a - cur > best[1] - best[0])) best = [cur, a];
      cur = Math.max(cur, b);
    }
    if (hi - cur >= 8 && (!best || hi - cur > best[1] - best[0])) best = [cur, hi];
    return best ? (best[0] + best[1]) / 2 : null;
  }

  /** Split a group of lines further if a clear gap (>= max(32, 2.2*fs)) separates non-overlapping columns inside it. */
  function splitSubColumns(colLines, nextColId) {
    if (colLines.length < 2) return { cols: [colLines.map((l) => ({ ...l, segments: undefined, column: nextColId }))], nextId: nextColId + 1 };
    const fs = Math.max(...colLines.map((l) => l.fontSize || 14));
    const minGap = Math.max(32, fs * 2.2);
    const cuts = [];
    for (const r of colLines.filter((l) => l.segments && l.segments.length >= 2)) {
      for (let i = 1; i < r.segments.length; i++) {
        if (r.segments[i].x0 - r.segments[i - 1].x1 >= minGap) cuts.push([r.segments[i - 1].x1, r.segments[i].x0]);
      }
    }
    const minX = Math.min(...colLines.map((l) => l.x0));
    const maxX = Math.max(...colLines.map((l) => l.x1));
    if (!cuts.length) {
      const gx = findClearCut(colLines, minX + 1, maxX - 1);
      if (gx !== null) {
        const lSide = colLines.filter((l) => l.x1 <= gx);
        const rSide = colLines.filter((l) => l.x0 >= gx);
        if (lSide.length && rSide.length) {
          const gap = Math.min(...rSide.map((l) => l.x0)) - Math.max(...lSide.map((l) => l.x1));
          const overlap = Math.min(Math.max(...lSide.map((l) => l.bottomY)), Math.max(...rSide.map((l) => l.bottomY))) -
            Math.max(Math.min(...lSide.map((l) => l.topY)), Math.min(...rSide.map((l) => l.topY)));
          if (gap >= minGap && overlap > 0) cuts.push([Math.max(...lSide.map((l) => l.x1)), Math.min(...rSide.map((l) => l.x0))]);
        }
      }
    }
    for (const [lo, hi] of cuts) {
      const gx = findClearCut(colLines, lo, hi);
      if (gx === null) continue;
      const left = [];
      const right = [];
      for (const l of colLines) {
        if (l.segments) {
          const ls = l.segments.filter((s) => s.x1 <= gx);
          const rs = l.segments.filter((s) => s.x0 >= gx);
          if (ls.length) left.push(half(l, ls, nextColId));
          if (rs.length) right.push(half(l, rs, nextColId));
        } else if (l.x1 <= gx) left.push(l);
        else right.push(l);
      }
      if (left.length && right.length) {
        const a = splitSubColumns(left, nextColId);
        const b = splitSubColumns(right, a.nextId);
        return { cols: a.cols.concat(b.cols), nextId: b.nextId };
      }
    }
    return { cols: [colLines.map((l) => ({ ...l, segments: undefined, column: nextColId }))], nextId: nextColId + 1 };
  }

  /** Returns lines in column reading order, handling multi-gutter and stacked band pairs cleanly. */
  function splitPairs(lines, width, colBase = LEFT_COLUMN) {
    const w = width || 960;
    const g = findGutter(lines, w);
    if (!g) return lines;
    const paired = lines.filter((l) => g.rows.has(l));
    // Rows of three or more cells across >= 3 rows are a table (table-grid.js), not side-by-side lists
    if (paired.filter((l) => l.segments.length >= 3).length >= 3) return lines;
    const top = Math.min(...paired.map((l) => l.topY));
    const bottom = Math.max(...paired.map((l) => l.bottomY));
    const lineH = Math.max(...paired.map((l) => l.fontSize || 12));
    // Line directly above top sitting inside one column directly over a paired cell ("Fluorescent" above "antibody detection")
    const overCol = (l) => l.topY >= top - lineH * 1.5 && l.bottomY <= top + 2 && (l.x1 <= g.x || l.x0 >= g.x) &&
      paired.some((p) => (p.segments || [p]).some((s) => (l.x1 <= g.x ? s.x1 <= g.x : s.x0 >= g.x) && Math.abs(cx(l) - cx(s)) <= lineH * 1.5));
    const inRegion = (l) => (l.topY >= top - 1 || overCol(l)) && l.topY <= bottom + lineH * 1.5 && (g.rows.has(l) || l.x1 <= g.x || l.x0 >= g.x);
    const before = [];
    const left = [];
    const right = [];
    const after = [];
    let regionBottom = bottom;
    for (const l of lines.slice().sort((a, b) => a.topY - b.topY)) {
      if (l.topY < top - 1 && !overCol(l)) before.push(l);
      else if (inRegion(l) || (l.topY <= regionBottom + lineH * 1.5 && (l.x1 <= g.x || l.x0 >= g.x))) {
        regionBottom = Math.max(regionBottom, l.bottomY);
        if (g.rows.has(l)) {
          const segs = l.segments;
          const ls = segs.filter((s) => s.x1 <= g.x);
          const rs = segs.filter((s) => s.x0 >= g.x);
          if (ls.length) left.push(half(l, ls, colBase));
          if (rs.length) right.push(half(l, rs, colBase + 1));
        } else if (l.x1 <= g.x) left.push({ ...l, column: colBase });
        else right.push({ ...l, column: colBase + 1 });
      } else after.push(l);
    }
    const splitL = splitSubColumns(left, colBase);
    const splitR = splitSubColumns(right, splitL.nextId);
    const splitAfter = findGutter(after, w) ? splitPairs(after, w, splitR.nextId) : after;
    return before.concat(...splitL.cols, ...splitR.cols, splitAfter);
  }

  /**
   * Two lists set side by side whose rows did not share baselines, so line building kept them apart (pros |
   * cons of two procedures, a heading over each half). The gutter is an x that no line of the band crosses,
   * with at least MIN_STACKED_LINES lines on each side whose vertical spans overlap. Lines of the band get
   * column ids like split rows; lines above or below it (the title, a closing note) are left as they are.
   */
  function splitStacked(lines, width) {
    const w = width || 960;
    const body = lines.filter((l) => Number.isFinite(l.x0) && Number.isFinite(l.x1) && Number.isFinite(l.topY) && !l.kind);
    if (body.length < 3 || lines.some((l) => l.column >= LEFT_COLUMN)) return lines;
    // Do not split 3+ row multi-column tables
    if (body.filter((l) => l.segments && l.segments.length >= 3).length >= 3) return lines;
    let best = null;
    for (const x of [...new Set(body.map((l) => Math.round(l.x1)))].sort((a, b) => a - b)) {
      const g = x + 1;
      if (g < w * STACKED_ZONE[0] || g > w * STACKED_ZONE[1]) continue;
      const left = body.filter((l) => l.x1 <= g);
      const right = body.filter((l) => l.x0 > g + MIN_STACKED_GAP);
      if (left.length < MIN_STACKED_LINES || !right.length) continue;
      // The band: where the right column runs, widened by a line, and the left lines inside it.
      const lineH = Math.max(...right.map((l) => l.fontSize || 12));
      const top = Math.min(...right.map((l) => l.topY)) - lineH;
      const bottom = Math.max(...right.map((l) => l.bottomY)) + lineH;
      const inBand = (l) => l.bottomY >= top && l.topY <= bottom;
      const bandLeft = left.filter(inBand);
      if (bandLeft.length < MIN_STACKED_LINES || body.some((l) => inBand(l) && l.x1 > g && l.x0 <= g + MIN_STACKED_GAP)) continue;
      const gap = Math.min(...right.map((l) => l.x0)) - Math.max(...bandLeft.map((l) => l.x1));
      const span = (list) => [Math.min(...list.map((l) => l.topY)), Math.max(...list.map((l) => l.bottomY))];
      const [lt, lb] = span(bandLeft);
      const [rt, rb] = span(right);
      if (body.some((l) => l.column >= 1 && l.column < LEFT_COLUMN && inBand(l) && body.some((o) => o.column === l.column && !inBand(o)))) continue;
      const asymPair = right.length === 1 && bandLeft.length >= 2 && gap >= Math.max(36, lineH * 2) && rt >= lt - 4 && rb <= lb + 4;
      if (right.length < MIN_STACKED_LINES && !asymPair) continue;
      if (right.length === 2 && gap < Math.max(24, lineH * 1.2)) continue;
      // Side by side, not one list under a picture label: the two halves share most of their height and type size.
      const overlap = Math.min(lb, rb) - Math.max(lt, rt);
      if (overlap < STACKED_OVERLAP * Math.min(lb - lt, rb - rt)) continue;
      const median = (list) => list.map((l) => l.fontSize || 12).sort((a, b) => a - b)[Math.floor(list.length / 2)];
      if (Math.abs(median(bandLeft) - median(right)) > STACKED_SIZE_TOL) continue;
      // A list runs line under line; labels scattered beside pictures leave empty bands between them.
      const dense = (list) => list.slice().sort((a, b) => a.topY - b.topY)
        .every((l, i, s) => i === 0 || l.topY - s[i - 1].bottomY <= STACKED_MAX_GAP * (s[i - 1].fontSize || 12));
      if (!dense(bandLeft) || !dense(right)) continue;
      const count = bandLeft.length + right.length;
      if (!best || count > best.count) best = { g, count, inBand };
    }
    if (!best) return lines;
    const { g, inBand } = best;
    const before = [];
    const left = [];
    const right = [];
    const after = [];
    const bandTop = Math.min(...body.filter((l) => inBand(l)).map((l) => l.topY));
    for (const l of lines) {
      if (l.kind || !inBand(l)) (l.topY < bandTop ? before : after).push(l);
      else if (l.x1 <= g) left.push({ ...l, column: LEFT_COLUMN });
      else right.push({ ...l, column: RIGHT_COLUMN });
    }
    const byY = (a, b) => a.topY - b.topY;
    return before.concat(...splitSubColumns(left.sort(byY), LEFT_COLUMN).cols, ...splitSubColumns(right.sort(byY), RIGHT_COLUMN).cols, after);
  }

  const MIN_STACKED_LINES = 2;
  const MIN_STACKED_GAP = 12; // pt of clear gutter between the two halves
  const STACKED_ZONE = [0.2, 0.8];
  const STACKED_OVERLAP = 0.6; // share of the shorter half's height the two halves must share
  const STACKED_SIZE_TOL = 2.5; // pt between the halves' median type sizes
  const STACKED_MAX_GAP = 2; // x font size: the largest empty band between two lines of one half

  PDFStudy.slideColumns = { splitPairs, splitStacked, findGutter, LEFT_COLUMN, RIGHT_COLUMN };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideColumns;
  }
})(typeof window !== 'undefined' ? window : globalThis);

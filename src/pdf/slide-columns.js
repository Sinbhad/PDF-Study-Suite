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
  const GUTTER_ZONE = [0.25, 0.75]; // the gutter lies in the middle half of the slide width
  const LEFT_COLUMN = 1001;
  const RIGHT_COLUMN = 1002;
  const BULLET_RE = /^[\s]*([✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○\-*+]|\d+[.)])\s+/;

  /** Horizontal gaps between a row's segments: [[x1 of left part, x0 of right part]] */
  const gapsOf = (l) => (l.segments || []).slice(1).map((s, i) => [l.segments[i].x1, s.x0]);

  /** Picks the x that lies inside a gap of the most rows (at least MIN_PAIRED_ROWS), within the zone. */
  function findGutter(lines, width) {
    const gaps = lines.flatMap((l) => gapsOf(l).map((g) => ({ g, l })));
    let best = null;
    for (const { g } of gaps) {
      const x = (g[0] + g[1]) / 2;
      if (x < width * GUTTER_ZONE[0] || x > width * GUTTER_ZONE[1]) continue;
      const rows = new Set(gaps.filter((o) => o.g[0] <= x && o.g[1] >= x).map((o) => o.l));
      if (rows.size >= MIN_PAIRED_ROWS && (!best || rows.size > best.rows.size)) best = { x, rows };
    }
    return best;
  }

  /** One half of a glued row as its own line object. */
  function half(line, segs, column) {
    const text = segs.map((s) => s.text).join(' ').replace(/\*\*/g, '').trim();
    return {
      ...line, text, formattedText: text, cleanText: text.replace(BULLET_RE, '').trim(), segments: undefined,
      x0: segs[0].x0, textX0: segs[0].x0, x1: segs[segs.length - 1].x1, column, hasBullet: BULLET_RE.test(text),
      wordCount: text.split(/\s+/).length,
    };
  }

  /** Returns lines in column reading order (or the input unchanged when no shared gutter exists). */
  function splitPairs(lines, width) {
    const w = width || 960;
    const g = findGutter(lines, w);
    if (!g) return lines;
    const paired = lines.filter((l) => g.rows.has(l));
    // Rows of three or more cells are a table (table-grid.js), not two lists side by side
    if (paired.filter((l) => l.segments.length >= 3).length * 2 > paired.length) return lines;
    const top = Math.min(...paired.map((l) => l.topY));
    const bottom = Math.max(...paired.map((l) => l.bottomY));
    const lineH = Math.max(...paired.map((l) => l.fontSize || 12));
    // The pair region: the paired rows plus rows just below that sit wholly on one side of the gutter
    const inRegion = (l) => l.topY >= top - 1 && l.topY <= bottom + lineH * 1.5 && (g.rows.has(l) || l.x1 <= g.x || l.x0 >= g.x);
    const before = [];
    const left = [];
    const right = [];
    const after = [];
    let regionBottom = bottom;
    for (const l of lines.slice().sort((a, b) => a.topY - b.topY)) {
      if (l.topY < top - 1) before.push(l);
      else if (inRegion(l) || (l.topY <= regionBottom + lineH * 1.5 && (l.x1 <= g.x || l.x0 >= g.x))) {
        regionBottom = Math.max(regionBottom, l.bottomY);
        if (g.rows.has(l)) {
          const segs = l.segments;
          const ls = segs.filter((s) => s.x1 <= g.x);
          const rs = segs.filter((s) => s.x0 >= g.x);
          if (ls.length) left.push(half(l, ls, LEFT_COLUMN));
          if (rs.length) right.push(half(l, rs, RIGHT_COLUMN));
        } else if (l.x1 <= g.x) left.push({ ...l, column: LEFT_COLUMN });
        else right.push({ ...l, column: RIGHT_COLUMN });
      } else after.push(l);
    }
    // Keep the original relative order of rows outside the pair (title first, notes after)
    return before.concat(left, right, after);
  }

  /**
   * Two lists set side by side whose rows did not share baselines, so line building kept them apart (pros |
   * cons of two procedures, a heading over each half). The gutter is an x that no line of the band crosses,
   * with at least MIN_STACKED_LINES lines on each side whose vertical spans overlap. Lines of the band get
   * column ids like split rows; lines above or below it (the title, a closing note) are left as they are.
   */
  function splitStacked(lines, width) {
    const w = width || 960;
    const body = lines.filter((l) => Number.isFinite(l.x0) && Number.isFinite(l.x1) && Number.isFinite(l.topY));
    if (body.length < MIN_STACKED_LINES * 2 || lines.some((l) => l.column >= LEFT_COLUMN)) return lines;
    let best = null;
    for (const x of [...new Set(body.map((l) => Math.round(l.x1)))].sort((a, b) => a - b)) {
      const g = x + 1;
      if (g < w * STACKED_ZONE[0] || g > w * STACKED_ZONE[1]) continue;
      const left = body.filter((l) => l.x1 <= g);
      const right = body.filter((l) => l.x0 > g + MIN_STACKED_GAP);
      if (left.length < MIN_STACKED_LINES || right.length < MIN_STACKED_LINES) continue;
      // The band: where the right column runs, widened by a line, and the left lines inside it.
      const lineH = Math.max(...right.map((l) => l.fontSize || 12));
      const top = Math.min(...right.map((l) => l.topY)) - lineH;
      const bottom = Math.max(...right.map((l) => l.bottomY)) + lineH;
      const inBand = (l) => l.bottomY >= top && l.topY <= bottom;
      const bandLeft = left.filter(inBand);
      if (bandLeft.length < MIN_STACKED_LINES || body.some((l) => inBand(l) && l.x1 > g && l.x0 <= g + MIN_STACKED_GAP)) continue;
      // Side by side, not one list under a picture label: the two halves share most of their height and type size.
      const span = (list) => [Math.min(...list.map((l) => l.topY)), Math.max(...list.map((l) => l.bottomY))];
      const [lt, lb] = span(bandLeft);
      const [rt, rb] = span(right);
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
    const bandTop = Math.min(...lines.filter((l) => inBand(l)).map((l) => l.topY));
    for (const l of lines) {
      if (!inBand(l)) (l.topY < bandTop ? before : after).push(l);
      else if (l.x1 <= g) left.push({ ...l, column: LEFT_COLUMN });
      else right.push({ ...l, column: RIGHT_COLUMN });
    }
    const byY = (a, b) => a.topY - b.topY;
    return before.concat(left.sort(byY), right.sort(byY), after);
  }

  const MIN_STACKED_LINES = 3;
  const MIN_STACKED_GAP = 12; // pt of clear gutter between the two halves
  const STACKED_ZONE = [0.3, 0.7];
  const STACKED_OVERLAP = 0.6; // share of the shorter half's height the two halves must share
  const STACKED_SIZE_TOL = 2.5; // pt between the halves' median type sizes
  const STACKED_MAX_GAP = 2; // x font size: the largest empty band between two lines of one half

  PDFStudy.slideColumns = { splitPairs, splitStacked, findGutter, LEFT_COLUMN, RIGHT_COLUMN };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideColumns;
  }
})(typeof window !== 'undefined' ? window : globalThis);

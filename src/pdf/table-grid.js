/**
 * Simple Grid Table Detector (100% offline, deterministic).
 * Finds tables in a page's lines and returns them as structures instead of flattened text:
 *   { kind: 'table', header: [cell, ...], rows: [[cell, ...], ...], pageNumber, text, lines: Set<line> }
 *   text: one row per line, cells joined by " | " (header first)
 *
 * Two layouts are recognised:
 *  - fromSegments: book tables whose cells share one baseline and arrive as one line with line.segments
 *    (line-builder.js); 3+ consecutive rows whose cell starts align form a table, the first row is the header.
 *  - fromCells: slide tables whose cells arrive as separate lines (a column per region): a header band of
 *    3+ side-by-side lines defines the columns; lines below are assigned to columns by their centre, wrapped
 *    lines of one cell are joined, and rows are matched by vertical centre against the fullest column.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_ROWS = 3; // header + 2 body rows
  const MIN_COLS = 2;
  const ALIGN = 1.2; // x font size: cell starts of one column line up within this
  const ROW_GAP = 1.6; // x font size: a larger gap between table rows ends the table
  const MIN_FILL = 0.6; // share of grid cells that must hold text
  const MAX_CELL_CHARS = 60; // longer "cells" are prose columns
  const MAX_NOTE_CELL_CHARS = 150; // wrapped explanation column in >= 3-column tables whose other columns stay compact
  const ROW_CELL_AVG = 25; // average cell length of one-baseline rows (two prose columns average far more)
  const STACKED_CELL_AVG = 40; // average cell length of stacked slide cells (wrapped notes are longer)
  const HEADER_MIN_CELLS = 3; // slide header band: at least this many side-by-side lines
  const BAND = 0.4; // x font size: baseline tolerance of one header band
  const WRAP_GAP = 0.45; // x font size: lines of one cell are this close (tighter than rows)
  const CAPTION_RUN_ON = 0.3; // x font size: a line this close under a header-band line continues it

  const plainOf = (l) => String((l && (l.text || l.cleanText)) || '').replace(/\*\*/g, '').trim();
  const mid = (l) => (l.topY + l.bottomY) / 2;
  const cx = (l) => (l.x0 + l.x1) / 2;
  const tableText = (header, rows) => [header, ...rows].map((r) => r.join(' | ')).join('\n');

  function build(header, rows, pageNumber, used, maxAvg) {
    const width = Math.max(header.length, ...rows.map((r) => r.length));
    const pad = (r) => r.concat(Array(Math.max(0, width - r.length)).fill(''));
    const h = pad(header);
    const body = rows.map(pad);
    const cells = body.flat();
    const full = cells.filter(Boolean);
    const filled = full.length / Math.max(1, cells.length);
    const avg = full.reduce((n, c) => n + c.length, 0) / Math.max(1, full.length);
    let cellCap = MAX_CELL_CHARS;
    let avgCap = maxAvg;
    if (width >= 3) {
      const colAvgs = h.map((_, ci) => {
        const vals = body.map((r) => r[ci]).filter(Boolean);
        return vals.length ? vals.reduce((n, v) => n + v.length, 0) / vals.length : 0;
      });
      if (colAvgs.filter((a) => a <= 20).length >= Math.ceil(width / 2)) {
        cellCap = MAX_NOTE_CELL_CHARS;
        avgCap = Math.max(maxAvg, 30);
      }
    }
    if (filled < MIN_FILL || avg > avgCap || cells.some((c) => c.length > cellCap)) return null;
    return { kind: 'table', header: h, rows: body, pageNumber, text: tableText(h, body), lines: used };
  }

  /** Split a multi-column glued segment `seg` at word spaces matching established column starts `colStarts`. */
  function splitGluedSeg(seg, colStarts, fs) {
    const txt = String(seg.text || '').replace(/\*\*/g, '').trim();
    const inner = colStarts.filter((x) => x > seg.x0 + fs * 1.6 && x < seg.x1 - fs * 0.6);
    if (!inner.length || !/\s/.test(txt)) return [seg];
    const perChar = (seg.x1 - seg.x0) / Math.max(1, txt.length);
    const out = [];
    let from = 0;
    let left = seg.x0;
    for (const x of inner) {
      const at = (x - seg.x0) / perChar;
      let cut = -1;
      for (let k = from + 1; k < txt.length - 1; k++) if (txt[k] === ' ' && (cut < 0 || Math.abs(k - at) < Math.abs(cut - at))) cut = k;
      if (cut <= from || Math.abs(cut - at) > 6) return [seg];
      out.push({ text: txt.slice(from, cut).trim(), x0: left, x1: seg.x0 + cut * perChar, fontSize: seg.fontSize });
      from = cut + 1;
      left = x;
    }
    out.push({ text: txt.slice(from).trim(), x0: left, x1: seg.x1, fontSize: seg.fontSize });
    return out.every((p) => p.text) ? out : [seg];
  }

  function matchSegments(segsA, segsB, fs, isHeaderRow) {
    if (!segsA || !segsB || segsA.length !== segsB.length) return false;
    let aligned = 0;
    for (let i = 0; i < segsA.length; i++) {
      const s = segsA[i];
      const t = segsB[i];
      const prevEnd = i > 0 ? Math.max(segsA[i - 1].x1, segsB[i - 1].x1) : -Infinity;
      const nextStart = i + 1 < segsA.length ? Math.min(segsA[i + 1].x0, segsB[i + 1].x0) : Infinity;
      const closeX = Math.abs(s.x0 - t.x0) <= fs * ALIGN || Math.abs(cx(s) - cx(t)) <= fs * ALIGN || Math.abs(s.x1 - t.x1) <= fs * ALIGN;
      const overlap = Math.min(s.x1, t.x1) >= Math.max(s.x0, t.x0) - fs * 0.6 && s.x0 > prevEnd - fs * 0.5 && t.x0 > prevEnd - fs * 0.5;
      const inCorridor = isHeaderRow && segsA.length >= 3 && s.x0 > prevEnd + fs * 0.4 && t.x0 > prevEnd + fs * 0.4 && s.x1 < nextStart - fs * 0.4 && t.x1 < nextStart - fs * 0.4;
      if (closeX || overlap) aligned += 1;
      else if (!inCorridor) return false;
    }
    return isHeaderRow ? aligned >= Math.max(1, segsA.length - 1) : aligned === segsA.length;
  }

  /** Book rows: consecutive lines with 2+ segments whose cell starts align column by column. */
  function fromSegments(lines, pageNumber) {
    const out = [];
    let run = [];
    let colStarts = [];
    let colBounds = [];
    let lastBottom = 0;
    const seedCols = (segs) => {
      colStarts = segs.map((s) => s.x0);
      colBounds = segs.map((s) => ({ x0: s.x0, x1: s.x1, text: s.text.replace(/\*\*/g, '').trim() }));
    };
    const updateCols = (segs) => {
      segs.forEach((s, i) => {
        if (!colBounds[i]) colBounds[i] = { x0: s.x0, x1: s.x1 };
        colBounds[i].x0 = Math.min(colBounds[i].x0, s.x0);
        colBounds[i].x1 = Math.max(colBounds[i].x1, s.x1);
      });
    };
    const flush = (linesList) => {
      // Check if an unsplit header line directly above run (<= fs * ROW_GAP) splits into the run's columns
      if (run.length >= 2 && linesList) {
        const first = run[0].line;
        const firstIdx = linesList.indexOf(first);
        if (firstIdx > 0) {
          const above = linesList[firstIdx - 1];
          const fs = Math.max(above.fontSize || 10, first.fontSize || 10);
          const vGap = first.topY - above.bottomY;
          const abovePlain = plainOf(above);
          const aboveSegs = above.segments || [{ text: abovePlain, x0: above.x0, x1: above.x1, fontSize: above.fontSize }];
          if (above && !/\)\/\(/.test(abovePlain) && vGap >= -2 && vGap <= fs * ROW_GAP && aboveSegs.length < colBounds.length) {
            const split = aboveSegs.flatMap((s) => splitGluedSeg(s, colBounds.map((b) => b.x0), fs));
            if (matchSegments(split, colBounds, fs, true)) {
              run.unshift({ line: above, segs: split.map((s) => s.text.replace(/\*\*/g, '').trim()) });
            }
          }
        }
      }
      if (run.length >= MIN_ROWS && run[0].segs.length >= MIN_COLS) {
        const grid = run.map((r) => r.segs.map((t) => String(t || '').replace(/\*\*/g, '').trim()));
        const eqRows = grid.filter((r) => /^[=≈≤≥≠⇒→]/.test(r[0])).length;
        const brokenHead = grid[0].some((h) => /\)\/\(|[,;]$/.test(h)) ||
          (grid[0].length === 2 && /^[a-z]/.test(grid[0][0]) && grid[0][0].split(/\s+/).length >= 3);
        if (!brokenHead && !/^[=≈≤≥≠⇒→]/.test(grid[0][0]) && eqRows * 2 <= grid.length) {
          const used = new Set(run.flatMap((r) => [r.line, ...(r.extra || [])]));
          const t = build(grid[0], grid.slice(1), pageNumber, used, ROW_CELL_AVG);
          if (t) out.push(t);
        }
      }
      run = [];
      colStarts = [];
      colBounds = [];
      lastBottom = 0;
    };
    for (let idx = 0; idx < lines.length; idx++) {
      const l = lines[idx];
      if (run.length) {
        const prev = run[run.length - 1];
        const fs = Math.max(prev.line.fontSize || 10, l.fontSize || 10);
        const vGap = l.topY - lastBottom;
        if (vGap <= fs * ROW_GAP) {
          // 1) Normal matching segment count (or header->row1 transition)
          let segs = l.segments;
          if (segs && segs.length >= 2 && segs.length < colBounds.length) {
            const reSplit = segs.flatMap((s) => splitGluedSeg(s, colBounds.map((b) => b.x0), fs));
            if (reSplit.length === colBounds.length) segs = reSplit;
          }
          if (segs && matchSegments(colBounds, segs, fs, run.length === 1)) {
            updateCols(segs);
            run.push({ line: l, segs: segs.map((s) => s.text.replace(/\*\*/g, '').trim()) });
            lastBottom = Math.max(lastBottom, l.bottomY);
            continue;
          }
          // 2) Short side-note sitting completely right of the table between two rows (e.g. "Set state")
          const lastCol = colBounds.length - 1;
          if (!l.segments && run.length >= 1 && l.x0 > colBounds[lastCol].x1 + 2 && plainOf(l).length <= 24 && lines[idx + 1] && lines[idx + 1].segments) {
            continue;
          }
          // 3) Wrapped single-column prose continuation inside the last column (e.g. a Comment column)
          if ((!l.segments || l.segments.length === 1) && vGap <= fs * 0.9 && l.x0 >= colBounds[lastCol].x0 - fs * 1.2 && l.x1 <= colBounds[lastCol].x1 + fs * 3) {
            const txt = plainOf(l);
            if (txt) {
              prev.segs[lastCol] = prev.segs[lastCol] ? `${prev.segs[lastCol]} ${txt}` : txt;
              prev.extra = prev.extra || [];
              prev.extra.push(l);
              lastBottom = Math.max(lastBottom, l.bottomY);
              continue;
            }
          }
        }
      }
      flush(lines);
      if (l.segments && l.segments.length >= MIN_COLS) {
        // Re-split row 0 if the immediate next row has more aligned columns
        let initSegs = l.segments;
        const next = lines[idx + 1];
        const fsNext = next ? Math.max(l.fontSize || 10, next.fontSize || 10) : 10;
        if (next && next.segments && next.segments.length > initSegs.length && next.topY - l.bottomY <= fsNext * ROW_GAP) {
          const candidate = initSegs.flatMap((s) => splitGluedSeg(s, next.segments.map((x) => x.x0), fsNext));
          if (candidate.length === next.segments.length && matchSegments(candidate, next.segments, fsNext, true)) {
            initSegs = candidate;
          }
        }
        seedCols(initSegs);
        run = [{ line: l, segs: initSegs.map((s) => s.text.replace(/\*\*/g, '').trim()) }];
        lastBottom = l.bottomY;
      }
    }
    flush(lines);
    return out;
  }

  /** Lines sharing one baseline band that sit side by side (no horizontal overlap). */
  function headerBands(lines) {
    const sorted = lines.slice().sort((a, b) => a.bottomY - b.bottomY);
    const bands = [];
    for (const l of sorted) {
      const b = bands[bands.length - 1];
      if (b && Math.abs(l.bottomY - b[0].bottomY) <= (l.fontSize || 10) * BAND) b.push(l);
      else bands.push([l]);
    }
    return bands.filter((b) => {
      if (b.length < HEADER_MIN_CELLS) return false;
      const xs = b.slice().sort((p, q) => p.x0 - q.x0);
      return xs.every((l, i) => i === 0 || l.x0 >= xs[i - 1].x1 - 2);
    });
  }

  /** Joins wrapped lines of one column into cells: [{ text, top, bottom }] */
  function columnCells(colLines) {
    const cells = [];
    for (const l of colLines.sort((a, b) => a.topY - b.topY)) {
      const c = cells[cells.length - 1];
      if (c && l.topY - c.bottom <= (l.fontSize || 10) * WRAP_GAP) {
        c.text = `${c.text} ${plainOf(l)}`;
        c.bottom = Math.max(c.bottom, l.bottomY);
        c.lines.push(l);
      } else cells.push({ text: plainOf(l), top: l.topY, bottom: l.bottomY, lines: [l] });
    }
    return cells;
  }

  /** A row that line building glued from several cells is split back into one pseudo-line per segment. */
  const explode = (lines) => lines.flatMap((l) => (l.segments
    ? l.segments.map((s) => ({ ...l, text: s.text.replace(/\*\*/g, ''), x0: s.x0, x1: s.x1, segments: undefined, source: l }))
    : [l]));

  /** Left edges shared by 2+ lines (each cell of a left-aligned column starts there), in x order. */
  function columnStarts(lines, tol) {
    const starts = [];
    for (const x of lines.map((l) => l.x0).sort((a, b) => a - b)) {
      const s = starts[starts.length - 1];
      if (s && x - s.x <= tol) s.n += 1;
      else starts.push({ x, n: 1 });
    }
    return starts.filter((s) => s.n >= 2).map((s) => s.x);
  }

  /**
   * A header line that line building ran across two columns ("Assay target Notes" over the "Assay target"
   * and "Notes" columns) is cut where a column of cells below starts inside it, at the nearest word break.
   */
  function splitHeads(head, below, fs) {
    const starts = columnStarts(below, fs * ALIGN);
    return head.flatMap((l) => {
      const text = plainOf(l);
      // A start inside the header that some cell under the header's left part runs across is not a column
      const crossed = (x) => below.some((c) => c.x0 < x - fs && c.x1 > x + fs && c.x1 > l.x0 && c.x0 < l.x1);
      const inner = starts.filter((x) => x > l.x0 + fs * 2 && x < l.x1 - fs && !crossed(x));
      // Two columns under one header line: cells start under the header's left half and again at an inner start
      // (a single column of cells set off-centre under a wide header still fails, since it lacks the second start)
      const own = starts.some((x) => x >= l.x0 - fs * ALIGN && x < inner[0] - fs * 1.5 && !crossed(inner[0]));
      if (!inner.length || !own || !/\s/.test(text)) return [l];
      const perChar = (l.x1 - l.x0) / Math.max(1, text.length);
      const parts = [];
      let from = 0;
      let left = l.x0;
      for (const x of inner) {
        const at = (x - l.x0) / perChar;
        let cut = -1;
        for (let k = from + 1; k < text.length - 1; k++) if (text[k] === ' ' && (cut < 0 || Math.abs(k - at) < Math.abs(cut - at))) cut = k;
        if (cut <= from || Math.abs(cut - at) > 5) return [l]; // no word break near the column start: leave it whole
        parts.push({ ...l, text: text.slice(from, cut).trim(), x0: left, x1: l.x0 + cut * perChar, source: l.source || l });
        from = cut + 1;
        left = x;
      }
      parts.push({ ...l, text: text.slice(from).trim(), x0: left, x1: l.x1, source: l.source || l });
      return parts.filter((p) => p.text);
    });
  }

  /** Slide tables: a header band of 3+ side-by-side lines and the cells stacked under each header. */
  function fromCells(sourceLines, pageNumber) {
    // A link printed under a picture is never a cell
    const lines = explode(sourceLines).filter((l) => l.kind !== 'url' && !/^(?:https?:\/\/|www\.)\S+$/i.test(plainOf(l)));
    for (const band of headerBands(lines)) {
      const bandHead = band.slice().sort((a, b) => a.x0 - b.x0);
      const fs = Math.max(...bandHead.map((l) => l.fontSize || 10));
      const topOfHead = Math.min(...bandHead.map((l) => l.topY));
      const bottomOfHead = Math.max(...bandHead.map((l) => l.bottomY));
      // Rescue a short top-left corner column header ("Cat ID") slightly higher than a wide multi-col header row
      const corner = lines.find((l) => !band.includes(l) && l.x1 < bandHead[0].x0 - fs * 0.3 &&
        l.bottomY >= topOfHead && l.bottomY <= bottomOfHead + 2 && bottomOfHead - l.bottomY <= fs * 1.1 && plainOf(l).length <= 24 &&
        lines.filter((c) => c.topY >= bottomOfHead - 1 && c.x0 >= l.x0 - fs && c.x1 <= l.x1 + fs).length >= 2);
      if (corner) {
        bandHead.unshift(corner);
        band.push(corner);
      }
      // Lines beside the table (a picture's caption or badge on the right, a row-group label on the left) are
      // not cells: a cell starts no further right than the table's right edge, and ends right of its left edge.
      const left = Math.min(...bandHead.map((l) => l.x0)) - fs * 2;
      const right = Math.max(...bandHead.map((l) => l.x1)) + fs;
      const below = lines.filter((l) => !band.includes(l) && l.topY >= bottomOfHead - 1 && l.x0 <= right && l.x1 >= left)
        .sort((a, b) => a.topY - b.topY);
      // Captions set side by side under pictures run on to a second line straight below themselves; a header
      // row stands apart from its first row of cells.
      const runsOn = bandHead.filter((h) => below.some((l) => l.topY - h.bottomY >= -1 && l.topY - h.bottomY < (h.fontSize || 10) * CAPTION_RUN_ON &&
        Math.min(l.x1, h.x1) - Math.max(l.x0, h.x0) > Math.min(l.x1 - l.x0, h.x1 - h.x0) * 0.5));
      if (runsOn.length * 2 >= bandHead.length) continue;
      const head = splitHeads(bandHead, below.filter((l) => l.topY - bottomOfHead < fs * ROW_GAP * 8), fs);
      // Column boundaries: midpoints between neighbouring header centres
      const bounds = head.map((l, i) => (i === 0 ? -Infinity : (cx(head[i - 1]) + cx(l)) / 2)).concat(Infinity);
      const colOf = (l) => bounds.findIndex((b, i) => cx(l) >= b && cx(l) < bounds[i + 1]);
      const body = [];
      let lastBottom = bottomOfHead;
      for (const l of below) {
        if (l.topY - lastBottom > fs * ROW_GAP * 2) break;
        // A line wider than two columns is prose under the table, not a cell
        const spans = bounds.filter((b) => Number.isFinite(b) && b > l.x0 && b < l.x1).length;
        if (spans >= 2) break;
        body.push(l);
        lastBottom = Math.max(lastBottom, l.bottomY);
      }
      const cols = head.map(() => []);
      for (const l of body) {
        const c = colOf(l);
        if (c >= 0) cols[c].push(l);
      }
      const cells = cols.map(columnCells);
      const anchor = cells.reduce((best, c) => (c.length > best.length ? c : best), []);
      if (anchor.length < MIN_ROWS - 1) continue;
      const rows = anchor.map(() => head.map(() => ''));
      cells.forEach((col, ci) => {
        for (const cell of col) {
          const m = (cell.top + cell.bottom) / 2;
          let ri = 0;
          anchor.forEach((a, i) => {
            if (Math.abs((a.top + a.bottom) / 2 - m) < Math.abs((anchor[ri].top + anchor[ri].bottom) / 2 - m)) ri = i;
          });
          rows[ri][ci] = rows[ri][ci] ? `${rows[ri][ci]} ${cell.text}` : cell.text;
        }
      });
      const used = new Set(band.concat(body).map((l) => l.source || l));
      const t = build(head.map(plainOf), rows, pageNumber, used, STACKED_CELL_AVG);
      if (t && head.length >= MIN_COLS) return [t];
    }
    return [];
  }

  /**
   * Book pages: runs standard fromSegments on main flow (including folio-tagged segmented rows), plus
   * coalesces compact table cells that column-layout split across separate column ids on matching baselines.
   */
  function fromPageLines(pageLines, pageNumber) {
    const elig = (pageLines || []).filter((l) => l && !l.isCode && (!l.kind || (l.kind === 'folio' && l.segments && l.segments.length >= 2)));
    const main = elig.filter((l) => !l.isMargin);
    const tables = fromSegments(main, pageNumber);
    const claimed = new Set(tables.flatMap((t) => [...t.lines]));
    // Only consider compact unused cells (<= 32 chars) across nearby split columns (gap <= 36pt)
    const unused = elig.filter((l) => !claimed.has(l) && plainOf(l).length <= 32);
    const byY = unused.slice().sort((a, b) => a.bottomY - b.bottomY || a.x0 - b.x0);
    const bands = [];
    for (const l of byY) {
      const b = bands[bands.length - 1];
      const fs = Math.min(l.fontSize || 10, b ? b[0].fontSize || 10 : 10);
      if (b && Math.abs(l.bottomY - b[0].bottomY) <= fs * 0.4 && Math.abs((l.fontSize || 10) - (b[0].fontSize || 10)) <= 1.2) b.push(l);
      else bands.push([l]);
    }
    const virtual = [];
    for (const b of bands) {
      if (b.length < 2 && !(b[0] && b[0].segments)) continue;
      const xs = b.slice().sort((p, q) => p.x0 - q.x0);
      // Skip unrelated margin notes far away (> 36pt from nearest non-margin sibling in band)
      const kept = xs.filter((l, i) => !l.isMargin || xs.some((o, j) => j !== i && !o.isMargin &&
        Math.max(o.x0 - l.x1, l.x0 - o.x1) <= 36));
      if (!kept.length) continue;
      if (kept.length === 1 && kept[0].segments) {
        virtual.push(kept[0]);
        continue;
      }
      if (kept.length < 2) continue;
      const distinctCols = new Set(kept.map((l) => l.column)).size >= 2;
      if (!distinctCols) continue;
      const closeCells = kept.every((l, i) => i === 0 || (l.x0 >= kept[i - 1].x1 - 2 && l.x0 - kept[i - 1].x1 <= 36));
      if (!closeCells) continue;
      const segs = kept.flatMap((l) => l.segments || [{ text: plainOf(l), x0: l.x0, x1: l.x1, fontSize: l.fontSize }]);
      if (segs.length < 2) continue;
      const f = kept[0];
      virtual.push({
        ...f,
        x0: kept[0].x0,
        x1: kept[kept.length - 1].x1,
        topY: Math.min(...kept.map((l) => l.topY)),
        bottomY: kept.reduce((s, l) => s + l.bottomY, 0) / kept.length,
        segments: segs,
        __sources: kept,
      });
    }
    for (const t of fromSegments(virtual, pageNumber)) {
      // Never mistake 2-col prose fragment wraps or isolated code punctuation for a split-column table
      if (t.header.some((h) => /[,;{}]$|^[a-z]/.test(h) && t.header.length === 2)) continue;
      const real = new Set();
      for (const l of t.lines) {
        for (const orig of l.__sources || [l]) real.add(orig);
      }
      if ([...real].some((l) => claimed.has(l))) continue;
      if (t.lines.size >= MIN_ROWS && [...real].some((l) => !claimed.has(l))) {
        t.lines = real;
        real.forEach((l) => claimed.add(l));
        tables.push(t);
      }
    }
    return tables;
  }

  /** Public shape without the internal line set. */
  const publicTable = (t) => ({ kind: t.kind, header: t.header, rows: t.rows, pageNumber: t.pageNumber, text: t.text });

  PDFStudy.tableGrid = { fromSegments, fromCells, fromPageLines, publicTable, tableText };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.tableGrid;
  }
})(typeof window !== 'undefined' ? window : globalThis);

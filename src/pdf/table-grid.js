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
    if (filled < MIN_FILL || avg > maxAvg || cells.some((c) => c.length > MAX_CELL_CHARS)) return null;
    return { kind: 'table', header: h, rows: body, pageNumber, text: tableText(h, body), lines: used };
  }

  /** Book rows: consecutive lines with 2+ segments whose cell starts align column by column. */
  function fromSegments(lines, pageNumber) {
    const out = [];
    let run = [];
    const fits = (a, b) => {
      if (!a.segments || !b.segments || a.segments.length !== b.segments.length) return false;
      const fs = Math.max(a.fontSize || 10, b.fontSize || 10);
      if (b.topY - a.bottomY > fs * ROW_GAP) return false;
      return a.segments.every((s, i) => Math.abs(s.x0 - b.segments[i].x0) <= fs * ALIGN || Math.abs(cx(s) - cx(b.segments[i])) <= fs * ALIGN);
    };
    const flush = () => {
      if (run.length >= MIN_ROWS && run[0].segments.length >= MIN_COLS) {
        const grid = run.map((l) => l.segments.map((s) => s.text.replace(/\*\*/g, '').trim()));
        const t = build(grid[0], grid.slice(1), pageNumber, new Set(run), ROW_CELL_AVG);
        if (t) out.push(t);
      }
      run = [];
    };
    for (const l of lines) {
      if (run.length && fits(run[run.length - 1], l)) run.push(l);
      else {
        flush();
        if (l.segments && l.segments.length >= MIN_COLS) run = [l];
      }
    }
    flush();
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
      // Two columns under one header line: cells start at the header's own left edge and again inside it
      // (a single column of cells set off-centre under a wide header is not a second column)
      const own = starts.some((x) => Math.abs(x - l.x0) <= fs * ALIGN);
      if (!inner.length || !own || !/\s/.test(text)) return [l];
      const perChar = (l.x1 - l.x0) / Math.max(1, text.length);
      const parts = [];
      let from = 0;
      let left = l.x0;
      for (const x of inner) {
        const at = (x - l.x0) / perChar;
        let cut = -1;
        for (let k = from + 1; k < text.length - 1; k++) if (text[k] === ' ' && (cut < 0 || Math.abs(k - at) < Math.abs(cut - at))) cut = k;
        if (cut <= from || Math.abs(cut - at) > 4) return [l]; // no word break near the column start: leave it whole
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
      const bottomOfHead = Math.max(...bandHead.map((l) => l.bottomY));
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

  /** Public shape without the internal line set. */
  const publicTable = (t) => ({ kind: t.kind, header: t.header, rows: t.rows, pageNumber: t.pageNumber, text: t.text });

  PDFStudy.tableGrid = { fromSegments, fromCells, publicTable, tableText };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.tableGrid;
  }
})(typeof window !== 'undefined' ? window : globalThis);

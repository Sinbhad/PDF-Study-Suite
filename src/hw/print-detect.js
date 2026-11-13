/**
 * Typeset print versus handwriting, from the shapes of the ink alone (no model). DOM-free.
 * Printed text is made of separate letters that sit on a ruler-straight baseline and reach one of two heights
 * (x-height, capital height); joined-up handwriting has wide linked strokes, a wandering baseline and uneven tops.
 *   measure(strokes, box)  -> { glyphs, size, print } for one line box and the strokes it owns
 *   review(lines, ctx)     -> { lines, letterhead, printed }
 * `printed` is true when most of the page is typeset (a scanned book page): everything is read, and the caller may
 * allow more pieces. Otherwise a printed letterhead (or printed footer) on a handwritten page is taken out: a run
 * of print-like lines at the very top or bottom that includes small print. A lone print-like title is kept, so a
 * neatly hand-printed heading is never lost.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const WIDE = 3; // a stroke wider than this many letter heights is joined-up writing
  const ON_LINE = 0.12; // how far (in letter heights) a letter may sit off the fitted baseline or top line
  const LEVEL = 0.8; // share of letters that must sit on the baseline
  const TOPS = 0.75; // share of letters whose top is on one of the two top lines
  const DENSE = 0.6; // letters per letter-height of line width (print is about 1, cursive under 0.5)
  const MIN_GLYPHS = 5;
  const PAGE_SHARE = 0.6; // share of readable boxes that must be print for a "printed page"
  const SMALL = 0.6; // small print: letters under this share of the handwriting's letter height
  const ZONE = 0.3; // a letterhead lies in the top (footer: bottom) share of the page

  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  /** Robust straight line through (x, y) points: median of pairwise slopes, then median offset. */
  function fitLine(pts, minDx) {
    const slopes = [];
    const step = Math.max(1, pts.length >> 4);
    for (let a = 0; a < pts.length; a++) {
      for (let b = a + 1; b < pts.length; b += step) {
        const dx = pts[b][0] - pts[a][0];
        if (Math.abs(dx) > minDx) slopes.push((pts[b][1] - pts[a][1]) / dx);
      }
    }
    const m = median(slopes);
    return { m, c: median(pts.map((p) => p[1] - m * p[0])) };
  }

  /** One row of letters: are they level, of regular height and closely set? */
  function rowIsPrint(row, size) {
    if (row.length < 4) return false;
    const base = fitLine(row.map((g) => [(g.x0 + g.x1) / 2, g.y1]), 2 * size);
    const tol = ON_LINE * size;
    const level = row.filter((g) => Math.abs(g.y1 - base.m * (g.x0 + g.x1) / 2 - base.c) <= tol).length / row.length;
    if (level < LEVEL) return false;
    const rise = row.map((g) => base.m * (g.x0 + g.x1) / 2 + base.c - g.y0).sort((p, q) => p - q);
    let best = 0;
    for (let a = 0; a < rise.length; a++) {
      for (let b = a; b < rise.length; b++) {
        let n = 0;
        for (const r of rise) if (Math.abs(r - rise[a]) <= tol || Math.abs(r - rise[b]) <= tol) n++;
        if (n > best) best = n;
      }
    }
    if (best / rise.length < TOPS) return false;
    const x0 = Math.min(...row.map((g) => g.x0));
    const x1 = Math.max(...row.map((g) => g.x1));
    return row.length / Math.max(1, (x1 - x0) / size) >= DENSE;
  }

  /**
   * @param {{x0:number,y0:number,x1:number,y1:number}[]} strokes connected strokes owned by the box
   * @returns {{glyphs:number, size:number, print:boolean}} size = typical letter height in px
   */
  function measure(strokes, box) {
    const size = median(strokes.map((s) => s.y1 - s.y0));
    const glyphs = strokes.filter((s) => s.y1 - s.y0 >= 0.5 * size);
    const out = { glyphs: glyphs.length, size, print: false };
    if (glyphs.length < MIN_GLYPHS || size < 3) return out;
    const wide = glyphs.filter((g) => g.x1 - g.x0 > WIDE * size);
    if (wide.reduce((n, g) => n + g.x1 - g.x0, 0) > 0.1 * box.w) return out;
    // small print set in two or three rows inside one box: judge each row on its own baseline
    const rows = [];
    const sorted = glyphs.filter((g) => !wide.includes(g)).sort((p, q) => p.y1 - q.y1);
    const stacked = box.h > 2.2 * size;
    for (const g of sorted) {
      const row = rows[rows.length - 1];
      if (row && (!stacked || g.y1 - row[row.length - 1].y1 <= 0.6 * size)) row.push(g); else rows.push([g]);
    }
    const inPrint = rows.filter((r) => rowIsPrint(r, size)).reduce((n, r) => n + r.length, 0);
    out.print = inPrint >= MIN_GLYPHS && inPrint >= 0.8 * sorted.length;
    return out;
  }

  /**
   * Indices of a letterhead run at the start of `order` (line indices): print-like lines inside the zone, with any
   * small-lettered lines among them (small print the strict test missed, say with a staple through it). The run
   * ends at the first ordinary handwritten line and at its own last print-like line, and must hold small print.
   */
  function runOf(order, info, inZone, bodySize) {
    const run = [];
    let last = 0;
    for (const i of order) {
      const f = info[i];
      if (!inZone(f)) break;
      const small = f.size > 0 && f.size <= SMALL * bodySize;
      if (f.hand && !small) break;
      if (f.print) last = run.push(i); else if (f.hand) run.push(i);
      // boxes too small to judge (a lone mark) neither join nor end the run
    }
    run.length = last;
    return run.some((i) => info[i].size <= SMALL * bodySize) ? run : [];
  }

  /**
   * @param {{index:number, box:object, regions:{box:object}[]}[]} lines reading-order lines from the page plan
   * @param {{comps:object[], owner:Int32Array, regionOf:Map, height:number}} ctx strokes, their owning box, page height
   * @returns {{lines:object[], letterhead:object[], printed:boolean}}
   */
  function review(lines, ctx) {
    const byBox = new Map();
    ctx.comps.forEach((c, k) => {
      if (!c.keep || ctx.owner[k] < 0) return;
      if (!byBox.has(ctx.owner[k])) byBox.set(ctx.owner[k], []);
      byBox.get(ctx.owner[k]).push(c);
    });
    let judged = 0; let printBoxes = 0;
    const handSizes = [];
    const info = lines.map((line) => {
      const ms = line.regions.map((r) => {
        const b = r.box;
        return measure(byBox.get(ctx.regionOf.get(`${b.x},${b.y},${b.w},${b.h}`)) || [], b);
      });
      const able = ms.filter((m) => m.glyphs >= MIN_GLYPHS);
      judged += able.length;
      printBoxes += able.filter((m) => m.print).length;
      const print = able.length > 0 && able.every((m) => m.print);
      const hand = able.some((m) => !m.print);
      if (hand) handSizes.push(...able.filter((m) => !m.print).map((m) => m.size));
      return { print, hand, size: median(able.map((m) => m.size)), y0: line.box.y, y1: line.box.y + line.box.h };
    });
    const printed = judged >= 3 && printBoxes >= PAGE_SHARE * judged;
    const out = { lines, letterhead: [], printed };
    if (printed || !handSizes.length || !printBoxes) return out;
    const bodySize = median(handSizes);
    const idx = lines.map((_, i) => i);
    const drop = new Set([
      ...runOf(idx, info, (f) => f.y1 <= ZONE * ctx.height, bodySize),
      ...runOf(idx.slice().reverse(), info, (f) => f.y0 >= (1 - ZONE) * ctx.height, bodySize),
    ]);
    if (!drop.size) return out;
    out.letterhead = lines.filter((_, i) => drop.has(i)).map((l) => l.box);
    out.lines = lines.filter((_, i) => !drop.has(i)).map((l, index) => Object.assign({}, l, { index }));
    return out;
  }

  PDFStudy.hwPrintDetect = { measure, review, fitLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPrintDetect;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

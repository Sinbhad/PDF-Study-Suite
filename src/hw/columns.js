/**
 * Reading order of the line boxes on a page: columns first, then lines, then pieces left to right. DOM-free.
 *   lines(boxes, lineH) -> [{ index, box, regions: [{ box }] }]
 * A page set in two columns of running text is read down the left column, then down the right one. A column
 * gutter is a tall empty band with at least MIN_ROWS wide lines on each side; anything crossing it (a title,
 * a full-width paragraph) is read in its own place and splits the page into bands above and below.
 * Short pieces side by side (table cells, a term and its meaning, labels on a drawing) stay one line read
 * across, because their boxes are too narrow to count as columns of text.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_GUTTER = 1.5; // narrowest gutter, in line heights (word gaps are well under one)
  const MIN_ROWS = 4; // lines needed on each side
  const MIN_WIDE = 8; // typical width of a column's lines, in line heights (three or four words)
  const BAND = 0.2; // a gutter lies in the middle 60% of the written width
  const MAX_DEPTH = 1; // a column may itself be split once (three or four columns)

  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  /** Widest nearly empty vertical band through the middle of the boxes, or null. */
  function findGutter(boxes, lineH) {
    const x0 = Math.min(...boxes.map((b) => b.x));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const ext = x1 - x0;
    if (boxes.length < 2 * MIN_ROWS || ext < 2 * MIN_WIDE * lineH) return null;
    const cover = new Int32Array(ext + 1);
    for (const b of boxes) for (let x = b.x - x0; x < b.x + b.w - x0; x++) cover[x]++;
    // the emptiest place in the middle band: titles and full-width paragraphs may run across it, most lines may not
    const lo = Math.floor(BAND * ext);
    const hi = Math.ceil((1 - BAND) * ext);
    let floor = Infinity;
    for (let x = lo; x < hi; x++) floor = Math.min(floor, cover[x]);
    if (floor > 0.4 * boxes.length) return null;
    const limit = floor + Math.max(1, Math.floor(0.05 * boxes.length));
    let best = null;
    for (let x = lo; x < hi;) {
      if (cover[x] > limit) { x++; continue; }
      let e = x;
      while (e < hi && cover[e] <= limit) e++;
      if (e - x >= MIN_GUTTER * lineH && (!best || e - x > best.g1 - best.g0)) best = { g0: x0 + x, g1: x0 + e };
      x = e;
    }
    return best;
  }

  const extentY = (list) => [Math.min(...list.map((b) => b.y)), Math.max(...list.map((b) => b.y + b.h))];

  /** Two real columns of text: enough wide lines on each side, standing side by side. */
  function sideBySide(left, right, lineH) {
    if (left.length < MIN_ROWS || right.length < MIN_ROWS) return false;
    if (median(left.map((b) => b.w)) < MIN_WIDE * lineH || median(right.map((b) => b.w)) < MIN_WIDE * lineH) return false;
    const [l0, l1] = extentY(left);
    const [r0, r1] = extentY(right);
    return Math.min(l1, r1) - Math.max(l0, r0) >= 0.5 * Math.min(l1 - l0, r1 - r0);
  }

  /** Boxes in reading-order blocks: [[box...], ...]; one block when the page has no columns. */
  function blocks(boxes, lineH, depth) {
    const g = boxes.length ? findGutter(boxes, lineH) : null;
    if (!g) return [boxes];
    const out = [];
    let plain = []; // boxes read across, as one block
    let zone = [];
    const flush = () => {
      const left = zone.filter((b) => b.x + b.w <= g.g0 + 2);
      const right = zone.filter((b) => b.x >= g.g1 - 2);
      if (sideBySide(left, right, lineH)) {
        if (plain.length) out.push(plain);
        plain = [];
        for (const side of [left, right]) out.push(...(depth < MAX_DEPTH ? blocks(side, lineH, depth + 1) : [side]));
      } else plain.push(...zone);
      zone = [];
    };
    for (const b of boxes.slice().sort((p, q) => p.y - q.y)) {
      const crosses = b.x + b.w > g.g0 + 2 && b.x < g.g1 - 2;
      if (!crosses) { zone.push(b); continue; }
      flush();
      plain.push(b);
    }
    flush();
    if (plain.length) out.push(plain);
    return out;
  }

  /** Boxes side by side (sharing most of their height) form one line; lines top to bottom, pieces left to right. */
  function group(boxes) {
    const rows = [];
    for (const b of boxes.slice().sort((p, q) => p.y - q.y)) {
      const row = rows.find((l) => {
        const ov = Math.min(l.y1, b.y + b.h) - Math.max(l.y0, b.y);
        return ov >= 0.5 * Math.min(l.y1 - l.y0, b.h) && l.boxes.every((o) => o.x + o.w <= b.x || b.x + b.w <= o.x);
      });
      if (row) { row.boxes.push(b); row.y0 = Math.min(row.y0, b.y); row.y1 = Math.max(row.y1, b.y + b.h); } else rows.push({ y0: b.y, y1: b.y + b.h, boxes: [b] });
    }
    rows.sort((p, q) => p.y0 - q.y0);
    return rows.map((l) => {
      const regs = l.boxes.sort((p, q) => p.x - q.x);
      const x0 = Math.min(...regs.map((r) => r.x)); const x1 = Math.max(...regs.map((r) => r.x + r.w));
      const y0 = Math.min(...regs.map((r) => r.y)); const y1 = Math.max(...regs.map((r) => r.y + r.h));
      return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, regions: regs.map((r) => ({ box: { x: r.x, y: r.y, w: r.w, h: r.h } })) };
    });
  }

  /**
   * @param {{x:number,y:number,w:number,h:number}[]} boxes final boxes to read
   * @param {number} lineH height of one written line in px
   * @returns {{index:number, column:number, box:object, regions:{box:object}[]}[]} column = block number
   */
  function lines(boxes, lineH) {
    const out = [];
    blocks(boxes, Math.max(4, lineH), 0).forEach((block, column) => {
      for (const l of group(block)) out.push(Object.assign({ index: out.length, column }, l));
    });
    return out;
  }

  PDFStudy.hwColumns = { lines, blocks, group, findGutter };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwColumns;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

/**
 * Where a page's images, painted paths and annotation ink sit, so ink-detect.js can tell a picture or
 * handwriting next to typed text from a background or a table rule. Pure functions, no DOM.
 *   measure(opList, OPS, baseTransform) -> { images: [box], paths: [box], pathsMeasured }
 *   inkAnnotations(annotations, baseTransform) -> { strokes, boxes: [box] }
 * Boxes are { x, y, w, h } in the same top-left page coordinates as the page lines when baseTransform is
 * the PDF.js viewport transform at scale 1 (without it they stay in PDF user space).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const MAX_PATH_BOXES = 6000; // enough to judge a page; a dense drawing is not stored stroke by stroke

  const PAINT_NAMES = ['stroke', 'closeStroke', 'fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke'];
  const IMAGE_NAMES = ['paintImageXObject', 'paintInlineImageXObject', 'paintImageMaskXObject', 'paintJpegXObject'];

  const isMatrix = (m) => Array.isArray(m) || (m && typeof m.length === 'number' && m.length >= 6);

  /** a then b: the matrix that applies `b` first and `a` second (PDF "cm" order). */
  function multiply(a, b) {
    return [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  }

  /** Bounding box of the rectangle (x0, y0)-(x1, y1) after the matrix. */
  function boxOf(m, x0, y0, x1, y1) {
    const xs = [];
    const ys = [];
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
  }

  const finite = (box) => [box.x, box.y, box.w, box.h].every(Number.isFinite);

  function idSet(OPS, names) {
    const set = new Set();
    for (const n of names) {
      if (typeof OPS[n] === 'number') set.add(OPS[n]);
    }
    return set;
  }

  /**
   * Walks the operator list keeping the current transform, and records the page box of every image and of
   * every painted path. PDF.js 3 gives each constructPath its bounds as [minX, maxX, minY, maxY] in the third
   * argument; a build without them yields no path boxes (pathsMeasured false) and the caller must not read
   * "no paths" into that.
   */
  function measure(opList, OPS, baseTransform) {
    const out = { images: [], paths: [], pathsMeasured: false };
    if (!opList || !Array.isArray(opList.fnArray) || !OPS) return out;
    const paints = idSet(OPS, PAINT_NAMES);
    const images = idSet(OPS, IMAGE_NAMES);
    const fns = opList.fnArray;
    const args = opList.argsArray || [];
    const stack = [];
    let ctm = isMatrix(baseTransform) ? Array.from(baseTransform).slice(0, 6) : IDENTITY.slice();
    let pending = null; // bounds of the path being built, in the transform it was built under

    for (let i = 0; i < fns.length; i++) {
      const fn = fns[i];
      const a = args[i] || [];
      if (fn === OPS.save) {
        stack.push(ctm);
      } else if (fn === OPS.restore) {
        if (stack.length) ctm = stack.pop();
      } else if (fn === OPS.transform) {
        if (a.length >= 6) ctm = multiply(ctm, a);
      } else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (isMatrix(a[0])) ctm = multiply(ctm, a[0]);
      } else if (fn === OPS.paintFormXObjectEnd) {
        if (stack.length) ctm = stack.pop();
      } else if (fn === OPS.beginAnnotation) {
        stack.push(ctm);
        if (isMatrix(a[2])) ctm = multiply(ctm, a[2]);
        if (isMatrix(a[3])) ctm = multiply(ctm, a[3]);
      } else if (fn === OPS.endAnnotation) {
        if (stack.length) ctm = stack.pop();
      } else if (fn === OPS.constructPath) {
        const mm = a[2];
        pending = mm && mm.length >= 4 ? boxOf(ctm, mm[0], mm[2], mm[1], mm[3]) : null;
        if (pending) out.pathsMeasured = true;
      } else if (paints.has(fn)) {
        if (pending && finite(pending) && out.paths.length < MAX_PATH_BOXES) out.paths.push(pending);
        pending = null;
      } else if (fn === OPS.endPath) {
        pending = null;
      } else if (images.has(fn)) {
        const box = boxOf(ctm, 0, 0, 1, 1);
        if (finite(box)) out.images.push(box);
      }
    }
    return out;
  }

  /**
   * Freehand ink stored as annotations (Apple Pencil markup, "I wrote on the PDF" exports): PDF.js
   * getAnnotations() entries with subtype 'Ink'. Highlights, links and typed notes are not ink.
   */
  function inkAnnotations(annotations, baseTransform) {
    const out = { strokes: 0, boxes: [] };
    const m = isMatrix(baseTransform) ? baseTransform : IDENTITY;
    for (const an of annotations || []) {
      if (!an || an.subtype !== 'Ink' || an.hidden) continue;
      const lists = Array.isArray(an.inkLists) ? an.inkLists.length : 0;
      out.strokes += Math.max(1, lists);
      const r = an.rect;
      if (r && r.length >= 4) {
        const box = boxOf(m, r[0], r[1], r[2], r[3]);
        if (finite(box)) out.boxes.push(box);
      }
    }
    return out;
  }

  /** Area of the overlap of two boxes. */
  function overlap(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** Box of a page line (line-builder.js shape). */
  const lineBox = (l) => ({ x: l.x0, y: l.topY, w: Math.max(0, l.x1 - l.x0), h: Math.max(0, l.bottomY - l.topY) });

  PDFStudy.inkGeometry = { measure, inkAnnotations, overlap, lineBox, boxOf, multiply };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.inkGeometry;
  }
})(typeof window !== 'undefined' ? window : globalThis);

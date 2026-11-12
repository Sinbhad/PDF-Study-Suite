/**
 * Horizontal Rule Extractor (fraction bars, vinculums) from a PDF.js operator list (100% Offline, Non-AI).
 * Textbook fraction bars are vector strokes / thin filled rectangles, never text glyphs, so the 2D formula
 * builder needs them from page.getOperatorList(). Returns rules in viewport space (scale 1, origin top-left):
 *   [{ x0, x1, y }]  (y = vertical centre of the rule, grows downward like line.topY / baselineY)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_W = 2.5; // pt: shorter strokes are tick marks / glyph parts
  const MAX_W = 320; // pt: longer ones are page rules / box borders
  const MAX_H = 1.6; // pt: thicker "lines" are boxes or shading

  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /** Collects axis-aligned horizontal segments of one constructPath (moveTo/lineTo pairs and rectangles). */
  function pathSegments(OPS, ops, args, ctm, out) {
    let k = 0;
    let cur = null;
    for (const op of ops) {
      if (op === OPS.moveTo) {
        cur = apply(ctm, args[k], args[k + 1]);
        k += 2;
      } else if (op === OPS.lineTo) {
        const p = apply(ctm, args[k], args[k + 1]);
        if (cur) out.push({ ax: cur[0], ay: cur[1], bx: p[0], by: p[1] });
        cur = p;
        k += 2;
      } else if (op === OPS.rectangle) {
        const [x, y, w, h] = args.slice(k, k + 4);
        const a = apply(ctm, x, y);
        const b = apply(ctm, x + w, y + h);
        out.push({ ax: a[0], ay: a[1], bx: b[0], by: b[1], rect: true });
        k += 4;
      } else if (op === OPS.curveTo) {
        k += 6;
        cur = apply(ctm, args[k - 2], args[k - 1]);
      } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
        k += 4;
        cur = apply(ctm, args[k - 2], args[k - 1]);
      }
    }
  }

  /**
   * opList: result of page.getOperatorList(); OPS: pdfjsLib.OPS; viewBox: page.view ([x0, y0, x1, y1]).
   * Only stroked or filled paths count; clipping paths and invisible paths are ignored.
   */
  function extractRules(opList, OPS, viewBox) {
    if (!opList || !OPS || !opList.fnArray) return [];
    const vb = viewBox || [0, 0, 612, 792];
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let lineWidth = 1;
    let pending = [];
    const rules = [];
    const paintOps = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke]);
    const { fnArray, argsArray } = opList;
    for (let i = 0; i < fnArray.length; i++) {
      const fn = fnArray[i];
      const a = argsArray[i];
      if (fn === OPS.save) stack.push({ ctm, lineWidth });
      else if (fn === OPS.restore) ({ ctm, lineWidth } = stack.pop() || { ctm, lineWidth });
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push({ ctm, lineWidth });
        if (a && Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0]);
      } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, lineWidth } = stack.pop() || { ctm, lineWidth });
      else if (fn === OPS.setLineWidth) lineWidth = a[0];
      else if (fn === OPS.constructPath) {
        const segs = [];
        pathSegments(OPS, a[0], a[1], ctm, segs);
        pending = pending.concat(segs);
      } else if (paintOps.has(fn)) {
        const scale = Math.hypot(ctm[1], ctm[3]) || 1;
        for (const s of pending) addRule(rules, s, s.rect ? 0 : lineWidth * scale, vb);
        pending = [];
      } else if (fn === OPS.endPath) pending = [];
    }
    return dedupe(rules);
  }

  function addRule(rules, s, strokeW, vb) {
    const x0 = Math.min(s.ax, s.bx) - vb[0];
    const x1 = Math.max(s.ax, s.bx) - vb[0];
    const h = Math.abs(s.ay - s.by) + strokeW;
    const w = x1 - x0;
    if (w < MIN_W || w > MAX_W || h > MAX_H || h <= 0) return;
    rules.push({ x0, x1, y: vb[3] - (s.ay + s.by) / 2 });
  }

  function dedupe(rules) {
    const out = [];
    for (const r of rules.sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
      const twin = out.find((o) => Math.abs(o.y - r.y) < 0.6 && Math.abs(o.x0 - r.x0) < 0.6 && Math.abs(o.x1 - r.x1) < 0.6);
      if (!twin) out.push(r);
    }
    return out;
  }

  PDFStudy.pageRules = { extractRules };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.pageRules;
  }
})(typeof window !== 'undefined' ? window : globalThis);

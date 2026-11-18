/**
 * Invisible Text Marker: finds text drawn with PDF text rendering mode 3 ("neither fill nor stroke") on
 * pages that also carry visible text, and marks the matching PDF.js text items as annotations.
 *
 * Why: notes apps that let a student write on lecture slides store their own handwriting recognition as an
 * invisible text layer over the pen strokes (mode 3, its own fonts, outside the slide's marked content).
 * PDF.js returns it in getTextContent() exactly like the slide's typed text, so without this marker the
 * recognised scribbles ("zyme disease") are merged into slide titles and bullets.
 *
 * A page whose text is ALL invisible is a scanned page with an OCR layer: that text is the page's content
 * and is left alone (MIN_VISIBLE_GLYPHS below decides "the page also has visible text").
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // PDF 32000-1 table 106: 3 = invisible; 7 = add to clipping path only (also never painted)
  const INVISIBLE_MODES = new Set([3, 7]);
  // A page needs at least this many visible, non-space glyphs before its invisible text counts as an overlay
  const MIN_VISIBLE_GLYPHS = 8;
  // Item origin vs. hidden glyph origin, in points: the same glyph seen twice lands within rounding
  const ORIGIN_TOLERANCE = 1.5;

  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];

  /**
   * Walks the operator list and returns every painted or invisible glyph origin per font:
   * { visibleGlyphs, hiddenGlyphs, fonts: Map fontId -> { visible, hidden, hiddenOrigins: [[x, y]] } }.
   */
  function survey(opList, OPS) {
    const out = { visibleGlyphs: 0, hiddenGlyphs: 0, fonts: new Map() };
    if (!opList || !OPS || !opList.fnArray) return out;
    const stack = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    let mode = 0;
    let tm = [1, 0, 0, 1, 0, 0];
    let tlm = [1, 0, 0, 1, 0, 0];
    let fontId = null;
    let fontSize = 10;
    let leading = 0;
    let charSpace = 0;
    let wordSpace = 0;
    let hScale = 1;
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const a = opList.argsArray[i];
      if (fn === OPS.save) stack.push({ ctm, mode });
      else if (fn === OPS.restore) ({ ctm, mode } = stack.pop() || { ctm, mode });
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push({ ctm, mode });
        if (a && Array.isArray(a[0]) && a[0].length === 6) ctm = mul(ctm, a[0]);
      } else if (fn === OPS.paintFormXObjectEnd) ({ ctm, mode } = stack.pop() || { ctm, mode });
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.setTextRenderingMode) mode = a[0];
      else if (fn === OPS.beginText) tm = tlm = [1, 0, 0, 1, 0, 0];
      else if (fn === OPS.setLeading) leading = a[0];
      else if (fn === OPS.setCharSpacing) charSpace = a[0];
      else if (fn === OPS.setWordSpacing) wordSpace = a[0];
      else if (fn === OPS.setHScale) hScale = a[0] / 100;
      else if (fn === OPS.setFont) [fontId, fontSize] = a;
      else if (fn === OPS.setTextMatrix) tm = tlm = a.slice();
      else if (fn === OPS.moveText) tm = tlm = mul(tlm, [1, 0, 0, 1, a[0], a[1]]);
      else if (fn === OPS.setLeadingMoveText) {
        leading = -a[1];
        tm = tlm = mul(tlm, [1, 0, 0, 1, a[0], a[1]]);
      } else if (fn === OPS.nextLine) tm = tlm = mul(tlm, [1, 0, 0, 1, 0, -leading]);
      else if ((fn === OPS.showText || fn === OPS.showSpacedText) && fontId && a && Array.isArray(a[0])) {
        const hidden = INVISIBLE_MODES.has(mode);
        if (!out.fonts.has(fontId)) out.fonts.set(fontId, { visible: 0, hidden: 0, hiddenOrigins: [] });
        const rec = out.fonts.get(fontId);
        for (const g of a[0]) {
          if (typeof g === 'number') {
            tm = mul(tm, [1, 0, 0, 1, (-g / 1000) * fontSize * hScale, 0]);
            continue;
          }
          if (!g || typeof g !== 'object') continue;
          const isInk = Boolean(g.unicode && g.unicode.trim());
          if (isInk && hidden) {
            const m = mul(ctm, tm);
            rec.hidden += 1;
            out.hiddenGlyphs += 1;
            rec.hiddenOrigins.push([m[4], m[5]]);
          } else if (isInk) {
            rec.visible += 1;
            out.visibleGlyphs += 1;
          }
          const spacing = charSpace + (g.isSpace ? wordSpace : 0);
          tm = mul(tm, [1, 0, 0, 1, (((g.width || 0) / 1000) * fontSize + spacing) * hScale, 0]);
        }
      }
    }
    return out;
  }

  /** True when the item's origin coincides with an invisible glyph of the same font. */
  function atHiddenOrigin(item, rec) {
    const tr = item.transform;
    if (!tr || !rec.hiddenOrigins.length) return false;
    return rec.hiddenOrigins.some(([x, y]) => Math.abs(x - tr[4]) <= ORIGIN_TOLERANCE && Math.abs(y - tr[5]) <= ORIGIN_TOLERANCE);
  }

  /**
   * Font family without the 6-letter subset tag and variation/style suffixes:
   * "AAAAAJ+.SFUI-Regular_wdth_opsz123B78" -> ".SFUI". Notes apps embed one subset per stroke group, so
   * the full names differ on every page while the family stays the same.
   */
  function fontFamily(realName) {
    return String(realName || '').replace(/^[A-Z]{6}\+/, '').split(/[-_,]/)[0];
  }

  /**
   * Returns the items with `isAnnotation: true` on each invisible overlay item (copies; the input is untouched).
   * A font drawn only invisibly marks all its items; a font drawn both ways marks items by glyph origin.
   *
   * opts.fontNames: Map fontId -> real font name; opts.overlayFamilies: a Set shared across one document's
   * pages. Families seen as an overlay on a page with visible text are remembered there, so a slide whose
   * only text is the same app's invisible notes (the slide itself is a picture) is also treated as notes,
   * while a scanned page's OCR layer in another font family stays content.
   */
  function markItems(items, opList, OPS, opts = {}) {
    const s = survey(opList, OPS);
    if (!items || !s.hiddenGlyphs) return items || [];
    const families = opts.overlayFamilies || null;
    const nameOf = (id) => (opts.fontNames && opts.fontNames.get(id)) || id;
    const isOverlayPage = s.visibleGlyphs >= MIN_VISIBLE_GLYPHS;
    if (isOverlayPage && families) {
      for (const [id, rec] of s.fonts) if (rec.hidden && !rec.visible) families.add(fontFamily(nameOf(id)));
    }
    const knownOverlay = (id) => Boolean(families && families.has(fontFamily(nameOf(id))));
    if (!isOverlayPage && !items.some((it) => it && it.fontName && knownOverlay(it.fontName))) return items;
    return items.map((it) => {
      if (!it || typeof it.str !== 'string' || !it.fontName) return it;
      const rec = s.fonts.get(it.fontName);
      if (!rec || !rec.hidden) return it;
      if (!isOverlayPage && !knownOverlay(it.fontName)) return it;
      const hidden = rec.visible === 0 || atHiddenOrigin(it, rec);
      return hidden ? { ...it, isAnnotation: true } : it;
    });
  }

  PDFStudy.invisibleText = { survey, markItems, fontFamily, INVISIBLE_MODES, MIN_VISIBLE_GLYPHS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.invisibleText;
  }
})(typeof window !== 'undefined' ? window : globalThis);

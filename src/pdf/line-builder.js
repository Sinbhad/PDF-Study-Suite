/**
 * Visual Line Builder: PDF.js text items -> reading-order line objects (column-aware, math-aware).
 * Extracted from pdf-loader.js (Strangler Fig); pdfLoader.reconstructLines re-exports reconstructLines.
 * Pipeline: decode glyphs (font-decoder / math-glyphs) -> collapse 2D formulas (formula-builder, using
 * fraction-bar rules from page-rules) -> split columns / margin notes -> group baselines -> format lines.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const BULLET_RE = /^[\s]*([•▪▸◦‣⁃∙◆◇➢➣➤✦✧❖■□●○\-*+]|\d+[.)]|[a-zA-Z][.)])\s+/;
  const need = (key, file) => {
    if (Object.prototype.hasOwnProperty.call(PDFStudy, key)) return PDFStudy[key]; // explicit null disables
    return typeof require === 'function' ? require(file) : null;
  };

  /**
   * Reconstructs visual lines from PDF.js text items; keeps bold headings together.
   * opts.fontNames: Map fontName id -> real font name; opts.decoders: Map id -> font decoder (font-decoder.js);
   * opts.rules: horizontal rules [{x0,x1,y}] (page-rules.js); opts.viewBox: page.view so coordinates land
   * in viewport space (crop boxes often start at e.g. [54, 54], not the origin).
   */
  function reconstructLines(items, styles, pageWidth, pageHeight, opts = {}) {
    const sf = need('spanFormat', './span-format.js');
    const fd = need('fontDecoder', './font-decoder.js');
    const vb = opts.viewBox || [0, 0, pageWidth, pageHeight];
    const plainDecoders = new Map();
    let rawSpans = [];
    for (const item of items) {
      if (!item || typeof item.str !== 'string') continue;
      const realName = opts.fontNames ? opts.fontNames.get(item.fontName) : null;
      let dec = opts.decoders && opts.decoders.get(item.fontName);
      if (!dec && fd) {
        const key = realName || item.fontName || '';
        if (!plainDecoders.has(key)) plainDecoders.set(key, fd.plainDecoder(key));
        dec = plainDecoders.get(key);
      }
      const raw = item.__recovered ? item.str : dec ? dec.decode(item.str) : item.str;
      let text = raw.replace(/[\u0000-\u001f\u007f-\u009f\uFFFD]/g, ' ').replace(/\s+/g, ' ');
      if (!text.trim()) continue;

      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      const fontSize = Math.round((Math.hypot(tr[2], tr[3]) || Math.abs(tr[3]) || item.height || 10) * 10) / 10;
      // In MathematicalPi-Three, H20902 at tall aspect (d >= 15, d >= 0.8*a) is a piecewise left brace, whereas [22,0,0,8.6] is √
      if (text.trim() === '√' && fontSize >= 15 && Math.abs(tr[3]) >= Math.abs(tr[0]) * 0.8) text = '{';
      const x0 = tr[4] - vb[0];
      const baseY = vb[3] - tr[5]; // baseline, measured down from the top of the viewport
      const width = item.width || text.length * (fontSize * 0.5);
      const styleObj = (styles && styles[item.fontName]) || {};
      const font = sf.classifyFont(item.fontName, styleObj, realName);
      rawSpans.push({
        text, x0, x1: x0 + width, topY: baseY - fontSize, bottomY: baseY, baselineY: baseY, fontSize,
        isBold: font.isBold, isLarge: fontSize >= 13.5, isItalic: font.isItalic, isCode: Boolean(font.isCode),
        isMath: font.isMath || Boolean(dec && dec.fam.isMath),
      });
    }

    const fb = need('formulaBuilder', './formula-builder.js');
    if (fb) rawSpans = fb.collapse(rawSpans, opts.rules || []);

    // Two-column pages: left column fully, then right; sidebars/margin notes after the main flow
    const layout = need('columnLayout', './column-layout.js');
    const regions = layout ? layout.splitRegions(rawSpans) : [{ spans: rawSpans, isMargin: false }];
    const main = [];
    const margin = [];
    regions.forEach((r, idx) => {
      for (const line of buildLines(r.spans, pageWidth, pageHeight)) {
        line.column = idx;
        line.isMargin = Boolean(r.isMargin);
        (line.isMargin ? margin : main).push(line);
      }
    });
    return main.concat(margin);
  }

  /**
   * Larson-style PDFs leave a gap inside one prose item ("in the  th subinterval") and draw the inline
   * variable ("i") as a separate item on top of it; split the host at the nearest space so the variable
   * lands where it is printed instead of after the whole item.
   */
  function splitHosts(spans) {
    const out = spans.slice();
    for (const s of spans) {
      if (s.tex || (s.text || '').trim().length > 4) continue;
      const host = out.find((h) => h !== s && h.text.length >= 8 && !h.tex && s.x0 > h.x0 + 1 && s.x1 < h.x1 - 1 &&
        Math.abs(h.baselineY - s.baselineY) < h.fontSize * 0.6);
      if (!host) continue;
      const at = ((s.x0 + s.x1) / 2 - host.x0) / (host.x1 - host.x0) * host.text.length;
      let cut = -1;
      for (let k = 0; k < host.text.length; k++) if (host.text[k] === ' ' && (cut < 0 || Math.abs(k - at) < Math.abs(cut - at))) cut = k;
      if (cut <= 0 || cut >= host.text.length - 1) continue;
      const w = (host.x1 - host.x0) / host.text.length;
      const left = { ...host, text: host.text.slice(0, cut), x1: Math.min(host.x0 + cut * w, s.x0 - 0.5) };
      const right = { ...host, text: host.text.slice(cut + 1), x0: Math.max(host.x0 + (cut + 1) * w, s.x1 + 0.5) };
      out.splice(out.indexOf(host), 1, left, right);
    }
    return out;
  }

  /** Groups one region's spans into baseline rows and formats each row as a line object. */
  function buildLines(spans, pageWidth, pageHeight) {
    // Row tolerance follows the smaller (body) size so a tall glyph never swallows the rows around it
    const tol = (a, b) => Math.min(Math.max(a, b), Math.min(a, b) * 1.6) * 0.4;
    spans.sort((a, b) => {
      const yDiff = a.baselineY - b.baselineY;
      return Math.abs(yDiff) > tol(a.fontSize, b.fontSize) ? yDiff : a.x0 - b.x0;
    });

    const lineGroups = [];
    for (const span of spans) {
      const lastGroup = lineGroups[lineGroups.length - 1];
      const yTolerance = lastGroup ? tol(lastGroup.bodySize, span.fontSize) : 0;
      if (lastGroup && Math.abs(span.baselineY - lastGroup.baselineY) <= yTolerance) {
        lastGroup.spans.push(span);
        lastGroup.maxFontSize = Math.max(lastGroup.maxFontSize, span.fontSize);
        if (span.fontSize > lastGroup.bodySize * 0.82) {
          lastGroup.bodySpans += 1;
          lastGroup.baselineY = (lastGroup.baselineY * (lastGroup.bodySpans - 1) + span.baselineY) / lastGroup.bodySpans;
          lastGroup.bodySize = Math.max(lastGroup.bodySize, Math.min(span.fontSize, lastGroup.bodySize * 1.6));
        }
      } else {
        lineGroups.push({ baselineY: span.baselineY, maxFontSize: span.fontSize, bodySize: span.fontSize, bodySpans: 1, spans: [span] });
      }
    }

    const sf = need('spanFormat', './span-format.js');
    const lines = [];
    for (const group of lineGroups) {
      group.spans = splitHosts(group.spans);
      group.spans.sort((a, b) => a.x0 - b.x0);
      const { text: trimmed, formattedText, isBold, hasMath, isCode } = sf.formatLine(group.spans);
      if (!trimmed) continue;

      const hasBullet = BULLET_RE.test(trimmed);
      const x0 = group.spans[0].x0;
      const textX0 = group.spans.length > 1 && BULLET_RE.test(group.spans[0].text.trim() + ' ') ? group.spans[1].x0 : x0;
      const body = group.spans.filter((s) => s.fontSize > group.bodySize * 0.82);
      lines.push({
        text: trimmed, formattedText, cleanText: trimmed.replace(BULLET_RE, '').trim(),
        x0, textX0, x1: Math.max(...group.spans.map((s) => s.x1)),
        topY: Math.min(...group.spans.map((s) => s.topY)),
        bottomY: Math.max(...group.spans.map((s) => s.bottomY)),
        // Body size, not max: a 28pt ∫ or a 6.5pt exponent must not change how the line is classified
        fontSize: body.length ? Math.max(...body.map((s) => s.fontSize)) : group.maxFontSize,
        isBold, hasBullet, hasMath: Boolean(hasMath), isCode: Boolean(isCode),
        wordCount: trimmed.split(/\s+/).length, pageWidth, pageHeight,
      });
    }
    return lines;
  }

  PDFStudy.lineBuilder = { reconstructLines, buildLines, BULLET_RE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.lineBuilder;
  }
})(typeof window !== 'undefined' ? window : globalThis);

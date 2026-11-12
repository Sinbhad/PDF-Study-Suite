/**
 * Span typography helpers for pdf-loader.js: resolves real PDF font names (PDF.js only exposes opaque ids
 * like "g_d0_f176" in getTextContent), classifies spans as bold / italic / math, and formats a line's spans
 * with inline **bold** markers (whole-line headings, lead-in labels and mid-line key terms).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const BOLD_FONT_RE = /bold|black|heavy|demi|semibold|extrabold|ultra/i;
  const ITALIC_FONT_RE = /italic|oblique|slanted/i;
  const CODE_FONT_RE = /courier|mono|consol|menlo|typewriter|^cmtt|^sfmono|inconsolata|sourcecode|lucidaconsole/i;
  // Math / symbol fonts: their bold cuts are vectors and operators, never key terms
  const MATH_FONT_RE = /math|symbol|^cm(?:sy|mi|ex|bsy|mib)|msbm|msam|euclid|mtextra|wingding|dingbat|stixgeneral/i;

  /**
   * Maps each text item's fontName id to the real PostScript name ("LNKELH+Times-Bold").
   * PDF.js only fills page.commonObjs with font objects once the page's operator list has been built,
   * so getOperatorList() is awaited only when some id on this page is not resolved yet; the result is
   * cached per document (ids are document-wide) and reused by later renders of the same page.
   */
  async function resolveFontNames(page, items, cache) {
    const names = cache || new Map();
    const ids = [...new Set(items.map((i) => i && i.fontName).filter(Boolean))].filter((id) => !names.has(id));
    if (!ids.length || !page || !page.commonObjs) return names;
    const lookup = (id) => {
      try {
        if (page.commonObjs.has && !page.commonObjs.has(id)) return null;
        const f = page.commonObjs.get(id);
        return f && f.name ? String(f.name) : null;
      } catch (_err) {
        return null;
      }
    };
    if (ids.some((id) => !lookup(id))) {
      try {
        await page.getOperatorList();
      } catch (_err) {
        return names; // fall back to style-based detection
      }
    }
    for (const id of ids) {
      const n = lookup(id);
      if (n) names.set(id, n);
    }
    return names;
  }

  /** Classifies one span's font from its real name (if known) plus the PDF.js style/fontName fallback. */
  function classifyFont(fontName, styleObj, realName) {
    const descriptor = `${realName || ''} ${fontName || ''} ${(styleObj && styleObj.fontFamily) || ''}`;
    const base = String(realName || '').replace(/^[A-Z]{6}\+/, '');
    const isMath = MATH_FONT_RE.test(base);
    return {
      isBold: BOLD_FONT_RE.test(descriptor) && !isMath,
      isItalic: ITALIC_FONT_RE.test(descriptor) || /^cmmi|^mtmi/i.test(base),
      isMath,
      isCode: CODE_FONT_RE.test(base || descriptor) || (styleObj && styleObj.fontFamily === 'monospace' && !realName),
      fontFamily: base || (styleObj && styleObj.fontFamily) || '',
    };
  }

  const CODE_SIGNALS = [/[;{}]\s*$/, /\+\+|\|\||&&/, /[=!<>]=/, /\w\[\w*\]/, /\w\.\w+\(/,
    /\b(?:public|private|static|void|int|new|return|class|def|elif|null|println|printf|const|let|var)\b/, /\w\([^()]*\)\s*[;{]\s*$/];

  /** Code / pseudocode row: mostly monospace characters, method call obj.fn(), or >=2 code signals. */
  function isCodeLine(spans) {
    const chars = spans.reduce((a, s) => a + (s.text || '').trim().length, 0);
    const code = spans.reduce((a, s) => a + (s.isCode ? (s.text || '').trim().length : 0), 0);
    if (chars && code >= chars * 0.6) return true;
    const text = spans.map((s, i) => (i && s.x0 - spans[i - 1].x1 > s.fontSize * 0.1 ? ' ' : '') + s.text).join('');
    if (/[A-Za-z_]\w*\.[A-Za-z_]\w*\(/.test(text)) return true;
    return CODE_SIGNALS.filter((re) => re.test(text)).length >= 2;
  }

  // Line formatting (bold runs, sub/superscripts, `$...$` TeX math) lives in math-line.js
  const mathLine = () => PDFStudy.mathLine || (typeof require === 'function' ? require('./math-line.js') : null);
  const wrapBold = (raw) => mathLine().wrapBold(raw);

  /** Builds { text, formattedText, isBold, hasMath } for one baseline row of spans (already sorted by x). */
  function formatLine(spans) {
    return mathLine().formatLine(spans);
  }

  PDFStudy.spanFormat = { BOLD_FONT_RE, ITALIC_FONT_RE, MATH_FONT_RE, CODE_FONT_RE, resolveFontNames, classifyFont, formatLine, wrapBold, isCodeLine };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.spanFormat;
  }
})(typeof window !== 'undefined' ? window : globalThis);

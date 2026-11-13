/**
 * Recognised handwriting -> ordinary page lines (line-builder.js shape), so the existing
 * summary / flashcard / quiz pipeline works unchanged. Pure functions, no DOM.
 * Pieces below LOW_CONFIDENCE stay in the page result for the review panel but are left out of the page lines
 * (so out of summaries, flashcards and quizzes) until they are corrected or confirmed there (confidence 1).
 * Page result shape : { pageNumber, scale, width, height, lines: [{ index, box, regions: [...] }] }.
 * A canvas (mind-map) result adds layout: 'canvas' and line.cluster / line.group (ocr-canvas.js): its lines stay
 * in the given reading order, a second reading of the same ink is dropped, and each page line also carries
 * ocr.cluster / ocr.group / ocr.title (a block's title line is set as a heading).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const lineBuilder = () => mod('lineBuilder', './line-builder.js');
  const pageKind = () => mod('pageKind', './page-kind.js');
  const ocrCanvas = () => mod('ocrCanvas', './ocr-canvas.js');

  const LOW_CONFIDENCE = 0.6;
  const BODY_PT = 11;
  const HEADING_PT = 16;
  const HEADING_RATIO = 1.3; // measured: a clearly larger title line is about 1.4x the body line height
  const HEADING_MAX_WORDS = 8;

  const clampConf = (c) => (typeof c === 'number' && c >= 0 ? Math.min(1, c) : 0);
  const clampSize = (n) => Math.max(9, Math.min(18, n));

  function sanitise(text) {
    return String(text == null ? '' : text)
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const median = (nums) => {
    if (!nums.length) return 0;
    const s = nums.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  /** Non-empty regions of one result line, left to right, each with its cleaned text; low ones only if includeLow. */
  function usableRegions(line, includeLow) {
    const out = [];
    for (const r of (line && line.regions) || []) {
      if (!includeLow && !(r && clampConf(r.confidence) >= LOW_CONFIDENCE)) continue;
      const raw = r && r.kind === 'math' ? String(r.text == null ? '' : r.text).replace(/\$/g, '') : r && r.text;
      // The recogniser was trained on transcripts with a space before punctuation ("at c ."): close it up
      const text = r && r.kind === 'math' ? sanitise(raw) : sanitise(raw).replace(/\s+([,.;:!?])/g, '$1');
      if (text) out.push({ region: r, text });
    }
    out.sort((a, b) => ((a.region.box && a.region.box.x) || 0) - ((b.region.box && b.region.box.x) || 0));
    // A bullet dot in front of a line is read as "#": show it as the bullet it is
    if (out.length && out[0].region.kind !== 'math') out[0].text = out[0].text.replace(/^#\s+(?=[A-Za-z(])/, '• ');
    return out;
  }

  function lineText(parts) {
    const onlyMath = parts.length === 1 && parts[0].region.kind === 'math';
    const text = parts
      .map((p) => (p.region.kind === 'math' ? (onlyMath ? `$$${p.text}$$` : `$${p.text}$`) : p.text))
      .join(' ');
    return { text, onlyMath };
  }

  function unionBox(parts, fallback) {
    const boxes = parts.map((p) => p.region.box).filter(Boolean);
    if (!boxes.length) return fallback || { x: 0, y: 0, w: 0, h: 0 };
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * Font size from line height. The median text-line height (points) maps to 11pt body, so lines
   * stay body-sized (9..12). A line >= 1.3x the median that is short (<= 8 words) and not
   * math-only becomes 16pt so downstream heading detection can see it. Everything clamps to 9..18.
   */
  function fontSizeFor(heightPt, med, words, onlyMath) {
    if (!med || !heightPt || onlyMath) return BODY_PT;
    if (heightPt >= HEADING_RATIO * med && words <= HEADING_MAX_WORDS) return clampSize(HEADING_PT);
    return Math.min(12, clampSize((BODY_PT * heightPt) / med));
  }

  /** opts.includeLow: keep unconfirmed low-confidence pieces too (diagnostic tools only, never study text). */
  function toPageLines(result, pageObj, opts) {
    const includeLow = !!(opts && opts.includeLow);
    if (!result || !Array.isArray(result.lines)) return [];
    const BULLET_RE = lineBuilder().BULLET_RE;
    const scale = result.scale > 0 ? result.scale : 1;
    const pageWidth = (pageObj && pageObj.width) || (result.width || 0) / scale;
    const pageHeight = (pageObj && pageObj.height) || (result.height || 0) / scale;

    let items = [];
    for (const line of result.lines) {
      const parts = usableRegions(line, includeLow);
      if (!parts.length) continue;
      const { text, onlyMath } = lineText(parts);
      items.push({ line, parts, text, onlyMath, box: unionBox(parts, line.box) });
    }
    // Canvas pages: topic blocks in reading order; a block's opening title line is marked as a heading
    const oc = ocrCanvas();
    const canvas = Boolean(oc && oc.isCanvas(result));
    if (canvas) items = oc.dedupe(items);
    const titles = canvas ? oc.titleItems(items) : null;
    const med = median(items.filter((i) => !i.onlyMath).map((i) => i.box.h / scale));

    return items.map((item) => {
      const { line, parts, text, onlyMath, box } = item;
      const wordCount = text.split(/\s+/).length;
      const confs = parts.map((p) => clampConf(p.region.confidence));
      const confidence = Math.min(...confs);
      const x0 = box.x / scale;
      const out = {
        text, formattedText: text, cleanText: text.replace(BULLET_RE, '').trim(),
        x0, textX0: x0, x1: (box.x + box.w) / scale,
        topY: box.y / scale, bottomY: (box.y + box.h) / scale,
        fontSize: fontSizeFor(box.h / scale, med, wordCount, onlyMath),
        isBold: false, hasBullet: BULLET_RE.test(text),
        hasMath: parts.some((p) => p.region.kind === 'math'), isCode: false,
        wordCount, pageWidth, pageHeight,
        ocr: {
          lineIndex: line.index, confidence, low: confidence < LOW_CONFIDENCE,
          regionIds: parts.map((p) => p.region.id),
        },
      };
      if (!canvas) return out;
      Object.assign(out.ocr, { cluster: line.cluster, group: line.group, title: titles.has(item) });
      if (out.ocr.title) Object.assign(out, { fontSize: HEADING_PT, isBold: true });
      return out;
    });
  }

  /** Mutates the shared page object (parsedPdf.pages and pageCache hold the same reference). */
  function applyToPage(pageObj, result) {
    if (!pageObj || !result) return pageObj;
    pageObj.lines = toPageLines(result, pageObj);
    pageObj.wordCount = pageObj.lines.reduce((sum, l) => sum + l.wordCount, 0);
    const pk = pageKind();
    if (pk) pageObj.kind = pk.classifyPage(pageObj);
    pageObj.ink = pageObj.ink || { needsRecognition: true, reason: 'no-text', pathOps: 0, imageOps: 0 };
    pageObj.ink.recognised = true;
    pageObj.ink.result = result;
    return pageObj;
  }

  function findRegion(result, regionId) {
    for (const line of (result && result.lines) || []) {
      for (const r of line.regions || []) if (r.id === regionId) return r;
    }
    return null;
  }

  function applyCorrection(pageObj, regionId, text) {
    const result = pageObj && pageObj.ink && pageObj.ink.result;
    const region = findRegion(result, regionId);
    if (!region) return false;
    region.text = String(text == null ? '' : text);
    region.confidence = 1;
    region.source = 'user';
    applyToPage(pageObj, result);
    return true;
  }

  /** Regions below LOW_CONFIDENCE (including empty manual ones), as copies with pageNumber and lineIndex. */
  function lowConfidence(pageObj) {
    const result = pageObj && pageObj.ink && pageObj.ink.result;
    const out = [];
    for (const line of (result && result.lines) || []) {
      for (const r of line.regions || []) {
        if (clampConf(r.confidence) < LOW_CONFIDENCE) {
          out.push(Object.assign({}, r, { pageNumber: result.pageNumber, lineIndex: line.index }));
        }
      }
    }
    return out;
  }

  PDFStudy.ocrLines = { LOW_CONFIDENCE, toPageLines, applyToPage, applyCorrection, lowConfidence };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.ocrLines;
  }
})(typeof window !== 'undefined' ? window : globalThis);

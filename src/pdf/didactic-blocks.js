/**
 * Boxed Theorem / Definition / Rule / Law / Corollary / Lemma / Algorithm / Formula / Summary / Guideline
 * block capture for text-cleaner.js.
 * Heading recognition lives in block-headings.js (re-exported here as matchHeading).
 *
 * CLIP / BBOX CONTRACT (block.clip, block.bbox, and card.clip):
 *   clip = bbox = { page, top, bottom, left?, right? }
 *   - page:   1-based PDF page number (first page of the block).
 *   - top / bottom / left / right: PDF.js viewport at scale 1.0 (PDF points, origin top-left).
 *   - formulas: array of inner TeX strings from display formula lines (`$$...$$`) inside the block.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const getHeadings = () =>
    PDFStudy.blockHeadings || (typeof require === 'function' ? require('./block-headings.js') : null);

  const BLOCK_END_RE = /^(?:EXAMPLE\s+\d+|Proof\b|REMARK\b|Solution\b|Exploration\b|NOTE\b|TECHNOLOGY\b|FOR\s+FURTHER\s+INFORMATION\b)/i;
  const LIST_LINE_RE = /^(?:\d{1,2}[.)]\s|\(?[a-h][.)]\s|[•▪◦‣∙✦✧➢\-–]\s)/;
  const getLines = () => PDFStudy.scopeLines || (typeof require === 'function' ? require('./scope-lines.js') : null);
  const DISPLAY_MATH_RE = /^\$\$([\s\S]+)\$\$$/;
  const NEEDS_BOX_OR_LIST_RE = /^(?:Guideline|Rule|Formula|Summary)$/;
  const MAX_BODY_LINES = 40;

  function matchHeading(plain, line, bodySize) {
    return getHeadings().matchHeading(plain, line, bodySize);
  }

  /** proseX0: smallest x0 of the last few ordinary text lines before the heading on this page (or null). */
  function start(heading, line, page, proseX0, pageTitle) {
    const title =
      heading.inlineBody && pageTitle && heading.title === heading.category && pageTitle.length <= 75
        ? `${heading.category} — ${pageTitle.replace(/\*\*/g, '').trim()}`
        : heading.title;
    const blk = {
      category: heading.category,
      title,
      inlineStatement: Boolean(heading.inlineBody),
      pageNumber: page.pageNumber,
      headLine: line,
      proseX0,
      boxLeft: null,
      boxed: false,
      bodyLines: heading.inlineBody ? [heading.inlineBody] : [],
      breaks: heading.inlineBody ? [false] : [], // breaks[i]: bodyLines[i] starts a new line (list item / paragraph)
      itemX0: null,
      formulas: [],
      listLines: 0,
      mathLines: heading.inlineBody && heading.inlineBody.includes('$') ? 1 : 0,
      lastTop: line.topY,
      lastBottom: line.bottomY,
      clip: Number.isFinite(line.topY)
        ? { page: page.pageNumber, top: line.topY, bottom: line.bottomY, left: line.x0, right: line.x1 }
        : null,
    };
    return blk;
  }

  /** Absorbs a wrapped 2nd bold heading line into `block.title` + `block.clip` when present. */
  function extendHeading(block, line, plain) {
    const merged = getHeadings().matchWrappedContinuation(block, block.headLine, line, plain);
    if (!merged) return false;
    block.title = merged;
    block.headLine = line;
    if (block.clip && Number.isFinite(line.bottomY)) {
      block.clip.bottom = Math.max(block.clip.bottom, line.bottomY);
      if (Number.isFinite(line.x0)) block.clip.left = Math.min(block.clip.left, line.x0);
      if (Number.isFinite(line.x1)) block.clip.right = Math.max(block.clip.right, line.x1);
      block.lastTop = line.topY;
      block.lastBottom = Math.max(block.lastBottom, line.bottomY);
    }
    return true;
  }

  /** True when `line` is no longer part of the block (call before add). */
  function ends(block, line, plain, page) {
    if (line.isMargin) return true;
    if (BLOCK_END_RE.test(plain) || block.bodyLines.length >= MAX_BODY_LINES) return true;
    const samePage = page.pageNumber === block.pageNumber;
    if (!samePage && (block.boxed || block.inlineStatement)) return true;
    if (samePage && Number.isFinite(line.topY) && Number.isFinite(block.lastTop)) {
      if (line.topY < block.lastTop - 2) return true; // jumped up: another column or region
      const gapLimit = Math.max(30, 2.8 * (line.fontSize || 10));
      if (line.topY - block.lastBottom > gapLimit) return true;
      if (block.boxed && Number.isFinite(line.x0) && line.x0 < block.boxLeft - 4) return true;
    }
    // Slide bullet after an inline "✦ Lemma: ..." starts a new point unless indented continuation
    if (block.inlineStatement && line.hasBullet && /^[✦•▪➢]/.test(line.text || '')) return true;
    const head = block.headLine;
    if (line.isCode || line.hasMath) return false;
    // Allow internal subheadings inside Definition/Summary/Rule boxes (e.g. "Function Domain Range", "Continuity at a Point")
    if (block.boxed && Number.isFinite(line.x0) && line.x0 >= block.boxLeft - 2 && line.fontSize <= (head.fontSize || 10) + 0.5) {
      return false;
    }
    return Boolean(
      line.isBold &&
        /^\*\*[^*$]+\*\*$/.test(line.formattedText || '') &&
        line.fontSize >= (head.fontSize || 0) - 0.5 &&
        block.bodyLines.length > 0
    );
  }

  function add(block, line, formattedRaw, plain, page) {
    if (!block.bodyLines.length && Number.isFinite(line.x0)) {
      // Boxed when heading + first line sit right of the surrounding prose (Larson insets boxes ~13pt)
      block.boxLeft = Math.min(block.headLine.x0, line.x0);
      block.boxed = block.proseX0 !== null && block.boxLeft > block.proseX0 + 4;
    }
    if (page.pageNumber === block.pageNumber && block.clip && Number.isFinite(line.bottomY)) {
      block.clip.bottom = Math.max(block.clip.bottom, line.bottomY);
      if (Number.isFinite(line.x0)) block.clip.left = Math.min(block.clip.left, line.x0);
      if (Number.isFinite(line.x1)) block.clip.right = Math.max(block.clip.right, line.x1);
      block.lastTop = line.topY;
      block.lastBottom = Math.max(block.lastBottom, line.bottomY);
    }

    const fmt = String(formattedRaw || plain || '').trim();
    const sl = getLines();
    const items = sl ? sl.splitEnumerated(fmt) : [fmt];
    if (items.length > 1 || items[0] !== fmt) {
      // "$$1.\lim .. \quad 2.\lim ..$$": one enumerated item per body line
      for (const item of items) {
        const tex = item.replace(/^\S+\s+\$|\$$/g, '').trim();
        if (tex && !block.formulas.includes(tex)) block.formulas.push(tex);
        block.bodyLines.push(item);
        block.breaks.push(true);
      }
      block.listLines += items.length;
      block.mathLines += 1;
      block.itemX0 = Number.isFinite(line.x0) ? line.x0 : block.itemX0;
      return;
    }
    const disp = fmt.match(DISPLAY_MATH_RE);
    if (disp) {
      const tex = disp[1].trim();
      if (tex && !block.formulas.includes(tex)) block.formulas.push(tex);
      block.bodyLines.push(fmt);
      block.breaks.push(false);
      block.mathLines += 1;
      return;
    }

    const hasTeX = fmt.includes('$') || Boolean(line.hasMath);
    const tiny =
      !hasTeX &&
      !line.isCode &&
      line.fontSize &&
      block.headLine.fontSize &&
      line.fontSize < block.headLine.fontSize * 0.75;

    if ((plain.length >= 3 || hasTeX || line.isCode) && !tiny) {
      const kept = fmt.replace(/\*\*/g, '').trim();
      const isItem = LIST_LINE_RE.test(plain);
      // New line for each list item, and for the paragraph that returns to the item margin after a list
      const backToMargin = block.itemX0 !== null && Number.isFinite(line.x0) && line.x0 <= block.itemX0 + 2;
      if (kept) {
        block.bodyLines.push(isItem ? kept.replace(/^(\d{1,2})[.)]\s+/, '$1. ').replace(/^\(?([a-h])[.)]\s+/, '($1) ').replace(/^[▪◦‣∙✦✧➢\-–]\s+/, '• ') : kept);
        block.breaks.push(isItem || backToMargin);
      }
      if (isItem && Number.isFinite(line.x0)) block.itemX0 = line.x0;
      else if (backToMargin) block.itemX0 = null;
      if (isItem) block.listLines += 1;
      if (hasTeX) block.mathLines += 1;
    }
  }

  /** Builds the public block ({ category, title, body, formulas, pageNumber, clip?, bbox? }) or null. */
  function finalize(block, cleanText) {
    if (!block || !block.bodyLines.length) return null;
    const NL = String.fromCharCode(10);
    const joined = block.bodyLines.map((l, i) => (i ? (block.breaks[i] ? NL : ' ') : '') + l).join('');
    const body = joined.split(NL)
      .map((l) => (cleanText ? cleanText(l) : l).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(NL);
    if (body.length < 18 && !block.formulas.length) return null;

    // Unboxed section titles ("The Product Rule", "Properties of Limits", "Basic Integration Rules")
    // sitting over ordinary prose must NEVER become didactic blocks; require inset box or formula/list table.
    if (NEEDS_BOX_OR_LIST_RE.test(block.category) && !block.boxed) {
      const isStructuredList = block.listLines >= 2 && (block.category !== 'Guideline' || !/^Properties\s+of\b/i.test(block.title) || block.mathLines >= 2);
      const isFormulaBox = (block.category === 'Formula' || block.category === 'Summary') && block.formulas.length >= 2;
      if (!isStructuredList && !isFormulaBox) return null;
    }

    const out = {
      category: block.category,
      title: block.title.replace(/\*\*/g, '').trim(),
      body,
      formulas: block.formulas.slice(),
      pageNumber: block.pageNumber,
    };
    if (block.clip && block.clip.bottom > block.clip.top) {
      const r = (v) => Math.round(v * 10) / 10;
      const c = block.clip;
      const box = { page: c.page, top: r(c.top), bottom: r(c.bottom) };
      if (Number.isFinite(c.left) && Number.isFinite(c.right) && c.right > c.left) {
        box.left = r(c.left);
        box.right = r(c.right);
      }
      out.clip = box;
      out.bbox = { ...box };
    } else {
      out.bbox = null;
    }
    return out;
  }

  PDFStudy.didacticBlocks = {
    matchHeading,
    extendHeading,
    start,
    ends,
    add,
    finalize,
    MAX_BODY_LINES,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.didacticBlocks;
  }
})(typeof window !== 'undefined' ? window : globalThis);

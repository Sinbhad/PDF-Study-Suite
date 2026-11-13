/**
 * Figure-Text Filter for text-cleaner.js (100% offline, deterministic, geometry + text shape only).
 * Graphs and diagrams leak their labels into the text layer: axis letters (`$y$`, `$x$`), tick runs
 * (`$-2 - 1\quad 1\quad 2$`), curve labels (`$$f(x) = x^2$$` beside a plot), and short diagram phrases
 * ("Tangent line to" / "a curve"). markFigureText(page, bodySize) returns the Set of line objects to drop:
 *   1. tick / axis labels: math-only lines with no relation that are tiny, in the margin, or a few bare atoms
 *   2. margin groups that are not prose (kept: >= 3 lines with >= 8 words, or a punctuated sentence)
 *   3. math-only labels printed beside (not below) the previous text line
 *   4. runs of >= 3 short unpunctuated fragments away from the column's left edge
 * Real sentences, list items, headings and display equations inside paragraphs are never touched.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MATH_SEG_RE = /\$\$[\s\S]*?\$\$|\$[^$]*\$/g;
  const RELATION_RE = /[=<>≤≥≠≈]|\\(?:le|ge|ne|to|approx|in|notin|equiv|lim|int|sum|rightarrow|Rightarrow)(?![A-Za-z])/;
  const TICK_ATOM = String.raw`(?:\d+(?:\.\d+)?|[A-Za-z]|\\(?:pi|theta|alpha|beta|gamma|delta|Delta|varepsilon|epsilon|phi|sin|cos|tan|infty))`;
  const TICK_RE = new RegExp(String.raw`^[\s\-+−,()]*(?:${TICK_ATOM}[\s\-+−,()]*){1,6}$`);
  const TERMINAL_RE = /[.!?]["”')\]$]*$/;
  const LIST_START_RE = /^(?:\d{1,3}[.)]|\(?[a-z][.)]|[•▪◦‣∙✦✧➢–-])\s/;
  const ITEM_LABEL_RE = /^\$*(?:\d{1,3}\.(?!\d)|\([a-z]\)(?![\^_]))\s*\S/;
  const CAPTION_LABEL_RE = /^\**(?:Figure|Fig\.|Table)\s+(?:[A-Z]\.)?[A-Z]?\d+(?:\.\d+)*\**$/i;

  const fmtOf = (l) => String((l && (l.formattedText || l.text)) || '').trim();
  const proseWords = (fmt) => fmt.replace(MATH_SEG_RE, ' ').replace(/\*\*/g, '').match(/[A-Za-z]{2,}/g) || [];
  const mathInner = (fmt) => (fmt.match(MATH_SEG_RE) || []).map((m) => m.replace(/^\$+|\$+$/g, '')).join(' ');
  const isMathOnly = (fmt) => fmt.includes('$') && proseWords(fmt).length === 0 && !/\d/.test(fmt.replace(MATH_SEG_RE, ''));

  /** Axis letter, tick run or bare point label: carries no statement. */
  function isTickLabel(line, bodySize) {
    const fmt = fmtOf(line);
    if (ITEM_LABEL_RE.test(fmt)) return false; // "61. $(\sqrt 3, 1.56)$": a numbered item, not a tick run
    if (!fmt.includes('$')) return /^[\d\s.,+\-−–]+$/.test(fmt) && fmt.length <= 14;
    if (!isMathOnly(fmt)) return false;
    const inner = mathInner(fmt);
    if (RELATION_RE.test(inner)) return false;
    const small = Boolean(bodySize && line.fontSize && line.fontSize < bodySize * 0.86);
    const digits = (inner.match(/\d/g) || []).length / Math.max(1, inner.replace(/\s/g, '').length);
    const flat = inner.replace(/\\quad/g, ' ');
    return small || Boolean(line.isMargin) || /\\quad/.test(inner) || digits > 0.5 || TICK_RE.test(flat);
  }

  function markMargin(lines, drop) {
    const groups = [];
    for (const l of lines) {
      const g = groups[groups.length - 1];
      const prev = g && g[g.length - 1];
      const gap = prev ? l.topY - prev.bottomY : Infinity;
      if (prev && gap >= -4 && gap <= Math.max(5, (prev.fontSize || 10) * 1.05)) g.push(l);
      else groups.push([l]);
    }
    for (const g of groups) {
      const words = g.reduce((n, l) => n + proseWords(fmtOf(l)).length, 0);
      const sentence = words >= 5 && TERMINAL_RE.test(fmtOf(g[g.length - 1]).replace(/\*\*/g, ''));
      if (!((g.length >= 3 && words >= 8) || sentence)) g.forEach((l) => drop.add(l));
    }
  }

  function markMain(lines, drop, pageWidth) {
    const proseWide = lines.filter((l) => proseWords(fmtOf(l)).length >= 8);
    const wide = proseWide.length >= 3 ? proseWide : []; // a text column needs a few real prose lines
    const colLeft = wide.length ? Math.min(...wide.map((l) => l.x0)) : null;
    const colW = wide.length ? Math.max(...wide.map((l) => l.x1)) - colLeft : (pageWidth || 612) * 0.6;
    const isFull = (l) => (l.wordCount || 0) >= 8 || l.x1 - l.x0 >= colW * 0.6;
    let run = [];
    let prev = null;
    const flush = () => {
      if (run.filter((r) => r.cand).length >= 3) run.forEach((r) => drop.add(r.line));
      run = [];
    };
    for (const l of lines) {
      const fmt = fmtOf(l);
      const mathOnly = isMathOnly(fmt);
      if (drop.has(l)) {
        run.push({ line: l, cand: false });
        continue;
      }
      // Curve label printed beside the previous line (same band, to its right)
      if (mathOnly && prev && l.topY < prev.bottomY - 3 && l.x0 > prev.x1 + 8) {
        drop.add(l);
        run.push({ line: l, cand: false });
        continue;
      }
      const words = proseWords(fmt).length;
      const plain = fmt.replace(/\*\*/g, '');
      const tail = prev && isFull(prev) && l.topY - prev.bottomY <= (l.fontSize || 10) * 0.8;
      const atLeft = colLeft !== null && Math.abs(l.x0 - colLeft) <= 3;
      const cand = !mathOnly && !l.isBold && !l.isCode && !l.hasBullet && !fmt.startsWith('**') && words >= 1 && words <= 5 &&
        plain.length <= 48 && !/[.!?:;,]["”')\]$]*$/.test(plain) && !LIST_START_RE.test(plain) && !tail && !atLeft;
      const neutral = mathOnly && mathInner(fmt).length <= 16;
      if (cand || neutral) run.push({ line: l, cand });
      else flush();
      prev = l;
    }
    flush();
  }

  /**
   * opts.ticksOnly (exercise sets): only tick / axis labels and caption labels. Exercise grids print short math
   * items side by side, which the margin and fragment passes would mistake for curve labels.
   */
  function markFigureText(page, bodySize, opts = {}) {
    const drop = new Set();
    try {
      const h = (page && page.height) || 792; // running headers / footers are handled by the caller
      const lines = ((page && page.lines) || []).filter((l) => l && Number.isFinite(l.topY) && Number.isFinite(l.x0) && !l.isCode &&
        l.topY >= h * 0.055 && l.topY <= h * 0.95);
      for (const l of lines) if (isTickLabel(l, bodySize) || CAPTION_LABEL_RE.test(fmtOf(l))) drop.add(l);
      if (opts.ticksOnly) return drop;
      markMargin(lines.filter((l) => l.isMargin && !drop.has(l)), drop);
      markMain(lines.filter((l) => !l.isMargin), drop, page && page.width);
    } catch (_err) {
      // Never let a filter failure lose the page: fall back to keeping everything
    }
    return drop;
  }

  PDFStudy.figureFilter = { markFigureText, isTickLabel, isMathOnly, proseWords };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.figureFilter;
  }
})(typeof window !== 'undefined' ? window : globalThis);

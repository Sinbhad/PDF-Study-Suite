/**
 * Scope Text Emitter for text-cleaner.js (100% offline, deterministic).
 * Collects the cleaned lines of a study scope with their page, kind and didactic block, decides paragraph
 * breaks from layout, and assembles both public forms:
 *   scope.text  - content lines joined by "\n", with a blank line ("\n\n") between paragraphs
 *   scope.lines - [{ text, pageNumber, kind, blockId, paragraph, inText }] in reading order
 *     kind:      'prose' | 'heading' | 'code' | 'margin' | 'table' | 'caption' | 'folio' | 'url' | 'objective'
 *                | 'biography' | 'example' | 'self-check' | 'syntax'
 *     blockId:   id of the scope.blocks entry the line belongs to, or null
 *     paragraph: running paragraph number (lines of one paragraph share it)
 *     inText:    false for lines kept out of scope.text (captions, folios, examples, ...)
 * Prose wraps are de-hyphenated exactly as before (scope-lines.js pushProseLine).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const getLines = () => PDFStudy.scopeLines || (typeof require === 'function' ? require('./scope-lines.js') : null);

  const PARA_GAP = 0.55; // x font size: a larger vertical gap between two rows starts a new paragraph
  const PARA_INDENT = 0.8; // x font size: a first-line indent this deep starts a new paragraph
  const HEADING_SIZE = 1.1; // x body size: a bold row at least this large is a heading
  const TERMINAL_RE = /[.!?:;]["”')\]]?$|◂$/;
  const JOIN_KINDS = new Set(['prose', 'margin']); // rows whose "contribu-" + "tions" wraps are mended

  function createEmitter() {
    const entries = [];
    let prev = null; // geometry of the last content row: { pageNumber, column, x0, left, bottomY, fontSize, text, isMargin }
    let paragraph = 0;
    let forceBreak = false;

    /** True when `line` starts a new paragraph after the previous content row. */
    function startsParagraph(line, meta) {
      if (forceBreak || !prev) return true;
      if (!JOIN_KINDS.has(meta.kind) || prev.kind !== meta.kind) return meta.kind !== prev.kind || meta.kind === 'heading';
      if (!Number.isFinite(line.topY) || !Number.isFinite(prev.bottomY)) return false;
      const fs = line.fontSize || prev.fontSize || 10;
      const samePage = meta.pageNumber === prev.pageNumber;
      const sameColumn = samePage && (line.column === undefined || line.column === prev.column);
      if (!sameColumn) return TERMINAL_RE.test(prev.text);
      const gap = line.topY - prev.bottomY;
      if (gap > fs * PARA_GAP || gap < -fs * 2) return true;
      const indented = Number.isFinite(line.x0) && line.x0 - prev.left >= fs * PARA_INDENT;
      return indented && TERMINAL_RE.test(prev.text);
    }

    function remember(line, meta) {
      const sameColumn = prev && meta.pageNumber === prev.pageNumber && line.column === prev.column;
      const left = Number.isFinite(line.x0) ? (sameColumn ? Math.min(prev.left, line.x0) : line.x0) : (prev ? prev.left : 0);
      prev = {
        pageNumber: meta.pageNumber, column: line.column, x0: line.x0, left, bottomY: line.bottomY,
        fontSize: line.fontSize, kind: meta.kind, text: entries.length ? entries[entries.length - 1].text : '',
      };
    }

    /**
     * Adds one cleaned row. line: the source page line (geometry only), text: cleaned (formatted) text,
     * meta: { pageNumber, kind, blockId, inText }. Quarantined rows (inText false) never join or break prose.
     */
    function push(line, text, meta) {
      const m = { kind: 'prose', blockId: null, inText: true, ...meta };
      if (!text) return;
      if (!m.inText) {
        entries.push({ text, pageNumber: m.pageNumber, kind: m.kind, blockId: m.blockId, paragraph: -1, inText: false });
        return;
      }
      const geo = line || {};
      if (startsParagraph(geo, m)) paragraph += 1;
      // A heading or code fence is a paragraph of its own; table rows share one paragraph (scope-blocks breaks around it)
      forceBreak = m.kind === 'heading' || m.kind === 'code';
      const last = [...entries].reverse().find((e) => e.inText);
      const joinable = last && last.paragraph === paragraph && JOIN_KINDS.has(m.kind) && last.kind === m.kind;
      if (joinable) {
        const pair = [last.text];
        getLines().pushProseLine(pair, text);
        if (pair.length === 1) {
          last.text = pair[0];
          remember(geo, m);
          return;
        }
      }
      entries.push({ text, pageNumber: m.pageNumber, kind: m.kind, blockId: m.blockId, paragraph, inText: true });
      remember(geo, m);
    }

    /** Ends the current paragraph (page change into margin notes, block boundary, ...). */
    function breakParagraph() {
      forceBreak = true;
    }

    /** { text, lines } — text keeps every content row on its own line and a blank line between paragraphs. */
    function finish(cleanText, keepBlockIds) {
      const clean = (s) => (cleanText ? cleanText(s) : s);
      const lines = entries.map((e) => ({
        text: clean(e.text).trim(), pageNumber: e.pageNumber, kind: e.kind,
        blockId: e.blockId && (!keepBlockIds || keepBlockIds.has(e.blockId)) ? e.blockId : null,
        paragraph: e.paragraph, inText: e.inText,
      })).filter((e) => e.text);
      const out = [];
      let lastPara = null;
      for (const e of lines) {
        if (!e.inText) continue;
        if (lastPara !== null && e.paragraph !== lastPara) out.push('');
        out.push(e.text);
        lastPara = e.paragraph;
      }
      return { text: out.join('\n'), lines };
    }

    return { push, breakParagraph, finish };
  }

  /** Bold row clearly larger than the body, or a bold short row without closing punctuation: a heading. */
  function isHeadingLine(line, plain, bodySize) {
    if (!line || !line.isBold || line.isMargin || line.isCode) return false;
    const big = bodySize && line.fontSize >= bodySize * HEADING_SIZE;
    const allBold = /^\*\*[^*]+\*\*$/.test(String(line.formattedText || '').trim());
    const short = plain.split(/\s+/).length <= 10 && !/[.,;:]$/.test(plain);
    return Boolean(big || (allBold && short));
  }

  PDFStudy.scopeEmitter = { createEmitter, isHeadingLine, PARA_GAP, PARA_INDENT };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.scopeEmitter;
  }
})(typeof window !== 'undefined' ? window : globalThis);

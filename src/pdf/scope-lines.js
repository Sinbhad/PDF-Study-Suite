/**
 * Scope Line Utilities for text-cleaner.js / didactic-blocks.js (100% offline, deterministic).
 * - publisher fluff: copyright / licensing boilerplate, photo credits, URL promo lines and sentences
 * - sidebar box headers (technology notes, explorations) whose whole box is skipped
 * - enumerated display rows ("$$1.\lim .. \quad 2.\lim ..$$") split into one item per line
 * - prose helpers moved out of text-cleaner.js: de-hyphenating line joiner and code fences
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const FLUFF_LINE_RES = [
    /^(?:copyright\b|©|\(c\)\s*(?:19|20)\d\d)/i,
    /\ball\s+rights\s+reserved\b/i,
    /\bmay\s+not\s+be\s+(?:copied|reproduced|scanned|duplicated)\b/i,
    /\beditorial\s+review\s+has\s+deemed\b/i,
    /\breserves\s+the\s+right\s+to\s+remove\b/i,
    /\bISBN(?:-1[03])?\b\s*:?\s*[\d-]{9,}/i,
    /\blibrary\s+of\s+congress\b/i,
    /^printed\s+in\s+(?:the\s+)?[A-Z]/i,
    /^(?:photo|image|illustration|art|text)\s+credits?\b/i,
    /\/\s*(?:shutterstock|getty\s*images|istock(?:photo)?|alamy|corbis|science\s+source|the\s+image\s+works)\b/i,
    /^(?:https?:\/\/|www\.)\S+$/i,
    /\bfor\s+tutorial\s+help\s+and\s+worked-out\s+solutions\b/i,
    /^(?:about\s+the\s+authors?|acknowledg(?:e)?ments|preface|dedication)$/i,
  ];
  const PROMO_SENTENCE_RE = /(?:^|\s)(?:See|Visit|Go\s+to)\s+(?:www\.)?[A-Za-z][\w-]*\.(?:com|org|net|edu)\b[^.!?]*(?:[.!?]|$)/g;
  const CAPTION_TAIL_RE = /\s*\*\*(?:Figure|Table)\s+(?:[A-Z]\.)?[A-Z]?\d+(?:\.\d+)*\*\*\s*$/;
  const BOX_HEAD_RE = /^(?:TECHNOLOGY\s+PITFALL|EXPLORATION|FOR\s+FURTHER\s+INFORMATION|SECTION\s+PROJECT|PUTNAM\s+EXAM\s+CHALLENGE)\b/i;
  const ENUM_MARK = String.raw`(?:(\d{1,2}|[a-z])\.|\(([a-z])\))`;
  const ENUM_HEAD_RE = new RegExp(String.raw`^${ENUM_MARK}\s*(?=[\\A-Za-z(\[|])`);
  const ENUM_SPLIT_RE = /\\quad\s*(?=(?:(?:\d{1,2}|[a-z])\.|\([a-z]\))\s*[\\A-Za-z(\[|])/;

  const isFluffLine = (plain) => {
    const s = String(plain || '').replace(/\*\*/g, '').trim();
    return s.length > 0 && FLUFF_LINE_RES.some((re) => re.test(s));
  };

  /** Removes "See Site.com for ..." promo sentences and a glued trailing "**Figure 1.23**" label. */
  const stripPromo = (text) => String(text || '').replace(PROMO_SENTENCE_RE, ' ').replace(CAPTION_TAIL_RE, '').replace(/[ \t]{2,}/g, ' ').trim();

  /** Boxed side notes (calculator pitfalls, explorations, further-reading pointers): the whole box is skipped. */
  const isBoxHeader = (plain) => BOX_HEAD_RE.test(String(plain || '').replace(/\*\*/g, '').trim());

  /** "$$1.A\quad 2.B$$" -> ["1. $A$", "2. $B$"]; any other line comes back unchanged as [fmt]. */
  function splitEnumerated(fmt) {
    const s = String(fmt || '').trim();
    const m = s.match(/^\$\$([\s\S]+)\$\$$/);
    if (!m || !ENUM_HEAD_RE.test(m[1].trim())) return [s];
    const parts = m[1].trim().split(ENUM_SPLIT_RE);
    const out = [];
    for (const raw of parts) {
      const part = String(raw || '').trim();
      const head = part.match(ENUM_HEAD_RE);
      if (!head) return [s];
      const label = head[1] ? `${head[1]}.` : `(${head[2]})`;
      const body = part.slice(head[0].length).replace(/\\quad\s*$/, '').trim();
      if (!body) return [s];
      out.push(`${label} $${body}$`);
    }
    return out.length ? out : [s];
  }

  /** Joins de-hyphenated prose wraps (`straight-` + `forward` -> `straightforward`) outside math/code. */
  function pushProseLine(out, text) {
    if (!out.length) {
      out.push(text);
      return;
    }
    const prev = out[out.length - 1];
    const m = prev.match(/^(.*\b[a-z]{2,})[-‐‑]$/);
    const nextWord = text.match(/^([a-z]{2,}\b[\s\S]*)$/);
    if (
      m &&
      nextWord &&
      !prev.startsWith('```') &&
      !prev.endsWith('`') &&
      (prev.match(/\$/g) || []).length % 2 === 0 &&
      !text.startsWith('$') &&
      !text.startsWith('`')
    ) {
      out[out.length - 1] = `${m[1]}${nextWord[1]}`;
      return;
    }
    out.push(text);
  }

  /** Converts a run of consecutive `line.isCode` rows into a fenced ``` block with x0 indentation. */
  function formatCodeFence(codeRun) {
    const baseX = Math.min(...codeRun.map((c) => (Number.isFinite(c.x0) ? c.x0 : 0)));
    const deltas = codeRun.map((c) => (Number.isFinite(c.x0) ? c.x0 - baseX : 0)).filter((d) => d >= 6);
    const step = deltas.length ? Math.max(8, Math.min(...deltas)) : Math.max(12, ((codeRun[0] && codeRun[0].fontSize) || 12) * 1.35);
    const rows = codeRun.map((c) => {
      const inner = c.raw.replace(/^`([\s\S]*)`$/, '$1').trim();
      const spaces = Number.isFinite(c.x0) ? Math.min(16, Math.max(0, Math.round((c.x0 - baseX) / step) * 2)) : 0;
      return `${' '.repeat(spaces)}${inner}`;
    });
    return ['```', ...rows, '```'].join('\n');
  }

  PDFStudy.scopeLines = { isFluffLine, stripPromo, isBoxHeader, splitEnumerated, pushProseLine, formatCodeFence };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.scopeLines;
  }
})(typeof window !== 'undefined' ? window : globalThis);

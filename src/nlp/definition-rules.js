/**
 * Definition Rules: the sentence- and line-shaped definition patterns of textbook prose, as plain readings for
 * flashcard-engine.js to gate (moved out of flashcard-engine.js unchanged).
 *   read(sentence)            -> [{ term, def }]  glossary "Term: definition", copula "X is a type of ...",
 *                                reverse "... is called X", appositive "X, a ..., is ...", "According to the X
 *                                theory, <claim>"; strongest rule first
 *   headingBlocks(lines, deps) -> [{ title, body, category }]  "Definition of X" / "THEOREM 1.2 Name" headings over
 *                                the lines that state them (plain-text inputs without didactic blocks)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const DEFINITION_RULES = [
    {
      type: 'glossary',
      regex:
        /^(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-\/]{1,42}?)(?:\*\*|__)?\s*(?:\((?<acronym>[A-Z0-9\-]{1,10})\))?(?:\s*:|\s+[—–]|[—–](?=\s)|\s-\s)\s*(?<def>[A-Za-z0-9][^.!?\n]{12,260}[.!?]?)$/,
    },
    {
      type: 'copula',
      regex:
        /^(?:The\s+|A\s+|An\s+)?(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-]{2,40}?)(?:\*\*|__)?\s+(?:\((?<acronym>[A-Z0-9\-]{2,10})\)\s+)?(?:is\s+defined\s+as|can\s+be\s+defined\s+as|refers\s+to|denotes|is\s+known\s+as|(?:is|are)\s+(?:a|an)\s+(?:type|kind|form|class|variety|branch)\s+of|is\s+(?:a|an|the)\s+(?:process|method|technique|mechanism|system|measure|phenomenon|structure|condition|state|ability|study|rate|ratio|principle|theory|law|rule|property|theorem|limit|derivative|integral|function)\s+(?:by\s+which|where|in\s+which|that|of|for))\s+(?<def>[^.!?\n]{10,250}[.!?]?)$/i,
    },
    {
      type: 'reverse_def',
      regex:
        /^(?<def>[A-Z][^.!?\n]{15,210}?)\s+(?:is|are)\s+(?:called|known\s+as|referred\s+to\s+as|termed)\s+(?:the\s+|a\s+|an\s+)?(?:\*\*|__)?(?<term>[A-Za-z0-9\s\-]{2,38}?)(?:\*\*|__)?[.!?]?$/,
    },
    {
      type: 'appositive',
      regex:
        /^(?:The\s+|A\s+|An\s+)?(?:\*\*|__)?(?<term>[A-Z][A-Za-z0-9\s\-]{2,34}?)(?:\*\*|__)?,\s+(?<def>(?:a|an|the)\s+[^,\n]{14,150}),\s+(?:is|are|was|were|plays|provides|allows|functions|serves|acts|consists|controls|regulates)\b/,
    },
    {
      // "According to the levels of processing theory, thinking about meaning produces a stronger trace ..."
      type: 'according',
      regex:
        /^According\s+to\s+(?:the\s+)?(?<term>[A-Za-z][\w'’-]*(?:\s+[\w'’-]+){0,5}?\s+(?:theory|principle|law|model|hypothesis|rule|theorem))\s*,\s+(?<def>[a-z][^\n]{14,260}[.!?])$/,
    },
  ];
  const IMPERATIVE_DEF_RE = /^(?:do\s+not|don['’]t|never|always|be\s+sure|make\s+sure|remember|note|see|try|avoid|beware|let)\b/i;
  const CREDIT_LABEL_RE = /^(?:sources?|credits?|courtesy|photo|image|links?|url|website|isbn|copyright|authors?|editors?|publisher|date|e-?mail|phone)$/i;

  /** Every rule reading of one (markdown-free) sentence, in rule order. */
  function read(cleanItem) {
    const out = [];
    for (const rule of DEFINITION_RULES) {
      const m = cleanItem.match(rule.regex);
      if (!m || !m.groups) continue;
      const term = m.groups.term.trim();
      const acro = m.groups.acronym ? ` (${m.groups.acronym.trim()})` : '';
      let def = (m.groups.def || '').trim();
      // "...converted to the Fahrenheit This gas is called a Bose-Einstein scale": the def is a glued fragment
      if (rule.type === 'reverse_def' && /\b(?:This|These|That|Those|Such|It|They)(?:\s+\w+)?$/.test(def)) continue;
      // "Power: lim [f(x)]^n = L^n" is a formula label inside a theorem, not a glossary entry
      if (rule.type === 'glossary' && /[=→∞≠<>√]|^(?:lim|sin|cos|tan|log|ln)\b/.test(def.slice(0, 30))) continue;
      // "Source: Library of Congress ..." under a portrait is a credit line, not a glossary entry
      if (rule.type === 'glossary' && CREDIT_LABEL_RE.test(term)) continue;
      // "Nonrelational Table— Do not fall into a common trap.": advice after a caption, not what the term means.
      if (IMPERATIVE_DEF_RE.test(def)) continue;
      if (rule.type === 'copula') {
        const idx = cleanItem.indexOf(term);
        if (idx !== -1) {
          def = cleanItem
            .slice(idx + term.length)
            .replace(/^\s*\([^)]+\)\s*/, '')
            .replace(/^\s*(?:is\s+defined\s+as|can\s+be\s+defined\s+as|refers\s+to|denotes|is|are)\s+/i, '')
            .trim();
        }
      }
      out.push({ term: `${term}${acro}`, def });
    }
    return out;
  }

  /** deps: { cleanMarkdown, isHeadingLine }. Lines are trimmed, non-empty text lines. */
  function headingBlocks(lines, deps) {
    const out = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const plainLine = deps.cleanMarkdown(lines[i]);
      const defHead = plainLine.match(/^(Definitions?\s+of\s+[A-Z][A-Za-z0-9\s,\-()\/]{2,60})$/);
      const thmHead = plainLine.match(/^THEOREM\s+([A-Z0-9]+\.\d+)\s*([A-Za-z0-9\s,\-()'\/]{0,55})$/i);
      if (!defHead && !thmHead) continue;
      const sub = thmHead && thmHead[2].trim();
      const title = defHead ? defHead[1].trim() : sub ? `Theorem ${thmHead[1]} — ${sub}` : `Theorem ${thmHead[1]}`;
      const bodyLines = [];
      for (let k = i + 1; k < Math.min(lines.length, i + 25); k++) {
        const nextPlain = deps.cleanMarkdown(lines[k]);
        if (/^(?:THEOREM\s+|Definitions?\s+of\b|EXAMPLE\s+\d+|Proof\b|REMARK\b|Solution\b)/i.test(nextPlain)) break;
        if (deps.isHeadingLine(lines[k])) break;
        bodyLines.push(nextPlain);
      }
      if (bodyLines.length > 0) out.push({ title, body: bodyLines.join(' '), category: defHead ? 'Definition' : 'Theorem' });
    }
    return out;
  }

  const api = { read, headingBlocks };
  PDFStudy.definitionRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Math-Safe Text Utilities (shared MATH CONTRACT with src/pdf and src/ui)
 * Inline math is `$...$`, display math is `$$...$$` (TeX inside), inline code is `...` in backticks.
 * NLP masks these spans as atomic tokens before sentence splitting / noise filtering, so formulas are
 * never split, stripped, blanked or mangled, then restores them verbatim.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SPAN_RE = /```[\s\S]+?```|\$\$[\s\S]+?\$\$|\$[^$\n]+?\$|`[^`\n]+`/g;
  const TOKEN = (i) => `\u27E6M${i}\u27E7`; // ⟦M0⟧: letters/digits only inside, never in PUA (cleanMarkdown strips PUA)
  const TOKEN_RE = /\u27E6M(\d+)\u27E7/g;

  /** Replace every math/code span with an atomic placeholder. */
  function mask(text) {
    const spans = [];
    const masked = String(text || '').replace(SPAN_RE, (m) => {
      spans.push(m);
      return TOKEN(spans.length - 1);
    });
    return { text: masked, spans };
  }

  function unmask(text, spans) {
    if (!spans || !spans.length) return text;
    return String(text || '').replace(TOKEN_RE, (m, i) => (spans[+i] !== undefined ? spans[+i] : m));
  }

  /** Abbreviations whose period never ends a sentence ("Fig. 2.1", "Thm. 3", "e.g. f(x)"). */
  const ABBREV_RE =
    /\b(Fig|Figs|Eq|Eqs|Eqn|Thm|Thms|Def|Defn|Prop|Cor|Lem|Ex|Exs|Sec|Secs|Ch|Chap|Dr|Prof|Mr|Mrs|Ms|St|vs|etc|al|cf|approx|resp|ca|No|Nos|Vol|pp|p|e\.g|i\.e|w\.r\.t|a\.k\.a)\./gi;

  /**
   * Protects math periods: decimals (3.14, .5), section refs (2.1.3), abbreviations, single-letter
   * initials inside formulas ("x. y" stays split only when followed by a capitalized word).
   * Returns { text, restore(s) }.
   */
  function protect(text) {
    const { text: masked, spans } = mask(text);
    const guarded = masked
      .replace(TOKEN_RE, (m, i) => (/(?<![.\\])[.!?]\$\$?$/.test(spans[+i] || '') ? `${m}\u2025` : m))
      .replace(ABBREV_RE, '$1\u2024')
      .replace(/(\d)\.(?=\d)/g, '$1\u2024')
      .replace(/(^|[\s(=+\-−])\.(?=\d)/g, '$1\u2024');
    const restore = (s) => unmask(String(s).replace(/\u2024/g, '.').replace(/\u2025/g, ''), spans);
    return { text: guarded, restore };
  }

  const MATH_SYMBOL_RE = /[=≤≥≠≈±∞∫∑∏√→⇒⇔∂∇∈∉⊂⊆∪∩∀∃′θπλσΣΔΘΩ^]|\\(?:frac|lim|int|sum|prod|sqrt|log|ln|sin|cos|tan|Theta|Omega|to|le|ge|infty)\b/;
  const COMPLEXITY_RE = /^\$?\s*(?:O|o|Θ|Ω|ω|\\Theta|\\Omega|\\omega|Big-O)\s*\(\s*[^)]*\)\s*\$?$/;

  /** True when the text contains any math span or math operator. */
  function hasMath(text) {
    const s = String(text || '');
    return /\$[^$]+\$/.test(s) || MATH_SYMBOL_RE.test(s);
  }

  /** Strip the $ / code fences for plain-text analysis (letters ratio, keys) while keeping the TeX body. */
  function plain(text) {
    return String(text || '')
      .replace(/```([\s\S]+?)```/g, ' $1 ')
      .replace(/\$\$?([^$]+)\$\$?/g, ' $1 ')
      .replace(/`([^`]+)`/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** True when an answer string is an expression / formula rather than prose. */
  function isFormula(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    if (/^\$[\s\S]+\$$/.test(s) || COMPLEXITY_RE.test(s)) return true;
    const p = plain(s);
    const words = (p.match(/\b[A-Za-z]{4,}\b/g) || []).filter((w) => !/^(?:frac|sqrt|lim|int|sum|prod|log|sin|cos|tan|Theta|Omega|infty|cdot|times)$/.test(w));
    return MATH_SYMBOL_RE.test(p) && words.length <= 1;
  }

  function isComplexity(text) {
    return COMPLEXITY_RE.test(String(text || '').trim());
  }

  /** Normalized key for formula equality ("$O(n \\log n)$" == "O(n log n)"). */
  function formulaKey(text) {
    return plain(text).replace(/\\(?:left|right|,|;|!)/g, '').replace(/\\/g, '').replace(/[\s{}]/g, '').toLowerCase();
  }

  /** Wrap a bare TeX/Unicode expression in $...$ unless it already carries fences. */
  function fence(expr) {
    const s = String(expr || '').trim();
    if (!s || /^\$[\s\S]*\$$/.test(s) || /^`[^`]*`$/.test(s)) return s;
    return `$${s}$`;
  }

  /** True when $ fences, {} braces, and ()/[] interval brackets are balanced (half-open [a, b) allowed). */
  function isBalanced(text) {
    const s = String(text || '').replace(/```[\s\S]*?```|`[^`\n]*`/g, '');
    const dollars = (s.replace(/\$\$/g, '').match(/\$/g) || []).length;
    if (dollars % 2) return false;
    let brace = 0;
    let group = 0; // ( or [ opens, ) or ] closes so half-open intervals [a, b) and (a, b] pass
    for (const ch of s) {
      if (ch === '{') brace++;
      else if (ch === '}') brace--;
      else if (ch === '(' || ch === '[') group++;
      else if (ch === ')' || ch === ']') group--;
      if (brace < 0 || group < 0) return false;
    }
    return brace === 0 && group === 0;
  }

  /** True when an option string carries math notation (used to keep option sets homogeneous). */
  function hasMathToken(text) {
    return /\$|\\[a-zA-Z]+|[=^≤≥≠≈±∞∫∑∏√]|(?:O|Θ|Ω)\(/.test(String(text || ''));
  }

  /** Truncate text to ~maxLen at a sentence/word boundary without ever cutting inside $...$, $$...$$, or `...`. */
  function safeSlice(text, maxLen = 480) {
    const s = String(text || '').trim();
    if (s.length <= maxLen && isBalanced(s)) return s;
    const { text: masked, spans } = mask(s);
    let out = '', lastSent = '';
    for (const part of masked.split(/(\s+)/)) {
      const next = unmask(out + part, spans);
      if (out && next.length > maxLen) break;
      out += part;
      if (/(?:[.!?]|\u27E6M\d+\u27E7)$/.test(out.trim()) && next.length >= maxLen * 0.45) lastSent = out;
    }
    const chosen = lastSent || out;
    return unmask(chosen, spans).replace(/\$[^$]*$/, '').replace(/[,;:\s]+$/, '').trim();
  }

  const api = {
    SPAN_RE, mask, unmask, protect, hasMath, hasMathToken, plain, isFormula, isComplexity, formulaKey, fence, isBalanced, safeSlice,
  };
  PDFStudy.mathText = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

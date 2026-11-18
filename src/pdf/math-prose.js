/**
 * Prose Inside Math Repair (100% offline, deterministic).
 * The 2D formula builder sometimes wraps ordinary words in TeX: "$\text{Let}p$", "$p\,\text{and}\,q$",
 * "$p, q, r, s,\ldots.\,\text{The}$", a whole caption sentence "$This elevator panel “skips” the$", or a photo
 * credit "$© \text{John}\,Bell/iStockphoto.$". Such debris would be read as confident (and wrong) LaTeX.
 *
 * unwrapProse(text) moves words out of math and falls back to plain text when a "formula" is really prose:
 *   - leading / trailing / interior \text{words} leave the math:  "$\text{Let}p$" -> "Let $p$"
 *   - a math segment with no mathematical evidence (MATH_EVIDENCE_RE) that holds PROSE_WORDS real words
 *     outside \text{} is plain text
 *   - a segment with a © credit is plain text (© never appears in mathematics)
 * Genuine formulas ("$p\wedge q$", "$\{a, b\}$", "$x + 1 = 2$") are left untouched.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PROSE_WORDS = 3; // words of WORD_MIN+ letters outside \text{} that make a math segment prose ("[low, high]" stays)
  const WORD_MIN = 3;
  const TEXT_RE = /\\text\{([^{}]*)\}/g;
  const SPACING_RE = /\\[,;:!]|\\quad|\\qquad|~/g;
  const MATH_SEG_RE = /\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g;

  // Evidence of real mathematics: relations / operators, sub- and superscripts (not the empty-base "{}_{" debris
  // the builder wraps around quoted prose), any TeX command other than text / spacing / dots, math symbols
  const MATH_EVIDENCE_RE = /[=<>+^×÷±≤≥≠∈∉⊂⊆∪∩∑∏∫√→↔∧∨¬⊕]|[^}]_|^_|\\(?!text\b|quad\b|qquad\b|ldots\b|dots\b)[A-Za-z]+/;

  const hasMath = (tex) => MATH_EVIDENCE_RE.test(tex.replace(TEXT_RE, ' ').replace(/\{\}_\{/g, '{'));

  /** Words of WORD_MIN+ letters that are not TeX commands and not inside \text{}. */
  function bareWords(tex) {
    const outside = tex.replace(TEXT_RE, ' ').replace(/\\(?:begin|end)\{[^{}]*\}/g, ' ').replace(/\\[A-Za-z]+/g, ' ');
    return (outside.match(new RegExp(`[A-Za-z’']{${WORD_MIN},}`, 'g')) || []).filter((w) => !/^(?:sin|cos|tan|log|lim|max|min|mod|gcd|lcm)$/i.test(w));
  }

  /** Plain-text reading of a TeX segment: \text{} unwrapped, spacing commands -> spaces, empty groups dropped. */
  function plainOf(tex) {
    return tex
      .replace(TEXT_RE, ' $1 ')
      .replace(SPACING_RE, ' ')
      .replace(/\{\}_\{([^{}]*)\}/g, '$1')
      .replace(/\\ldots|\\dots/g, '...')
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const isWordText = (s) => /^[A-Za-z][A-Za-z’'\-]*(?:\s+[A-Za-z][A-Za-z’'\-]*)*[.,;:]?$/.test(s.trim());

  /** Splits interior / edge \text{words} out of one inline math body. Returns replacement text. */
  function splitInline(body) {
    const parts = [];
    let last = 0;
    const re = /(?:\\[,;:!]|\\quad|\s)*\\text\{([^{}]*)\}(?:\\[,;:!]|\\quad|\s)*/g;
    let m;
    while ((m = re.exec(body))) {
      if (!isWordText(m[1])) continue;
      parts.push({ math: body.slice(last, m.index) });
      parts.push({ words: m[1].trim() });
      last = m.index + m[0].length;
    }
    parts.push({ math: body.slice(last) });
    const out = parts.map((p) => {
      if (p.words !== undefined) return p.words;
      const t = p.math.trim();
      return t ? `$${t}$` : '';
    }).filter(Boolean);
    return out.join(' ');
  }

  /**
   * An italic variable glued to the roman words after it ("$Ais a$" = "$A$ is a", "$Sis a$"), or an italic article
   * glued to the italic term it introduces ("$Aset$" = "A set"): the letter is split off, as a variable before a
   * verb and as plain text before a noun.
   */
  // (Only "A" is read as an article: "$Max$" or "$Var$" stay what they are.)
  const GLUED_LETTER_RE = /^([A-Z])((?:is|are|has|have|was|were|be|and|or)\b[a-z ]*)$|^(A)([a-z]{2,}(?:\s+[a-z]+)*)$/;
  function ungludeLetter([, varLetter, verbRest, article, nounRest]) {
    const letter = varLetter || article;
    const rest = verbRest || nounRest;
    const verb = /^(?:is|are|has|have|was|were|be|and|or)\b/.test(rest);
    return verb ? `$${letter}$ ${rest.trim()}` : `${letter} ${rest.trim()}`;
  }

  function repairSegment(whole, display, inline) {
    const body = display !== undefined ? display : inline;
    if (body.includes('©') || (!hasMath(body) && bareWords(body).length >= PROSE_WORDS)) return plainOf(body);
    if (display !== undefined) return whole; // display formulas keep their \text{} labels
    const glued = !hasMath(body) && plainOf(body).match(GLUED_LETTER_RE);
    if (glued) return ungludeLetter(glued);
    if (!/\\text\{/.test(body)) return whole;
    return splitInline(body);
  }

  function unwrapProse(text) {
    const s = String(text || '');
    if (!s.includes('$')) return s;
    return s.replace(MATH_SEG_RE, (whole, display, inline) => repairSegment(whole, display, inline)).replace(/[ \t]{2,}/g, ' ');
  }

  PDFStudy.mathProse = { unwrapProse, bareWords, plainOf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.mathProse;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Typed Answers: checks what a student typed against a typed question's expected answer (DOM-free, no storage).
 * A typed question (typed-questions.js, typed-values.js) carries:
 *   { type: 'typed', answer, accept: [display forms], form, others: [terms], shown: [forms the prompt prints],
 *     symbols?: { not: ['!', '~', 'not'] }, checks?: { near, looseHead } }
 *   form  'term'        a term of 1-4 words                    -> typed-terms.js
 *         'number'      a number (or a range) with its unit    -> typed-numbers.js
 *         'bits'        a bit string ("0b" before it is allowed)
 *         'truth'       a truth value (accept lists the forms: "T", "true" or "1")
 *         'expression'  a short symbolic expression ("$\neg q \to \neg p$")
 *
 * A term is matched word by word, its forms and slips as typed-terms.js says; a pair of quotes alone ("") is the
 * words "empty string". A number is checked numerically, number words and powers read as digits, its unit matched or
 * converted exactly, and required when the prompt asks for it. An expression matches with spaces ignored and common
 * keyboard forms read as the symbols: "->" for →, "<->" for ↔, "'" after a letter for a complement bar, and "!", "~"
 * or "not" for ¬ only when the question's symbols allow it.
 *
 * check(q, typed) -> { correct, verdict, message }
 *   verdict 'right' | 'spelled' | 'qualified' | 'empty' | 'other' | 'shown' | 'unit' | 'wrong'
 * termKey(text), parseNumber(text), expressionKey(text, symbols), editDistance(a, b), hintFor(q)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const EDGE_PUNCT_RE = /^[\s"'“”‘’`.,;:!?()[\]{}]+|[\s"'“”‘’`.,;:!?()[\]{}]+$/g;
  const QUOTES_ONLY_RE = /^\s*["'“”‘’`]{2}\s*$/;

  const nfkc = (s) => {
    const t = String(s == null ? '' : s);
    return t.normalize ? t.normalize('NFKC') : t;
  };

  // Terms: typed-terms.js. Numbers and their units: typed-numbers.js.
  const terms = () => PDFStudy.typedTerms || (typeof require === 'function' ? require('./typed-terms.js') : null);
  const nums = () => PDFStudy.typedNumbers || (typeof require === 'function' ? require('./typed-numbers.js') : null);
  const forms = () => PDFStudy.typedForms || (typeof require === 'function' ? require('./typed-forms.js') : null);
  const parseNumber = (text) => nums().parseNumber(text);
  const unitKey = (text) => nums().unitKey(text);
  const knownUnit = (text) => nums().knownUnit(text);
  const termKey = (text) => terms().termKey(text);
  const editDistance = (a, b) => terms().editDistance(a, b);
  const singular = (w) => forms().singular(w);

  const TEX_SYMBOLS = [
    [/\\(?:leftrightarrow|iff|Leftrightarrow)/g, '↔'], [/\\(?:to|rightarrow|Rightarrow|implies)/g, '→'], [/\\(?:neg|lnot)/g, '¬'],
    [/\\(?:wedge|land)/g, '∧'], [/\\(?:vee|lor)/g, '∨'], [/\\oplus/g, '⊕'], [/\\cdot/g, '·'],
  ];

  /**
   * Comparison key of a short expression. TeX and typed forms meet: "\overline{A}" and "A'" are one, "\to" and "->" are
   * one; "!", "~" and "not" read as ¬ only when symbols.not lists them (the section writes negation that way).
   */
  function expressionKey(text, symbols = {}) {
    let s = nfkc(text).replace(/\$/g, '');
    s = s.replace(/\\overline\{([A-Za-z0-9])\}/g, "$1'").replace(/\\overline\{([^{}]+)\}/g, "($1)'").replace(/\\bar\{([A-Za-z0-9])\}/g, "$1'");
    for (const [re, sym] of TEX_SYMBOLS) s = s.replace(re, sym);
    s = s.replace(/<->|<=>/g, '↔').replace(/->|=>/g, '→').replace(/[’‘`]/g, "'");
    const not = (symbols && symbols.not) || [];
    if (not.includes('not')) s = s.replace(/\bnot\s+/gi, '¬');
    if (not.includes('!')) s = s.replace(/!/g, '¬');
    if (not.includes('~')) s = s.replace(/~/g, '¬');
    return s.replace(/[{}\s]/g, '');
  }

  const result = (correct, verdict, message) => ({ correct, verdict, message });

  /** "0b10 1101", "1011_0110": the bits alone. */
  const bitsOf = (text) => String(text).trim().replace(/^0b/i, '').replace(/[\s_]+/g, '');

  function check(q, typed) {
    const raw = String(typed == null ? '' : typed);
    // A pair of quotes and nothing else is how a string with no characters is written.
    const text = QUOTES_ONLY_RE.test(raw) ? 'empty string' : raw.trim();
    if (!q || !text) return result(false, 'empty', 'Type an answer first.');
    const form = q.form || 'term';
    if (form === 'number') return nums().checkNumber(q, text);
    if (form === 'bits') {
      const bits = bitsOf(text);
      return /^[01]+$/.test(bits) && bits === String(q.answer).replace(/\s+/g, '') ? result(true, 'right', 'Correct.') : result(false, 'wrong', 'Not quite.');
    }
    if (form === 'truth') {
      const ok = [q.answer, ...(q.accept || [])].map((a) => String(a).trim().toLowerCase()).includes(text.toLowerCase().replace(EDGE_PUNCT_RE, ''));
      return ok ? result(true, 'right', 'Correct.') : result(false, 'wrong', 'Not quite.');
    }
    if (form === 'expression') {
      const key = expressionKey(text, q.symbols);
      const ok = [q.answer, ...(q.accept || [])].some((a) => expressionKey(a, q.symbols) === key);
      return ok ? result(true, 'right', 'Correct.') : result(false, 'wrong', 'Not quite.');
    }
    return terms().checkTerm(q, text);
  }

  /** The on-screen hint of what form the answer takes. */
  function hintFor(q) {
    const form = (q && q.form) || 'term';
    if (form === 'number') return parseNumber(q.answer) && parseNumber(q.answer).unit ? 'A number with its unit' : 'A number';
    if (form === 'bits') return 'A bit string of 0s and 1s';
    if (form === 'truth') return /^[01]$/.test(String(q.answer)) ? '1 or 0' : 'T or F';
    if (form === 'expression') return 'A short expression (type -> for →)';
    return 'One term';
  }

  const api = { check, termKey, parseNumber, unitKey, knownUnit, expressionKey, editDistance, hintFor, singular };
  PDFStudy.typedCheck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

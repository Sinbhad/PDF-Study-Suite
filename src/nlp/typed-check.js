/**
 * Typed Answers: checks what a student typed against a typed question's expected answer (DOM-free, no storage).
 * A typed question (typed-questions.js) carries:
 *   { type: 'typed', answer, accept: [display forms], form, others: [terms], shown: [forms the prompt prints],
 *     symbols?: { not: ['!', '~', 'not'] } }
 *   form  'term'        a term of 1-4 words
 *         'number'      a number (or a range) with its unit
 *         'bits'        a bit string
 *         'truth'       a truth value (accept lists the forms: "T", "true" or "1")
 *         'expression'  a short symbolic expression ("$\neg q \to \neg p$")
 *
 * A term matches when it is one of the accepted forms once case, surrounding punctuation, articles, hyphens and
 * spaces, apostrophes and a plural s/es are ignored. For a form of 6+ letters one edit (insertion, deletion,
 * substitution or transposition of two neighbours) is forgiven and the result says how the answer is spelled. A
 * typed term that is another term of the scope (`others`) or a form the prompt already prints (`shown`) is never
 * right, nor is a near miss that is as close to another term as to the answer. The answer with one or two qualifying
 * words more ("binary relation" for "relation") is right unless they negate it or make it another term, and so are a
 * term of three or more words without its last word and the initials of a longer term ("ICs"), when no other term of
 * the scope reads the same; a roman numeral after "type", "class", "stage" ... is its number ("type I" is "type 1").
 * A number is checked numerically, its unit optional but matched or converted exactly (typed-numbers.js).
 * An expression matches with spaces ignored and common keyboard forms read as the symbols: "->" for →, "<->" for ↔,
 * "'" after a letter for a complement bar, and "!", "~" or "not" for ¬ only when the question's symbols allow it.
 *
 * check(q, typed) -> { correct, verdict, message }
 *   verdict 'right' | 'spelled' | 'qualified' | 'empty' | 'other' | 'shown' | 'unit' | 'wrong'
 * termKey(text), parseNumber(text), expressionKey(text, symbols), editDistance(a, b), hintFor(q)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_FUZZY_LETTERS = 6;
  const ARTICLES = new Set(['a', 'an', 'the']);
  const EDGE_PUNCT_RE = /^[\s"'“”‘’`.,;:!?()[\]{}]+|[\s"'“”‘’`.,;:!?()[\]{}]+$/g;

  const nfkc = (s) => {
    const t = String(s == null ? '' : s);
    return t.normalize ? t.normalize('NFKC') : t;
  };

  /** "latches" -> "latch", "keys" -> "key", "classes" -> "class"; "status", "analysis" stay. */
  function singular(word) {
    const w = word;
    if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  // "Hansen's type I" is "Hansen's type 1": a roman numeral after a word that numbers kinds.
  const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6' };
  const NUMBERS_KINDS = new Set(['type', 'class', 'grade', 'stage', 'phase', 'level', 'degree', 'group', 'form']);

  /** The words of a term as compared: lower case, no edge punctuation, no apostrophes, no articles. */
  function termWords(text) {
    const s = nfkc(text).toLowerCase().replace(/\$/g, '').replace(/[’'`]/g, '').replace(EDGE_PUNCT_RE, '');
    const words = s.split(/[\s\-–—_/]+/).map((w) => w.replace(/[^a-z0-9α-ω+#.]/g, '')).filter((w) => w && !ARTICLES.has(w));
    return words.map((w, i) => (ROMAN[w] && i > 0 && NUMBERS_KINDS.has(words[i - 1]) ? ROMAN[w] : w));
  }

  /** Comparison key of a term: its words singular and run together, so hyphens and spaces do not count. */
  const termKey = (text) => termWords(text).map(singular).join('');
  /** The same without the plural folding, for judging a slip ("synaps" is one letter from "synapse"). */
  const spellingKey = (text) => termWords(text).join('');
  /** The fewer edits between two texts, read with and without plural folding. */
  const slips = (a, b) => Math.min(editDistance(termKey(a), termKey(b)), editDistance(spellingKey(a), spellingKey(b)));

  /** Optimal string alignment distance (Damerau-Levenshtein where a transposition counts one edit). */
  function editDistance(a, b) {
    const s = String(a);
    const t = String(b);
    const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...new Array(t.length).fill(0)]);
    for (let j = 1; j <= t.length; j++) d[0][j] = j;
    for (let i = 1; i <= s.length; i++) {
      for (let j = 1; j <= t.length; j++) {
        const cost = s[i - 1] === t[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && s[i - 1] === t[j - 2] && s[i - 2] === t[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[s.length][t.length];
  }

  // Numbers and their units: typed-numbers.js.
  const nums = () => PDFStudy.typedNumbers || (typeof require === 'function' ? require('./typed-numbers.js') : null);
  const parseNumber = (text) => nums().parseNumber(text);
  const unitKey = (text) => nums().unitKey(text);
  const knownUnit = (text) => nums().knownUnit(text);
  const checkNumber = (q, typed) => nums().checkNumber(q, typed);

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


  const MAX_QUALIFIER_WORDS = 2;
  const NEGATING_RE = /^(?:no|not|non|un|in|anti|without|never)$/;
  /** Does `typed` hold the whole of `term` as a run of words? */
  function contains(typed, term) {
    const t = termWords(typed).map(singular).join(' ');
    const w = termWords(term).map(singular).join(' ');
    return Boolean(w) && ` ${t} `.includes(` ${w} `);
  }
  /** `typed` is `answer` with one or two more words that do not negate it. */
  function withQualifier(typed, answer) {
    const extra = termWords(typed).length - termWords(answer).length;
    if (extra < 1 || extra > MAX_QUALIFIER_WORDS || !contains(typed, answer)) return false;
    const own = new Set(termWords(answer).map(singular));
    return termWords(typed).map(singular).filter((w) => !own.has(w)).every((w) => !NEGATING_RE.test(w) && /[a-z]/.test(w));
  }

  const MIN_SHORTENED_WORDS = 3;
  /** The term without its last word, for a term of three or more words; '' otherwise. */
  function shortForm(term) {
    const w = termWords(term);
    return w.length >= MIN_SHORTENED_WORDS ? w.slice(0, -1).map(singular).join('') : '';
  }
  /** The initials of a term of two or more words ("integrated circuits" -> "ic"); '' otherwise. */
  function initials(term) {
    const w = termWords(term).filter((x) => /^[a-z]/.test(x));
    return w.length >= 2 ? w.map((x) => x[0]).join('') : '';
  }

  function checkTerm(q, typed) {
    const key = termKey(typed);
    if (!key) return result(false, 'empty', 'Type an answer first.');
    const accepted = [q.answer, ...(q.accept || [])].map((a) => ({ a, key: termKey(a) })).filter((x) => x.key);
    const others = (q.others || []).filter((o) => termKey(o) && !accepted.some((x) => x.key === termKey(o)));
    if (accepted.some((x) => x.key === key)) return result(true, 'right', 'Correct.');
    if (others.some((o) => termKey(o) === key)) return result(false, 'other', 'Not quite: that is another term from this section.');
    if ((q.shown || []).map(termKey).includes(key)) return result(false, 'shown', 'Not quite: that name is already in the question.');
    // The answer with a qualifier the material does not need ("binary relation" for "relation", "out-of-bounds error" for
    // "bounds error"), unless the qualifier negates it or makes it another term of the scope.
    const qualified = accepted.find((x) => withQualifier(typed, x.a));
    if (qualified && !others.some((o) => contains(typed, o))) return result(true, 'qualified', `Correct — the material's term is ${String(q.answer).trim()}.`);
    // A term of three or more words without its last ("referential integrity" for "referential integrity constraint"),
    // or the initials of a term of two or more words ("ICs" for "integrated circuits"), when no other term reads so.
    const bare = key.replace(/s$/, ''); // "ICs" -> "ic"
    const short = accepted.find((x) => shortForm(x.a) === key || [key, bare].includes(initials(x.a)));
    if (short && !others.some((o) => shortForm(o) === key || [key, bare].includes(initials(o)))) return result(true, 'qualified', `Correct — the material's term is ${String(q.answer).trim()}.`);
    // One slip is forgiven in a long enough word, unless the slip lands as close to another term.
    const near = accepted.find((x) => x.key.replace(/[^a-z]/g, '').length >= MIN_FUZZY_LETTERS && slips(typed, x.a) <= 1);
    if (near && !others.some((o) => slips(typed, o) <= 1)) return result(true, 'spelled', `Correct — spelled ${String(q.answer).trim()}.`);
    return result(false, 'wrong', 'Not quite.');
  }

  function check(q, typed) {
    const text = String(typed == null ? '' : typed).trim();
    if (!q || !text) return result(false, 'empty', 'Type an answer first.');
    const form = q.form || 'term';
    if (form === 'number') return checkNumber(q, text);
    if (form === 'bits') {
      const bits = text.replace(/\s+/g, '');
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
    return checkTerm(q, text);
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

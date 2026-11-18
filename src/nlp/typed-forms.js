/**
 * Typed Forms: the forms one word of a typed answer may take and still be the same word, and the words whose every
 * letter matters (DOM-free; typed-check.js compares terms word by word with these).
 *   lemmas(word)        -> Set of the singulars the word may stand for: the regular -s/-es/-ies plural and the
 *                          Latin and Greek ones ("sera" -> serum, "bacteria" -> bacterium, "nuclei" -> nucleus,
 *                          "analyses" -> analysis, "indices" -> index/indix, "vertebrae" -> vertebra, "criteria" ->
 *                          criterion); two words are one when their sets meet
 *   derivationStem(w)   -> the stem a verb and its -ion/-ment/-ing noun share ("insertion", "insert" -> "insert";
 *                          "deletion", "delete" -> "delet"), '' for a word too short to tell
 *   englishAdjective(w) -> the English form of a Latin adjective ("hemorrhagica" -> "hemorrhagic", "lateralis" ->
 *                          "lateral", "fibrosus" -> "fibrous"), '' when the word is not one
 *   exact(word)         -> true for a word in which one letter changes the meaning: a number, a roman numeral, an
 *                          ordinal, a Greek letter's name or a word carrying a sign
 *   negationPair(a, b)  -> true when one word is the other with a negating prefix ("typical" / "atypical")
 *   canonicalWord(w)    -> ordinals and number words as digits ("first" -> "1st", "two" -> "2"), else the word
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** The regular English singular: "latches" -> "latch", "keys" -> "key"; "status", "analysis" stay. */
  function singular(w) {
    if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }

  // Latin and Greek plural endings and the singular endings they come from (the stem must keep 3+ letters).
  const CLASSICAL = [
    [/ae$/, ['a']], [/ices$/, ['ex', 'ix']], [/a$/, ['um', 'on']], [/i$/, ['us']], [/es$/, ['is']], [/ata$/, ['a']],
  ];
  const MIN_STEM = 3;

  function lemmas(word) {
    const w = String(word || '');
    const out = new Set([w, singular(w)]);
    if (!/^[a-z]+$/.test(w)) return out;
    for (const [re, ends] of CLASSICAL) {
      const stem = w.replace(re, '');
      if (stem === w || stem.length < MIN_STEM) continue;
      for (const e of ends) out.add(stem + e);
    }
    return out;
  }
  const meet = (a, b) => [...lemmas(a)].some((x) => lemmas(b).has(x));

  // A noun made from a verb: "insertion" / "insert", "deletion" / "delete", "assignment" / "assign".
  const DERIVED_RE = /(?:ation|ition|ion|ment|ing|e)$/;
  const MIN_DERIVED_STEM = 4;
  function derivationStem(word) {
    const w = singular(String(word || ''));
    if (!/^[a-z]+$/.test(w)) return '';
    const stem = w.replace(DERIVED_RE, '');
    return stem.length >= MIN_DERIVED_STEM ? stem : '';
  }

  // Latin adjective endings and the English ones they become: -ica/-icus/-icum -> -ic, -alis/-ale -> -al, ...
  const LATIN_ADJECTIVE = [[/ic(?:a|us|um|ae|i)$/, 'ic'], [/al(?:is|e)$/, 'al'], [/ar(?:is|e)$/, 'ar'], [/os(?:a|us|um)$/, 'ous']];
  function englishAdjective(word) {
    const w = String(word || '');
    if (!/^[a-z]{6,}$/.test(w)) return '';
    for (const [re, end] of LATIN_ADJECTIVE) if (re.test(w)) return w.replace(re, end);
    return '';
  }

  const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi',
    'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega']);
  const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const ROMAN_RE = /^(?=[ivxlc]+$)c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/;
  const suffix = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');

  /** "first" -> "1st", "two" -> "2"; any other word comes back as it is. */
  function canonicalWord(w) {
    const o = ORDINALS.indexOf(w);
    if (o >= 0) return `${o}${suffix(o)}`;
    const n = SMALL_NUMBERS.indexOf(w);
    return n >= 0 ? String(n) : w;
  }

  /** A word in which a one-letter change is a different thing, never a spelling slip. */
  function exact(word) {
    const w = String(word || '');
    return /\d|[+−±]/.test(w) || GREEK.has(w) || (w.length <= 4 && ROMAN_RE.test(w)) || ORDINALS.includes(w);
  }

  const NEGATING_PREFIX_RE = /^(?:a|an|un|in|im|il|ir|non|dis|anti|counter)$/;
  function negationPair(a, b) {
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    return long.endsWith(short) && NEGATING_PREFIX_RE.test(long.slice(0, long.length - short.length));
  }

  const api = { lemmas, meet, singular, derivationStem, englishAdjective, exact, negationPair, canonicalWord };
  PDFStudy.typedForms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

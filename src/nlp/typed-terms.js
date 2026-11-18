/**
 * Typed Terms: whether a typed term is the expected one (DOM-free; typed-check.js asks for form 'term').
 * A typed question carries { answer, accept: [other names], others: [the scope's other terms], shown: [names the
 * prompt prints], checks?: { near: [real words one letter from the answer's], looseHead: true } }.
 *
 * Read word by word, once case, edge punctuation, articles, apostrophes, hyphens and spaces are set aside:
 *   right      the answer or an accepted name; a word may be in either number, Latin and Greek plurals included
 *              ("sera" for "serum"); a modifier may be the verb or its noun ("insert anomaly" for "insertion
 *              anomaly"); a Latin adjective may follow or precede in its English form ("hemorrhagic purpura" for
 *              "purpura hemorrhagica"); a roman numeral, number word or ordinal after "type", "class", ... is its
 *              number; a CamelCase identifier is its words
 *   qualified  a shorter or longer name that no other term of the scope also reads as: the kind word left out
 *              ("Hansen 1" for "Hansen's type 1"), a run of words as initials ("RI constraint"), the initials of the
 *              whole term ("ICs"), a term of three or more words without its last, and the answer with one or two
 *              words more ("binary relation" for "relation", "anti-C6 antibodies" for "antibodies") unless they
 *              negate it or make it another term; when the scope uses the answer's head for many things
 *              (checks.looseHead) the extra words may stand in for that head ("index out of bounds" for "bounds
 *              error"), though the bare modifier alone ("bounds") is not the answer
 *   spelled    one slip (insertion, deletion, substitution or swap) inside one word of 6+ letters; never in a number,
 *              roman numeral, ordinal, sign or Greek letter's name, never a negating prefix, never when the slip is
 *              itself a real word of the scope (checks.near) or as close to another term
 * A term of the scope (`others`) or a name the prompt prints (`shown`) is never right.
 *
 * checkTerm(q, typed) -> { correct, verdict, message }    termWords(text) -> ['hansen', 'type', '1']
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const F = () => PDFStudy.typedForms || (typeof require === 'function' ? require('./typed-forms.js') : null);

  const MIN_FUZZY_LETTERS = 6;
  const MAX_QUALIFIER_WORDS = 2;
  const MAX_EXTRA_WORDS = 4;
  const MIN_SHORTENED_WORDS = 3;
  const MIN_CAMEL_LENGTH = 10;
  const ARTICLES = new Set(['a', 'an', 'the']);
  const EDGE_PUNCT_RE = /^[\s"'“”‘’`.,;:!?()[\]{}]+|[\s"'“”‘’`.,;:!?()[\]{}]+$/g;
  // Words that join a qualifier to the term without adding a meaning of their own ("index out of bounds").
  const FUNCTION_WORDS = new Set(['of', 'out', 'in', 'on', 'at', 'for', 'to', 'by', 'from', 'with']);
  const NEGATING_RE = /^(?:no|not|non|un|anti|without|never)$/;
  const ROMAN = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10' };
  const NUMBERS_KINDS = new Set(['type', 'class', 'grade', 'stage', 'phase', 'level', 'degree', 'group', 'form']);

  const nfkc = (s) => {
    const t = String(s == null ? '' : s);
    return t.normalize ? t.normalize('NFKC') : t;
  };
  const result = (correct, verdict, message) => ({ correct, verdict, message });

  /** The words of a term as compared: lower case, no edge punctuation, apostrophes or articles; numbers as digits. */
  function termWords(text) {
    let s = nfkc(text).replace(/\$/g, '');
    // An identifier written in CamelCase is its words: "ArrayIndexOutOfBounds" -> "Array Index Out Of Bounds".
    s = s.replace(/[A-Za-z]+/g, (w) => (w.length >= MIN_CAMEL_LENGTH && (w.match(/[a-z][A-Z]/g) || []).length >= 2 ? w.replace(/([a-z])([A-Z])/g, '$1 $2') : w));
    s = s.toLowerCase().replace(/[’'`]/g, '').replace(EDGE_PUNCT_RE, '');
    // A sign closing a name is part of it ("CD4-", "Na+"), not a hyphen.
    s = s.replace(/([a-z0-9])[-−](?=\s|$)/g, '$1−');
    // An article opens the answer ("a pressure valve"); "the" is dropped anywhere. A letter inside a name stays: the
    // "A" of "type A" or "hepatitis A virus" is what tells it apart.
    const words = s.split(/[\s\-–—_/]+/).map((w) => w.replace(/[^a-z0-9α-ω+#.−]/g, '').replace(/^\.+|\.+$/g, ''))
      .filter((w, i) => w && w !== 'the' && !(i === 0 && ARTICLES.has(w)));
    return words.map((w, i) => {
      const kindBefore = i > 0 && NUMBERS_KINDS.has(words[i - 1]);
      if (kindBefore && ROMAN[w]) return ROMAN[w];
      return F().canonicalWord(w);
    });
  }

  const joined = (words) => words.map(F().singular).join('');

  /** Are two words one, in number, Latin plural or (for a modifier) derivation? */
  function sameWord(a, b, modifier) {
    if (a === b || F().meet(a, b)) return true;
    if (!modifier) return false;
    const sa = F().derivationStem(a);
    return Boolean(sa) && sa === F().derivationStem(b);
  }

  /** Two word lists naming the same term, word by word (modifiers may differ in derivation). */
  function sameWords(a, b) {
    if (a.length !== b.length) return a.length && b.length ? joined(a) === joined(b) : false;
    return a.every((w, i) => sameWord(w, b[i], i < a.length - 1));
  }

  /** "purpura hemorrhagica" and "hemorrhagic purpura" both read as ['hemorrhagic', 'purpura']. */
  function adjectiveFirst(words) {
    if (words.length !== 2) return words;
    const latin = F().englishAdjective(words[1]);
    return latin ? [latin, words[0]] : words;
  }

  /** The exact readings of a term: as written, and with a Latin adjective in its English place. */
  function readings(text) {
    const w = termWords(text);
    const out = [w];
    const flipped = adjectiveFirst(w);
    if (flipped !== w) out.push(flipped);
    return out;
  }
  const matches = (typedWords, text) => readings(text).some((r) => sameWords(adjectiveFirst(typedWords), adjectiveFirst(r)) || sameWords(typedWords, r));

  /**
   * Shorter readings no other term may share: the kind word dropped before its number, a run of two or more words
   * as initials, the whole term's initials and the last word dropped from a term of 3+ words.
   */
  function looseReadings(text) {
    const w = termWords(text);
    const out = [];
    const kindAt = w.findIndex((x, i) => NUMBERS_KINDS.has(x) && /^\d/.test(w[i + 1] || '') && i > 0);
    if (kindAt > 0) out.push(w.filter((_, i) => i !== kindAt));
    const alpha = (x) => /^[a-z]+$/.test(x);
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 2; j <= w.length; j++) {
        const run = w.slice(i, j);
        if (!run.every(alpha)) break;
        out.push([...w.slice(0, i), run.map((x) => x[0]).join(''), ...w.slice(j)]);
      }
    }
    if (w.length >= MIN_SHORTENED_WORDS) out.push(w.slice(0, -1));
    return out;
  }
  const looseMatch = (typedWords, text) => {
    const bare = typedWords.map((x) => x.replace(/s$/, ''));
    return looseReadings(text).some((r) => sameWords(typedWords, r) || (r.length === 1 && bare.length === 1 && r[0] === bare[0]));
  };

  /** Where `term`'s words run inside `words`: [start, end) or null. */
  function runOf(words, term) {
    for (let i = 0; i + term.length <= words.length; i++) {
      if (term.every((t, k) => sameWord(words[i + k], t, k < term.length - 1))) return [i, i + term.length];
    }
    return null;
  }

  /**
   * `typed` is the term with one or two words more that neither negate it nor make it another term: the extra words
   * hold at most two content words, and no other term of the scope runs over the answer's own words. "anti" before
   * a head that itself names the antibody ("anti-C6 antibodies") names its target, not a negation.
   */
  function withQualifier(typedWords, termText, otherTexts, looseHead) {
    const bases = [termWords(termText)];
    if (looseHead && bases[0].length >= 2) bases.push(bases[0].slice(0, -1));
    for (const base of bases) {
      const extra = typedWords.length - base.length;
      if (extra < 1 || extra > MAX_EXTRA_WORDS) continue;
      const at = runOf(typedWords, base);
      if (!at) continue;
      const head = base[base.length - 1];
      const rest = typedWords.filter((_, i) => i < at[0] || i >= at[1]);
      const namesTarget = (x) => x === 'anti' && head.startsWith('anti');
      if (rest.some((x) => NEGATING_RE.test(x) && !namesTarget(x))) continue;
      const content = rest.filter((x) => !FUNCTION_WORDS.has(x) && !namesTarget(x));
      if (content.length > MAX_QUALIFIER_WORDS || !content.every((x) => /[a-z0-9]/.test(x))) continue;
      const overlaps = otherTexts.some((o) => {
        const r = runOf(typedWords, termWords(o));
        return r && r[0] < at[1] && at[0] < r[1];
      });
      if (!overlaps) return true;
    }
    return false;
  }

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

  /**
   * One slip in one long word, all other words the same. Never in a word where a letter is meaning (a number, a
   * numeral, a sign, a Greek letter), never a negating prefix, never a real word of the scope.
   */
  function oneSlip(typedWords, termText, near) {
    // A single letter is a designation ("vitamin A"), so a joined reading needs words of three letters or more.
    const alphabetic = (list) => list.every((x) => /^[a-z]{3,}$/.test(x) && !F().exact(x));
    return readings(termText).some((r) => {
      // Written as one word or two ("contra-coup" for "contrecoup"): the slip is read across the joined letters.
      if (r.length !== typedWords.length) {
        const a = joined(r);
        return alphabetic(r) && alphabetic(typedWords) && a.length >= MIN_FUZZY_LETTERS && editDistance(joined(typedWords), a) <= 1;
      }
      const diff = r.map((w, i) => (sameWord(typedWords[i], w, i < r.length - 1) ? -1 : i)).filter((i) => i >= 0);
      if (diff.length !== 1) return false;
      const want = r[diff[0]];
      const got = typedWords[diff[0]];
      if (!/^[a-z]+$/.test(want) || want.length < MIN_FUZZY_LETTERS || F().exact(want) || F().exact(got)) return false;
      if (F().negationPair(want, got) || near.has(got) || near.has(F().singular(got))) return false;
      const forms = (x) => [x, F().singular(x)];
      return forms(got).some((g) => forms(want).some((w) => editDistance(g, w) <= 1));
    });
  }

  function checkTerm(q, typed) {
    const words = termWords(typed);
    if (!words.length) return result(false, 'empty', 'Type an answer first.');
    const answer = String(q.answer).trim();
    const accepted = [q.answer, ...(q.accept || [])].filter((a) => termWords(a).length);
    const others = (q.others || []).filter((o) => termWords(o).length && !accepted.some((a) => matches(termWords(o), a)));
    const checks = q.checks || {};
    const near = new Set((checks.near || []).map((w) => String(w).toLowerCase()));
    if (accepted.some((a) => matches(words, a))) return result(true, 'right', 'Correct.');
    if (others.some((o) => matches(words, o))) return result(false, 'other', 'Not quite: that is another term from this section.');
    if ((q.shown || []).some((s) => matches(words, s))) return result(false, 'shown', 'Not quite: that name is already in the question.');
    const qualified = result(true, 'qualified', `Correct — the material's term is ${answer}.`);
    // A shorter name of the answer that no other term reads as too.
    if (accepted.some((a) => looseMatch(words, a)) && !others.some((o) => looseMatch(words, o))) return qualified;
    // The answer with a qualifier the material does not need ("binary relation" for "relation").
    if (accepted.some((a) => withQualifier(words, a, others, checks.looseHead))) return qualified;
    // One slip is forgiven in a long enough word, unless the slip lands as close to another term.
    if (accepted.some((a) => oneSlip(words, a, near)) && !others.some((o) => oneSlip(words, o, new Set()))) {
      return result(true, 'spelled', `Correct — spelled ${answer}.`);
    }
    return result(false, 'wrong', 'Not quite.');
  }

  const termKey = (text) => joined(termWords(text));

  const api = { checkTerm, termWords, termKey, editDistance, matches };
  PDFStudy.typedTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

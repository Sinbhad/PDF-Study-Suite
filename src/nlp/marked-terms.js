/**
 * Marked Terms: the terms a scope itself marks as worth knowing, and where they stand in a sentence.
 * Only these may be blanked out of a sentence, swapped inside one, or offered as an option; a keyphrase
 * that merely scores well is not one of them.
 *   collect(groups, text, accept) -> [{ text, rank, order }]
 *       groups[0] defined terms and flashcard fronts, groups[1] bold terms, groups[2] summariser key terms
 *       (the index is the rank); order is the term's first position in the text
 *   locate(maskedSentence, terms) -> { present: [{ term, hit }], absent: [term] }
 *       a term is found in either grammatical number; one that occurs twice is neither present nor absent
 *   nearest(absent, term, seed)   -> the other terms, same strength of evidence first, then nearest in the text
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const sn = () => dep('stemNoise', './stem-noise.js');
  const os = () => dep('optionSets', './option-sets.js');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const MAX_TERM_CHARS = 48;
  const MAX_TERM_WORDS = 5;
  const NEAR_WINDOW = 6; // a reshuffle only reorders the nearest terms, it never reaches for far ones

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** "Theorem 1.1 — The Squeeze Theorem" -> "Squeeze Theorem"; "Gibbs Free Energy (G)" -> "Gibbs Free Energy". */
  function bareTerm(raw) {
    return String(raw || '').replace(/\*\*|__/g, '').replace(/^.*?\s[—–]\s/, '').replace(/\s*\([^)]*\)?$/, '')
      .replace(/^(?:the|an?)\s+/i, '').replace(/\s+/g, ' ').trim();
  }

  /** Words only, no word twice, no hyphen left hanging by a line break ("third nor-", "depen- dency"). */
  function isWholeTerm(term) {
    if (!/^[A-Za-z][A-Za-z0-9'’ -]*[A-Za-z0-9]$/.test(term) || /-\s|\s-/.test(term)) return false;
    const words = term.toLowerCase().split(' ');
    return new Set(words).size === words.length;
  }

  /** accept(term, rank) is the caller's shape gate. */
  function collect(groups, text, accept) {
    const flat = String(text || '').toLowerCase();
    const seen = new Set();
    const out = [];
    groups.forEach((list, rank) => {
      for (const raw of list || []) {
        const term = bareTerm(raw);
        const key = os().termKey(term);
        if (term.length < 3 || term.length > MAX_TERM_CHARS || term.split(' ').length > MAX_TERM_WORDS) continue;
        if (!key || seen.has(key) || !isWholeTerm(term) || sn().isLabelTerm(term) || !accept(term, rank)) continue;
        seen.add(key);
        const at = flat.indexOf(term.toLowerCase());
        out.push({ text: term, rank, order: at >= 0 ? at : flat.length });
      }
    });
    return out;
  }

  /** The term in either grammatical number, as it may be written in a sentence; longest form first. */
  function numberVariants(term) {
    const forms = [term, `${term}s`, `${term}es`, term.replace(/y$/, 'ies'), term.replace(/ies$/, 'y'), term.replace(/es$/, ''), term.replace(/s$/, '')];
    return [...new Set(forms)].filter((form) => form.length >= 3).sort((a, b) => b.length - a.length);
  }

  function occurrences(masked, term) {
    const forms = numberVariants(term).map(escapeRe).join('|');
    return [...masked.matchAll(new RegExp(`(?<![A-Za-z-])(?:${forms})(?![A-Za-z-])`, 'gi'))];
  }

  function locate(masked, terms) {
    const present = [];
    const absent = [];
    for (const term of terms) {
      const hits = occurrences(masked, term.text);
      if (!hits.length) absent.push(term);
      else if (hits.length === 1) present.push({ term, hit: hits[0] });
    }
    // Defined terms before bold ones before key terms; among equals the longer (more specific) term.
    present.sort((a, b) => a.term.rank - b.term.rank || b.term.text.length - a.term.text.length);
    return { present, absent };
  }

  function nearest(absent, term, seed) {
    const near = [...absent].sort((a, b) => Math.abs(a.rank - term.rank) - Math.abs(b.rank - term.rank) ||
      Math.abs(a.order - term.order) - Math.abs(b.order - term.order));
    if (!seed) return near;
    return [...shuffle(near.slice(0, NEAR_WINDOW), term.text, seed), ...near.slice(NEAR_WINDOW)];
  }

  const api = { collect, locate, nearest };
  PDFStudy.markedTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

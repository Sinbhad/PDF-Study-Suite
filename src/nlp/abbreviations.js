/**
 * Abbreviations: "process control block (PCB)", "first-come, first-served (FCFS)", "Intermolecular forces (IMF)".
 *   find(text)            -> [{ abbr, long }]  every abbreviation whose letters are the initials of the words before it
 *   longFormBefore(before, abbr) -> the words of `before` that the abbreviation stands for, or ''
 *   attach(term, sentence) -> "term (ABBR)" when the sentence writes the abbreviation right after the term
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SKIPPED_WORD_RE = /^(?:of|the|and|for|in|to|a|an|on)$/i;
  const ABBR_RE = /\(([A-Z][A-Za-z0-9]{1,6}?)s?\)/g;
  const MAX_LONG_WORDS = 7;

  /** Hyphenated words count one initial per part: "first-come" -> f, c. */
  const initialsOf = (words) => words.flatMap((w) => w.split(/[-/]/)).filter((p) => p && !SKIPPED_WORD_RE.test(p)).map((p) => p[0].toLowerCase());

  /** Letters of the abbreviation appear in order inside the phrase, starting with its first letter ("ATP"). */
  function lettersInOrder(abbr, phrase) {
    const letters = abbr.toLowerCase().replace(/[^a-z]/g, '');
    const text = phrase.toLowerCase();
    if (!letters || text[0] !== letters[0]) return false;
    let at = 0;
    for (const ch of letters) {
      at = text.indexOf(ch, at);
      if (at === -1) return false;
      at += 1;
    }
    return true;
  }

  function longFormBefore(before, abbr, loose) {
    const words = String(before || '').replace(/[.;:!?]/g, ' ').trim().split(/\s+/).filter(Boolean);
    const letters = abbr.toLowerCase().replace(/[^a-z]/g, '').split('');
    if (letters.length < 2) return '';
    for (let take = Math.min(MAX_LONG_WORDS, words.length); take >= 1; take--) {
      const span = words.slice(-take).map((w) => w.replace(/,$/, ''));
      if (SKIPPED_WORD_RE.test(span[0])) continue;
      if (initialsOf(span).join('') === letters.join('')) return span.join(' ');
    }
    if (!loose) return '';
    // Fused words ("adenosine triphosphate" for ATP): the shortest span that still holds every letter in order.
    for (let take = 1; take <= Math.min(letters.length, words.length); take++) {
      const span = words.slice(-take).join(' ');
      if (/^[a-z]/i.test(span) && lettersInOrder(abbr, span)) return span;
    }
    return '';
  }

  function find(text) {
    const out = [];
    const seen = new Set();
    const plain = String(text || '').replace(/\*\*|__/g, '');
    for (const line of plain.split('\n')) {
      for (const m of line.matchAll(ABBR_RE)) {
        const long = longFormBefore(line.slice(0, m.index), m[1], false);
        if (!long || long.split(/\s+/).length < 2 || seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ abbr: m[1], long });
      }
    }
    return out;
  }

  function attach(term, sentence) {
    const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = String(sentence || '').match(new RegExp(`${escaped}\\s+\\(([A-Z][A-Za-z0-9-]{0,9})\\)`));
    return m ? `${term} (${m[1]})` : term;
  }

  const api = { find, longFormBefore, attach };
  PDFStudy.abbreviations = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

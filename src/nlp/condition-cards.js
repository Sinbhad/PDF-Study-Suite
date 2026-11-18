/**
 * Condition Cards: definitions a textbook writes as a condition rather than as "X is a ...". Pure and DOM-free.
 *   fromText(text) -> [{ front, back, term, sentence }]
 *     "A relation is in 2NF if and only if it is in 1NF and all non-key attributes are determined by the entire
 *      primary key."              -> "When is a relation in 2NF?" => "If and only if it is in 1NF and ..."
 *     "The set A is a subset of B if and only if every element of A is also an element of B."
 *                                 -> "When is a set a subset of another set?" is left to the definition box; only
 *                                    a sentence whose subject is a bare noun ("A relation", "A table") is read
 *     "<sentence>. This condition is called a **deletion anomaly**."
 *                                 -> "Deletion anomaly" => the sentence before, when it stands alone (no number,
 *                                    no name from the example, no "it"/"this" it leans on)
 *   The first definition of a term wins ("we can therefore restate the definition of 3NF: ..." is not a second card).
 *   Math the extraction wrapped around plain words ("$it is in 1NF$") is unwrapped.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // "(As we discussed ..., )a table is in 1NF if and only if ...": a bare noun, "is in" / "is" + the defined term
  const IFF_RE = /^(?:[^,]{0,60},\s+)?(?:an?|An?)\s+([a-z]+)\s+is\s+(in|an?)\s+([A-Za-z0-9][\w-]*(?:\s+[A-Za-z0-9][\w-]*){0,3})\s+if\s+and\s+only\s+if\s+(.{10,260})$/;
  const NAMED_AFTER_RE = /^This\s+(?:condition|situation|problem)\s+is\s+called\s+(?:an?\s+)?\*\*([^*]{3,40})\*\*\s*\.?$/i;
  // A sentence that points into a figure or holds an example's numbers or names cannot stand alone
  const LEANS_RE = /\b(?:Figure|Table|Example|Section)\s+\d|\b(?:above|below|here)\b|\d{2,}|\b[A-Z][a-z]+[A-Z]\w*\b|\b[A-Z]{2,}_[A-Z]+\b/;
  const PRONOUN_START_RE = /^(?:it|this|that|these|those|they|he|she)\b/i;
  const MAX_WORDS = 40;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  // "$it is in 1NF$": prose the extraction set as math (letters and spaces only, at least two words)
  const unwrap = (s) => String(s || '').replace(/\$([A-Za-z0-9][A-Za-z0-9 ,]*\s[A-Za-z0-9 ,]*)\$/g, '$1');
  const words = (s) => plain(s).split(/\s+/).filter(Boolean).length;

  function fromText(text) {
    const tok = dep('tokenizer', './tokenizer.js');
    const sentences = tok.splitSentences(unwrap(String(text || ''))).map((s) => s.replace(/\s+/g, ' ').trim());
    const out = [];
    const seen = new Set();
    const add = (term, front, back, sentence) => {
      const key = term.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ term, front, back, sentence });
    };
    sentences.forEach((raw, i) => {
      const s = plain(raw);
      const iff = s.match(IFF_RE);
      if (iff && words(s) <= MAX_WORDS && !LEANS_RE.test(iff[4])) {
        const [, noun, how, term, condition] = iff;
        const front = how === 'in' ? `When is a ${noun} in ${term}?` : `When is a ${noun} ${how} ${term}?`;
        add(term, front, `If and only if ${condition.replace(/\.$/, '')}.`, s);
        return;
      }
      const named = raw.trim().match(NAMED_AFTER_RE);
      const before = i > 0 ? plain(sentences[i - 1]) : '';
      if (named && before && words(before) <= MAX_WORDS && !LEANS_RE.test(before) && !PRONOUN_START_RE.test(before) && !/[?:]\s*$/.test(before)) {
        const term = named[1].trim();
        add(term, term.charAt(0).toUpperCase() + term.slice(1), before.replace(/\bthis\s+(table|relation|structure)\b/gi, 'the $1'), `${before} ${plain(raw)}`);
      }
    });
    return out;
  }

  const api = { fromText };
  PDFStudy.conditionCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

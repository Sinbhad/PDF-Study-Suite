/**
 * Term Kinds: what kind of thing a term names, read from the term and from the scope's own definition of it, so
 * that the options of a blank are all the same kind of thing as the answer.
 *   "clock generator"   head noun "generator"; the scope calls it "a timing device"      -> kinds {generator, device}
 *   "candidate key"     head noun "key"; defined as "a determinant that determines ..."   -> kinds {key, determinant}
 *   "clock skew"        head noun "skew"                                                   -> kinds {skew}
 * Two terms are of one kind when their kind sets meet: "candidate key" and "surrogate key" (both keys) are; "clock
 * skew" and "clock generator" are not, though they share a word. A blank whose stem names its category ("a timing
 * device called a(n) ________") takes only options of that category or of the answer's own head noun.
 *
 *   genusOf(definition)                  head noun of the genus a definition opens with ("A determinant that ..." ->
 *                                        "determinant"), or '' when it opens with a verb or a vague word ("A way to ...")
 *   kindsOf(term, definitions)           Set of kind words; definitions: [{ term, statement }] of the scope
 *   sameKind(a, b, definitions)          do the two terms share a kind?
 *   stemCategory(before)                 the noun a naming stem puts before its blank ("device" in "a timing device
 *                                        called a(n) "), or ''
 *   slotWants(before, after)             'adjective' for a blank between a bare copula and a preposition ("is ____ to"),
 *                                        else 'noun'
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const os = () => dep('optionSets', './option-sets.js');

  // The genus phrase ends where its qualifier begins: a relative word, a preposition, a participle or punctuation.
  const GENUS_END_RE = /^(?:that|which|who|whose|where|when|whereby|in|of|for|with|to|from|by|on|at|as|used|made|formed|consisting|containing|having|if|and|or|but|is|are|was|were|be|can|will|may|must)$/i;
  // A genus that says nothing about the kind of thing ("A way to ...", "The name for ...") is no kind.
  const VAGUE_GENUS = new Set(('name term word way kind type sort form thing something one part example case ' +
    'fact means manner instance item piece').split(' '));
  const DEFINES_RE = /^(?:.{1,90}?)\s+(?:is|are)\s+(?:(?:a|an|the)\s+)?(?=[a-z])/i;
  const SETUP_START_RE = /^(?:let|suppose|consider|assume|given|if|when|for)\b/i;
  const ARTICLE_RE = /^(?:a|an|the|any|some)\s+/i;
  const MAX_GENUS_WORDS = 5;
  const NAMING_VERB_RE = /\b(?:called|known\s+as|termed|named|referred\s+to\s+as)\s+(?:(?:a|an|the|a\(n\))\s+)?$/i;
  const COPULA_BEFORE_RE = /\b(?:is|are|was|were|be|been|being)\s+(?:not\s+)?$/i;
  const PREPOSITION_AFTER_RE = /^\s*(?:to|than|with|from|of|in|for|on|under)\b/i;

  const plain = (s) => String(s || '').replace(/\$[^$]*\$/g, ' ').replace(/\*\*|__/g, '');
  const wordsOf = (s) => plain(s).toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
  const headOf = (term) => os().lemma(wordsOf(term).pop() || '');

  /** Head noun of the genus a definition opens with, or ''. */
  function genusOf(definition, term) {
    let text = plain(definition).replace(/\s+/g, ' ').trim();
    // "Let p be a proposition. The negation of p ... is the statement ...": the set-up sentence is skipped; a definition
    // that is nothing but a set-up ("Suppose ...") has no genus.
    if (SETUP_START_RE.test(text)) {
      const rest = text.match(/^[^.]*?[a-z0-9)\s]\.\s+(?=[A-Z])/);
      if (!rest) return '';
      text = text.slice(rest[0].length);
    }
    // "A latch is a storage element that ...": the genus follows the copula when the sentence names its term first.
    const named = text.match(DEFINES_RE);
    if (named && (!term || wordsOf(named[0]).some((w) => wordsOf(term).includes(w)))) text = text.slice(named[0].length);
    text = text.replace(ARTICLE_RE, '');
    const phrase = [];
    for (const raw of text.split(' ')) {
      const w = raw.replace(/[^A-Za-z'’-]/g, '');
      if (!w || GENUS_END_RE.test(w) || /^["“‘'(]/.test(raw)) break; // a quotation or a verb ends the genus
      phrase.push(w);
      if (/[,;:.)]$/.test(raw) || phrase.length >= MAX_GENUS_WORDS) break;
    }
    if (!phrase.length) return '';
    const last = phrase[phrase.length - 1].toLowerCase();
    const head = os().lemma(last);
    if (head.length < 3 || VAGUE_GENUS.has(head) || /(?:ed|ly)$/.test(last)) return '';
    // "Exists when ...", "Determines ...": one word ending in -s before the qualifier may be a verb, not a genus;
    // it is trusted only when it is the term's own head noun ("Keys that have two or more columns").
    if (phrase.length === 1 && /s$/.test(last) && head !== headOf(term || '')) return '';
    return head;
  }

  /** The kind words of a term: its head noun and the genus of each definition the scope gives it. */
  function kindsOf(term, definitions) {
    const kinds = new Set();
    const head = headOf(term);
    if (head) kinds.add(head);
    const key = os().termKey(term);
    for (const d of definitions || []) {
      if (!d || os().termKey(d.term) !== key) continue;
      const genus = genusOf(d.statement, d.term);
      if (genus) kinds.add(genus);
    }
    return kinds;
  }

  function sameKind(a, b, definitions) {
    const ka = kindsOf(a, definitions);
    for (const k of kindsOf(b, definitions)) if (ka.has(k)) return true;
    return false;
  }

  /** "a timing device called a(n) " -> "device"; '' when the stem does not name its blank's category. */
  function stemCategory(before) {
    const text = plain(before);
    const m = text.match(NAMING_VERB_RE);
    if (!m) return '';
    const lead = text.slice(0, m.index).replace(/[,\s]+$/, '');
    const last = (lead.match(/([A-Za-z][A-Za-z-]*)$/) || [])[1] || '';
    const head = os().lemma(last.toLowerCase());
    // "is called", "are often called": a verb, not a noun, stands before the naming verb.
    if (!head || head.length < 3 || /^(?:is|are|was|were|be|been|also|often|usually|commonly|sometimes|formally|then|thus|now|simply)$/.test(head) || /ly$/.test(head)) return '';
    return VAGUE_GENUS.has(head) ? '' : head;
  }

  function slotWants(before, after) {
    return COPULA_BEFORE_RE.test(plain(before)) && PREPOSITION_AFTER_RE.test(plain(after)) ? 'adjective' : 'noun';
  }

  const api = { genusOf, kindsOf, sameKind, stemCategory, slotWants, headOf };
  PDFStudy.termKinds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

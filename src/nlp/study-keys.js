/**
 * Stable identities for documents, flashcards and quiz questions (DOM-free).
 * Stored study state is attached to these keys, so it survives regeneration, renaming the file and
 * a reload. Keys are a hash of normalised text, never a position in a list.
 *   docId({ fingerprint, name, size, numPages }) -> 'pdf-…' (PDF.js fingerprint) or 'doc-…' (fallback)
 *   cardKey(card)      -> 'c…'  from the normalised front
 *   questionKey(q)     -> 'q…'  from the normalised stem + answer
 *   sourceKey(q)       -> 's…'  from the sentence the question was built from
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const FNV_OFFSET = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;
  const BLANK_RE = /_{3,}/;

  /** FNV-1a (32 bit) over UTF-16 code units, from the published description of the algorithm. */
  function fnv1a(text, offset) {
    let h = offset >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME) >>> 0;
    }
    return h;
  }

  /** 64 bits as 16 hex characters: two FNV-1a passes with different starting values. */
  function hash(text) {
    const s = String(text == null ? '' : text);
    const hex = (n) => n.toString(16).padStart(8, '0');
    return hex(fnv1a(s, FNV_OFFSET)) + hex(fnv1a(s, FNV_OFFSET ^ 0x5bd1e995));
  }

  /** Case, spacing and trailing punctuation never change an identity. */
  function normalise(text) {
    const s = String(text == null ? '' : text);
    return (s.normalize ? s.normalize('NFKC') : s)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\s.:;,!?]+$/, '');
  }

  function docId(info) {
    const d = info || {};
    if (d.fingerprint) return `pdf-${String(d.fingerprint)}`;
    return `doc-${hash(`${d.name || ''}|${d.size || 0}|${d.numPages || 0}`)}`;
  }

  const cardKey = (card) => `c${hash(normalise(card && card.front))}`;

  const questionKey = (q) => `q${hash(`${normalise(q && q.question)}\u0001${normalise(q && q.answer)}`)}`;

  /**
   * The sentence a question was built from. Generated questions carry no explicit source yet, so it
   * is recovered from the stem: a blank is filled with the answer, a quoted statement is unwrapped.
   */
  function questionSource(q) {
    if (!q) return '';
    if (q.source) return String(q.source);
    const stem = String(q.question || '');
    if (BLANK_RE.test(stem)) return stem.replace(BLANK_RE, String(q.answer || ''));
    const quoted = stem.match(/\n\s*"([\s\S]+)"\s*$/);
    return quoted ? quoted[1] : stem;
  }

  const sourceText = (q) => normalise(questionSource(q));
  const sourceKey = (q) => `s${hash(sourceText(q))}`;

  /** Key of a pre-IndexedDB "known" entry: `${docName}::${cardFront}`. */
  const legacyKnownPrefix = (docName) => `${docName}::`;

  const api = { hash, normalise, docId, cardKey, questionKey, questionSource, sourceText, sourceKey, legacyKnownPrefix };
  PDFStudy.studyKeys = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

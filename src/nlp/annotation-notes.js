/**
 * Annotation Notes: which of the student's own pen notes on a slide (slide.annotations, recognised by their
 * notes app and kept apart from the slide text by the extraction) are readable enough to show back to them.
 * Recognised handwriting is often debris ("Ca2t_∞", "paralyze^d", "、"); a note is shown only when it is
 * mostly real words. With no dictionary, a word counts as real when the deck itself prints it, or when it is
 * a common English function word. Nothing here is ever mixed into study content: the Summary shows the notes
 * in a collapsed list of their own.
 *
 * vocabulary(slides)               -> Set of lower-case words the deck prints (titles, bullets, tables)
 * readable(annotations, vocab)     -> [text] the readable notes of one slide, in order, without repeats
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_WORDS = 2; // a lone recognised word ("ping", "eats") is too little to show as a note
  const MIN_REAL_SHARE = 0.8; // share of a note's tokens that must be real words
  const MIN_CONTENT_WORDS = 1; // "to not", "1 of": function words alone say nothing
  const MAX_NOTES = 8;
  // Marks a recogniser leaves in debris: carets and underscores from sub/superscript guesses, stray symbols.
  const DEBRIS_RE = /[\^_`~∞「」、°˚λ☆·•]|\(\s*\)|[A-Za-z]\d[A-Za-z]/;
  const WORD_RE = /^[A-Za-z][A-Za-z'’-]*$/;
  const NUMBER_RE = /^[<>~]?\d+(?:[.,/-]\d+)*%?$/;

  const tokens = (text) => String(text || '').split(/\s+/).map((t) => t.replace(/^[("'“‘[]+|[)"'”’\].,;:!?]+$/g, '')).filter(Boolean);

  function vocabulary(slides) {
    const words = new Set();
    const add = (text) => tokens(text).forEach((t) => WORD_RE.test(t) && words.add(t.toLowerCase()));
    for (const s of slides || []) {
      add(s.title);
      (s.bullets || []).forEach((b) => add(typeof b === 'string' ? b : b && b.text));
      (s.tables || []).forEach((t) => add(t.text));
    }
    return words;
  }

  function isReadable(text, vocab) {
    const t = String(text || '').trim();
    if (!t || DEBRIS_RE.test(t)) return false;
    const list = tokens(t);
    if (list.length < MIN_WORDS) return false;
    const stop = dep('tokenizer', './tokenizer.js').LINGUISTIC_STOPWORDS;
    const known = (w) => WORD_RE.test(w) && vocab.has(w.toLowerCase()) && !stop.has(w.toLowerCase());
    const real = list.filter((w) => NUMBER_RE.test(w) || known(w) || (WORD_RE.test(w) && stop.has(w.toLowerCase())));
    return real.length / list.length >= MIN_REAL_SHARE && list.filter(known).length >= MIN_CONTENT_WORDS;
  }

  function readable(annotations, vocab) {
    const seen = new Set();
    const out = [];
    for (const a of annotations || []) {
      const text = String((a && a.text) || a || '').replace(/\s+/g, ' ').trim();
      const key = text.toLowerCase();
      if (seen.has(key) || !isReadable(text, vocab || new Set())) continue;
      seen.add(key);
      out.push(text);
      if (out.length >= MAX_NOTES) break;
    }
    return out;
  }

  const api = { vocabulary, readable, isReadable };
  PDFStudy.annotationNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

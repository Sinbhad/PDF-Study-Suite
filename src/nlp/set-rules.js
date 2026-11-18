/**
 * Set Rules: the set relations a section defines precisely enough for a program to decide them, read from its
 * definition boxes and sentences (never from its title). Pure and DOM-free.
 *   read(sentences) -> { subset, proper, powerset } each { statement, page } | null
 *     subset    "The set A is a subset of B ... if and only if every element of A is also an element of B."
 *     proper    "... A is a subset of B but A ≠ B, we write A ⊂ B and say that A is a proper subset of B."
 *     powerset  "the power set of S is the set of all subsets of the set S"
 *   sentences: [{ text, page }] (section-rules.js: running text and definition boxes)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SUBSET_RE = /\bis\s+a\s+subset\s+of\b[^.]*\bif\s+and\s+only\s+if\s+every\s+element\s+of\b/i;
  const PROPER_RE = /\bproper\s+subset\b/i;
  const NOT_EQUAL_RE = /≠|\\ne(?:q)?\b|\bnot\s+equal\b|\bbut\s+that\s+\$?[A-Z]\$?\s*\\?ne/i;
  const POWERSET_RE = /\bpower\s+set\s+of\s+\$?[A-Z]\$?\s+is\s+the\s+set\s+of\s+all\s+subsets\b/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

  function read(sentences) {
    const find = (test) => {
      const s = (sentences || []).find((x) => test(String(x.text || '')));
      return s ? { statement: plain(s.text), page: s.page || null } : null;
    };
    return {
      subset: find((t) => SUBSET_RE.test(t)),
      proper: find((t) => PROPER_RE.test(t) && NOT_EQUAL_RE.test(t)),
      powerset: find((t) => POWERSET_RE.test(t)),
    };
  }

  const api = { read };
  PDFStudy.setRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

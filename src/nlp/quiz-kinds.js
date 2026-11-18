/**
 * Quiz Kinds: which terms of a scope the scope itself says are kinds of one another. "The most basic storage
 * elements are latches", "Synchronous sequential circuits that use clock pulses ... are called clocked sequential
 * circuits", "one of the candidate keys is selected to be the primary key": a latch is a storage element, so
 * "storage elements store binary information" is no False about the SR latch, and "candidate key" still
 * completes a sentence about the primary key. Two such terms are never set against each other: not as a
 * swapped-in False, not as a wrong option beside the other.
 *
 *   index(sentences) -> { related(a, b) }
 *     related   one clause of the scope names both terms (one of them may be named by its head noun alone,
 *               "latches" for "SR latch") with a linking word between them ("is", "are", "called", "known as",
 *               "referred to as", "kind of", "such as", "including", ...)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const LINK_RE = /\b(?:is|are|was|were|be|called|known\s+as|referred\s+to\s+as|named|termed|kinds?\s+of|types?\s+of|forms?\s+of|examples?\s+of|such\s+as|including|includes?|e\.g\.)\b/i;
  const CLAUSE_BREAK_RE = /;\s+|,\s+(?:whereas|while|but|unlike)\s+|\.\s+/i;
  const MIN_HEAD_CHARS = 4;
  const MAX_LINK_WORDS = 5; // "are", "is a kind of", "is selected to be the"
  const MAX_LEAD_WORDS = 3; // "The most basic storage elements ...": the clause's subject opens it
  const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
  // What may stand between two names that are kinds of one another: a copula or a naming verb and glue words.
  // "the latch is in the reset state" puts "in the reset" between, so a latch is no kind of state.
  const GLUE = new Set(('is are was were be been a an the also called known as referred to named termed kind kinds type types ' +
    'form forms example examples of such including include includes one special simple basic most selected chosen used often usually said').split(' '));
  const STRONG_LINK_RE = /\b(?:is|are|was|were|be|called|known|referred|named|termed|kinds?|types?|forms?|examples?|such|including|includes?)\b/;
  const NAMING_TAIL_RE = /\b(?:called|known\s+as|referred\s+to\s+as|named|termed)\s+(?:(?:an?|the)\s+)?$/;

  const norm = (s) => ` ${String(s || '').toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const plural = (w) => [w, `${w}s`, `${w}es`, w.replace(/y$/, 'ies')];

  /** The ways a clause can name a term: { full: [' sr latch ', ' sr latches '], head: [' latch ', ' latches '] }. */
  function namings(term) {
    const words = norm(term).trim().split(' ').filter(Boolean);
    if (!words.length) return { full: [], head: [] };
    const last = words[words.length - 1].replace(/(?:es|s)$/, '');
    const stemmed = words.slice(0, -1).join(' ');
    const full = plural(last).map((w) => ` ${stemmed ? `${stemmed} ` : ''}${w} `);
    const head = words.length > 1 && last.length >= MIN_HEAD_CHARS ? plural(last).map((w) => ` ${w} `) : [];
    return { full, head };
  }

  function index(sentences) {
    const clauses = [];
    for (const s of sentences || []) {
      for (const clause of String(s).split(CLAUSE_BREAK_RE)) if (LINK_RE.test(clause)) clauses.push(norm(clause));
    }
    const cache = new Map();
    /** [start, end] of every occurrence of the forms in the clause (forms carry their surrounding spaces). */
    function spans(clause, forms) {
      const out = [];
      for (const f of forms) for (let i = clause.indexOf(f); i >= 0; i = clause.indexOf(f, i + 1)) out.push([i, i + f.length]);
      return out;
    }
    const inside = ([s, e], list) => list.some(([x, y]) => x <= s && e <= y && (x < s || e < y));

    /**
     * The clause names `a` in full and `b` in full or by its head noun, apart from each other (a name inside a
     * longer one, "latch" in "SR latch", is no mention), with a linking word between them: "storage elements are
     * latches" links, "the master latch" does not.
     */
    function names(clause, a, b) {
      const fullB = spans(clause, b.full);
      const mentionsA = spans(clause, a.full).filter((sp) => !inside(sp, fullB));
      if (!mentionsA.length) return false;
      const fullA = spans(clause, a.full);
      const fullMentionsB = fullB.filter((sp) => !inside(sp, fullA));
      const mentionsB = [...fullMentionsB, ...spans(clause, b.head).filter((sp) => !inside(sp, fullA) && !inside(sp, fullB))];
      return mentionsA.some((x) => mentionsB.some((y) => {
        const [first, second] = x[0] <= y[0] ? [x, y] : [y, x];
        if (first[1] > second[0] + 1) return false; // overlapping: one compound, not two mentions
        const between = ` ${clause.slice(first[1], second[0])} `;
        const words = between.trim().split(/\s+/).filter(Boolean);
        // Joined by a link alone ("storage elements are latches"), or the clause's own subject named in full as the
        // other ("Synchronous sequential circuits that use ... are called clocked sequential circuits").
        // One describing word may stand before the second name: "logic gates are electronic circuits".
        const glue = words.length && !GLUE.has(words[words.length - 1]) ? words.slice(0, -1) : words;
        const joined = words.length <= MAX_LINK_WORDS && glue.length > 0 && glue.every((w) => GLUE.has(w)) && STRONG_LINK_RE.test(` ${glue.join(' ')} `);
        const bothFull = fullMentionsB.includes(y);
        return joined || (bothFull && wordCount(clause.slice(0, first[0])) <= MAX_LEAD_WORDS && NAMING_TAIL_RE.test(between));
      }));
    }

    /** Does a clause name both terms (at least one by its full name) and link them? */
    function related(a, b) {
      const ka = norm(a);
      const kb = norm(b);
      if (ka === kb) return false;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!cache.has(key)) {
        const na = namings(a);
        const nb = namings(b);
        cache.set(key, clauses.some((c) => names(c, na, nb) || names(c, nb, na)));
      }
      return cache.get(key);
    }

    return { related };
  }

  const api = { index, namings };
  PDFStudy.quizKinds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

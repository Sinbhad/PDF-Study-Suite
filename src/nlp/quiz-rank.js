/**
 * Quiz Rank: how much a piece of a textbook scope is worth asking, from the box it is printed in.
 * A book sets its material in typeset boxes, each opening with a heading line (extraction's scope.lines carry
 * the box as `blockId`):
 *   CORE      "Definition 3", "Theorem 1", "Law", "Common Error 7.1", "Key Concept", objectives: asked first
 *   PLAIN     the running exposition
 *   SIDE      "Special Topic", "Advanced Topic", "How To", "Worked Example": asked only once the rest is used
 *   ASIDE     "Programming Tip", "Computing & Society", "Random Fact", "By the Way", "Historical Note": an aside
 *             about editors, history or people is not course content and is never asked
 * ranker(lines) -> { weightOf(text) -> 0 | 1 | 2 | Infinity, order(list, textOf) -> list sorted by weight (stable),
 *                    isAside(text) }
 * Without tagged lines every text weighs PLAIN, so nothing changes.
 * exampleTerms(sentences) -> { is(term), mentionedIn(sentence) }: the domain a worked example brings in ("For
 *                    example, consider a program that ... the Richter scale") is not asked either.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const CORE = 0;
  const PLAIN = 1;
  const SIDE = 2;
  const ASIDE = Infinity;

  const CORE_HEAD_RE = /^(?:Definition|Theorem|Lemma|Corollary|Law|Principle|Common\s+Error|Key\s+Concept|Learning\s+Objectives?|Objectives?)\b/i;
  const SIDE_HEAD_RE = /^(?:Special\s+Topic|Advanced\s+Topic|How\s+To|Worked\s+Example|Example|Case\s+Study|Self\s+Check)\b/i;
  const ASIDE_HEAD_RE =
    /^(?:Programming\s+Tip|Productivity\s+Hint|Quality\s+Tip|Style\s+Tip|Computing\s*(?:&|and)\s*Society|Random\s+Fact|By\s+the\s+Way|Historical\s+Notes?|Fun\s+Fact|Did\s+You\s+Know|Sidebar)\b/i;
  const KEY_CHARS = 40;

  const plain = (s) => String(s || '').replace(/\*\*|__|\$/g, '').replace(/\s+/g, ' ').trim();
  const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function weightOfHead(head) {
    const h = plain(head);
    if (ASIDE_HEAD_RE.test(h)) return ASIDE;
    if (CORE_HEAD_RE.test(h)) return CORE;
    if (SIDE_HEAD_RE.test(h)) return SIDE;
    return PLAIN;
  }

  function ranker(lines) {
    // Box -> weight, from the first heading line of the box; then each box's text, normalised and joined.
    const boxes = new Map();
    for (const l of lines || []) {
      if (!l || !l.blockId) continue;
      if (!boxes.has(l.blockId)) boxes.set(l.blockId, { weight: null, text: [] });
      const box = boxes.get(l.blockId);
      if (box.weight === null && (l.kind === 'heading' || l.kind === 'example')) box.weight = weightOfHead(l.text);
      box.text.push(norm(l.text));
    }
    const weighted = [...boxes.values()].filter((b) => b.weight !== null && b.weight !== PLAIN)
      .map((b) => ({ weight: b.weight, text: ` ${b.text.join(' ')} ` }));
    const cache = new Map();

    function weightOf(text) {
      const key = norm(text).slice(0, KEY_CHARS);
      if (!key || !weighted.length) return PLAIN;
      if (!cache.has(key)) {
        const hit = weighted.find((b) => b.text.includes(` ${key}`));
        cache.set(key, hit ? hit.weight : PLAIN);
      }
      return cache.get(key);
    }

    /** The list, asides dropped, core first and side topics last; equal weights keep their order. */
    function order(list, textOf = (x) => x) {
      return (list || []).map((x, i) => ({ x, i, w: weightOf(textOf(x)) })).filter((e) => e.w !== ASIDE)
        .sort((a, b) => a.w - b.w || a.i - b.i).map((e) => e.x);
    }

    return { weightOf, order, isAside: (text) => weightOf(text) === ASIDE };
  }

  // "For example, consider a program that displays the effect of an earthquake, as measured by the Richter scale":
  // a term a worked example brings in is the example's domain, not a concept of the section, and worth nothing.
  const EXAMPLE_OPEN_RE = /^(?:\*\*)?(?:for\s+(?:example|instance)|as\s+an\s+example|consider|suppose|imagine|let'?s\s+say|(?:worked\s+)?example\s+\d)/i;
  const MIN_TERM_CHARS = 4;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * sentences -> { is(term), mentionedIn(sentence) }: is the term first met in a sentence that opens a worked
   * example, and does a sentence name such a term? Terms are judged as they are asked (cards, facts, sentences).
   */
  function exampleTerms(sentences) {
    const list = (sentences || []).map((s) => String(s));
    const cache = new Map();
    const found = [];
    function is(term) {
      const t = String(term || '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
      if (t.length < MIN_TERM_CHARS) return false;
      if (!cache.has(t)) {
        const re = new RegExp(`(?<![a-z])${escapeRe(t)}(?![a-z])`, 'i');
        const first = list.find((s) => re.test(s));
        const opens = Boolean(first) && EXAMPLE_OPEN_RE.test(first.trim());
        cache.set(t, opens);
        if (opens) found.push(re);
      }
      return cache.get(t);
    }
    return { is, mentionedIn: (s) => found.some((re) => re.test(String(s))) };
  }

  const api = { ranker, exampleTerms, CORE, PLAIN, SIDE, ASIDE };
  PDFStudy.quizRank = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

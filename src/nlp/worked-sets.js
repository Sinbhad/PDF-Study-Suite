/**
 * Worked Sets: subset, proper-subset and power-set questions for a section that defines those relations
 * (set rule cards, rule-cards.js; set-rules.js reads the definitions). Every set is small and written out, and
 * the key is decided by the definition itself (every element of A in B; and A ≠ B; the elements of P(S) are the
 * subsets of S). Pure and DOM-free.
 *   build(cards, { seed, variant, question }) -> [question]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const hash = (s) => dep('workedQuestions', './worked-questions.js').hash(s);

  const POOLS = [[1, 2, 3, 4, 5, 6, 7, 8, 9], ['a', 'b', 'c', 'd', 'e', 'f']];
  const pageNote = (page) => (page ? ` (p. ${page})` : '');
  const tex = (set) => `$\\{${[...set].join(', ')}\\}$`;
  const isSubset = (a, b) => [...a].every((x) => b.includes(x));

  /** k distinct items of the pool, the same for the same salt. */
  function draw(pool, k, salt, avoid = []) {
    const free = pool.filter((x) => !avoid.includes(x));
    const out = [];
    for (let i = 0; out.length < k && i < 50; i++) {
      const x = free[hash(`${salt}|${i}`) % free.length];
      if (!out.includes(x)) out.push(x);
    }
    return out.sort((x, y) => (x < y ? -1 : 1));
  }

  function build(cards, opts) {
    const { seed = 0, variant = 0, question } = opts;
    const byWhich = (w) => (cards || []).find((c) => (c.rule || c.teaches || {}).kind === 'set' && (c.rule || c.teaches).which === w);
    const out = [];
    const pool = POOLS[(seed + variant) % POOLS.length];
    const salt = `set|${seed}|${variant}`;
    const s = draw(pool, 4, `${salt}|S`);
    const outside = draw(pool, 2, `${salt}|out`, s);

    const sub = byWhich('subset');
    if (sub) {
      const rule = sub.rule || sub.teaches;
      const answer = draw(s, 2, `${salt}|a`);
      // Each wrong set has one element outside S: the definition's "every element" fails on exactly that one
      const wrong = [[answer[0], outside[0]], [outside[1], answer[1]], [...s.slice(0, 2), outside[0]]].map((w) => w.sort((x, y) => (x < y ? -1 : 1)));
      if (isSubset(answer, s) && wrong.every((w) => !isSubset(w, s))) {
        out.push(question({
          kind: 'set-subset', key: `${answer}|${s}`, label: 'Subsets', card: sub, seed,
          stem: `Which set is a subset of ${tex(s)}?`, answer: tex(answer), wrong: wrong.map(tex),
          explanation: `Every element of ${tex(answer)} is an element of ${tex(s)}; each other set has an element (${outside.join(' or ')}) that is not. ${rule.statement}${pageNote(rule.page)}`,
        }));
      }
    }
    const proper = byWhich('proper');
    if (proper && sub) {
      const rule = proper.rule || proper.teaches;
      const answer = s.slice(0, 3);
      // S itself is a subset of S but not a proper one; the others are not subsets at all
      const wrong = [s, [...s.slice(0, 2), outside[0]].sort((x, y) => (x < y ? -1 : 1)), [...s, outside[1]].sort((x, y) => (x < y ? -1 : 1))];
      out.push(question({
        kind: 'set-proper', key: `${answer}|${s}`, label: 'Subsets', card: proper, seed,
        stem: `Which set is a proper subset of ${tex(s)}?`, answer: tex(answer), wrong: wrong.map(tex),
        explanation: `${tex(answer)} is a subset of ${tex(s)} and not equal to it. ${tex(s)} is a subset of itself but not a proper one; the other two hold an element not in ${tex(s)}. ${rule.statement}${pageNote(rule.page)}`,
      }));
    }
    const power = byWhich('powerset');
    if (power) {
      const rule = power.rule || power.teaches;
      const base = s.slice(0, 3);
      const answer = draw(base, 2, `${salt}|p`);
      // An element of P(S) is a subset of S: a set with an element outside S is not one, nor is a lone element
      const wrong = [[answer[0], outside[0]].sort((x, y) => (x < y ? -1 : 1)), [...base, outside[1]].sort((x, y) => (x < y ? -1 : 1)), [outside[0]]];
      out.push(question({
        kind: 'set-power', key: `${answer}|${base}`, label: 'Power set', card: power, seed,
        stem: `Which set is an element of the power set of ${tex(base)}?`, answer: tex(answer), wrong: wrong.map(tex),
        explanation: `The elements of the power set of ${tex(base)} are its subsets; ${tex(answer)} is one, and each other set holds an element not in ${tex(base)}. ${rule.statement}${pageNote(rule.page)}`,
      }));
    }
    return out.filter(Boolean);
  }

  const api = { build };
  PDFStudy.workedSets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Worked Algebra: questions that apply the section's own identities and derivations (identity rule cards,
 * rule-cards.js) to a new instance, keyed by computation (logic-eval.js). Pure and DOM-free.
 *   build(cards, { seed, variant, question }) -> [[apply], [simplify], [name]]: three lists, one per kind
 *     apply     "Which expression is equal to $\overline{A + B}$?": an identity with its variables renamed (the
 *               practice test puts a sum such as A + B in place of a single-variable identity's X, as the
 *               book does with "X = AB + C"). The key is the identity's other side under the same renaming.
 *     simplify  "Simplify $A + AB$.": a derivation the section works out, renamed the same way
 *     name      "Which law does $X(Y + Z) = XY + XZ$ state?": the names the section gives its laws as options
 *   Wrong options are the other identities' results under the same renaming first, then the variables, their
 *   complements and the constants; each is kept only when it is NOT equal to the expression asked about on
 *   every assignment, and no two options have the same truth table. `question` is worked-questions.js's
 *   finisher (shuffles, dedupes, refuses a question left with fewer than three options).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  const LETTERS = { bool: ['A', 'B', 'C', 'D', 'W'], prop: ['r', 's', 't', 'u'] };
  const LENGTH_SPREAD = 10; // characters a law name may differ from the answer's before it is offered last
  const pageNote = (page) => (page ? ` (p. ${page})` : '');

  /** The renaming of an identity's variables into letters the section's own identities do not use. */
  function renaming(vars, used, style) {
    const free = LETTERS[style].filter((l) => !used.has(l));
    if (free.length < vars.length) return null;
    return Object.fromEntries(vars.map((v, i) => [v, free[i]]));
  }

  const parsed = (rule) => {
    const lhs = le().parse(rule.lhsTex, { style: rule.style });
    const rhs = le().parse(rule.rhsTex, { style: rule.style });
    return lhs && rhs && le().equivalent(lhs, rhs) ? { lhs, rhs } : null;
  };

  /** Simple wrong answers over the instance's variables: each variable, its complement, constants, sum and product. */
  function simpleForms(names) {
    const v = names.map((n) => ({ op: 'var', name: n }));
    const not = (a) => ({ op: 'not', a });
    const out = [...v, ...v.map(not), { op: 'const', value: true }, { op: 'const', value: false }];
    if (v.length >= 2) {
      const [a, b] = v;
      out.push({ op: 'or', a, b }, { op: 'and', a, b }, { op: 'or', a: not(a), b: not(b) }, { op: 'and', a: not(a), b: not(b) }, not({ op: 'or', a, b }), not({ op: 'and', a, b }));
    }
    return out;
  }

  /** Rendered wrong options for `target`: candidates not equal to it, one per truth table. */
  function wrongOptions(target, candidates, style) {
    const vars = le().variables(target);
    const columnOf = (a) => {
      const all = [...new Set([...vars, ...le().variables(a)])].sort();
      return le().column(a, all).join('') + all.join();
    };
    const taken = new Set([columnOf(target)]);
    const out = [];
    for (const c of candidates) {
      if (!c || le().equivalent(c, target)) continue;
      const key = columnOf(c);
      if (taken.has(key)) continue;
      taken.add(key);
      out.push(`$${le().render(c, style)}$`);
    }
    return out;
  }

  /** The variant-0 instance renames letters; variant 1 puts a sum in place of a lone variable (X -> A + B). */
  function instanceMap(rule, both, used, variant) {
    const vars = [...new Set([...le().variables(both.lhs), ...le().variables(both.rhs)])].sort();
    const names = renaming(vars, used, rule.style);
    if (!names) return null;
    const map = Object.fromEntries(Object.entries(names).map(([k, v]) => [k, { op: 'var', name: v }]));
    if (variant % 2 === 1 && vars.length === 1 && rule.style === 'bool') {
      const [a, b] = renaming(['_1', '_2'], used, rule.style) ? Object.values(renaming(['_1', '_2'], used, rule.style)) : [];
      if (a && b) map[vars[0]] = { op: 'or', a: { op: 'var', name: a }, b: { op: 'var', name: b } };
    }
    return { map, names };
  }

  const describe = (map, style) => Object.entries(map).map(([k, v]) => `$${k} = ${le().render(v, style)}$`).join(' and ');

  function build(cards, opts) {
    const { seed = 0, variant = 0, question } = opts;
    const rules = [];
    const seen = new Set();
    for (const card of cards || []) {
      const key = `${card.rule.kind}|${card.rule.lhsTex}|${card.rule.rhsTex}`;
      const both = parsed(card.rule);
      if (!both || seen.has(key)) continue;
      seen.add(key);
      rules.push({ card, rule: card.rule, both });
    }
    const used = new Set(rules.flatMap((r) => [...le().variables(r.both.lhs), ...le().variables(r.both.rhs)]));
    const rc = dep('ruleCards', './rule-cards.js');
    // A law that only reorders its variables (X + Y = Y + X, X(YZ) = (XY)Z) works nothing out, and its other
    // side is no plausible wrong answer either.
    const reorders = (r) => rc.reordering(r.rule);
    const apply = [];
    const simplify = [];
    for (const r of rules.filter((x) => !reorders(x))) {
      const inst = instanceMap(r.rule, r.both, used, variant);
      if (!inst) continue;
      const lhs = le().substitute(r.both.lhs, inst.map);
      const rhs = le().substitute(r.both.rhs, inst.map);
      const style = r.rule.style;
      // The other rules' results under a renaming onto the same letters: what a student who misapplies the
      // section's table would write.
      const letters = le().variables(lhs);
      const others = rules.filter((o) => o !== r && !reorders(o)).map((o) => {
        const vs = [...new Set([...le().variables(o.both.lhs), ...le().variables(o.both.rhs)])].sort();
        if (vs.length > letters.length) return null;
        return le().substitute(o.both.rhs, Object.fromEntries(vs.map((v, i) => [v, { op: 'var', name: letters[i] }])));
      });
      const wrong = wrongOptions(lhs, [...others, ...simpleForms(letters)], style);
      const answer = `$${le().render(rhs, style)}$`;
      const lhsTex = le().render(lhs, style);
      // Applying a reordering (X + Y = Y + X) or an identity whose two sides print the same works nothing out.
      if (answer === `$${lhsTex}$`) continue;
      const law = r.rule.number ? `identity ${r.rule.number}${r.rule.name ? ` (${r.rule.name})` : ''}` : rc.inSentence(r.rule.name || 'section');
      if (r.rule.kind === 'identity') {
        apply.push(question({
          kind: 'identity', key: `${r.rule.lhsTex}|${variant}`, label: 'Apply an identity', card: r.card, seed,
          stem: `Which expression is equal to $${lhsTex}$?`, answer, wrong,
          explanation: `By ${law}, $${r.rule.lhsTex} = ${r.rule.rhsTex}$${pageNote(r.rule.page)}; with ${describe(inst.map, style)} this gives ${answer}.`,
        }));
      } else {
        simplify.push(question({
          kind: 'derived', key: `${r.rule.lhsTex}|${variant}`, label: 'Simplify', card: r.card, seed,
          stem: `Simplify $${lhsTex}$.`, answer, wrong,
          explanation: `The section simplifies $${r.rule.lhsTex}$ to $${r.rule.rhsTex}$${pageNote(r.rule.page)}; with ${describe(inst.map, style)} this gives ${answer}.`,
        }));
      }
    }
    // The names the section gives its laws, asked from the law's statement
    const named = rules.filter((r) => r.rule.kind === 'identity' && r.rule.name);
    const names = [...new Set(named.map((r) => r.rule.name))];
    // A theorem among three laws stands out by its head noun alone: names on the answer's own head go first, and the
    // stem asks for a law or a theorem when the section names both.
    const headOf = (n) => (String(n).toLowerCase().match(/[a-z]+/g) || ['']).pop().replace(/s$/, '');
    // (A stem that says "law or theorem" would print a word of half the answers: it asks for the section's name.)
    const mixed = new Set(names.map(headOf)).size > 1;
    const name = named.map((r) => {
      const own = headOf(r.rule.name);
      const others = names.filter((n) => n !== r.rule.name);
      // The only theorem among laws is picked out by its kind, not by knowing the law.
      if (!others.some((n) => headOf(n) === own)) return null;
      const q = question({
        kind: 'law-name', key: `${r.rule.lhsTex}`, label: 'Laws', card: r.card, seed,
        stem: mixed ? `What does the section call $${r.rule.lhsTex} = ${r.rule.rhsTex}$?` : `Which law does $${r.rule.lhsTex} = ${r.rule.rhsTex}$ state?`,
        answer: r.rule.name,
        // Names of a length near the answer's first: one far longer than the rest stands out.
        wrong: [...others.filter((n) => headOf(n) === own), ...others.filter((n) => headOf(n) !== own)]
          .map((n, i) => ({ n, i, far: Math.abs(n.length - r.rule.name.length) > LENGTH_SPREAD }))
          .sort((x, y) => x.far - y.far || x.i - y.i).map((x) => x.n),
        explanation: `$${r.rule.lhsTex} = ${r.rule.rhsTex}$ is ${rc.inSentence(r.rule.name)}${r.rule.number ? ` (identity ${r.rule.number})` : ''}${pageNote(r.rule.page)}.`,
      });
      // Recalled from the section's table rather than worked out: an ordinary choice question
      return q ? { ...q, worked: false, skill: 'theorem', badge: 'Multiple Choice • Law' } : null;
    });
    // The order the section prints them in would ask its first identities in every set: each set starts elsewhere.
    const rotate = (list) => {
      const kept = list.filter(Boolean);
      const at = kept.length ? (seed + variant * 5) % kept.length : 0;
      return [...kept.slice(at), ...kept.slice(0, at)];
    };
    return [rotate(apply), rotate(simplify), rotate(name)];
  }

  const api = { build };
  PDFStudy.workedAlgebra = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Worked Forms: questions that apply a logic section's own definitions of related conditionals and its own
 * precedence examples (form and precedence rule cards, rule-cards.js) to new letters. Keys are computed by
 * logic-eval.js: a definition is applied by substitution, an equivalence by truth table, a grouping by the
 * parser whose precedence the section's examples were checked against. Pure and DOM-free.
 *   build(cards, { seed, variant, question }) -> [question]
 *     "What is the contrapositive of $r \to s$?"           the section's other forms (and the conditional) as options
 *     "Which of these is logically equivalent to $r \to s$?" the forms; exactly one may agree on every row
 *     "How is $r \vee s \wedge t \vee u$ grouped?"         every other grouping of the same expression as options
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  const LETTERS = ['r', 's', 't', 'u', 'w'];
  const OP_TEX = { and: '\\wedge', or: '\\vee', xor: '\\oplus', imp: '\\to', iff: '\\leftrightarrow' };
  const pageNote = (page) => (page ? ` (p. ${page})` : '');
  const tex = (ast) => `$${le().render(ast, 'prop')}$`;

  /** Letters for a new instance: ones the section's own example does not use. */
  const fresh = (used, n) => LETTERS.filter((l) => !used.includes(l)).slice(0, n);

  function formQuestions(cards, seed, variant, question) {
    if (!cards.length) return [];
    const base = le().parse(cards[0].rule.baseTex, { style: 'prop' });
    if (!base) return [];
    const vars = le().variables(base);
    const [x, y] = fresh(vars, 2);
    const map = { [base.a.name]: x, [base.b.name]: y };
    const original = le().substitute(base, map);
    const forms = cards[0].rule.all.map((f) => ({ ...f, ast: le().parse(f.formTex, { style: 'prop' }) })).filter((f) => f.ast)
      .map((f) => ({ ...f, inst: le().substitute(f.ast, map) }));
    const out = [];
    const at = (seed + variant) % cards.length;
    for (const card of [...cards.slice(at), ...cards.slice(0, at)]) {
      const target = forms.find((f) => f.name === card.rule.name);
      if (!target) continue;
      out.push(question({
        kind: 'form', key: `${target.name}|${x}${y}`, label: 'Apply a definition', card, seed,
        stem: `What is the ${target.name} of ${tex(original)}?`,
        answer: tex(target.inst), wrong: [...forms.filter((f) => f !== target).map((f) => tex(f.inst)), tex(original)],
        explanation: `The ${target.name} of $${card.rule.baseTex}$ is $${card.rule.formTex}$${pageNote(card.rule.page)}; with ${base.a.name} = ${x} and ${base.b.name} = ${y} it is ${tex(target.inst)}.`,
      }));
    }
    // Which form always has the conditional's truth value: worked out on all four rows
    const equal = forms.filter((f) => le().equivalent(f.inst, original));
    if (equal.length === 1) {
      const card = cards.find((c) => c.rule.name === equal[0].name) || cards[0];
      const col = (a) => le().column(a, [x, y]).map((v) => (v ? 'T' : 'F')).join('');
      out.unshift(question({
        kind: 'form-equivalent', key: `${x}${y}`, label: 'Equivalence', card, seed,
        stem: `Which conditional statement is logically equivalent to ${tex(original)}?`,
        answer: tex(equal[0].inst), wrong: forms.filter((f) => f !== equal[0]).map((f) => tex(f.inst)),
        explanation: `On the rows (${x}, ${y}) = TT, TF, FT, FF: ${tex(original)} is ${col(original)}; ${forms.map((f) => `the ${f.name} ${tex(f.inst)} is ${col(f.inst)}`).join('; ')}. Only the ${equal[0].name} agrees on every row${pageNote(card.rule.page)}.`,
      }));
    }
    return out.filter(Boolean);
  }

  /** Every way to group operands joined by binary operators. */
  function groupings(operands, ops) {
    if (operands.length === 1) return [operands[0]];
    const out = [];
    for (let k = 0; k < ops.length; k++) {
      for (const a of groupings(operands.slice(0, k + 1), ops.slice(0, k))) {
        for (const b of groupings(operands.slice(k + 1), ops.slice(k + 1))) out.push({ op: ops[k], a, b });
      }
    }
    return out;
  }

  function precedenceQuestions(cards, seed, variant, question) {
    const card = cards[0];
    if (!card) return [];
    const pairs = card.rule.pairs || [];
    const out = [];
    pairs.forEach((pair, i) => {
      // a b a: "r ∨ s ∧ t ∨ u" — four operands, one order of operators the section's examples show. The operator
      // used twice must be associative (∧, ∨): how "r → s → t" groups is a convention the examples do not show.
      const associative = pair.filter((o) => o === 'and' || o === 'or');
      if (!associative.length) return;
      const p = associative.length === 2 ? pair[(seed + variant + i) % 2] : associative[0];
      const q = pair.find((o) => o !== p);
      const ops = [p, q, p];
      const operands = LETTERS.slice(0, 4).map((name) => ({ op: 'var', name }));
      const flatTex = operands.map((o, k) => (k ? ` ${OP_TEX[ops[k - 1]]} ${o.name}` : o.name)).join('');
      const parsed = le().parse(flatTex, { style: 'prop' });
      const all = groupings(operands, ops);
      if (!parsed || !all.some((g) => le().sameTree(g, parsed))) return;
      // The section's own example of this pair of operators
      const example = card.rule.examples.find((e) => pair.every((o) => (e.ops || []).includes(o))) || card.rule.examples[0];
      out.push(question({
        kind: 'precedence', key: `${ops.join(',')}`, label: 'Precedence', card, seed,
        stem: `By the section's precedence rules, how is $${flatTex}$ grouped?`,
        answer: tex(parsed), wrong: all.filter((g) => !le().sameTree(g, parsed)).map(tex),
        explanation: `The section shows that $${example.text}$ means $${example.grouped}$${pageNote(example.page)}; the same order of operators groups $${flatTex}$ as ${tex(parsed)}.`,
      }));
    });
    return out.filter(Boolean);
  }

  function build(cards, opts) {
    const { seed = 0, variant = 0, question } = opts;
    const of = (kind) => (cards || []).filter((c) => c.rule && c.rule.kind === kind);
    return [...formQuestions(of('form'), seed, variant, question), ...precedenceQuestions(of('precedence'), seed, variant, question)];
  }

  const api = { build, groupings };
  PDFStudy.workedForms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

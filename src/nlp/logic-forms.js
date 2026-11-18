/**
 * Logic Forms: two things a logic section states in its own sentences that a program can check and apply.
 * Pure and DOM-free (logic-eval.js parses and compares).
 *   forms(sentences) -> [{ name, base, form, baseTex, formTex, page, sentence }]
 *     "The proposition $q \to p$ is called the **converse** of $p \to q$."
 *     "The **contrapositive** of $p \to q$ is the proposition $\neg q \to \neg p$."
 *     A form is kept when the base is a conditional of two variables and the form a conditional of those
 *     variables or their negations, other than the base itself. Two forms at least, or none.
 *   precedence(sentences) -> { ops: [op], examples: [{ text, grouped, rather, page, sentence }] } | null
 *     "... so that $p\vee q\wedge r$ means $p\vee(q\wedge r$) rather than ($p\vee q)\wedge r$ ..."
 *     Every "X means Y rather than Z" the section prints is checked: X must parse as Y's grouping and not as Z's.
 *     One example that disagrees with logic-eval.js's precedence and none is used; ops are the binary operators
 *     whose order the agreeing examples show.
 * sentences: [{ text, page }] with the book's math and bold marks kept.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  // An expression in running text: single-letter variables (not letters of a word), operators, brackets, spaces
  const EXPR = '(?:(?<![A-Za-z])[a-z](?![A-Za-z])|[¬∧∨⊕→↔()]|\\s)+';
  const CALLED_RE = new RegExp(`proposition\\s+(${EXPR}?)\\s+is\\s+called\\s+the\\s+\\*\\*([a-z]+)\\*\\*\\s+of\\s+(${EXPR}?)(?=[.,;]|\\s+is\\b|$)`, 'gi');
  const OF_IS_RE = new RegExp(`The\\s+\\*\\*([a-z]+)\\*\\*\\s+of\\s+(${EXPR}?)\\s+is\\s+the\\s+proposition\\s+(${EXPR}?)(?=[.,;]|$)`, 'gi');
  const MEANS_RE = new RegExp(`(${EXPR}?)\\s*\\bmeans\\s+(${EXPR}?)\\s*\\brather\\s+than\\s+(${EXPR})`, 'g');
  const MIN_FORMS = 2;
  const MIN_EXAMPLES = 2;

  const SYMBOL_TEX = { '¬': '\\neg ', '∧': '\\wedge', '∨': '\\vee', '⊕': '\\oplus', '→': '\\to', '↔': '\\leftrightarrow' };
  const toTex = (s) => String(s).replace(/[¬∧∨⊕→↔]/g, (c) => SYMBOL_TEX[c]).replace(/\s+/g, ' ').trim();
  const flat = (s) =>le().normalise(String(s || '')).replace(/\s+/g, ' ');
  const parse = (s) => le().parse(String(s || '').trim(), { style: 'prop' });
  const isVar = (n) => n && n.op === 'var';
  const literal = (n) => isVar(n) || (n && n.op === 'not' && isVar(n.a));

  function forms(sentences) {
    const out = [];
    for (const s of sentences || []) {
      const text = flat(s.text);
      const found = [
        ...[...text.matchAll(CALLED_RE)].map((m) => ({ form: m[1], name: m[2], base: m[3] })),
        ...[...text.matchAll(OF_IS_RE)].map((m) => ({ name: m[1], base: m[2], form: m[3] })),
      ];
      for (const f of found) {
        const base = parse(f.base);
        const form = parse(f.form);
        if (!base || !form || base.op !== 'imp' || !isVar(base.a) || !isVar(base.b) || base.a.name === base.b.name) continue;
        if (form.op !== 'imp' || !literal(form.a) || !literal(form.b) || le().sameTree(base, form)) continue;
        const vars = le().variables(base);
        if (le().variables(form).join() !== vars.join()) continue;
        const name = f.name.toLowerCase();
        if (out.some((o) => o.name === name)) continue;
        out.push({ name, base, form, baseTex: le().render(base, 'prop'), formTex: le().render(form, 'prop'), page: s.page || null, sentence: s.text });
      }
    }
    // Every form must be stated on the same conditional (the same two letters in the same order)
    const same = out.filter((o) => out[0] && le().sameTree(o.base, out[0].base));
    return same.length >= MIN_FORMS ? same : [];
  }

  function precedence(sentences) {
    const examples = [];
    let disagrees = false;
    for (const s of sentences || []) {
      for (const m of flat(s.text).replace(/\*\*/g, '').matchAll(MEANS_RE)) {
        const [x, y, z] = [m[1], m[2], m[3]].map((e) => e.trim());
        const [px, py, pz] = [x, y, z].map(parse);
        if (!px || !py || !pz || le().operators(px).size < 2) continue;
        if (!le().sameTree(px, py) || le().sameTree(px, pz)) {
          disagrees = true;
          continue;
        }
        // The ungrouped expression as printed (its symbols as TeX), the two groupings in full brackets
        examples.push({ text: toTex(x), grouped: le().render(py, 'prop'), rather: le().render(pz, 'prop'), ast: px, ops: [...le().operators(px)], page: s.page || null, sentence: s.text });
      }
    }
    if (disagrees || examples.length < MIN_EXAMPLES) return null;
    const ops = [...new Set(examples.flatMap((e) => [...le().operators(e.ast)]))];
    // The pairs of operators whose order an example shows: only those are combined in a new expression
    const pairs = [...new Map(examples.map((e) => [...le().operators(e.ast)].filter((o) => o !== 'not').sort())
      .filter((p) => p.length === 2).map((p) => [p.join(), p])).values()];
    return { ops, pairs, examples: examples.map(({ ast, ...rest }) => rest) };
  }

  const api = { forms, precedence };
  PDFStudy.logicForms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

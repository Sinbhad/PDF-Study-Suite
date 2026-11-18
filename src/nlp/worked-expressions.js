/**
 * Worked Expressions: "What is the value of `7 <= 3 + 4`?" for a programming section whose table lists the
 * relational operators and shows an assignment between two values as an error (relational rule cards,
 * rule-cards.js). The key is computed by code-expr.js; the options are always true, false, the compile error and a run-time error, so
 * the student has to evaluate the expression. Pure and DOM-free.
 *   build(cards, { seed, variant, question }) -> [question]   (question: worked-questions.js's finisher)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const ce = () => dep('codeExpr', './code-expr.js');
  const hash = (s) => dep('workedQuestions', './worked-questions.js').hash(s);

  // Short labels: an option much longer than the others is a tell
  const ERROR = 'compile error';
  const RUNTIME = 'run-time error';
  const PER_SET = 2;
  const pageNote = (page) => (page ? ` (p. ${page})` : '');

  /** "a OP b + c" with small numbers, true or false as `want` says. */
  function instance(op, want, salt) {
    for (let k = 0; k < 40; k++) {
      const h = hash(`${salt}|${k}`);
      const a = 2 + (h % 8);
      const b = 1 + ((h >>> 4) % 6);
      const c = 1 + ((h >>> 8) % 6);
      const sign = (h >>> 12) & 1 ? '+' : '-';
      const expr = `${a} ${op} ${b} ${sign} ${c}`;
      if (ce().evaluate(expr) === want) return expr;
    }
    return null;
  }

  function build(cards, opts) {
    const { seed = 0, variant = 0, question } = opts;
    const ruled = (cards || []).filter((c) => c.rule && c.rule.kind === 'relational' && c.rule.assignmentError);
    const card = ruled[0];
    if (!card) return [];
    // The assignment question comes from the card about the error (a flag on one card leaves the other's questions)
    const errorCard = ruled.find((c) => c !== card) || card;
    const { ops, page, assignmentError } = card.rule;
    const out = [];
    // Four options, as every choice question has: true, false and the two failures (only the compile error is ever
    // right). The practice test leads with the assignment instead of a comparison.
    const extra = [RUNTIME];
    for (let i = 0; i < PER_SET; i++) {
      const salt = `rel|${seed}|${variant}|${i}`;
      const o = ops[(hash(salt) + i) % ops.length];
      const want = (hash(`${salt}|want`) + i + variant) % 2 === 0;
      const expr = instance(o.op, want, salt);
      if (!expr) continue;
      const value = ce().evaluate(expr);
      const [left, right] = expr.split(` ${o.op} `);
      out.push(question({
        kind: 'relational', key: expr, label: 'Evaluate', card, seed,
        stem: `What is the value of the expression \`${expr}\`?`,
        answer: String(value), wrong: [String(!value), ERROR, ...extra],
        explanation: `${right} is ${ce().arithmetic(right)}, and ${o.op} tests “${o.meaning.toLowerCase()}”${pageNote(page)}: ${left} ${o.op} ${ce().arithmetic(right)} is ${value}.`,
      }));
    }
    // An assignment between two values, as the section's table shows it: it does not compile
    const a = 2 + (hash(`asg|${seed}|${variant}`) % 7);
    const b = 2 + (hash(`asg2|${seed}|${variant}`) % 4);
    const expr = `${a * b} = ${a} * ${b}`;
    if (ce().evaluate(expr) === 'error') {
      out.push(question({
        kind: 'relational-error', key: expr, label: 'Evaluate', card: errorCard, seed,
        stem: `What is the value of the expression \`${expr}\`?`,
        answer: ERROR, wrong: ['true', 'false', ...extra],
        explanation: `A single = assigns a value; it does not compare. The section's table shows \`${assignmentError.expr}\` as an error${assignmentError.note ? `: “${assignmentError.note}”` : ''}${pageNote(assignmentError.page)}.`,
      }));
    }
    const kept = out.filter(Boolean);
    return variant % 2 ? [...kept.slice(-1), ...kept.slice(0, -1)] : kept;
  }

  const api = { build };
  PDFStudy.workedExpressions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

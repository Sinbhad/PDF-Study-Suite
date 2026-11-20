/**
 * Worked Gates: "With inputs X = 1 and Y = 0, which gate outputs 0?" over the gates the section defines (gate-rules.js).
 * The four gates offered are chosen so that exactly one of them gives the asked output for the asked inputs; every
 * output is computed, and the explanation lists each offered gate's output with the page of its definition.
 *   build(cards, { seed, variant, question }) -> [question]   (question: worked-questions.js's finisher)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const gr = () => dep('gateRules', './gate-rules.js');
  const hash = (s) => dep('workedQuestions', './worked-questions.js').hash(s);
  const ROWS = [[0, 0], [0, 1], [1, 0], [1, 1]];
  const PER_SET = 2;

  function build(cards, opts = {}) {
    const { seed = 0, variant = 0, question } = opts;
    const card = (cards || []).find((c) => c && c.rule && c.rule.kind === 'gates');
    if (!card) return [];
    const gates = card.rule.gates;
    const out = [];
    for (let k = 0; k < ROWS.length && out.length < PER_SET; k++) {
      const [x, y] = ROWS[(hash(`gates|${seed}|${variant}`) + k + variant * 2) % ROWS.length];
      for (const want of [0, 1]) {
        const right = gates.filter((g) => gr().output(g.gate, x, y) === want);
        const wrong = gates.filter((g) => gr().output(g.gate, x, y) !== want);
        if (right.length < 1 || wrong.length < 3) continue;
        const answer = right[(hash(`${x}${y}${want}|${seed}`) + variant) % right.length];
        const shown = [answer, ...wrong.slice(0, 3)];
        const pages = (g) => (g.page ? ` (p. ${g.page})` : '');
        const q = question({
          kind: 'gate-row', key: `${x}${y}|${want}|${answer.gate}`, label: 'Gates', card, seed,
          stem: `With inputs \`X = ${x}\` and \`Y = ${y}\`, which gate outputs ${want}?`,
          answer: answer.gate, wrong: wrong.map((g) => g.gate),
          explanation: `With X = ${x} and Y = ${y}: ${shown.map((g) => `${g.gate} gives ${gr().output(g.gate, x, y)}${pages(g)}`).join('; ')}.`,
        });
        if (q) {
          out.push(q);
          break;
        }
      }
    }
    return out;
  }

  const api = { build };
  PDFStudy.workedGates = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

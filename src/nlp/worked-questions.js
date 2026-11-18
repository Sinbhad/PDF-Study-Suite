/**
 * Worked Questions: multiple-choice questions the student has to work out, built only from rules the section
 * teaches (rule cards: rule-cards.js) and keyed by computation (logic-eval.js), never by reading prose. Every
 * wrong option is computed too and checked to differ from the key. Every explanation shows the rule and its page.
 *   build(cards, { seed, variant }) -> [question] in turn order (one kind after another)
 *     operator  "When p is true and q is false, which of these is true?"     (the section's own operators)
 *               "Which column is the truth table of p → q?"                    (other operators' columns as options)
 *               "For which values of p and q is p ∧ q true?"                   (an operator true or false in one row)
 *               "Which column is the truth table of (p ⊕ q) → ¬p?"             (two operators the section defines)
 *     bitwise   "What is the bitwise XOR of 101101 and 011100?"                (the other operations' results as options)
 *     count     "How many rows does the truth table of a function of 4 variables have?" / power-set size (2^n rule)
 *     identity, derived, law name: worked-algebra.js; relational expressions: worked-expressions.js;
 *     converse / contrapositive / inverse and precedence: worked-forms.js; subsets and power sets: worked-sets.js
 * A question carries the rule card's text as `source` (a flag on it removes every question of that rule),
 * `factKey` w|<kind>|<instance>, `worked: true`, `skill: 'worked'` and the rule's page.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');
  const shuffle = (list, key, seed) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(list, key, seed);

  const OP_TEX = { and: '\\wedge', or: '\\vee', xor: '\\oplus', imp: '\\to', iff: '\\leftrightarrow' };
  const BIT = { and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b, nand: (a, b) => 1 - (a & b), nor: (a, b) => 1 - (a | b), xnor: (a, b) => 1 - (a ^ b) };
  const BIT_LENGTH = 6;
  const COUNT_SIZES = { rows: [3, 4, 5], powerset: [3, 4, 5, 6] };
  const MIN_OPTIONS = 4; // a choice question always offers four options
  const MAX_OPTIONS = 4;

  /** A small deterministic hash: the same rule and seed always give the same instance. */
  function hash(s) {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const pick = (list, salt, seed) => list[(hash(salt) + seed) % list.length];
  const pageNote = (page) => (page ? ` (p. ${page})` : '');
  const valueWord = (v, style) => (style === 'bool' ? (v ? '1' : '0') : v ? 'true' : 'false');
  const valueLetter = (v, style) => (style === 'bool' ? (v ? '1' : '0') : v ? 'T' : 'F');
  const cardSource = (card) => `${card.front}: ${card.back}`;

  /** The finished question; null when fewer than MIN_OPTIONS distinct options are left. */
  function question({ kind, key, label, stem, answer, wrong, explanation, card, seed, subject }) {
    const seen = new Set([answer]);
    const distractors = [];
    for (const w of wrong) {
      if (distractors.length >= MAX_OPTIONS - 1 || seen.has(w)) continue;
      seen.add(w);
      distractors.push(w);
    }
    if (distractors.length + 1 < MIN_OPTIONS) return null;
    const page = card.page || card.pageNumber || ((card.rule || card.teaches) && (card.rule || card.teaches).page) || null;
    // The explanation always points to where the section states the rule; without a page there is no question.
    if (!page) return null;
    const shown = /\(p\. \d+\)/.test(explanation) ? explanation : `${explanation} (p. ${page})`;
    return {
      type: 'multiple_choice', badge: `Worked • ${label}`, question: stem,
      options: shuffle([answer, ...distractors], stem, seed), answer, explanation: shown,
      skill: 'worked', worked: true, category: 'Worked', subject: subject || card.subject || '',
      source: cardSource(card), factKey: `w|${kind}|${key}`, page, pageNumber: page,
    };
  }

  /** The section's operators as { op, ast, tex, card } on the variables p, q its own definitions use. */
  function operatorsOf(cards) {
    const out = [];
    for (const card of cards) {
      const r = card.rule;
      const ast = le().parse(r.tex, { style: r.style });
      if (ast) out.push({ op: r.op, ast, tex: r.tex, card, rule: r, style: r.style });
    }
    return out;
  }

  /** Operators applied to one pair of variables: the binary ones as printed, ¬ on the first variable. */
  function onPair(ops) {
    const binary = ops.filter((o) => o.op !== 'not' && le().variables(o.ast).length === 2);
    if (!binary.length) return { vars: [], list: [] };
    const vars = le().variables(binary[0].ast);
    const list = binary.filter((o) => le().variables(o.ast).join() === vars.join());
    const not = ops.find((o) => o.op === 'not');
    if (not) {
      const ast = { op: 'not', a: { op: 'var', name: vars[0] } };
      list.push({ ...not, ast, tex: le().render(ast, not.style) });
    }
    return { vars, list };
  }

  const assignment = (env, vars, style) => vars.map((v) => (style === 'bool' ? `$${v} = ${env[v] ? 1 : 0}$` : `$${v}$ is ${valueWord(env[v], style)}`)).join(' and ');
  const ruleLine = (o) => `${o.rule.statement || `$${o.tex}$ is the ${o.rule.name}.`}${pageNote(o.rule.page)}`;

  function whichIsTrue(pair, style, seed, variant) {
    const { vars, list } = pair;
    if (list.length < MIN_OPTIONS) return null;
    const rows = le().rows(vars);
    const env = rows[(seed + variant * 2 + 1) % rows.length];
    const valued = list.map((o) => ({ o, v: le().evaluate(o.ast, env) }));
    const trues = valued.filter((x) => x.v);
    const falses = valued.filter((x) => !x.v);
    const askTrue = trues.length && (falses.length >= trues.length || trues.length === 1) && falses.length >= MIN_OPTIONS - 1;
    const askFalse = !askTrue && falses.length && trues.length >= MIN_OPTIONS - 1;
    if (!askTrue && !askFalse) return null;
    const [right, wrong] = askTrue ? [trues, falses] : [falses, trues];
    const answer = pick(right, `row|${vars.join()}`, seed);
    const want = askTrue ? 'true' : 'false';
    const shown = [answer, ...wrong.slice(0, MAX_OPTIONS - 1)];
    const working = shown.map((x) => `$${x.o.tex}$ is ${valueWord(x.v, style)}`).join('; ');
    return question({
      kind: 'operator-row', key: `${answer.o.tex}|${JSON.stringify(env)}`, label: 'Truth value', card: answer.o.card, seed,
      stem: `When ${assignment(env, vars, style)}, which ${style === 'bool' ? `expression is equal to ${want === 'true' ? 1 : 0}` : `proposition is ${want}`}?`,
      answer: `$${answer.o.tex}$`, wrong: wrong.map((x) => `$${x.o.tex}$`),
      explanation: `With ${vars.map((v) => `$${v} = ${valueLetter(env[v], style)}$`).join(' and ')}: ${working}. ${ruleLine(answer.o)}`,
    });
  }

  const columnText = (ast, vars, style) => le().column(ast, vars).map((v) => valueLetter(v, style)).join(', ');
  const rowOrder = (vars, style) => le().rows(vars).map((env) => `(${vars.map((v) => valueLetter(env[v], style)).join(', ')})`).join(', ');

  function columnQuestion(target, others, vars, style, seed, extra = {}) {
    const answer = columnText(target.ast, vars, style);
    const wrong = others.map((o) => columnText(o.ast, vars, style));
    return question({
      kind: extra.kind || 'operator-column', key: target.tex, label: 'Truth table', card: target.card, seed,
      stem: `With the rows in the order (${vars.join(', ')}) = ${rowOrder(vars, style)}, which column is the truth table of $${target.tex}$?`,
      answer, wrong,
      explanation: extra.explanation || `$${target.tex}$ gives ${answer}. ${ruleLine(target)}`,
    });
  }

  /** "For which values of p and q is p ∧ q true?": an operator whose table has one row unlike the other three. */
  function uniqueRow(target, vars, style, seed, variant) {
    const col = le().column(target.ast, vars);
    const trues = col.filter(Boolean).length;
    if (trues !== 1 && trues !== col.length - 1) return null;
    const value = trues === 1;
    const rows = le().rows(vars);
    // "p = T, q = F": the truth values as letters, so no option repeats the stem's "true" / "false"
    const phrase = (env) => `$${vars.map((v) => `${v} = ${valueLetter(env[v], style)}`).join(',\\ ')}$`;
    const answerEnv = rows[col.indexOf(value)];
    return question({
      kind: 'operator-unique', key: target.tex, label: 'Truth table', card: target.card, seed,
      stem: `For which values of ${vars.map((v) => `$${v}$`).join(' and ')} is $${target.tex}$ ${style === 'bool' ? (value ? 'equal to 1' : 'equal to 0') : valueWord(value, style)}?`,
      // Every operator's question offers the same four rows; the practice test offers three of them, so its
      // options are never the quiz's set again (quiz-assembly.js refuses a repeated option set).
      answer: phrase(answerEnv),
      wrong: shuffle(rows.filter((env) => env !== answerEnv).map(phrase), `rows|${target.tex}`, seed).slice(0, variant % 2 ? 2 : 3),
      explanation: `$${target.tex}$ is ${valueWord(value, style)} only when ${phrase(answerEnv)}. ${ruleLine(target)}`,
    });
  }

  /** A two-operator expression of the section's own operators, its column worked out row by row. */
  function compoundColumn(pair, style, seed, variant) {
    const { vars, list } = pair;
    const binary = list.filter((o) => o.op !== 'not');
    const not = list.find((o) => o.op === 'not');
    if (binary.length < 2 || !not) return null;
    const outer = pick(binary.filter((o) => o.op === 'imp' || o.op === 'iff' || o.op === 'or'), `outer|${variant}`, seed);
    if (!outer) return null;
    const inner = pick(binary.filter((o) => o !== outer), `inner|${variant}`, seed);
    const [p, q] = vars;
    const left = { op: inner.op, a: { op: 'var', name: p }, b: { op: 'var', name: q } };
    const right = { op: 'not', a: { op: 'var', name: variant % 2 ? q : p } };
    const ast = { op: outer.op, a: left, b: right };
    const tex = le().render(ast, style);
    const parts = [left, right, { op: 'not', a: ast }, { op: outer.op, a: right, b: left }].map((a) => ({ ast: a }));
    const steps = [left, right, ast].map((a) => `$${le().render(a, style)}$: ${columnText(a, vars, style)}`).join('; ');
    return columnQuestion({ ast, tex, card: outer.card, rule: outer.rule }, parts, vars, style, seed, {
      kind: 'operator-compound',
      explanation: `Column by column: ${steps}. ${ruleLine(inner)} ${ruleLine(outer)}`,
    });
  }

  function operatorQuestions(cards, seed, variant) {
    const ops = operatorsOf(cards);
    if (!ops.length) return [];
    const style = ops[0].style;
    const pair = onPair(ops);
    if (pair.list.length < MIN_OPTIONS) return [];
    const binary = pair.list.filter((o) => o.op !== 'not');
    // Each set starts from another operator, so the quiz and the practice test work different ones.
    const order = shuffle(binary, `ops|${variant}`, seed + variant * 3);
    const out = [whichIsTrue(pair, style, seed, variant), compoundColumn(pair, style, seed, variant)];
    for (const target of order) {
      out.push(uniqueRow(target, pair.vars, style, seed, variant));
      out.push(columnQuestion(target, pair.list.filter((o) => o !== target && o.op !== 'not'), pair.vars, style, seed));
    }
    return out.filter(Boolean);
  }

  /** Two bit strings whose AND, OR and XOR all differ: at least one 1-1 pair and one mixed pair. */
  function bitStrings(salt, seed) {
    for (let k = 0; k < 50; k++) {
      const h = hash(`${salt}|${seed}|${k}`);
      const a = [];
      const b = [];
      for (let i = 0; i < BIT_LENGTH; i++) {
        a.push((h >> i) & 1);
        b.push((h >> (i + BIT_LENGTH + 3)) & 1);
      }
      const pairs = a.map((x, i) => `${x}${b[i]}`);
      // Every pair of bits once at least: the AND, OR and XOR then differ from each other and from both strings.
      if (['11', '10', '01', '00'].every((p) => pairs.includes(p))) return [a, b];
    }
    return null;
  }

  function bitwiseQuestions(cards, seed, variant) {
    const out = [];
    for (const card of cards) {
      const ops = card.rule.ops.filter((o) => BIT[o.op]);
      if (ops.length < 2) continue;
      const strings = bitStrings(card.front, seed + variant * 5);
      if (!strings) continue;
      const [a, b] = strings;
      const apply = (op) => a.map((x, i) => BIT[op](x, b[i])).join('');
      const target = pick(ops, `bit|${variant}`, seed);
      const answer = apply(target.op);
      const complement = answer.split('').map((c) => (c === '1' ? '0' : '1')).join('');
      const wrong = [...ops.filter((o) => o !== target).map((o) => apply(o.op)), complement];
      const sa = a.join('');
      const sb = b.join('');
      const working = ops.map((o) => `${o.word}${o.symbol ? ` (${o.symbol})` : ''} gives ${apply(o.op)}`).join('; ');
      out.push(question({
        kind: 'bitwise', key: `${target.op}|${sa}|${sb}`, label: 'Bit operations', card, seed,
        stem: `What is the bitwise ${target.word} of the bit strings ${sa} and ${sb}?`,
        answer, wrong,
        explanation: `Bit by bit, ${sa} and ${sb}: ${working}. ${card.rule.statement}${pageNote(card.rule.page)}`,
      }));
    }
    return out.filter(Boolean);
  }

  function countQuestions(cards, seed, variant) {
    const out = [];
    for (const card of cards) {
      const { what } = card.rule;
      const n = pick(COUNT_SIZES[what], `count|${what}|${variant}`, seed);
      const answer = 2 ** n;
      const wrong = [n * n, 2 * n, 2 ** (n + 1), 2 ** (n - 1), n + 2].filter((x) => x !== answer).map(String);
      const stem = what === 'rows'
        ? `How many rows does the truth table of a function of ${n} variables have?`
        : `A set has ${n} elements. How many elements does its power set have?`;
      out.push(question({
        kind: `count-${what}`, key: String(n), label: 'Counting', card, seed, stem, answer: String(answer), wrong,
        explanation: `$2^{${n}} = ${answer}$. ${card.rule.statement}${pageNote(card.rule.page)}`,
      }));
    }
    return out.filter(Boolean);
  }

  /** Every kind's questions, interleaved so a set takes one of each before a second of any. */
  function build(cards, opts = {}) {
    const seed = opts.seed || 0;
    const variant = opts.variant || 0;
    const ruled = (kind) => (cards || []).filter((c) => c && c.rule && c.rule.kind === kind);
    const setCards = (cards || []).filter((c) => c && (c.rule || c.teaches || {}).kind === 'set');
    const sets = dep('workedSets', './worked-sets.js');
    const algebra = dep('workedAlgebra', './worked-algebra.js');
    const expressions = dep('workedExpressions', './worked-expressions.js');
    const forms = dep('workedForms', './worked-forms.js');
    const groups = [
      operatorQuestions(ruled('operator'), seed, variant),
      forms ? forms.build([...ruled('form'), ...ruled('precedence')], { seed, variant, question }) : [],
      bitwiseQuestions(ruled('bitwise'), seed, variant),
      expressions ? expressions.build(ruled('relational'), { seed, variant, question }) : [],
      sets ? sets.build(setCards, { seed, variant, question }) : [],
      countQuestions(ruled('count'), seed, variant),
      ...(algebra ? algebra.build([...ruled('identity'), ...ruled('derived')], { seed, variant, question }) : []),
    ].filter((g) => g.length);
    const out = [];
    for (let i = 0; groups.some((g) => g[i]); i++) groups.forEach((g) => g[i] && out.push(g[i]));
    return out;
  }

  const api = { build, hash };
  PDFStudy.workedQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

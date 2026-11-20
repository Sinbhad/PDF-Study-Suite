/**
 * Worked Branches: the section's own decisions (branch-rules.js) run on a value, the key computed here.
 *   chain   "In the if / else if / else sequence of section 5.3 (p. 236), richter is 6.3. What is description
 *           afterwards?"  the other branches' strings as options; the value lies between two of the tests, or on one
 *   choice  "floor is 20. What does `if (floor > 13) {...} else {...}` set actualFloor to?"  the other branch's
 *           value, the value itself and one off as options
 *   build(cards, { seed, variant, question }) -> [question]   (question: worked-questions.js's finisher)
 *   runChain(rule, value) / runChoice(rule, value) -> what the code assigns
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const hash = (s) => dep('workedQuestions', './worked-questions.js').hash(s);
  const ce = () => dep('codeExpr', './code-expr.js');

  const COMPARE = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '==': (a, b) => a === b, '!=': (a, b) => a !== b };
  /** A value as the code writes its tests: "7.0" beside "richter >= 7.0", "90" beside "score >= 90". */
  const fmtFor = (rule) => (n) => (Number.isInteger(n) && /\d\.\d/.test(rule.code) ? n.toFixed(1) : String(Math.round(n * 10) / 10));
  const where = (rule) => `${rule.number ? `section ${rule.number} ` : ''}(p. ${rule.page})`;

  /** The branch a chain runs for `value`: { index, value } (index = tests.length for the final else). */
  function runChain(rule, value) {
    const at = rule.tests.findIndex((t) => COMPARE[rule.op](value, t));
    return at < 0 ? { index: rule.tests.length, value: rule.fallback } : { index: at, value: rule.values[at] };
  }

  /** What a two-way choice assigns for `value`, or null when its arithmetic cannot be worked out. */
  function runChoice(rule, value) {
    const taken = COMPARE[rule.op](value, rule.limit);
    const expr = (taken ? rule.yes : rule.no).replace(new RegExp(`\\b${rule.variable}\\b`, 'g'), String(value));
    return { taken, value: ce().arithmetic(expr) };
  }

  /** A value for the chain: between two tests (variant 0) or exactly on one (variant 1, a ">=" test then holds). */
  function chainValue(rule, salt, variant) {
    const sorted = [...rule.tests].sort((a, b) => a - b);
    const gap = 1 + (hash(salt) % (sorted.length - 1)); // never below the lowest or above the highest test
    const lo = sorted[gap - 1];
    const hi = sorted[gap];
    if (variant % 2 && /=/.test(rule.op)) return hi;
    return Math.round((lo + (hi - lo) * 0.3) * 10) / 10;
  }

  /** Candidate inputs spanning every region below, between and above the sorted branch thresholds. */
  function chainRegions(rule) {
    const sorted = [...rule.tests].sort((a, b) => a - b);
    const round1 = (n) => Math.round(n * 10) / 10;
    const stepLo = Math.max(0.5, (sorted[1] - sorted[0]) * 0.4);
    const stepHi = Math.max(0.5, (sorted[sorted.length - 1] - sorted[sorted.length - 2]) * 0.4);
    const regions = [round1(sorted[0] - stepLo)];
    for (let i = 1; i < sorted.length; i++) regions.push(round1(sorted[i - 1] + (sorted[i] - sorted[i - 1]) * 0.3));
    regions.push(round1(sorted[sorted.length - 1] + stepHi));
    return regions;
  }

  const MAX_CHAIN_STEM = 295;

  /**
   * Compact if/else-if prefix up to `branchIndex`: keeps every earlier guard verbatim (never skips an
   * earlier condition) and folds trailing branches into `; else { ... }` when the full chain would overflow.
   */
  function codeUpTo(rule, branchIndex) {
    const parts = [];
    for (let i = 0; i <= branchIndex && i < rule.tests.length; i++) {
      const kw = i === 0 ? 'if' : 'else if';
      parts.push(`${kw} (${rule.variable} ${rule.op} ${rule.tests[i]}) ${rule.target} = "${rule.values[i]}";`);
    }
    if (branchIndex >= rule.tests.length && rule.fallback) parts.push(`else ${rule.target} = "${rule.fallback}";`);
    else parts.push('else { ... }');
    return parts.join(' ');
  }

  function chainQuestion(card, seed, variant, question) {
    const rule = card.rule;
    const fmt = fmtFor(rule);
    const regions = chainRegions(rule);
    const makeStem = (code, val) => `For which value of \`${rule.variable}\` does \`${code}\` set \`${rule.target}\` to "${val}"?`;
    let value = chainValue(rule, `${seed}|${variant}`, variant);
    let run = runChain(rule, value);
    let code = rule.code;
    if (makeStem(code, run.value).length > MAX_CHAIN_STEM) {
      // Pick a branch whose prefix-with-guards fits comfortably inside MAX_CHAIN_STEM so the stem stays self-contained.
      const fitting = regions
        .map((r) => ({ r, run: runChain(rule, r), code: codeUpTo(rule, runChain(rule, r).index) }))
        .filter((x) => makeStem(x.code, x.run.value).length <= MAX_CHAIN_STEM);
      if (fitting.length) {
        const picked = fitting[(hash(`${seed}|${variant}`) + variant) % fitting.length];
        value = picked.r;
        run = picked.run;
        code = picked.code;
      } else {
        code = codeUpTo(rule, run.index);
      }
    }
    // Pick three distractors from distinct other branches so every option evaluates uniquely via runChain.
    const seenOutcomes = new Set([run.value]);
    const wrong = [];
    for (const cand of regions) {
      if (fmt(cand) === fmt(value)) continue;
      const out = runChain(rule, cand);
      if (seenOutcomes.has(out.value)) continue;
      seenOutcomes.add(out.value);
      wrong.push(fmt(cand));
    }
    if (wrong.length < 3) return null;
    const chosenWrong = wrong.slice(0, 3);
    const steps = [];
    for (let i = 0; i < rule.tests.length; i++) {
      const holds = COMPARE[rule.op](value, rule.tests[i]);
      steps.push(`${fmt(value)} ${rule.op} ${fmt(rule.tests[i])} is ${holds}`);
      if (holds) break;
    }
    const outcome = run.index < rule.tests.length ? `so that branch runs and no later test is tried` : `no test succeeds, so the final else runs`;
    return question({
      kind: 'branch-chain', key: `${rule.variable}=${fmt(value)}`, label: 'Trace', card, seed,
      stem: makeStem(code, run.value),
      answer: fmt(value), wrong: chosenWrong,
      explanation: `${steps.join('; ')}: ${outcome}, setting ${rule.target} to "${run.value}" (${where(rule).replace(/^\((.*)\)$/, '$1')}). Rule: the first branch whose test succeeds wins.`,
    });
  }

  function choiceQuestion(card, seed, variant, question) {
    const rule = card.rule;
    // Variant 0 takes the first branch, variant 1 the else branch.
    const offset = 2 + (hash(`${seed}|choice`) % 6);
    const above = /</.test(rule.op) ? variant % 2 === 1 : variant % 2 === 0;
    const value = above ? rule.limit + offset : rule.limit - offset;
    const run = runChoice(rule, value);
    if (run.value === null) return null;
    const other = ce().arithmetic((run.taken ? rule.no : rule.yes).replace(new RegExp(`\\b${rule.variable}\\b`, 'g'), String(value)));
    // Slips: the other branch, one off either way, the value unchanged, the test's own number.
    const wrong = [other, run.value + 1, run.value - 1, value, value + 1, rule.limit].filter((w) => w !== null && w !== run.value).map(String);
    return question({
      kind: 'branch-choice', key: `${rule.variable}=${value}`, label: 'Trace', card, seed,
      stem: `\`${rule.variable}\` is ${value}. What does \`${rule.code}\` set \`${rule.target}\` to?`,
      answer: String(run.value), wrong,
      explanation: `${value} ${rule.op} ${rule.limit} is ${run.taken}, so ${rule.target} = ${run.taken ? rule.yes : rule.no} = ${run.value} (${where(rule).replace(/^\((.*)\)$/, '$1')}).`,
    });
  }

  function build(cards, opts = {}) {
    const { seed = 0, variant = 0, question } = opts;
    const out = [];
    for (const card of (cards || []).filter((c) => c && c.rule && c.rule.kind === 'branch')) {
      out.push(card.rule.form === 'chain' ? chainQuestion(card, seed, variant, question) : choiceQuestion(card, seed, variant, question));
    }
    return out.filter(Boolean);
  }

  const api = { build, runChain, runChoice };
  PDFStudy.workedBranches = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

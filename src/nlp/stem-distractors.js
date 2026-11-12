/**
 * Typed STEM Distractors (extracted from quiz-engine.js; re-exported there as selectDistractors).
 * Formula answers get mathematically plausible perturbations (sign flip, dropped square, swapped
 * product order, inverted fraction, sibling trig/log function, missing + C); complexity answers get
 * sibling growth classes; prose answers never receive formula distractors and vice versa.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');

  function deterministicShuffle(items, seedStr, seedOffset = 0) {
    const arr = [...items];
    let hash = 2166136261 ^ (seedOffset * 16777619);
    for (let i = 0; i < seedStr.length; i++) hash = Math.imul(hash ^ seedStr.charCodeAt(i), 16777619);
    for (let i = arr.length - 1; i > 0; i--) {
      hash = Math.imul(hash ^ (i + 1 + seedOffset), 16777619);
      const j = Math.abs(hash) % (i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  const LADDER = ['1', '\\log n', '\\sqrt{n}', 'n', 'n \\log n', 'n^{2}', 'n^{3}', '2^{n}', 'n!'];
  const ladderKey = (s) => s.replace(/\\/g, '').replace(/[\s{}]/g, '').replace(/lg|log_?2|logn/g, (m) => (m === 'logn' ? 'logn' : 'log'));

  /** Sibling asymptotic classes, nearest first, same notation (O/Θ/Ω) and same $ fencing. */
  function complexityDistractors(answer, count = 3) {
    const s = String(answer).trim();
    const fenced = /^\$.*\$$/.test(s);
    const inner = s.replace(/^\$|\$$/g, '').trim();
    const m = inner.match(/^(O|o|Θ|Ω|\\Theta|\\Omega|Big-O)\s*\(\s*(.*)\)$/);
    if (!m) return [];
    const key = ladderKey(m[2]);
    let idx = LADDER.findIndex((l) => ladderKey(l) === key);
    if (idx < 0) idx = 4;
    const order = [idx - 1, idx + 1, idx + 2, idx - 2, idx + 3, idx - 3].filter((i) => i >= 0 && i < LADDER.length && i !== idx);
    return order.slice(0, count).map((i) => {
      const expr = `${m[1]}(${LADDER[i]})`;
      return fenced || /\\/.test(LADDER[i]) ? `$${expr}$` : expr;
    });
  }

  const SWAPS = [
    ['\\sin', '\\cos'], ['\\sec', '\\csc'], ['\\tan', '\\cot'], ['\\ln', '\\log'], ['\\le', '\\ge'], ['<', '>'],
    ['\\lim', '\\sum'], ['\\infty', '0'], ['dx', 'dy'],
  ];

  const formulaFamily = (s) => {
    if (/\bT\s*\(/.test(s)) return 'recurrence';
    if (mt().isComplexity(s)) return 'complexity';
    if (/\\int|∫/.test(s)) return 'integral';
    if (/\\sum|∑/.test(s)) return 'series';
    return 'algebra_calc';
  };

  /** Mathematically plausible wrong versions of a formula, each distinct and bracket-balanced. */
  function formulaDistractors(answer, count = 3) {
    const s = String(answer);
    const fenced = /^\$[\s\S]*\$$/.test(s);
    const body = fenced ? s.slice(1, -1) : s;
    const wrap = (b) => (fenced ? `$${b}$` : b);
    const out = [];
    const add = (v) =>
      v && v !== s && mt().isBalanced(v) && !/[\^_]\s*[+\-−=)}\]]|[\s+\-−=()[\]0-9]\{[^{}]*\}/.test(v) &&
      mt().formulaKey(v) !== mt().formulaKey(s) && !out.includes(v) && out.push(v);
    // CS recurrence perturbations: T(n) = aT(n/b) + f(n) -> sibling branching & combine costs
    if (/\bT\s*\(\s*n\s*\)/.test(body)) {
      if (/\b2\s*T\s*\(/.test(body)) { add(wrap(body.replace(/\b2(\s*T\s*\()/, '$1'))); add(wrap(body.replace(/\b2(\s*T\s*\()/, '4$1'))); }
      if (/T\s*\(\s*n\s*\/\s*2\s*\)/.test(body)) add(wrap(body.replace(/T\s*\(\s*n\s*\/\s*2\s*\)/, 'T(n - 1)')));
      if (/\+\s*(?:O|Θ|\\Theta)\s*\(\s*n\s*\)/.test(body)) {
        add(wrap(body.replace(/\+\s*(O|Θ|\\Theta)\s*\(\s*n\s*\)/, '+ $1(1)')));
        add(wrap(body.replace(/\+\s*(O|Θ|\\Theta)\s*\(\s*n\s*\)/, '+ $1(n^{2})')));
      }
    }
    // sign flip on binary +/-, else overall sign negation (e.g. \sec^{2} x -> -\sec^{2} x)
    const sign = body.match(/\s[-−+]\s/);
    if (sign) add(wrap(body.replace(sign[0], sign[0].includes('+') ? ' - ' : ' + ')));
    else if (!/^[-−]/.test(body) && !body.includes('=')) add(wrap(`-${body}`));
    // dropped / added square in a denominator or power (\sec^{2} x -> \sec x, 1/x -> 1/x^{2} and -1/x^{2})
    if (/\^\{?2\}?/.test(body)) add(wrap(body.replace(/\^\{?2\}?/, '')));
    else if (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(body)) {
      add(wrap(body.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/, '\\frac{$1}{$2^{2}}')));
      if (!/^[-−]/.test(body) && !body.includes('=')) {
        add(wrap('-' + body.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/, '\\frac{$1}{$2^{2}}')));
      }
    }
    // trig derivative siblings (\sec^{2} x <-> \sec x \tan x, \csc^{2} x <-> -\csc x \cot x)
    if (/\\sec\^\{?2\}?\s*([A-Za-z])/.test(body)) add(wrap(body.replace(/\\sec\^\{?2\}?\s*([A-Za-z])/, '\\sec $1 \\tan $1')));
    if (/\\csc\^\{?2\}?\s*([A-Za-z])/.test(body)) add(wrap(body.replace(/\\csc\^\{?2\}?\s*([A-Za-z])/, '\\csc $1 \\cot $1')));
    // swapped product/term order in "A - B" (each atom keeps scripts x^{2}, \cmd{...}, (), [] intact)
    const atom = '(?:\\\\[A-Za-z]+(?:\\{[^{}]*\\})*|[^{}[\\]()\\s=^_+\\-−]+|\\([^{}()]*\\)|\\[[^{}[\\]]*\\]|[_^](?:\\{[^{}]*\\}|[A-Za-z0-9]))+';
    const diff = body.match(new RegExp(`(?<![_\\\\^])(${atom})\\s[-−]\\s(${atom})(?![{^_])`));
    if (diff && !/^\\(?:int|sum|prod|lim|sqrt)$/.test(diff[2])) add(wrap(body.replace(diff[0], `${diff[2]} - ${diff[1]}`)));
    // inverted fraction (skip trivial \frac{1}{x} -> \frac{x}{1})
    const fr = body.match(/\\frac\{([^{}]+)\}\{([^{}]+)\}/);
    if (fr && fr[1] !== '1') add(wrap(body.replace(fr[0], `\\frac{${fr[2]}}{${fr[1]}}`)));
    for (const [a, b] of SWAPS) {
      if (body.includes(a)) add(wrap(body.split(a).join(b)));
      else if (body.includes(b) && b.length > 1) add(wrap(body.split(b).join(a)));
    }
    if (/\+\s*C\b/.test(body)) add(wrap(body.replace(/\s*\+\s*C\b/, '')));
    const num = body.match(/(^|[^\w^_{])(\d+)(?![\w.])/);
    if (num) add(wrap(body.replace(num[0], `${num[1]}${+num[2] === 1 ? 2 : +num[2] + 1}`)));
    if (/^[-−]/.test(body)) add(wrap(body.replace(/^[-−]\s*/, '')));
    return out.slice(0, count);
  }

  /** Same-shape pool filter: formula answers only face formulas, prose only prose (matching math-token presence). */
  function typedPool(target, pool) {
    const isF = mt().isFormula(target);
    const hasM = mt().hasMathToken(target);
    return (pool || []).filter((p) => mt().isFormula(p) === isF && (isF || mt().hasMathToken(p) === hasM));
  }

  /** ctx: { trusted, headingWords, profile } as documented in quiz-engine.js. */
  function selectDistractors(target, candidatePool, questionStem = '', count = 3, seedOffset = 0, ctx = {}) {
    const gate = dep('quizGate', './quiz-gate.js');
    const tClean = String(target).trim();
    if (mt().isComplexity(tClean)) {
      const sib = complexityDistractors(tClean, count);
      if (sib.length >= count) return sib;
    }
    if (mt().isFormula(tClean)) {
      const tk = mt().formulaKey(tClean);
      const isEq = tClean.includes('='), fam = formulaFamily(tClean);
      const peers = typedPool(tClean, candidatePool).filter((p) => mt().formulaKey(p) !== tk && p.includes('=') === isEq && formulaFamily(p) === fam);
      const merged = [...formulaDistractors(tClean, count), ...peers].filter((v, i, a) => a.findIndex((w) => mt().formulaKey(w) === mt().formulaKey(v)) === i);
      return (seedOffset > 0 ? deterministicShuffle(merged, tClean, seedOffset) : merged).slice(0, count);
    }
    const tBucket = gate.getShapeBucket(tClean);
    if (tBucket === 'YEAR') {
      const yr = parseInt(tClean, 10);
      return [String(yr - 10), String(yr - 3), String(yr + 5)].slice(0, count);
    }
    if (tBucket === 'NUMBER') {
      const m = tClean.match(/^(\d+(?:\.\d+)?)(.*)$/);
      if (m) {
        const val = parseFloat(m[1]);
        const isInt = !m[1].includes('.');
        return [val * 0.5, val * 1.5, val * 2.0]
          .map((v) => `${isInt ? Math.max(1, Math.round(v)) : v.toFixed(1)}${m[2] || ''}`)
          .slice(0, count);
      }
    }
    const opts = dep('quizOptions', './quiz-options.js');
    const ranked = opts.rankDistractors(tClean, typedPool(tClean, candidatePool), questionStem, ctx);
    const topPool = ranked.slice(0, Math.max(count, Math.min(6, ranked.length)));
    const picked = seedOffset > 0 ? deterministicShuffle(topPool, tClean, seedOffset) : topPool;
    return picked.slice(0, count);
  }

  const api = { deterministicShuffle, complexityDistractors, formulaDistractors, typedPool, selectDistractors };
  PDFStudy.stemDistractors = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

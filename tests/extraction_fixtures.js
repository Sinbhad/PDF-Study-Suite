/**
 * Digital-PDF Extraction Fixtures (runs under Node via `node tests/extraction_fixtures.js`).
 * Small hand-built PDF.js text items for reading order of numbered exercise grids, prose words between
 * formulas, table cells, words whose space was kerned away, limit bounds versus radical indices, graph ticks
 * in exercise sets and hyphenated margin notes; plus the defect counters of tools/eval-text.js.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const W = 612;
  const H = 792;
  const FONTS = new Map([['r', 'AAAAAA+Times-Roman'], ['i', 'AAAAAA+Times-Italic'], ['p1', 'AAAAAA+MathematicalPi-One'],
    ['p3', 'AAAAAA+MathematicalPi-Three'], ['s', 'AAAAAA+Symbol']]);

  function load() {
    ['tokenizer', 'noise-filter'].forEach((m) => require(`../src/nlp/${m}.js`));
    ['math-glyphs', 'math-tex', 'font-decoder', 'page-rules', 'math-line', 'formula-builder', 'span-format', 'column-layout',
      'line-builder', 'pdf-loader', 'page-kind', 'scope-lines', 'figure-filter', 'text-cleaner'].forEach((m) => require(`../src/pdf/${m}.js`));
    return root.PDFStudy;
  }

  /** PDF.js-style item at viewport x / baseline y; width defaults to 0.5em per character. */
  function it(str, x, y, f = 'r', size = 10, width) {
    return { str, fontName: f, transform: [size, 0, 0, size, x, H - y], width: width || str.length * size * 0.5 };
  }
  const lines = (S, items, rules = []) => S.pdfLoader.reconstructLines(items, {}, W, H, { fontNames: FONTS, rules });
  const fmt = (ls) => ls.map((l) => l.formattedText).join(' | ');
  const itemNumbers = (ls) => ls.map((l) => (l.text.match(/^(\d+)\./) || [])[1]).filter(Boolean).map(Number);

  function checkGrid(S, check) {
    // Exercise grid: 33 | 34 over 35 | 36, each with sub-parts, in two narrow columns
    const cell = (n, x, y) => [it(`${n}. Find the limit of g`, x, y), it('(a) as x approaches 2', x + 12, y + 12),
      it('(b) as x approaches 5', x + 12, y + 24)];
    const grid = lines(S, [...cell(33, 72, 100), ...cell(34, 260, 100), ...cell(35, 72, 140), ...cell(36, 260, 140)]);
    check('numbered grid is read item by item', JSON.stringify(itemNumbers(grid)) === '[33,34,35,36]', fmt(grid));
    check('grid sub-parts stay with their item', /^34\./.test(grid[3].text) && /^\(a\)/.test(grid[4].text) && /^35\./.test(grid[6].text), fmt(grid));
    // Two real columns of a numbered list (1-4 then 5-8) keep column order; so do two separate lists
    const col = (from, x) => [0, 1, 2, 3].map((k) => it(`${from + k}. Describe the behaviour near the point`, x, 100 + k * 14));
    const real = lines(S, [...col(1, 72), ...col(5, 300)]);
    check('real columns of one list keep column order', JSON.stringify(itemNumbers(real)) === '[1,2,3,4,5,6,7,8]', fmt(real));
    const two = lines(S, [...col(1, 72), ...col(1, 300)]);
    check('two separate lists side by side stay apart', JSON.stringify(itemNumbers(two)) === '[1,2,3,4,1,2,3,4]', fmt(two));
  }

  function checkMathProse(S, check) {
    const ls = lines(S, [it('nonexistence of', 72, 100), it('f', 150, 100, 'i'), it('(', 153, 100), it('x', 156, 100, 'i'),
      it(')', 161, 100), it('at', 169, 100, 'i'), it('x', 182, 100, 'i'), it('=', 191, 100, 'p1'), it('c', 201, 100, 'i'),
      it('has no bearing.', 210, 100)]);
    check('short italic word between formulas is prose', ls.length === 1 && /\$f\(x\)\$ at \$x = c\$ has no bearing\./.test(ls[0].formattedText), fmt(ls));
    const v = lines(S, [it('v', 72, 100, 'i'), it('=', 80, 100, 'p1'), it('at', 92, 100, 'i')]);
    check('"at" after an operator stays a product', v.length === 1 && v[0].formattedText === '$$v = at$$', fmt(v));
    const T = S.mathTex;
    check('upright words in a formula form one \\text run', T.texOf('Change in y') === '\\text{Change in}\\,y' &&
      T.texOf('Area') === '\\text{Area}' && T.texOf('sin x') === '\\sin x', `${T.texOf('Change in y')} ${T.texOf('Area')}`);
    const table = lines(S, [it('f', 72, 100, 'i'), it('(x)', 76, 100), it('1.99499', 100, 100, 'r', 10, 32), it('1.99950', 145, 100, 'r', 10, 32)]);
    check('table cells of numbers stay apart', table.length === 1 && /1\.99499\\quad 1\.99950/.test(table[0].formattedText), fmt(table));
  }

  function checkWordEdges(S, check) {
    const head = lines(S, [it('The Derivative and the', 72, 100, 'r', 12, 128), it('Tangent Line Problem', 200.5, 100, 'r', 12)]);
    check('touching items "the|Tangent" get their space back', head[0] && head[0].text === 'The Derivative and the Tangent Line Problem', fmt(head));
    const glued = lines(S, [it('and mathematics.The idea of', 72, 100)]);
    check('"mathematics.The" gets its space back', glued[0] && glued[0].text === 'and mathematics. The idea of', fmt(glued));
    const url = lines(S, [it('See LarsonCalculus.com for more, e.g.Theorem 2.', 72, 100)]);
    check('domains and short abbreviations are left alone', url[0] && /LarsonCalculus\.com/.test(url[0].text) && /e\.g\.Theorem/.test(url[0].text), fmt(url));
  }

  function checkLimitBound(S, check) {
    // Row 1: lim with "x -> -3" underneath; row 2: a tall radical whose index zone reaches up to that bound
    const items = [it('11.', 60, 100), it('lim', 91, 100, 'r', 9, 12), it('x', 88, 106, 'i', 5.9, 3), it('→', 91, 106, 's', 5.9, 6),
      it('−', 97.5, 106, 'p1', 5.9, 5), it('3', 103, 106, 'r', 5.9, 3), it('(2', 112, 100), it('x', 122, 100, 'i'), it('+ 1)', 128, 100),
      it('13.', 60, 126), it('|', 101, 126, 'p3', 13, 8), it('x', 115, 126, 'i'), it('+', 121, 126, 'p1'), it('1', 129, 126)];
    const ls = lines(S, items, [{ x0: 109, x1: 135, y: 116 }]);
    const all = fmt(ls);
    check('limit keeps its bound', /\\lim_\{x \\to -3\}/.test(all), all);
    check('radical below takes no index from the bound above', /\\sqrt\{x \+ 1\}/.test(all) && !/\\sqrt\[/.test(all), all);
  }

  function checkCleaner(S, check) {
    const L = (text, topY, o = {}) => ({ text: text.replace(/\*\*|\$/g, ''), formattedText: text, topY, bottomY: topY + (o.fontSize || 10),
      fontSize: 10, x0: 72, x1: 300, isBold: false, wordCount: text.split(/\s+/).length, ...o });
    const tick = { fontSize: 7, x0: 400, x1: 410 };
    const page = { pageNumber: 3, height: H, width: W, lines: [
      L('A function can be continuous on an interval without being differentiable at every point of it.', 80, { x1: 540 }),
      L('**1.3 Exercises**', 120, { fontSize: 21, isBold: true }),
      L('5. $\\lim_{x \\to 2}x^{3}$', 150), L('6. $\\lim_{x \\to -3}x^{4}$', 150, { x0: 320, x1: 420 }),
      L('$y$', 170, tick), L('2', 180, tick), L('$-2\\quad 2$', 190, { ...tick, x1: 450 }),
      L('(b) $\\cos(\\arcsec\\sqrt{5})$', 200, { fontSize: 7 }), L('61. $(\\sqrt 3, 1.56)\\quad 62.(-2,-2.45)$', 215),
      L('96. What is meant by an indetermi-', 230), L('nate form?', 242),
      { ...L('Descartes made many contribu-', 50), isMargin: true, x0: 20, x1: 60 },
      { ...L('tions to philosophy, science and', 62), isMargin: true, x0: 20, x1: 60 },
      { ...L('mathematics in his long life.', 74), isMargin: true, x0: 20, x1: 60 },
    ] };
    page.lines.sort((a, b) => (a.isMargin ? 1 : 0) - (b.isMargin ? 1 : 0));
    const out = S.textCleaner.processSectionPages([page]);
    const ex = out.exerciseText.split('\n');
    check('graph ticks leave the exercise text', !ex.some((l) => /^(?:\$y\$|2|\$-2\\quad 2\$)$/.test(l)), out.exerciseText);
    check('exercise items survive, side by side or small', ['5. $\\lim', '6. $\\lim', '(b) $\\cos', '61. $(\\sqrt 3'].every((k) => out.exerciseText.includes(k)), out.exerciseText);
    check('hyphenated exercise prompt is joined', out.exerciseText.includes('an indeterminate form?'), out.exerciseText);
    check('hyphenated margin note is joined', out.text.includes('Descartes made many contributions to philosophy'), out.text);
  }

  function checkCounters(check) {
    const C = require('../tools/eval-text-counters.js');
    const clean = C.countDefects('The derivative of $x^{2}$ is $2x$.\n1. Find $f(2)$.\n2. Find $\\lim_{x \\to 0}f(x)$.');
    check('counters: clean text scores zero', Object.entries(clean.counts).every(([k, v]) => k === 'lines' || v === 0), JSON.stringify(clean.counts));
    const bad = C.countDefects(['1.3 Evaluating Limits Analytically 67', '2', '$y$', 'Descartes made many contribu-', 'tions to it.',
      '3. A', '5. B', '4. C', '(a) $x$', '(a) $y$', 'existence of $f(x)atx = c$', '11. $\\lim_{x \\to}(2x + 1)$',
      'and mathematics.The idea', 'a Limit of aTrigonometric Function', '$f(x)1.994991.99950$', '$12.80 per pound'].join('\n'));
    const want = { header: 1, figure: 2, hyphen: 1, order: 1, subpart: 1, math: 3, glued: 2, table: 1 };
    check('counters: each defect kind is found', Object.entries(want).every(([k, v]) => bad.counts[k] === v), JSON.stringify(bad.counts));
    check('counters: cases and point labels are not prose in math', C.mathDefects(['$$f(x) = \\begin{cases} 1, & x > 0 \\end{cases}$$',
      '$\\text{Area}\\triangle PAO$', '$\\int x\\sin xdx$']).length === 0);
  }

  function runExtractionChecks() {
    const S = load();
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name: `[extraction] ${name}`, ok: Boolean(ok), detail });
    for (const fn of [checkGrid, checkMathProse, checkWordEdges, checkLimitBound, checkCleaner, (s, c) => checkCounters(c)]) {
      try {
        fn(S, check);
      } catch (err) {
        check(`${fn.name || 'checkCounters'} threw`, false, err && err.stack);
      }
    }
    return { results, passed: results.every((r) => r.ok) };
  }

  if (IS_NODE) {
    module.exports = { runExtractionChecks };
    if (require.main === module) {
      const report = runExtractionChecks();
      for (const r of report.results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
      console.log(report.passed ? 'PASS' : 'FAIL');
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

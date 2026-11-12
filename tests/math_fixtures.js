/**
 * Math Extraction Fixtures (node tests/math_fixtures.js, or tests/quality.html): glyph repair for
 * Mathematical Pi / Symbol / PUA fonts, super/subscripts, rule-based stacked fractions, lim / ∑ / ∫ bounds,
 * radicals and code rows, all emitted as `$...$` / `$$...$$` TeX per the swarm math contract.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const W = 612;
  const H = 792;
  const FONTS = new Map([
    ['r', 'AAAAAA+Times-Roman'], ['i', 'AAAAAA+Times-Italic'], ['p1', 'AAAAAA+MathematicalPi-One'],
    ['p3', 'AAAAAA+MathematicalPi-Three'], ['c', 'AAAAAA+Courier'], ['s', 'AAAAAA+Symbol'],
  ]);

  function load() {
    if (IS_NODE) {
      ['math-glyphs', 'math-tex', 'font-decoder', 'page-rules', 'math-line', 'formula-builder', 'span-format',
        'column-layout', 'line-builder', 'pdf-loader'].forEach((m) => require(`../src/pdf/${m}.js`));
    }
    return root.PDFStudy;
  }

  /** Item at viewport x / baseline y; width defaults to 0.5em per char. */
  function it(str, x, y, f = 'r', size = 10, width) {
    return { str, fontName: f, transform: [size, 0, 0, size, x, H - y], width: width || str.length * size * 0.5 };
  }

  const lines = (S, items, rules = []) => S.pdfLoader.reconstructLines(items, {}, W, H, { fontNames: FONTS, rules });
  const fmt = (ls) => ls.map((l) => l.formattedText);

  function checkGlyphs(S, check) {
    const G = S.mathGlyphs;
    const one = G.familyInfo('X+MathematicalPi-One');
    check('MathPi fallback: ≤ is a prime, ⋅ is Delta, ≠ is infinity', G.decodeString('f≤ ⋅x ≠', one) === 'f′ Δx ∞');
    check('MathPi glyph names: π, ≠ (HS11005), ε', G.decodeChar('→', one, 'H9266') === 'π' && G.decodeChar('=', one, 'HS11005') === '≠' &&
      G.decodeChar('\u0005', one, 'H9255') === 'ε');
    check('MathPi-Three: ∑ glyph is an absolute-value bar, | is a radical', G.decodeString('∑x∑ |x', G.familyInfo('MathematicalPi-Three')) === '|x| √x');
    check('ligatures + PUA brace + control chars', G.decodeString('ﬁnd \uF8F1\u0001', { isMath: false }) === 'find ⎧ ');
    check('Symbol font keeps real arrows', G.decodeString('x→c', G.familyInfo('Symbol')) === 'x→c');
    const ls = lines(S, [it('If', 72, 100), it('f', 84, 100, 'i'), it('≤', 87, 100, 'p1', 10, 3), it('(x)', 90, 100, 'r'),
      it('is defined everywhere.', 110, 100)]);
    check('prime decoded inside prose: If $f\'(x)$ ...', /^If \$f'\(x\)\$ is defined everywhere\.$/.test(ls[0].formattedText), ls[0].formattedText);
  }

  function checkScripts(S, check) {
    const ls = lines(S, [it('y', 72, 100, 'i'), it('=', 80, 100, 'p1'), it('x', 92, 100, 'i'), it('2', 97, 96.8, 'r', 6.5),
      it('+', 103, 100, 'p1'), it('a', 114, 100, 'i'), it('n', 119, 102.5, 'i', 6.5)]);
    check('superscript + subscript -> one display formula', ls.length === 1 && ls[0].formattedText === '$$y = x^{2} + a_{n}$$', fmt(ls).join(' | '));
    check('plain text keeps a readable form', ls[0].text === 'y = x^2 + a_n', ls[0].text);
  }

  function checkFraction(S, check) {
    // dy/dx = (x + 1)/(x - 1): numerators above a rule, denominators below, "=" on the axis
    const items = [it('dy', 72, 104, 'i'), it('dx', 72, 117, 'i'), it('=', 86, 110.7, 'p1'),
      it('x', 98, 104, 'i'), it('+', 104, 104, 'p1'), it('1', 114, 104), it('x', 98, 117, 'i'), it('−', 104, 117, 'p1'), it('1', 114, 117)];
    const rules = [{ x0: 71, x1: 83, y: 107.5 }, { x0: 97, x1: 120, y: 107.5 }];
    const ls = lines(S, items, rules);
    check('stacked fractions collapse into one line', ls.length === 1, fmt(ls).join(' | '));
    check('fractions serialize as \\frac', ls[0] && ls[0].formattedText === '$$\\frac{dy}{dx} = \\frac{x + 1}{x - 1}$$', ls[0] && ls[0].formattedText);
    const none = lines(S, items, []);
    check('without a rule nothing is invented (rows stay apart)', none.length >= 2);
  }

  function checkOperators(S, check) {
    const lim = lines(S, [it('lim', 72, 100, 'r', 10, 13), it('x', 71, 106.5, 'i', 6.5, 3), it('→', 74.5, 106.5, 's', 6.5, 6),
      it('c', 81, 106.5, 'i', 6.5, 3), it('f', 88, 100, 'i'), it('(x)', 92, 100), it('=', 108, 100, 'p1'), it('L', 120, 100, 'i')]);
    check('lim under-script -> \\lim_{x \\to c}', lim.length === 1 && lim[0].formattedText === '$$\\lim_{x \\to c}f(x) = L$$', fmt(lim).join(' | '));
    const sum = lines(S, [it('∑', 72, 104, 's', 17.5, 10), it('n', 75, 90, 'i', 6.5, 3), it('i', 71, 109, 'i', 6.5, 2), it('=', 73.5, 109, 'p1', 6.5, 4),
      it('1', 78, 109, 'r', 6.5, 3), it('a', 86, 100, 'i'), it('i', 91, 102.5, 'i', 6.5, 2)]);
    check('display ∑ with bounds -> \\sum_{i = 1}^{n}', sum.length === 1 && sum[0].formattedText === '$$\\sum_{i = 1}^{n}a_{i}$$', fmt(sum).join(' | '));
    const int = lines(S, [it('That is,', 72, 100), it('∫', 120, 100, 'p3', 10, 4), it('b', 125, 94, 'i', 6.5, 3), it('a', 125, 103, 'i', 6.5, 3),
      it('f', 131, 100, 'i'), it('(x)', 135, 100), it('dx', 150, 100, 'i'), it('exists.', 165, 100)]);
    check('inline ∫ keeps both bounds on its line', int.length === 1 && /\$\\int_\{a\}\^\{b\}f\(x\)dx\$ exists\.$/.test(int[0].formattedText), fmt(int).join(' | '));
    const rad = lines(S, [it('y', 72, 100, 'i'), it('=', 80, 100, 'p1'), it('|', 92, 100, 'p3', 10, 8), it('x', 101, 100, 'i'), it('+', 107, 100, 'p1'),
      it('4', 117, 100)], [{ x0: 100, x1: 123, y: 91.5 }]);
    check('radical + vinculum -> \\sqrt{x + 4}', rad.length === 1 && rad[0].formattedText === '$$y = \\sqrt{x + 4}$$', fmt(rad).join(' | '));
  }

  function checkCodeAndProse(S, check) {
    const code = lines(S, [it('for (int i = 0; i < n; i++) {', 72, 100, 'c')]);
    check('monospace row -> inline code, never TeX', code[0].formattedText === '`for (int i = 0; i < n; i++) {`' && code[0].isCode, code[0].formattedText);
    const javaCall = lines(S, [it('j = T.size() - 1', 72, 100)]);
    check('method-call statement classified as code', javaCall[0].formattedText === '`j = T.size() - 1`' && javaCall[0].isCode, javaCall[0].formattedText);
    const prose = lines(S, [it('The derivative of a function measures its rate of change at a point.', 72, 100)]);
    check('plain prose untouched', prose[0].formattedText === 'The derivative of a function measures its rate of change at a point.', prose[0].formattedText);
    const big = lines(S, [it('O(n log n)', 72, 100, 'r'), it('time.', 130, 100)]);
    check('no $ for upright words-only rows', !/\$/.test(big[0].formattedText) || /\\log/.test(big[0].formattedText), big[0].formattedText);
  }

  function checkComplex2D(S, check) {
    const exp = lines(S, [it('y', 60, 100, 'i'), it('=', 66, 100, 'p1'), it('x', 76, 100, 'i'), it('10', 81, 96.8, 'r', 6.5, 6.5),
      it('+', 90, 100, 'p1'), it('3', 100, 100), it('x', 105, 100, 'i'), it('2/3', 110, 96.8, 'r', 6.5, 8.5)]);
    check('multi-char exponents stay raised: x^{10} + 3x^{2/3}', exp[0].formattedText === '$$y = x^{10} + 3x^{2/3}$$', exp[0].formattedText);
    const inlinePow = lines(S, [it('operations in 10', 72, 100, 'r', 10, 68), it('−11', 140.5, 96.5, 'r', 6.5, 10), it('second.', 153, 100)]);
    check('detached base in prose -> $10^{-11}$', /in \$10\^\{-11\}\$ second\.$/.test(inlinePow[0].formattedText), inlinePow[0].formattedText);
    const inv = lines(S, [
      it('1', 325, 206), it('|', 310, 219.5, 'p3', 8.6, 9.8), it('1', 320, 220), it('−', 328, 220, 'p1'),
      it('x', 339, 220, 'i'), it('2', 344, 216.8, 'r', 6.5, 3.5), it('=', 353, 213, 'p1'),
      it('arcsec', 364, 213, 'r', 10, 25), it('∑', 392, 208.5, 'p3', 16, 3.3), it('u', 395.5, 206, 'i'),
      it('∑', 400.5, 208.5, 'p3', 16, 3.3), it('a', 395.5, 219.5, 'i'),
    ], [{ x0: 310, x1: 349, y: 212.4 }, { x0: 320, x1: 349, y: 214.6 }, { x0: 392, x1: 404, y: 209.6 }]);
    check('fraction over radical + arcsec |u|/a', inv.length === 1 &&
      inv[0].formattedText === '$$\\frac{1}{\\sqrt{1 - x^{2}}} = \\arcsec\\frac{|u|}{a}$$', fmt(inv).join(' | '));
    const pw = lines(S, [
      it('f', 72, 115, 'i'), it('(x)', 76, 115), it('=', 90, 115, 'p1'),
      it('\uF8F1', 102, 106, 'r', 12, 5), it('\uF8F2', 102, 118, 'r', 12, 5), it('\uF8F3', 102, 130, 'r', 12, 5),
      it('4,', 112, 106), it('x', 136, 106, 'i'), it('<', 144, 106, 'p1'), it('4', 154, 106),
      it('x,', 112, 124, 'i'), it('x', 136, 124, 'i'), it('≥', 144, 124, 's'), it('4', 154, 124),
    ]);
    check('CMEX stacked brace -> \\begin{cases}', pw.length === 1 &&
      pw[0].formattedText === '$$f(x) = \\begin{cases} 4, & x < 4 \\\\ x, & x \\ge 4 \\end{cases}$$', fmt(pw).join(' | '));
    // Stacked \int rows emitted out of vertical order must never steal the upper row's lower bound
    const stackedInt = lines(S, [
      it('∫', 218, 199.4, 'p3', 28, 7.8), it('b', 226, 185.9, 'i', 6.5, 3.5), it('a', 223, 206.6, 'i', 6.5, 3.5),
      it('g(x)dx = 2', 233, 197.6, 'i', 10, 48),
      it('∫', 218, 164.9, 'p3', 28, 7.8), it('b', 226, 151.4, 'i', 6.5, 3.5), it('a', 223, 172.1, 'i', 6.5, 3.5),
      it('f(x)dx = 1', 233, 163.1, 'i', 10, 48),
    ]);
    check('stacked \\int rows keep separate _{a}^{b} bounds', stackedInt.length === 2 &&
      stackedInt[0].formattedText.startsWith('$$\\int_{a}^{b}') && stackedInt[1].formattedText.startsWith('$$\\int_{a}^{b}'), fmt(stackedInt).join(' | '));
    const proseLim = lines(S, [
      it('converges, then lim', 278.6, 338.1, 'r', 10, 80.7), it('n', 343.6, 344.1, 'i', 6.5, 3.5),
      it('→', 347.4, 344.1, 's', 6.5, 6.9), it('≠', 354.7, 345.1, 'p1', 7.8, 7),
      it('a', 364.2, 338.1, 'i'), it('n', 369.2, 340.6, 'i', 6.5, 3.5), it('=', 375.7, 338.1, 'p1'), it('0.', 387, 338.1),
    ]);
    check('prose-attached lim + 7.8pt \\infty -> \\lim_{n \\to \\infty}a_{n} = 0.', proseLim.length === 1 &&
      /then \$\\lim_\{n \\to \\infty\}a_\{n\} = 0\.\$$/.test(proseLim[0].formattedText), fmt(proseLim).join(' | '));
    const slidePoly = lines(S, [
      it('Let', 105, 194.7, 'r', 15, 23), it('f (x)', 133.6, 194.7, 'r', 15, 33), it('=', 172, 194.7, 'r', 15, 12),
      it('a', 189.5, 194.7, 'r', 15, 9), it('n', 198.5, 200.3, 'r', 10, 6.3), it('x', 204.8, 194.7, 'r', 15, 9),
      it('n', 213.7, 189.1, 'r', 10, 6.3), it(', is', 225, 194.7, 'r', 15, 25),
      it('O(x', 255, 194.7, 'r', 15, 27.5), it('n', 282.5, 189.1, 'r', 10, 6.3), it(')', 288.8, 194.7, 'r', 15, 6.8), it('.', 295.6, 194.7, 'r', 15, 5.4),
    ]);
    check('15pt slide polynomial & O(x^{n}). never pull ) or . into sup', /\$f \(x\) = a_\{n\}x\^\{n\}\$/.test(slidePoly[0].formattedText) &&
      /\$O\(x\^\{n\}\)\.\$$/.test(slidePoly[0].formattedText), slidePoly[0].formattedText);
  }

  function runMathChecks() {
    const S = load();
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name: `[math] ${name}`, ok: Boolean(ok), detail });
    [checkGlyphs, checkScripts, checkFraction, checkOperators, checkCodeAndProse, checkComplex2D].forEach((fn) => {
      try {
        fn(S, check);
      } catch (err) {
        check(`${fn.name} threw`, false, err && err.stack ? err.stack : String(err));
      }
    });
    return { results, passed: results.every((r) => r.ok) };
  }

  function formatResults(report) {
    return report.results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL']).join('\n');
  }

  const api = { runMathChecks, formatResults };
  root.MathFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runMathChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

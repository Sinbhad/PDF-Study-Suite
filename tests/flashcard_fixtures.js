/**
 * Flashcard Quality Fixtures (runs under Node via `node tests/flashcard_fixtures.js` or in the browser via
 * tests/quality.html). Inline bold terms become cards, keyword filler never does, boxed theorems keep their
 * whole body plus a page clip region, and outline titles lose their NUL padding.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const PAGE_W = 612;
  const PAGE_H = 783;
  const VIEW = [54, 54, 666, 837]; // Larson-style crop box: viewport y = 837 - pdfY, x = pdfX - 54
  const FONTS = new Map([
    ['f1', 'LNKEAO+Times-Roman'], ['f2', 'LNKELH+Times-Bold'], ['f3', 'LNHOKF+Univers-Bold'], ['f4', 'LNKEAN+MathematicalPi-Bold'],
  ]);

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'bold-terms', 'flashcard-engine', 'quiz-gate', 'quiz-options', 'quiz-engine']
        .forEach((m) => require(`../src/nlp/${m}.js`));
      ['column-layout', 'span-format', 'pdf-loader', 'didactic-blocks', 'text-cleaner', 'book-hierarchy']
        .forEach((m) => require(`../src/pdf/${m}.js`));
    }
    return root.PDFStudy;
  }

  /** One PDF.js text item at viewport (x, top-baseline y) in font id `f`, 10pt. */
  function item(str, x, y, f = 'f1', size = 10) {
    return { str, fontName: f, transform: [size, 0, 0, size, x + VIEW[0], VIEW[3] - y], width: str.length * size * 0.45 };
  }

  /** A line of runs: [[text, fontId], ...] laid out left to right from x. */
  function row(runs, x, y) {
    let cx = x;
    return runs.map(([t, f]) => {
      const it = item(t, cx, y, f);
      cx += it.width + 2.5;
      return it;
    });
  }

  function page(S, items, pageNumber = 1) {
    const lines = S.pdfLoader.reconstructLines(items, {}, PAGE_W, PAGE_H, { fontNames: FONTS, viewBox: VIEW });
    return { pageNumber, width: PAGE_W, height: PAGE_H, lines };
  }

  function checkInlineBold(S, check) {
    const items = [
      ...row([['To understand continuity on a closed interval, you first need to look', 'f1']], 72, 100),
      ...row([['at a different type of limit called a', 'f1'], ['one-sided limit.', 'f2'], ['For instance, the', 'f1']], 72, 112),
      ...row([['limit from the right', 'f2'], ['(or right-hand limit) means that x approaches c from', 'f1']], 72, 124),
      ...row([['values greater than c. One-sided limits can be used to investigate', 'f1']], 72, 136),
      ...row([['the behavior of', 'f1'], ['step functions.', 'f2']], 72, 148),
      ...row([['Solution', 'f3'], ['As shown in Figure 1.29, the limit as x approaches 2 is 0 for the values', 'f1']], 72, 172),
      ...row([['A function is continuous on the interval {', 'f1'], ['a, b', 'f2'], ['} when f is defined there.', 'f1']], 72, 184),
      ...row([['The vector', 'f1'], ['xy', 'f4'], ['is drawn in the plane as an arrow from the origin.', 'f1']], 72, 196),
    ];
    const pg = page(S, items);
    const ft = pg.lines.map((l) => l.formattedText);
    check('loader marks mid-line bold runs', ft.some((t) => /called a \*\*one-sided limit\*\*\. For instance/.test(t)), ft.join(' | '));
    check('loader: line-start bold term kept, label marked', ft.some((t) => /^\*\*limit from the right\*\* \(or/.test(t)) &&
      ft.some((t) => /^\*\*Solution\*\* As shown/.test(t)), ft.join(' | '));
    check('loader: bold math variables and math fonts stay plain', !ft.some((t) => /\*\*a, b\*\*|\*\*xy\*\*/.test(t)), ft.join(' | '));
    check('loader: coordinates are viewport (crop-box) based', Math.abs(pg.lines[0].bottomY - 100) < 0.5, `${pg.lines[0].bottomY}`);

    const so = S.textCleaner.processSectionPages([pg]);
    const cards = S.flashcardEngine.extractBookFlashcards(so.text, 'Fixture', so.didacticBlocks);
    const by = (f) => cards.find((c) => c.front.toLowerCase() === f);
    const one = by('one-sided limit');
    check('inline bold term -> card (One-sided limit)', one && /called a one-sided limit\./.test(one.back) && !/\*\*/.test(one.back),
      cards.map((c) => `${c.front} => ${c.back}`).join(' | '));
    const right = by('limit from the right');
    check('bold term defined with "means" -> card', right && /means that x approaches c from values greater than c\.$/.test(right.back),
      right ? right.back : '');
    check('bold mention without a definition -> no card', !by('step functions') && !by('step function'));
    check('labels / math never become cards', !cards.some((c) => /^(?:Solution|A, b|Xy)$/i.test(c.front)), cards.map((c) => c.front).join(', '));
  }

  function checkNoFiller(S, check) {
    const text = [
      'Understand that the tangent line problem is basic to calculus.',
      'If you reduce calculus to the memorization of differentiation and integration formulas, you will miss a great deal of',
      'understanding, self-confidence, and satisfaction. Similar properties hold for one-sided limits and for functions',
      'for which the limit of f(x) as x approaches c is negative infinity. Here is a proof of the sum property.',
    ].join('\n');
    const cards = S.flashcardEngine.extractBookFlashcards(text, 'Fixture', []);
    check('no keyword-fallback ("Key Concept") cards', cards.length === 0 && !cards.some((c) => c.category === 'Key Concept'),
      cards.map((c) => `${c.front} => ${c.back}`).join(' | '));
  }

  function checkTheoremBlock(S, check) {
    const body = [
      'Let b and c be real numbers, let n be a positive integer, and let f and g be',
      'functions with the limits lim f(x) = L and lim g(x) = K.',
      '1. Scalar multiple: lim [b f(x)] = bL',
      '2. Sum or difference: lim [f(x) + g(x)] = L + K',
      '3. Product: lim [f(x)g(x)] = LK',
      '4. Quotient: lim f(x)/g(x) = L/K, provided K is not 0',
      '5. Power: lim [f(x)]^n = L^n',
      '6. Root: lim of the nth root of f(x) is the nth root of L',
      'A proof of this theorem is given in Appendix A.',
    ];
    const items = [
      ...row([['In Section 1.2, you learned that the limit of f(x) as x approaches c does not depend on', 'f1']], 72, 80),
      ...row([['the value of f at x = c. Such well-behaved functions are continuous at c, as shown.', 'f1']], 72, 92),
      ...row([['THEOREM 1.2', 'f3'], ['Properties of Limits', 'f3']], 85, 120),
      ...body.flatMap((t, i) => row([[t, 'f1']], 85, 136 + i * 14)),
      ...row([['The next example shows how these properties are used to evaluate a limit of a polynomial.', 'f1']], 72, 280),
      ...row([['Properties of Limits', 'f3']], 72, 310),
      ...row([['Ordinary prose under an ordinary section heading is not a guideline box at all, so it', 'f1']], 72, 326),
      ...row([['must never become a Guideline card on its own just because of the heading wording.', 'f1']], 72, 338),
    ];
    const pg = page(S, items, 7);
    const so = S.textCleaner.processSectionPages([pg]);
    const thm = so.didacticBlocks.find((b) => b.category === 'Theorem');
    check('theorem body captured past 6 lines', thm && /6\. Root/.test(thm.body) && /Appendix A\.$/.test(thm.body),
      thm ? thm.body : JSON.stringify(so.didacticBlocks));
    check('theorem body stops at the box (no following prose)', thm && !/next example/.test(thm.body));
    const clip = thm && thm.clip;
    check('block clip present in viewport units', clip && clip.page === 7 && Math.abs(clip.top - 110) < 1 && Math.abs(clip.bottom - 248) < 1,
      JSON.stringify(clip));
    check('prose under "Properties of" heading is not a Guideline', !so.didacticBlocks.some((b) => b.category === 'Guideline'),
      JSON.stringify(so.didacticBlocks.map((b) => b.title)));
    const cards = S.flashcardEngine.extractBookFlashcards(so.text, 'Fixture', so.didacticBlocks);
    const card = cards.find((c) => c.category === 'Theorem');
    check('theorem card: prompt-style front, kind theorem, no page clip, one item per line', card && card.front === 'Theorem 1.2 — Properties of Limits' &&
      card.kind === 'theorem' && !('clip' in card) && /\n2\. Sum or difference/.test(card.back), card ? `${card.front} ${JSON.stringify(card.back)}` : '');
    check('formula labels inside the theorem are not key terms', !cards.some((c) => /^(?:Power|Quotient|Root|Product)$/.test(c.front)),
      cards.map((c) => c.front).join(', '));
  }

  function checkOutlineTitles(S, check) {
    const outline = [{ title: '1 Limits and Their Properties\u0000', startPage: 1, children: [
      { title: '1.1 A Preview of Calculus\u0000\u0000\u0000\u0000', startPage: 1, children: [] },
    ] }];
    const h = S.bookHierarchy.extractBookHierarchy({ outline, numPages: 4, pages: [] });
    const titles = h.chapters.flatMap((c) => [c.title, ...c.sections.map((s) => s.title)]);
    check('NUL characters stripped from outline titles', titles[1] === '1.1 A Preview of Calculus' &&
      titles.every((t) => !/[\u0000-\u001f]/.test(t)), JSON.stringify(titles));
  }

  function checkBiology(S, check) {
    const text = [
      '**1.1 Laws of Thermodynamics in Living Systems**',
      '**Bioenergetics** is defined as the quantitative study of energy transductions that occur in living cells and the chemical processes underlying them.',
      '**Entropy** refers to a quantitative measure of disorder or randomness within a thermodynamic system.',
      '**Gibbs Free Energy** (G): The portion of a system total energy that can perform work when temperature and pressure are uniform throughout the system.',
    ].join('\n');
    const fronts = S.flashcardEngine.extractBookFlashcards(text, 'Bio').map((c) => c.front);
    check('biology sample keeps its cards', ['Bioenergetics', 'Entropy', 'Gibbs Free Energy (G)'].every((f) => fronts.includes(f)), fronts.join(', '));
  }

  function runFlashcardChecks() {
    const S = loadModules();
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name: `[cards] ${name}`, ok: Boolean(ok), detail });
    [checkInlineBold, checkNoFiller, checkTheoremBlock, checkOutlineTitles, checkBiology].forEach((fn) => {
      try {
        fn(S, check);
      } catch (err) {
        check(`${fn.name} threw`, false, err && err.stack ? err.stack : String(err));
      }
    });
    return { results, passed: results.every((r) => r.ok) };
  }

  function formatResults(report) {
    return report.results
      .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL'])
      .join('\n');
  }

  const api = { runFlashcardChecks, formatResults };
  root.FlashcardFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runFlashcardChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

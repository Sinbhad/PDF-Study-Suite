/**
 * PDF Structure, Page-Kind, Didactic Block, Hierarchy & Slide Extraction Fixtures
 * Runs under Node via `node tests/structure_fixtures.js` or in the browser via `root.StructureFixtures`.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const PAGE_W = 612;
  const PAGE_H = 783;

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'bold-terms', 'flashcard-engine'].forEach((m) => require(`../src/nlp/${m}.js`));
      [
        'column-layout',
        'span-format',
        'pdf-loader',
        'page-kind',
        'block-headings',
        'didactic-blocks',
        'text-cleaner',
        'scope-builder',
        'book-hierarchy',
        'classifier',
        'slide-extractor',
      ].forEach((m) => require(`../src/pdf/${m}.js`));
    }
    return root.PDFStudy;
  }

  function ln(text, opts = {}) {
    const clean = text.replace(/\*\*/g, '').replace(/^[\s]*([✦✧•▪◦➢\-*+]|\d+[.)])\s+/, '').trim();
    const isBold = opts.isBold !== undefined ? opts.isBold : /^\*\*[\s\S]+\*\*$/.test(text);
    const hasBullet = Boolean(opts.hasBullet || /^[\s]*([✦✧•▪◦➢\-*+]|\d+[.)])\s+/.test(text));
    return {
      text: text.replace(/\*\*/g, ''),
      cleanText: clean,
      formattedText: opts.formattedText || text,
      fontSize: opts.fontSize || 10,
      isBold,
      isMargin: Boolean(opts.isMargin),
      hasBullet,
      hasMath: Boolean(opts.hasMath || (opts.formattedText || text).includes('$')),
      isCode: Boolean(opts.isCode),
      x0: opts.x0 !== undefined ? opts.x0 : 205,
      textX0: opts.x0 !== undefined ? opts.x0 : 205,
      x1: opts.x1 !== undefined ? opts.x1 : 510,
      topY: opts.y !== undefined ? opts.y : 120,
      bottomY: (opts.y !== undefined ? opts.y : 120) + (opts.fontSize || 10),
      wordCount: clean ? clean.split(/\s+/).length : 0,
      pageWidth: opts.pageWidth || PAGE_W,
      pageHeight: opts.pageHeight || PAGE_H,
    };
  }

  function pg(pageNumber, lines, w = PAGE_W, h = PAGE_H) {
    const wordCount = lines.reduce((s, l) => s + l.wordCount, 0);
    return { pageNumber, width: w, height: h, aspectRatio: w / h, lines, wordCount };
  }

  function checkPageKindsAndExercises(S, check) {
    const contentPg = pg(82, [
      ln('1.3 Evaluating Limits Analytically 59', { fontSize: 9.5, y: 35, x0: 389 }),
      ln('**1.3 Evaluating Limits Analytically**', { fontSize: 21, y: 61, x0: 88, isBold: true }),
      ln('**Evaluate a limit using properties of limits.**', { fontSize: 9, y: 101, x0: 240, isBold: true }),
      ln('**Find the derivative of a function using the Product Rule.**', { fontSize: 9, y: 113, x0: 240, isBold: true }),
      ln('**Properties of Limits**', { fontSize: 13, y: 160, x0: 192, isBold: true }),
      ln('In Section 1.2, you learned that the limit of $f(x)$ as $x$ approaches $c$ is straight-', { y: 185, x0: 192 }),
      ln('forward when evaluated by direct substitution on an open interval.', { y: 198, x0: 192 }),
      ln('In Exercises 5–10, use a graphing utility to graph the function.', { y: 220, x0: 192 }),
      ln('$\\lim_{x \\to c^{-}} f(x) = L$', { fontSize: 7.5, y: 240, x0: 210, hasMath: true }),
    ]);
    const exPg = pg(90, [
      ln('1.3 Exercises See CalcChat.com for tutorial help and worked-out solutions.', { fontSize: 21, y: 61, isBold: true }),
      ln('**Estimating Limits In Exercises 1–4, use a graphing utility**', { fontSize: 9.5, y: 105, isBold: true }),
      ln('1. h(x) = -x^2 + 4x', { fontSize: 9.5, y: 140 }),
    ]);
    const revPg = pg(114, [ln('Review Exercises See CalcChat.com', { fontSize: 19, y: 63, isBold: true }), ln('1. Solve x + 1 = 0.', { y: 110 })]);
    const psPg = pg(116, [ln('**P.S. Problem Solving**', { fontSize: 19, y: 63, isBold: true }), ln('1. Let P(x, y) be a point on the parabola.', { y: 106 })]);
    const ansPg = pg(781, [ln('A12 Answers to Odd-Numbered Exercises', { fontSize: 11, y: 33 }), ln('**Section 1.1** (page 47)', { fontSize: 11, y: 90, isBold: true })]);
    const idxPg = pg(854, [ln('INDEX I1', { fontSize: 14, y: 40, isBold: true }), ln('Arcsine function, 366', { y: 95 }), ln('Arctangent function, 366', { y: 108 })]);
    const appPg = pg(772, [ln('**B Integration Tables**', { fontSize: 21, y: 61, isBold: true }), ln('Forms Involving u^n', { y: 101, isBold: true })]);
    const tocPg = pg(10, [ln('**CONTENTS**', { fontSize: 18, y: 50, isBold: true }), ln('1.1 A Preview of Calculus . . . . 2', { y: 120 }), ln('1.2 Finding Limits . . . . 10', { y: 135 })]);
    const refPg = pg(4, [ln('**TRIGONOMETRY**', { fontSize: 15, y: 39, isBold: true }), ln('Tear out Formula Cards for Homework Success.', { y: 400 })]);
    const mixedNextSecPg = pg(93, [
      ln('75. Leftover exercise continuation before section opener', { fontSize: 9.5, y: 70, x0: 72 }),
      ln('**1.4 Continuity and One-Sided Limits**', { fontSize: 21, y: 120, x0: 52, isBold: true }),
      ln('**Determine continuity at a point and continuity on an open interval.**', { fontSize: 9, y: 155, x0: 204, isBold: true }),
      ln('A function is continuous at $c$ when its graph has no interruption at $c$.', { y: 190, x0: 192 }),
    ]);

    check('page.kind classifies content/exercises/answers/index/appendix/toc/front',
      S.pageKind.classifyPage(contentPg) === 'content' &&
      S.pageKind.classifyPage(exPg) === 'exercises' &&
      S.pageKind.classifyPage(revPg) === 'exercises' &&
      S.pageKind.classifyPage(psPg) === 'exercises' &&
      S.pageKind.classifyPage(ansPg) === 'answers' &&
      S.pageKind.classifyPage(idxPg) === 'index' &&
      S.pageKind.classifyPage(appPg) === 'appendix' &&
      S.pageKind.classifyPage(tocPg) === 'toc' &&
      S.pageKind.classifyPage(refPg) === 'front');

    const cleaned = S.textCleaner.processSectionPages([contentPg, exPg, mixedNextSecPg, ansPg, idxPg, appPg]);
    check('non-content pages and exercise items never reach scope text',
      !/CalcChat|Odd-Numbered|Arcsine function|Integration Tables|Leftover exercise/.test(cleaned.text), cleaned.text);
    check('exercise mode resets at next N.N section opener',
      /1\.4 Continuity and One-Sided Limits/.test(cleaned.text) && /no interruption/.test(cleaned.text), cleaned.text);
    check('9pt section-opener objective bullets stripped from scope text',
      !/Evaluate a limit using properties|Find the derivative of a function|Determine continuity at a point/.test(cleaned.text), cleaned.text);
    check('in-text "In Exercises 5-10" instruction lines stripped',
      !/In Exercises 5/.test(cleaned.text), cleaned.text);
    check('small-font math lines with `$` survive text-cleaner & prose wraps de-hyphenate',
      cleaned.text.includes('$\\lim_{x \\to c^{-}} f(x) = L$') && cleaned.text.includes('straightforward'), cleaned.text);
  }

  function checkHierarchyBackPointing(S, check) {
    const outline = [
      { title: 'Front Cover', startPage: 1, children: [] },
      { title: 'CONTENTS', startPage: 10, children: [] },
      { title: 'CHAPTER 1 Limits and Their Properties', startPage: 64, children: [{ title: '1.1 A Preview of Calculus', startPage: 65, children: [] }, { title: 'Review Exercises', startPage: 114, children: [] }] },
      { title: 'APPENDICES', startPage: 770, children: [{ title: 'B: Integration Tables', startPage: 772, children: [] }] },
      { title: 'ANSWERS to Odd-Numbered Exercises', startPage: 776, children: [{ title: 'ch01', startPage: 781, children: [] }] },
      { title: 'INDEX', startPage: 854, children: [] },
      { title: 'Useful Reference Sheets', startPage: 2, children: [{ title: 'Derivatives and Integrals', startPage: 3, children: [] }, { title: 'Trigonometry', startPage: 4, children: [] }, { title: 'Algebra', startPage: 867, children: [] }] },
    ];
    const h = S.bookHierarchy.extractBookHierarchy({ outline, numPages: 870, pages: [] });
    const byTitle = (re) => h.chapters.find((c) => re.test(c.title));
    const ref = byTitle(/Reference Sheets/);
    const trig = ref && ref.sections.find((s) => /Trigonometry/.test(s.title));
    check('Answers / Index / Appendices / Reference Sheets marked isExtra',
      byTitle(/APPENDICES/).isExtra && byTitle(/ANSWERS/).isExtra && byTitle(/INDEX/).isExtra && ref.isExtra && !byTitle(/CHAPTER 1/).isExtra);
    const secs = byTitle(/CHAPTER 1/).sections;
    check('exercise-only sections flagged isExercises; concept sections are not', secs[1].isExercises === true && secs[0].isExercises === false && byTitle(/Front Cover/).isExtra);
    check('back-pointing Reference Sheets -> Trigonometry does NOT span p.4..866',
      ref.endPage <= 23 && trig && trig.startPage === 4 && trig.endPage <= 10, JSON.stringify({ refEnd: ref.endPage, trig }));
  }

  function checkDidacticBlocksAndCode(S, check) {
    const page1 = pg(398, [
      ln('The proofs of these integration rules are left to you in the exercises.', { y: 90, x0: 192 }),
      ln('**THEOREM 5.17 Integrals Involving Inverse Trigonometric**', { y: 120, x0: 205, isBold: true }),
      ln('**Functions**', { y: 132, x0: 290, isBold: true }),
      ln('Let $u$ be a differentiable function of $x,$ and let $a > 0.$', { y: 150, x0: 205, hasMath: true }),
      ln('$$\\int \\frac{du}{\\sqrt{a^{2}-u^{2}}} = \\arcsin\\frac{u}{a} + C$$', { y: 170, x0: 220, hasMath: true }),
      ln('For a detailed proof of Theorem 5.17, see the article by Arnold J. Insel.', { y: 200, x0: 72, isMargin: true }),
      ln('Theorem 5.17 — , see the article in The College Mathematics Journal.', { y: 214, x0: 72, isMargin: true }),
      ln('**SUMMARY OF COMPOUND INTEREST FORMULAS**', { y: 250, x0: 205, isBold: true }),
      ln('Let $P$ be the deposit and $r$ be the annual rate.', { y: 268, x0: 205, hasMath: true }),
      ln('$$A = Pe^{rt}$$', { y: 286, x0: 220, hasMath: true }),
      ln('**BASIC DIFFERENTIATION RULES FOR ELEMENTARY FUNCTIONS**', { y: 330, x0: 205, isBold: true }),
      ln('1. $\\frac{d}{dx}[cu] = cu\'$', { y: 348, x0: 210, hasMath: true }),
      ln('2. $\\frac{d}{dx}[uv] = uv\' + vu\'$', { y: 364, x0: 210, hasMath: true }),
      ln('`def binarySearch(A, x):`', { y: 420, x0: 192, isCode: true, fontSize: 11 }),
      ln('`low = 0`', { y: 434, x0: 210, isCode: true, fontSize: 11 }),
      ln('`return low`', { y: 448, x0: 210, isCode: true, fontSize: 11 }),
    ]);
    const res = S.textCleaner.processSectionPages([page1]);
    const thm = res.didacticBlocks.find((b) => b.category === 'Theorem');
    const sum = res.didacticBlocks.find((b) => b.category === 'Summary');
    const rule = res.didacticBlocks.find((b) => b.category === 'Rule');
    check('2-line Theorem 5.17 heading merged; margin prose rejected',
      thm && thm.title === 'Theorem 5.17 — Integrals Involving Inverse Trigonometric Functions' &&
      res.didacticBlocks.filter((b) => /5\.17/.test(b.title)).length === 1, JSON.stringify(res.didacticBlocks.map((b) => b.title)));
    check('block carries bbox == clip, display formulas[], and preserves TeX `$` `\\` `{}` `^` `_`',
      thm && JSON.stringify(thm.bbox) === JSON.stringify(thm.clip) &&
      thm.formulas.length === 1 && thm.formulas[0].includes('\\arcsin\\frac{u}{a}') &&
      thm.body.includes('$u$') && sum && sum.formulas[0] === 'A = Pe^{rt}' && Boolean(rule),
      JSON.stringify(thm));
    check('consecutive isCode lines wrapped in indented ``` fence',
      /```\ndef binarySearch\(A, x\):\n {2}low = 0\n {2}return low\n```/.test(res.text), res.text);
  }

  function checkClassifierAndSlides(S, check) {
    const hwPages = [1, 2, 3].map((n) => pg(n, [
      ln('**Homework #3 Name:**', { fontSize: 17, y: 46, x0: 78, isBold: true }),
      ln('**Due: October 21 at 11:59 PM** Date:', { fontSize: 12, y: 80, x0: 78, isBold: true }),
      ln(`**Problem ${n}. (10 Points)** Prove by induction that $a_{n}$ is odd.`, { fontSize: 12, y: 140, x0: 72, isBold: true }),
      ln('• $2 \\in X$', { fontSize: 12, y: 170, x0: 91, hasBullet: true }),
      ln('• If $x \\in X$, so is $x + 6$.', { fontSize: 12, y: 194, x0: 91, hasBullet: true }),
    ], 612, 792));
    const cl = S.classifier.classifyDocument({ numPages: 3, pages: hwPages });
    check('portrait homework PDF classifies as book', cl.type === 'book', JSON.stringify(cl));

    const traceFrame = (num, val) => pg(num, [
      ln('**Algorithm Trace**', { fontSize: 25, y: 40, x0: 30, isBold: true, pageWidth: 720, pageHeight: 405 }),
      ln('✦ To gain insight into how an algorithm works we trace its steps', { fontSize: 15, y: 100, x0: 34, hasBullet: true, pageWidth: 720, pageHeight: 405 }),
      ln('✧ Step input: 15 21 2 7 6 55 3', { fontSize: 15, y: 120, x0: 54, hasBullet: true, pageWidth: 720, pageHeight: 405 }),
      ln(`➢ temp = ${val}`, { fontSize: 15, y: 140, x0: 54, hasBullet: true, pageWidth: 720, pageHeight: 405 }),
    ], 720, 405);
    const deck = S.slideExtractor.extractSlideDeck({ pages: [traceFrame(9, 15), traceFrame(10, 21), traceFrame(11, 55)] });
    check('slide extractor splits ✦ ✧ ➢ bullets and collapses consecutive Algorithm Trace frames',
      deck.slides.length === 1 && deck.slides[0].bullets.length === 3 && deck.slides[0].bullets[2] === 'temp = 55',
      JSON.stringify(deck.slides));

    const sp = (n, rows) => pg(n, rows.map(([t, y, x0, o]) => ln(t, { fontSize: 15, y, x0, x1: 400, pageWidth: 720, pageHeight: 405, ...o })), 720, 405);
    const big = { fontSize: 25 };
    const body = [['Def: A relation R is called **reflexive** if xRx for every x', 97, 31], ['R_1 = {(1, 1), (2, 2)}', 130, 31]];
    const cells = [['x', 'y', 'x + y'], ['0', '1', '1'], ['1', '1', '2']].flatMap((r, i) => r.map((c, j) => [c, 100 + i * 30, [58, 131, 200][j], { fontSize: 13 }]));
    const d2 = S.slideExtractor.extractSlideDeck({ pages: [
      sp(1, [['Relations', 150, 31, { fontSize: 30 }]]),
      sp(2, [['Which of the Following is Reflexive?', 40, 31, big], ...body]),
      sp(3, [['Which of the Following is Reflexive? R_1', 40, 31, big], ...body]),
      sp(4, [['Examples', 40, 31, big], ['✦ Examples of relations', 97, 34], ['✧', 118, 71, { x1: 85 }], ['✧', 137, 71, { x1: 85 }], ['x < y', 118, 103], ['a | b', 137, 103],
        ['Symmetric: by definition, if x ≡ y (mod 7) then', 228, 31, { x1: 580 }], ['y ≡ x (mod 7). So R is symmetric', 260, 85]]),
      sp(5, [['Sum table for small inputs', 40, 31, big], ...cells]),
    ] }).slides;
    const [s1, qs, ex, tb] = d2;
    check('reveal pair collapses into one question slide with qa + pages + definitions',
      d2.length === 4 && s1.kind === 'title' && qs.kind === 'question' && JSON.stringify(qs.pages) === '[2,3]' && qs.slideNumber === 2 &&
      qs.title === 'Which of the Following is Reflexive?' && qs.qa.question === qs.title && qs.qa.answer === 'R_1' && qs.bullets.length === 2 &&
      qs.definitions[0].term === 'reflexive' && /^A relation R is called reflexive/.test(qs.definitions[0].definition), JSON.stringify(qs));
    check('stand-alone marker glyphs pair with their rows; nested levels kept; wrapped bullet joined',
      JSON.stringify(ex.nestedBullets.map((b) => [b.level, b.text])) === JSON.stringify([[0, 'Examples of relations'], [1, 'x < y'], [1, 'a | b'],
        [0, 'Symmetric: by definition, if x ≡ y (mod 7) then y ≡ x (mod 7). So R is symmetric']]) && ex.kind === 'content', JSON.stringify(ex.nestedBullets));
    check('grid slide becomes kind=table with rows and no cell bullets', tb.kind === 'table' && tb.bullets.length === 0 &&
      JSON.stringify(tb.table.rows) === JSON.stringify([['x', 'y', 'x + y'], ['0', '1', '1'], ['1', '1', '2']]), JSON.stringify(tb));
    check('slide extractor never throws on odd pages', S.slideExtractor.extractSlideDeck({ pages: [null, {}, { pageNumber: 3, lines: [{}, { text: 'Only text' }] }] }).slides.length >= 1);
  }

  function runStructureChecks() {
    const S = loadModules();
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name: `[structure] ${name}`, ok: Boolean(ok), detail });
    [checkPageKindsAndExercises, checkHierarchyBackPointing, checkDidacticBlocksAndCode, checkClassifierAndSlides].forEach((fn) => {
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
      .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${!r.ok && r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL'])
      .join('\n');
  }

  const api = { runStructureChecks, formatResults };
  root.StructureFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runStructureChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

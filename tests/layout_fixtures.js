/**
 * Page-Layout Quality Fixtures (runs under Node via `node tests/layout_fixtures.js`
 * or in the browser via tests/quality.html). Asserts that two-column pages and margin notes are
 * read column by column, headings never glue onto sentences, and wrapped definitions stay whole.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';
  const PAGE_W = 612;
  const PAGE_H = 792;

  const LEFT_PARA =
    'The Squeeze Theorem states that if a function is trapped between two functions that share the same limit at a point, then the trapped function must also approach that limit. This theorem is especially useful for limits involving the sine function near zero.';
  const RIGHT_PARA =
    'A one-sided limit describes the value that a function approaches as the input moves toward a point from only one direction. When both one-sided limits exist and agree, the two-sided limit also exists.';
  const MARGIN_NOTE =
    'The first use of a symbol to denote the square root can be traced to the sixteenth century.';
  const MAIN_PARA =
    'Polynomial functions and rational functions are two of the three basic types of algebraic functions. Direct substitution is valid for all polynomial functions and for rational functions whose denominators are not zero at the point in question. The next theorem deals with the limit of the third type of algebraic function, one that involves a radical.';

  function wrap(text, width) {
    const out = [];
    let cur = '';
    for (const w of text.split(' ')) {
      if (cur && (cur + ' ' + w).length > width) {
        out.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) out.push(cur);
    return out;
  }

  /** PDF.js-style text item: one run of text at (x, top y) in a 10pt (or given) font. */
  function item(str, x, y, size = 10, fontName = 'Times-Roman') {
    return { str, transform: [size, 0, 0, size, x, PAGE_H - y], width: str.length * size * 0.48, fontName };
  }

  function columnItems(lines, x, y0, size = 10, lead = 12) {
    return lines.map((t, i) => item(t, x, y0 + i * lead, size));
  }

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'keywords', 'summarizer', 'flashcard-engine', 'quiz-gate']
        .forEach((m) => require(`../src/nlp/${m}.js`));
      ['column-layout', 'pdf-loader', 'text-cleaner'].forEach((m) => require(`../src/pdf/${m}.js`));
    }
    return root.PDFStudy;
  }

  function linesOf(S, items, withLayout = true) {
    const saved = S.columnLayout;
    if (!withLayout) S.columnLayout = null;
    try {
      return S.pdfLoader.reconstructLines(items, {}, PAGE_W, PAGE_H);
    } finally {
      S.columnLayout = saved;
    }
  }

  const flat = (lines) => lines.map((l) => l.text).join(' ').replace(/\s+/g, ' ');

  function checkColumns(S, check) {
    // Two equal columns with a full-width section heading on top
    const left = wrap(LEFT_PARA, 44);
    const right = wrap(RIGHT_PARA, 44);
    const items = [
      item('1.3 Evaluating Limits Analytically', 72, 70, 14, 'Times-Bold'),
      ...columnItems(left, 72, 100),
      ...columnItems(right, 330, 100),
    ];
    const lines = linesOf(S, items);
    const mixed = lines.filter((l) => l.x0 < 300 && l.x1 > 320 && !/Evaluating/.test(l.text));
    check('two-column: no line mixes both columns', mixed.length === 0, mixed.map((l) => l.text).join(' | '));
    const text = flat(lines);
    check('two-column: left column read fully before right', text.includes(LEFT_PARA) && text.includes(RIGHT_PARA) &&
      text.indexOf(LEFT_PARA) < text.indexOf(RIGHT_PARA), text.slice(0, 160));
    check('two-column: heading stays first', /^1\.3 Evaluating/.test(lines[0].text), lines[0].text);
    const glued = linesOf(S, items, false).some((l) => l.x0 < 300 && l.x1 > 320 && !/Evaluating/.test(l.text));
    check('two-column: fixture actually mixes without column detection', glued);

    // Narrow margin note beside a wide main column: note goes after the main text, flagged isMargin
    const note = wrap(MARGIN_NOTE, 24);
    const main = wrap(MAIN_PARA, 70);
    const mItems = [...columnItems(main, 200, 100), ...columnItems(note, 60, 112, 9, 11)];
    const mLines = linesOf(S, mItems);
    const firstMargin = mLines.findIndex((l) => l.isMargin);
    check('margin note flagged and moved after main flow', firstMargin > 0 &&
      mLines.slice(firstMargin).every((l) => l.isMargin) && mLines.filter((l) => l.isMargin).length === note.length,
      mLines.map((l) => `${l.isMargin ? 'M' : ''}${l.text.slice(0, 20)}`).join(' | '));
    check('margin note never splices into main sentences', flat(mLines.filter((l) => !l.isMargin)) === MAIN_PARA);
    const cleaned = S.textCleaner.processSectionPages([{ pageNumber: 1, height: PAGE_H, lines: mLines }]);
    const sents = S.tokenizer.splitSentences(cleaned.text);
    check('margin note is its own sentence after cleaning', sents.includes(MARGIN_NOTE) &&
      sents.every((s) => s === MARGIN_NOTE || !s.includes('square root')), sents.join(' | '));

    // Single-column page (with a short centred equation line) must be untouched
    const single = [...columnItems(wrap(MAIN_PARA, 90), 72, 100), item('lim f(x) = L', 260, 160), item('Theorem 1.2', 450, 160)];
    const a = linesOf(S, single).map((l) => l.text);
    const b = linesOf(S, single, false).map((l) => l.text);
    check('single-column page unchanged by column detection', JSON.stringify(a) === JSON.stringify(b), a.join(' | '));
  }

  function checkHeadings(S, check) {
    const page = {
      pageNumber: 1,
      height: PAGE_H,
      lines: [
        { text: 'CHAPTER 1: Foundations of Cellular Bioenergetics', formattedText: '**CHAPTER 1: Foundations of Cellular Bioenergetics**', topY: 75, fontSize: 20, isBold: true },
        { text: '1.1 Laws of Thermodynamics in Living Systems', formattedText: '**1.1 Laws of Thermodynamics in Living Systems**', topY: 115, fontSize: 14.5, isBold: true },
        ...wrap('**Bioenergetics** is defined as the quantitative study of energy transductions that occur in living cells. Entropy refers to a quantitative measure of disorder within a thermodynamic system.', 80)
          .map((t, i) => ({ text: t.replace(/\*\*/g, ''), formattedText: t, topY: 145 + i * 14, fontSize: 11, isBold: false })),
        { text: '1.2 ATP Hydrolysis and Metabolic Coupling', formattedText: '1.2 ATP Hydrolysis and Metabolic Coupling', topY: 200, fontSize: 11, isBold: false },
        { text: 'Energy coupling links an unfavorable reaction to a favorable reaction in the same cell.', formattedText: 'Energy coupling links an unfavorable reaction to a favorable reaction in the same cell.', topY: 214, fontSize: 11, isBold: false },
      ],
    };
    const cleaned = S.textCleaner.processSectionPages([page]);
    const sents = S.tokenizer.splitSentences(cleaned.text).map((s) => S.tokenizer.cleanMarkdown(s));
    const headingWords = /CHAPTER|Foundations|Laws of Thermodynamics|ATP Hydrolysis/;
    check('headings end sentences (splitSentences)', sents.length >= 3 && sents.every((s) => !headingWords.test(s)), sents.join(' | '));
    check('first sentence starts at the prose', /^Bioenergetics is defined/.test(sents[0] || ''), sents[0]);
    const summary = S.summarizer.summarizeText(cleaned.text, { topK: 2 });
    check('summary takeaways carry no heading text', summary.sentences.every((s) => !headingWords.test(s)),
      summary.sentences.join(' | '));
    const tk = S.tokenizer;
    check('heading detector: real headings', ['**Definition of Limit**', 'CHAPTER 3', '2.1 Activation Energy and Catalytic Mechanisms', 'P.4 Fitting Models to Data']
      .every((h) => tk.isHeadingLine(h)));
    check('heading detector: wrapped prose is not a heading', ['1.5 times faster than the uncatalyzed reaction, which', 'identical nuclei. Meiosis', '**the integral of f from a to b**']
      .every((h) => !tk.isHeadingLine(h)));
  }

  function checkWrappedDefinitions(S, check) {
    const text = [
      ...wrap('Mitosis is the process by which a single nucleus divides into two genetically identical nuclei. Meiosis is a type of cell division that reduces the chromosome number by half and produces four haploid cells.', 78),
      '**Entropy**: a quantitative measure of disorder or randomness within a thermodynamic system.',
    ].join('\n');
    const cards = S.flashcardEngine.extractBookFlashcards(text, 'Fixture');
    const byFront = (f) => cards.find((c) => c.front.toLowerCase() === f.toLowerCase());
    const mitosis = byFront('Mitosis');
    check('wrapped definition kept whole (Mitosis)', mitosis && /two genetically identical nuclei\.$/.test(mitosis.back),
      mitosis ? mitosis.back : cards.map((c) => c.front).join(', '));
    const meiosis = byFront('Meiosis');
    check('second wrapped definition kept whole (Meiosis)', meiosis && /four haploid cells\.$/.test(meiosis.back),
      meiosis ? meiosis.back : cards.map((c) => c.front).join(', '));
    const entropy = byFront('Entropy');
    check('single-line glossary entry still produces a card', entropy && /thermodynamic system/.test(entropy.back));
    const cut = cards.filter((c) => /\b(?:genetically|by|the|a|and|of)$/.test(c.back));
    check('no flashcard back ends mid-sentence', cut.length === 0, cut.map((c) => `${c.front}: ${c.back}`).join(' | '));
  }

  /** Fluff, sidebar boxes, figure labels and exercise sets leave the scope text; enumerations keep structure. */
  function checkFigureAndFluff(S, check) {
    const L = (text, topY, o = {}) => ({ text: text.replace(/\*\*/g, ''), formattedText: text, topY, bottomY: topY + (o.fontSize || 10),
      fontSize: 10, x0: 228, x1: 576, isBold: false, wordCount: text.split(/\s+/).length, ...o });
    const M = (text, topY, o = {}) => L(text, topY, { isMargin: true, x0: 84, x1: 200, ...o });
    const page = { pageNumber: 5, height: PAGE_H, width: PAGE_W, lines: [
      L('Such well-behaved functions are continuous, and you will examine this concept more closely later.', 80),
      L('**THEOREM 1.1 Some Basic Limits**', 100, { isBold: true, x0: 241, x1: 420 }),
      L('Let $b$ and $c$ be real numbers, and let $n$ be a positive integer.', 114, { x0: 241 }),
      L('$$1.\\lim_{x \\to c}b = b\\quad 2.\\lim_{x \\to c}x = c$$', 130, { x0: 241, hasMath: true }),
      L('The limit of a polynomial can be found by direct substitution, as the next example shows in detail.', 160),
      L('This substitution property is valid for all polynomial and rational functions. See PublisherSite.com for a video of this proof.', 172),
      L('Copyright 2012 Example Learning. All Rights Reserved. May not be copied, scanned, or duplicated.', 184),
      L('**TECHNOLOGY PITFALL** A graphing utility can give misleading information', 210, { x0: 238 }),
      L('about the graph of a function near a hole.', 222, { x0: 238 }),
      L('Slope of a curve', 300, { x0: 331, x1: 400 }), L('Tangent line to', 340, { x0: 331, x1: 391 }), L('a curve', 352, { x0: 331, x1: 360 }),
      L('The next theorem concerns the limit of a function that is squeezed between two other functions near a point.', 400),
      L('1.3 Exercises', 440, { fontSize: 21, isBold: true, x0: 88 }),
      L('1. Find the limit of the function.', 470, { x0: 72 }),
      M('$y$', 120, { fontSize: 7, x0: 134, x1: 137 }), M('$-2 - 1\\quad 1\\quad 2$', 150, { fontSize: 7 }),
      M('$$f(x) =\\frac{x^{2} + x - 6}{x+ 3}$$', 190), M('$(-3, -5) - 5$', 230, { fontSize: 8 }),
      M('**REMARK** The proof of', 300), M('Property 1 is left as an exercise', 312), M('(see Exercise 109).', 324),
    ] };
    const out = S.textCleaner.processSectionPages([page]);
    const gone = ['PublisherSite', 'Copyright', 'misleading information', 'near a hole', 'Slope of a curve', 'Tangent line to', '$y$', '\\quad 1\\quad 2', 'x+ 3}', '(-3, -5)', 'Find the limit of the function'];
    check('fluff, sidebar box, figure labels and exercises leave scope text', gone.every((g) => !out.text.includes(g)), gone.filter((g) => out.text.includes(g)).join(' | '));
    check('real sentences and margin remarks survive the figure filter', ['valid for all polynomial and rational functions.', 'squeezed between two other functions',
      'Property 1 is left as an exercise', '1. $\\lim_{x \\to c}b = b$\n2. $\\lim_{x \\to c}x = c$'].every((k) => out.text.includes(k)), out.text);
    check('exercise set is separated into exerciseText', /Find the limit of the function/.test(out.exerciseText) && !/Basic Limits/.test(out.exerciseText), out.exerciseText);
    const thm = out.didacticBlocks[0];
    check('didactic body keeps one enumerated item per line', thm && thm.formulas.length === 2 &&
      thm.body === 'Let $b$ and $c$ be real numbers, and let $n$ be a positive integer.\n1. $\\lim_{x \\to c}b = b$\n2. $\\lim_{x \\to c}x = c$', JSON.stringify(thm));
    const odd = S.textCleaner.processSectionPages([{ pageNumber: 1, lines: [{ text: 'x' }, { text: 'Plain line without geometry survives.' }, {}] }, null, {}]);
    check('odd input degrades to plain lines without throwing', odd.text === 'Plain line without geometry survives.' && odd.exerciseText === '', JSON.stringify(odd));
  }

  function runLayoutChecks() {
    const S = loadModules();
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name: `[layout] ${name}`, ok: Boolean(ok), detail });
    try {
      checkFigureAndFluff(S, check);
    } catch (err) {
      check('checkFigureAndFluff threw', false, err && err.stack);
    }
    checkColumns(S, check);
    checkHeadings(S, check);
    checkWrappedDefinitions(S, check);
    return { results, passed: results.every((r) => r.ok) };
  }

  function formatResults(report) {
    return report.results
      .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL'])
      .join('\n');
  }

  const api = { runLayoutChecks, formatResults };
  root.LayoutFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runLayoutChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

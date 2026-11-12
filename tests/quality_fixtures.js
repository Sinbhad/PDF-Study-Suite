/**
 * Junk-Content Quality Fixtures (runs under Node via `node tests/quality_fixtures.js`
 * or in the browser via tests/quality.html). Asserts that copyright / TOC / front-matter text never
 * reaches summaries, flashcards or quiz questions, while legitimate prose still produces output.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';

  const COPYRIGHT_LINES = [
    'Biology and Society: Concepts and Connections, Fourth Edition',
    'Jane Q. Writer',
    'Product Director: Sam Example',
    '© 2024 Example Learning Press, Inc.',
    'ALL RIGHTS RESERVED. No part of this work covered by the copyright herein may be',
    'reproduced or distributed in any form or by any means, except as permitted by U.S.',
    'copyright law, without the prior written permission of the copyright owner.',
    'For permission to use material from this text or product, submit all requests online',
    'at www.examplepress.com/permissions. Further permissions questions can be emailed to',
    'permissionrequest@examplepress.com.',
    'Any copying of this text without authorization is strictly prohibited.',
    'Readers are not allowed to copy this book or share the material with others.',
    'Library of Congress Control Number: 2023901234',
    'ISBN: 978-1-234-56789-0',
    'Example Learning Press, 200 Main Street, Boston, MA 02210 USA',
    'ExampleSoft is a registered trademark of ExampleSoft Corporation.',
    'Printed in the United States of America',
    'Print Number: 01 Print Year: 2023',
    'Cover image: Stock Photo Agency',
    '1 2 3 4 5 6 7 27 26 25 24 23',
  ];

  const TOC_LINES = [
    'Contents',
    '1 Cells and Heredity ........ 3',
    '1.1 DNA Replication ........ 4',
    '1.2 Cell Division ........ 9',
    '2 Economics and Government ........ 15',
    '2.1 Property Rights ........ 16',
    '2.2 Inflation and Money ........ 21',
    'Glossary 301',
    'Index 315',
  ];

  const PROSE_PARAGRAPHS = [
    'DNA replication is the process by which a cell makes an exact copy of its genetic material before division. During replication, the enzyme helicase unwinds the double helix and separates the two parent strands. Each parent strand serves as a template for a new complementary strand. Because every daughter molecule keeps one original strand, replication is described as semiconservative.',
    'Mitosis is the process by which a single nucleus divides into two genetically identical nuclei. A copy number variation refers to a segment of DNA that is present in a different number of copies between individuals. Ribosomes are the cellular structures that translate messenger RNA into chains of amino acids. Enzymes increase the rate of a chemical reaction by lowering its activation energy.',
    'Property rights are the legal rules that determine who may use a resource and who receives the income it generates. Secure property rights encourage investment because owners expect to keep the returns from their effort. The Bill of Rights refers to the first ten amendments to the United States Constitution. Powers not delegated to the federal government are reserved to the states or to the people.',
    'Inflation is a sustained increase in the general price level of an economy over time. When the money supply grows faster than real output, the price level tends to rise. A central bank is the institution that controls the money supply and sets short-term interest rates. Higher interest rates reduce borrowing, which slows spending and lowers inflationary pressure.',
  ];

  const LEGIT_SENTENCES = [
    'DNA replication is the process by which a cell makes an exact copy of its genetic material before division.',
    'A copy number variation refers to a segment of DNA that is present in a different number of copies between individuals.',
    'Property rights are the legal rules that determine who may use a resource and who receives the income it generates.',
    'Powers not delegated to the federal government are reserved to the states or to the people.',
    'The Bill of Rights refers to the first ten amendments to the United States Constitution.',
  ];

  // Independent junk detector (deliberately not the module under test).
  const JUNK_RE =
    /rights\s+reserved|ISBN|written\s+permission|copy\s+this\s+book|copying\s+of\s+this\s+text|Library\s+of\s+Congress|Printed\s+in|trademark|www\.|@|\.{4,}|intentionally\s+left\s+blank|Print\s+Number|Product\s+Director|Cover\s+image|Example\s+Learning\s+Press|Fourth\s+Edition|\bContents\b|Glossary\s+301|02210/i;

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

  function makePage(pageNumber, lines, headingCount = 0) {
    return {
      pageNumber,
      height: 792,
      lines: lines.map((t, i) => ({
        text: t, formattedText: t, cleanText: t, topY: 80 + i * 22,
        fontSize: i < headingCount ? 20 : 11, isBold: i < headingCount, wordCount: t.split(' ').length,
      })),
    };
  }

  function buildPages() {
    const tocPage = makePage(2, TOC_LINES);
    tocPage.lines.forEach((l, i) => { if (i > 0) { l.fontSize = 14; l.isBold = true; } });
    return [
      makePage(1, COPYRIGHT_LINES),
      tocPage,
      makePage(3, ['This page intentionally left blank']),
      makePage(4, ['Chapter 1 Cells and Heredity', ...wrap(PROSE_PARAGRAPHS[0], 85), ...wrap(PROSE_PARAGRAPHS[1], 85)], 1),
      makePage(5, ['Chapter 2 Economics and Government', ...wrap(PROSE_PARAGRAPHS[2], 85), ...wrap(PROSE_PARAGRAPHS[3], 85)], 1),
    ];
  }

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'keywords', 'summarizer', 'flashcard-engine', 'quiz-gate', 'quiz-options', 'quiz-engine']
        .forEach((m) => require(`../src/nlp/${m}.js`));
      require('../src/pdf/text-cleaner.js');
      require('../src/pdf/book-hierarchy.js');
    }
    return root.PDFStudy;
  }

  function runQualityChecks() {
    const S = loadModules();
    const nf = S.noiseFilter;
    const results = [];
    const check = (name, ok, detail = '') => results.push({ name, ok: Boolean(ok), detail });
    const junky = (t) => JUNK_RE.test(t) || nf.isBoilerplate(t);
    const pages = buildPages();

    const missed = COPYRIGHT_LINES.filter((l, i) => i >= 3 && !nf.isBoilerplate(l) && !/MA 02210|^1 2 3/.test(l));
    check('noiseFilter flags copyright/legal lines', missed.length === 0, missed.join(' | '));
    const falsePos = LEGIT_SENTENCES.filter((s) => nf.isBoilerplate(s) || nf.isNoise(s));
    check('noiseFilter keeps legit prose (copy/rights/reserved)', falsePos.length === 0, falsePos.join(' | '));
    check('TOC dot-leader lines flagged', TOC_LINES.slice(1, 7).every((l) => nf.isBoilerplate(l)));
    check('copyright page skipped', nf.isBoilerplatePage(pages[0]), `score=${nf.boilerplateScore(pages[0]).toFixed(2)}`);
    check('TOC page skipped', nf.isBoilerplatePage(pages[1]), `score=${nf.boilerplateScore(pages[1]).toFixed(2)}`);
    check('blank page skipped', nf.isBoilerplatePage(pages[2]));
    check('prose pages kept', !nf.isBoilerplatePage(pages[3]) && !nf.isBoilerplatePage(pages[4]),
      `scores=${nf.boilerplateScore(pages[3]).toFixed(2)},${nf.boilerplateScore(pages[4]).toFixed(2)}`);

    const cleaned = S.textCleaner.processSectionPages(pages);
    const badLines = cleaned.text.split('\n').filter(junky);
    check('cleaned text has no boilerplate', badLines.length === 0, badLines.join(' | '));
    const flat = cleaned.text.replace(/\s+/g, ' ');
    check('cleaned text keeps prose', /exact copy of its genetic material/.test(flat) && /reserved to the states/.test(flat));

    const hier = S.bookHierarchy.extractBookHierarchy({ pages, numPages: pages.length, outline: [] });
    const titles = hier.chapters.flatMap((c) => [c.title, ...(c.sections || []).map((s) => s.title)]);
    check('hierarchy ignores TOC entries', titles.every((t) => !/\.{3,}/.test(t)) && hier.chapters.some((c) => c.startPage === 4),
      titles.join(' | '));

    // Run every generator on both the cleaned text and the raw (uncleaned) text of all pages.
    const rawText = pages.map((p) => p.lines.map((l) => l.text).join('\n')).join('\n\n');
    [['cleaned', cleaned.text], ['raw', rawText]].forEach(([label, text]) => {
      const summary = S.summarizer.summarizeText(text, { topK: 7, headings: ['Cells and Heredity'] });
      const badSum = summary.sentences.concat(summary.keyTerms).filter(junky);
      check(`[${label}] summary has no boilerplate`, badSum.length === 0, badSum.join(' | '));
      check(`[${label}] summary still has prose`, summary.sentences.length >= 3, `${summary.sentences.length} sentences`);

      const cards = S.flashcardEngine.extractBookFlashcards(text, 'Fixture');
      const badCards = cards.filter((c) => junky(c.front) || junky(c.back)).map((c) => `${c.front} => ${c.back}`);
      check(`[${label}] flashcards have no boilerplate`, badCards.length === 0, badCards.join(' | '));
      check(`[${label}] flashcards still produced`, cards.length >= 2, cards.map((c) => c.front).join(', '));

      const quiz = S.quizEngine.generateQuiz(text, { maxQuestions: 10 });
      const badQ = quiz.filter((q) => junky(q.question) || q.options.some(junky) || junky(q.explanation));
      check(`[${label}] quiz has no boilerplate`, badQ.length === 0, badQ.map((q) => `${q.question} [${q.options.join('; ')}]`).join(' | '));
      const dumbQ = quiz.filter((q) => /"\s*(?:Use|Find|Complete|Determine)\b|\?"$/.test(q.question));
      check(`[${label}] quiz has no imperative/question stems`, dumbQ.length === 0, dumbQ.map((q) => q.question).join(' | '));
      check(`[${label}] quiz still produced`, quiz.length >= 2, `${quiz.length} questions`);
      const trues = quiz.filter((q) => q.type === 'true_false' && q.answer === 'True').length;
      check(`[${label}] unperturbed True questions capped`, trues <= 2, `${trues} True questions`);
    });

    checkQuizShape(S, check);
    const optionFixtures = IS_NODE ? require('./option_fixtures.js') : root.OptionFixtures;
    optionFixtures.checkOptionQuality(S, check, BIO_SECTION);
    return { passed: results.every((r) => r.ok), results };
  }

  // Reproduces the "Foundations / According / Entropy refers" demo-book section (review finding).
  const BIO_SECTION = [
    '**CHAPTER 1: Foundations of Cellular Bioenergetics**',
    '**1.1 Laws of Thermodynamics in Living Systems**',
    '**Bioenergetics** is defined as the quantitative study of energy transductions that occur in living cells and the chemical processes underlying them.',
    '**Entropy** refers to a quantitative measure of disorder or randomness within a thermodynamic system.',
    'According to the first law of thermodynamics, the total amount of energy in the universe remains constant, although energy can convert from one form to another.',
    '**Gibbs Free Energy** (G): The portion of a system total energy that can perform work when temperature and pressure are uniform throughout the system.',
    'In an **exothermic** reaction, heat energy is released to the surroundings, whereas in an endothermic reaction heat is absorbed.',
  ].join('\n');
  const BAD_TAIL_RE = /\b(?:refers|remains|underlying|unwinds|constant|within|throughout|occur|convert|increases|decreases)$/i;
  const BAD_LEAD_RE = /^(?:although|according|another|whereas|however|because)\b/i;
  const GENERIC_RE = /^(?:foundations|laws|according|introduction|overview|summary|thermodynamics)$/i;
  const HEADING_OPTS = /^(?:foundations of cellular bioenergetics|cellular bioenergetics|living systems bioenergetics|living systems|laws of thermodynamics)$/i;

  function checkQuizShape(S, check) {
    for (const seed of [0, 1, 2]) {
      const quiz = S.quizEngine.generateQuiz(BIO_SECTION, { maxQuestions: 10, seedOffset: seed });
      const choice = quiz.filter((q) => q.type !== 'true_false');
      const opts = choice.flatMap((q) => q.options);
      const badShape = opts.filter((o) => BAD_TAIL_RE.test(o) || BAD_LEAD_RE.test(o) || GENERIC_RE.test(o));
      check(`[bio seed ${seed}] answers/options are noun phrases`, badShape.length === 0, badShape.join(' | '));
      check(`[bio seed ${seed}] no heading words as options`, !opts.some((o) => HEADING_OPTS.test(o)),
        opts.filter((o) => HEADING_OPTS.test(o)).join(' | '));
      const answers = choice.map((q) => q.answer.toLowerCase());
      check(`[bio seed ${seed}] no repeated answers`, new Set(answers).size === answers.length, answers.join(', '));
      const sources = quiz.map((q) => q.explanation.replace(/^.*?"/, '').slice(0, 50));
      check(`[bio seed ${seed}] no repeated source sentences`, new Set(sources).size === sources.length);
      const misShaped = choice.filter((q) => q.answer.split(' ').length >= 2 &&
        q.options.some((o) => o.split(' ').length < 2 && !/^[A-Z0-9-]{2,8}$/.test(o)));
      check(`[bio seed ${seed}] multi-word answers get multi-word distractors`, misShaped.length === 0,
        misShaped.map((q) => `${q.answer}: ${q.options.join('/')}`).join(' | '));
      check(`[bio seed ${seed}] still produces a few questions`, quiz.length >= 3, `${quiz.length} questions`);
    }
  }

  function formatResults(report) {
    return report.results
      .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL'])
      .join('\n');
  }

  const api = { runQualityChecks, formatResults, buildPages };
  root.QualityFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runQualityChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Card Content Fixtures (Node: `node tests/card_content_fixtures.js`): the shared content filter (slide and line
 * kinds, book spans), the self-contained gate, the card fields (subject, sourceKind, page) and the coverage
 * sources added with them (aspect groups, table cells, contrast pairs, numbered boxes, key statements).
 * All sample text is written for these fixtures; none is copied from a real document.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'bold-terms', 'definition-miner', 'stem-noise', 'math-text', 'content-filter', 'content-spans',
        'slide-kinds', 'slide-subjects', 'card-quality', 'self-contained', 'card-fields', 'abbreviations', 'note-patterns',
        'prose-definitions', 'table-cards', 'contrast-cards', 'aspect-groups', 'slide-line-shapes', 'slide-model',
        'slide-structure-cards', 'slide-cards', 'definition-rules', 'key-statements', 'boxed-cards', 'stem-cards',
        'flashcard-engine'].forEach((m) => require(`../src/nlp/${m}.js`));
    }
    return root.PDFStudy;
  }

  const nested = (rows) => rows.map(([level, text, extra]) => ({ level, text, ...(extra || {}) }));
  const outline = (rows) => ({ bullets: rows.map((r) => r[1]), nestedBullets: nested(rows) });
  const show = (cards) => cards.map((c) => `[${c.pageNumber}] ${c.front} => ${String(c.back).replace(/\n/g, ' / ')}`).join(' | ');

  function checkSlideKinds(S, check) {
    const cf = S.contentFilter;
    const kind = (slide, ctx) => cf.slideKind(slide, ctx);
    check('title slide: lecturer name with credentials on the opening slide',
      kind({ title: 'Renal Physiology', bullets: ['Pat Example, DVM, PhD', 'pat@example.edu'] }, { index: 0 }) === 'title');
    check('objectives slide, unless it reveals answers to its own questions',
      kind({ title: 'Learning Objectives', bullets: ['Describe the nephron', 'List three diuretics'] }) === 'objectives' &&
      kind({ title: 'Learning Targets: Kidney', bullets: ['What does the loop do?', 'Concentrates urine'] }, { hasQa: true }) === 'question');
    check('case slide from signalment in the title or two kinds of case signal',
      kind({ title: 'Biscuit 6y/o FS Beagle', bullets: ['Vomiting for two days'] }) === 'case' &&
      kind({ title: 'Lethargic ferrets', bullets: ['Two ferrets aged 3 yrs', '1-week history of weight loss'] }) === 'case' &&
      kind({ title: 'Down calf', bullets: ['This calf is recumbent and dull', 'How would you treat this?'] }) === 'case');
    check('epidemiology is not a case ("12% have a history of ...")',
      kind({ title: 'Pleural disease', bullets: ['20% have a history of transport', '10% have a history of surgery'] }) === 'content');
    check('references and course logistics',
      kind({ title: 'References', bullets: ['Smith J. et al. 2019'] }) === 'references' &&
      kind({ title: 'Lab requirements', bullets: ['Boots', 'Coveralls'] }) === 'contact' && kind({ title: 'Questions?', bullets: [] }) === 'contact');
    const deck = [
      { title: 'Biscuit 6y/o FS Beagle', bullets: ['Vomiting for two days'] },
      { title: 'Biscuit 6y/o FS Beagle', bullets: ['Differential diagnosis:', 'Foreign body'] },
      { title: 'Gastric dilatation', bullets: ['Common in deep-chested breeds'] },
    ];
    check('a slide that keeps a case slide\'s title continues the case', cf.slideKinds(deck).join(',') === 'case,case,content', cf.slideKinds(deck).join(','));
    check('isStudyContent reads slides and lines', !cf.isStudyContent(deck[0]) && cf.isStudyContent(deck[2]) && cf.isStudyContent('Loop diuretics act on the thick ascending limb.'));
  }

  function checkLineKinds(S, check) {
    const k = (t, ctx) => S.contentFilter.lineKind(t, ctx);
    check('url, citation, caption', k('https://www.example.org/renal/notes') === 'url' && k('Jones A, Lee B. Vet Med Res. 2015') === 'citation' &&
      k('Kidney of a cat with chronic disease (arrow)') === 'caption' && k('Glomerular crescents (due to immune complex deposition)') === 'caption');
    check('a sentence that mentions a figure-ish word stays content', k('Ultrasound is extremely valuable for renal disease') === 'content');
    check('quips and course remarks', k('This will NOT be on the exam') === 'quip' && k('BRING YOUR OWN STETHOSCOPE') === 'quip' && k('Thank you!') === 'quip');
    check('signalment', k('Biscuit 6y/o FS Beagle') === 'signalment' && k('Recent history of heavy rain') === 'content');
    check('code lines; a notes definition with "=" is not code', k('int[] counts = new int[5];') === 'code' && k('static route = entered by admin') === 'content');
    check('extraction tags win', k({ text: 'Proximal tubule', isAnnotation: true }) === 'annotation' && k({ text: 'Fig. 3 Nephron', kind: 'caption' }) === 'caption' &&
      k({ text: 'Plain words', kind: 'folio' }) === 'folio');
  }

  function checkBookSpans(S, check) {
    const lines = [
      '2.1 Sets',
      'A set is an unordered collection of objects.',
      'All the following statements are about sets.',
      '1. Paris is the capital of France.',
      '2. Lima is the capital of Peru.',
      'Find the union of the sets {1} and {2}.',
      'Solution: The union is {1, 2}. ◂',
      'The union of two sets contains every element of either set.',
      'ADA LOVELACE (1815–1852) Ada Lovelace was born in London. Her mother',
      'encouraged her studies. She wrote notes on an engine.',
      'The intersection of two sets contains the elements they share.',
      'Exercises',
      '1. Find the union of {3} and {4}.',
    ];
    const kinds = S.contentFilter.bookLineKinds(lines);
    check('numbered sample items after "the following statements" are an example', kinds[3] === 'example' && kinds[4] === 'example', kinds.join(','));
    check('a "Solution:" span with its question above it is an example', kinds[5] === 'example' && kinds[6] === 'example' && kinds[7] === 'content', kinds.join(','));
    check('a biography sidebar ends where the exposition resumes', kinds[8] === 'biography' && kinds[9] === 'biography' && kinds[10] === 'content', kinds.join(','));
    check('exercises are not exposition', kinds[11] === 'example' && kinds[12] === 'example', kinds.join(','));
    const study = S.contentFilter.studyText(lines.join('\n'));
    check('studyText keeps exposition only', /unordered collection/.test(study) && !/Paris|Lovelace|Solution/.test(study), study);
    const cards = S.flashcardEngine.extractBookFlashcards(lines.join('\n'), 'Sets');
    check('no card from an example item or a biography', !cards.some((c) => /Paris|Lima|Lovelace|engine/i.test(`${c.front} ${c.back}`)), show(cards));
  }

  function checkSelfContained(S, check) {
    const sc = S.selfContained;
    const r = (front, back, opts) => sc.reason({ front, back }, opts);
    check('unresolved references fail', r('Update anomaly', 'This condition is called an update anomaly.') !== '' &&
      r('Length', 'The number of elements (here, 10).') !== '' && r('Grid', 'The arrangement shown in the following table.') !== '' &&
      r('Array', 'A much better choice for storing many values.') !== '');
    check('praise and reader address fail', r('Dependencies', 'The heart of the database design process.') === 'praise' &&
      r('Integrity', 'The data in our database will be useful data.', { prose: true }) === 'addresses-reader');
    check('an instance is not a definition', r('Space-occupying lesion', 'Hemorrhage and edema are a space-occupying lesion.') === 'instance-not-definition');
    check('doubled heading fronts fail, a real binomial passes', sc.badFront('Functional Dependencies Functional dependencies') && sc.badFront('4NF 4NF') &&
      !sc.badFront('Streptococcus equi equi'));
    check('a plain definition passes', r('Catalyst', 'A substance that speeds up a reaction without being consumed.') === '' &&
      r('Limit from the right', 'For instance, the limit from the right means that x approaches c from above.') === '');
    const text = 'A lookup must scan every row when no index exists on the searched column. This condition is called a full scan. ' +
      'If there were many rows, it would be hard to spot this error. This condition is called a slow query.';
    const cards = S.flashcardEngine.extractBookFlashcards(text, 'Indexes');
    const by = (f) => cards.find((c) => c.front === f);
    check('"<definition>. This is called X": the back is the sentence before', by('Full scan') && /^A lookup must scan every row/.test(by('Full scan').back) &&
      !/called/.test(by('Full scan').back), show(cards));
    check('... and nothing when that sentence leans on another', !by('Slow query'), show(cards));
  }

  function checkSlideSubjects(S, check) {
    const deck = [
      { slideNumber: 1, title: 'Loop Diuretics', ...outline([[0, 'Furosemide: inhibits the Na-K-2Cl cotransporter'], [0, 'Torsemide: longer acting']]) },
      { slideNumber: 2, title: 'Pharmacokinetics', ...outline([[0, 'Absorption'], [0, 'Rapidly absorbed after oral dosing'], [0, 'Bioavailability near 60 percent'],
        [0, 'Adverse Effects Dehydration and low potassium are the main risks.']]) },
      { slideNumber: 3, title: 'Clinical Use', ...outline([[0, 'Hind: wrong column', { column: 1 }], [0, 'Indications'], [1, 'Congestive heart failure'], [1, 'Pulmonary edema']]) },
      { slideNumber: 4, title: 'Remember your physiology!', ...outline([[0, 'Ascending Limb'], [1, 'Collecting Duct']]) },
      { slideNumber: 5, title: 'Thiazides vs loop diuretics', bullets: ['Thiazides act on the distal tubule', 'Loop diuretics act on the ascending limb'] },
      { slideNumber: 6, title: 'Diuretic dosing', ...outline([[0, 'Give with food if needed'], [1, 'Reduces stomach upset']]) },
    ];
    const cards = S.flashcardEngine.extractSlideFlashcards(deck);
    const by = (f) => cards.find((c) => c.front === f);
    const model = S.slideModel.normalize(deck).slides;
    check('an aspect title inherits the last named entity', model[1].subject === 'Loop Diuretics' && model[1].entity === 'Loop Diuretics (Pharmacokinetics)', JSON.stringify(model[1]));
    check('flat "aspect line + facts" become one card under the entity', by('Loop Diuretics (Pharmacokinetics) — Absorption') &&
      by('Loop Diuretics (Pharmacokinetics) — Absorption').back === '• Rapidly absorbed after oral dosing\n• Bioavailability near 60 percent', show(cards));
    check('an aspect run into its fact is a label card', by('Loop Diuretics (Pharmacokinetics) — Adverse Effects') &&
      /^Dehydration and low potassium/.test(by('Loop Diuretics (Pharmacokinetics) — Adverse Effects').back), show(cards));
    check('every card has subject, sourceKind and page', cards.length > 0 && cards.every((c) => c.subject && c.sourceKind && c.page),
      cards.map((c) => `${c.front}:${c.subject}:${c.sourceKind}:${c.page}`).join(' | '));
    check('label cards name the entity, never a bare aspect', by('Loop Diuretics (Pharmacokinetics) — Absorption').subject === 'Loop Diuretics' &&
      !cards.some((c) => /^(?:Pharmacokinetics|Absorption)$/.test(c.front)), show(cards));
    check('a diagram label over a diagram label and an instruction over a step make no card',
      !cards.some((c) => /Ascending Limb|Give with food/.test(c.front)), show(cards));
    check('"X vs Y" slide -> contrast card', by('Thiazides vs loop diuretics — how do they differ?') &&
      by('Thiazides vs loop diuretics — how do they differ?').sourceKind === 'list', show(cards));
  }

  function checkTablesAndContrasts(S, check) {
    const cells = S.tableCards.rowCards({ header: ['Drug', 'Site', 'Onset'], rows: [['Furosemide', 'Loop', '5 min'], ['Spironolactone', 'Collecting duct', 'Days']] });
    check('table block -> one card per cell', cells.length === 4 && cells[0].front === 'Furosemide — Site' && cells[0].back === 'Loop' && cells.every((c) => c.sourceKind === 'table'),
      cells.map((c) => `${c.front}=${c.back}`).join(' | '));
    check('a grid of numbers is not a table of facts', S.tableCards.rowCards({ rows: [['', '1', '2'], ['1', '3', '4'], ['2', '5', '6']] }).length === 0);
    // Extraction mistakes: a titre grid with named rows, a lost header (first row is data), figure labels.
    check('named rows over number cells ask nothing', S.tableCards.rowCards({ header: ['Animal', 'Serovar A', 'Serovar B'],
      rows: [['Rex', '100', '200'], ['Bella', '50', '<100'], ['Max', '400', '50']] }).length === 0);
    check('a lower-case first row is data whose header was lost', S.tableCards.rowCards({ header: ['dogs', 'cattle', 'Alpha'],
      rows: [['mice', 'horses', 'Beta'], ['pigs', 'sheep', 'Gamma']] }).length === 0);
    check('figure labels read as a table ask nothing', S.tableCards.rowCards({ header: ['Swollen cells (arrows) which are pale and round', 'Debris'],
      rows: [['(small dark nuclei)', 'Both'], ['Lesions are often subtle!', 'Neither']] }).length === 0);
    const grouped = S.tableCards.rowCards({ header: ['Worm', 'Host'], rows: [['Genus spp.', ''], ['alpha', 'Dogs'], ['beta', 'Alpha Cats'], ['Other worm', 'Sheep']] });
    check('a group row names the rows under it; a cell that borrows a row label is dropped',
      grouped.some((c) => c.front === 'alpha (Genus spp.) — Host' && c.back === 'Dogs') && !grouped.some((c) => /Alpha Cats/.test(c.back)) &&
      grouped.some((c) => c.front === 'Other worm — Host'), grouped.map((c) => `${c.front}=${c.back}`).join(' | '));
    const pair = S.contrastCards.fromCards([
      { front: 'Hansen type 1', back: 'acute extrusion of the disk' },
      { front: 'Hansen type 2', back: 'chronic protrusion of the disk' },
      { front: 'Acute infarct', back: 'swollen dark tissue' },
      { front: 'Chronic infarct', back: 'shrunken tissue with a cavity' },
    ]);
    check('numbered kinds and opposite words pair into contrast cards', pair.length === 2 && /^Hansen type 1 vs type 2/.test(pair[0].front) &&
      /^Acute vs chronic infarct/.test(pair[1].front), pair.map((c) => c.front).join(' | '));
  }

  function checkBookCoverage(S, check) {
    const box = [
      '1.2 Exclusive Disjunction',
      'Definition 4 Let p and q be statements. The exclusive disjunction of p and q is the statement that is true',
      'when exactly one of p and q is true.',
      'Theorem 2 (Absorption Law) For all statements p and q, p or (p and q) is equivalent to p.',
    ].join('\n');
    const cards = S.flashcardEngine.extractBookFlashcards(box, 'Logic');
    const by = (f) => cards.find((c) => c.front === f);
    check('"Definition N" box without its frame -> the term it defines', by('Exclusive disjunction') && /exactly one of p and q is true/.test(by('Exclusive disjunction').back), show(cards));
    check('a named theorem box -> its name', by('Absorption Law') && by('Absorption Law').sourceKind === 'key-concept', show(cards));
    const tagged = S.flashcardEngine.extractBookFlashcards('Plain text that defines nothing at all here.', 'Arrays', [
      { kind: 'self-check', title: 'Self Check 3', items: [{ question: 'What is the index of the first element of an array?', answer: 'Zero.' }] },
      { kind: 'example', title: 'Example 7', body: 'Toronto is the capital of Canada.' },
      { kind: 'table', title: 'Operators', header: ['Operator', 'Meaning'], rows: [['==', 'equal to'], ['!=', 'not equal to']] },
    ]);
    check('tagged self-check -> ready-made Q&A card; tagged example -> nothing', tagged.some((c) => c.sourceKind === 'self-check' && c.back === 'Zero.') &&
      !tagged.some((c) => /Toronto/.test(c.back)), show(tagged));
    check('tagged table -> cell cards', tagged.some((c) => c.sourceKind === 'table' && c.front === '== — Meaning' && c.back === 'equal to'), show(tagged));
    // A numbered box the extraction tagged ("Definition 2" as its title) is asked by its term, never its number.
    const boxed = S.flashcardEngine.extractBookFlashcards('Plain text that defines nothing at all here.', 'Sets', [
      { kind: 'definition', category: 'Definition', title: 'Definition 2', body: 'A set with exactly one element is called a singleton set.', pageNumber: 12 },
      { kind: 'theorem', category: 'Theorem', title: 'Theorem 1', body: 'For every set S, the empty set is a subset of S.', pageNumber: 13 },
      { kind: 'proof', title: 'Proof', body: 'Let S be a set. Then the claim follows at once.', pageNumber: 13 },
    ]);
    check('tagged "Definition 2" -> a card named by its term, with its page; unnamed theorem and proof -> none',
      boxed.some((c) => /^Singleton set/i.test(c.front) && c.sourceKind === 'definition' && c.page === 12) &&
      !boxed.some((c) => /^(?:Definition|Theorem)\s+\d|^Proof/.test(c.front)), show(boxed));
    const prose = [
      '5.3 Comparing Strings',
      'The compareTo method compares strings in lexicographic order. You will see it again soon.',
      'This makes sorting easy. Strings are compared character by character from the left.',
    ].join('\n');
    const facts = S.flashcardEngine.extractBookFlashcards(prose, 'Strings');
    check('key statement: a self-contained sentence about the section subject -> completion card',
      facts.some((c) => c.sourceKind === 'key-concept' && c.front === 'The compareTo method compares …' && c.back === 'strings in lexicographic order'), show(facts));
    check('key statement: no card from a sentence that leans on another', !facts.some((c) => /^This makes/.test(c.front)), show(facts));
  }

  function runCardContentChecks() {
    const S = loadModules();
    const results = [];
    const suites = [['slide-kinds', checkSlideKinds], ['line-kinds', checkLineKinds], ['book-spans', checkBookSpans], ['self-contained', checkSelfContained],
      ['slide-subjects', checkSlideSubjects], ['tables', checkTablesAndContrasts], ['book-coverage', checkBookCoverage]];
    for (const [tag, fn] of suites) {
      const check = (name, ok, detail = '') => results.push({ name: `[content:${tag}] ${name}`, ok: Boolean(ok), detail: ok ? '' : detail });
      try {
        fn(S, check);
      } catch (err) {
        check(`${fn.name} threw`, false, err && err.stack ? err.stack : String(err));
      }
    }
    return { results, passed: results.every((r) => r.ok) };
  }

  function formatResults(report) {
    return report.results
      .map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`)
      .concat([report.passed ? 'PASS' : 'FAIL'])
      .join('\n');
  }

  const api = { runCardContentChecks, formatResults };
  root.CardContentFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runCardContentChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

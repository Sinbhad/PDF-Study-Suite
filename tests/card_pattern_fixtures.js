/**
 * Card Pattern Fixtures (Node: `node tests/card_pattern_fixtures.js`). One positive and one negative case per
 * card source: note-style lines, defining clauses in prose, bold terms, slide structure, and the shared
 * quality gates. All sample text is written for these fixtures.
 */
(function (root) {
  const IS_NODE = typeof module !== 'undefined' && module.exports && typeof require === 'function';

  function loadModules() {
    if (IS_NODE) {
      ['tokenizer', 'noise-filter', 'bold-terms', 'card-quality', 'abbreviations', 'note-patterns', 'prose-definitions',
        'slide-model', 'slide-structure-cards', 'slide-cards', 'flashcard-engine'].forEach((m) => require(`../src/nlp/${m}.js`));
    }
    return root.PDFStudy;
  }

  const NOTES = [
    'bio 201 wk 3 membranes',
    '',
    'Transport',
    'osmosis - movement of water across a membrane',
    'diffusion – particles spread from high to low conc',
    'active transport: uses ATP to pump against the gradient',
    'isotonic = same solute conc on both sides',
    'hypertonic soln -> cell shrinks',
    'endocytosis → vesicle forms → contents enter cell',
    '!! exam: draw the pump',
    '',
    'Membrane parts',
    '- phospholipid bilayer',
    '- channel proteins: let ions through',
    '- cholesterol keeps it fluid',
    '',
    'Fluid mosaic model',
    'proteins drift sideways in the lipid layer',
    '',
    'turgor = pressure of cell contents on wall, plasmolysis = membrane pulls away from wall',
    'Sodium potassium pump (SPP) moves 3 Na out',
  ].join('\n');

  function checkNotes(S, check) {
    const np = S.notePatterns;
    const pair = (line) => { const p = np.parseLine(line); return p && p.type === 'pair' ? `${p.term}|${p.definition}` : null; };
    check('hyphen, en dash, colon and equals all separate a term from its definition',
      pair('osmosis - movement of water') === 'osmosis|movement of water' && pair('osmosis – movement of water') === 'osmosis|movement of water' &&
      pair('osmosis: movement of water') === 'osmosis|movement of water' && pair('osmosis = movement of water') === 'osmosis|movement of water');
    check('the first separator decides ("a - b = c" is defined by the dash)', pair('tonicity - solute conc outside = effect on cell') === 'tonicity|solute conc outside = effect on cell');
    const arrow = np.parseLine('low temp -> slower reaction');
    check('ASCII and Unicode arrows parse as cause -> effect', arrow && arrow.type === 'arrow' && arrow.parts.join('|') === 'low temp|slower reaction' &&
      np.parseLine('low temp → slower reaction').type === 'arrow' && np.parseLine('a => b c d').type === 'arrow');
    check('comma-separated "a = x, b = y" gives one pair each', np.parseLine('turgor = wall pressure, lysis = cell bursts').pairs.length === 2);
    check('not a definition: clock time, lone variable, clause before the dash, hyphenated word',
      !np.parseLine('lecture moved to 10:30 on friday') && !np.parseLine('x = 5') && !pair('it is cold out - bring a coat') && !np.parseLine('semi-permeable membrane'));
    check('notes are told from prose', np.looksLikeNotes(NOTES) &&
      !np.looksLikeNotes('Osmosis is the movement of water across a membrane. It needs no energy from the cell. Water moves until both sides balance. Cells rely on it constantly.'));

    const cards = S.flashcardEngine.extractBookFlashcards(NOTES, 'Week 3');
    const by = (front) => cards.find((c) => c.front === front);
    const show = cards.map((c) => `${c.front} => ${c.back.replace(/\n/g, ' / ')}`).join(' | ');
    check('term cards from every separator, lower case tolerated', ['Osmosis', 'Diffusion', 'Active transport', 'Isotonic', 'Turgor', 'Plasmolysis'].every(by) &&
      by('Osmosis').back === 'movement of water across a membrane', show);
    check('arrow -> cause/effect card under its heading', by('Transport: hypertonic soln → ?') && by('Transport: hypertonic soln → ?').back === 'cell shrinks', show);
    check('three-part arrow -> sequence card with the whole chain', cards.some((c) => c.category === 'Sequence' && c.back === 'endocytosis → vesicle forms → contents enter cell'), show);
    check('heading over bullets -> list card kept short', by('Membrane parts') && by('Membrane parts').back.split('\n').length === 3 && by('Membrane parts').kind === 'overview', show);
    check('"label: value" bullet -> "<heading> — <label>" card', by('Membrane parts — channel proteins') && by('Membrane parts — channel proteins').back === 'let ions through', show);
    check('heading + fact line -> "<heading>" key-fact card', by('Fluid mosaic model') && /drift sideways/.test(by('Fluid mosaic model').back), show);
    check('abbreviation expanded', by('SPP') && /Sodium potassium pump/.test(by('SPP').back), show);
    check('title line and "!!" asides never become cards', !cards.some((c) => /bio 201|exam|draw the pump/i.test(`${c.front} ${c.back}`)), show);
    check('every note card has a topic (its heading)', cards.every((c) => c.topic) && by('Osmosis').topic === 'Transport' && by('Membrane parts').topic === 'Membrane parts',
      cards.map((c) => `${c.front}:${c.topic}`).join(' | '));
  }

  const PROSE = [
    'A catalyst is a substance that speeds up a reaction without being consumed; enzymes are the best-known examples.',
    'The energy that reactants must gain before they can react is called activation energy.',
    'The reaction took place in the Haber Works, a large plant built beside the river.',
    'Chemists track nicotinamide adenine dinucleotide (NAD), the carrier that shuttles electrons between reactions.',
    'Plants store glucose as starch, which is also known as amylum.',
    'The yield then drops because of a side reaction, which is the unwanted conversion of product into waste.',
    'Oxidation refers to the loss of electrons, whereas reduction refers to the gain of electrons.',
    'Two compounds are isomers if they share a formula but differ in structure.',
    'It is a mixture that settles slowly.',
    'The result is a mess of unwanted products in every flask.',
    'Four conditions must hold for it to arise: heat, pressure, time and a seed crystal.',
    'The slow final rearrangement of the outer shell electrons is a step that nobody has timed.',
    'A buffer is a buffer.',
  ].join(' ');

  function checkProse(S, check) {
    const cards = S.flashcardEngine.extractBookFlashcards(PROSE, 'Kinetics');
    const by = (front) => cards.find((c) => c.front === front);
    const show = cards.map((c) => `${c.front} => ${c.back}`).join(' | ');
    check('copula + genus: the back is the defining clause, cut at the semicolon', by('Catalyst') && by('Catalyst').back === 'A substance that speeds up a reaction without being consumed.', show);
    check('"X is called T": the back is X, not the whole sentence', by('Activation energy') && by('Activation energy').back === 'The energy that reactants must gain before they can react.', show);
    check('apposition after a proper name', by('Haber Works') && by('Haber Works').back === 'A large plant built beside the river.', show);
    check('apposition after "long form (ABBR)" keeps the abbreviation on the front', by('Nicotinamide adenine dinucleotide (NAD)') &&
      /^The carrier that shuttles electrons/.test(by('Nicotinamide adenine dinucleotide (NAD)').back), show);
    check('"also known as" -> another name', by('Amylum') && by('Amylum').back === 'Another name for starch.' || (by('Amylum') && /Another name for/.test(by('Amylum').back)), show);
    check('", which is the ..." relative clause', by('Side reaction') && by('Side reaction').back === 'The unwanted conversion of product into waste.', show);
    check('"refers to" in both halves of a "whereas" sentence', by('Oxidation') && by('Oxidation').back === 'The loss of electrons.' && by('Reduction') && by('Reduction').back === 'The gain of electrons.', show);
    check('"are T if ..." predicate', by('Isomers') && /share a formula/.test(by('Isomers').back), show);
    const noted = S.flashcardEngine.extractBookFlashcards('We start with one operation on sets of numbers here. The closure of $S$, denoted by $\\bar{S}$, is the smallest closed set that contains $S$. More follows later on in the text.', 'Sets');
    check('"The T of x, denoted by y, is the ..." keeps the notation in the back', noted.some((c) => c.front === 'Closure' && /denoted by \$\\bar\{S\}\$, is the smallest closed set/.test(c.back)),
      noted.map((c) => `${c.front} => ${c.back}`).join(' | '));
    check('no pronoun, generic or sentence-start fronts', !cards.some((c) => /^(?:It|Result|Four conditions|The)\b/.test(c.front)), show);
    check('no front longer than six words', cards.every((c) => c.front.replace(/\s*\([^)]*\)$/, '').split(/\s+/).length <= 6), show);
    check('a back that only restates the front is rejected', !by('Buffer'), show);
    check('every prose card has a topic', cards.length > 0 && cards.every((c) => c.topic === 'Kinetics'));

    const bold = [
      '2.4 Scheduling Basics',
      'The part of the kernel that picks the next task is the **dispatcher**. A task waits in the **ready queue**, which holds every task that could run now.',
      'It also suffers from the **lockout effect**: one long task keeps all the others waiting.',
      'Here a **soft deadline** is a deadline that may be missed without failure of the system.',
      'Engineers often compare designs by the behavior of **step inputs**.',
      '**Problem Statement** The lab server must finish nine jobs before noon on every weekday.',
      'Old systems used the **transitive depen-**',
      '**dency** model, which is the rule that a waits for b and b waits for c.',
    ].join('\n');
    const bc = S.flashcardEngine.extractBookFlashcards(bold, 'OS');
    const bb = (front) => bc.find((c) => c.front === front);
    const bshow = bc.map((c) => `${c.front} => ${c.back}`).join(' | ');
    check('bold term at the end of "X is the T": the back is X', bb('Dispatcher') && bb('Dispatcher').back === 'The part of the kernel that picks the next task.', bshow);
    check('bold term + ", which ..." / ": ..." -> the clause', bb('Ready queue') && bb('Ready queue').back === 'Holds every task that could run now.' &&
      bb('Lockout effect') && bb('Lockout effect').back === 'One long task keeps all the others waiting.', bshow);
    check('bold term defined inside the sentence ("a T is a ...")', bb('Soft deadline') && bb('Soft deadline').back === 'A deadline that may be missed without failure of the system.', bshow);
    check('bold mention and bold box label get no card', !bb('Step inputs') && !bc.some((c) => /Problem Statement/.test(c.front)), bshow);
    check('a bold run hyphenated over a line break is one term', bc.some((c) => /^Transitive dependency/.test(c.front)) && !bc.some((c) => /depen-/.test(c.front)), bshow);
    check('book card topic is the nearest heading', bb('Dispatcher') && bb('Dispatcher').topic === 'Scheduling Basics', bb('Dispatcher') && bb('Dispatcher').topic);
  }

  function checkSlides(S, check) {
    const nested = (rows) => rows.map(([level, text]) => ({ level, text }));
    const outline = (rows) => ({ bullets: rows.map((r) => r[1]), nestedBullets: nested(rows) });
    const deck = [
      { slideNumber: 1, title: 'Small Animal Medicine', bullets: ['Dr. A. Example', 'Spring term'] },
      { slideNumber: 2, title: 'Kennel cough', bullets: ['Etiology: Bordetella and parainfluenza virus', 'Treatment: rest and cough suppressants', 'Tracheitis: inflammation of the windpipe lining'] },
      { slideNumber: 3, title: 'Kennel cough', ...outline([[0, 'Clinical signs'], [1, 'Dry honking cough'], [1, 'Retching after exercise'], [0, 'Prevention'], [1, 'Intranasal vaccine']]) },
      { slideNumber: 4, title: 'Heart murmur workup', ...outline([[0, 'Differentials'], [1, 'Congenital'], [2, 'Patent ductus arteriosus'], [1, 'Acquired'], [2, 'Mitral valve disease']]) },
      { slideNumber: 5, title: 'Case: coughing spaniel', ...outline([[0, 'Plan'], [1, 'Radiographs, then echo. Biopsy?'], [0, 'Owner concerns']]) },
      { slideNumber: 6, title: 'Review', ...outline([[0, 'Which valve is affected most often in small breeds?'], [1, 'The mitral valve'], [1, 'It degenerates with age']]) },
      { slideNumber: 7, kind: 'table', title: 'Diuretics compared', bullets: [], table: { rows: [['Drug', 'Site', 'Use'], ['Furosemide', 'Loop of Henle', 'Acute oedema'], ['Spironolactone', 'Collecting duct', 'Long-term support']] } },
      { slideNumber: 8, title: 'Radiograph findings', ...outline([[0, 'Right: enlarged left atrium (arrow)'], [0, 'poops'], [1, 'an plnts'], [1, 'live']]) },
      { slideNumber: 9, title: 'Housing', bullets: ['Ventilation lowers the infection pressure', 'Quarantine new arrivals for ten days'] },
      { slideNumber: 10, title: 'Housing', bullets: ['Ventilation lowers the infection pressure', 'Quarantine new arrivals for ten days', 'Disinfect bowls every day'] },
    ];
    const cards = S.flashcardEngine.extractSlideFlashcards(deck);
    const by = (front) => cards.find((c) => c.front === front);
    const show = cards.map((c) => `[${c.pageNumber}] ${c.front} => ${String(c.back).replace(/\n/g, ' / ')}`).join(' | ');
    check('label slide: "<title> — <label>" for each generic label', by('Kennel cough — Etiology') && by('Kennel cough — Etiology').back === 'Bordetella and parainfluenza virus' &&
      by('Kennel cough — Treatment'), show);
    check('definition bullet keeps its own term as the front', by('Tracheitis') && by('Tracheitis').back === 'inflammation of the windpipe lining', show);
    check('heading bullet + nested bullets -> list card', by('Kennel cough — Clinical signs') && by('Kennel cough — Clinical signs').back === '• Dry honking cough\n• Retching after exercise', show);
    check('heading with one nested line -> fact card', by('Kennel cough — Prevention') && by('Kennel cough — Prevention').back === 'Intranasal vaccine', show);
    check('two small levels fold into one card', by('Heart murmur workup — Differentials') &&
      by('Heart murmur workup — Differentials').back === '• Congenital: Patent ductus arteriosus\n• Acquired: Mitral valve disease' && !by('Heart murmur workup — Congenital'), show);
    check('a bullet that merely ends in "?" is not paired with the next sibling heading', !cards.some((c) => c.kind === 'qa' && /Biopsy/.test(c.front)), show);
    const qa = cards.find((c) => c.kind === 'qa');
    check('a real question takes the bullets nested under it, and only those', qa && qa.front === 'Which valve is affected most often in small breeds?' &&
      qa.back === 'The mitral valve\nIt degenerates with age', qa ? `${qa.front} => ${qa.back}` : show);
    check('comparison table -> one card per cell, asked as "<row> — <column>"', by('Furosemide — Site') && by('Furosemide — Site').back === 'Loop of Henle' &&
      by('Spironolactone — Use') && by('Spironolactone — Use').back === 'Long-term support' && by('Furosemide — Site').sourceKind === 'table', show);
    check('figure captions and recognition debris make no cards', !cards.some((c) => /arrow|poops|plnts/.test(`${c.front} ${c.back}`)), show);
    check('cover slide makes no cards', !cards.some((c) => c.pageNumber === 1), show);
    check('a reveal frame that repeats the earlier bullets adds no second overview', cards.filter((c) => /key points of "Housing"/.test(c.front)).length === 1, show);
    check('every slide card carries its slide number and its title as topic', cards.length > 0 && cards.every((c) => c.pageNumber >= 2 && c.page === c.pageNumber && c.topic) &&
      by('Tracheitis').topic === 'Kennel cough' && by('Tracheitis').pageNumber === 2);
  }

  function checkQuality(S, check) {
    const q = S.cardQuality;
    check('front gate: terms pass', ['Activation energy', 'First-come, first-served (FCFS)', 'if statement', 'IPv4'].every((t) => q.goodFront(t)));
    check('front gate: pronouns, clauses, long phrases and dangling tails fail',
      ['It', 'This process', 'Four conditions must hold', 'the rate at which the slow step of a reaction runs', 'Differentiable on an', '“the land of'].every((t) => !q.goodFront(t)));
    check('back gate: mid-phrase endings fail, a variable at the end does not', !q.goodBack('the movement of water across the', 'Osmosis') && !q.goodBack('heat, pressure,', 'Conditions') &&
      q.goodBack('The subarray always contains the target in sorted array A.', 'Loop invariant'));
    check('back gate: restating the front fails', !q.goodBack('A buffer.', 'Buffer') && q.goodBack('shared pair', 'bonding pair'));
    const kept = q.dedupe([
      { front: 'Step function', back: 'A function that jumps between constant values.' },
      { front: 'Step functions', back: 'Something else entirely.' },
      { front: 'Unit step function', back: 'A function that jumps between constant values.' },
      { front: 'Ramp', back: 'A function that rises at a constant rate.' },
    ]);
    check('dedupe: same lemma and nested front with the same back are dropped', kept.map((c) => c.front).join('|') === 'Step function|Ramp', kept.map((c) => c.front).join('|'));
    check('readable: words and doses pass, recognition debris fails', q.readable('10 ml / 200 lb') && q.readable('Dogs (and cats): renal') && !q.readable('Ca2t^∞ spaytic Dea') && !q.readable(', fluke widrug'));
  }

  function runCardPatternChecks() {
    const S = loadModules();
    const results = [];
    for (const [tag, fn] of [['notes', checkNotes], ['prose', checkProse], ['slides', checkSlides], ['quality', checkQuality]]) {
      const check = (name, ok, detail = '') => results.push({ name: `[cards:${tag}] ${name}`, ok: Boolean(ok), detail: ok ? '' : detail });
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

  const api = { runCardPatternChecks, formatResults };
  root.CardPatternFixtures = api;
  if (IS_NODE) {
    module.exports = api;
    if (require.main === module) {
      const report = runCardPatternChecks();
      console.log(formatResults(report));
      process.exit(report.passed ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

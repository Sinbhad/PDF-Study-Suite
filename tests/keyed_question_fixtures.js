/**
 * Keyed questions and recall prompts of the fifth review (Node): array algorithms and if / else decisions traced on
 * values (array-rules.js, worked-arrays.js, branch-rules.js, worked-branches.js), the output of a section's logic
 * gates for given bits (gate-rules.js, worked-gates.js), labelled-list membership
 * (list-questions.js), a value among the scope's values of its unit (number-questions.js), a table's remarks column
 * (table-notes.js), and the recall prompts of labelled cards (recall-labels.js) with the card gates that feed them
 * (slide-line-shapes.js). Every computed key is checked again here by an independent computation, never by the
 * module that made it. All text is synthetic. Run: node tests/keyed_question_fixtures.js
 */
const path = require('path');

globalThis.window = globalThis;
const src = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
for (const f of ['tokenizer.js', 'math-text.js', 'stem-distractors.js', 'card-fields.js', 'page-lines.js', 'book-sections.js',
  'quiz-facts.js', 'quiz-subjects.js', 'code-expr.js']) {
  try { src(f); } catch (_e) { /* a helper a module loads on demand */ }
}
const ar = src('array-rules.js');
const br = src('branch-rules.js');
const wq = src('worked-questions.js');
const lists = src('list-questions.js');
const numbers = src('number-questions.js');
const notes = src('table-notes.js');
const labels = src('recall-labels.js');
const shapes = src('slide-line-shapes.js');
const claims = src('subject-claims.js');
const altered = src('altered-statements.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  [keyed] ${name}${!cond && detail ? `  (${detail})` : ''}`);
}

// 1. Array algorithms: read from the listings, traced on a literal array, every key recomputed here.
const ARRAY_TEXT = [
  '**4.3 Everyday Array Algorithms**', '', 'Some loops.', '',
  '**4.3.1 Adding Up**', '', 'This loop adds the scores.', '', '```', 'int sum = 0;', 'for (int k = 0; k < scores.length; k++)', '{', '  sum = sum + scores[k];', '}', '```', '',
  '**4.3.2 Best Score**', '', '```', 'int best = scores[0];', 'for (int k = 1; k < scores.length; k++)', '{', '  if (scores[k] > best)', '  {', '    best = scores[k];', '  }', '}', '```', '',
  '**4.3.3 Finding a Score**', '', '```', 'int at = 0;', 'boolean hit = false;', 'while (at < scores.length && !hit)', '{', '  if (scores[at] == wanted)', '  {', '    hit = true;', '  }', '  else', '  {', '    at++;', '  }', '}', '```', '',
  '**4.3.4 Dropping a Score**', '', '```', 'for (int k = at + 1; k < used; k++)', '{', '  scores[k - 1] = scores[k];', '}', 'used--;', '```', '',
  '**4.3.5 Exchanging Two Scores**', '', '```', 'int temp = scores[a];', '```', '', 'Then the second slot is copied over.', '', '```', 'scores[b] = temp;', '```',
].join('\n');
const arrayRules = ar.read({ text: ARRAY_TEXT, lines: null, startPage: 80 });
const algos = arrayRules.map((r) => r.algorithm).sort().join(',');
check('array-rules: sum, max, search, ordered removal and swap read from their listings', algos === 'max,remove-order,search,sum,swap', algos);
check('array-rules: a loop that only prints is not read as an algorithm',
  ar.read({ text: '**2.1 Printing**\n\n```\nfor (int k = 0; k < n; k++)\n{\n  System.out.print(k);\n}\n```', lines: null, startPage: 1 }).length === 0);
const arrayCards = ar.cards(arrayRules).map((c) => ({ ...c, page: c.page || 80 }));
const byAlgo = Object.fromEntries(arrayCards.map((c) => [c.rule.algorithm, c]));
check('array-rules: sum, max and search cards are conceptual and self-contained',
  byAlgo.sum && !/sum loop leave/i.test(byAlgo.sum.front) &&
  byAlgo.max && !/the section/i.test(byAlgo.max.front) &&
  byAlgo.search && !/\bpos\b/.test(byAlgo.search.front));
const traced = wq.build(arrayCards, { seed: 0, variant: 0 });
const literal = (q) => (q.question.match(/\{\s*([\d,\s]+)\}/) || [])[1].split(',').map(Number);
let tracedOk = traced.length >= 5;
for (const q of traced) {
  const v = literal(q);
  let want = null;
  if (/sum loop/.test(q.question)) want = String(v.reduce((s, x) => s + x, 0));
  else if (/largest/.test(q.question)) want = String(Math.max(...v));
  else if (/linear search/.test(q.question)) {
    const target = Number(q.question.match(/searchedValue = (\d+)/)[1]);
    want = String(v.indexOf(target) < 0 ? v.length : v.indexOf(target));
  } else if (/Removal/.test(q.question)) {
    const pos = Number(q.question.match(/values\[(\d+)\]/)[1]);
    want = [...v.slice(0, pos), ...v.slice(pos + 1)].join(', ');
  } else if (/swap/.test(q.question)) {
    const [i, j] = [...q.question.matchAll(/values\[(\d+)\]/g)].map((m) => Number(m[1]));
    const w = [...v];
    [w[i], w[j]] = [w[j], w[i]];
    want = w.join(', ');
  }
  const ok = want !== null && q.answer === want && q.options.length === 4 && new Set(q.options).size === 4 && /\(p\. \d+\)/.test(q.explanation);
  if (!ok) tracedOk = false;
  if (!ok) console.log(`   trace: ${q.question} => ${q.answer} (want ${want})`);
}
check('worked-arrays: every traced key equals an independent run, four distinct options, rule and page shown', tracedOk, `${traced.length} questions`);

// 2. Decisions: an if / else if / else chain and a two-way if / else, run on values.
const BRANCH_TEXT = [
  '**6.2 Several Cases**', '', '```', 'if (depth >= 9.5)', '{', '  label = "Deep";', '}', 'else if (depth >= 6.0)', '{', '  label = "Medium";', '}',
  'else if (depth >= 2.5)', '{', '  label = "Shallow";', '}', 'else', '{', '  label = "Puddle";', '}', '```', '',
  '**6.1 One Case**', '', '```', 'if (level > 20)', '{', '  shown = level - 2;', '}', 'else', '{', '  shown = level;', '}', '```',
].join('\n');
const branchRules = br.read({ text: BRANCH_TEXT, lines: null, startPage: 90 });
check('branch-rules: one chain of three tests and a final else, and one two-way choice', branchRules.length === 2 &&
  branchRules.some((r) => r.form === 'chain' && r.tests.join() === '9.5,6,2.5' && r.fallback === 'Puddle') &&
  branchRules.some((r) => r.form === 'choice' && r.limit === 20 && r.yes === 'level - 2'), JSON.stringify(branchRules.map((r) => r.form)));
check('branch-rules: independent ifs without else are not a chain',
  br.read({ text: '**6.3 Wrong**\n\n```\nif (depth >= 9.5)\n{\n  label = "Deep";\n}\nif (depth >= 6.0)\n{\n  label = "Medium";\n}\nif (depth >= 2.5)\n{\n  label = "Shallow";\n}\n```', lines: null, startPage: 1 }).length === 0);
const branchCards = br.cards(branchRules);
let branchOk = true;
for (const variant of [0, 1]) {
  for (const q of wq.build(branchCards, { seed: 3, variant })) {
    let want;
    if (/else if/.test(q.question)) {
      const targetVal = (q.question.match(/set `?label`? to "([^"]+)"/) || [])[1];
      const evalDepth = (d) => (d >= 9.5 ? 'Deep' : d >= 6.0 ? 'Medium' : d >= 2.5 ? 'Shallow' : 'Puddle');
      const hits = q.options.filter((o) => evalDepth(Number(o)) === targetVal);
      const hasEmbeddedChain = /\bif\s*\(depth\s*>=/.test(q.question) && /else\s*\{/.test(q.question);
      if (!targetVal || !hasEmbeddedChain || hits.length !== 1 || hits[0] !== q.answer || new Set(q.options).size !== 4) {
        branchOk = false;
        console.log(`   branch: ${q.question} => ${q.answer} (hits ${hits.join(',')})`);
      }
      continue;
    } else {
      const level = Number(q.question.match(/level`? is (\d+)/)[1]);
      want = String(level > 20 ? level - 2 : level);
    }
    if (q.answer !== want || new Set(q.options).size !== 4) {
      branchOk = false;
      console.log(`   branch: ${q.question} => ${q.answer} (want ${want})`);
    }
  }
}
check('worked-branches: every key equals an independent evaluation, both variants', branchOk);

// 2b. Gates: read from the section's sentences, the asked output computed by an independent truth function here.
const gr = src('gate-rules.js');
const GATE_TEXT = 'The next equations define the logical AND operation. The next equations define the logical OR operation. ' +
  'The NAND gate represents the complement of the AND operation, and the NOR gate represents the complement of the OR operation. ' +
  'The XOR gate is similar to the OR gate, but has the value 0 when both X and Y are equal to 1.';
const gateRule = gr.read({ text: GATE_TEXT, blocks: [], lines: null });
check('gate-rules: AND, OR, NAND, NOR and XOR read from their sentences', gateRule && gateRule.gates.map((g) => g.gate).sort().join() === 'AND,NAND,NOR,OR,XOR',
  gateRule && gateRule.gates.map((g) => g.gate).join());
check('gate-rules: a complement of an undefined gate is not read', !gr.read({ text: 'The NAND gate represents the complement of the AND operation.', blocks: [], lines: null }));
const truth = { AND: (x, y) => (x && y ? 1 : 0), OR: (x, y) => (x || y ? 1 : 0), NAND: (x, y) => (x && y ? 0 : 1), NOR: (x, y) => (x || y ? 0 : 1), XOR: (x, y) => (x !== y ? 1 : 0) };
const gateCards = gr.cards(gateRule).map((c) => ({ ...c, page: 12 }));
let gatesOk = true;
for (const variant of [0, 1]) {
  for (const q of wq.build(gateCards, { seed: 1, variant })) {
    const [, x, y, want] = q.question.match(/X = (\d)`? and `?Y = (\d)`?, which gate outputs (\d)/).map(Number);
    const hits = q.options.filter((o) => truth[o.replace(/\s+gate$/i, '')](x, y) === want);
    if (hits.length !== 1 || hits[0] !== q.answer) {
      gatesOk = false;
      console.log(`   gates: ${q.question} => ${q.answer} (${q.options.join(', ')})`);
    }
  }
}
check('worked-gates: exactly one offered gate gives the asked output, and it is the key', gatesOk);

// 3. Labelled lists: membership against sibling lists of the same heading and slide.
const listCard = (label, items, page = 5) => ({ front: `Pond Care — ${label}`, back: items.map((x) => `• ${x}`).join('\n'), sourceKind: 'label', subject: 'Pond Care', pageNumber: page });
const listCards = [listCard('Daily', ['Check water level', 'Remove floating leaves', 'Count the fish', 'Feed once']),
  listCard('Weekly', ['Scrub the filter', 'Test nitrate']), listCard('Yearly', ['Drain the pond', 'Repaint the liner'])];
const lq = lists.candidates(listCards, { seed: 0 });
const notQ = lq.find((q) => /NOT listed/.test(q.question));
const inQ = lq.find((q) => /is listed under/.test(q.question));
const daily = ['Check water level', 'Remove floating leaves', 'Count the fish', 'Feed once'];
check('list-questions: NOT question keys the one outsider from a sibling list', notQ && !daily.includes(notQ.answer) &&
  notQ.options.filter((o) => daily.includes(o)).length === 3, notQ && notQ.options.join(' | '));
check('list-questions: belongs question keys the one member', inQ && daily.includes(inQ.answer) && inQ.options.filter((o) => daily.includes(o)).length === 1, inQ && inQ.options.join(' | '));
const listed = [...listCards, { ...listCard('Daily', ['Test nitrate', 'Feed once'], 9), front: 'Spring Care — Daily' }];
check('list-questions: an outsider the scope also lists under the asked label is never offered',
  lists.candidates(listed, { seed: 0 }).every((q) => !/NOT/.test(q.question) || q.answer !== 'Test nitrate'));
check('list-questions: a list under three members is not asked', lists.candidates([listCard('Daily', ['A one', 'B two', 'C three']), listCard('Weekly', ['D four', 'E five'])], {}).length === 0);
const genericPreps = [
  { front: 'Supportive therapy — At the dock', back: '• Shade\n• Fresh water\n• Cool bath\n• Rest', sourceKind: 'label', subject: 'Supportive therapy', pageNumber: 4 },
  { front: 'Supportive therapy — In the tank', back: '• Aeration\n• Salt dip', sourceKind: 'label', subject: 'Supportive therapy', pageNumber: 4 },
];
check('list-questions: generic heading with prepositional labels is not asked', lists.candidates(genericPreps, { seed: 0 }).length === 0);
const notedItems = lists.itemsOf({ back: '• Cold rinse *swelling*\n• Warm bath' });
check('list-questions: inline asterisk notes format cleanly in parentheses', notedItems[0] === 'Cold rinse (swelling)', JSON.stringify(notedItems));

// 4. Numbers: the same unit, no overlap, not within rounding, not said of the same thing about the subject.
const numberScope = {
  text: 'Eggs hatch in 4-5 days. Fry feed after 2 weeks. Ponds rest 9-10 days. Nets dry for 12-14 days. Water warms 1-2 days. Gills heal in 5 days.',
  facts: [{ kind: 'point', subject: 'Carp', subjectKey: 'carp', statement: 'Eggs hatch in 4-5 days', identity: 'carp|eggs', source: 'Carp: Eggs hatch in 4-5 days', page: 3 }],
  allCards: [],
};
const nq = numbers.candidates(numberScope, { seed: 0 })[0];
check('number-questions: options in days, none overlapping 4-5 days or within rounding', nq && nq.answer === '4-5 days' &&
  nq.options.every((o) => o === '4-5 days' || /^\d+-\d+ days$/.test(o)) && !nq.options.includes('5 days'), nq && nq.options.join(' | '));
check('number-questions: fair() rejects overlap, another unit and near values', !numbers.fair({ lo: 4, hi: 5, unit: 'days', text: '4-5 days' }, { lo: 5, hi: null, unit: 'days', text: '5 days' }) &&
  !numbers.fair({ lo: 4, hi: 5, unit: 'days', text: '4-5 days' }, { lo: 2, hi: null, unit: 'weeks', text: '2 weeks' }) &&
  numbers.fair({ lo: 4, hi: 5, unit: 'days', text: '4-5 days' }, { lo: 12, hi: 14, unit: 'days', text: '12-14 days' }) &&
  !numbers.fair({ lo: 4, hi: 5, unit: 'days', text: '4-5 days' }, { lo: 12, hi: null, unit: 'days', text: '12 days' }));
const fragScope = {
  text: '12% recover slowly. 25% need care. 43% fail early. 78% survive.',
  facts: [],
  allCards: [
    { front: 'Pond check — Culture', back: '• Can be absent in 43% of ponds but tests were positive in all cases', sourceKind: 'label', subject: 'Pond check', pageNumber: 2 },
    { front: 'Prognosis — Mild case', back: '• 78% survived to release', sourceKind: 'label', subject: 'Prognosis', pageNumber: 8 },
  ],
};
const fragNums = numbers.candidates(fragScope, { seed: 0 });
check('number-questions: verb-initial study anecdote fragment is refused', !fragNums.some((q) => /absent/.test(q.question)), JSON.stringify(fragNums));
check('number-questions: generic heading card takes the concrete label as subject', fragNums.some((q) => q.subject === 'Mild case' && q.answer === '78%'), JSON.stringify(fragNums));

// 5. Table remarks: a related note ("non-specific" / "not serospecific") or one naming the row is never offered.
const header = ['Test', 'Sample', 'Notes'];
const tableCard = (row) => ({ front: `${row[0]} — Sample`, back: row[1], sourceKind: 'table', pageNumber: 7,
  table: { entity: row[0], column: 'Sample', columnIndex: 1, key: 'test|sample|notes', header, row } });
const rows = [['Swab', 'Gill', 'Quick but non-specific'], ['Culture', 'Kidney', 'Slow growth in the lab'], ['Smear', 'Skin', 'Needs a stain first'],
  ['Probe', 'Blood', 'Not serospecific at all'], ['Panel', 'Serum', 'Confirms the Probe result']];
const nn = notes.candidates(rows.map(tableCard), { seed: 0, isDeck: true });
const swab = nn.find((q) => /"Swab"/.test(q.question));
check('table-notes: the asked row\'s note is the key', nn.length > 0 && nn.every((q) => rows.find((r) => q.question.includes(`"${r[0]}"`))[2] === q.answer), nn.map((q) => q.answer).join(' | '));
check('table-notes: a related remark is not offered', !swab || !swab.options.includes('Not serospecific at all'), swab && swab.options.join(' | '));
check('table-notes: a remark naming the asked row is not offered', nn.filter((q) => /"Probe"/.test(q.question)).every((q) => !q.options.includes('Confirms the Probe result')));
const ellipRows = [['Swab', 'Gill', 'Also needs a rinse'], ['Culture', 'Kidney', 'Needs paired tests!'], ['Smear', 'Skin', 'Slow growth in the lab'],
  ['Probe', 'Blood', 'Stains cell walls clearly'], ['Panel', 'Serum', 'Confirms the early read'], ['Filter', 'Fluid', 'Clears debris before spin']];
const ellipNotes = notes.candidates(ellipRows.map((r) => ({ ...tableCard(r), table: { ...tableCard(r).table, key: 'ellip|sample|notes' } })), { seed: 0, isDeck: true });
check('table-notes: elliptical "Also ..." and exclamation notes are excluded as answers and distractors',
  ellipNotes.length > 0 && ellipNotes.every((q) => !/^(?:Also|Needs paired tests!)/.test(q.answer) && !q.options.some((o) => /^(?:Also|Needs paired tests!)/.test(o))),
  ellipNotes.map((q) => `${q.answer} [${q.options.join(' | ')}]`).join('\n'));

// 6. Recall prompts of labelled cards (the templates and the slide nesting are covered by recall_question_fixtures.js),
// and the card gates behind them.
const descSlide = { slideNumber: 3, title: 'Pond fever', nestedBullets: [{ level: 0, text: 'A gram-negative rod' }, { level: 1, text: 'Spreads through shared nets' },
  { level: 0, text: 'Caused by a water mould' }, { level: 1, text: 'Seen in warm ponds' }] };
const scope = { slides: [descSlide], ctx: { repeated: new Set() } };
check('recall-labels: a descriptive label is not a prompt', labels.labelled({ front: 'Pond fever — A gram-negative rod', back: 'x', pageNumber: 3, sourceKind: 'label' }, scope) === null);
check('recall-labels: a participle label is not a prompt', labels.labelled({ front: 'Pond fever — Caused by a water mould', back: 'x', pageNumber: 3, sourceKind: 'label' }, scope) === null);
check('recall-labels: a single line with no label is not asked', labels.labelled({ front: 'Gill wash', back: 'Can be taken through the mouth', pageNumber: 3 }, scope) === null);
check('slide-line-shapes: descriptions are not label heads', !shapes.isLabelHead('A gram-negative rod') && !shapes.isLabelHead('Caused by a water mould') &&
  !shapes.isLabelHead('Diagnostic as well as therapeutic') && shapes.isLabelHead('Clinical signs'));
check('slide-line-shapes: two binomials run together are debris', shapes.fusedNames('Vibrio anguillarum Aeromonas spp.') && !shapes.fusedNames('Vibrio anguillarum and Aeromonas spp.'));
check('slide-line-shapes: a name over lower-case predicates is a mis-nested sibling', !shapes.goodItems('Larvae', ['Young worms', 'enter the gut', 'migrate to the liver']));

// 7. Borrowed options: an inflection of the subject's own word is its own word; direction swaps need a contrast.
const idx = claims.create();
idx.add('drug-a', 'Dead worms pass in the feces');
idx.add('drug-b', 'Worms die before they are passed');
check('subject-claims: "die" is not false of a subject whose material says "dead"', claims.family('dying') === claims.family('dead') &&
  !idx.isFalseOf('drug-a', 'Drug A', 'Worms die before they are passed', true));
const fs = src('fact-statements.js');
check('fact-statements: a shouted common word or an abstract noun is no subject-specific claim, an acronym is',
  !fs.isSpecificClaim('Worms DIE before they are passed.') && !fs.isSpecificClaim('Neuronal dysfunction leads to signs and death.') &&
  fs.isSpecificClaim('Detected by PCR in urine'));
check('fact-statements: narrated worked-example text and iff clauses are not definitions',
  !fs.isDefinitionText('When we delete one row, we lose two facts.') &&
  !fs.isDefinitionText('If and only if it is balanced and full.'));
check('fact-statements: hedged openers, referring verbs and generic outcome arrows are not point statements',
  !fs.isPointStatement('Likely caused by stronger river currents.') &&
  !fs.isPointStatement('Reflects entry path along the gill arch.') &&
  !fs.isPointStatement('Cell dysfunction → clinical signs and death'));
check('altered-statements: upper/lower is not swapped without a contrast line', altered.alter('History of upper airway disease in the herd', { text: '' }) === null);
check('altered-statements: upper-bound and onset-in-time durations are not scaled',
  altered.alter('Symptoms resolve within 6 hours', { text: '' }) === null &&
  altered.alter('Enzyme level changes in 6 hours', { text: '' }) === null);
const shedAltered = altered.alter('Fish shed spores for 6 weeks after recovery', { text: '' });
check('altered-statements: non-bound duration still alters to a scaled value', shedAltered && shedAltered.to === '18 weeks', JSON.stringify(shedAltered));

console.log(`keyed_question_fixtures: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

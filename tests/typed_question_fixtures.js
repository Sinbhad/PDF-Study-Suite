/**
 * Typed questions (Node): generation (typed-questions.js, typed-values.js, typed-round.js) on synthetic text and
 * cards, and the quiz's assembly around them: a typed question is only asked where one term (or value) is right,
 * never beside a recall or choice question on the same fact, and the checker takes its own answer.
 * All text is synthetic. Run: node tests/typed_question_fixtures.js
 */
const path = require('path');

globalThis.window = globalThis;
const nlp = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
['math-text', 'stem-noise', 'tokenizer', 'noise-filter', 'bold-terms', 'keywords', 'summarizer', 'stem-cards', 'slide-cards',
  'flashcard-engine', 'quiz-gate', 'quiz-options', 'stem-distractors', 'stem-questions', 'quiz-engine', 'test-engine'].forEach((m) => nlp(`${m}.js`));
const S = globalThis.PDFStudy;
const tv = nlp('typed-values.js');
const tt = nlp('typed-tables.js');
const shape = nlp('typed-shape.js');
const tc = nlp('typed-check.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
const show = (list) => list.map((q) => `${q.type}: ${String(q.question).replace(/\s+/g, ' ').slice(0, 90)} => ${q.answer}`).join('\n     ');

// ---------------------------------------------------------------- other names and names the prompt prints
check('alias from "X (Y)"', shape.aliasesOf('Address register', 'The address register (AR) holds an address.').includes('AR'));
check('alias from "Y (X)" for an acronym', shape.aliasesOf('AR', 'The address register (AR) holds an address.').includes('address register'));
check('alias from "X, or Y,"', shape.aliasesOf('empty set', 'The empty set, or null set, has no elements.').includes('null set'));
check('no alias from a page reference', shape.aliasesOf('pump', 'A pump (see page 12) moves fluid.').length === 0);
check('names after the blank are shown', JSON.stringify(shape.shownAfter(' (or inlet or intake) of the pump')) === JSON.stringify(['inlet', 'intake']));

// ---------------------------------------------------------------- table cells: a single value under both headers
const table = (entity, column, columnIndex, back, row) => ({
  front: `${entity} — ${column}`, back, sourceKind: 'table', page: 3,
  table: { key: 'fluids', header: ['Fluid', 'Container', 'Boils at'], column, columnIndex, entity, row },
});
const rows = [['Brine', 'Vat', '108 °C'], ['Glycol', 'Drum', '197 °C'], ['Ethanol', 'Bottle, Flask', '78 °C'], ['Water', 'Tank', '100 °C']];
const cards = rows.flatMap((r) => [table(r[0], 'Container', 1, r[1], r), table(r[0], 'Boils at', 2, r[2], r)]);
const tables = tt.tables(cards, {});
const brine = tables.find((q) => q.answer === 'Vat');
check('table: a single cell is asked with both headers', brine && brine.question === 'In the row where Fluid is "Brine", what is the Container?' && brine.form === 'term', show(tables));
check('table: a list cell is not asked typed', !tables.some((q) => /Bottle/.test(q.answer)), show(tables));
check('table: the other rows of the column are terms a student may not give', brine && brine.others.includes('Drum') && !brine.others.includes('Vat'));
check('table: another row\'s value is "another term"', brine && tc.check(brine, 'drum').verdict === 'other');

// A cell is asked only when its right answers can be stated by rule.
const grid = (key, header, list) => list.flatMap((r) => r.slice(1).map((v, i) => ({
  front: `${r[0]} — ${header[i + 1]}`, back: v, sourceKind: 'table', page: 7,
  table: { key, header, column: header[i + 1], columnIndex: i + 1, entity: r[0], row: r },
})));
const asked = (list) => tt.tables(list, {}).map((q) => `${q.subject}|${q.answer}`);
const probes = grid('probes', ['Probe', 'Specimen', 'Reads'], [
  ['Smear', 'Dried swab', 'Stained bodies'], ['Titer', 'Plasma/heparin', 'Carrier antibodies'], ['Amplify', 'Swab (nasal)', 'Microbial RNA'],
  ['Grow', 'Fresh swab', 'Microbes'], ['Stain', 'Knee cartilage', 'Microbial protein'],
]);
const probeQs = asked(probes);
check('table: no cell of a column that gives alternatives ("Plasma/heparin", "Swab (nasal)")', !probeQs.some((x) => /Specimen|swab|cartilage/i.test(x)), probeQs.join(' / '));
check('table: the generic whole beside its parts ("Microbes" beside "Microbial RNA") is not asked', !probeQs.includes('Grow|Microbes'), probeQs.join(' / '));
check('table: a shared modifier leaves the head to ask, and the head alone is right', probeQs.includes('Amplify|Microbial RNA') &&
  tt.tables(probes, {}).find((q) => q.answer === 'Microbial RNA').accept.includes('rna'), probeQs.join(' / '));
check('table: modifier and head both its own ("Carrier antibodies", "Stained bodies") are not asked', !probeQs.includes('Titer|Carrier antibodies') && !probeQs.includes('Smear|Stained bodies'), probeQs.join(' / '));
const hostsQs = asked(grid('hosts', ['Worm', 'Final host', 'First host'], [
  ['Tapeworm alpha', 'Grazers', 'Beetle'], ['Tapeworm beta', 'Goats, Sheep, Deer', 'Beetle'], ['Fluke gamma', 'Dogs, Cats', 'Snail'],
  ['beta (Taeniidae)', 'Pigs, Boars', 'Mite'],
]));
check('table: a plural class where the column lists members is not asked', !hostsQs.includes('Tapeworm alpha|Grazers'), hostsQs.join(' / '));
check('table: a singular value beside lists is asked', hostsQs.includes('Fluke gamma|Snail'), hostsQs.join(' / '));
check('table: a row named by a fragment ("beta (Taeniidae)") is not asked', !hostsQs.some((x) => /^beta/.test(x)), hostsQs.join(' / '));
const bones = asked(grid('bones', ['Site', 'Tissue'], [['Shaft', 'Compact bone'], ['End', 'Spongy bone'], ['Joint', 'Hyaline cartilage']]));
check('table: a shared head leaves the modifier to ask ("Compact bone")', bones.includes('Shaft|Compact bone'), bones.join(' / '));

// "Defined" questions: a generic head the definition does not name is the student's to choose.
check('generic head: a head the scope uses for many things', shape.genericHead('limit error', 'A limit error stops the run. A parse error and a type error do not. Errors are reported.') === 'error' &&
  shape.genericHead('limit error', 'A limit error stops the run.') === '');
check('near words: real words of the scope one letter from the answer', JSON.stringify(shape.nearWords('Station', 'The stations and the statin differ.')) === JSON.stringify(['statin']));
check('alternatives in the answer itself are each right', JSON.stringify(shape.make({ question: 'q', answer: 'Inlet/intake' }).accept) === JSON.stringify(['Inlet', 'intake']));

// ---------------------------------------------------------------- numbers with their unit and subject
const doseCard = { front: 'Sedative X (doses)', back: '• Goats: 4-5 mg/kg\n• Cows: 8 mg/kg\n• Sheep: closer to cows', sourceKind: 'list', page: 4 };
const lineCard = { front: 'Pathogen Y — Survival', back: '• Survives 4-6 weeks in standing water\n• Dies within hours on dry steel\n• Lives about 3 days on soil', sourceKind: 'list', page: 5 };
const layout = rows.map((r) => ({ ...table(r[0], 'Row', 1, r[1], r), table: { ...table(r[0], 'Row', 1, r[1], r).table, key: 'layout', header: ['Fluid', 'Row'] } }));
check('table: a header naming a part of a table is not asked typed', tt.tables(layout, {}).length === 0);
const clipped = rows.map((r) => ({ ...table(r[0], 'Cont.', 1, r[1], r), table: { ...table(r[0], 'Cont.', 1, r[1], r).table, key: 'clipped', header: ['Fluid', 'Cont.'] } }));
check('table: a clipped header is not asked typed', tt.tables(clipped, {}).length === 0);
const vagueCard = { front: 'Epidural — Small ruminants', back: '• Goats: 1 ml / 15 lb', sourceKind: 'list', page: 4 };
check('number: a labelled value under a front that names no quantity is not asked', tv.numbers([vagueCard], { specific: () => true }).length === 0);
const numbers = tv.numbers([doseCard, lineCard], { specific: () => true });
check('number: a labelled line is asked with its label', numbers.some((q) => q.question === 'Sedative X (doses) — Goats: type the value with its unit.' && q.answer === '4-5 mg/kg'), show(numbers));
check('number: a line without a number is not asked', !numbers.some((q) => /Sheep/.test(q.question)), show(numbers));
check('number: one value blanked in its own line', numbers.some((q) => /Survives ________ in standing water/.test(q.question) && q.answer === '4-6 weeks'), show(numbers));
check('number: an approximate value is not asked', !numbers.some((q) => /soil/.test(q.question)), show(numbers));
const goats = numbers.find((q) => q.answer === '4-5 mg/kg');
check('number: the checker takes the range in other forms', goats && tc.check(goats, '4 to 5 mg per kg').correct && !tc.check(goats, '4-5 g/kg').correct);

// ---------------------------------------------------------------- worked answers, computed and checked independently
const rule = (kind, extra) => ({ front: `${kind} rule`, back: 'rule', page: 9, rule: { kind, page: 9, statement: 'The rule.', ...extra } });
const worked = tv.worked([
  rule('bitwise', { ops: [{ op: 'and', word: 'AND' }, { op: 'or', word: 'OR' }, { op: 'xor', word: 'XOR' }] }),
  rule('count', { what: 'rows' }),
], { seed: 0, variant: 0 });
const bitQ = worked.find((q) => q.form === 'bits');
const m = bitQ && bitQ.question.match(/bitwise (AND|OR|XOR) of the bit strings ([01]+) and ([01]+)/);
const f = { AND: (x, y) => x & y, OR: (x, y) => x | y, XOR: (x, y) => x ^ y };
const want = m ? [...m[2]].map((c, i) => f[m[1]](+c, +m[3][i])).join('') : '';
check('worked: a bit string computed right', bitQ && bitQ.answer === want, bitQ && `${bitQ.question} => ${bitQ.answer} (want ${want})`);
const countQ = worked.find((q) => /rows/.test(q.question));
const n = countQ ? Number(countQ.question.match(/of (\d+) variables/)[1]) : 0;
check('worked: a count computed right and outside the choice sizes', countQ && countQ.answer === String(2 ** n) && ![3, 4, 5].includes(n), countQ && countQ.question);

// ---------------------------------------------------------------- the quiz of a synthetic section
const SECTION = [
  'Fluid Machines',
  'A pump is a machine that moves fluid from a low pressure region to a high pressure region by mechanical action.',
  'A rotating part that transfers energy from the shaft to the fluid inside the casing is called an impeller.',
  'The impeller is mounted on a shaft that is turned by an electric motor or an engine.',
  'A valve controls the rate of flow of fluid in a pipe by opening or closing a passage.',
  'The pressure drop across a partly open valve depends on the flow rate and on the valve opening.',
  'Engineers often call a small device that measures pressure a gauge.',
  'A manometer is an instrument that measures pressure with a column of liquid.',
  'The manometer reading is written in pascals or in millimetres of mercury.',
  'A compressor is a machine that raises the pressure of a gas by reducing its volume.',
  'The compressor and the pump both add energy to a fluid, but only the compressor works on a gas.',
  'A turbine is a machine that takes energy out of a moving fluid and turns a shaft.',
  'The turbine and the pump are built alike, but the turbine runs the other way round.',
  'Cavitation is the formation of vapour bubbles in a liquid where the local pressure falls below the vapour pressure.',
  'Cavitation damages the impeller of a pump and lowers its efficiency.',
  'A pipe network that returns its fluid to the pump is called a closed loop.',
  'A closed loop needs a tank that takes up the change in fluid volume as the fluid warms.',
].join('\n');
const quiz = S.quizEngine.generateQuiz(SECTION, { maxQuestions: 10, mode: 'book' });
const typed = quiz.filter((q) => q.type === 'typed');
check('section: the quiz asks some typed questions', typed.length >= 1, show(quiz));
check('section: a typed term answer is 1-4 words', typed.every((q) => q.form !== 'term' || String(q.answer).split(/\s+/).length <= 4), show(typed));
check('section: no typed question from a hedged sentence', !typed.some((q) => /often|gauge/.test(q.question)), show(typed));
check('section: a typed answer is never printed in its prompt', typed.every((q) => !new RegExp(`\\b${q.answer}\\b`, 'i').test(q.question.replace(/_{4,}/g, ''))), show(typed));
check('section: the checker takes every typed answer, in capitals and with an article', typed.every((q) => tc.check(q, `the ${String(q.answer).toUpperCase()}`).correct), show(typed));
check('section: the checker refuses every other term of the scope', typed.every((q) => q.others.every((o) => !tc.check(q, o).correct)), show(typed));
check('section: a typed question carries its source and page', typed.every((q) => q.source && q.explanation && q.factKey), show(typed));
const keys = quiz.map((q) => q.factKey);
const sources = quiz.map((q) => String(q.source || '').toLowerCase());
check('section: no fact twice in one set', new Set(keys).size === keys.length, keys.join(' | '));
check('section: a typed question shares its source with no other question', typed.every((q) => sources.filter((s) => s === String(q.source).toLowerCase()).length === 1), show(quiz));
check('section: typed questions are not self-graded', S.quizAssembly.isSelfGraded(typed[0] || { type: 'typed', options: [] }) === false);

// The practice test grades typed answers through the checker; "I was right" counts as right.
const test = S.testEngine.generateTest(SECTION, { maxQuestions: 10, mode: 'book' });
const typedTest = test.questions.filter((q) => q.type === 'typed');
const answers = Object.fromEntries(test.questions.map((q) => [q.id, q.type === 'reveal' ? 'got' : q.type === 'typed' ? { typed: ` ${q.answer}. ` } : q.answer]));
check('test: typed answers graded by the checker', S.testEngine.gradeTest(test, answers).percent === 100, show(test.questions));
if (typedTest.length) {
  const wrong = { ...answers, [typedTest[0].id]: { typed: 'zzz' } };
  const overridden = { ...answers, [typedTest[0].id]: { typed: 'zzz', override: true } };
  check('test: a wrong typed answer is missed, "I was right" counts it', S.testEngine.gradeTest(test, wrong).score === test.total - 1 && S.testEngine.gradeTest(test, overridden).score === test.total);
}

// A missed typed question is stored whole (doc-state.js), so "Retry the ones you missed" checks it the same way after a reload.
const ds = nlp('doc-state.js');
if (brine) {
  const stored = JSON.parse(JSON.stringify(ds.plainQuestion(brine)));
  check('stored: a typed question keeps what its check reads', stored.type === 'typed' && stored.form === 'term' && Array.isArray(stored.others) && stored.source === brine.source);
  check('stored: the check gives the same verdicts after a reload', tc.check(stored, 'vat').correct && tc.check(stored, 'Drum').verdict === 'other');
}
const state = ds.empty();
ds.addOverride(state, { questionKey: 'q1', source: 's', answer: 'Vat', typed: 'cask' }, 1);
ds.addOverride(state, { questionKey: 'q1', source: 's', answer: 'Vat', typed: 'barrel' }, 2);
check('stored: "I was right" is kept once per question for review', state.overrides.length === 1 && state.overrides[0].typed === 'barrel' && ds.upgrade({}).overrides.length === 0);

console.log(`typed questions: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

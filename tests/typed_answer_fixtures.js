/**
 * Typed answers (Node): the checker (src/nlp/typed-check.js) on hand-made questions. Every case states what a
 * student typed and whether the app must take it; all text is synthetic.
 * Run: node tests/typed_answer_fixtures.js
 */
const path = require('path');

globalThis.window = globalThis;
const tc = require(path.join(__dirname, '..', 'src', 'nlp', 'typed-check.js'));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
const term = (answer, extra = {}) => ({ type: 'typed', form: 'term', answer, accept: [], others: [], ...extra });
/** expect: true (right), 'spelled', or a verdict that is not right ('other', 'shown', 'unit', 'wrong', 'empty'). */
function expectCheck(q, typed, expect) {
  const r = tc.check(q, typed);
  const ok = expect === true ? r.correct && r.verdict === 'right'
    : expect === 'spelled' || expect === 'qualified' ? r.correct && r.verdict === expect
      : !r.correct && r.verdict === expect;
  check(`${q.answer} <- "${typed}"`, ok, JSON.stringify(r));
}

// ---------------------------------------------------------------- terms: case, punctuation, articles, hyphens, plurals
const valve = term('Pressure valve', { others: ['Pressure gauge', 'Relief valve', 'Flow meter'] });
expectCheck(valve, 'pressure valve', true);
expectCheck(valve, 'PRESSURE VALVE.', true);
expectCheck(valve, '"the pressure valve"', true);
expectCheck(valve, 'a pressure-valve', true);
expectCheck(valve, 'pressurevalve', true);
expectCheck(valve, 'pressure valves', true);
expectCheck(valve, '  Pressure   valve!  ', true);
expectCheck(valve, '', 'empty');
expectCheck(valve, 'valve', 'wrong');
expectCheck(valve, 'pressure gauge', 'other');
expectCheck(valve, 'relief valves', 'other');
const latch = term('Latch', { others: ['Flip-flop'] });
expectCheck(latch, 'latches', true);
expectCheck(latch, 'flip flop', 'other');
expectCheck(latch, 'flipflops', 'other');
expectCheck(term("Kirchhoff's law"), 'Kirchhoffs law', true);
expectCheck(term('Indices'), 'index', true); // -ix / -ices

// ---------------------------------------------------------------- one edit for words of 6+ letters
const membrane = term('Membrane', { others: ['Mitochondrion'] });
expectCheck(membrane, 'membrne', 'spelled'); // deletion
expectCheck(membrane, 'memmbrane', 'spelled'); // insertion
expectCheck(membrane, 'membrame', 'spelled'); // substitution
expectCheck(membrane, 'mebmrane', 'spelled'); // transposition
expectCheck(membrane, 'mebrne', 'wrong'); // two edits
check('spelled message names the answer', tc.check(membrane, 'membrne').message === 'Correct — spelled Membrane.', tc.check(membrane, 'membrne').message);
expectCheck(term('Valve'), 'valv', 'wrong'); // 5 letters: no slip forgiven
expectCheck(term('Synapse'), 'synaps', 'spelled');
// A slip that is as close to another term is not forgiven.
const station = term('Station', { others: ['Ration'] });
expectCheck(station, 'station', true);
expectCheck(station, 'sation', 'wrong'); // one edit from both
expectCheck(station, 'statoin', 'spelled');
expectCheck(station, 'ration', 'other');
// The other term itself is never accepted, even one edit from the answer.
expectCheck(term('Encoder', { others: ['Decoder'] }), 'decoder', 'other');

// ---------------------------------------------------------------- a qualifier more, and roman numerals after "type"
const rel = term('Relation', { others: ['Function', 'Cartesian product'] });
expectCheck(rel, 'binary relation', 'qualified');
expectCheck(rel, 'binary relation from set B', 'wrong'); // more than two words more
expectCheck(rel, 'not a relation', 'wrong'); // a negating word
expectCheck(term('Key', { others: ['Candidate key'] }), 'primary candidate key', 'wrong'); // holds another term
expectCheck(term('Integrated circuits', { others: ['Logic gates'] }), 'ICs', 'qualified');
expectCheck(term('Data integrity constraint', { others: ['Domain constraint'] }), 'data integrity', 'qualified');
expectCheck(term('Candidate key', { others: ['Composite key'] }), 'CK', 'wrong'); // both read "CK"
expectCheck(term('Hernia type 1', { others: ['Hernia type 2'] }), 'hernia type I', true);
expectCheck(term('Hernia type 1', { others: ['Hernia type 2'] }), 'hernia type II', 'other');

// ---------------------------------------------------------------- abbreviation or expansion when the source gives both
const ar = term('Address register', { accept: ['AR'], others: ['Data register'] });
expectCheck(ar, 'AR', true);
expectCheck(ar, 'ar', true);
expectCheck(ar, 'address registers', true);
expectCheck(ar, 'DR', 'wrong');
// A form the prompt already prints is not taken as the answer.
expectCheck(term('Antecedent', { shown: ['premise'] }), 'premise', 'shown');

// ---------------------------------------------------------------- numbers: numeric, unit optional but must match
const dose = { type: 'typed', form: 'number', answer: '4–5 mg/kg' };
expectCheck(dose, '4-5 mg/kg', true);
expectCheck(dose, '4 to 5 mg/kg', true);
expectCheck(dose, '4 – 5', true);
expectCheck(dose, '4-5 mg per kg', true);
expectCheck(dose, '4-5 milligrams/kilogram', true);
expectCheck(dose, '4-5 g/kg', 'unit');
expectCheck(dose, '4 mg/kg', 'wrong');
expectCheck(dose, '5-4 mg/kg', 'wrong');
const days = { type: 'typed', form: 'number', answer: '14 days' };
expectCheck(days, '14', true);
expectCheck(days, '14 d', true);
expectCheck(days, '14.0 days', true);
expectCheck(days, '14 weeks', 'unit');
expectCheck(days, 'fourteen', true); // a number word is the number
expectCheck(days, '2 weeks', true); // converts exactly
expectCheck(days, '336 hours', true);
expectCheck(days, '2 months', 'wrong'); // months do not convert
expectCheck(dose, '0.004-0.005 g/kg', true);
expectCheck({ type: 'typed', form: 'number', answer: '8wks' }, '56 days', true);
const ratio = { type: 'typed', form: 'number', answer: '1 ml / 15 lb' };
expectCheck(ratio, '1 ml per 15 lb', true);
expectCheck(ratio, '1ml/15lbs', true);
expectCheck(ratio, '1', 'unit');
expectCheck({ type: 'typed', form: 'number', answer: '1,500 m' }, '1500 m', true);
check('parseNumber reads a range', JSON.stringify(tc.parseNumber('10–14 days')) === JSON.stringify({ lo: 10, hi: 14, unit: 'd' }), JSON.stringify(tc.parseNumber('10–14 days')));

// ---------------------------------------------------------------- bit strings and truth values
expectCheck({ type: 'typed', form: 'bits', answer: '100110' }, '100110', true);
expectCheck({ type: 'typed', form: 'bits', answer: '100110' }, '10 01 10', true);
expectCheck({ type: 'typed', form: 'bits', answer: '100110' }, '100111', 'wrong');
const tv = { type: 'typed', form: 'truth', answer: 'F', accept: ['false'] };
expectCheck(tv, 'F', true);
expectCheck(tv, 'false', true);
expectCheck(tv, 'True', 'wrong');

// ---------------------------------------------------------------- symbols: keyboard forms
const contra = { type: 'typed', form: 'expression', answer: '$\\neg y \\to \\neg x$', symbols: { not: ['!', '~', 'not'] } };
expectCheck(contra, '¬y → ¬x', true);
expectCheck(contra, '~y -> ~x', true);
expectCheck(contra, '!y->!x', true);
expectCheck(contra, 'not y -> not x', true);
expectCheck(contra, 'y -> x', 'wrong');
// Without the section defining "~" as negation, "~" is not read as ¬.
expectCheck({ ...contra, symbols: {} }, '~y -> ~x', 'wrong');
expectCheck({ ...contra, symbols: {} }, '¬y->¬x', true);
const bar = { type: 'typed', form: 'expression', answer: '$\\overline{A} + B$' };
expectCheck(bar, "A' + B", true);
expectCheck(bar, "A'+B", true);
expectCheck(bar, 'A + B', 'wrong');

// ---------------------------------------------------------------- a letter that is meaning is never a slip
const kind1 = term('Morrow type 1', { others: ['Gland', 'Morrow type 2'] });
expectCheck(kind1, 'Morrow type 2', 'other');
expectCheck(term('Morrow type 1'), 'Morrow type 2', 'wrong'); // a digit, even with no sibling term in the scope
expectCheck(term('Morrow type 1'), 'Morrow type II', 'wrong'); // a roman numeral
expectCheck(term('Morrow type 1'), 'Morrows type 3', 'wrong');
expectCheck(term('Morrow type 1'), "Morrow's type one", true); // a number word after the kind word
expectCheck(term('Morrow type 1'), 'Morrow 1', 'qualified'); // the kind word left out
expectCheck(term('Morrow type 1', { others: ['Morrow class 1'] }), 'Morrow 1', 'wrong'); // ... unless another term reads so too
expectCheck(term('First-order reaction'), 'second order reaction', 'wrong'); // an ordinal
expectCheck(term('First-order reaction'), '1st order reaction', true);
expectCheck(term('Gamma radiation'), 'delta radiation', 'wrong');
expectCheck(term('Theta rhythm'), 'zeta rhythm', 'wrong'); // a Greek letter's name, one letter apart
expectCheck(term('Atypical lymphocyte'), 'typical lymphocyte', 'wrong'); // a negating prefix
expectCheck(term('Ionized calcium'), 'unionized calcium', 'wrong');
expectCheck(term('Marker CD4+'), 'Marker CD4-', 'wrong'); // a sign
expectCheck(term('Marker CD4+'), 'marker cd4+', true);
expectCheck(term('Vitamin A'), 'vitamin', 'wrong'); // the letter is the name
expectCheck(term('Vitamin A'), 'vitamin B', 'wrong');
// The slip may not itself be a real word of the scope.
const lather = term('Gradient', { checks: { near: ['gradients', 'radient'] } });
expectCheck(lather, 'gradiant', 'spelled');
expectCheck(lather, 'radient', 'wrong');
expectCheck(term('Contrecoup'), 'contra-coup', 'spelled'); // one or two words, one letter apart
// A head noun alone is not the answer when the modifier tells it apart.
expectCheck(term('Knee cartilage', { others: ['Ear cartilage'] }), 'cartilage', 'wrong');
expectCheck(term('Knee cartilage'), 'cartilage', 'wrong');

// ---------------------------------------------------------------- forms of the same word, by rule
expectCheck(term('Plasma'), 'plasmata', true); // -a / -ata
expectCheck(term('Stratum'), 'strata', true); // -um / -a
expectCheck(term('Coccus'), 'cocci', true); // -us / -i
expectCheck(term('Hypothesis'), 'hypotheses', true); // -is / -es
expectCheck(term('Matrix'), 'matrices', true); // -ix / -ices
expectCheck(term('Larvae'), 'larva', true); // -a / -ae
expectCheck(term('Phenomenon'), 'phenomena', true); // -on / -a
expectCheck(term('Basis'), 'base', 'wrong'); // a singular is not another singular
expectCheck(term('Update anomaly', { others: ['Removal anomaly'] }), 'updating anomaly', true); // derivation of a modifier
expectCheck(term('Insertion anomaly', { others: ['Removal anomaly'] }), 'insert anomaly', true);
expectCheck(term('Insertion anomaly', { others: ['Removal anomaly'] }), 'removal anomaly', 'other');
expectCheck(term('Insertion anomaly'), 'insertion anomalies', true);
expectCheck(term('Erythema migrans'), 'migrans erythema', 'wrong'); // word order matters ...
expectCheck(term('Lichen sclerosus'), 'sclerous lichen', true); // ... except a Latin adjective in its English place
expectCheck(term('Tinea capitica'), 'capitic tinea', true);
expectCheck(term('Capitic tinea'), 'tinea capitica', true);
// Run of words as initials, kind word, CamelCase, function words in a qualifier.
const ric = term('Range integrity constraint', { others: ['Value integrity constraint'] });
expectCheck(ric, 'RI constraint', 'qualified');
expectCheck(ric, 'range integrity', 'qualified'); // a term of 3+ words without its last
expectCheck(term('Range integrity constraint', { others: ['Rank integrity constraint'] }), 'RI constraint', 'wrong'); // both read "RI constraint"
const limitErr = term('limit error', { others: ['buffer index'], checks: { looseHead: true } });
expectCheck(limitErr, 'buffer index out of limit error', 'qualified'); // "of", "out" join; "buffer index" sits beside the answer
expectCheck(limitErr, 'index out of limit', 'qualified'); // the generic head left out
expectCheck(limitErr, 'BufferIndexOutOfLimitError', 'qualified'); // an identifier written as one word
expectCheck(term('limit error', { others: ['buffer index'] }), 'index out of limit', 'wrong'); // no generic head: not dropped
expectCheck(limitErr, 'limit', 'wrong'); // the bare modifier is not the answer
expectCheck(term('Value integrity constraint', { checks: { looseHead: true } }), 'value integrity', 'qualified');
expectCheck(term('limit error'), 'no limit error', 'wrong');
const abs = term('Carrier antibodies', { accept: ['antibodies'], others: ['Carrier antigen'] });
expectCheck(abs, 'anti-K9 antibodies', 'qualified'); // "anti-" names the target of an antibody
expectCheck(abs, 'K9 antibodies', 'qualified');
expectCheck(abs, 'antigen', 'wrong');
expectCheck(term('Relation'), 'anti relation', 'wrong'); // elsewhere "anti" negates
// A string with no characters, written as quotes.
expectCheck(term('empty string', { others: ['Null reference'] }), '""', true);
expectCheck(term('empty string'), "''", true);
expectCheck(term('Null reference', { others: ['empty string'] }), '""', 'other');

// ---------------------------------------------------------------- numbers: words, counts, powers, required units
const weeks8 = { type: 'typed', form: 'number', answer: '8wks', question: 'Drug: type the missing value with its unit.\n"Not effective before ________ post-infection"' };
expectCheck(weeks8, 'eight weeks', true);
expectCheck(weeks8, '8 weeks', true);
expectCheck(weeks8, '8', 'unit'); // the prompt asks for the unit
expectCheck(weeks8, '56 days', true);
expectCheck(weeks8, 'two months', 'wrong'); // months never convert to weeks
expectCheck({ type: 'typed', form: 'number', answer: '8 weeks', question: 'How long is the course?' }, '8', true); // no unit asked: a bare number
const pct = { type: 'typed', form: 'number', answer: '85%', question: 'Group — Signs: type the missing value with its unit.\n"________ of animals show no signs"' };
expectCheck(pct, 'eighty-five percent', true);
expectCheck(pct, 'Eighty five %', true);
expectCheck(pct, 'fifteen percent', 'wrong');
expectCheck(pct, '85', 'unit');
const rows = { type: 'typed', form: 'number', answer: '128', question: 'How many rows does the truth table of a function of 7 variables have? Type the number.' };
expectCheck(rows, '128 rows', true); // the counted noun the prompt names
expectCheck(rows, '2^7', true);
expectCheck(rows, '2**7', true);
expectCheck(rows, '2⁷', true);
expectCheck(rows, 'one hundred and twenty-eight', true);
expectCheck(rows, '128 columns', 'unit');
expectCheck(rows, '2^6', 'wrong');
expectCheck(rows, '64 rows', 'wrong');
expectCheck({ type: 'typed', form: 'number', answer: '1 year' }, '12 months', true); // exact calendar conversion
expectCheck({ type: 'typed', form: 'number', answer: '18 months' }, '1.5 years', true);
expectCheck({ type: 'typed', form: 'number', answer: '1 year' }, '52 weeks', 'wrong'); // a year is not a whole number of weeks
expectCheck({ type: 'typed', form: 'number', answer: '5 days' }, 'two and three days', 'wrong'); // never a sum
check('number words', tc.parseNumber('ninety-five percent').lo === 95 && tc.parseNumber('one thousand two hundred').lo === 1200 && tc.parseNumber('a dozen') === null,
  JSON.stringify(tc.parseNumber('one thousand two hundred')));
expectCheck({ type: 'typed', form: 'bits', answer: '111000' }, '0b111000', true); // a binary prefix
expectCheck({ type: 'typed', form: 'bits', answer: '111000' }, '0b11 1000', true);
expectCheck({ type: 'typed', form: 'bits', answer: '111000' }, '0x38', 'wrong');

// ---------------------------------------------------------------- hints
check('hints name the form', tc.hintFor(valve) === 'One term' && tc.hintFor(dose) === 'A number with its unit' &&
  tc.hintFor({ form: 'number', answer: '12' }) === 'A number' && tc.hintFor(tv) === 'T or F', [tc.hintFor(valve), tc.hintFor(dose)].join(' / '));

console.log(`typed answers: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * Review scheduling and flashcard export fixtures (Node): the four-answer scheduler, and the Anki
 * and Quizlet serialisers (headers, math delimiters, escaping, tags, edits in / deleted out).
 * Run: node tests/review_export_fixtures.js
 */
const path = require('path');
const nlp = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));

const R = nlp('review-schedule.js');
const X = nlp('deck-export.js');
const D = nlp('doc-state.js');
const K = nlp('study-keys.js');
const M = nlp('deck-merge.js');
const SC = nlp('slide-cards.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const DAY = 86400000;
const noon = new Date(2026, 10, 18, 12, 0, 0).getTime(); // 18 Nov 2026, local time
const midnight = (days) => new Date(2026, 10, 18 + days, 0, 0, 0).getTime();

// 1. Scheduler: new cards, the 1 -> 6 -> x ease ladder, lapses, ease bounds
check('a card never answered is due', R.isDue(null, noon) && R.isDue(undefined, noon) && R.isDue(R.fresh(), noon), '');
let s = R.answer(null, 'good', noon);
check('first good: 1 day, due at local midnight', s.interval === 1 && s.reps === 1 && s.due === midnight(1) && s.ease === 2.5 && s.last === noon, JSON.stringify(s));
check('not due today, due tomorrow', !R.isDue(s, noon + 6 * 3600000) && R.isDue(s, midnight(1)), '');
s = R.answer(s, 'good', midnight(1) + 3600000);
check('second good: 6 days', s.interval === 6 && s.reps === 2 && s.due === midnight(7), JSON.stringify(s));
s = R.answer(s, 'good', midnight(7));
check('third good: interval x ease', s.interval === 15 && s.reps === 3, JSON.stringify(s));
const beforeLapse = s;
s = R.answer(s, 'again', midnight(22));
check('again: back in today\'s queue, reps reset, a lapse counted, ease down', s.interval === 0 && s.reps === 0 && s.lapses === 1 && s.ease === 2.3 && s.due === midnight(22) && R.isDue(s, midnight(22)), JSON.stringify(s));
check('answer() does not modify its input', beforeLapse.interval === 15 && beforeLapse.reps === 3, '');
check('again on a new card is not a lapse', R.answer(null, 'again', noon).lapses === 0, '');
const hard = R.answer({ ...R.fresh(), reps: 3, interval: 10, ease: 2.5, last: 1 }, 'hard', noon);
const good = R.answer({ ...R.fresh(), reps: 3, interval: 10, ease: 2.5, last: 1 }, 'good', noon);
const easy = R.answer({ ...R.fresh(), reps: 3, interval: 10, ease: 2.5, last: 1 }, 'easy', noon);
check('hard < good < easy', hard.interval === 12 && good.interval === 25 && easy.interval > good.interval && hard.ease === 2.35 && easy.ease === 2.65, `${hard.interval} ${good.interval} ${easy.interval}`);
check('easy on a new card: 4 days', R.answer(null, 'easy', noon).interval === 4 && R.answer(null, 'hard', noon).interval === 1, '');
let low = R.fresh();
for (let i = 0; i < 12; i++) low = R.answer(low, 'again', noon);
check('ease never drops below 1.3', low.ease === 1.3, String(low.ease));
let far = R.fresh();
for (let i = 0; i < 12; i++) far = R.answer(far, 'easy', noon);
check('intervals are capped at a year', far.interval === 365, String(far.interval));
check('an interval always grows on a pass', R.answer({ ...R.fresh(), reps: 5, interval: 1, ease: 1.3, last: 1 }, 'hard', noon).interval === 2, '');
let threw = false;
try { R.answer(null, 'perfect', noon); } catch (_e) { threw = true; }
check('unknown answers are rejected', threw, '');
const pv = R.preview(null);
check('preview for a new card', pv.again === 0 && pv.hard === 1 && pv.good === 1 && pv.easy === 4, JSON.stringify(pv));
check('interval labels', R.intervalLabel(0) === 'today' && R.intervalLabel(1) === '1d' && R.intervalLabel(21) === '3w' && R.intervalLabel(200) === '7mo', '');
check('next due skips cards that are due or new', R.nextDue([null, R.fresh(), { last: 1, due: noon - 1 }, { last: 1, due: noon + 3 * DAY }, { last: 1, due: noon + DAY }], noon) === noon + DAY && R.nextDue([null], noon) === 0, '');
check('day labels', R.dayLabel(midnight(1) - 1, noon) === 'today' && R.dayLabel(midnight(1), noon) === 'tomorrow' && R.dayLabel(midnight(3), noon) === 'on 21 Nov', R.dayLabel(midnight(3), noon));
check('short date adds the year when it differs', R.shortDate(new Date(2026, 10, 12).getTime(), noon) === '12 Nov' && R.shortDate(new Date(2025, 0, 5).getTime(), noon) === '5 Jan 2025', '');

// 2. Anki export: headers, math delimiters, escaping, tags
const cards = [
  { front: 'Derivative of $x^2$', back: '$$\\frac{d}{dx} x^2 = 2x$$\nPower rule.', context: 'Slide 3: Power rule', category: 'Formula' },
  { front: 'When is a < b & b < c?', back: 'Then a < c\t(transitivity) "always"', context: 'Section 1.2' },
  { front: 'Steps', back: '• one\n• two', category: 'Algorithm' },
];
const tsv = X.ankiTsv(cards, { docName: 'CS 201 Notes.pdf' });
const lines = tsv.trimEnd().split('\n');
check('anki header lines', lines[0] === '#separator:tab' && lines[1] === '#html:true' && lines[2] === '#columns:Front\tBack\tTags' && lines[3] === '#tags column:3', lines.slice(0, 4).join(' / '));
check('one row per card, three columns each', lines.length === 7 && lines.slice(4).every((l) => l.split('\t').length === 3), String(lines.length));
check('inline math becomes \\( \\)', lines[4].split('\t')[0] === 'Derivative of \\(x^2\\)', lines[4]);
check('display math becomes \\[ \\] and newlines <br>', lines[4].split('\t')[1] === '\\[\\frac{d}{dx} x^2 = 2x\\]<br>Power rule.', lines[4]);
check('no dollar delimiters are left', !/\$/.test(tsv), tsv);
check('fields are HTML-escaped, tabs flattened', lines[5].split('\t')[0] === 'When is a &lt; b &amp; b &lt; c?' && lines[5].split('\t')[1] === 'Then a &lt; c (transitivity) &quot;always&quot;', lines[5]);
check('tags: suite, document, topic', lines[4].split('\t')[2] === 'StudySuite CS_201_Notes Slide_3:_Power_rule' && lines[5].split('\t')[2] === 'StudySuite CS_201_Notes Section_1.2' && lines[6].split('\t')[2] === 'StudySuite CS_201_Notes Algorithm', lines.slice(4).map((l) => l.split('\t')[2]).join(' / '));
check('existing \\( \\) is left alone', X.mathToAnki('\\(a\\) and $b$') === '\\(a\\) and \\(b\\)', X.mathToAnki('\\(a\\) and $b$'));
check('a lone dollar sign is not math', X.mathToAnki('costs $5 today') === 'costs $5 today', '');
check('empty deck still has headers', X.ankiTsv([], {}) === '#separator:tab\n#html:true\n#columns:Front\tBack\tTags\n#tags column:3\n', '');
check('slide-cards export is a thin call', SC.exportAnkiTsv(cards, { docName: 'CS 201 Notes.pdf' }) === tsv, '');

// 3. Quizlet CSV: term,definition; quoted when needed; never a line break inside a card
const csv = X.quizletCsv(cards, { plain: (t) => String(t).replace(/\$/g, '') });
const rows = csv.trimEnd().split('\n');
check('csv: one line per card', rows.length === 3, csv);
check('csv: plain math text and flattened lines', rows[0] === 'Derivative of x^2,\\frac{d}{dx} x^2 = 2x; Power rule.', rows[0]);
check('csv: quotes and commas are quoted', rows[1] === 'When is a < b & b < c?,"Then a < c (transitivity) ""always"""' && X.csvField('a, b') === '"a, b"', rows[1]);
check('csv: list backs stay on one line', rows[2] === 'Steps,• one; • two', rows[2]);
check('csv: empty deck is empty', X.quizletCsv([], {}) === '', '');
check('file stem', X.fileStem('Chapter 2 (notes).pdf') === 'Chapter_2_notes' && X.fileStem('') === 'flashcards', X.fileStem('Chapter 2 (notes).pdf'));

// 4. Export follows the merged deck: edits in, deleted out, own cards in
const generated = [{ id: 'fc-1', front: 'Heap', back: 'A tree.', context: 'p. 3' }, { id: 'fc-2', front: 'Stack', back: 'LIFO.', context: 'p. 4' }];
const state = D.empty();
const scope = { id: 's', startPage: 1, endPage: 9 };
D.setEdit(state, K.cardKey(generated[0]), { front: 'Heap', back: 'A complete binary tree with ordered keys.', scope });
D.setMark(state, K.cardKey(generated[1]), 'deleted', true);
D.addUserCard(state, { front: 'Mine', back: 'My answer', scope, created: 1 });
const out = X.ankiTsv(M.mergeDeck(generated, state, scope).cards, { docName: 'Doc.pdf' });
check('export includes edits and own cards, excludes deleted', /complete binary tree/.test(out) && /Mine\tMy answer\tStudySuite Doc Your_card/.test(out) && !/Stack/.test(out) && !/A tree\./.test(out), out);

console.log(`review_export_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

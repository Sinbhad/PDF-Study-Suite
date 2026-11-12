/**
 * UI render & study-view fixtures (Node): verifies math-renderer, rich-text, rich-blocks (scripts,
 * lists, tables), the image-free summary, flashcard faces/kinds, quiz/practice-test option indexing,
 * reveal questions & grading, and STEM demo-data.
 * Run: node tests/ui_render_fixtures.js
 */
const path = require('path');
const ui = (f) => require(path.join(__dirname, '..', 'src', 'ui', f));

const mr = ui('math-renderer.js');
const rt = ui('rich-text.js');
const rb = ui('rich-blocks.js');
const sv = ui('study-views.js');
const sum = ui('summary-view.js');
const ff = ui('flashcard-faces.js');
const qc = ui('quiz-card.js');
const tr = ui('test-report.js');
const tv = ui('test-view.js');
const sp = ui('study-pipeline.js');
const demo = ui('demo-data.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
const noRawTags = (html) => !/<(?!\/?(?:span|i|b|strong|sup|sub|div|br|code|pre|article|section|header|aside|details|summary|h[1-6]|p|ul|ol|li|dl|dt|dd|button|table|caption|thead|tbody|tr|th|td)\b)[^>]*>/.test(html);

// 1. Stacked fractions (TeX \frac + algebraic / inside math) & digit vs numerator class separation
let h = mr.renderMath('\\frac{f(x)}{g(x)} + 2x', true);
check('frac stacks', /math-frac/.test(h) && /math-num/.test(h) && /math-den/.test(h), h);
check('digit not math-num', /<span class="math-digit">2<\/span>/.test(h), h);
check('display wrapper', /^<div class="math math-display"/.test(h), h);
h = mr.renderMath('T(n/2) + (f(x+h) - f(x))/h + dy/dx', false);
check('slash fractions stack in math', (h.match(/math-frac/g) || []).length === 3, h);
h = mr.renderMath('x \\in [0, 1) \\cup (a, b)', false);
check('intervals stay flat', !/math-frac/.test(h) && h.includes('[') && h.includes(')'), h);

// 2. Limits, big operators & integrals (stacked in display, crisp sub/sup inline)
h = mr.renderMath('\\lim_{x \\to c} f(x) = L', true);
check('lim stacked in display', /math-limits/.test(h) && /math-under/.test(h) && h.includes('→'), h);
h = mr.renderMath('\\lim_{x \\to c} f(x)', false);
check('lim sub inline', /<sub class="math-sub">/.test(h) && !/math-limits/.test(h), h);
h = mr.renderMath('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', true);
check('sum over/under display', /math-over/.test(h) && /math-under/.test(h) && h.includes('∑'), h);
h = mr.renderMath('\\int_{a}^{b} f(x)\\,dx = F(b) - F(a)', true);
check('int bounds & minus', h.includes('∫') && /math-supsub/.test(h) && h.includes('−'), h);

// 3. Radicals with vinculum + root index
h = mr.renderMath('\\sqrt[3]{x^{2}+4}', false);
check('sqrt index + radicand', /math-root-index/.test(h) && /math-radicand/.test(h) && /math-sup/.test(h), h);

// 4. Escaping: inequalities and CS generics NEVER corrupt HTML or vanish as tags
h = mr.renderMath('0 < |x - c| < \\delta', false);
check('lt escaped in math', (h.match(/<span class="math-op">&lt;<\/span>/g) || []).length === 2 && noRawTags(h), h);
h = rt.render('Use ArrayList<Integer> when x < y and a > 0.');
check('lt escaped in prose', h.includes('ArrayList&lt;Integer&gt;') && h.includes('x &lt; y'), h);
h = rt.render('`Map<K, V>` holds <script>alert(1)</script>');
check('no script injection', !/<script/i.test(h) && h.includes('&lt;script&gt;'), h);

// 5. Typography: italic vars, upright functions, primes, cases, matrices
h = mr.renderMath("f'(x) + \\sin x + \\arcsec y - 1", false);
check('fn upright + prime + vars italic', /math-fn">sin/.test(h) && /math-fn">arcsec/.test(h) && h.includes('′') && /<i class="math-var">x<\/i>/.test(h), h);
h = mr.renderMath('f(x) = \\begin{cases} x^2 & if x \\ge 0 \\\\ -x & otherwise \\end{cases}', true);
check('cases grid + words', /math-cases/.test(h) && (h.match(/math-row/g) || []).length === 2 && /math-text">otherwise/.test(h), h);
h = mr.renderMath('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', true);
check('pmatrix', /math-pmatrix/.test(h) && (h.match(/math-cell/g) || []).length === 4, h);

// 6. Rich text: delimiters, **bold** (including across inline $..$ & stray **), bare TeX, recurrences, Big-O, pseudocode
h = rt.render('**Squeeze Theorem**: $\\frac{dy}{dx}$ and $$\\int_0^1 x\\,dx = \\frac{1}{2}$$ done.');
check('bold + inline + display', h.includes('<strong>Squeeze Theorem</strong>') && !h.includes('**') && /math-inline/.test(h) && /math-display/.test(h), h);
h = rt.render('**Use the $n$th-Term Test** when **continuous at $c$** or stray **');
check('bold across inline math + orphan ** stripped', /^<strong>Use the <span class="math math-inline"[\s\S]*?>th-Term Test<\/strong>/.test(h) && !h.includes('**') && (h.match(/<strong>/g) || []).length === (h.match(/<\/strong>/g) || []).length, h);
h = rt.render('Merge sort runs in O(n log n) time and T(n) = 2T(n/2) + O(n).');
check('recurrence + big-O', /aria-label="T\(n\) = 2T\(n\/2\) \+ O\(n\)"/.test(h) && /math-frac/.test(h) && /math-fn">log/.test(h), h);
h = rt.render('```\nfor i = 1 to n do\n    if A[i] < key then\n        return i // found\n```');
check('code block indent + kw + comment', /code-block/.test(h) && /code-kw">for/.test(h) && h.includes('    ') && /code-comment/.test(h) && h.includes('&lt; key'), h);
check('my_var untouched', !/math/.test(rt.render('set my_var to 3')), rt.render('set my_var to 3'));

// 7. Malformed TeX resilience
['\\frac{1}{', '\\sqrt', '{{{', '\\unknownmacro x', '$$', '^_^', ''].forEach((t) => {
  let out = '';
  try { out = rt.render(t) + mr.renderMath(t, true); } catch (e) { out = `THREW ${e.message}`; }
  check(`robust ${JSON.stringify(t)}`, !/THREW/.test(out) && noRawTags(out), out);
});

// 8. Summary view: single-column blocks, visible math, NO page images (even when a block carries a bbox)
const fakeBox = { innerHTML: '', querySelectorAll: () => [] };
sum.renderSummaryView(fakeBox, {
  keyFormulas: [{ title: 'Chain Rule', formula: "\\frac{d}{dx}[f(g(x))] = f'(g(x))g'(x)" }, { category: 'Definition', title: '', body: '' }],
  didacticBlocks: [
    { category: 'Theorem', title: 'Theorem 1.9 — Squeeze Theorem', body: 'If $h(x) \\le f(x) \\le g(x)$, then $$\\lim_{x \\to c} f(x) = L$$', formulas: ['\\lim_{x \\to c} f(x) = L'], bbox: { page: 88, top: 100, bottom: 180 } },
    { category: 'Theorem', title: 'Theorem 1.2 — Properties of Limits', body: 'Let $b$ be real.\n1. Scalar multiple: $bL$\n2. Sum: $L + K$\n3. Product: $LK$\nA proof is in Appendix A.' },
    { category: 'Formula', title: 'Power Rule', body: 'For real $n$:', formulas: ['\\frac{d}{dx}[x^{n}] = nx^{n-1}'] },
    { category: 'Definition', title: 'Definition of Limit', body: 'For each $\\varepsilon > 0$ there exists $\\delta > 0$ with $0 < |x - c| < \\delta$.' },
    { category: 'Definition', title: '   ', body: '' },
  ],
  definitions: [{ term: 'inverse relation', definition: 'The relation R^(-1) from B to A', page: 3 }, { term: '', definition: '' }],
  keyTerms: ['Squeeze Theorem', '$O(n \\log n)$', ''],
  sentences: ['Direct substitution of $\\frac{0}{0}$ requires factoring.'],
  slideBreakdown: [
    { slideNumber: 6, title: 'Which of the Following is Symmetric? R_2 and R_3', kind: 'question', pages: [6, 7, 8], takeaways: ['R_1 = {(a, b) | a ≤ b}'], qa: { question: 'Which contain (1,1)?', answer: 'R_1 and R_3' } },
    { slideNumber: 27, title: 'Truth table', kind: 'table', table: { rows: [['x', 'y', 'x^2 + y'], ['0', '1', '1']] } },
    { slideNumber: 9, title: '', takeaways: ['', '  '] },
  ],
}, '1.3 Evaluating Limits');
const sumHtml = fakeBox.innerHTML;
check('summary has no page images or snippets', !/<img|<canvas|pdf-snippet|snippet/.test(sumHtml) && /data-jump-page="88"/.test(sumHtml) && sumHtml.includes('&lt;'), sumHtml.slice(0, 300));
check('no duplicate blk.formulas when already in blk.body', (sumHtml.match(/aria-label="\\lim_\{x \\to c\} f\(x\) = L"/g) || []).length === 1 && sumHtml.includes('nx^{n-1}'), sumHtml);
check('theorem body lists are real <ol>', /<p>Let [\s\S]*?<\/p><ol><li>Scalar multiple[\s\S]*?<\/li><li>Sum[\s\S]*?<\/li><li>Product[\s\S]*?<\/li><\/ol><p>A proof/.test(sumHtml), sumHtml);
check('empty blocks, terms and slides are dropped', (sumHtml.match(/class="dblock /g) || []).length === 4 && (sumHtml.match(/class="term"/g) || []).length === 2 && (sumHtml.match(/<article class="slide/g) || []).length === 2 && (sumHtml.match(/class="def"/g) || []).length === 1, sumHtml);
check('definitions list + superscript', /<dl class="deflist">[\s\S]*<dt>inverse relation<\/dt>[\s\S]*<sup class="math-sup">/.test(sumHtml), sumHtml);
check('slide group label, subscript title, qa reveal, table', sumHtml.includes('Slides 6\u20138') && /slide-title"[^>]*>[\s\S]*?<sub class="math-sub">/.test(sumHtml) && /<details class="reveal">[\s\S]*class="answer"/.test(sumHtml) && /<table class="data-table"><thead><tr><th scope="col">x<\/th>/.test(sumHtml) && !/R_1|R_2|x\^2/.test(sumHtml.replace(/aria-label="[^"]*"|title="[^"]*"/g, '')), sumHtml);

// 8b. Rich blocks: scripts in titles, paragraphs, ordered / lettered / bulleted lists, inline enumerations, guards
h = rb.title('Which are Symmetric? R_2 and R^(-1), x^2').html;
check('title scripts render', (h.match(/<sub class="math-sub">/g) || []).length === 1 && (h.match(/<sup class="math-sup">/g) || []).length === 2 && !/[_^]/.test(h.replace(/aria-label="[^"]*"/g, '')), h);
const longTitle = rb.title(`${'Very long heading '.repeat(30)} $x^2$`, 80);
check('absurd titles truncate, full text kept', longTitle.html.includes('\u2026') && longTitle.html.length < 400 && longTitle.full.length > 400, longTitle.html);
h = rb.block('First paragraph.\nSecond paragraph.');
check('newlines become paragraphs', h === '<p>First paragraph.</p><p>Second paragraph.</p>', h);
h = rb.block('Key points:\n\u2022 one\n\u2022 two\n(a) alpha\n(b) beta');
check('bullets and lettered lists', /<p>Key points:<\/p><ul><li>one<\/li><li>two<\/li><\/ul><ol class="alpha"><li>alpha<\/li><li>beta<\/li><\/ol>/.test(h), h);
h = rb.block('Let $f$ be a function. 1. Scalar multiple 2. Sum or difference 3. Product');
check('inline enumeration split defensively', /<p>Let [\s\S]*<\/p><ol><li>Scalar multiple<\/li><li>Sum or difference<\/li><li>Product<\/li><\/ol>/.test(h), h);
h = rb.block('Version 1. is old and $x = 1. 2$ stays, see p. 2 for more');
check('prose with stray numbers is not a list', !/<ol>/.test(h), h);
h = rb.block('Before $$a\n= b$$ after');
check('display math may span lines', /math-display/.test(h) && !/\$/.test(h), h);
check('garbage and empty text render nothing', rb.block('') === '' && rb.block(' \n \u2022 \n') === '' && rb.inline('---') === '' && rb.table([]) === '' && rb.table([['', ' ']]) === '', rb.block(' \n \u2022 \n'));
check('ornamental slide bullets are stripped', !/\u2727|\u2726/.test(rb.inline('\u2727 Examples \u2726 of relations')), rb.inline('\u2727 Examples'));

// 9. Flashcard faces & kinds: math on BOTH front and back, list backs, kind badges/filters, no images
check('fc kinds', ff.kindOf({ kind: 'formula' }) === 'formula' && ff.kindOf({ category: 'Algorithm' }) === 'algorithm' && ff.kindOf({ category: 'Theorem' }) === 'theorem' && ff.kindOf({ kind: 'qa' }) === 'qa' && ff.kindOf({ kind: 'concept' }) === 'concept' && ff.kindOf({ kind: 'definition', category: 'Slide Overview' }) === 'overview', '');
const fcHtml = ff.faces({ front: 'Derivative of $\\tan x$', back: '$$\\frac{d}{dx}[\\tan x] = \\sec^{2} x$$', category: 'Formula', context: 'Ch 2', bbox: { page: 2, top: 40, bottom: 90 } });
check('fc math front & back, no crop', /fc-front[\s\S]*math-inline/.test(fcHtml) && /fc-back[\s\S]*math-display/.test(fcHtml) && !/<img|snippet/.test(fcHtml), fcHtml);
const fcList = ff.faces({ front: 'Key points of "Relations"?', back: '\u2022 R_1 = {(1, 1)}\n\u2022 R^(-1) is the inverse', kind: 'overview', context: 'Slide 3' });
check('fc list back + overview badge', /fc-back[\s\S]*<ul><li>[\s\S]*<sub class="math-sub">[\s\S]*<\/li><li>[\s\S]*<sup class="math-sup">/.test(fcList) && />Overview<\/span>/.test(fcList), fcList);
const chips = ff.filterChips('all', [{ kind: 'qa', front: 'a', back: 'b' }, { kind: 'definition', front: 'a', back: 'b' }, { kind: 'definition', front: 'c', back: 'd' }], 3);
check('fc filter chips follow the kinds present', /Definitions 2/.test(chips) && /Questions 1/.test(chips) && !/Theorems|Formulas/.test(chips) && /All 3/.test(chips), chips);
check('fc empty cards are invalid', !ff.isValid({ front: 'Q', back: ' ' }) && !ff.isValid({ front: '', back: 'A' }) && ff.isValid({ front: 'Q', back: 'A' }), '');

// 10. Quiz & Practice Test: indexed options with TeX/quotes/<, testEngine contract & grading
const qSample = {
  id: 'q1', skill: 'formula', badge: 'Formula', pageNumber: 143,
  question: 'What is $\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right]$ when $g(x) \\ne 0$?',
  options: [
    "$\\frac{g(x)f'(x) - f(x)g'(x)}{[g(x)]^{2}}$",
    "$\\frac{f'(x)g(x) + f(x)g'(x)}{g(x)}$",
    '$0 < |x - c| < \\delta$',
    '"quoted" option',
  ],
  answer: "$\\frac{g(x)f'(x) - f(x)g'(x)}{[g(x)]^{2}}$",
  explanation: 'By the **Quotient Rule**, square $g(x)$ in the denominator.',
};
const qcHtml = qc.questionCard(qSample, 1, { picked: 1, reveal: true, locked: true });
check('quiz card renders math in stem, ALL options & explanation', (qcHtml.match(/data-opt-idx="/g) || []).length === 4 && (qcHtml.match(/math-frac/g) || []).length >= 3 && qcHtml.includes('&lt;') && qcHtml.includes('data-jump-page="143"'), qcHtml);
check('quiz options carry letter keys and text state labels', />A<\/span>/.test(qcHtml) && />D<\/span>/.test(qcHtml) && /is-correct[\s\S]*?>Correct<\/span>/.test(qcHtml) && /is-wrong[\s\S]*?>Your answer<\/span>/.test(qcHtml) && /Not quite/.test(qcHtml), qcHtml);

// 10b. Reveal questions: no options, "Show answer", then self-grading that feeds the score
const rv = { id: 'r1', type: 'reveal', question: 'Is R_1 reflexive?\nProve or disprove.', answer: '1. Take x in Z\n2. Then xRx', explanation: 'Worked on slide 23.', page: 23 };
check('reveal validity', qc.isReveal(rv) && qc.isValid(rv) && !qc.isValid({ id: 'x', question: 'No answer', type: 'reveal' }) && !qc.isValid({ id: 'y', question: '', options: ['a', 'b'], answer: 'a' }), '');
let rvHtml = qc.questionCard(rv, 2, { reveal: false, locked: false });
check('reveal hides the answer behind a button', /data-show-qid="r1"/.test(rvHtml) && !/class="answer"/.test(rvHtml) && !/data-opt-idx/.test(rvHtml) && /<sub class="math-sub">/.test(rvHtml), rvHtml);
rvHtml = qc.questionCard(rv, 2, { reveal: false, locked: false, shown: true });
check('reveal shows answer list + self-grade + page jump', /class="answer"[\s\S]*<ol><li>/.test(rvHtml) && /data-grade="got"/.test(rvHtml) && /data-grade="missed"/.test(rvHtml) && /data-jump-page="23"/.test(rvHtml), rvHtml);
check('reveal grading', qc.isCorrect(rv, 'got') && !qc.isCorrect(rv, 'missed') && !qc.isCorrect(rv, undefined) && qc.isCorrect(qSample, 0) && !qc.isCorrect(qSample, 'got'), '');

const normTest = tv._normalize({ title: 'Ch 2 Exam', sections: [{ name: 'Derivatives', questions: [qSample] }], total: 1 }, 'Ch 2');
check('test normalize + count', normTest.sections.length === 1 && sp.testQuestionCount(normTest.raw) === 1, '');
const gradeOk = tr.grade(normTest.raw, [qSample], { q1: 0 });
const gradeMiss = tr.grade(normTest.raw, [qSample], { q1: 2 });
const mixed = tv._normalize({ sections: [{ name: 'Mixed', questions: [qSample, rv, { id: 'bad', question: 'broken' }] }] }, 'Ch 2');
const gradeMixed = tr.grade(mixed.raw, mixed.sections[0].questions, { q1: 0, r1: 'got' });
check('test keeps reveal questions, drops broken ones, self-grade scores', mixed.sections[0].questions.length === 2 && tv.count(mixed.raw, 'Ch 2') === 2 && gradeMixed.score === 2 && tr.grade(mixed.raw, mixed.sections[0].questions, { q1: 0, r1: 'missed' }).missed.length === 1, '');
check('test grading + missed tracking', gradeOk.score === 1 && gradeOk.percent === 100 && gradeMiss.score === 0 && gradeMiss.missed.length === 1 && gradeMiss.bySkill.formula.total === 1, '');

// 11. Demo data: CS Algorithms slides + Calculus textbook
const ds = demo.createDemoSlidesPdf();
const db = demo.createDemoBookPdf();
const dsText = ds.pages.flatMap((p) => p.lines.map((l) => l.text)).join(' ');
const dbText = db.pages.flatMap((p) => p.lines.map((l) => l.text)).join(' ');
check('demo STEM content', ds.numPages === 4 && db.numPages === 4 && dsText.includes('O(n \\log n)') && dbText.includes('\\frac'), '');

console.log(`ui_render_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

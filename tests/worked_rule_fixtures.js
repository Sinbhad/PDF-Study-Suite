/**
 * Worked rules (Node): the checkable rules a textbook section teaches (section-rules.js and the modules it reads
 * with), the cards made from them (rule-cards.js, advice-cards.js, syntax-cards.js, condition-cards.js,
 * code-cards.js) and the worked questions keyed by computation (worked-questions.js and its builders).
 * Every key a builder produces from the synthetic sections below is checked again here by an independent
 * computation (hand-written truth functions, bit arithmetic, set membership), never by the module that made it.
 * All text is synthetic. Run: node tests/worked_rule_fixtures.js
 */
const path = require('path');

globalThis.window = globalThis;
const src = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
for (const f of ['tokenizer.js', 'math-text.js', 'stem-distractors.js', 'card-fields.js', 'page-lines.js', 'book-sections.js',
  'summary-statements.js', 'book-formulas.js', 'boxed-cards.js']) {
  try { src(f); } catch (_e) { /* a helper a module loads on demand */ }
}
const le = src('logic-eval.js');
const ce = src('code-expr.js');
const lt = src('logic-tables.js');
const sr = src('section-rules.js');
const rc = src('rule-cards.js');
const wq = src('worked-questions.js');
const advice = src('advice-cards.js');
const syntax = src('syntax-cards.js');
const conditions = src('condition-cards.js');
const code = src('code-cards.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// ---------------------------------------------------------------- independent truth functions
const TRUTH = { and: (a, b) => a && b, or: (a, b) => a || b, xor: (a, b) => a !== b, imp: (a, b) => !a || b, iff: (a, b) => a === b };
const TEX_OP = { '\\wedge': 'and', '\\vee': 'or', '\\oplus': 'xor', '\\to': 'imp', '\\leftrightarrow': 'iff' };
const ROWS = [[true, true], [true, false], [false, true], [false, false]];
const col = (f) => ROWS.map(([p, q]) => f(p, q));
const letters = (vals, t = 'T', f = 'F') => vals.map((v) => (v ? t : f)).join(', ');

// ---------------------------------------------------------------- logic-eval against hand-written tables
const colOf = (src0, style) => le.column(le.parse(src0, { style }), ['p', 'q']);
for (const [op, tex] of [['and', 'p \\wedge q'], ['or', 'p \\vee q'], ['xor', 'p \\oplus q'], ['imp', 'p \\to q'], ['iff', 'p \\leftrightarrow q']]) {
  check(`logic-eval: column of ${tex}`, JSON.stringify(colOf(tex, 'prop')) === JSON.stringify(col(TRUTH[op])), JSON.stringify(colOf(tex, 'prop')));
}
check('logic-eval: Unicode and TeX read alike', le.sameTree(le.parse('p ∧ ¬q', { style: 'prop' }), le.parse('p \\wedge \\neg q', { style: 'prop' })));
check('logic-eval: ∧ binds tighter than ∨', le.sameTree(le.parse('p ∨ q ∧ r', { style: 'prop' }), le.parse('p ∨ (q ∧ r)', { style: 'prop' })));
check('logic-eval: ∨ binds tighter than →', le.sameTree(le.parse('p ∨ q → r', { style: 'prop' }), le.parse('(p ∨ q) → r', { style: 'prop' })));
check('logic-eval: a word is not an expression', le.parse('and', { style: 'prop' }) === null && le.parse('p and q', { style: 'prop' }) === null);
const b = (s) => le.parse(s, { style: 'bool' });
check('logic-eval: XY is X AND Y', JSON.stringify(le.column(b('XY'), ['X', 'Y'])) === JSON.stringify([true, false, false, false]));
check('logic-eval: overline and prime are complements', le.equivalent(b("X'"), b('\\overline{X}')) && le.equivalent(b('X + \\overline{X}'), b('1')));
check('logic-eval: DeMorgan holds, its misreading does not', le.equivalent(b('\\overline{X + Y}'), b('\\overline{X} \\cdot \\overline{Y}')) && !le.equivalent(b('\\overline{X + Y}'), b('\\overline{X} + \\overline{Y}')));
check('logic-eval: a damaged command is refused', b('\\mathcal{P}(S)') === null && b('X_{1} + \\cdots + X_{n}') === null);
check('logic-eval: renders the way books print', le.render(b('(X + Y)(X + Z)'), 'bool') === '(X + Y)(X + Z)' && le.render(le.parse('(p ∨ ¬q) → (p ∧ q)', { style: 'prop' }), 'prop') === '(p \\vee \\neg q) \\to (p \\wedge q)');

// ---------------------------------------------------------------- code-expr
check('code-expr: == with arithmetic', ce.evaluate('3 == 5 - 2') === true && ce.evaluate('4 != 2 + 2') === false);
check('code-expr: <= and >=', ce.evaluate('4 <= 4') === true && ce.evaluate('3 >= 7') === false);
check('code-expr: integer division truncates', ce.evaluate('7 / 2 == 3') === true);
check('code-expr: a single = between values is an error', ce.evaluate('3 = 6 / 2') === 'error');
check('code-expr: decimals and names are not judged', ce.evaluate('1.0 / 3.0 == 0.333') === null && ce.evaluate('x > 1') === null);

// ---------------------------------------------------------------- logic-tables
const tables = [
  { header: ['p', 'q', 'p ∧ q', 'p', 'q', 'p ∨ q'], rows: [['T', 'T', 'T', 'T', 'T', 'T'], ['T', 'F', 'F', 'T', 'F', 'T'], ['F', 'T', 'F', 'F', 'T', 'T'], ['F', 'F', 'F', 'F', 'F', 'F']], pageNumber: 4 },
  // a damaged row: the printed column disagrees with → in its last row, so → is not taken from this table
  { header: ['p', 'q', 'p → q'], rows: [['T', 'T', 'T'], ['T', 'F', 'F'], ['F', 'T', 'T'], ['F', 'F', 'F']], pageNumber: 5 },
  // an incomplete table (a row lost) checks nothing
  { header: ['p', 'q', 'p ⊕ q'], rows: [['T', 'T', 'F'], ['T', 'F', 'T'], ['F', 'T', 'T']], pageNumber: 5 },
];
const cols = lt.columns(tables);
check('logic-tables: side-by-side tables both checked', cols.some((c) => c.header === 'p ∧ q') && cols.some((c) => c.header === 'p ∨ q'), cols.map((c) => c.header).join(' | '));
check('logic-tables: a column that disagrees is dropped', !cols.some((c) => c.header === 'p → q'));
check('logic-tables: an incomplete table is dropped', !cols.some((c) => c.header === 'p ⊕ q'));
const defBlocks = [
  { kind: 'definition', title: 'Definition 3', body: 'Let $p$ and $q$ be statements. The joint denial of $p$ and $q$, denoted by $p \\oplus q$, is true when exactly one of $p$ and $q$ holds and false otherwise.', pageNumber: 6 },
  { kind: 'definition', title: 'Definition 4', body: 'Let $A$ and $B$ be collections. The pairing of $A$ and $B$, denoted by $A \\times B$, is the collection of all ordered pairs.', pageNumber: 7 },
];
const defs = lt.definitions(defBlocks);
check('logic-tables: a definition box with "denoted by" and a truth sentence teaches its operator', defs.length === 1 && defs[0].op === 'xor', JSON.stringify(defs.map((d) => d.op)));

// ---------------------------------------------------------------- a synthetic logic section, end to end
const LOGIC_TEXT = [
  '**2.1 Statements and Connectives**',
  '',
  'We combine statements with connectives. In a table every pair of values gets its own row.',
  '',
  'We write the statement $q \\to p$ and call it by a name. The proposition $q \\to p$ is called the **converse** of $p \\to q$. The **contrapositive** of $p \\to q$ is the proposition $\\neg q \\to \\neg p$. The proposition $\\neg p \\to \\neg q$ is called the **inverse** of $p \\to q$.',
  '',
  'By convention conjunction is applied first, so that $p \\vee q \\wedge r$ means $p \\vee (q \\wedge r)$ rather than $(p \\vee q) \\wedge r$. Arrows come last: $p \\vee q \\to r$ means $(p \\vee q) \\to r$ rather than $p \\vee (q \\to r)$.',
  '',
  'Strings of zeros and ones are handled bit by bit. We define the **bitwise** OR, **bitwise AND**, and **bitwise XOR** of two strings of equal length to be the strings whose bits are the OR, AND, and XOR of the corresponding bits. We use the symbols ∨, ∧, and ⊕ to represent the bitwise OR, bitwise AND, and bitwise XOR operations, respectively.',
].join('\n');
const LOGIC_TABLES = [
  tables[0],
  { header: ['p', 'q', 'p ⊕ q', 'p', 'q', 'p → q'], rows: [['T', 'T', 'F', 'T', 'T', 'T'], ['T', 'F', 'T', 'T', 'F', 'F'], ['F', 'T', 'T', 'F', 'T', 'T'], ['F', 'F', 'F', 'F', 'F', 'T']], pageNumber: 6 },
  { header: ['p', 'q', 'p ↔ q'], rows: [['T', 'T', 'T'], ['T', 'F', 'F'], ['F', 'T', 'F'], ['F', 'F', 'T']], pageNumber: 7 },
];
const LOGIC_BLOCKS = [
  { kind: 'definition', title: 'Definition 1', body: 'Let $p$ be a statement. The denial of $p$, denoted by $\\neg p$, has the opposite of the truth value of $p$.', pageNumber: 3 },
  { kind: 'definition', title: 'Definition 2', body: 'Let $p$ and $q$ be statements. The meet of $p$ and $q$, denoted by $p \\wedge q$, is true when both are true and is false otherwise.', pageNumber: 4 },
  ...LOGIC_TABLES.map((t) => ({ ...t, kind: 'table' })),
];
/** Extraction-style lines for a synthetic text: each line on a page, four lines to a page from `first`. */
const linesOf = (text, first) => text.split('\n').map((t, i) => ({ text: t, pageNumber: first + Math.floor(i / 4), kind: 'prose' })).filter((l) => l.text);
const logicRules = sr.read({ text: LOGIC_TEXT, blocks: LOGIC_BLOCKS, tables: LOGIC_TABLES, lines: linesOf(LOGIC_TEXT, 3), startPage: 3 });
check('section-rules: operators from tables and boxes', ['and', 'or', 'xor', 'imp', 'iff', 'not'].every((o) => logicRules.operators.ops.has(o)), [...logicRules.operators.ops.keys()].join(','));
check('section-rules: the three related conditionals', logicRules.forms.map((f) => f.name).sort().join() === 'contrapositive,converse,inverse', JSON.stringify(logicRules.forms.map((f) => f.name)));
check('section-rules: precedence examples agree with the parser', logicRules.precedence && logicRules.precedence.examples.length === 2);
check('section-rules: bitwise ops with their symbols', logicRules.bitwise && logicRules.bitwise.ops.map((o) => `${o.word}${o.symbol}`).sort().join() === 'AND∧,OR∨,XOR⊕', JSON.stringify(logicRules.bitwise));
check('section-rules: no 2^n rule where none is stated', logicRules.counts.length === 0);

const logicCards = rc.fromRules(logicRules);
check('rule-cards: a row card per operator', logicCards.filter((c) => c.rule.kind === 'operator').length === 6);
const condCard = logicCards.find((c) => c.rule.kind === 'operator' && c.rule.op === 'imp');
check('rule-cards: the row that sets → apart, keyed False', condCard && /\$p\$ true, \$q\$ false/.test(condCard.front) && /^False\./.test(condCard.back), condCard && `${condCard.front} => ${condCard.back}`);

/** Checks every worked question of a set by an independent computation; returns how many were checked. */
function verifyLogic(questions) {
  let n = 0;
  for (const q of questions) {
    const label = `${q.factKey}: ${q.question}`;
    check(`worked: answer among options (${q.factKey})`, q.options.includes(q.answer) && new Set(q.options).size === q.options.length && q.options.length >= 3, label);
    check(`worked: explanation names a page (${q.factKey})`, /\(p\. \d+\)/.test(q.explanation), q.explanation);
    if (q.factKey.startsWith('w|operator-row|')) {
      const m = q.question.match(/\$p\$ is (true|false) and \$q\$ is (true|false), which proposition is (true|false)/);
      const [p, qq, want] = [m[1] === 'true', m[2] === 'true', m[3] === 'true'];
      const value = (opt) => {
        const tex = opt.replace(/\$/g, '');
        if (/^\\neg p$/.test(tex)) return !p;
        const op = TEX_OP[tex.split(' ')[1]];
        return TRUTH[op](p, qq);
      };
      check(`worked row: key (${label})`, value(q.answer) === want && q.options.filter((o) => o !== q.answer).every((o) => value(o) !== want), q.options.join(' / '));
      n++;
    } else if (q.factKey.startsWith('w|operator-column|')) {
      const op = TEX_OP[q.factKey.split('|')[2].split(' ')[1]];
      check(`worked column: key (${label})`, q.answer === letters(col(TRUTH[op])), q.answer);
      n++;
    } else if (q.factKey.startsWith('w|operator-unique|')) {
      const op = TEX_OP[q.factKey.split('|')[2].split(' ')[1]];
      const want = /\btrue\?$/.test(q.question);
      const m = q.answer.match(/p = ([TF]),\\ q = ([TF])/);
      const at = [m[1] === 'T', m[2] === 'T'];
      const others = ROWS.filter((r) => r[0] !== at[0] || r[1] !== at[1]);
      check(`worked unique row: key (${label})`, TRUTH[op](...at) === want && others.every((r) => TRUTH[op](...r) !== want), q.answer);
      n++;
    } else if (q.factKey.startsWith('w|operator-compound|')) {
      // "(p OP1 q) OP2 \neg x": evaluated here with the hand-written functions
      const m = q.factKey.match(/^w\|operator-compound\|\(p (\\[a-z]+) q\) (\\[a-z]+) \\neg ([pq])$/);
      const f = (p, qq) => TRUTH[TEX_OP[m[2]]](TRUTH[TEX_OP[m[1]]](p, qq), !(m[3] === 'p' ? p : qq));
      check(`worked compound: key (${label})`, m && q.answer === letters(col(f)), `${q.factKey} -> ${q.answer}`);
      n++;
    } else if (q.factKey.startsWith('w|bitwise|')) {
      const m = q.question.match(/bitwise (AND|OR|XOR) of the bit strings ([01]+) and ([01]+)/);
      const f = { AND: (x, y) => x & y, OR: (x, y) => x | y, XOR: (x, y) => x ^ y }[m[1]];
      const want = [...m[2]].map((c, i) => f(Number(c), Number(m[3][i]))).join('');
      check(`worked bitwise: key (${label})`, q.answer === want, `${q.answer} vs ${want}`);
      n++;
    } else if (q.factKey.startsWith('w|form|')) {
      const name = q.factKey.split('|')[2];
      const expected = { converse: '$s \\to r$', contrapositive: '$\\neg s \\to \\neg r$', inverse: '$\\neg r \\to \\neg s$' }[name];
      check(`worked form: key (${label})`, /\$r \\to s\$/.test(q.question) && q.answer === expected, q.answer);
      n++;
    } else if (q.factKey.startsWith('w|form-equivalent|')) {
      check(`worked equivalence: key (${label})`, q.answer === '$\\neg s \\to \\neg r$', q.answer);
      n++;
    } else if (q.factKey.startsWith('w|precedence|')) {
      const expected = {
        '$r \\vee s \\wedge t \\vee u$': '$r \\vee (s \\wedge t) \\vee u$',
        '$r \\wedge s \\vee t \\wedge u$': '$(r \\wedge s) \\vee (t \\wedge u)$',
        '$r \\vee s \\to t \\vee u$': '$(r \\vee s) \\to (t \\vee u)$',
      }[(q.question.match(/\$[^$]+\$/) || [''])[0]];
      check(`worked precedence: key (${label})`, q.answer === expected, q.answer);
      n++;
    }
  }
  return n;
}
let logicChecked = 0;
for (const [seed, variant] of [[0, 0], [0, 1], [3, 0], [5, 1]]) logicChecked += verifyLogic(wq.build(logicCards, { seed, variant }));
check('worked: every kind of logic question was built and checked', logicChecked >= 30, `${logicChecked} checked`);
check('worked: no → chain in a precedence question (its grouping is a convention the examples do not show)',
  !wq.build(logicCards, { seed: 1, variant: 1 }).some((q) => /\\to [a-z] \\vee [a-z] \\to/.test(q.question)));

// ---------------------------------------------------------------- a synthetic algebra section
const ALGEBRA_TEXT = [
  '**3.4 Switching Algebra Rules**',
  '',
  'Every rule below holds for any value of the variable, which can be checked by trying both values.',
  '',
  '1. $A + 0 = A$',
  '2. $A \\cdot 1 = A$',
  '3. $A + \\overline{A} = 1$',
  '4. $A \\cdot \\overline{A} = 0$',
  '5. $\\overline{\\overline{A}} = A$',
  '6. $A(B + C) = AB + AC$',
  '7. $\\overline{A + B} = \\overline{A} \\cdot \\overline{B}$',
  '8. $A + B = B + A$',
  '',
  'Rule 6, the distributive law, lets a product be multiplied out. Rules 3 and 4, the complement laws, pair a variable with its complement.',
  '',
  'A table for a function of n inputs needs one line for every input combination. The number of rows in a truth table is $2^{n}$, where $n$ is the number of variables in the function.',
].join('\n');
const algebra = sr.read({ text: ALGEBRA_TEXT, blocks: [], tables: [], lines: linesOf(ALGEBRA_TEXT, 12), startPage: 12 });
check('identity-rules: a numbered list read and checked', algebra.identities.length === 8, algebra.identities.map((i) => i.statement).join(' | '));
check('identity-rules: names given by number', algebra.identities.find((i) => i.number === 6).name === 'Distributive law' && algebra.identities.find((i) => i.number === 4).name === 'Complement law');
check('section-rules: the 2^n rule for truth-table rows', algebra.counts.length === 1 && algebra.counts[0].what === 'rows');
const broken = sr.read({ text: ALGEBRA_TEXT.replace('3. $A + \\overline{A} = 1$', '3. $A + A = 1$'), blocks: [], tables: [], lines: null, startPage: 12 });
check('identity-rules: an equation whose sides differ is dropped, not taught', !broken.identities.some((i) => i.number === 3) && broken.identities.length === 7);
const algebraCards = rc.fromRules(algebra);
check('rule-cards: no "simplify" card for a reordering', !algebraCards.some((c) => c.front === 'Simplify $A + B$.'));
let algebraChecked = 0;
for (const [seed, variant] of [[0, 0], [0, 1], [2, 0], [7, 1]]) {
  for (const q of wq.build(algebraCards, { seed, variant })) {
    check(`worked algebra: answer among distinct options (${q.factKey})`, q.options.includes(q.answer) && new Set(q.options).size === q.options.length, q.options.join(' / '));
    if (q.factKey.startsWith('w|identity|')) {
      const stem = b(q.question.match(/\$([^$]+)\$/)[1]);
      check(`worked identity: key equals the expression asked (${q.question})`, le.equivalent(b(q.answer.replace(/\$/g, '')), stem), q.answer);
      check(`worked identity: no wrong option equals it (${q.question})`, q.options.filter((o) => o !== q.answer).every((o) => !le.equivalent(b(o.replace(/\$/g, '')), stem)), q.options.join(' / '));
      algebraChecked++;
    } else if (q.factKey.startsWith('w|count-rows|')) {
      const n = Number(q.question.match(/of (\d+) variables/)[1]);
      check(`worked count: 2^n (${q.question})`, q.answer === String(2 ** n));
      algebraChecked++;
    }
  }
}
check('worked algebra: identity and count keys checked', algebraChecked >= 10, `${algebraChecked} checked`);
const deMorgan = wq.build(algebraCards, { seed: 0, variant: 0 }).find((q) => q.factKey.startsWith('w|identity|\\overline{A + B}'));
// The section's own letters are A, B, C: the instance takes the next free ones
check('worked identity: DeMorgan instance renamed and keyed', deMorgan && deMorgan.question === 'Which expression is equal to $\\overline{D + W}$?' && deMorgan.answer === '$\\overline{D}\\overline{W}$', deMorgan && `${deMorgan.question} ${deMorgan.answer}`);

// ---------------------------------------------------------------- sets and relational expressions
const SET_SENTENCES = [
  { text: 'The set $A$ is a subset of $B$ if and only if every element of $A$ is also an element of $B$.', page: 20 },
  { text: 'When $A$ is a subset of $B$ but $A \\ne B$, we say that $A$ is a **proper subset** of $B$.', page: 21 },
  { text: 'The power set of $S$ is the set of all subsets of $S$.', page: 22 },
];
const setCards = rc.fromRules({ sets: src('set-rules.js').read(SET_SENTENCES) });
check('set-rules: three set relations', setCards.length === 3, setCards.map((c) => c.front).join(' | '));
const parseSet = (tex) => tex.replace(/[$\\{}]/g, '').split(',').map((x) => x.trim()).filter(Boolean);
let setChecked = 0;
for (const [seed, variant] of [[0, 0], [1, 1], [4, 0]]) {
  for (const q of wq.build(setCards, { seed, variant })) {
    const base = parseSet(q.question.match(/\$\\\{[^$]+\\\}\$/)[0]);
    const sub = (x) => parseSet(x).every((e) => base.includes(e));
    const proper = (x) => sub(x) && parseSet(x).length < base.length;
    const test = q.factKey.startsWith('w|set-proper|') ? proper : sub;
    check(`worked sets: key (${q.question})`, test(q.answer) && q.options.filter((o) => o !== q.answer).every((o) => !test(o)), q.options.join(' / '));
    setChecked++;
  }
}
check('worked sets: questions checked', setChecked >= 9, `${setChecked}`);

const relTables = [
  { header: ['Code', 'Math', 'Description'], rows: [['>', '>', 'Greater than'], ['>=', '≥', 'At least'], ['<', '<', 'Less than'], ['<=', '≤', 'At most'], ['==', '=', 'Equal'], ['!=', '≠', 'Not equal']], pageNumber: 30 },
  { header: ['2 + 2 == 4', 'true', 'Both sides are four.'], rows: [['5 = 10 / 2', 'Error', 'Write == to compare.'], ['6 != 2 * 3', 'false', 'They are equal.']], pageNumber: 31 },
];
const relCards = rc.fromRules({ relational: sr.relational(relTables) });
check('relational: operator table and its error row', relCards.length === 2 && relCards[1].rule.assignmentError.expr === '5 = 10 / 2');
check('relational: a table whose rows disagree with the evaluator is not used', sr.relational([relTables[0], { ...relTables[1], header: ['2 + 2 == 5', 'true', 'x'] }]) === null);
let relChecked = 0;
for (const [seed, variant] of [[0, 0], [0, 1], [9, 0], [2, 1]]) {
  for (const q of wq.build(relCards, { seed, variant })) {
    const expr = q.question.match(/`([^`]+)`/)[1];
    const m = expr.match(/^(\d+) (>=|<=|==|!=|>|<|=) (\d+)(?: ([+\-*]) (\d+))?$/);
    const right = m[4] ? { '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y }[m[4]](Number(m[3]), Number(m[5])) : Number(m[3]);
    const left = Number(m[1]);
    const cmp = { '>=': left >= right, '<=': left <= right, '==': left === right, '!=': left !== right, '>': left > right, '<': left < right };
    const want = m[2] === '=' ? 'compile error' : String(cmp[m[2]]);
    check(`worked relational: key (${expr})`, q.answer === want, `${q.answer} vs ${want}`);
    relChecked++;
  }
}
check('worked relational: questions checked', relChecked >= 8, `${relChecked}`);

// ---------------------------------------------------------------- advice, syntax, condition and code cards
const notes = [
  ['Use the method size() to find how many items a list holds.', 'To find how many items a list holds, …', 'use the method size()'],
  ['When comparing two decimals, avoid exact equality. Instead, test whether they are within a tolerance.', 'When comparing two decimals, …', 'avoid exact equality; instead, test whether they are within a tolerance'],
  ['Do not use the + operator to join many strings. Use a builder instead.', 'To join many strings, …', 'use a builder, not the + operator'],
  ['Use a guard clause if the input may be empty.', 'When should you use a guard clause?', 'If the input may be empty'],
  ['Use a scratch slot when trading two items.', 'What should you use when trading two items?', 'Use a scratch slot'],
  ['Avoid magic numbers by naming every constant.', 'How do you avoid magic numbers?', 'By naming every constant'],
  ['A queue releases items in the order they arrived.', 'A queue releases …', 'items in the order they arrived'],
];
for (const [note, front, back] of notes) {
  const card = advice.cardsOfNote(note, () => null)[0];
  check(`advice-cards: "${note.slice(0, 30)}"`, card && card.front === front && card.back === back, card && `${card.front} => ${card.back}`);
}
check('advice-cards: a note about the page makes no card', advice.cardsOfNote('You might have trouble with this paragraph unless you read it twice.', () => null).length === 0);
const syn = syntax.fromBox('Lists `Syntax To create a list: new ArrayList<typeName>()` To read an item: listName.get(index) Name of the list');
check('syntax-cards: templates of a callout box', syn.length === 2 && syn[0].front === 'How do you create a list?' && syn[0].back === '`new ArrayList<typeName>()`' && /^Lists: how do you read an item\?$/.test(syn[1].front), JSON.stringify(syn));
const conds = conditions.fromText('A schedule is in balanced form if and only if $it is in draft form$ and no task is late. Two jobs share one slot in the plan. This condition is called a **slot clash**.');
check('condition-cards: an "if and only if" definition', conds[0] && conds[0].front === 'When is a schedule in balanced form?' && conds[0].back === 'If and only if it is in draft form and no task is late.', JSON.stringify(conds[0]));
check('condition-cards: "this condition is called" takes the sentence before', conds[1] && conds[1].front === 'Slot clash' && conds[1].back === 'Two jobs share one slot in the plan.', JSON.stringify(conds[1]));
const CODE_TEXT = [
  '**5.2 Common Loop Algorithms**', '', 'Here are some loops.', '',
  '**5.2.1 Counting**', '', 'This loop counts the positive values of an array.', '', '```', 'int count = 0;', 'for (int i = 0; i < data.length; i++)', '{', '  if (data[i] > 0) { count++; }', '}', '```', '',
  '**5.2.2 Doubling**', '', 'Each value is replaced by twice itself.', '', '```', 'for (int i = 0; i < data.length; i++)', '{', '  data[i] = 2 * data[i];', '}', '```', '',
  '**5.2.3 Reversing**', '', 'The first and last values trade places, then the next pair.', '', '```', 'for (int i = 0; i < data.length / 2; i++)', '{', '  int t = data[i]; data[i] = data[data.length - 1 - i]; data[data.length - 1 - i] = t;', '}', '```',
].join('\n');
const codeCards = code.fromScope({ text: CODE_TEXT, lines: null, startPage: 40 });
check('code-cards: a family of three listings', codeCards.length === 3 && codeCards[0].rule.name === 'Counting' && /This loop counts the positive values/.test(codeCards[0].back), JSON.stringify(codeCards.map((c) => c.back)));
check('code-cards: no family under an ordinary heading', code.fromScope({ text: CODE_TEXT.replace('Common Loop Algorithms', 'Arrays'), lines: null, startPage: 40 }).length === 0);

console.log(`worked_rule_fixtures: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

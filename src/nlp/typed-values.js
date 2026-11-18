/**
 * Typed Questions (values): short answers the student types and the app checks (typed-check.js), from
 *   table     one cell of a comparison table, under the table rules of table-questions.js (both headers named, the
 *             row value picks out one row); only a single value (no list, no remark) of 1-4 words or a number, never
 *             under a clipped header ("Maint.") or one that names a part of a table ("Row"); a cell's head noun alone
 *             is right too when no other value of its column ends in it ("DNA" for "Bacterial DNA")
 *   number    a labelled line that is nothing but a number with its unit ("Goats: 4-5 mg/kg" under "Lidocaine (toxic
 *             doses)", the front naming the quantity), or one number with its unit blanked in its own line ("Survives
 *             ________ in water"); the unit must be one the checker knows, and the front must name a specific subject
 *   worked    a rule of the section applied, the key computed (worked-questions.js reads the same rule cards):
 *             a bitwise operation on two bit strings, a 2^n count, the truth value of a two-operator expression
 * The typed instances never repeat a choice instance of the same rule (other bit strings, other sizes).
 *
 * tables(cards, ctx) / numbers(cards, ctx) / worked(cards, ctx) -> [question]
 *   ctx: { factOf(source), specific(subject), isDeck, seed, variant }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const tq = () => dep('tableQuestions', './table-questions.js');
  const tc = () => dep('typedCheck', './typed-check.js');
  const shape = () => dep('typedShape', './typed-shape.js');
  const le = () => dep('logicEval', './logic-eval.js');
  const sn = () => dep('stemNoise', './stem-noise.js');

  const MAX_ANSWER_WORDS = 4;
  const MAX_LABEL_WORDS = 4;
  const LIST_CELL_RE = /[,;/()]|\band\b|\bor\b|&/i;
  const TERM_CELL_RE = /^[A-Za-z][A-Za-z0-9 '’.-]*$/;
  const ABBREVIATED_HEADER_RE = /^[A-Z][a-z]{0,8}\.(?:\s|$)|\s\.\?*$|\.$/;
  const MIN_HEAD_CHARS = 3;
  const TABLE_WORD_RE = /^(?:tables?|rows?|columns?|cells?|entry|entries|items?|values?)$/i;
  // What a number is: the card's front must say it ("toxic doses", "Incubation period"), or the value means nothing.
  const QUANTITY_RE = /\b(?:doses?|dosages?|dosing|volumes?|rates?|durations?|times?|intervals?|half-?li(?:fe|ves)|temperatures?|concentrations?|counts?|numbers?|lengths?|weights?|ages?|periods?|incubation|frequenc(?:y|ies)|levels?|amounts?)\b/i;
  const VALUE_RE = /^(?:~\s*)?\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(\S.*)$/;
  const BULLET_RE = /^[•▪◦‣·*-]\s*/;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const pageOf = (card) => card.pageNumber || card.page || null;
  const cardSource = (card) => `${card.front}: ${String(card.back || '').replace(/\s*\n\s*/g, ' ').trim()}`;

  /** "4–5 mg/kg", "1 ml / 15 lb": a number (or range) and a unit the checker knows, and nothing else. */
  function numberWithUnit(text) {
    const t = String(text || '').replace(/[.;]\s*$/, '').trim();
    const m = t.match(VALUE_RE);
    return Boolean(m) && tc().knownUnit(m[1]) && Boolean(tc().parseNumber(t));
  }

  function tables(cards, ctx = {}) {
    const out = [];
    for (const card of cards || []) {
      if (!card || !card.table || card.sourceKind !== 'table' || !tq().isAskableColumn(card)) continue;
      const answer = String(card.back || '').trim();
      const question = tq().stemFor(card);
      if (!question || !answer || !tq().rowIsUnique(card, cards)) continue;
      // "In the row where Maint. is ..., what is the Incident.?": with no options to lean on, a clipped header leaves
      // the student guessing what is asked.
      if ([card.table.header[0], card.table.column].some((h) => ABBREVIATED_HEADER_RE.test(String(h || '').trim()))) continue;
      // A header that is itself a word for part of a table ("In the row where Table is "File", what is the Row?") reads
      // as a question about the table's layout.
      if ([card.table.header[0], card.table.column].some((h) => TABLE_WORD_RE.test(String(h || '').trim()))) continue;
      const isNumber = numberWithUnit(answer) || /^\d+(?:\.\d+)?$/.test(answer);
      // A term is words only: "2-3d → abx" is a note, "Dogs, Cats" a list.
      if (!isNumber && (LIST_CELL_RE.test(answer) || words(answer).length > MAX_ANSWER_WORDS || !TERM_CELL_RE.test(answer))) continue;
      const others = tq().columnValues(card, cards).filter((v) => norm(v) !== norm(answer));
      // A value another row also holds is fine (several flukes share a host); one the column never varies in asks nothing.
      if (!others.length || others.every((v) => norm(v) === norm(answer))) continue;
      const source = `${card.front}: ${answer}`;
      const fact = ctx.factOf ? ctx.factOf(source) : null;
      // "Bacterial DNA": its head noun alone ("DNA") names the cell too, when no other value of the column ends in it.
      const head = words(answer).length > 1 ? words(answer).pop() : '';
      const headOk = !isNumber && head.length >= MIN_HEAD_CHARS && !others.some((v) => norm(v).split(' ').includes(norm(head)));
      out.push(shape().make({
        badge: 'Type the Answer • Table', question, answer, form: isNumber ? 'number' : 'term', others, accept: headOk ? [head] : [],
        explanation: `${card.table.entity} — ${card.table.column}: ${answer}`, subject: card.table.entity, source,
        factKey: fact ? fact.identity : `t|${norm(source)}`, page: pageOf(card),
      }));
    }
    return out;
  }

  /** The labelled number lines of a card: [{ label, value }]; the whole back counts as one line without a label. */
  function numberLines(card) {
    const lines = String(card.back || '').split('\n').map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean);
    if (lines.length === 1 && numberWithUnit(lines[0])) return [{ label: '', value: lines[0].replace(/[.;]\s*$/, '') }];
    return lines.map((l) => l.match(/^([A-Za-z][A-Za-z .'’-]{1,30}?)\s*:\s*(.+)$/)).filter(Boolean)
      .filter((m) => words(m[1]).length <= MAX_LABEL_WORDS && numberWithUnit(m[2]))
      .map((m) => ({ label: m[1].trim(), value: m[2].trim().replace(/[.;]\s*$/, '') }));
  }

  // One number (or range) with its unit inside a line: "Survives 4-6 weeks in water", "25% have a history of ...".
  const NUMBER_IN_LINE_RE = /(?<![\w.%-])(\d+(?:\.\d+)?(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:%|[A-Za-z]+(?:\s*\/\s*[A-Za-z]+)?))(?![\w%])/g;
  const MIN_LINE_WORDS = 3; // words left around the blank, in its own clause
  const MAX_FRONT_WORDS = 10;

  /**
   * A line of the card that states one number with its unit about the card's subject, asked with the number blanked:
   * [{ line, value }]. A line with a second number, an approximate or hedged value, or too few words is not asked.
   */
  function blankedNumbers(card) {
    const lines = String(card.back || '').split('\n').map((l) => l.replace(BULLET_RE, '').trim()).filter(Boolean);
    const out = [];
    for (const line of lines) {
      if ((line.match(/\d+(?:\.\d+)?/g) || []).length > 2 || /[~≈<>±]|\b(?:about|approximately|around|up\s+to|over|under|more\s+than|less\s+than|at\s+least)\s+\d/i.test(line)) continue;
      const hits = [...line.matchAll(NUMBER_IN_LINE_RE)].filter((m) => numberWithUnit(m[1]));
      if (hits.length !== 1 || (line.match(/\d+(?:\.\d+)?/g) || []).length !== (hits[0][1].match(/\d+(?:\.\d+)?/g) || []).length) continue;
      const value = hits[0][1].trim();
      const after = line.slice(hits[0].index + hits[0][1].length);
      const blanked = `${line.slice(0, hits[0].index)}________${after}`.replace(/[.;]\s*$/, '');
      // The blank's own clause must say what the value is ("Survives ________ in water"); "...; ________" or "________+"
      // says nothing, and a line that leans on another ("This is still not ...") cannot stand alone.
      const clause = blanked.split(/\s*[;:–—]\s*|\s+o\s+/).find((c) => c.includes('________')) || '';
      if (/^\s*\+/.test(after) || words(clause.replace('________', '')).length < MIN_LINE_WORDS) continue;
      if (dep('typedQuestions', './typed-questions.js').HEDGE_RE.test(line) || sn().hasUnresolvedReference(blanked) || sn().hasExtractionDebris(line)) continue;
      out.push({ line: blanked, value });
    }
    return out;
  }

  function numbers(cards, ctx = {}) {
    const out = [];
    for (const card of cards || []) {
      if (!card || card.rule || card.table || !/^(?:label|list)$/.test(card.sourceKind || '')) continue;
      const front = String(card.front || '').trim();
      const subject = front.split(/\s+[—–]\s+/)[0];
      // The front names the subject and what is said of it, briefly: a sentence-long front is a slide line cut in two.
      if (!front || /[?….!]$/.test(front) ||words(front).length > MAX_FRONT_WORDS || (ctx.specific && !ctx.specific(subject))) continue;
      if (ctx.isDeck && !pageOf(card)) continue;
      const source = cardSource(card);
      const labelled = numberLines(card);
      // A labelled value ("Goats: 4-5 mg/kg") is asked only under a front that names the quantity ("toxic doses").
      for (const { label, value } of QUANTITY_RE.test(front) ? labelled : []) {
        const asked = label ? `${front} — ${label}` : front;
        out.push(shape().make({
          badge: 'Type the Answer • Number', question: `${asked}: type the value with its unit.`, answer: value, form: 'number',
          explanation: `${asked}: ${value}`, subject, source, factKey: `n|${norm(asked)}`, page: pageOf(card),
        }));
      }
      if (labelled.length) continue;
      for (const { line, value } of blankedNumbers(card)) {
        out.push(shape().make({
          badge: 'Type the Answer • Number', question: `${front}: type the missing value with its unit.\n"${line}"`, answer: value, form: 'number',
          explanation: `${front}: ${line.replace('________', value)}`, subject, source, factKey: `n|${norm(front)}|${norm(line)}`, page: pageOf(card),
        }));
      }
    }
    return out;
  }

  /** A small deterministic hash: the same rule, seed and variant always give the same instance. */
  function hash(s) {
    let h = 2166136261;
    for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
  }
  const BIT = { and: (a, b) => a & b, or: (a, b) => a | b, xor: (a, b) => a ^ b, nand: (a, b) => 1 - (a & b), nor: (a, b) => 1 - (a | b), xnor: (a, b) => 1 - (a ^ b) };
  const BIT_LENGTH = 6;
  // Sizes the choice questions never use (worked-questions.js asks 3-5 rows' variables and 3-6 element sets), and big
  // enough that the count is worked out, not seen at a glance.
  const TYPED_SIZES = { rows: [6, 7], powerset: [7, 8] };
  const pageNote = (page) => (page ? ` (p. ${page})` : '');
  const rulePage = (card) => card.page || card.pageNumber || ((card.rule || card.teaches) && (card.rule || card.teaches).page) || null;

  function workedQuestion(card, fields) {
    const page = rulePage(card);
    if (!page) return null;
    return shape().make({
      badge: `Type the Answer • Worked`, skill: 'worked', subject: card.subject || '', source: `${card.front}: ${card.back}`, page,
      ...fields, explanation: `${fields.explanation}${/\(p\. \d+\)/.test(fields.explanation) ? '' : ` (p. ${page})`}`,
    });
  }

  function bitwiseTyped(card, seed, variant) {
    const ops = card.rule.ops.filter((o) => BIT[o.op]);
    if (!ops.length) return null;
    const h = hash(`typed|${card.front}|${seed}|${variant}`);
    const a = [];
    const b = [];
    for (let i = 0; i < BIT_LENGTH; i++) {
      a.push((h >> i) & 1);
      b.push((h >> (i + BIT_LENGTH + 5)) & 1);
    }
    const target = ops[(h >>> 3) % ops.length];
    const answer = a.map((x, i) => BIT[target.op](x, b[i])).join('');
    const sa = a.join('');
    const sb = b.join('');
    return workedQuestion(card, {
      question: `Type the bitwise ${target.word} of the bit strings ${sa} and ${sb}.`, answer, form: 'bits',
      explanation: `Bit by bit, ${target.word} of ${sa} and ${sb} gives ${answer}. ${card.rule.statement}${pageNote(card.rule.page)}`,
      factKey: `w|bitwise-typed|${target.op}|${sa}|${sb}`,
    });
  }

  function countTyped(card, seed, variant) {
    const { what } = card.rule;
    const sizes = TYPED_SIZES[what];
    if (!sizes) return null;
    const n = sizes[(hash(`typed|${what}`) + seed + variant) % sizes.length];
    const answer = String(2 ** n);
    const question = what === 'rows'
      ? `How many rows does the truth table of a function of ${n} variables have? Type the number.`
      : `A set has ${n} elements. How many elements does its power set have? Type the number.`;
    return workedQuestion(card, {
      question, answer, form: 'number', explanation: `$2^{${n}} = ${answer}$. ${card.rule.statement}${pageNote(card.rule.page)}`,
      factKey: `w|count-${what}-typed|${n}`,
    });
  }

  /** The truth value of "(p ∘ q) • ¬p" for one row, two of the section's own operators applied. */
  function truthTyped(cards, seed, variant) {
    const ops = cards.map((card) => ({ card, r: card.rule, ast: le().parse(card.rule.tex, { style: card.rule.style }) }))
      .filter((o) => o.ast && o.r.op !== 'not' && le().variables(o.ast).length === 2);
    const not = cards.find((c) => c.rule.op === 'not');
    if (ops.length < 2 || !not) return null;
    const style = ops[0].r.style;
    const [p, q] = le().variables(ops[0].ast);
    const h = hash(`truth|${seed}|${variant}`);
    const outer = ops[h % ops.length];
    const inner = ops.filter((o) => o !== outer)[(h >>> 4) % (ops.length - 1)];
    const ast = { op: outer.r.op, a: { op: inner.r.op, a: { op: 'var', name: p }, b: { op: 'var', name: q } }, b: { op: 'not', a: { op: 'var', name: variant % 2 ? q : p } } };
    const env = le().rows([p, q])[(h >>> 8) % 4];
    const value = le().evaluate(ast, env);
    const bool = style === 'bool';
    const letter = (v) => (bool ? (v ? '1' : '0') : v ? 'T' : 'F');
    const tex = le().render(ast, style);
    const given = [p, q].map((v) => `$${v} = ${letter(env[v])}$`).join(' and ');
    return workedQuestion(outer.card, {
      question: `With ${given}, what is the value of $${tex}$? Type ${bool ? '1 or 0' : 'T or F'}.`,
      answer: letter(value), accept: bool ? [] : [value ? 'true' : 'false'], form: 'truth',
      explanation: `With ${given}: $${le().render(ast.a, style)}$ is ${letter(le().evaluate(ast.a, env))}, $${le().render(ast.b, style)}$ is ${letter(le().evaluate(ast.b, env))}, so $${tex}$ is ${letter(value)}.`,
      factKey: `w|truth-typed|${tex}|${JSON.stringify(env)}`,
    });
  }

  function worked(cards, ctx = {}) {
    const seed = ctx.seed || 0;
    const variant = ctx.variant || 0;
    const ruled = (kind) => (cards || []).filter((c) => c && c.rule && c.rule.kind === kind);
    return [
      truthTyped(ruled('operator'), seed, variant),
      ...ruled('bitwise').map((c) => bitwiseTyped(c, seed, variant)),
      ...ruled('count').map((c) => countTyped(c, seed, variant)),
    ].filter(Boolean);
  }

  const api = { tables, numbers, worked, numberWithUnit };
  PDFStudy.typedValues = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

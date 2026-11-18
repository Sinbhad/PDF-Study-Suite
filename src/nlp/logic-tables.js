/**
 * Logic Tables: which logical operators a textbook section teaches, read from its own truth tables and
 * definition boxes, never from the chapter's name. Pure and DOM-free (logic-eval.js does the arithmetic).
 *   columns(tables) -> [{ ast, tex, header, vars, values, style, page }]
 *     A column counts only when its header parses as an expression over the table's variable columns, the
 *     variable columns list every assignment once, and the printed value of every row equals the computed
 *     one: a misread header or a damaged row makes the column (not the table) drop out.
 *     style 'prop' for T / F tables, 'bool' for 0 / 1 tables.
 *   definitions(blocks) -> [{ op, ast, tex, name, page, statement }]
 *     A definition box that names an operator with "denoted by $p \wedge q$" (or "$\neg p$") teaches it; the
 *     box's own sentence about when it is true or false is kept as the statement.
 *   operators({ tables, blocks }) -> { style, ops: Map(op -> { op, tex, name, page, statement, verified }), compound: [column] }
 *     The section's operators, each with the expression the section prints for it ("p \to q"); compound
 *     columns (more than one operator, e.g. (p ∨ ¬q) → (p ∧ q)) are kept apart as checked worked rows.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  const TF = { T: true, F: false, 1: true, 0: false };
  const MAX_VARS = 3;
  // "Z = X ⋅ Y": a named output column; the expression is what follows the equals sign
  const NAMED_OUTPUT_RE = /^\s*\$?[A-Za-z](?:_\{?\d\}?)?\$?\s*=\s*/;
  const DENOTED_RE = /\bdenoted\s+by\s+(\$[^$]+\$|[^\s,;(]+(?:\s*[^\s,;(]+){0,2})/i;
  // "The biconditional statement p $\leftrightarrow q$ is ...": a name of up to four words, then one or two letters
  // and an operator in math
  const NAMED_NOTATION_RE = /\bThe\s+[a-z]{2,}(?:\s+[a-z]{2,}){0,3}\s+((?:\$?\s*[a-z]\s*\$?\s*)?\$[^$]{1,30}\$)\s+(?:is|are)\b/;
  const TRUTH_SENTENCE_RE = /\b(?:is|are)\s+(?:true|false)\s+(?:when|if|exactly)\b|\btrue\s+when\b|\bfalse\s+when\b|\bopposite\s+of\s+the\s+truth\s+value\b/i;
  const DAMAGED_RE = /¿/;

  const plain = (s) => String(s == null ? '' : s).replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

  /** The table's cells as T/F booleans, or null when any body cell is not a truth value of one style. */
  function truthGrid(rows) {
    let style = null;
    const grid = [];
    for (const row of rows) {
      const out = [];
      for (const cell of row) {
        const c = plain(cell);
        if (!(c in TF)) return null;
        const s = c === 'T' || c === 'F' ? 'prop' : 'bool';
        if (style && s !== style) return null;
        style = s;
        out.push(TF[c]);
      }
      grid.push(out);
    }
    return grid.length ? { grid, style } : null;
  }

  function columns(tables) {
    const out = [];
    for (const t of tables || []) {
      const header = (t.header || []).map(plain);
      if (header.length < 2 || DAMAGED_RE.test(header.join(' '))) continue;
      const body = (t.rows || []).filter((r) => Array.isArray(r) && r.length === header.length);
      if (body.length !== (t.rows || []).length) continue;
      const read = truthGrid(body);
      if (!read) continue;
      const { grid, style } = read;
      // Two tables printed side by side ("p q p∧q | p q p∨q"): a variable column after an expression column
      // starts a new segment with variables of its own.
      let segment = [];
      let sawExpression = false;
      header.forEach((h, j) => {
        const ast = le().parse(h.replace(NAMED_OUTPUT_RE, ''), { style });
        if (!ast) return;
        if (ast.op === 'var') {
          if (sawExpression) {
            segment = [];
            sawExpression = false;
          }
          segment.push({ name: ast.name, index: j });
          return;
        }
        sawExpression = true;
        const names = segment.map((v) => v.name);
        const vars = le().variables(ast);
        if (!vars.length || vars.length > MAX_VARS || !vars.every((v) => names.includes(v)) || new Set(names).size !== names.length) return;
        // Every assignment of the segment's variables once: the table is complete, so its column can be checked.
        const assignments = grid.map((row) => segment.map((v) => (row[v.index] ? '1' : '0')).join(''));
        if (new Set(assignments).size !== 2 ** segment.length || grid.length !== 2 ** segment.length) return;
        const computed = grid.map((row) => le().evaluate(ast, Object.fromEntries(segment.map((v) => [v.name, row[v.index]]))));
        if (computed.some((v, i) => v !== grid[i][j])) return;
        out.push({ ast, tex: le().render(ast, style), header: h, vars: names, values: computed, style, page: t.pageNumber || t.page || null });
      });
    }
    return out;
  }

  /** "Let p and q be propositions. The conjunction of p and q, denoted by $p\wedge q$, ..." -> the operator it defines. */
  function definitions(blocks) {
    const boxed = dep('boxedCards', './boxed-cards.js');
    const out = [];
    for (const b of blocks || []) {
      if (!b || b.kind !== 'definition') continue;
      const body = String(b.body || b.text || '');
      if (DAMAGED_RE.test(body)) continue;
      // "denoted by $p\wedge q$", or the name followed by its notation: "The conditional statement p $\to q$ is ..."
      const m = body.match(DENOTED_RE) || body.match(NAMED_NOTATION_RE);
      if (!m) continue;
      const ast = le().parse(m[1].replace(/\s*\$\s*/g, ' '), { style: 'prop' });
      if (!ast) continue;
      const vars = le().variables(ast);
      const ops = [...le().operators(ast)];
      // One operator applied to bare variables: ¬p, p ∧ q. "denoted by A ⊆ B" or a compound is no operator box.
      const simple = ops.length === 1 && (ast.op === 'not' ? ast.a.op === 'var' : ast.a.op === 'var' && ast.b.op === 'var' && vars.length === 2);
      if (!simple) continue;
      const name = boxed && boxed.boxName ? boxed.boxName(b.title, body) : '';
      // The box's sentence about when the operator is true or false; a box without one defines no truth function
      // ("the Cartesian product, denoted by A × B, is the set of ...").
      const statement = plain(body).split(/(?<=[.”"])\s+(?=[A-Z$“"])/).find((s) => TRUTH_SENTENCE_RE.test(s)) || '';
      if (!statement) continue;
      out.push({ op: ast.op, ast, tex: le().render(ast, 'prop'), name: plain(name).replace(/\s*\((?:Definition|Theorem)\s+[\d.]+\)$/, ''), page: b.pageNumber || b.page || null, statement });
    }
    return out;
  }

  function operators({ tables, blocks } = {}) {
    const cols = columns(tables);
    const ops = new Map();
    const compound = [];
    let style = null;
    for (const c of cols) {
      const used = le().operators(c.ast);
      if (used.size === 1 && c.vars.length <= 2 && le().variables(c.ast).length === (c.ast.op === 'not' ? 1 : 2)) {
        const op = [...used][0];
        // The operator applied to bare variables: the section's own column for it
        const bare = c.ast.op === 'not' ? c.ast.a.op === 'var' : c.ast.a.op === 'var' && c.ast.b.op === 'var';
        if (bare && !ops.has(op)) ops.set(op, { op, tex: c.tex, name: '', page: c.page, statement: '', verified: true, style: c.style });
        style = style || c.style;
      } else if (used.size >= 2) {
        compound.push(c);
      }
    }
    for (const d of definitions(blocks)) {
      const have = ops.get(d.op);
      if (have) {
        // The table checked the operator; the box gives it a name and the sentence that states the rule.
        if (!have.name) have.name = d.name;
        // The box writes the operator on its own letters (¬p, not the ¬q of a compound column)
        if (!have.definitionPage) have.tex = d.tex;
        if (!have.statement) have.statement = d.statement;
        if (!have.definitionPage) have.definitionPage = d.page;
      } else {
        ops.set(d.op, { op: d.op, tex: d.tex, name: d.name, page: d.page, statement: d.statement, verified: false, style: 'prop' });
      }
    }
    return { style: style || (ops.size ? 'prop' : null), ops, compound };
  }

  const api = { columns, definitions, operators };
  PDFStudy.logicTables = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

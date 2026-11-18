/**
 * Section Rules: the rules a textbook section teaches that a program can apply and check, read from the
 * section's own boxes, tables, displays and sentences (never from its title). Pure and DOM-free.
 *   read({ text, blocks, tables, lines, startPage }) -> {
 *     operators   logic-tables.js: the logical operators the section's truth tables or definition boxes define
 *     forms, precedence   logic-forms.js: converse / contrapositive / inverse as the section defines them, and
 *                 the operator precedence its "X means Y rather than Z" examples show
 *     bitwise     { ops: [{ op, word, symbol }], statement, page } | null: bit operations on bit strings, when
 *                 a sentence defines them ("We define the bitwise OR, bitwise AND, ... of two strings") or a
 *                 table lists them by name and symbol ("& | Bitwise and")
 *     sets        set-rules.js: the subset, proper-subset and power-set definitions, when the section gives them
 *     relational  { ops: [{ op, meaning }], page, assignmentError } | null: a table of relational operators, its
 *                 table of evaluated expressions (if any) agreeing with code-expr.js
 *     counts      [{ what: 'rows' | 'powerset', statement, page }]: the 2^n rule, stated by the section for
 *                 the rows of a truth table or the size of a power set
 *     identities, derived   identity-rules.js: checked laws and derivations
 *   }
 * blocks: extraction's tagged blocks (an example box's text after its end mark ◂ is the book's running text
 * again, so a rule stated there counts); tables: scope.tables; lines: scope.lines (for pages).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const BIT_WORDS = { AND: 'and', OR: 'or', XOR: 'xor', XNOR: 'xnor', NAND: 'nand', NOR: 'nor', NOT: 'not' };
  const BITWISE_NAME_RE = /\bbitwise\s+(AND|OR|XOR|XNOR|NAND|NOR|NOT)\b/gi;
  // "We define the bitwise OR ... of two strings ... to be ...", "... the AND of the corresponding bits"
  const DEFINES_BITWISE_RE = /\bdefine[sd]?\b[^.]*\bbitwise\b|\bbitwise\b[^.]*\bcorresponding\s+bits\b/i;
  // "We use the symbols ∨, ∧, and ⊕ to represent the bitwise OR, bitwise AND, and bitwise XOR operations, respectively"
  const RESPECTIVELY_RE = /\bsymbols?\s+(.{1,40}?)\s+to\s+(?:represent|denote)\s+the\s+(bitwise\s+.{3,80}?)\s+operations?,?\s+respectively/i;
  const TWO_TO_N_RE = /\b2\s*\^\s*\{?\s*n\s*\}?(?![\w{])|2ⁿ/;
  const END_MARK_RE = /[◂◀∎]/;
  const DAMAGED_RE = /¿/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const unmath = (s) => plain(s).replace(/\$/g, '').replace(/\s+/g, ' ');

  /** The section's sentences, with block bodies (an example's text only after its end mark) and their pages. */
  function sentences(text, blocks, pageOf) {
    const tok = dep('tokenizer', './tokenizer.js');
    // `raw` keeps the bold marks and math for readers that look for them (logic-forms.js)
    const out = tok.splitSentences(String(text || '')).map((s) => ({ text: plain(s), raw: s, page: pageOf(s) }));
    for (const b of blocks || []) {
      if (!b || b.kind === 'table') continue;
      let body = String(b.body || b.text || '');
      if (b.kind === 'example' || b.kind === 'proof') {
        const parts = body.split(END_MARK_RE);
        if (parts.length < 2) continue;
        body = parts[parts.length - 1];
      }
      for (const s of tok.splitSentences(body)) out.push({ text: plain(s), raw: s, page: b.pageNumber || b.page || pageOf(s) });
    }
    // "$$ If a set has ..." after a display that closed the example: the stray delimiter is not the sentence's
    return out.map((s) => ({ ...s, text: s.text.replace(/^\$\$\s*/, '') })).filter((s) => s.text && !DAMAGED_RE.test(s.text));
  }

  function bitwise(list, tables) {
    const ops = new Map();
    let statement = '';
    let page = null;
    for (const s of list) {
      const flat = unmath(s.text);
      if (!DEFINES_BITWISE_RE.test(flat)) continue;
      for (const m of flat.matchAll(BITWISE_NAME_RE)) {
        const word = m[1].toUpperCase();
        if (!ops.has(BIT_WORDS[word])) ops.set(BIT_WORDS[word], { op: BIT_WORDS[word], word, symbol: '' });
      }
      if (ops.size && !statement) {
        statement = s.text;
        page = s.page;
      }
    }
    // The symbols, when a sentence pairs them with the operations "respectively"
    for (const s of list) {
      const m = unmath(s.text).match(RESPECTIVELY_RE);
      if (!m) continue;
      const symbols = m[1].split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean);
      // "the bitwise OR, bitwise AND, and bitwise XOR": the words after "bitwise", not the "and" that joins them
      const words = [...m[2].matchAll(/\bbitwise\s+(AND|OR|XOR|XNOR|NAND|NOR|NOT)\b/gi)].map((x) => x[1].toUpperCase());
      if (symbols.length !== words.length) continue;
      words.forEach((w, i) => { if (ops.has(BIT_WORDS[w])) ops.get(BIT_WORDS[w]).symbol = symbols[i]; });
    }
    // A table of operators: "& | Bitwise and | F = X & Y;"
    for (const t of tables || []) {
      for (const row of [t.header || [], ...(t.rows || [])]) {
        const cells = row.map(plain);
        const named = cells.map((c) => c.match(/^bitwise\s+(and|or|xor|xnor|nand|nor|not)$/i)).find(Boolean);
        const symbol = cells.find((c) => /^[~&|^!]{1,2}$/.test(c));
        if (!named || !symbol) continue;
        const word = named[1].toUpperCase();
        if (BIT_WORDS[word] === 'not' || ops.has(BIT_WORDS[word])) continue;
        ops.set(BIT_WORDS[word], { op: BIT_WORDS[word], word, symbol, fromTable: true });
        page = page || t.pageNumber || t.page || null;
      }
    }
    const binary = [...ops.values()].filter((o) => o.op !== 'not');
    if (binary.length < 2) return null;
    // A table gives no sentence: its rows, written out, are the statement
    if (!statement) statement = `Bitwise operators: ${binary.map((o) => `${o.symbol} (bitwise ${o.word})`).join(', ')}.`;
    return { ops: binary, statement, page };
  }

  function counts(list) {
    const out = [];
    const seen = new Set();
    for (const s of list) {
      const flat = unmath(s.text);
      if (!TWO_TO_N_RE.test(flat)) continue;
      let what = '';
      if (/\btruth\s+table\b/i.test(flat) && /\brows?\b/i.test(flat) && /\bvariables?\b/i.test(flat)) what = 'rows';
      else if (/\bpower\s+set\b/i.test(flat) && /\bn\s+elements?\b/i.test(flat)) what = 'powerset';
      if (!what || seen.has(what)) continue;
      seen.add(what);
      out.push({ what, statement: s.text, page: s.page });
    }
    return out;
  }

  /**
   * A table of relational operators ("== | = | Equal", ">= | ≥ | Greater than or equal"): the operators and what the
   * table says each tests. A table of evaluated expressions ("3 == 5 - 2 | true", "3 = 6 / 2 | Error") is checked
   * against code-expr.js: one row that disagrees and the section's expressions are not worked at all; a row that
   * shows "=" as an error lets a question offer that answer.
   */
  function relational(tables) {
    const ce = dep('codeExpr', './code-expr.js');
    let found = null;
    let agree = true;
    let assignmentError = null;
    for (const t of tables || []) {
      const rows = [t.header || [], ...(t.rows || [])].map((r) => r.map(plain));
      const width = Math.max(...rows.map((r) => r.length));
      for (let j = 0; j < width && !found; j++) {
        const ops = rows.filter((r) => ce.RELATIONAL.includes(r[j]));
        if (ops.length < 4) continue;
        // The description: the row's longest cell made of words
        const meaning = (r) => r.filter((c, k) => k !== j && /[A-Za-z]{3}/.test(c)).sort((a, b) => b.length - a.length)[0] || '';
        found = { ops: ops.map((r) => ({ op: r[j], meaning: meaning(r) })).filter((o) => o.meaning), page: t.pageNumber || t.page || null };
      }
      for (const r of rows) {
        const value = (r[1] || '').toLowerCase();
        if (!/^(?:true|false|error)$/.test(value)) continue;
        const computed = ce.evaluate(r[0]);
        if (computed === null) continue;
        if (String(computed) !== value) agree = false;
        else if (computed === 'error' && !assignmentError) assignmentError = { expr: r[0], note: r[2] || '', page: t.pageNumber || t.page || null };
      }
    }
    return found && found.ops.length >= 4 && agree ? { ...found, assignmentError } : null;
  }

  function read({ text, blocks, tables, lines, startPage } = {}) {
    const pageOf = dep('cardFields', './card-fields.js').pageLocator(lines);
    const list = sentences(text, blocks, pageOf);
    const ids = dep('identityRules', './identity-rules.js').read({ text, lines, startPage });
    const lf = dep('logicForms', './logic-forms.js');
    const raw = list.map((s) => ({ text: s.raw, page: s.page }));
    return {
      operators: dep('logicTables', './logic-tables.js').operators({ tables, blocks }),
      forms: lf.forms(raw),
      precedence: lf.precedence(raw),
      sets: dep('setRules', './set-rules.js').read(list),
      bitwise: bitwise(list, tables),
      relational: relational(tables),
      counts: counts(list),
      identities: ids.identities,
      derived: ids.derived,
    };
  }

  const api = { read, counts, bitwise, relational, sentences };
  PDFStudy.sectionRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

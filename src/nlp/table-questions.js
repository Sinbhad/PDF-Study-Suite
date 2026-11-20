/**
 * Table Questions: a comparison table asked down one column. The wrong options are the same column's values in
 * other rows, so they are the same kind of thing as the answer and, being another row's value, false for the
 * row asked about:
 *   In the row where Assay is "PCR", what is the Sample?   Blood (urine) | Clotted blood | Kidney, Liver | Serum
 * The stem names both columns by their header text: the one asked about and the one its row value sits in. A
 * table whose header cell for either is missing or merged ("Assay target Notes") is not asked from.
 * A value is never offered against an answer it overlaps: "Dogs" is not wrong for "Dogs, Cats", and two rows
 * that share an item ("Snail") cannot be told apart by it; nor is a lone class-like cell ("Carnivores") set against a
 * list of members ("Dogs, Cats") or the other way round. A column whose values are all alike asks nothing, nor
 * does a column of remarks ("Notes").
 * The row value in the stem must pick out one row, and no option comes from a row that holds that value in any of
 * its cells (the same host listed as incidental for another row) or whose own name could include it as a class.
 *
 * candidates(cards, { seed, factOf }) -> [question]   cards carry `table` (table-cards.js rowCards, with header and row)
 * stemFor(card) -> the stem for one table card, or '' when its headers cannot name the cell
 *   factOf(source) -> the quiz fact built from the same card (its identity becomes the question's factKey,
 *   so the same cell is not asked again as a "which statement is true" question)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const MIN_DISTRACTORS = 3; // four options or no question
  const MAX_DISTRACTORS = 3;
  const MAX_OPTION_CHARS = 80; // a longer cell is a note, not a value to choose
  const MIN_ITEM_CHARS = 2; // "K9", "IV": two characters name an item
  const MAX_HEADER_WORDS = 6;
  const LENGTH_TELL_RATIO = 1.5; // with LENGTH_TELL_CHARS: how much longer than the answer a wrong option may be
  const LENGTH_TELL_CHARS = 10;
  // A column of remarks holds no values to choose between.
  const REMARKS_COLUMN_RE = /^(?:notes?|comments?|remarks?|other|misc\.?|details?|description)$/i;
  // "Assay target Notes": a lower-case word then a capitalised one inside a header cell is two headers read as one.
  const GLUED_HEADER_RE = /\b[a-z][a-z.]*\s+[A-Z][a-z]/;
  // Method/assay/stage rows ("Serology", "IDEXX Snap") depend on the table's subject when asked outside the slide.
  const METHOD_HEADER_RE = /^(?:assay|test|method|diagnostic|procedure|technique|sample|stage|phase|class|type|grade|group|category)s?$/i;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** "Dogs, Cats, Humans" -> {dogs, cats, humans}; "Blood (urine)" -> {blood, urine}. */
  const items = (value) => new Set(String(value).split(/[,;/()]|\band\b|\bor\b/i).map(norm).filter((w) => w.length >= MIN_ITEM_CHARS));

  /** Is `value` one of the items `cell` lists ("pigs" in "pigs/cattle"), or the cell itself? */
  function listsItem(cell, value) {
    if (norm(cell) === norm(value)) return true;
    const ic = items(cell);
    return [...items(value)].some((w) => ic.has(w));
  }

  function overlaps(a, b) {
    if (norm(a) === norm(b) || norm(a).includes(norm(b)) || norm(b).includes(norm(a))) return true;
    const ia = items(a);
    return [...items(b)].some((w) => ia.has(w));
  }

  /**
   * In a column whose cells list several items ("Dogs, Cats"), a lone plural cell ("Carnivores", "Ruminants") may
   * be the class those items belong to: it is not set against a list, nor a list against it, since either could be
   * true. Without a dictionary "Horses" looks the same, and is held back too: that costs an option, not a key.
   * -> (a, b) => may they stand side by side as options?
   */
  function classSafe(values) {
    const lists = values.filter((v) => items(v).size >= 2);
    const isClass = (v) => {
      const only = [...items(v)];
      return lists.length > 0 && only.length === 1 && /[^s]s$/.test(only[0]);
    };
    const isList = (v) => items(v).size >= 2;
    return (a, b) => !((isClass(a) && isList(b)) || (isList(a) && isClass(b)));
  }

  /** A header cell a question can name: present, short and not two headers read as one. */
  const usableHeader = (h) => Boolean(String(h || '').trim()) && !GLUED_HEADER_RE.test(h) && String(h).trim().split(/\s+/).length <= MAX_HEADER_WORDS;

  /** Qualifies a generic method/assay row ("PCR") with its table's specific subject ("PCR (Leptospira spp.)") for standalone questions. */
  function qualifiedEntity(t) {
    const entity = String((t && t.entity) || '').trim();
    const sub = String((t && t.subject) || '').trim();
    if (!sub || !Array.isArray(t.header) || !METHOD_HEADER_RE.test(String(t.header[0] || '').trim())) return entity;
    return entity.toLowerCase().includes(sub.toLowerCase()) ? entity : `${entity} (${sub})`;
  }

  /**
   * The stem that asks one cell, naming both the column asked about and the column the row's own value sits in:
   * "In the row where Assay is "PCR", what is the Sample?". '' when either header is missing or merged: a value
   * without its column ("dogs" as maintenance or as incidental host?) does not say which row is meant.
   */
  function stemFor(card) {
    const t = card && card.table;
    if (!t || !Array.isArray(t.header) || !usableHeader(t.header[0]) || !usableHeader(t.column)) return '';
    return `In the row where ${t.header[0].trim()} is "${qualifiedEntity(t)}", what is the ${t.column.trim()}?`;
  }

  /** The rows of each table (by its key), as rowCards recorded them on their cards: row name -> cells. */
  function tableRows(cards) {
    const tables = new Map();
    for (const c of cards) {
      if (!Array.isArray(c.table.row)) continue;
      if (!tables.has(c.table.key)) tables.set(c.table.key, new Map());
      tables.get(c.table.key).set(norm(c.table.row[0]), c.table.row);
    }
    return tables;
  }
  const bare = (name) => String(name || '').replace(/\s*\([^)]*\)$/, '');

  function candidates(cards, opts = {}) {
    const columns = new Map();
    const tableCards = [];
    for (const c of cards || []) {
      if (!c || !c.table || c.sourceKind !== 'table') continue;
      tableCards.push(c);
      if (REMARKS_COLUMN_RE.test(c.table.column.trim()) || GLUED_HEADER_RE.test(c.table.column)) continue;
      const key = `${c.table.key}#${c.table.columnIndex}`;
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(c);
    }
    const rowsOf = tableRows(tableCards);
    const out = [];
    for (const list of columns.values()) {
      const sideBySide = classSafe(list.map((c) => String(c.back || '').trim()));
      for (const card of list) {
        const answer = String(card.back || '').trim();
        const question = stemFor(card);
        if (!question || !answer || answer.length > MAX_OPTION_CHARS) continue;
        const own = card.table.row;
        // The other rows of the table (each card carries its own copy of its row: they are told apart by name).
        const rows = [...(rowsOf.get(card.table.key) || new Map()).values()].filter((r) => norm(r[0]) !== norm(own[0]));
        const value = bare(own[0]);
        const sameRowKind = classSafe([own[0], ...rows.map((r) => r[0])]);
        // The stem's value must pick out one row: printed in another row's first column too, either row could be meant.
        if (rows.some((r) => overlaps(bare(r[0]), value))) continue;
        // No option may come from a row that also holds the stem's value in any of its cells ("pigs/cattle" as
        // incidental hosts of another serovar), or whose own name could include it ("ruminants" beside "pigs/cattle").
        // (A cell holds the value when it is the value or lists it as an item; a remark that mentions it in passing
        // does not.)
        const fair = rows.filter((r) => !r.some((cell) => cell && listsItem(bare(cell), value)) && sameRowKind(bare(r[0]), value));
        const pool = [...new Map(fair.map((r) => String(r[card.table.columnIndex] || '').trim()).filter(Boolean).map((v) => [norm(v), v])).values()]
          .filter((v) => v.length <= MAX_OPTION_CHARS && !overlaps(v, answer) && sideBySide(v, answer))
          // A wrong option far longer than the answer stands out as wrong (or, the other way round, as right).
          .filter((v) => v.length <= Math.max(answer.length * LENGTH_TELL_RATIO, answer.length + LENGTH_TELL_CHARS));
        const wrong = shuffle(pool, card.front, opts.seed || 0).slice(0, MAX_DISTRACTORS);
        if (wrong.length < MIN_DISTRACTORS) continue;
        const source = `${card.front}: ${answer}`;
        const fact = opts.factOf ? opts.factOf(source) : null;
        out.push({
          type: 'multiple_choice', badge: 'Multiple Choice • Table', question,
          options: shuffle([answer, ...wrong], question, opts.seed || 0), answer,
          explanation: `${card.table.entity} — ${card.table.column}: ${answer}`,
          skill: 'definition', category: 'Comparison', subject: card.table.entity, source,
          factKey: fact ? fact.identity : `t|${norm(source)}`, page: card.pageNumber || card.page || null, pageNumber: card.pageNumber || card.page || null,
        });
      }
    }
    return spread(out);
  }

  /** One question per row in turn, so a long table does not fill a quiz with one row's columns. */
  function spread(questions) {
    const byRow = new Map();
    for (const q of questions) byRow.set(q.subject, [...(byRow.get(q.subject) || []), q]);
    const rows = [...byRow.values()];
    const out = [];
    for (let i = 0; out.length < questions.length; i++) rows.forEach((r) => r[i] && out.push(r[i]));
    return out;
  }

  /** Does the stem's row value pick out one row of its table (no other row's name overlaps it)? */
  function rowIsUnique(card, cards) {
    const rows = tableRows((cards || []).filter((c) => c && c.table && c.sourceKind === 'table')).get(card.table.key) || new Map();
    const value = bare(card.table.row[0]);
    return ![...rows.values()].some((r) => norm(r[0]) !== norm(card.table.row[0]) && overlaps(bare(r[0]), value));
  }

  /** The other rows' values in this card's column. */
  function columnValues(card, cards) {
    return (cards || []).filter((c) => c && c.table && c.sourceKind === 'table' && c.table.key === card.table.key &&
      c.table.columnIndex === card.table.columnIndex && c !== card).map((c) => String(c.back || '').trim()).filter(Boolean);
  }

  /** A column a question may ask down: not remarks, not two headers read as one. */
  const isAskableColumn = (card) => !REMARKS_COLUMN_RE.test(String(card.table.column || '').trim()) && !GLUED_HEADER_RE.test(card.table.column || '');

  const api = { candidates, overlaps, stemFor, qualifiedEntity, rowIsUnique, columnValues, isAskableColumn, usableHeader };
  PDFStudy.tableQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

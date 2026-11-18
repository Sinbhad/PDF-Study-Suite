/**
 * Table Cards: one card per cell of a comparison table, asked as "<row entity> — <column header>".
 *   | Drug           | Site           | Use          |
 *   | Furosemide     | Loop of Henle  | Acute oedema |   -> "Furosemide — Site" => "Loop of Henle"
 * Accepts { header, rows } (extraction's table block, rows without the header) or { rows } whose first row is
 * the header (older slide tables).
 *
 * Extraction also reads figure labels, array diagrams, truth tables and titre grids as tables. A table only
 * yields cards when it looks like a comparison table:
 *   - its header reads as a header: short cells, no caption, most of them capitalised (a lower-case first row
 *     is a data row whose real header was lost)
 *   - its cells are mostly words: a grid of numbers, T/F or 0/1 values asks nothing of a name
 *   - every row names its entity: a word or a short symbol, not a sentence, a caption or an empty cell
 * A row named by a symbol (an operator table: ">" | "Greater than") still makes the table one, but gives no card:
 * the cell only names the symbol.
 * A row whose other cells are all empty is a group label ("Taenia spp."): the lower-case rows under it are
 * named with it ("saginata (Taenia spp.)"). A cell holding a web address is left empty.
 *
 * rowCards(table, { subject, max }) -> [{ front, back, category, kind, subject, sourceKind, table }]
 *   table: { entity, column, columnIndex, key, header, row } so a question can offer the same column of other rows
 * isComparison(table) -> boolean
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const quality = () => dep('cardQuality', './card-quality.js');
  const filter = () => dep('contentFilter', './content-filter.js');

  const MIN_BODY_ROWS = 2;
  const MAX_BODY_ROWS = 24;
  const MAX_CELL_CHARS = 200;
  const DEFAULT_MAX_CARDS = 30;
  const MAX_HEADER_WORDS = 6; // a longer header cell is a caption or a sentence
  const MIN_CAPITAL_HEADERS = 0.5; // share of header cells that start with a capital letter or are an acronym
  const MAX_DEBRIS_CELLS = 0.5; // share of body cells that may hold no word (numbers, T/F, symbols)
  const MAX_ENTITY_WORDS = 8; // a longer row name is a sentence
  const MIN_NAME_CHARS = 4; // shorter row names ("IHC" aside) are too common to tell a borrowed label

  const URL_RE = /(?:https?:\/\/|www\.)\S+/i; // no g flag: it is only tested, and a global regex keeps state
  const MAX_SUBJECT_WORDS = 4;
  // Two header cells read as one ("Assay target Notes"): the column's cells interleave two columns' words.
  // ("Intermediate Host" is one header: the capital follows a capital word, not a lower-case one.)
  const MERGED_HEADER_RE = /^[A-Z][a-z]+(?:\s+[a-z]+)+\s+[A-Z][a-z]+$/;
  // A catch-all column ("Notes", "Comments", "Other") asks nothing: "Serology — Notes" has no question in it.
  const CATCH_ALL_COLUMN_RE = /^(?:notes?|comments?|remarks?|other|misc(?:ellaneous)?|details|additional(?:\s+\w+)?|extra|see\s+also)$/i;
  // A cell that carries a web address took in a link or a credit line from the slide: its reading is not trusted.
  const tidy = (s) => {
    const t = String(s == null ? '' : s);
    return URL_RE.test(t) ? '' : t.replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  };
  const wordy = (cell) => /[A-Za-z]{2}/.test(cell);
  const words = (s) => s.split(/\s+/).filter(Boolean);

  /** -> { header: string[], body: string[][] } or null when the input is not a table. */
  function shape(table) {
    if (!table) return null;
    const rows = (table.rows || []).map((r) => (Array.isArray(r) ? r.map(tidy) : String(r).split(/\s+\|\s+/).map(tidy)));
    const header = Array.isArray(table.header) && table.header.length ? table.header.map(tidy) : rows[0];
    const body = Array.isArray(table.header) && table.header.length ? rows : rows.slice(1);
    if (!header || header.length < 2) return null;
    return { header, body: body.filter((r) => r.some(Boolean)) };
  }

  /** Short, capitalised, word cells with no caption among them. */
  function headerLike(header) {
    const cells = header.filter(Boolean);
    if (!cells.length || !cells.slice(1).every(wordy) || header.slice(1).some((c) => !c)) return false;
    if (cells.some((c) => words(c).length > MAX_HEADER_WORDS || filter().isCaption(c))) return false;
    const capital = cells.filter((c) => /^[A-Z]/.test(c)).length;
    return capital / cells.length >= MIN_CAPITAL_HEADERS;
  }

  /** A row name: a word or a short symbol ("==", "&&"), not a sentence or a bracketed aside. */
  const namesEntity = (cell) => Boolean(cell) && (wordy(cell) || /^[^\w\s]{1,4}$/.test(cell)) &&
    words(cell).length <= MAX_ENTITY_WORDS && !/[.!?]$/.test(cell.replace(/\b(?:spp|sp|etc|vs)\.$/i, '')) && !/^\(.*\)$/.test(cell);

  /** Rows with their entity named, group-label rows folded into the names of the rows under them. */
  function namedRows(body) {
    const out = [];
    let group = '';
    for (const row of body) {
      const rest = row.slice(1);
      if (row[0] && rest.every((c) => !c)) {
        group = row[0];
        continue;
      }
      if (!namesEntity(row[0] || '')) return null; // a row that names nothing: the layout was not read as a table
      const entity = group && /^[a-z]/.test(row[0]) ? `${row[0]} (${group})` : row[0];
      out.push([entity, ...rest]);
    }
    return out;
  }

  /** The comparison table under the input, or null (see the rules at the top). */
  function comparison(table) {
    const t = shape(table);
    if (!t || !headerLike(t.header)) return null;
    const body = namedRows(t.body);
    if (!body || body.length < MIN_BODY_ROWS || body.length > MAX_BODY_ROWS) return null;
    const cells = body.flatMap((r) => r.slice(1)).filter(Boolean);
    const debris = cells.filter((c) => !wordy(c)).length;
    if (!cells.length || debris / cells.length > MAX_DEBRIS_CELLS) return null;
    return { header: t.header, body };
  }

  const isComparison = (table) => Boolean(comparison(table));

  function rowCards(table, opts = {}) {
    const t = comparison(table);
    if (!t) return [];
    const { header, body } = t;
    const subject = tidy(opts.subject);
    const key = header.map((h) => h.toLowerCase()).join('|');
    const out = [];
    // A cell that prints another row's name ("Taenia solium Cattle" in the saginata row) took in a label from
    // the next row or a figure: its reading is not to be trusted.
    const names = body.map((r) => r[0].replace(/\s*\(.*\)$/, '').toLowerCase()).filter((n) => n.length >= MIN_NAME_CHARS);
    const borrows = (cell, own) => names.some((n) => n !== own && new RegExp(`(?:^|\\W)${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\W|$)`).test(cell.toLowerCase()));
    // A row name that other tables of the deck list too ("IHC" in the diagnosis tables of two diseases) is about
    // this table's subject: its cell facts name it ("IHC (Leptospira spp.) — Sample"). opts.ambiguous holds those
    // row names in lower case (rowNames over the deck's tables).
    const ambiguous = opts.ambiguous instanceof Set ? opts.ambiguous : null;
    const qualify = (entity) => Boolean(subject && ambiguous && ambiguous.has(entity.toLowerCase()) && words(subject).length <= MAX_SUBJECT_WORDS);
    for (const row of body) {
      const entity = row[0];
      // A row named by a symbol (">", "!=") only says what the symbol is called ("Greater than"): one cell of an
      // operator table, which the section's rule card (rule-cards.js) shows whole and worked questions apply.
      if (!wordy(entity)) continue;
      const own = entity.replace(/\s*\(.*\)$/, '').toLowerCase();
      header.slice(1).forEach((column, i) => {
        const cell = row[i + 1] || '';
        if (!cell || cell.length > MAX_CELL_CHARS || !quality().readable(cell) || cell.toLowerCase() === entity.toLowerCase()) return;
        if (borrows(cell, own) || MERGED_HEADER_RE.test(column) || CATCH_ALL_COLUMN_RE.test(column.trim())) return;
        // A bare row label ("1", "Type A") names nothing alone: the table's subject goes in front of it.
        const bare = subject && /\d/.test(entity) && entity.split(/\s+/).length <= 2;
        const about = qualify(entity) && !bare && !entity.toLowerCase().includes(subject.toLowerCase()) ? `${entity} (${subject})` : entity;
        const named = bare ? `${subject} ${entity}` : about;
        out.push({
          front: `${named} — ${column}`, back: cell, category: 'Comparison', kind: 'concept', subject: entity, sourceKind: 'table',
          // The whole row and the header ride along: a question asked down a column checks every cell of the other
          // rows and names the column its stem value sits in (table-questions.js).
          table: { entity: named, column, columnIndex: i + 1, key, header: [...header], row: [...row] },
        });
      });
    }
    return out.slice(0, opts.max || DEFAULT_MAX_CARDS);
  }

  /** Lower-cased row names of one comparison table ([] when it is none): what rowCards would ask about. */
  function rowNames(table) {
    const t = comparison(table);
    return t ? t.body.map((r) => r[0].toLowerCase()) : [];
  }

  const api = { rowCards, rowNames, shape, isComparison };
  PDFStudy.tableCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

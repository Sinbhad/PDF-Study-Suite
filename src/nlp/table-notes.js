/**
 * Table Notes: the remarks column of a comparison table ("Notes": "Not serospecific, inhibitors in urine"), which
 * table-questions.js does not ask down (its cells are remarks, not values of one kind), asked one row at a time:
 *   In the row where Assay is "IDEXX Snap", what do the Notes say?
 *     Targets C6 proteins | Vaccine cross-reactivity | Also silver stain, not serospecific | Confirmation of ELISA
 * The wrong options are the same table's notes of other rows, under the table rules of table-questions.js (the row
 * value picks out one row; no option from a row that holds that value). A note that shares a word with the answer's
 * ("non-specific" / "not serospecific"), or that names the asked row, could be true of it as well and is not offered.
 * Every card of a table carries its whole row and header (table-cards.js), so the column is read from them even
 * though the remarks column gives no card of its own.
 *   candidates(cards, { seed, isDeck }) -> [question]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);
  const tq = () => dep('tableQuestions', './table-questions.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');

  const REMARKS_COLUMN_RE = /^(?:notes?|comments?|remarks?)$/i;
  // Elliptical/aside table remarks ("Also silver stain...", "need paired!") cannot stand alone as clear MC options.
  const ELLIPTICAL_NOTE_RE = /^(?:also|however|moreover|furthermore|still|too)\b|!/i;
  const MIN_DISTRACTORS = 3;
  const MAX_NOTE_CHARS = 80;
  const MIN_SHARED_CHARS = 6; // "specific" inside "serospecific": one word inside another is the same remark

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const bare = (name) => String(name || '').replace(/\s*\([^)]*\)$/, '');
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/(\w)-\s+(\w)/g, '$1-$2').trim();

  /** Do two remarks share a word, or one word sit inside another ("specific" in "serospecific")? */
  function related(a, b) {
    const parts = (s) => qf().contentStems(s).flatMap((w) => [w, ...w.split('-')]).filter((w) => w.length >= 3);
    const wa = parts(a);
    const wb = parts(b);
    return wa.some((x) => wb.some((y) => x === y || (x.length >= MIN_SHARED_CHARS && y.includes(x)) || (y.length >= MIN_SHARED_CHARS && x.includes(y))));
  }

  function candidates(cards, opts = {}) {
    const seed = opts.seed || 0;
    // One entry per table (its header text and page) and row: the row as a table card recorded it.
    const tables = new Map();
    for (const c of cards || []) {
      if (!c || !c.table || c.sourceKind !== 'table' || !Array.isArray(c.table.row) || !Array.isArray(c.table.header)) continue;
      const col = c.table.header.findIndex((h) => REMARKS_COLUMN_RE.test(String(h || '').trim()));
      if (col <= 0) continue;
      const key = `${c.table.key}@${c.pageNumber || c.page}`;
      if (!tables.has(key)) tables.set(key, { header: c.table.header, col, page: c.pageNumber || c.page || null, rows: new Map() });
      tables.get(key).rows.set(norm(c.table.row[0]), { row: c.table.row, entity: c.table.entity, card: c });
    }
    const out = [];
    for (const t of tables.values()) {
      const rows = [...t.rows.values()];
      for (const { row, entity, card } of rows) {
        const answer = tidy(row[t.col]);
        if (!answer || answer.length > MAX_NOTE_CHARS || ELLIPTICAL_NOTE_RE.test(answer) || !tq().usableHeader(t.header[0])) continue;
        const value = bare(row[0]);
        const others = rows.filter((r) => r.row !== row);
        // The stem's value must pick out one row, and no option may come from a row that holds it.
        if (others.some((r) => tq().overlaps(bare(r.row[0]), value))) continue;
        const pool = others.filter((r) => !r.row.some((cell) => cell && tq().overlaps(bare(cell), value)))
          .map((r) => tidy(r.row[t.col]))
          .filter((n) => n && n.length <= MAX_NOTE_CHARS && !ELLIPTICAL_NOTE_RE.test(n) && norm(n) !== norm(answer) && !related(n, answer) && !related(n, value));
        const wrong = shuffle([...new Map(pool.map((n) => [norm(n), n])).values()], `${card.front}|notes`, seed).slice(0, MIN_DISTRACTORS);
        if (wrong.length < MIN_DISTRACTORS) continue;
        const column = String(t.header[t.col]).trim();
        const shown = tq().qualifiedEntity ? tq().qualifiedEntity(card.table) : entity;
        const question = `In the row where ${String(t.header[0]).trim()} is "${shown}", what do the ${column} say?`;
        const source = `${entity} — ${column}: ${answer}`;
        out.push({
          type: 'multiple_choice', badge: 'Multiple Choice • Table', question,
          options: shuffle([answer, ...wrong], question, seed), answer,
          explanation: `${entity} — ${column}: ${answer}${t.page ? ` (${opts.isDeck ? 'slide' : 'p.'} ${t.page})` : ''}`,
          skill: 'definition', category: 'Comparison', subject: entity, source,
          factKey: `t|${norm(source)}`, page: t.page, pageNumber: t.page,
        });
      }
    }
    return out;
  }

  const api = { candidates, related };
  PDFStudy.tableNotes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

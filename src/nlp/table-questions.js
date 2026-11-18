/**
 * Table Questions: a comparison table asked down one column. The wrong options are the same column's values in
 * other rows, so they are the same kind of thing as the answer and, being another row's value, false for the
 * row asked about:
 *   What is the sample for "PCR"?   Blood (urine) | Clotted blood | Kidney, Liver | Blood, urine
 * A value is never offered against an answer it overlaps: "Dogs" is not wrong for "Dogs, Cats", and two rows
 * that share an item ("Snail") cannot be told apart by it; nor is a lone class-like cell ("Carnivores") set against a
 * list of members ("Dogs, Cats") or the other way round. A column whose values are all alike asks nothing, nor
 * does a column of remarks ("Notes") or one whose header is two headers read as one.
 *
 * candidates(cards, { seed, factOf }) -> [question]   cards carry `table` (table-cards.js rowCards)
 *   factOf(source) -> the quiz fact built from the same card (its identity becomes the question's factKey,
 *   so the same cell is not asked again as a "which statement is true" question)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const MIN_DISTRACTORS = 2;
  const MAX_DISTRACTORS = 3;
  const MAX_OPTION_CHARS = 80; // a longer cell is a note, not a value to choose
  const MIN_ITEM_CHARS = 3;
  const LENGTH_TELL_RATIO = 1.5; // with LENGTH_TELL_CHARS: how much longer than the answer a wrong option may be
  const LENGTH_TELL_CHARS = 10;
  // A column of remarks holds no values to choose between.
  const REMARKS_COLUMN_RE = /^(?:notes?|comments?|remarks?|other|misc\.?|details?|description)$/i;
  // "Assay target Notes": a lower-case word then a capitalised one inside a header cell is two headers read as one.
  const GLUED_HEADER_RE = /\b[a-z][a-z.]*\s+[A-Z][a-z]/;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  /** "Dogs, Cats, Humans" -> {dogs, cats, humans}; "Blood (urine)" -> {blood, urine}. */
  const items = (value) => new Set(String(value).split(/[,;/()]|\band\b|\bor\b/i).map(norm).filter((w) => w.length >= MIN_ITEM_CHARS));
  /** A header in title case read inside a sentence: "Definitive Host(s)" -> "definitive host(s)"; "PCR" stays. */
  // A header's plural mark ("Host(s)") is dropped: "the definitive host for ..." reads as a question.
  const lowerFirst = (s) => String(s).replace(/\(s\)/g, '').replace(/\b([A-Z])([a-z]+)/g, (w, a, b) => a.toLowerCase() + b);

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

  function candidates(cards, opts = {}) {
    const columns = new Map();
    for (const c of cards || []) {
      if (!c || !c.table || c.sourceKind !== 'table') continue;
      if (REMARKS_COLUMN_RE.test(c.table.column.trim()) || GLUED_HEADER_RE.test(c.table.column)) continue;
      const key = `${c.table.key}#${c.table.columnIndex}`;
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(c);
    }
    const out = [];
    for (const list of columns.values()) {
      const sideBySide = classSafe(list.map((c) => String(c.back || '').trim()));
      for (const card of list) {
        const answer = String(card.back || '').trim();
        if (!answer || answer.length > MAX_OPTION_CHARS) continue;
        const pool = [...new Map(list.filter((o) => o !== card).map((o) => [norm(o.back), String(o.back).trim()])).values()]
          .filter((v) => v.length <= MAX_OPTION_CHARS && !overlaps(v, answer) && sideBySide(v, answer))
          // A wrong option far longer than the answer stands out as wrong (or, the other way round, as right).
          .filter((v) => v.length <= Math.max(answer.length * LENGTH_TELL_RATIO, answer.length + LENGTH_TELL_CHARS));
        const wrong = shuffle(pool, card.front, opts.seed || 0).slice(0, MAX_DISTRACTORS);
        if (wrong.length < MIN_DISTRACTORS) continue;
        const question = `What is the ${lowerFirst(card.table.column)} for "${card.table.entity}"?`;
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

  const api = { candidates, overlaps };
  PDFStudy.tableQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

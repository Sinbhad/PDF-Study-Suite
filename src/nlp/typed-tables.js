/**
 * Typed Tables: one cell of a comparison table asked as a typed question (the student types the value and the app
 * checks it, typed-check.js), under the table rules of table-questions.js (both headers named, the row value picks out
 * one row). DOM-free. A cell is asked only when the set of right answers can be stated honestly:
 *   - a single value of 1-4 words or a number: no list, no remark, no alternatives
 *   - never under a clipped header ("Maint.") or one that names a part of a table ("Row")
 *   - the row is named by a whole name: a fragment ("hepatica (Fasciolidae)" under "Fasciola") is not one
 *   - not in a column whose other cells give alternatives ("Serum/EDTA", "Blood (urine)"): there a single value is
 *     one way of saying it among others the table does not list
 *   - not a plural class ("Ruminants") in a column whose other cells list members ("Deer, Sheep, Cattle")
 *   - not the generic whole the column's other values are parts of ("Bacteria" beside "Bacterial DNA")
 *   - a value of two or more words is asked only when its head noun is shared with another value of the column (the
 *     modifier is then what is asked: "Compact bone" / "Spongy bone") or its modifier is (the head is then what is
 *     asked, and the head alone is right too: "DNA" for "Bacterial DNA"); a modifier and head both its own
 *     ("Knee cartilage") would make "cartilage" half an answer and its synonyms unknowable
 *
 * tables(cards, ctx) -> [question]     ctx: { factOf(source) }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const tq = () => dep('tableQuestions', './table-questions.js');
  const shape = () => dep('typedShape', './typed-shape.js');
  const forms = () => dep('typedForms', './typed-forms.js');
  const values = () => dep('typedValues', './typed-values.js');

  const MAX_ANSWER_WORDS = 4;
  const LIST_CELL_RE = /[,;/()]|\band\b|\bor\b|&/i;
  const ALTERNATIVES_RE = /\/|\(|\bor\b/i;
  const MEMBER_LIST_RE = /,/;
  const TERM_CELL_RE = /^[A-Za-z][A-Za-z0-9 '’.-]*$/;
  const ABBREVIATED_HEADER_RE = /^[A-Z][a-z]{0,8}\.(?:\s|$)|\s\.\?*$|\.$/;
  const MIN_HEAD_CHARS = 3;
  const MIN_STEM_CHARS = 5;
  const TABLE_WORD_RE = /^(?:tables?|rows?|columns?|cells?|entry|entries|items?|values?)$/i;
  // Assay/diagnostic row tables ask free-text targets/purposes with many equivalent lab phrasings ("DNA", "Bacterial DNA",
  // "leptospiral DNA"): keep those as comparison MCQs or study cards, never brittle exact-string typed blanks.
  const ASSAY_HEADER_RE = /^(?:assay|test|method|diagnostic|procedure|technique)s?$/i;
  const FREE_TEXT_TARGET_COL_RE = /^(?:target|purpose|goal|indication|mechanism|principle|advantage|disadvantage|limitation)s?$/i;
  const ADJECTIVE_END_RE = /(?:ial|al|ic|ous|ar|ary|ive)$/;
  const PLURAL_END_RE = /(?:ae|um|us|a|i|es|s)$/;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => norm(s).split(' ').filter(Boolean);
  const pageOf = (card) => card.pageNumber || card.page || null;

  /** A plural noun: it is not its own singular ("Ruminants", "Bacteria"; not "Crayfish"). */
  const isPlural = (w) => [...forms().lemmas(w)].some((x) => x !== w);

  /** "Bacteria" beside "Bacterial DNA": the cell is the whole that the column's other values are parts of. */
  function genericWhole(answer, others) {
    const w = words(answer);
    if (w.length !== 1) return false;
    const stem = w[0].replace(PLURAL_END_RE, '');
    if (stem.length < MIN_STEM_CHARS) return false;
    return others.some((v) => words(v).slice(0, -1).some((m) => {
      const ms = m.replace(ADJECTIVE_END_RE, '');
      return ms.length >= MIN_STEM_CHARS && (ms.startsWith(stem) || stem.startsWith(ms));
    }));
  }

  /**
   * For a value of two or more words: 'head' when its modifier is shared with another value (the head alone is right
   * too), 'modifier' when its head is shared (the whole value must be typed), '' when neither is (not asked).
   */
  function whatIsAsked(answer, others) {
    const w = words(answer);
    if (w.length < 2) return 'single';
    const head = forms().singular(w[w.length - 1]);
    const otherWords = others.map(words);
    if (otherWords.some((o) => o.length && forms().singular(o[o.length - 1]) === head)) return 'modifier';
    const mods = w.slice(0, -1);
    if (otherWords.some((o) => o.slice(0, -1).some((m) => mods.includes(m)))) return 'head';
    return '';
  }

  /** Why the cell may not be asked typed ('' when it may). */
  function cellRefusal(card, answer, others, isNumber) {
    const t = card.table;
    if ([t.header[0], t.column].some((h) => ABBREVIATED_HEADER_RE.test(String(h || '').trim()))) return 'clipped header';
    if ([t.header[0], t.column].some((h) => TABLE_WORD_RE.test(String(h || '').trim()))) return 'header names a part of the table';
    if (!isNumber && (ASSAY_HEADER_RE.test(String(t.header[0] || '').trim()) || FREE_TEXT_TARGET_COL_RE.test(String(t.column || '').trim()))) {
      return 'assay or open target cell';
    }
    // The row is named by a fragment: lower case where the other rows' names are capitalised.
    const rowName = String(t.entity || '').trim();
    if (/^[a-z]/.test(rowName)) return 'row named by a fragment';
    if (isNumber) return '';
    if (LIST_CELL_RE.test(answer) || words(answer).length > MAX_ANSWER_WORDS || !TERM_CELL_RE.test(answer)) return 'not a single value';
    if (others.some((v) => ALTERNATIVES_RE.test(v))) return 'column gives alternatives';
    const last = words(answer).pop() || '';
    if (isPlural(last) && others.some((v) => MEMBER_LIST_RE.test(v))) return 'a class where the column lists members';
    if (genericWhole(answer, others)) return 'the generic whole of the column';
    return whatIsAsked(answer, others) ? '' : 'modifier and head both its own';
  }

  function tables(cards, ctx = {}) {
    const out = [];
    for (const card of cards || []) {
      if (!card || !card.table || card.sourceKind !== 'table' || !tq().isAskableColumn(card)) continue;
      const answer = String(card.back || '').trim();
      const question = tq().stemFor(card);
      if (!question || !answer || !tq().rowIsUnique(card, cards)) continue;
      const isNumber = values().numberWithUnit(answer) || /^\d+(?:\.\d+)?$/.test(answer);
      const others = tq().columnValues(card, cards).filter((v) => norm(v) !== norm(answer));
      // A value another row also holds is fine (several flukes share a host); one the column never varies in asks nothing.
      if (!others.length) continue;
      const why = cellRefusal(card, answer, others, isNumber);
      if (why) {
        if (ctx.trace) ctx.trace(answer, why);
        continue;
      }
      const source = `${card.front}: ${answer}`;
      const fact = ctx.factOf ? ctx.factOf(source) : null;
      const head = words(answer).length > 1 ? words(answer).pop() : '';
      const headOk = !isNumber && head.length >= MIN_HEAD_CHARS && whatIsAsked(answer, others) === 'head';
      out.push(shape().make({
        badge: 'Type the Answer • Table', question, answer, form: isNumber ? 'number' : 'term', others, accept: headOk ? [head] : [],
        explanation: `${card.table.entity} — ${card.table.column}: ${answer}`, subject: card.table.entity, source,
        factKey: fact ? fact.identity : `t|${norm(source)}`, page: pageOf(card),
      }));
    }
    return out;
  }

  const api = { tables, whatIsAsked, genericWhole };
  PDFStudy.typedTables = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Summary damage: the extraction marks a glyph it could not read with "¿" (a lost prefix, a complement bar).
 * That mark is never shown to a student. On the finished summary (summarizer.js):
 *   - an item whose heading or term holds the mark (a bullet "¿encephalitis: inflammation of ...", a defined
 *     term, a table's header) is dropped: what it names cannot be read;
 *   - anywhere else the damaged word is replaced by the words "[unreadable symbol]".
 *   clean(summary) -> the same summary object, cleaned in place
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MARK = '¿';
  const MARK_RE = /¿/;
  const NOTE = '[unreadable symbol]';
  // How far into a line its heading reaches: "Term:" or "Term –", else the first words
  const HEAD_WORDS = 3;

  /** The damaged word in running text becomes NOTE; a formula holding it loses only the mark's word. */
  function mend(text) {
    if (typeof text !== 'string' || !MARK_RE.test(text)) return text;
    // Inside $...$ the mark cannot be replaced by words without breaking the formula: the formula goes
    const noMath = text.replace(/\$\$[^$]*¿[^$]*\$\$|\$[^$]*¿[^$]*\$/g, NOTE);
    return noMath.replace(/[^\s$]*¿[^\s$]*/g, NOTE).replace(/(?:\[unreadable symbol\]\s*){2,}/g, `${NOTE} `).replace(/\s+/g, ' ').trim();
  }

  /** The mark sits in the line's heading ("¿encephalitis: ...", or among its first words). */
  function headed(text) {
    const t = String(text || '').replace(/\*\*/g, '');
    if (!MARK_RE.test(t)) return false;
    const label = t.match(/^([^:–—]{1,40})[:–—]/);
    if (label) return MARK_RE.test(label[1]);
    return MARK_RE.test(t.split(/\s+/).slice(0, HEAD_WORDS).join(' '));
  }

  const keepPoint = (b) => !(b && headed(typeof b === 'string' ? b : b.text));

  function cleanPoint(b) {
    if (typeof b === 'string') return mend(b);
    const out = { ...b, text: mend(b.text) };
    if (Array.isArray(b.children)) out.children = b.children.filter(keepPoint).map(cleanPoint);
    if (Array.isArray(b.more)) out.more = b.more.filter(keepPoint).map(cleanPoint);
    return out;
  }

  function cleanTable(t) {
    if (!t || !Array.isArray(t.rows)) return t;
    // A row whose first cell (its name) is damaged goes; other cells are mended
    const rows = t.rows.filter((r, i) => i === 0 || !MARK_RE.test(String(r[0] || ''))).map((r) => r.map(mend));
    return { ...t, rows };
  }

  function cleanOutline(o) {
    if (!o) return o;
    if (Array.isArray(o.covers)) o.covers = o.covers.filter(keepPoint).map((c) => ({ ...c, text: mend(c.text), ...(c.answers ? { answers: c.answers.map(mend) } : {}) }));
    if (Array.isArray(o.terms)) o.terms = o.terms.filter((t) => !MARK_RE.test(t.term));
    for (const sec of o.sections || []) {
      sec.title = mend(sec.title);
      for (const tp of sec.topics || []) {
        tp.title = mend(tp.title);
        for (const e of tp.slides || []) {
          e.title = mend(e.title);
          e.bullets = (e.bullets || []).filter(keepPoint).map(cleanPoint);
          e.more = (e.more || []).filter(keepPoint).map(cleanPoint);
          if (e.table) e.table = cleanTable(e.table);
          if (e.qa) e.qa = e.qa.map((q) => ({ ...q, question: mend(q.question), answer: mend(q.answer) }));
        }
      }
      if (sec.blocks) sec.blocks = sec.blocks.filter((b) => !MARK_RE.test(b.title || '')).map((b) => ({ ...b, body: mend(b.body), terms: (b.terms || []).filter((t) => !MARK_RE.test(t)) }));
      if (sec.definitions) sec.definitions = sec.definitions.filter((d) => !MARK_RE.test(d.term)).map((d) => ({ ...d, text: mend(d.text) }));
      if (sec.formulas) sec.formulas = sec.formulas.filter((f) => !MARK_RE.test(f.body)).map((f) => ({ ...f, title: mend(f.title) }));
      if (sec.tables) sec.tables = sec.tables.map(cleanTable);
      if (sec.statements) sec.statements = sec.statements.filter((s) => !headed(s.text)).map((s) => ({ ...s, text: mend(s.text) }));
    }
    return o;
  }

  function clean(summary) {
    if (!summary || !JSON.stringify(summary).includes(MARK)) return summary;
    for (const k of ['sentences', 'overviewSentences']) {
      if (Array.isArray(summary[k])) summary[k] = summary[k].filter((s) => !headed(s)).map(mend);
    }
    if (Array.isArray(summary.keyTerms)) summary.keyTerms = summary.keyTerms.filter((t) => !MARK_RE.test(t));
    if (Array.isArray(summary.definitions)) summary.definitions = summary.definitions.filter((d) => !MARK_RE.test(d.term)).map((d) => ({ ...d, definition: mend(d.definition) }));
    if (Array.isArray(summary.keyFormulas)) summary.keyFormulas = summary.keyFormulas.filter((f) => !JSON.stringify(f).includes(MARK));
    if (Array.isArray(summary.slideBreakdown)) {
      summary.slideBreakdown = summary.slideBreakdown.map((s) => ({ ...s, title: mend(s.title), takeaways: (s.takeaways || []).filter((t) => !headed(t)).map(mend) }));
    }
    cleanOutline(summary.outline);
    return summary;
  }

  const api = { clean, mend, headed };
  PDFStudy.summaryDamage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

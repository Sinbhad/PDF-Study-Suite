/**
 * Book law table: a numbered list of laws the book prints as a table of two columns (each law beside its
 * pair, "1. X + 0 = X | 2. X · 1 = X") with the laws' names at the end of some rows ("Commutative",
 * "DeMorgan's"). Read from where the numbers sit on the page, never from the subject, so the columns and the
 * row names survive instead of being flattened into one numbered list.
 *   build(pages, cells, { title, paired }) -> null | { title, rows, more: 0, page }
 *     pages: raw extracted pages ({ pageNumber, lines: [{ text, x0, x1, topY, isMargin, segments? }] })
 *     cells: Map(number -> the law as shown, "1. $X + 0 = X$")
 *     paired: the text calls the second column the first one's dual: the header says so
 * Only a list where at least MIN_PAIRED_ROWS rows hold two numbered laws side by side is a table. DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MIN_PAIRED_ROWS = 2;
  // A row's name sits level with it: this close vertically (points)
  const NAME_REACH = 2.5;
  // A row name is a word or two ("Commutative", "DeMorgan's"), not a sentence
  const NAME_RE = /^[A-Z][A-Za-z’'-]+(?:\s+[A-Za-z’'-]+)?$/;
  const NUMBER_RE = /(?:^|\s)(\d{1,2})\s*\.\s/g;

  /** Every numbered law printed on the pages: { n, page, top, order (position on its line), x }. */
  function placements(pages, cells) {
    const out = [];
    for (const p of pages || []) {
      for (const line of (p && p.lines) || []) {
        if (!line || line.isMargin || !Number.isFinite(line.topY)) continue;
        const text = String(line.text || '');
        if (!/=/.test(text)) continue; // a law states an equation; "1. These changes are ..." is prose
        let order = 0;
        for (const m of text.matchAll(NUMBER_RE)) {
          const n = Number(m[1]);
          if (!cells.has(n) || out.some((o) => o.n === n)) continue;
          const seg = (line.segments || []).find((s) => new RegExp(`^${n}\\s*\\.`).test(String(s.text || '').trim()));
          const x = seg ? seg.x0 : order === 0 ? line.x0 : null;
          out.push({ n, page: p.pageNumber, top: line.topY, order, x, right: line.x1 });
          order += 1;
        }
      }
    }
    return out;
  }

  function nameBeside(pages, row) {
    const page = (pages || []).find((p) => p && p.pageNumber === row.page);
    const hit = ((page && page.lines) || []).find((l) => l && l.isMargin && Number.isFinite(l.topY) &&
      Math.abs(l.topY - row.top) <= NAME_REACH && NAME_RE.test(String(l.text || '').trim()));
    return hit ? String(hit.text).trim() : '';
  }

  function build(pages, cells, opts = {}) {
    const placed = placements(pages, cells);
    if (!placed.length) return null;
    // The second column starts where the laws printed second on their line start
    const seconds = placed.filter((p) => p.order === 1 && Number.isFinite(p.x)).map((p) => p.x);
    if (!seconds.length) return null;
    const secondX = Math.min(...seconds);
    const rows = [];
    for (const p of placed) {
      let row = rows.find((r) => r.page === p.page && Math.abs(r.top - p.top) <= 1);
      if (!row) {
        row = { page: p.page, top: p.top, cols: ['', ''] };
        rows.push(row);
      }
      const col = p.order === 1 || (Number.isFinite(p.x) && p.x >= secondX - 5) ? 1 : 0;
      row.cols[col] = cells.get(p.n);
    }
    if (rows.filter((r) => r.cols[0] && r.cols[1]).length < MIN_PAIRED_ROWS) return null;
    rows.sort((a, b) => a.page - b.page || a.top - b.top);
    const names = rows.map((r) => nameBeside(pages, r));
    const named = names.some(Boolean);
    const header = ['Law', opts.paired ? 'Dual' : 'Paired law', ...(named ? ['Name'] : [])];
    const body = rows.map((r, i) => [...r.cols, ...(named ? [names[i]] : [])]);
    return { title: opts.title || '', rows: [header, ...body], more: 0, page: rows[0].page };
  }

  const api = { build };
  PDFStudy.bookLawTable = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

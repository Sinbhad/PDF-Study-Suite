/**
 * Book placement: which of a textbook scope's headed sections (book-sections.js) each tagged block and each
 * table belongs under, for book-outline.js. A float (a table, a box) is often printed a page or two after
 * the text it belongs to, so the book's own words decide first: the box's paragraphs, the table the text
 * names ("as shown in Table 2-4"), a margin note's position; the page is the last resort.
 *   blocks(split, blocks, pages) -> Map(section -> [block])
 *   tables(split, tables, labelOf) -> Map(section -> [table])   labelOf(table) -> "Table 2-4" | ''
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const norm = (s) => String(s || '').toLowerCase().replace(/\*\*|__|\$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

  /** The last heading that starts on or before `page`; a table on the first page goes to the first heading. */
  const byPage = (split, page) => [...split].reverse().find((s) => s.page <= (page || 0)) || split[0];

  /** The section whose heading is printed last above a margin note's top (same page or an earlier one). */
  function besideHeading(split, pages, box) {
    const yOf = (s) => {
      const page = (pages || []).find((p) => p && p.pageNumber === s.page);
      const line = page && (page.lines || []).find((l) => !l.isMargin && norm(l.text) === norm(s.title));
      return line && Number.isFinite(line.topY) ? line.topY : null;
    };
    let home = null;
    for (const s of split) {
      if (!s.title || s.page > box.page) continue;
      if (s.page < box.page) { home = s; continue; }
      const y = yOf(s);
      if (y === null) return null; // a heading on the note's page whose place is unknown: do not guess
      if (y <= box.top + 2) home = s;
    }
    return home;
  }

  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };

  /**
   * Each block goes under the heading whose paragraphs the extraction filed it in (blockId), else under the
   * heading whose text holds the block's opening words, else under the last heading on or before its page.
   */
  function blocks(split, list, pages) {
    const out = new Map();
    for (const b of list || []) {
      const probe = norm(`${b.title || ''} ${b.body || ''}`).slice(0, 40);
      // A note in the margin is read after its page's main text, so it is filed by where it is printed:
      // under the last heading above it on its page (or on an earlier page)
      const byPosition = b.kind === 'key-concept' && b.bbox ? besideHeading(split, pages, b.bbox) : null;
      const byId = byPosition || (b.id && split.find((s) => s.paragraphs.some((p) => p.blockId === b.id)));
      const byText = !byId && probe.length >= 12 && split.find((s) => s.paragraphs.some((p) => norm(p.text).includes(probe.slice(0, 24))));
      const home = byId || byText || byPage(split, b.pageNumber || b.page);
      if (home) add(out, closingBoxHome(split, home, b) || home, b);
    }
    return out;
  }

  const numberOf = (s) => (String((s && s.title) || '').match(/^(\d+(?:[.\-]\d+)+)\s/) || [])[1] || '';
  const depth = (n) => n.split(/[.\-]/).length;
  // Prose of at least this many words after a box means the box sits inside its subsection's text
  const TRAILING_PROSE_WORDS = 25;

  /**
   * A box printed after the last subsection's text, where its numbered section ends ("Common Error 7.2" after
   * 7.1.4, just before "7.2"), belongs to that section, not to the subsection it happens to follow.
   */
  function closingBoxHome(split, home, block) {
    const num = numberOf(home);
    const at = split.indexOf(home);
    const next = split.slice(at + 1).find((s) => numberOf(s));
    if (!num || depth(num) < 3 || !next || depth(numberOf(next)) >= depth(num)) return null;
    const parentNum = num.split(/([.\-])/).slice(0, -2).join('');
    const parent = split.find((s) => numberOf(s) === parentNum);
    if (!parent) return null;
    const idx = home.paragraphs.findIndex((p) => p.blockId && p.blockId === block.id);
    if (idx < 0) return null;
    const after = home.paragraphs.slice(idx + 1).filter((p) => p.kind === 'prose').reduce((n, p) => n + String(p.text || '').split(/\s+/).length, 0);
    return after < TRAILING_PROSE_WORDS ? parent : null;
  }

  /**
   * The section whose own prose names the table ("Table 2-4 lists ...", "shown in Table 2"); of several, the
   * one starting nearest the table's page (a passing "(see Table 1)" pages earlier is not its home).
   */
  function namedIn(split, label, page) {
    if (!label) return null;
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')}(?![\\d.-]*\\d)`, 'i');
    const naming = split.filter((s) => s.paragraphs.some((p) => p.kind !== 'table' && re.test(String(p.text || ''))));
    const gap = (s) => Math.abs((s.page || 0) - (page || 0));
    return naming.reduce((best, s) => (!best || gap(s) < gap(best) ? s : best), null);
  }

  function tables(split, list, labelOf) {
    const out = new Map();
    for (const t of list || []) {
      const label = labelOf ? labelOf(t) : '';
      const where = split.find((s) => s.paragraphs.some((p) => p.kind === 'table' && p.page === t.pageNumber &&
        norm(p.text).includes(norm((t.rows && t.rows[0] && t.rows[0][0]) || '').slice(0, 20))));
      const home = namedIn(split, label, t.pageNumber) || where || byPage(split, t.pageNumber);
      if (home) add(out, home, t);
    }
    return out;
  }

  const api = { blocks, tables, byPage };
  PDFStudy.bookPlacement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

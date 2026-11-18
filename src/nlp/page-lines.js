/**
 * Page lines: ties each line of a scope's cleaned text back to the raw extracted line it came from, so the
 * summary knows its page, its type size and what the cleaner dropped around it. DOM-free.
 *   index(pages)        -> flat raw lines [{ key, page, body, fontSize, isBold, isMargin, x0, topY, text, boxName? }]
 *   align(lines, raws)  -> per cleaned line { raw, skipped } (skipped: raw lines dropped just before it)
 *   leftEdges(aligned)  -> Map(page -> most common left edge of its prose lines)
 *   bodySize(page)      -> the page's body text size
 * pages: [{ pageNumber, lines: [{ text, fontSize, isBold, isMargin, x0, topY }] }]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // How far ahead (in raw lines) to look for the raw line a cleaned line came from.
  const ALIGN_WINDOW = 400;
  // A short line ("Buyer", "SKU") matches too easily: it is looked for only this close to where we are.
  const SHORT_ALIGN_WINDOW = 40;
  // Characters compared when a cleaned line is a merged or trimmed version of the raw line.
  const ALIGN_PREFIX = 24;
  // A margin label names the main line within this many of its font sizes vertically.
  const LABEL_REACH = 1.5;

  // A numbered box label the cleaner set apart (often in the margin): "Definition 1", "THEOREM 2.3".
  const BOX_NAME_RE = /^(Definition|Theorem|Lemma|Corollary|Proposition|Law|Rule|Principle|Postulate|Axiom)s?\s+(\d+(?:[.\-]\d+)*)\.?$/i;

  const norm = (s) => String(s || '').replace(/\*\*|__|\$|\\[a-zA-Z]+/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').trim();

  /** Character-weighted most common font size of a page: its body text size. */
  function bodySize(page) {
    const counts = new Map();
    for (const l of page.lines || []) {
      if (!l || !l.fontSize || l.isMargin) continue;
      const k = Math.round(l.fontSize * 2) / 2;
      counts.set(k, (counts.get(k) || 0) + String(l.text || '').length);
    }
    let best = 0;
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return best;
  }

  /** Flat list of raw lines with page, body size and a comparison key. */
  function index(pages) {
    const out = [];
    for (const p of pages || []) {
      if (!p || !Array.isArray(p.lines)) continue;
      const body = bodySize(p);
      for (const l of p.lines) {
        const key = norm(l.text);
        if (key) out.push({ key, page: p.pageNumber, body, fontSize: l.fontSize || 0, isBold: !!l.isBold, isMargin: !!l.isMargin, x0: l.x0, topY: l.topY, text: plain(l.text) });
      }
    }
    labelBoxes(out);
    return out;
  }

  /**
   * A box label printed in the margin ("Definition 1") names the main-flow line level with it: that line
   * opens the box. Sets `boxName` ([label, category, number]) on the main line.
   */
  function labelBoxes(raws) {
    for (const label of raws) {
      const m = label.isMargin && label.text.match(BOX_NAME_RE);
      if (!m || !Number.isFinite(label.topY)) continue;
      const reach = (label.fontSize || 10) * LABEL_REACH;
      let best = null;
      for (const r of raws) {
        if (r.page !== label.page || r.isMargin || !Number.isFinite(r.topY)) continue;
        const d = Math.abs(r.topY - label.topY);
        if (d <= reach && (!best || d < Math.abs(best.topY - label.topY))) best = r;
      }
      if (best) best.boxName = m;
    }
  }

  function sameLine(r, key, head) {
    return r.key === key || (head.length >= 12 && r.key.length >= 12 && (r.key.startsWith(head) || key.startsWith(r.key.slice(0, ALIGN_PREFIX))));
  }

  /**
   * For each cleaned line: { raw, skipped }. Margin notes come after the main flow in the cleaned text, so a
   * line not found ahead is looked up among the margin lines of the whole scope.
   */
  function align(lines, raws) {
    let cursor = 0;
    const margins = raws.filter((r) => r.isMargin);
    return lines.map((line) => {
      const key = norm(line);
      if (key.length < 3) return { raw: null, skipped: [] };
      const head = key.slice(0, ALIGN_PREFIX);
      const end = Math.min(raws.length, cursor + (key.length >= 12 ? ALIGN_WINDOW : SHORT_ALIGN_WINDOW));
      for (let i = cursor; i < end; i++) {
        if (!sameLine(raws[i], key, head)) continue;
        const skipped = raws.slice(cursor, i);
        cursor = i + 1;
        return { raw: raws[i], skipped };
      }
      const margin = margins.find((r) => sameLine(r, key, head));
      return { raw: margin || null, skipped: [] };
    });
  }

  /** Typical left edge of prose lines on each page. */
  function leftEdges(aligned) {
    const byPage = new Map();
    for (const a of aligned) {
      if (!a.raw || !Number.isFinite(a.raw.x0)) continue;
      const list = byPage.get(a.raw.page) || [];
      list.push(Math.round(a.raw.x0));
      byPage.set(a.raw.page, list);
    }
    const edges = new Map();
    for (const [page, xs] of byPage) {
      const counts = new Map();
      xs.forEach((x) => counts.set(x, (counts.get(x) || 0) + 1));
      edges.set(page, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
    }
    return edges;
  }

  const api = { index, align, leftEdges, bodySize, BOX_NAME_RE };
  PDFStudy.pageLines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

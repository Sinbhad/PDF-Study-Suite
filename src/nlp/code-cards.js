/**
 * Code Cards: a programming section that teaches a family of algorithms one numbered heading each ("7.3.1
 * Filling", "7.3.2 Sum and Average Value", "7.3.5 Linear Search"), each with its short listing, as cards that
 * show the listing and ask which algorithm it carries out. The book itself names what each listing does (its
 * heading, and a lead sentence such as "This loop fills an array with squares"); nothing is guessed from the
 * code. Pure and DOM-free.
 *   fromScope({ text, lines, startPage }) -> [card]   card.rule: { kind: 'code', name, number, siblings, page }
 * Only a family of at least MIN_FAMILY listings with a loop counts, under a parent heading that names them as a
 * family ("Common Array Algorithms"). The cards are studied, not quizzed: a listing's own identifiers ("total",
 * "average", "inputs") often name the algorithm, so a choice question would give its answer away.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_FAMILY = 3;
  const MIN_ROWS = 2;
  const MAX_ROWS = 10;
  const NUMBERED_RE = /^(\d+(?:\.\d+){2,})\s+(.{3,50})$/;
  // Program statements, not program output or sample data ("32 | 54 | 67.5")
  const STATEMENT_RE = /[;{}]|\b(?:for|while|if|return)\s*\(|=/;
  // A figure's cell label printed beside a listing: "32 [0]", "65 [currentSize - 1]"
  const FIGURE_LABEL_RE = /^[.\s]*(?:\w+\s+)?[\d.]+\s*(?:\[[\w\s-]+\]\s*)+$/;
  const FAMILY_RE = /\b(?:algorithms|patterns|techniques|operations|idioms)\b/i;
  const LOOP_RE =/\b(?:for|while)\s*\(|\bdo\s*\{/;
  const UNIT_RE =/^\s*(?:module|class|entity|architecture|package|library|program|interface|public\s+class|def\s+main)\b/;
  // "This loop fills an array with squares": the book saying what the listing does
  const DESCRIBES_RE = /^(?:This|The\s+following)\s+(?:loop|code|method|algorithm|statement)s?\b[^.]{8,120}\./;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

  /** The rows of a short listing that is plainly code, or null. */
  function listing(p) {
    let rows = (p.lines || []).filter((l) => !/^```/.test(l.trim()) && l.trim())
      .map((l) => l.replace(/\s*[❶-❿➀-➉]\s*$/, '')).filter((l) => !FIGURE_LABEL_RE.test(l.trim()));
    if (rows.length && rows.every((r) => /^\s*\d{1,3}\s/.test(r))) rows = rows.map((r) => r.replace(/^\s*\d{1,3}\s/, ''));
    if (rows.length < MIN_ROWS || rows.length > MAX_ROWS || !rows.some((r) => STATEMENT_RE.test(r)) || UNIT_RE.test(rows[0])) return null;
    const all = rows.join('');
    if (all.split('{').length !== all.split('}').length || rows.some((r) => /\b\d+(?:\.\d+)?\s+\[[\w\s-]+\]/.test(r))) return null;
    if (rows.some((r) => /[a-z=]\.\s+[A-Z]/.test(r) || /^\s*[A-Za-z]+:\s*$/.test(r))) return null;
    // An algorithm visits the data: a listing without a loop is a declaration or a single test, not one of a family
    return LOOP_RE.test(rows.join('\n')) ? rows : null;
  }

  function fromScope({ text, lines, startPage } = {}) {
    const sections = dep('bookSections', './book-sections.js').split(String(text || ''), { lines, startPage });
    const found = [];
    for (const s of sections) {
      const m = plain(s.title).match(NUMBERED_RE);
      if (!m) continue;
      const at = s.paragraphs.findIndex((p) => p.kind === 'code' && listing(p));
      if (at < 0) continue;
      const lead = s.paragraphs.slice(0, at).filter((p) => p.kind === 'prose').map((p) => plain(p.text)).join(' ');
      const describes = (lead.match(DESCRIBES_RE) || [''])[0];
      found.push({ number: m[1], name: m[2].trim(), parent: m[1].replace(/\.\d+$/, ''), rows: listing(s.paragraphs[at]), describes, page: s.paragraphs[at].page || s.page || null });
    }
    // The parent heading must call its subsections a family ("7.3 Common Array Algorithms"); listings under the
    // subsections of an ordinary topic ("7.1 Arrays") are examples of it, not one algorithm each.
    const familyHeading = (parent) => sections.some((s) => {
      const m = plain(s.title).match(/^(\d+(?:\.\d+)*)\s+(.+)$/);
      return m && m[1] === parent && FAMILY_RE.test(m[2]);
    });
    const out = [];
    for (const f of found) {
      const family = found.filter((g) => g.parent === f.parent);
      if (family.length < MIN_FAMILY || !familyHeading(f.parent)) continue;
      out.push({
        front: `Which algorithm does this code carry out?\n\n\`\`\`\n${f.rows.join('\n')}\n\`\`\``,
        back: `${f.name} (section ${f.number})${f.describes ? `. ${f.describes}` : ''}`,
        category: 'Code', kind: 'concept', sourceKind: 'key-concept', subject: f.name, page: f.page, quote: f.rows[0],
        rule: { kind: 'code', name: f.name, number: f.number, siblings: family.filter((g) => g !== f).map((g) => g.name), page: f.page },
      });
    }
    return out;
  }

  const api = { fromScope, listing };
  PDFStudy.codeCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

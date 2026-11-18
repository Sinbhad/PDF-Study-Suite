/**
 * Deck terms: the key terms of a deck Summary (deck-outline.js), each linked to the bullet that defines it.
 * A term is one a slide defines head-first ("Term = ...", "**Term**: ...", "Term is ...") and that passes
 * key-terms.js realTerm (no fragments, identifiers or lecture furniture).
 *   link(definitions, sections, rawBy) -> [{ term, page, ref }]   (sets bullet.ref on the linked bullets; a
 *     held-back line that defines a term is moved into view so the link lands on it)
 *   usableTerm(term), labelledTerm(bulletText)
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** A name, not a clause, a date, a label or a code identifier (key-terms.js realTerm). */
  function usableTerm(term) {
    const t = String(term || '').trim();
    const kt = dep('keyTerms', './key-terms.js');
    if (!t || !/[A-Za-z]{4,}/.test(t) || (kt && !kt.realTerm(t))) return false;
    return !/\b(?:is|are|was|were|be|to|for|from|with|by|most|very)\b|\b(?:1[5-9]|20)\d\d\b/i.test(t);
  }

  /**
   * The term of a "Term: definition" / "Term = definition" bullet. A colon names a term only when the author
   * emphasised it ("**Coup**: same side as impact"); "Dogs: Dipylidium caninum" is a label of a list.
   */
  function labelledTerm(text) {
    const raw = String(text || '');
    const m = plain(raw).replace(/\$([^$]*)\$/g, '$1').match(/^([A-Z][^:=]{1,40}?)\s*(=|:)\s*(\S.{6,})$/);
    if (!m) return '';
    const term = m[1].trim();
    if (!usableTerm(term) || /[?()]/.test(term)) return '';
    if (m[2] === ':' && !/^\*\*[^*]+\*\*\s*:/.test(raw.trim()) && !/^\*\*[^*]*:/.test(raw.trim())) return '';
    const sn = dep('stemNoise', './stem-noise.js');
    if (sn && sn.isLabelTerm(term.replace(/\s+\d+$/, ''))) return '';
    return term;
  }

  function link(definitions, sections, rawBy) {
    const su = dep('slideUnits', './slide-units.js');
    const entries = new Map();
    sections.forEach((sec) => sec.topics.forEach((tp) => tp.slides.forEach((e) => entries.set(e.slide, e))));
    const terms = [];
    (definitions || []).forEach((d) => {
      const term = plain(d.term);
      const entry = entries.get(d.page);
      if (!usableTerm(term) || !entry || !norm(d.statement || d.definition).startsWith(norm(term))) return;
      const probe = norm(d.definition).slice(0, 30);
      const holds = (t) => norm(t).includes(norm(term)) && norm(t).includes(probe);
      let bullet = entry.bullets.find((b) => holds(b.text)) || null;
      if (!bullet) {
        const at = entry.more.findIndex((b) => holds(b.text));
        if (at >= 0) {
          bullet = entry.more.splice(at, 1)[0];
          entry.held -= 1 + bullet.children.length + bullet.more.length;
          entry.bullets.push(bullet);
        }
      }
      if (!bullet) {
        const node = su.nodesOf(rawBy.get(d.slideNumber || d.page), { bullets: [] }).find((n) => holds(n.text) && !n.isAnnotation);
        if (!node) return;
        bullet = { text: node.text, children: [], more: [] };
        entry.bullets.push(bullet);
      }
      bullet.ref = bullet.ref || `t${terms.length}`;
      terms.push({ term, page: entry.page, ref: bullet.ref });
    });
    // Bullets that name a term and define it: "**Coup**: same side as impact", "Type 1 = acute extrusion ...".
    const seen = new Set(terms.map((t) => norm(t.term)));
    entries.forEach((entry) => entry.bullets.forEach((b) => {
      const term = labelledTerm(b.text);
      if (!term || seen.has(norm(term))) return;
      seen.add(norm(term));
      b.ref = b.ref || `t${terms.length}`;
      terms.push({ term, page: entry.page, ref: b.ref });
    }));
    return terms;
  }

  const api = { link, usableTerm, labelledTerm };
  PDFStudy.deckTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

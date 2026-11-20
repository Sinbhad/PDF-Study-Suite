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

  const CASE_OR_GROUP_RE = /^(?:group\s*\d+|mild|moderate|severe|acute|chronic|dogs?|cats?|sheep|goats?|cattle|horses?|pigs?|swine|humans?|ruminants?|monogastrics?|pros|cons|live|killed(?:\s+\w+)*|all\s+\w+)$/i;
  const NON_DEF_TERM_RE = /^(?:at|during|before|after|on|in|for|by|with)\s+/i;
  const NON_DEF_BODY_RE = /^(?:do\s+not|never|always|avoid|keep|use|give|consider|these|those|this|they|it)\b|\b(?:contraindicated|advisable|administer(?:ed)?|injections?|series\s+of|intranasally|weeks?\s+apart|twice\s+daily|q\d+hrs?|hypersensitivity|\d+\s*(?:cc|ml|mg)\b)\b/i;
  const DEF_COPULA_RE = /\b(?:is|are|means|refers?\s+to|involves?|characterized\s+by|when)\b/i;
  const DEF_GENUS_RE = /^(?:(?:a|an|the)\s+)?(?:[a-z]+\s+){0,2}(?:inflammation|infection|disease|disorder|syndrome|lesion|condition|process|state|structure|layer|opening|shell|filling|extrusion|protrusion|collection|vasculitis|nephropathy|hemorrhage|abscess|tumou?r|cancer|defect|anomaly|reaction|method|technique|test|assay|organism|parasite|bacterium|virus|lymph\s+nodes?|side|variation)\b/i;

  /**
   * Parsed { term, definition } for "Term: definition", "Term - definition", or "Term = definition".
   * Rejects species/dose/clinical/instructional headings ("Dogs: ...", "At shows: Do not...", "Penicillin: long term...").
   */
  function labelledDefinition(text) {
    const raw = String(text || '');
    const boldHead = /^\*\*/.test(raw.trim());
    const cleaned = plain(raw).replace(/\$([^$]*)\$/g, '$1');
    const m = cleaned.match(/^([A-Z][^:=–—-]{1,40}?)(?:\s*(=|:|\s+—\s+|\s+–\s+|\s+-\s+|-\s+))\s*(\S.{11,})$/);
    if (!m) return null;
    const term = m[1].trim();
    const sep = m[2].trim();
    const def = m[3].trim();
    if (!usableTerm(term) || /[?()]/.test(term) || CASE_OR_GROUP_RE.test(term) || NON_DEF_TERM_RE.test(term)) return null;
    if ((def.match(/[A-Za-z]{3,}/g) || []).length < 3 || /^\d/.test(def) || NON_DEF_BODY_RE.test(def)) return null;
    if (!boldHead && sep !== '=' && !DEF_COPULA_RE.test(def) && !DEF_GENUS_RE.test(def)) return null;
    const qs = dep('quizSubjects', './quiz-subjects.js');
    if (qs && qs.isGenericHeading(term, {})) return null;
    const sh = dep('slideLineShapes', './slide-line-shapes.js');
    if (sh && sh.needsEntity(term)) return null;
    const sn = dep('stemNoise', './stem-noise.js');
    if (sn && sn.isLabelTerm(term.replace(/\s+\d+$/, ''))) return null;
    return { term, definition: def };
  }

  /** The term of a bolded or clean "Term: definition" / "Term - definition" / "Term = definition" bullet. */
  function labelledTerm(text) {
    const parsed = labelledDefinition(text);
    return parsed ? parsed.term : '';
  }

  function link(definitions, sections, rawBy) {
    const su = dep('slideUnits', './slide-units.js');
    const entries = new Map();
    sections.forEach((sec) => sec.topics.forEach((tp) => tp.slides.forEach((e) => entries.set(e.slide, e))));
    const terms = [];
    (definitions || []).forEach((d) => {
      const term = plain(d.term);
      const entry = entries.get(d.page);
      const fullDef = norm(d.statement || d.definition);
      if (!usableTerm(term) || !entry || !(fullDef.startsWith(norm(term)) || fullDef.includes(norm(term)))) return;
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
        const rawSlide = rawBy.get(d.slideNumber || d.page);
        const node = rawSlide ? su.nodesOf(rawSlide, rawSlide).find((n) => holds(n.text) && !n.isAnnotation) : null;
        if (!node) return;
        bullet = { text: node.text, children: [], more: [] };
        entry.bullets.push(bullet);
      }
      bullet.ref = bullet.ref || `t${terms.length}`;
      terms.push({ term, page: entry.page, ref: bullet.ref });
    });
    // Bullets that name a term and define it: "**Coup**: same side as impact", "Bastard strangles: ...", "Type 1 = ...".
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

  const api = { link, usableTerm, labelledTerm, labelledDefinition };
  PDFStudy.deckTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Card Fields: the shared shape every flashcard leaves the miners with, so the quiz can group, filter and
 * word questions by what a card is about rather than where it sat.
 *   { id, front, back, category, kind, context, pageNumber, page, topic,
 *     subject,     the entity the fact is about (drug, disease, structure, concept), never a generic title
 *     sourceKind } 'definition' | 'label' | 'list' | 'table' | 'note' | 'qa' | 'formula' | 'key-concept' | 'self-check'
 * finish(card, defaults) fills subject / sourceKind / page / topic without overwriting what a miner set.
 * sourceKindOf(category) maps the older category names onto sourceKind.
 * pageLocator(lines) -> (text) => the page a text is printed on, from extraction's scope.lines
 *   ([{ text, pageNumber }]); null when the text cannot be found. A card or a question mined from running
 *   text has no page of its own: this finds it, so "View p. N" can be offered for it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SOURCE_KINDS = new Set(['definition', 'label', 'list', 'table', 'note', 'qa', 'formula', 'key-concept', 'self-check']);
  const BY_CATEGORY = {
    Definition: 'definition', 'Key Term': 'definition', Abbreviation: 'definition', 'Slide Term': 'definition',
    'Slide Fact': 'label', 'Cause and Effect': 'label', Sequence: 'list',
    'Slide Overview': 'list', List: 'list', Contrast: 'list',
    Comparison: 'table', Table: 'table',
    'Key Fact': 'note',
    Question: 'qa', 'Worked Example': 'qa', 'Self Check': 'self-check',
    Formula: 'formula', Algorithm: 'formula', Complexity: 'formula', Recurrence: 'formula',
    Theorem: 'key-concept', Rule: 'key-concept', Law: 'key-concept', Corollary: 'key-concept', Lemma: 'key-concept',
    Guideline: 'key-concept', Summary: 'key-concept', 'Key Statement': 'key-concept', 'Key Concept': 'key-concept',
  };

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

  function sourceKindOf(category) {
    return BY_CATEGORY[category] || 'definition';
  }

  /** "Benzimidazoles (Pharmacodynamics) — Toxicity" -> "Benzimidazoles"; "Osmosis (OSM)" -> "Osmosis". */
  function subjectOfFront(front) {
    const head = plain(front).split(/\s+[—–]\s+|:\s+/)[0];
    return head.replace(/\s*\([^)]*\)\s*$/, '').replace(/[?:]+$/, '').trim();
  }

  function finish(card, defaults = {}) {
    if (!card) return card;
    const sourceKind = SOURCE_KINDS.has(card.sourceKind) ? card.sourceKind : defaults.sourceKind || sourceKindOf(card.category);
    const page = card.page != null ? card.page : card.pageNumber != null ? card.pageNumber : defaults.page != null ? defaults.page : null;
    const fromFront = sourceKind === 'definition' || sourceKind === 'formula' || sourceKind === 'key-concept' ? subjectOfFront(card.front) : '';
    // A defined term is its own subject; any other card is about the entity its miner or its slide names.
    const subject = plain(card.subject) || fromFront || plain(defaults.subject) || plain(card.topic) || plain(defaults.topic);
    return { ...card, subject, sourceKind, page, topic: card.topic || defaults.topic || subject };
  }

  const PROBE_CHARS = 36; // a text is looked up by its opening (or, failing that, its closing) characters
  const MIN_PROBE_CHARS = 12;
  const fold = (s) => plain(s).toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  function pageLocator(lines) {
    const list = (lines || []).filter((l) => l && l.text && l.pageNumber);
    if (!list.length) return () => null;
    // One folded string of the scope with the page each character came from.
    let flat = '';
    const starts = [];
    for (const l of list) {
      starts.push({ at: flat.length, page: l.pageNumber });
      flat += `${fold(l.text)} `;
    }
    const pageAt = (index) => {
      let page = null;
      for (const s of starts) {
        if (s.at > index) break;
        page = s.page;
      }
      return page;
    };
    return (text) => {
      const t = fold(text);
      if (t.length < MIN_PROBE_CHARS) return null;
      for (const probe of [t.slice(0, PROBE_CHARS), t.slice(-PROBE_CHARS)]) {
        const at = flat.indexOf(probe);
        if (at >= 0) return pageAt(at);
      }
      return null;
    };
  }

  const api = { finish, sourceKindOf, subjectOfFront, pageLocator, SOURCE_KINDS };
  PDFStudy.cardFields = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

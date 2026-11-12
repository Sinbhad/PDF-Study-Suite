/**
 * Flashcard markup helpers: card kinds, the two faces (formatted text + math on BOTH sides, lists
 * for `\n` / `• ` / `1. ` backs), filter chips and the deck list. No page images.
 * Card shape: { id, front, back, category?, kind?, context?, pageNumber? }.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  // [kind id, chip label, badge label]; chip order is fixed, only kinds present in the deck show.
  const KINDS = [
    ['definition', 'Definitions', 'Definition'],
    ['theorem', 'Theorems', 'Theorem'],
    ['formula', 'Formulas', 'Formula'],
    ['algorithm', 'Algorithms', 'Algorithm'],
    ['qa', 'Questions', 'Question'],
    ['concept', 'Concepts', 'Concept'],
    ['overview', 'Overviews', 'Overview'],
  ];
  const BADGE = Object.fromEntries(KINDS.map(([id, , one]) => [id, one]));
  const ACCENT = { definition: 'definition', theorem: 'theorem', formula: 'theorem', algorithm: 'guideline', qa: 'example', concept: 'primary', overview: '' };
  const NAMED = /^(?:theorem|lemma|corollary|law|rule|property|principle|formula|identity|algorithm|definition|guideline|example)$/i;

  /** card.kind wins when it is a known kind; otherwise inferred from the category. */
  function kindOf(card) {
    const k = String((card && card.kind) || '').toLowerCase();
    const cat = String((card && card.category) || '');
    if (/overview/i.test(cat) && (!k || k === 'definition')) return 'overview';
    if (BADGE[k]) return k;
    if (/algorithm|procedure|pseudocode/i.test(cat)) return 'algorithm';
    if (/formula|identity|recurrence|equation|complexity/i.test(cat)) return 'formula';
    if (/theorem|lemma|corollary|law|rule|property|principle|guideline/i.test(cat)) return 'theorem';
    if (/question|q\s*&\s*a|qa/i.test(cat)) return 'qa';
    if (/concept|term/i.test(cat)) return 'concept';
    return 'definition';
  }
  function badgeText(card) {
    const cat = String((card && card.category) || '').trim();
    return NAMED.test(cat) ? cat : BADGE[kindOf(card)];
  }
  const badge = (card) => `<span class="badge cat-${ACCENT[kindOf(card)]}">${PDFStudy.studyViews.escapeHtml(badgeText(card))}</span>`;
  /** Cards with an empty front or back are never shown (and never counted). */
  const isValid = (c) => !!c && PDFStudy.richBlocks.hasContent(c.front) && PDFStudy.richBlocks.hasContent(c.back);
  const plain = (t) => (PDFStudy.richText ? PDFStudy.richText.plain(t) : String(t || ''));

  function faces(card) {
    const sv = PDFStudy.studyViews;
    const ctx = `<span class="fc-context">${sv.rich(card.context) || ''}</span>`;
    const frontLen = plain(card.front).length;
    const backLen = plain(card.back).length;
    const front = sv.block(card.front, frontLen > 110 ? 'is-long' : '');
    const back = sv.block(card.back, backLen < 60 && !/\n/.test(String(card.back || '').trim()) ? 'is-short' : '');
    return `
      <div class="fc-face fc-front">
        <div class="fc-top">${badge(card)}${ctx}</div>
        <div class="fc-text">${front}</div>
        <p class="fc-hint">Click or press Space to show the answer</p>
      </div>
      <div class="fc-face fc-back">
        <div class="fc-top"><span class="badge cat-primary">Answer</span>${ctx}</div>
        <div class="fc-text">${back}</div>
        <p class="fc-hint">Click or press Space to flip back</p>
      </div>`;
  }

  /** Filter chips: All, one per kind present in the deck, Needs review. */
  function filterChips(mode, cards, reviewCount) {
    const sv = PDFStudy.studyViews;
    const counts = {};
    cards.forEach((c) => { const k = kindOf(c); counts[k] = (counts[k] || 0) + 1; });
    const present = KINDS.filter(([id]) => counts[id]);
    const kindChips = present.length > 1
      ? present.map(([id, label], i) => sv.chip(`data-fc-filter="${id}" title="Shortcut: ${i + 1}"`, mode === id, `${label} ${counts[id]}`))
      : [];
    return [
      sv.chip('data-fc-filter="all" title="Shortcut: 0"', mode === 'all', `All ${cards.length}`),
      ...kindChips,
      sv.chip('data-fc-filter="review" title="Shortcut: R"', mode === 'review', `Needs review ${reviewCount}`),
    ].join('');
  }

  function listItems(deck, currentIndex, isKnown) {
    const sv = PDFStudy.studyViews;
    return deck.map((c, i) => `
      <button class="fc-item${isKnown && isKnown(c) ? ' is-known' : ''}" type="button" data-idx="${i}" ${i === currentIndex ? 'aria-current="true"' : ''}>
        <span class="fc-item-front">${sv.rich(c.front) || 'Untitled card'}</span>${badge(c)}
      </button>`).join('');
  }

  PDFStudy.flashcardFaces = { KINDS, kindOf, badgeText, isValid, faces, filterChips, listItems, plain };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.flashcardFaces;
})(typeof window !== 'undefined' ? window : globalThis);

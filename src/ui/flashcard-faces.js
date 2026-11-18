/**
 * Flashcard markup helpers: card kinds, the two faces (formatted text + math on BOTH sides, lists
 * for `\n` / `• ` / `1. ` backs), filter chips, the button rows under the card and the deck list.
 * No page images. Card shape: { id, front, back, category?, kind?, context?, pageNumber?,
 * key?, user?, edited? } (key / user / edited come from deck-merge.js).
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
    if (card && card.user) return 'Your card';
    const cat = String((card && card.category) || '').trim();
    const name = NAMED.test(cat) ? cat : BADGE[kindOf(card)];
    return card && card.edited ? `${name} · edited` : name;
  }
  const badge = (card) => `<span class="badge cat-${ACCENT[kindOf(card)]}">${PDFStudy.studyViews.escapeHtml(badgeText(card))}</span>`;
  /** Cards with an empty front or back are never shown (and never counted). */
  const isValid = (c) => !!c && PDFStudy.richBlocks.hasContent(c.front) && PDFStudy.richBlocks.hasContent(c.back);
  const plain = (t) => (PDFStudy.richText ? PDFStudy.richText.plain(t) : String(t || ''));

  function faces(card) {
    const sv = PDFStudy.studyViews;
    // The app's own page citations ("(p. 368)") read in the book's printed numbers (study-views.js pageText).
    const ctx = `<span class="fc-context">${sv.rich(sv.pageText(card.context)) || ''}</span>`;
    const frontLen = plain(card.front).length;
    const backLen = plain(card.back).length;
    const front = sv.block(sv.pageText(card.front), frontLen > 110 ? 'is-long' : '');
    const back = sv.block(sv.pageText(card.back), backLen < 60 && !/\n/.test(String(card.back || '').trim()) ? 'is-short' : '');
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

  /** Filter chips: All, one per kind present in the deck, Needs review, and Due when a count is given. */
  function filterChips(mode, cards, reviewCount, dueCount) {
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
      dueCount === undefined ? '' : sv.chip('data-fc-filter="due" title="Shortcut: D"', mode === 'due', `Due ${dueCount}`),
    ].join('');
  }

  /** Under the card while browsing: Previous, the known toggle, Next. */
  function browseRow(known) {
    return `<div class="fc-nav">
        <button class="btn btn-secondary" id="fcPrevBtn" type="button">Previous</button>
        <button class="btn btn-secondary btn-got" id="fcKnownBtn" type="button" aria-pressed="${known}">${known ? 'Known' : 'Mark as known'}</button>
        <button class="btn btn-primary" id="fcNextBtn" type="button">Next</button>
      </div>`;
  }

  /**
   * Under the card while reviewing due cards: "Show answer" first, then the four answers with the
   * time until each would bring the card back. preview: { again, hard, good, easy } in days.
   */
  function reviewRow(flipped, preview) {
    if (!flipped) return '<div class="fc-nav fc-nav-review"><button class="btn btn-primary" id="fcShowBtn" type="button">Show answer</button></div>';
    const when = PDFStudy.reviewSchedule.intervalLabel;
    const answers = [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']];
    const buttons = answers.map(([id, label], i) => `
        <button class="btn btn-secondary fc-grade" type="button" data-fc-grade="${id}" title="Shortcut: ${i + 1}">
          <span>${label}</span><span class="fc-grade-when">${when(preview[id])}</span>
        </button>`).join('');
    return `<div class="fc-nav fc-nav-review" role="group" aria-label="How well did you remember it?">${buttons}</div>`;
  }

  /** Links for the card on screen, then links for the whole deck. */
  function cardLinks(card) {
    const sv = PDFStudy.studyViews;
    return `<div class="fc-links">
        ${sv.pageJump(card.pageNumber || card.page)}
        <button class="btn-link act" id="fcEditBtn" type="button" title="Shortcut: E">Edit</button>
        <button class="btn-link act" id="fcDismissBtn" type="button" title="Take this card out of the deck. Shortcut: H">Hide card</button>
        <button class="btn-link act act-danger" id="fcDeleteBtn" type="button" title="Shortcut: Delete">Delete</button>
      </div>
      <div class="fc-links fc-links-deck">
        <button class="btn-link act" id="fcExportAnkiBtn" type="button">Export for Anki</button>
        <button class="btn-link act" id="fcExportQuizletBtn" type="button">Export for Quizlet</button>
      </div>`;
  }

  /** "3 hidden cards. Show them" / "1 deleted card. Restore it": the way back for both actions. */
  function restoreLine(hidden, deleted) {
    const part = (n, word, id, action) => (n
      ? `<span>${n} ${word} card${n === 1 ? '' : 's'}. <button class="btn-link act" id="${id}" type="button">${action} ${n === 1 ? 'it' : 'them'}</button></span>`
      : '');
    const html = part(hidden, 'hidden', 'fcShowHiddenBtn', 'Show') + part(deleted, 'deleted', 'fcRestoreDeletedBtn', 'Restore');
    return html ? `<p class="fc-restore">${html}</p>` : '';
  }

  function listItems(deck, currentIndex, isKnown) {
    const sv = PDFStudy.studyViews;
    return deck.map((c, i) => `
      <button class="fc-item${isKnown && isKnown(c) ? ' is-known' : ''}" type="button" data-idx="${i}" ${i === currentIndex ? 'aria-current="true"' : ''}>
        <span class="fc-item-front">${sv.rich(c.front) || 'Untitled card'}</span>${badge(c)}
      </button>`).join('');
  }

  /**
   * Everything below the filter chips when a card is on screen: progress, the card, its button row,
   * the Undo bar, links, key hint and the deck list.
   * v: { deck, index, flipped, boxLabel, isKnown, row, undoHtml, keyHint }
   */
  function deckBody(v) {
    const sv = PDFStudy.studyViews;
    const card = v.deck[v.index];
    const pct = Math.round(((v.index + 1) / v.deck.length) * 100);
    return `
        <div class="fc-progress">
          <span class="fc-counter">${v.index + 1} / ${v.deck.length}</span>
          <div class="progress" role="progressbar" aria-label="Deck progress" aria-valuemin="1"
               aria-valuemax="${v.deck.length}" aria-valuenow="${v.index + 1}">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="fc-card${v.flipped ? ' is-flipped' : ''}" id="flashcardBox" role="button" tabindex="0"
             aria-pressed="${v.flipped}" aria-label="${sv.escapeHtml(v.boxLabel)}">${faces(card)}</div>
        ${v.row}
        ${v.undoHtml}
        ${cardLinks(card)}
        <p class="key-hint">${v.keyHint}</p>
        <section class="sec">
          <h3 class="sec-title">Cards in this deck<span class="sec-count">${v.deck.length}</span></h3>
          <div class="fc-list">${listItems(v.deck, v.index, v.isKnown)}</div>
        </section>`;
  }

  /** The message when no card is on screen. v: { total, filterMode, addButton, nextDue: 'tomorrow' | '' } */
  function emptyDeck(v) {
    const sv = PDFStudy.studyViews;
    if (!v.total) {
      return sv.emptyState('No flashcards here', 'Pick a section with definitions, theorems or formulas, or write your own card.', v.addButton);
    }
    const showAll = `<button class="btn btn-secondary" id="resetFcFilterBtn" type="button">Show all ${v.total} cards</button>`;
    if (v.filterMode === 'due') {
      const text = v.nextDue ? `You are caught up. The next card is due ${v.nextDue}.` : 'Every card in this deck is marked as known.';
      return sv.emptyState('Nothing is due', text, showAll);
    }
    const text = v.filterMode === 'review' ? 'Every card in this deck is marked as known.' : 'No cards of this kind are left in the deck.';
    return sv.emptyState('Nothing matches this filter', text, showAll);
  }

  PDFStudy.flashcardFaces = {
    KINDS, kindOf, badgeText, isValid, faces, filterChips, browseRow, reviewRow, cardLinks, restoreLine, listItems,
    deckBody, emptyDeck, plain,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.flashcardFaces;
})(typeof window !== 'undefined' ? window : globalThis);

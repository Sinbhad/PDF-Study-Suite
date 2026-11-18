/**
 * Lays stored study state over freshly generated flashcards (DOM-free).
 * Rules: a stored edit wins over regenerated text; deleted and hidden cards stay gone; the student's
 * own cards are added for the scope they were written in; an edit whose card is no longer generated
 * ("orphaned") is kept and shown as one of the student's cards.
 * mergeDeck(generated, state, scope) -> { cards, hiddenKeys, deletedKeys }
 *   every card gains { key, edited?, user?, orphan? }; `key` is what doc-state.js stores state under.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const keys = () => PDFStudy.studyKeys || (typeof require === 'function' ? require('./study-keys.js') : null);

  const USER_CATEGORY = 'Your card';

  /** A card written or edited in `cardScope` shows there and in any scope whose pages contain it. */
  function inScope(cardScope, scope) {
    if (!cardScope || !scope) return true;
    if (cardScope.id === scope.id) return true;
    return scope.startPage <= cardScope.startPage && cardScope.endPage <= scope.endPage;
  }

  const hasEdit = (e) => !!e && typeof e.front === 'string' && typeof e.back === 'string';

  function mergeGenerated(card, key, e) {
    if (!hasEdit(e)) return { ...card, key };
    return { ...card, key, front: e.front, back: e.back, edited: true };
  }

  function orphanCard(key, e) {
    return {
      id: key, key, front: e.front, back: e.back,
      category: USER_CATEGORY, kind: 'concept', context: USER_CATEGORY,
      ...(e.meta || {}),
      edited: true, user: true, orphan: true,
    };
  }

  function userCard(c) {
    return { id: c.id, key: c.id, front: c.front, back: c.back, category: USER_CATEGORY, kind: 'concept', context: USER_CATEGORY, user: true };
  }

  function mergeDeck(generated, state, scope) {
    const K = keys();
    const all = [];
    const seen = new Set();
    (generated || []).forEach((card) => {
      const key = K.cardKey(card);
      if (seen.has(key)) return; // two generated cards with the same front share one state
      seen.add(key);
      all.push(mergeGenerated(card, key, state.cards[key]));
    });
    Object.keys(state.cards).forEach((key) => {
      const e = state.cards[key];
      if (seen.has(key) || !hasEdit(e) || !e.scope || !inScope(e.scope, scope)) return;
      seen.add(key);
      all.push(orphanCard(key, e));
    });
    state.userCards.filter((c) => inScope(c.scope, scope)).forEach((c) => all.push(userCard(c)));

    const mark = (card, name) => !!(state.cards[card.key] && state.cards[card.key][name]);
    return {
      cards: all.filter((c) => !mark(c, 'deleted') && !mark(c, 'hidden')),
      hiddenKeys: all.filter((c) => !mark(c, 'deleted') && mark(c, 'hidden')).map((c) => c.key),
      deletedKeys: all.filter((c) => mark(c, 'deleted')).map((c) => c.key),
    };
  }

  const api = { USER_CATEGORY, inScope, mergeDeck };
  PDFStudy.deckMerge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

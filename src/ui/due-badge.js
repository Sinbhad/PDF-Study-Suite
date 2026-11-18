/**
 * Flashcards tab: the card count the student actually has (own cards in, deleted and hidden out)
 * and an "8 due" badge. The badge appears once the student has reviewed a card of this deck, so a
 * document opened for the first time does not greet them with every card marked as due.
 *   update(appState)  after study materials were (re)built
 *   show(cards)       after the Flashcards view changed the deck
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function show(cards) {
    if (typeof document === 'undefined') return;
    const FD = PDFStudy.flashcardDeck;
    const tab = document.getElementById('tab-flashcards');
    if (!tab || !FD) return;
    if (PDFStudy.tabs) PDFStudy.tabs.setCounts({ flashcards: cards.length });
    const now = Date.now();
    const due = cards.some(FD.isScheduled) ? cards.filter((c) => FD.isDue(c, now)).length : 0;
    let badge = tab.querySelector('.tab-due');
    if (!due) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'tab-due';
      tab.appendChild(badge);
    }
    badge.textContent = `${due} due`;
  }

  function update(appState) {
    const FD = PDFStudy.flashcardDeck;
    if (FD) show(FD.load(appState.generated.flashcards).cards);
  }

  PDFStudy.dueBadge = { update, show };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.dueBadge;
})(typeof window !== 'undefined' ? window : globalThis);

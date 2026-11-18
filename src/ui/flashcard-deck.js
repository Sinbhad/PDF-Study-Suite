/**
 * The flashcard deck as the student sees it: generated cards merged with stored state, plus every
 * change the Flashcards view can make (known, hide, delete, edit, add, review answer). No markup.
 * Each change is saved through doc-session.js; hide() and remove() return a function that undoes them.
 * A card is due when it is not marked known and was never answered or its review date has arrived.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (name, file) => PDFStudy[name] || (typeof require === 'function' ? require(file) : null);
  const S = () => need('docSession', './doc-session.js');
  const D = () => need('docState', '../nlp/doc-state.js');
  const R = () => need('reviewSchedule', '../nlp/review-schedule.js');

  const USER = { user: true };
  const entryOf = (card) => D().lookup(S().state(), card.key) || {};
  const validCard = (c) => !PDFStudy.flashcardFaces || PDFStudy.flashcardFaces.isValid(c);

  /** { cards, hiddenKeys, deletedKeys } for the selected scope. */
  function load(generated) {
    const merged = S().deck((generated || []).filter(validCard));
    return { ...merged, cards: merged.cards.filter(validCard) };
  }

  const isKnown = (card) => !!entryOf(card).known;
  const scheduleOf = (card) => entryOf(card).sched || null;
  const isScheduled = (card) => !!scheduleOf(card);
  const isDue = (card, now) => !isKnown(card) && R().isDue(scheduleOf(card), now);

  function setMark(card, name, on) {
    S().change((state) => D().setMark(state, card.key, name, on), USER);
  }

  function toggleKnown(card) {
    const on = !isKnown(card);
    setMark(card, 'known', on);
    return on;
  }

  function hide(card) {
    setMark(card, 'hidden', true);
    return () => setMark(card, 'hidden', false);
  }

  const ownCard = (card) => card.user && !card.orphan;

  function remove(card) {
    if (!ownCard(card)) {
      setMark(card, 'deleted', true);
      return () => setMark(card, 'deleted', false);
    }
    const removed = S().change((state) => D().removeUserCard(state, card.id), USER);
    return () => { if (removed) S().change((state) => D().restoreUserCard(state, removed), USER); };
  }

  /** Bring back every card in `cardKeys` that carries the mark ('hidden' | 'deleted'). */
  function restore(cardKeys, name) {
    S().change((state) => cardKeys.forEach((key) => D().setMark(state, key, name, false)), USER);
  }

  function saveEdit(card, text) {
    S().change((state) => {
      if (ownCard(card)) {
        D().updateUserCard(state, card.id, text);
        return;
      }
      const meta = { category: card.category, kind: card.kind, context: card.context, pageNumber: card.pageNumber || card.page || null };
      D().setEdit(state, card.key, { front: text.front, back: text.back, meta, scope: S().scope() });
    }, USER);
  }

  function add(text, now) {
    return S().change((state) => D().addUserCard(state, { front: text.front, back: text.back, scope: S().scope(), created: now || Date.now() }), USER);
  }

  /** Record a review answer ('again' | 'hard' | 'good' | 'easy') and return the new schedule. */
  function grade(card, answer, now) {
    const next = R().answer(scheduleOf(card), answer, now || Date.now());
    S().change((state) => D().setSchedule(state, card.key, next), USER);
    return next;
  }

  const preview = (card) => R().preview(scheduleOf(card));
  const nextDue = (cards, now) => R().nextDue(cards.filter((c) => !isKnown(c)).map(scheduleOf), now);

  const api = { load, isKnown, isScheduled, isDue, toggleKnown, hide, remove, restore, saveEdit, add, grade, preview, nextDue };
  PDFStudy.flashcardDeck = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

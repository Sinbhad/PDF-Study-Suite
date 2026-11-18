/**
 * Per-document study state: its shape and every change made to it (DOM-free, storage-free).
 * doc-store.js persists one of these per PDF; doc-session.js holds the one for the open document.
 * Shape:
 *   cards     { [cardKey]: { known?, hidden?, deleted?, front?, back?, meta?, scope?, sched? } }
 *             front/back are the student's edit of a generated card; user cards keep state under their id
 *   userCards [ { id, front, back, scope, created } ]
 *   flags     { [sourceKey]: { at, text, questionKey } }      questions marked "Bad question"
 *   attempts  [ { kind: 'quiz'|'test', scopeId, at, score, total, retry, rows, missed? } ]   newest last
 *   overrides [ { questionKey, source, answer, typed, at } ]   typed answers the student marked "I was right"
 *   view      { tab, scope, mode } | null                     where the student left off
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const keys = () => PDFStudy.studyKeys || (typeof require === 'function' ? require('./study-keys.js') : null);

  const VERSION = 1;
  const ATTEMPTS_PER_SCOPE = 3;
  const ATTEMPTS_TOTAL = 60;
  const MIN_SOURCE_MATCH = 25; // shorter source texts must match exactly, not by containment
  const QUESTION_FIELDS = ['id', 'type', 'question', 'options', 'answer', 'answerIndex', 'explanation', 'badge', 'skill', 'category', 'pageNumber', 'page'];
  // A typed question needs what its check reads (typed-check.js) to be asked again after a reload.
  const TYPED_FIELDS = ['accept', 'form', 'others', 'shown', 'symbols', 'source', 'checks'];
  const OVERRIDES_KEPT = 100;

  const empty = () => ({ v: VERSION, cards: {}, userCards: [], flags: {}, attempts: [], overrides: [], view: null });

  /** Stored data from an older or damaged record always comes back with every field present. */
  function upgrade(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    return {
      ...empty(),
      ...s,
      v: VERSION,
      cards: s.cards && typeof s.cards === 'object' ? s.cards : {},
      userCards: Array.isArray(s.userCards) ? s.userCards : [],
      flags: s.flags && typeof s.flags === 'object' ? s.flags : {},
      attempts: Array.isArray(s.attempts) ? s.attempts : [],
      overrides: Array.isArray(s.overrides) ? s.overrides : [],
    };
  }

  /**
   * "I was right" on a typed answer the check refused: { questionKey, source, answer, typed } is kept (newest last,
   * one per question) so a check that rejects a correct answer can be found and fixed.
   */
  function addOverride(state, entry, now) {
    state.overrides = (state.overrides || []).filter((o) => o.questionKey !== entry.questionKey);
    state.overrides.push({ ...entry, at: now || Date.now() });
    state.overrides = state.overrides.slice(-OVERRIDES_KEPT);
  }

  /** The entry for a card, created on first use. Empty entries are dropped again by tidy(). */
  function entry(state, key) {
    if (!state.cards[key]) state.cards[key] = {};
    return state.cards[key];
  }

  function tidy(state, key) {
    const e = state.cards[key];
    if (e && Object.keys(e).length === 0) delete state.cards[key];
  }

  /** Set or clear one boolean mark ('known' | 'hidden' | 'deleted'). */
  function setMark(state, key, name, on) {
    const e = entry(state, key);
    if (on) e[name] = true;
    else delete e[name];
    tidy(state, key);
  }

  const lookup = (state, key) => state.cards[key] || null;

  /** The student's wording for a generated card. meta keeps badge/context/page for an orphaned edit. */
  function setEdit(state, key, edit) {
    const e = entry(state, key);
    e.front = String(edit.front);
    e.back = String(edit.back);
    if (edit.meta) e.meta = edit.meta;
    if (edit.scope) e.scope = edit.scope;
  }

  function setSchedule(state, key, schedule) {
    entry(state, key).sched = schedule;
  }

  function addUserCard(state, card) {
    const created = card.created || Date.now();
    const made = { id: `u-${created.toString(36)}-${state.userCards.length}`, front: String(card.front), back: String(card.back), scope: card.scope || null, created };
    state.userCards.push(made);
    return made;
  }

  function updateUserCard(state, id, edit) {
    const card = state.userCards.find((c) => c.id === id);
    if (!card) return null;
    card.front = String(edit.front);
    card.back = String(edit.back);
    return card;
  }

  /** Removes a user card and returns what is needed to put it back. */
  function removeUserCard(state, id) {
    const index = state.userCards.findIndex((c) => c.id === id);
    if (index < 0) return null;
    const [card] = state.userCards.splice(index, 1);
    return { card, index };
  }

  function restoreUserCard(state, removed) {
    state.userCards.splice(Math.min(removed.index, state.userCards.length), 0, removed.card);
  }

  /** Pre-IndexedDB "known" marks (card fronts) move onto the new keys. Returns how many were applied. */
  function migrateLegacyKnown(state, fronts) {
    (fronts || []).forEach((front) => setMark(state, keys().cardKey({ front }), 'known', true));
    return (fronts || []).length;
  }

  function flagQuestion(state, q, now) {
    const K = keys();
    const sKey = K.sourceKey(q);
    state.flags[sKey] = { at: now || Date.now(), text: K.sourceText(q), questionKey: K.questionKey(q) };
    return sKey;
  }

  function unflag(state, sKey) {
    delete state.flags[sKey];
  }

  /** True for the flagged question itself and for any other question built from the same sentence. */
  function isFlagged(state, q) {
    const flags = Object.keys(state.flags);
    if (!flags.length) return false;
    const K = keys();
    if (state.flags[K.sourceKey(q)]) return true;
    const qKey = K.questionKey(q);
    const text = K.sourceText(q);
    return flags.some((k) => {
      const f = state.flags[k];
      if (f.questionKey === qKey) return true;
      if (!f.text || f.text.length < MIN_SOURCE_MATCH || text.length < MIN_SOURCE_MATCH) return false;
      return f.text.includes(text) || text.includes(f.text);
    });
  }

  /** [{ key, text }] for a generator that wants to skip these sentences itself. */
  const flaggedSources = (state) => Object.keys(state.flags).map((key) => ({ key, text: state.flags[key].text }));

  /** A question reduced to plain data, so a missed question can be asked again after a reload. */
  function plainQuestion(q) {
    const out = {};
    QUESTION_FIELDS.forEach((f) => { if (q[f] !== undefined && q[f] !== null) out[f] = q[f]; });
    if (q.type === 'typed') TYPED_FIELDS.forEach((f) => { if (q[f] !== undefined && q[f] !== null) out[f] = q[f]; });
    return out;
  }

  /**
   * attempt: { kind, scopeId, at, score, total, retry, rows: [{ key, right }], missed: [question] }.
   * Only the newest attempt of a kind and scope keeps its missed questions; old attempts are trimmed.
   */
  function addAttempt(state, attempt) {
    const same = (a) => a.kind === attempt.kind && a.scopeId === attempt.scopeId;
    state.attempts.filter(same).forEach((a) => { delete a.missed; });
    state.attempts.push({ ...attempt, missed: (attempt.missed || []).map(plainQuestion) });
    const mine = state.attempts.filter(same);
    const drop = new Set(mine.slice(0, Math.max(0, mine.length - ATTEMPTS_PER_SCOPE)));
    state.attempts = state.attempts.filter((a) => !drop.has(a)).slice(-ATTEMPTS_TOTAL);
  }

  /** { last: newest full (non-retry) attempt, missed: questions still missed after the newest attempt }. */
  function lastAttempt(state, kind, scopeId) {
    const mine = state.attempts.filter((a) => a.kind === kind && a.scopeId === scopeId);
    if (!mine.length) return null;
    const newest = mine[mine.length - 1];
    const full = mine.filter((a) => !a.retry);
    return { last: full[full.length - 1] || newest, missed: newest.missed || [] };
  }

  function setView(state, view) {
    const next = JSON.stringify(view);
    if (JSON.stringify(state.view) === next) return false;
    state.view = JSON.parse(next);
    return true;
  }

  const api = {
    VERSION, empty, upgrade, lookup, setMark, setEdit, setSchedule,
    addUserCard, updateUserCard, removeUserCard, restoreUserCard, migrateLegacyKnown,
    flagQuestion, unflag, isFlagged, flaggedSources, plainQuestion, addAttempt, lastAttempt, setView, addOverride,
  };
  PDFStudy.docState = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

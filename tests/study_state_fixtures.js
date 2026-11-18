/**
 * Per-document study state fixtures (Node): stable keys, state changes, the merge of stored state
 * onto regenerated cards, flagged questions, saved attempts, legacy migration, and the store's
 * in-memory fallback (Node has no IndexedDB, which is exactly the "storage unavailable" case).
 * Run: node tests/study_state_fixtures.js
 */
const path = require('path');
const nlp = (f) => require(path.join(__dirname, '..', 'src', 'nlp', f));
const ui = (f) => require(path.join(__dirname, '..', 'src', 'ui', f));

const K = nlp('study-keys.js');
const D = nlp('doc-state.js');
const M = nlp('deck-merge.js');
const store = ui('doc-store.js');
const session = ui('doc-session.js');
const FD = ui('flashcard-deck.js');

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

// 1. Keys: normalised text, never list position or file name
check('hash is 16 hex and stable', /^[0-9a-f]{16}$/.test(K.hash('abc')) && K.hash('abc') === K.hash('abc') && K.hash('abc') !== K.hash('abd'), K.hash('abc'));
check('card key ignores case, spacing, trailing punctuation', K.cardKey({ front: 'Binary  Heap.' }) === K.cardKey({ front: ' binary heap' }) && K.cardKey({ front: 'Binary heap' }) !== K.cardKey({ front: 'Binomial heap' }), '');
check('card key keeps math apart', K.cardKey({ front: '$x^2$' }) !== K.cardKey({ front: '$x^3$' }), '');
const qA = { id: 'q-1', question: 'A ________ is a complete binary tree with ordered keys.', options: ['heap', 'stack', 'queue', 'trie'], answer: 'heap' };
const qB = { id: 'q-7', question: 'A ________ is a complete binary tree with ordered keys.', options: ['trie', 'heap', 'graph', 'list'], answer: 'heap' };
check('question key ignores id and option order', K.questionKey(qA) === K.questionKey(qB) && K.questionKey(qA) !== K.questionKey({ ...qA, answer: 'stack' }), '');
check('cloze source fills the blank', K.questionSource(qA) === 'A heap is a complete binary tree with ordered keys.', K.questionSource(qA));
const qQuoted = { question: 'Which term best matches the following statement?\n"A structure that maps keys to values."', answer: 'Hash table' };
check('quoted statement is the source', K.questionSource(qQuoted) === 'A structure that maps keys to values.', K.questionSource(qQuoted));
check('explicit source wins', K.questionSource({ question: 'x', source: 'The real sentence.' }) === 'The real sentence.', '');
check('doc id prefers the PDF fingerprint', K.docId({ fingerprint: 'abc123', name: 'a.pdf' }) === 'pdf-abc123' && K.docId({ fingerprint: 'abc123', name: 'renamed.pdf' }) === 'pdf-abc123', '');
check('doc id fallback separates same-name files', K.docId({ name: 'notes.pdf', size: 10, numPages: 3 }) !== K.docId({ name: 'notes.pdf', size: 11, numPages: 3 }) && /^doc-[0-9a-f]{16}$/.test(K.docId({ name: 'notes.pdf', size: 10, numPages: 3 })), '');

// 2. State changes
const s = D.empty();
const heapKey = K.cardKey({ front: 'Binary heap' });
D.setMark(s, heapKey, 'known', true);
check('mark set', D.lookup(s, heapKey).known === true, JSON.stringify(s.cards));
D.setMark(s, heapKey, 'known', false);
check('cleared marks leave no empty entry', D.lookup(s, heapKey) === null, JSON.stringify(s.cards));
check('upgrade repairs a damaged record', Array.isArray(D.upgrade({ cards: null, attempts: 'x' }).attempts) && typeof D.upgrade(null).cards === 'object' && D.upgrade({ flags: { a: 1 } }).flags.a === 1, '');
check('legacy known fronts migrate onto keys', D.migrateLegacyKnown(s, ['Binary heap', 'Stack']) === 2 && D.lookup(s, heapKey).known && D.lookup(s, K.cardKey({ front: 'stack' })).known, '');

// 3. Merge: edits win, deleted and hidden stay gone, user cards join, orphaned edits are kept
const scopeA = { id: 'sec-1', startPage: 1, endPage: 10 };
const chapter = { id: 'ch-1', startPage: 1, endPage: 30 };
const other = { id: 'sec-9', startPage: 40, endPage: 50 };
const generated = [
  { id: 'fc-1', front: 'Binary heap', back: 'A complete binary tree.', category: 'Definition', kind: 'definition', context: 'p. 3', pageNumber: 3 },
  { id: 'fc-2', front: 'Stack', back: 'LIFO structure.', kind: 'definition' },
  { id: 'fc-3', front: 'Queue', back: 'FIFO structure.', kind: 'definition' },
  { id: 'fc-4', front: 'Trie', back: 'Prefix tree.', kind: 'definition' },
];
const st = D.empty();
D.setEdit(st, K.cardKey(generated[0]), { front: 'Binary heap (min)', back: 'Parent key <= child keys.', meta: { category: 'Definition', kind: 'definition', context: 'p. 3', pageNumber: 3 }, scope: scopeA });
D.setMark(st, K.cardKey(generated[1]), 'deleted', true);
D.setMark(st, K.cardKey(generated[2]), 'hidden', true);
const mine = D.addUserCard(st, { front: 'My mnemonic', back: 'Heaps are happy trees.', scope: scopeA, created: 1700000000000 });
let merged = M.mergeDeck(generated, st, scopeA);
const fronts = (m) => m.cards.map((c) => c.front).join(' | ');
check('edit wins over generated text', merged.cards[0].front === 'Binary heap (min)' && merged.cards[0].edited === true && merged.cards[0].key === K.cardKey(generated[0]) && merged.cards[0].pageNumber === 3, fronts(merged));
check('deleted and hidden are gone, user card is in', fronts(merged) === 'Binary heap (min) | Trie | My mnemonic', fronts(merged));
check('hidden and deleted keys are reported for restore', merged.hiddenKeys.length === 1 && merged.deletedKeys.length === 1 && merged.hiddenKeys[0] === K.cardKey(generated[2]), JSON.stringify(merged));
// regeneration with different ids and order: state re-attaches by key
merged = M.mergeDeck([{ id: 'fc-9', front: 'trie', back: 'Prefix tree.' }, { id: 'fc-1', front: 'BINARY HEAP.', back: 'regenerated text' }, { id: 'fc-2', front: 'stack', back: 'x' }], st, scopeA);
check('state re-attaches after regeneration', fronts(merged) === 'trie | Binary heap (min) | My mnemonic', fronts(merged));
// the edited card is no longer generated: it is kept as the student's card
merged = M.mergeDeck([generated[3]], st, scopeA);
const orphan = merged.cards.find((c) => c.orphan);
check('orphaned edit is kept as a user card', !!orphan && orphan.user && orphan.front === 'Binary heap (min)' && orphan.key === K.cardKey(generated[0]) && orphan.pageNumber === 3, fronts(merged));
check('user cards and orphans follow page containment', fronts(M.mergeDeck([generated[3]], st, chapter)) === 'Trie | Binary heap (min) | My mnemonic' && fronts(M.mergeDeck([generated[3]], st, other)) === 'Trie', `${fronts(M.mergeDeck([generated[3]], st, chapter))} / ${fronts(M.mergeDeck([generated[3]], st, other))}`);
check('duplicate generated fronts collapse', M.mergeDeck([generated[3], { ...generated[3], id: 'fc-8' }], D.empty(), scopeA).cards.length === 1, '');
D.updateUserCard(st, mine.id, { front: 'My mnemonic v2', back: 'b' });
const removed = D.removeUserCard(st, mine.id);
check('user card edit + remove', removed.card.front === 'My mnemonic v2' && st.userCards.length === 0, JSON.stringify(st.userCards));
D.restoreUserCard(st, removed);
check('user card restore (undo)', st.userCards.length === 1 && st.userCards[0].id === mine.id, '');

// 4. Flagged questions: the question, and any other question built from the same sentence
const fs = D.empty();
const sKey = D.flagQuestion(fs, qA, 1);
const tfSame = { question: 'True or false?\n"A heap is a complete binary tree with ordered keys."', answer: 'True', options: ['True', 'False'] };
const unrelated = { question: 'A ________ maps keys to values using a hash function.', answer: 'hash table' };
check('flag matches the question and its re-shuffles', D.isFlagged(fs, qA) && D.isFlagged(fs, qB), '');
check('flag matches other questions from the same sentence', D.isFlagged(fs, tfSame), K.sourceText(tfSame));
check('flag leaves other sentences alone', !D.isFlagged(fs, unrelated) && !D.isFlagged(D.empty(), qA), '');
check('flaggedSources lists key + text', D.flaggedSources(fs).length === 1 && D.flaggedSources(fs)[0].key === sKey && /complete binary tree/.test(D.flaggedSources(fs)[0].text), JSON.stringify(D.flaggedSources(fs)));
D.unflag(fs, sKey);
check('unflag (undo)', !D.isFlagged(fs, qA), '');

// 5. Attempts: per kind + scope, newest keeps the missed questions, history is capped
const as = D.empty();
const attempt = (at, score, extra) => ({ kind: 'quiz', scopeId: 'book:sec-1', at, score, total: 10, retry: false, rows: [], missed: [{ ...qA, junk: () => 1 }], ...extra });
D.addAttempt(as, attempt(1, 5));
D.addAttempt(as, attempt(2, 7));
let last = D.lastAttempt(as, 'quiz', 'book:sec-1');
check('last attempt is the newest', last.last.score === 7 && last.missed.length === 1 && last.missed[0].answer === 'heap' && !('junk' in last.missed[0]), JSON.stringify(last));
check('older attempts drop their missed questions', as.attempts[0].missed === undefined, '');
D.addAttempt(as, attempt(3, 1, { retry: true, total: 3, missed: [] }));
last = D.lastAttempt(as, 'quiz', 'book:sec-1');
check('a retry does not replace the last full score, but owns what is still missed', last.last.score === 7 && last.missed.length === 0, JSON.stringify(last));
check('other scope / kind has no history', D.lastAttempt(as, 'quiz', 'book:sec-2') === null && D.lastAttempt(as, 'test', 'book:sec-1') === null, '');
for (let i = 0; i < 6; i++) D.addAttempt(as, attempt(10 + i, i));
check('attempt history is capped per scope', as.attempts.filter((a) => a.scopeId === 'book:sec-1').length === 3, String(as.attempts.length));
check('attempts survive JSON (stored as plain data)', JSON.parse(JSON.stringify(as)).attempts.length === as.attempts.length, '');
check('view changes are detected', D.setView(as, { tab: 'quiz', mode: 'book', scope: scopeA }) === true && D.setView(as, { tab: 'quiz', mode: 'book', scope: scopeA }) === false, '');

// 6. Store: eviction plan, then the full API with storage unavailable (in-memory fallback)
const plan = store.planEviction([{ id: 'a', size: 40, at: 1 }, { id: 'b', size: 40, at: 3 }, { id: 'c', size: 40, at: 2 }], 90);
check('eviction is oldest first, only as much as needed', plan.join() === 'a', plan.join());
check('nothing is evicted under the cap', store.planEviction([{ id: 'a', size: 40, at: 1 }], 90).length === 0, '');
check('sizes: strings, buffers, objects', store.sizeOf('abcd') === 8 && store.sizeOf(new Uint8Array(10)) === 10 && store.sizeOf({ a: 1 }) > 0 && store.sizeOf(null) === 0, '');

async function storeFixtures() {
  check('unknown document loads as null', (await store.loadDoc('pdf-none')) === null, '');
  check('storage is unavailable here and the store says so', store.mode() === 'memory', store.mode());
  const state = D.empty();
  D.flagQuestion(state, qA, 5);
  check('save without storage reports false, never throws', (await store.saveDoc('pdf-1', state)) === false, '');
  check('saved state reads back in the same session', (await store.loadDoc('pdf-1')) === state, '');
  check('flaggedSources(docId)', (await store.flaggedSources('pdf-1')).length === 1 && (await store.flaggedSources('pdf-none')).length === 0, '');

  store.configure({ blobCapBytes: 100 });
  check('blob put/get round trip', (await store.put('pdf-1', 'ocr', 'page-1', 'x'.repeat(20))) === true && (await store.get('pdf-1', 'ocr', 'page-1')) === 'x'.repeat(20), '');
  check('missing blob is null', (await store.get('pdf-1', 'ocr', 'page-99')) === null && (await store.get('pdf-2', 'ocr', 'page-1')) === null, '');
  await new Promise((r) => setTimeout(r, 5));
  await store.put('pdf-1', 'ocr', 'page-2', 'y'.repeat(20));
  await new Promise((r) => setTimeout(r, 5));
  await store.put('pdf-1', 'ocr', 'page-3', 'z'.repeat(20)); // 120 bytes > 100: page-1 is the oldest
  check('oldest blob is evicted over the cap', (await store.get('pdf-1', 'ocr', 'page-1')) === null && (await store.get('pdf-1', 'ocr', 'page-3')) === 'z'.repeat(20) && (await store.get('pdf-1', 'ocr', 'page-2')) !== null, '');
  check('a value larger than the cap is refused', (await store.put('pdf-1', 'ocr', 'huge', 'h'.repeat(80))) === false && (await store.get('pdf-1', 'ocr', 'huge')) === null, '');
  check('persist() without a storage manager is false', (await store.persist()) === false, '');

  // 7. Session + deck over the fallback: the Flashcards view's changes, end to end
  // Old localStorage marks (`${docName}::${cardFront}`) move over on the first open of that document
  const legacy = { pdf_study_suite_state_v1: JSON.stringify({ prefs: { theme: 'dark' }, knownCards: { 'Notes.pdf::Trie': true, 'Notes.pdf::Queue': false, 'Other.pdf::Trie': true } }) };
  global.localStorage = { getItem: (k) => legacy[k] || null, setItem: (k, v) => { legacy[k] = v; } };
  ui('storage.js');

  const appState = { docName: 'Notes.pdf', parsedPdf: { numPages: 12 }, activeMode: 'book', selectedScope: { id: 'sec-1', type: 'section', title: 'Heaps', startPage: 1, endPage: 10 }, activeTab: 'summary', bookHierarchy: { chapters: [{ id: 'ch-1', startPage: 1, endPage: 12, sections: [{ id: 'sec-1', startPage: 1, endPage: 10 }] }] } };
  global.PDFStudy.main = { appState, renderActiveTab() {} };
  await session.open(appState);
  let deck = FD.load(generated);
  check('deck loads generated cards with keys', deck.cards.length === 4 && deck.cards.every((c) => c.key), '');
  const left = JSON.parse(legacy.pdf_study_suite_state_v1);
  check('legacy known marks migrate for the matching document only', FD.isKnown(deck.cards[3]) && !FD.isKnown(deck.cards[2]) && Object.keys(left.knownCards).join() === 'Other.pdf::Trie' && left.prefs.theme === 'dark', JSON.stringify(left));
  FD.toggleKnown(deck.cards[3]);
  const now = Date.now();
  check('new cards are due, known cards are not', FD.isDue(deck.cards[0], now) && FD.toggleKnown(deck.cards[0]) === true && !FD.isDue(deck.cards[0], now) && FD.isKnown(deck.cards[0]), '');
  FD.grade(deck.cards[1], 'good', now);
  check('a graded card leaves today\'s due list', !FD.isDue(deck.cards[1], now) && FD.isDue(deck.cards[1], now + 2 * 86400000) && FD.isScheduled(deck.cards[1]), '');
  FD.grade(deck.cards[2], 'again', now);
  check('"again" keeps the card due', FD.isDue(deck.cards[2], now), '');
  const undoDelete = FD.remove(deck.cards[3]);
  check('delete removes, undo restores', FD.load(generated).cards.length === 3 && FD.load(generated).deletedKeys.length === 1 && (undoDelete(), FD.load(generated).cards.length === 4), '');
  const undoHide = FD.hide(deck.cards[3]);
  check('hide persists in state, undo restores', FD.load(generated).hiddenKeys.length === 1 && (undoHide(), FD.load(generated).hiddenKeys.length === 0), '');
  FD.saveEdit(deck.cards[1], { front: 'Stack (LIFO)', back: 'Last in, first out.' });
  const made = FD.add({ front: 'Own card', back: 'Own answer' }, 1700000000001);
  deck = FD.load(generated);
  check('edit and add show in the deck', deck.cards[1].front === 'Stack (LIFO)' && deck.cards[1].edited && deck.cards[4].key === made.id && deck.cards[4].user, deck.cards.map((c) => c.front).join(' | '));
  FD.saveEdit(deck.cards[4], { front: 'Own card v2', back: 'Own answer' });
  const undoOwn = FD.remove(FD.load(generated).cards[4]);
  check('own card: edit, delete, undo', FD.load(generated).cards.length === 4 && (undoOwn(), FD.load(generated).cards[4].front === 'Own card v2'), '');
  session.afterRender(appState);
  session.flush();
  const stored = await store.loadDoc(session.id());
  check('session state is what the store holds', stored === session.state() && stored.view.tab === 'summary' && stored.view.scope.id === 'sec-1' && stored.userCards.length === 1, JSON.stringify(stored.view));

  // Reopen: state comes back, and the student returns to the section and tab they left
  appState.activeTab = 'flashcards';
  session.afterRender(appState);
  const reopened = { ...appState, parsedPdf: { numPages: 12 }, activeTab: 'summary', selectedScope: { id: 'ch-1', type: 'chapter', title: 'Ch 1', startPage: 1, endPage: 12 } };
  global.PDFStudy.main.appState = reopened;
  await session.open(reopened);
  check('reopen restores section and tab', reopened.activeTab === 'flashcards' && reopened.selectedScope.id === 'sec-1' && reopened.currentReaderPage === 1, JSON.stringify(reopened.selectedScope));
  check('reopen keeps card state', FD.isKnown(FD.load(generated).cards[0]) && FD.load(generated).cards[1].front === 'Stack (LIFO)', '');
  const gone = { ...reopened, parsedPdf: { numPages: 12 }, activeTab: 'summary', selectedScope: { id: 'ch-1', startPage: 1, endPage: 12 }, bookHierarchy: { chapters: [] } };
  global.PDFStudy.main.appState = gone;
  await session.open(gone);
  check('a section that no longer exists is not restored', gone.selectedScope.id === 'ch-1' && gone.activeTab === 'summary', JSON.stringify(gone.selectedScope));
}

storeFixtures().then(() => {
  console.log(`study_state_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.log(`FAIL study_state_fixtures crashed: ${err && err.stack}`);
  process.exit(1);
});

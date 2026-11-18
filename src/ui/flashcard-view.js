/**
 * Flashcards view: one large card that flips in place, kind filters, "3 / 22" progress, the card
 * controls (known, edit, hide, delete with undo, add a card), due-card review and export.
 * Keys (flashcards tab only): Space/Enter flip, Left/Right move, K known, E edit, H hide,
 * Delete/Backspace delete, U undo, 0 all, 1-7 kind filters (in chip order), R needs review, D due.
 * While reviewing due cards, 1-4 answer Again / Hard / Good / Easy once the answer is showing.
 * Markup: flashcard-faces.js and flashcard-form.js. Deck state and its changes: flashcard-deck.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const GRADE_KEYS = { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' };
  const GRADE_SAID = { again: 'Again. This card stays in today\'s review.', hard: 'Hard.', good: 'Good.', easy: 'Easy.' };

  function renderFlashcardsView(container, rawCards, docName, scopeTitle) {
    if (!container) return;
    const sv = PDFStudy.studyViews;
    const F = PDFStudy.flashcardFaces;
    const FD = PDFStudy.flashcardDeck;
    const form = PDFStudy.flashcardForm;
    const undoBar = PDFStudy.undoBar;
    const sched = PDFStudy.reviewSchedule;
    let deck = FD.load(rawCards);
    let currentIndex = 0;
    let isFlipped = false;
    let filterMode = 'all'; // 'all' | 'review' | 'due' | kind id
    let editing = null; // null | 'new' | key of the card being edited
    let pendingUndo = null;
    let announce = '';

    const isDue = (c) => FD.isDue(c, Date.now());
    function getActiveDeck() {
      const visible = deck.cards;
      if (filterMode === 'review') return visible.filter((c) => !FD.isKnown(c));
      if (filterMode === 'due') return visible.filter(isDue);
      if (filterMode !== 'all') return visible.filter((c) => F.kindOf(c) === filterMode);
      return visible;
    }
    const current = () => getActiveDeck()[currentIndex];
    /** Re-read the deck after a change, redraw, and keep the Flashcards tab's counts in step. */
    function refresh() {
      deck = FD.load(rawCards);
      updateDeckUI();
      if (PDFStudy.dueBadge) PDFStudy.dueBadge.show(deck.cards);
    }
    function setFilter(mode) {
      filterMode = mode;
      currentIndex = 0;
      isFlipped = false;
      editing = null;
      updateDeckUI();
    }
    function go(delta) {
      const n = getActiveDeck().length;
      if (!n) return;
      isFlipped = false;
      currentIndex = (currentIndex + delta + n) % n;
      updateDeckUI();
    }
    const boxLabel = (card) => `${isFlipped ? `Answer: ${F.plain(card.back)}` : `Question: ${F.plain(card.front)}`}. Press Space to flip.`;
    function flip() {
      const box = container.querySelector('#flashcardBox');
      if (!box) return;
      isFlipped = !isFlipped;
      if (filterMode !== 'due') {
        box.classList.toggle('is-flipped', isFlipped);
        box.setAttribute('aria-pressed', String(isFlipped));
        box.setAttribute('aria-label', boxLabel(current()));
        return;
      }
      const hadFocus = container.contains(document.activeElement);
      updateDeckUI(); // reviewing: the row under the card depends on the side showing
      const next = container.querySelector(isFlipped ? '[data-fc-grade="good"]' : '#fcShowBtn');
      if (next && hadFocus) next.focus();
    }
    function toggleKnown() {
      const card = current();
      if (!card) return;
      announce = FD.toggleKnown(card) ? 'Marked as known.' : 'Marked as not known.';
      refresh();
    }

    function offerUndo(message, undo) {
      if (pendingUndo) pendingUndo.clear();
      const pending = undoBar.start({ message, undo, onExpire: () => undoBar.dismiss(container, pending, container.querySelector('#flashcardBox')) });
      pendingUndo = pending;
      announce = `${message} Press U to undo.`;
    }
    function runUndo() {
      if (!pendingUndo || !pendingUndo.undo()) return false;
      announce = 'Card is back in the deck.';
      refresh();
      return true;
    }
    function hideCurrent() {
      const card = current();
      if (!card) return;
      offerUndo('Card hidden.', FD.hide(card));
      isFlipped = false;
      refresh();
    }
    function deleteCurrent() {
      const card = current();
      if (!card) return;
      offerUndo('Card deleted.', FD.remove(card));
      isFlipped = false;
      refresh();
    }
    function gradeCurrent(answer) {
      const card = current();
      if (!card || filterMode !== 'due' || !isFlipped) return false;
      FD.grade(card, answer);
      announce = GRADE_SAID[answer];
      isFlipped = false;
      if (answer === 'again') currentIndex += 1; // still due: move on, it comes round again
      refresh();
      const show = container.querySelector('#fcShowBtn') || container.querySelector('#resetFcFilterBtn');
      if (show) show.focus();
      return true;
    }

    function openForm(which) {
      editing = which;
      updateDeckUI();
    }
    function closeForm(focusSel) {
      editing = null;
      refresh();
      const back = container.querySelector(focusSel);
      if (back) back.focus();
    }
    function saveForm(text) {
      if (editing === 'new') {
        const made = FD.add(text);
        filterMode = 'all';
        isFlipped = false;
        deck = FD.load(rawCards);
        currentIndex = Math.max(0, deck.cards.findIndex((c) => c.key === made.id));
        announce = 'Card added to this deck.';
        closeForm('#flashcardBox');
        return;
      }
      const card = deck.cards.find((c) => c.key === editing);
      if (card) FD.saveEdit(card, text);
      announce = 'Card saved.';
      closeForm('#fcEditBtn');
    }

    function presentKinds() {
      const kinds = F.KINDS.map(([id]) => id).filter((id) => deck.cards.some((c) => F.kindOf(c) === id));
      return kinds.length > 1 ? kinds : [];
    }

    // Replaces any previous handler, so re-rendering never stacks listeners.
    PDFStudy.keys.set('flashcards', (e) => {
      if (!container.isConnected || editing) return false;
      const k = e.key;
      if (k === 'u' || k === 'U') return runUndo();
      if (!deck.cards.length) return false;
      const hasDeck = getActiveDeck().length > 0;
      if ((k === ' ' || k === 'Enter') && hasDeck) flip();
      else if (k === 'ArrowLeft' && hasDeck) go(-1);
      else if (k === 'ArrowRight' && hasDeck) go(1);
      else if ((k === 'k' || k === 'K') && hasDeck) toggleKnown();
      else if ((k === 'h' || k === 'H') && hasDeck) hideCurrent();
      else if ((k === 'e' || k === 'E') && hasDeck) openForm(current().key);
      else if ((k === 'Delete' || k === 'Backspace') && hasDeck) deleteCurrent();
      else if (k === '0') setFilter('all');
      else if (k === 'r' || k === 'R') setFilter('review');
      else if (k === 'd' || k === 'D') setFilter('due');
      else if (filterMode === 'due' && GRADE_KEYS[k]) return gradeCurrent(GRADE_KEYS[k]);
      else if (/^[1-7]$/.test(k) && presentKinds()[+k - 1]) setFilter(presentKinds()[+k - 1]);
      else return false;
      return true;
    });

    const addButton = '<button class="btn btn-secondary btn-sm" id="fcAddBtn" type="button">Add a card</button>';
    const footer = () => `${F.restoreLine(deck.hiddenKeys.length, deck.deletedKeys.length)}
        <div class="sr-only" id="fcLive" role="status" aria-live="polite"></div>`;

    function emptyHtml() {
      const next = filterMode === 'due' ? FD.nextDue(deck.cards, Date.now()) : 0;
      return F.emptyDeck({ total: deck.cards.length, filterMode, addButton, nextDue: next ? sched.dayLabel(next, Date.now()) : '' });
    }

    function cardHtml(activeDeck, card) {
      const reviewing = filterMode === 'due';
      return F.deckBody({
        deck: activeDeck,
        index: currentIndex,
        flipped: isFlipped,
        boxLabel: boxLabel(card),
        isKnown: FD.isKnown,
        row: reviewing ? F.reviewRow(isFlipped, FD.preview(card)) : F.browseRow(FD.isKnown(card)),
        undoHtml: undoBar.html(pendingUndo),
        keyHint: reviewing ? 'Space shows the answer · 1 Again · 2 Hard · 3 Good · 4 Easy' : 'Space flips · ← → moves · K known · E edit · H hide · Delete removes',
      });
    }

    function updateDeckUI() {
      const activeDeck = getActiveDeck();
      const focusId = container.contains(document.activeElement) ? document.activeElement.id : '';
      if (currentIndex >= activeDeck.length) currentIndex = 0;
      const card = activeDeck[currentIndex];
      const knownTotal = deck.cards.filter(FD.isKnown).length;
      const dueTotal = deck.cards.filter(isDue).length;
      const meta = deck.cards.length ? `${knownTotal} of ${deck.cards.length} known · ${dueTotal} due today` : '';
      const chips = deck.cards.length
        ? `<div class="chip-row" role="group" aria-label="Filter deck">${F.filterChips(filterMode, deck.cards, deck.cards.length - knownTotal, dueTotal)}</div>${addButton}`
        : '';
      const editCard = editing && editing !== 'new' ? deck.cards.find((c) => c.key === editing) : null;
      // The Undo bar sits right under the card's buttons; with no card on screen it follows the message or form.
      const body = editing ? form.html(editCard) + undoBar.html(pendingUndo)
        : card ? cardHtml(activeDeck, card)
        : emptyHtml() + undoBar.html(pendingUndo);

      container.innerHTML = `
        ${sv.viewHead('Flashcards', scopeTitle, meta)}
        ${chips && !editing ? `<div class="view-tools">${chips}</div>` : ''}
        ${body}
        ${footer()}`;

      bind(activeDeck);
      const refocus = focusId && container.querySelector(`#${focusId}`);
      if (refocus && !editing) refocus.focus();
      if (announce) {
        const live = container.querySelector('#fcLive');
        const msg = announce;
        announce = '';
        setTimeout(() => { if (live) live.textContent = msg; }, 60);
      }
    }

    function exportDeck(activeDeck, kind) {
      const X = PDFStudy.deckExport;
      const store = PDFStudy.storage;
      const stem = X.fileStem(docName);
      if (kind === 'anki') store.downloadFile(`${stem}_anki_cards.tsv`, X.ankiTsv(activeDeck, { docName }), 'text/tab-separated-values;charset=utf-8');
      else store.downloadFile(`${stem}_quizlet.csv`, X.quizletCsv(activeDeck, { plain: F.plain }), 'text/csv;charset=utf-8');
      const n = `${activeDeck.length} card${activeDeck.length === 1 ? '' : 's'}`;
      const said = kind === 'anki' ? `Saved ${n}. In Anki, choose File, then Import.` : `Saved ${n}. In Quizlet, choose Import and paste the file's text.`;
      if (PDFStudy.events) PDFStudy.events.setStatus(said);
    }

    function bind(activeDeck) {
      const on = (sel, fn) => { const el = container.querySelector(sel); if (el) el.onclick = fn; };
      form.bind(container, { onSave: saveForm, onCancel: () => closeForm(editing === 'new' ? '#fcAddBtn' : '#fcEditBtn') });
      undoBar.bind(container, pendingUndo, () => { announce = 'Card is back in the deck.'; refresh(); });
      on('#flashcardBox', (ev) => {
        if (ev.target.closest('a, button, details, .code-block')) return;
        if (String(root.getSelection ? root.getSelection() : '').length) return; // selecting text
        flip();
      });
      on('#fcPrevBtn', () => go(-1));
      on('#fcNextBtn', () => go(1));
      on('#fcKnownBtn', toggleKnown);
      on('#fcShowBtn', flip);
      on('#fcEditBtn', () => openForm(current().key));
      on('#fcDismissBtn', hideCurrent);
      on('#fcDeleteBtn', deleteCurrent);
      on('#fcAddBtn', () => openForm('new'));
      on('#resetFcFilterBtn', () => setFilter('all'));
      on('#fcExportAnkiBtn', () => exportDeck(activeDeck, 'anki'));
      on('#fcExportQuizletBtn', () => exportDeck(activeDeck, 'quizlet'));
      on('#fcShowHiddenBtn', () => { FD.restore(deck.hiddenKeys, 'hidden'); announce = 'Hidden cards are back in the deck.'; refresh(); });
      on('#fcRestoreDeletedBtn', () => { FD.restore(deck.deletedKeys, 'deleted'); announce = 'Deleted cards are back in the deck.'; refresh(); });
      container.querySelectorAll('[data-fc-grade]').forEach((b) => { b.onclick = () => gradeCurrent(b.getAttribute('data-fc-grade')); });
      container.querySelectorAll('[data-fc-filter]').forEach((b) => { b.onclick = () => setFilter(b.getAttribute('data-fc-filter')); });
      container.querySelectorAll('.fc-item').forEach((itemEl) => {
        itemEl.onclick = () => {
          currentIndex = parseInt(itemEl.getAttribute('data-idx'), 10) || 0;
          isFlipped = false;
          updateDeckUI();
          const box = container.querySelector('#flashcardBox');
          if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
        };
      });
      sv.bindPageJumps(container);
    }

    updateDeckUI();
  }

  PDFStudy.flashcardView = { renderFlashcardsView };
})(typeof window !== 'undefined' ? window : globalThis);

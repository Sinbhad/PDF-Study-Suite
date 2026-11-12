/**
 * Flashcards view: one large card that flips in place, kind filters, "3 / 22" progress,
 * known/hide, Anki export and the deck list.
 * Keys (flashcards tab only): Space/Enter flip, Left/Right move, K toggle known, H hide card,
 * 0 all, 1-7 kind filters (in chip order, when present), R needs review.
 * Markup lives in flashcard-faces.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function renderFlashcardsView(container, rawCards, docName, scopeTitle) {
    if (!container) return;
    const sv = PDFStudy.studyViews;
    const F = PDFStudy.flashcardFaces;
    const store = PDFStudy.storage;
    const dismissedIds = new Set();
    const cards = (rawCards || []).filter(F.isValid);
    let currentIndex = 0;
    let isFlipped = false;
    let filterMode = 'all'; // 'all' | 'review' | kind id

    const isKnown = (c) => store.isCardKnown(docName, c.front);
    const visibleCards = () => cards.filter((c) => !dismissedIds.has(c.id));
    function getActiveDeck() {
      const visible = visibleCards();
      if (filterMode === 'review') return visible.filter((c) => !isKnown(c));
      if (filterMode !== 'all') return visible.filter((c) => F.kindOf(c) === filterMode);
      return visible;
    }
    function setFilter(mode) {
      filterMode = mode;
      currentIndex = 0;
      isFlipped = false;
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
      box.classList.toggle('is-flipped', isFlipped);
      box.setAttribute('aria-pressed', String(isFlipped));
      box.setAttribute('aria-label', boxLabel(getActiveDeck()[currentIndex]));
    }
    function toggleKnown() {
      const card = getActiveDeck()[currentIndex];
      if (!card) return;
      store.toggleCardKnown(docName, card.front);
      updateDeckUI();
    }
    function hideCurrent() {
      const card = getActiveDeck()[currentIndex];
      if (!card) return;
      dismissedIds.add(card.id);
      isFlipped = false;
      updateDeckUI();
    }
    function presentKinds() {
      const vis = visibleCards();
      const kinds = F.KINDS.map(([id]) => id).filter((id) => vis.some((c) => F.kindOf(c) === id));
      return kinds.length > 1 ? kinds : [];
    }

    // Replaces any previous handler, so re-rendering never stacks listeners.
    PDFStudy.keys.set('flashcards', (e) => {
      if (!container.isConnected || !visibleCards().length) return false;
      const k = e.key;
      const hasDeck = getActiveDeck().length > 0;
      if ((k === ' ' || k === 'Enter') && hasDeck) flip();
      else if (k === 'ArrowLeft' && hasDeck) go(-1);
      else if (k === 'ArrowRight' && hasDeck) go(1);
      else if ((k === 'k' || k === 'K') && hasDeck) toggleKnown();
      else if ((k === 'h' || k === 'H') && hasDeck) hideCurrent();
      else if (k === '0') setFilter('all');
      else if (k === 'r' || k === 'R') setFilter('review');
      else if (/^[1-7]$/.test(k) && presentKinds()[+k - 1]) setFilter(presentKinds()[+k - 1]);
      else return false;
      return true;
    });

    function renderEmpty(allVisible) {
      const none = allVisible.length === 0;
      container.innerHTML = sv.viewHead('Flashcards', scopeTitle) + (none
        ? sv.emptyState('No flashcards here', 'Pick a section with definitions, theorems or formulas to generate cards.')
        : sv.emptyState('Nothing matches this filter', filterMode === 'review' ? 'Every card in this deck is marked as known.' : 'No cards of this kind are left in the deck.',
          `<button class="btn btn-secondary" id="resetFcFilterBtn" type="button">Show all ${allVisible.length} cards</button>`));
      const btn = container.querySelector('#resetFcFilterBtn');
      if (btn) btn.onclick = () => setFilter('all');
    }

    function updateDeckUI() {
      const allVisible = visibleCards();
      const activeDeck = getActiveDeck();
      const focusId = container.contains(document.activeElement) ? document.activeElement.id : '';
      if (activeDeck.length === 0) return renderEmpty(allVisible);
      if (currentIndex >= activeDeck.length) currentIndex = 0;
      const card = activeDeck[currentIndex];
      const known = isKnown(card);
      const knownTotal = allVisible.filter(isKnown).length;
      const pct = Math.round(((currentIndex + 1) / activeDeck.length) * 100);

      container.innerHTML = `
        ${sv.viewHead('Flashcards', scopeTitle, `${knownTotal} of ${allVisible.length} known`)}
        <div class="view-tools"><div class="chip-row" role="group" aria-label="Filter deck">${F.filterChips(filterMode, allVisible, allVisible.length - knownTotal)}</div></div>
        <div class="fc-progress">
          <span class="fc-counter">${currentIndex + 1} / ${activeDeck.length}</span>
          <div class="progress" role="progressbar" aria-label="Deck progress" aria-valuemin="1"
               aria-valuemax="${activeDeck.length}" aria-valuenow="${currentIndex + 1}">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="fc-card${isFlipped ? ' is-flipped' : ''}" id="flashcardBox" role="button" tabindex="0"
             aria-pressed="${isFlipped}" aria-label="${sv.escapeHtml(boxLabel(card))}">${F.faces(card)}</div>
        <div class="fc-nav">
          <button class="btn btn-secondary" id="fcPrevBtn" type="button">Previous</button>
          <button class="btn btn-secondary btn-got" id="fcKnownBtn" type="button" aria-pressed="${known}">${known ? 'Known' : 'Mark as known'}</button>
          <button class="btn btn-primary" id="fcNextBtn" type="button">Next</button>
        </div>
        <div class="fc-links">
          ${sv.pageJump(card.pageNumber || card.page)}
          <button class="btn-link" id="fcDismissBtn" type="button" title="Remove this card from the deck">Hide card</button>
          <button class="btn-link" id="fcExportAnkiBtn" type="button">Export for Anki</button>
        </div>
        <p class="key-hint">Space flips · ← → moves · K known · H hide · R needs review</p>
        <section class="sec">
          <h3 class="sec-title">Cards in this deck<span class="sec-count">${activeDeck.length}</span></h3>
          <div class="fc-list">${F.listItems(activeDeck, currentIndex, isKnown)}</div>
        </section>`;

      bind(activeDeck);
      const refocus = focusId && container.querySelector(`#${focusId}`);
      if (refocus) refocus.focus();
    }

    function bind(activeDeck) {
      const $ = (sel) => container.querySelector(sel);
      $('#flashcardBox').onclick = (ev) => {
        if (ev.target.closest('a, button, details, .code-block')) return;
        if (String(root.getSelection ? root.getSelection() : '').length) return; // selecting text
        flip();
      };
      $('#fcPrevBtn').onclick = () => go(-1);
      $('#fcNextBtn').onclick = () => go(1);
      $('#fcKnownBtn').onclick = toggleKnown;
      container.querySelectorAll('[data-fc-filter]').forEach((b) => { b.onclick = () => setFilter(b.getAttribute('data-fc-filter')); });
      $('#fcDismissBtn').onclick = hideCurrent;
      $('#fcExportAnkiBtn').onclick = () => {
        const tsv = PDFStudy.flashcardEngine.exportAnkiTsv(activeDeck);
        store.downloadFile(`${docName.replace(/\W+/g, '_')}_anki_cards.tsv`, tsv);
      };
      container.querySelectorAll('.fc-item').forEach((itemEl) => {
        itemEl.onclick = () => {
          currentIndex = parseInt(itemEl.getAttribute('data-idx'), 10) || 0;
          isFlipped = false;
          updateDeckUI();
          const box = $('#flashcardBox');
          if (box && box.scrollIntoView) box.scrollIntoView({ block: 'center' });
        };
      });
      sv.bindPageJumps(container);
    }

    updateDeckUI();
  }

  PDFStudy.flashcardView = { renderFlashcardsView };
})(typeof window !== 'undefined' ? window : globalThis);

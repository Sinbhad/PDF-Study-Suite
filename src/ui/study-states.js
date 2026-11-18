/**
 * Study-pane states that replace an empty tab with what happened and what to do next:
 * blank export, pages that are pictures of text, a stopped or failed build, and a selection
 * with real text that gave no cards or questions. Decides which state applies from appState,
 * renders it, and runs its buttons (data-state-act). Verdicts and wording come from
 * doc-verdict.js and thin-results.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const SV = () => PDFStudy.studyViews;
  const TAB_NAMES = { summary: 'Summary', flashcards: 'Flashcards', quiz: 'Quiz', test: 'Practice test' };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const ACT = {
    open: { act: 'open', label: 'Open another file' },
    pages: { act: 'reader', label: 'Look at the pages' },
    outline: { act: 'outline', label: 'Pick another section' },
    retry: { act: 'retry', label: 'Try again' },
    resume: { act: 'resume', label: 'Read the rest' },
    review: { act: 'review', label: 'Check what was read' },
    typeIn: { act: 'review', label: 'Type it in' },
  };

  /** The page range the last build actually read (a long textbook selection is read in windows). */
  function shownRange(st) {
    return st.shownRange || { startPage: st.selectedScope.startPage, endPage: st.selectedScope.endPage };
  }

  function scopeVerdict(st) {
    const r = shownRange(st);
    return PDFStudy.docVerdict.scopeVerdict(st.parsedPdf, r.startPage, r.endPage);
  }

  /** How to name the selection in a sentence. */
  function whatOf(st) {
    const scope = st.selectedScope;
    const many = scope.endPage > scope.startPage;
    if (st.activeMode === 'slide_deck') return many ? 'these slides' : 'this slide';
    if (scope.type === 'chapter') return 'this chapter';
    if (scope.type === 'section') return 'this section';
    return many ? 'these pages' : 'this page';
  }

  /** Counts thin-results.js needs, measured over the pages the build read. */
  function scopeFacts(st) {
    const TR = PDFStudy.thinResults;
    const r = shownRange(st);
    const pages = PDFStudy.docVerdict.loadedPages(st.parsedPdf).filter((p) => p && p.pageNumber >= r.startPage && p.pageNumber <= r.endPage);
    const obj = st.activeMode === 'book' ? st.lastScopeObj : null;
    const blocks = (obj && obj.didacticBlocks) || [];
    return {
      words: pages.reduce((sum, p) => sum + (p.wordCount || 0), 0),
      pages: pages.length,
      thinPages: pages.filter((p) => (p.wordCount || 0) < TR.THIN_PAGE_WORDS).length,
      exerciseWords: obj ? TR.countWords(obj.exerciseText) : 0,
      blocks: blocks.length,
      exampleBlocks: blocks.filter((b) => /example|exercise|solution|problem/i.test(String(b.category || ''))).length,
    };
  }

  /** Everything the "few results" wording needs for the current selection. */
  function thinContext(st) {
    const counts = st.counts || {};
    const found = (counts.flashcards || 0) + (counts.quiz || 0) + (counts.test || 0);
    return { what: whatOf(st), facts: Object.assign(scopeFacts(st), { found }), cards: counts.flashcards || 0, quiz: counts.quiz || 0 };
  }

  function stateHtml(s) {
    const esc = SV().escapeHtml;
    const buttons = (s.actions || []).map((a, i) =>
      `<button class="btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}" type="button" data-state-act="${esc(a.act)}">${esc(a.label)}</button>`).join('');
    return `<div class="empty state" data-state="${esc(s.kind)}">
        <h3 class="empty-title">${esc(s.title)}</h3>
        <p>${esc(s.text)}</p>
        ${s.tip ? `<p class="empty-tip">${esc(s.tip)}</p>` : ''}
        ${buttons ? `<div class="empty-actions">${buttons}</div>` : ''}
        ${s.detail ? `<p class="empty-detail">${esc(s.detail)}</p>` : ''}
      </div>`;
  }

  /** Pages with no selectable text. What to do depends on whether this build can read pictures. */
  function picturesState(st, verdict) {
    const one = verdict.pages === 1;
    const what = one ? 'This page is a picture of text' : 'These pages are pictures of text';
    const elsewhere = st.verdict && st.verdict.kind === 'text'; // other parts of the document have text
    const leave = elsewhere ? ACT.outline : ACT.open;
    if (!PDFStudy.ENABLE_HANDWRITING && elsewhere) { // most likely a figure or photo between typed pages
      return {
        kind: 'pictures',
        title: one ? 'This page is a picture' : 'These pages are pictures',
        text: 'There is no text to select here, so there is nothing to summarise or to make cards and questions from. Pick another section from the outline.',
        actions: [ACT.outline, ACT.pages],
      };
    }
    if (!PDFStudy.ENABLE_HANDWRITING) {
      return {
        kind: 'pictures',
        title: what,
        text: 'There is no text to select, so there is nothing to summarise or to make cards and questions from.',
        tip: 'Reading pictures of text is not available in this build. Export from your notes app or scanner with text recognition turned on, or use a PDF with selectable text.',
        actions: [leave, ACT.pages],
      };
    }
    const hw = st.handwriting || {};
    const them = one ? 'it' : 'them';
    if (hw.cancelled || hw.skipped > 0) {
      return { kind: 'reading-stopped', title: 'Reading was stopped', text: `${what}, and reading ${them} was stopped before it finished.`, actions: [ACT.resume, ACT.pages] };
    }
    if (hw.engine && hw.engine.available === false) {
      return {
        kind: 'no-reader',
        title: one ? 'This page could not be read' : 'These pages could not be read',
        text: `${what}. The page reader is not installed, so the text on ${one ? 'this page' : 'these pages'} can't be read here. You can type it in.`,
        actions: [ACT.typeIn, ACT.pages],
      };
    }
    if (!hw.engine && !hw.failed) { // a stray picture page in a typed document is skipped, not read
      return {
        kind: 'pictures',
        title: what,
        text: `There is no text to select here. Pictures inside a typed document are skipped unless you ask for ${them} to be read.`,
        actions: [{ act: 'read', label: one ? 'Read this page' : 'Read these pages' }, leave],
      };
    }
    return {
      kind: 'unreadable',
      title: one ? 'Could not read this page' : 'Could not read these pages',
      text: `${what}, but no words could be made out.`,
      tip: 'A sharper scan or photo usually helps: a flat page, good light, text the right way up.',
      actions: [ACT.retry, ACT.pages],
    };
  }

  /** The state that takes over every study tab, or null when the tabs have something to show. */
  function deadEnd(st) {
    if (!st || !st.parsedPdf) return null;
    if (st.verdict && st.verdict.kind === 'blank') {
      return {
        kind: 'blank-document',
        title: 'This PDF\'s pages are blank',
        text: 'Your notes app probably exported the notebook without the handwriting. Export it again with annotations or handwriting included, then open the new file.',
        actions: [ACT.open, ACT.pages],
      };
    }
    const run = st.runState;
    if (run && run.kind === 'stopped') {
      return { kind: 'stopped', title: 'Stopped', text: 'You stopped this before it finished. Try again, or pick another section from the outline.', actions: [ACT.retry, ACT.outline] };
    }
    if (run && run.kind === 'failed') {
      return {
        kind: 'failed',
        title: 'Could not build study material here',
        text: 'Something in these pages could not be worked through. Try again, or pick another section from the outline.',
        actions: [ACT.retry, ACT.outline],
        detail: run.detail,
      };
    }
    const verdict = scopeVerdict(st);
    if (verdict.kind === 'blank') {
      const one = verdict.pages === 1;
      return { kind: 'blank-pages', title: one ? 'This page is blank' : 'These pages are blank', text: 'There is nothing here to study. Pick another section from the outline.', actions: [ACT.outline, ACT.pages] };
    }
    if (verdict.kind === 'pictures') return picturesState(st, verdict);
    return null;
  }

  /** Why this tab is empty for a selection that does have text, with the next step. */
  function emptyState(st, tab) {
    const verdict = scopeVerdict(st);
    const hw = st.handwriting || {};
    if (verdict.kind === 'read' && hw.engine && hw.engine.available === false) {
      const one = verdict.pages === 1;
      return {
        kind: 'no-reader',
        title: one ? 'This page could not be read' : 'These pages could not be read',
        text: `${one ? 'This page is a picture of text' : 'These pages are pictures of text'}. The page reader is not installed, so the text on ${one ? 'this page' : 'these pages'} can't be read here. You can type it in.`,
        actions: [ACT.typeIn, ACT.pages],
      };
    }
    if (verdict.kind === 'read') {
      return {
        kind: 'read-thin',
        title: `Read ${plural(verdict.read, 'page')}, but found too little to use`,
        text: 'The words that were read do not add up to enough for this view. Fixing a few misread words often helps.',
        actions: [ACT.review, ACT.pages],
      };
    }
    const ctx = thinContext(st);
    const msg = PDFStudy.thinResults.emptyMessage(tab, ctx.what, ctx.facts);
    const longer = { act: 'outline', label: st.activeMode === 'slide_deck' ? 'Pick other slides' : 'Pick a longer section' };
    const actions = [longer];
    if (tab !== 'flashcards' && ctx.cards > 0) actions.unshift({ act: 'tab:flashcards', label: `Review ${plural(ctx.cards, 'flashcard')}` });
    if (tab === 'flashcards' && ctx.quiz > 0) actions.unshift({ act: 'tab:quiz', label: `Take the quiz (${plural(ctx.quiz, 'question')})` });
    return { kind: `thin-${msg.reason}`, title: msg.title, text: msg.text, actions };
  }

  /** Markup for a view whose tab came out empty (used by the summary, quiz and practice-test views). */
  function emptyHtml(tab) {
    const st = PDFStudy.main && PDFStudy.main.appState;
    if (!st || !st.parsedPdf) return '';
    return stateHtml(emptyState(st, tab));
  }

  function announce(text) {
    const live = document.getElementById('announcer');
    if (!live) return;
    live.textContent = '';
    setTimeout(() => { live.textContent = text; }, 60);
  }

  /**
   * Takes over the study pane when the active tab has nothing real to show. Returns true when it
   * rendered (the caller then skips the normal view). Flashcards with no cards are handled here too.
   */
  function renderDeadEnd(container, st) {
    const tab = st.activeTab;
    let state = deadEnd(st);
    if (!state && tab === 'flashcards' && !((st.counts || {}).flashcards > 0)) state = emptyState(st, tab);
    if (!state) return false;
    if (PDFStudy.keys) PDFStudy.keys.set(tab, null);
    const scopeTitle = st.selectedScope.label || st.selectedScope.title;
    container.innerHTML = SV().viewHead(TAB_NAMES[tab] || 'Summary', scopeTitle) + stateHtml(state);
    return true;
  }

  function onClick(e) {
    const btn = e.target.closest ? e.target.closest('[data-state-act]') : null;
    if (!btn || btn.disabled) return;
    const act = btn.getAttribute('data-state-act');
    const M = PDFStudy.main;
    if (act === 'open') document.getElementById('pdfFileInput').click();
    else if (act === 'reader') PDFStudy.tabs.select('reader', true);
    else if (act === 'outline') PDFStudy.shell.showOutline();
    else if (act === 'retry') M.recomputeStudyMaterials();
    else if (act === 'resume') M.recomputeStudyMaterials({ retrySkipped: true });
    else if (act === 'read') M.recomputeStudyMaterials({ forceHandwriting: true });
    else if (act === 'review' && PDFStudy.hwReview) PDFStudy.hwReview.open();
    else if (act.indexOf('tab:') === 0) PDFStudy.tabs.select(act.slice(4), true);
  }

  if (typeof document !== 'undefined') document.addEventListener('click', onClick);

  PDFStudy.studyStates = { deadEnd, emptyState, emptyHtml, renderDeadEnd, stateHtml, thinContext, shownRange, announce };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyStates;
})(typeof window !== 'undefined' ? window : globalThis);

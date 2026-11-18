/**
 * Study views coordinator + shared view helpers. Every string shown in a study view goes through
 * rich()/block()/title() (math, scripts, lists; HTML-escaped), never straight into innerHTML.
 * Views: summary-view.js, flashcard-view.js, quiz-view.js, test-view.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const RB = () => PDFStudy.richBlocks || (typeof require === 'function' ? require('./rich-blocks.js') : null);

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  /** Inline rich HTML ('' for empty/garbage text). */
  const rich = (text) => RB().inline(text);
  /** Block rich HTML: paragraphs and lists, wrapped in a .prose container ('' when empty). */
  function block(text, cls = '') {
    const html = RB().block(text);
    return html ? `<div class="prose${cls ? ` ${cls}` : ''}">${html}</div>` : '';
  }
  /** Title element with truncation and the full text on hover. */
  function titled(tag, cls, text, max) {
    const t = RB().title(text, max);
    return t.html ? `<${tag} class="${cls}" title="${escapeHtml(t.full)}">${t.html}</${tag}>` : '';
  }

  /**
   * "View p. 12" for a book, "Slide 12" for a deck (a deck's page is its slide). A book shows the page number
   * printed on the page ("View p. 146") when it differs from the PDF's own page, which the button still opens.
   */
  function pageJump(page, label) {
    const n = parseInt(page, 10);
    if (!(n > 0)) return '';
    const st = PDFStudy.main && PDFStudy.main.appState;
    const deck = Boolean(st && st.activeMode === 'slide_deck');
    if (deck && !label) return `<button class="page-jump" type="button" data-jump-page="${n}">Slide&nbsp;${n}</button>`;
    const shown = printedPage(n);
    const hint = shown ? ` title="PDF page ${n}" aria-label="${escapeHtml(`${label || 'View'} p. ${shown} (PDF page ${n})`)}"` : '';
    return `<button class="page-jump" type="button" data-jump-page="${n}"${hint}>${label || 'View'} p.&nbsp;${escapeHtml(shown || String(n))}</button>`;
  }

  /** The number printed on PDF page n ("146"), or '' when it is unknown or the same (printed-pages.js). */
  function printedPage(n) {
    const st = PDFStudy.main && PDFStudy.main.appState;
    return PDFStudy.printedPages && st && st.parsedPdf ? PDFStudy.printedPages.printed(st.parsedPdf, n) : '';
  }

  /** A book open with printed page numbers known: the app state, else null (a deck cites slides). */
  function bookState() {
    const st = PDFStudy.main && PDFStudy.main.appState;
    return st && st.parsedPdf && st.activeMode !== 'slide_deck' && PDFStudy.printedPages ? st : null;
  }

  /**
   * A card's or question's own text with the app's page citations in printed numbers ("Arrays (p. 368)" ->
   * "Arrays (p. 232)"); the book's own cross-references, which point outside the pages studied, stay as printed.
   */
  function pageText(text) {
    const st = bookState();
    if (!st || text == null) return text;
    const s = st.selectedScope;
    const range = s && s.startPage ? [s.startPage, s.endPage || s.startPage] : [1, st.parsedPdf.numPages];
    return PDFStudy.printedPages.relabel(st.parsedPdf, text, range);
  }

  /** "p. 146–168" for a book's PDF pages 188–210 when printed numbers are known, else "p. 188–210". */
  function pageRangeLabel(first, last) {
    const st = bookState();
    const printed = st ? PDFStudy.printedPages.printedRange(st.parsedPdf, first, last) : '';
    return printed || (Number(last) > Number(first) ? `p. ${first}–${last}` : `p. ${first}`);
  }

  /**
   * Shared header: eyebrow (view name), scope title, optional meta line, then the selection notes
   * from scope-notes.js (which pages of a long selection are showing, why a quiz is short).
   */
  function viewHead(eyebrow, scopeTitle, meta) {
    const scope = PDFStudy.main && PDFStudy.main.appState.selectedScope;
    const context = scope && scope.context ? RB().title(scope.context, 80).full : '';
    const notes = PDFStudy.scopeNotes ? PDFStudy.scopeNotes.headHtml() : '';
    return `<header class="view-head">
        <p class="eyebrow">${escapeHtml(eyebrow)}${context ? ` · ${escapeHtml(context)}` : ''}</p>
        ${titled('h2', 'view-title', scopeTitle, 200) || '<h2 class="view-title">Untitled selection</h2>'}
        ${meta ? `<p class="view-meta">${meta}</p>` : ''}
        ${notes}
      </header>`;
  }

  function emptyState(heading, text, actionHtml = '') {
    return `<div class="empty"><h3 class="empty-title">${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p>${actionHtml}</div>`;
  }

  /**
   * Empty tab for the current selection: says why it is empty and what to do next
   * (study-states.js); falls back to the plain message when no document is open.
   */
  function whyEmpty(tab, heading, text) {
    const html = PDFStudy.studyStates ? PDFStudy.studyStates.emptyHtml(tab) : '';
    return html || emptyState(heading, text);
  }

  function chip(attrs, on, label) {
    return `<button class="chip" type="button" ${attrs} aria-pressed="${!!on}">${label}</button>`;
  }

  /** Wire "View p. N" buttons and data-go-tab buttons inside a rendered view. */
  function bindPageJumps(container) {
    if (!container || !container.querySelectorAll) return;
    container.querySelectorAll('[data-jump-page]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        if (PDFStudy.readerControls) PDFStudy.readerControls.jumpToPage(btn.getAttribute('data-jump-page'));
      };
    });
    container.querySelectorAll('[data-go-tab]').forEach((btn) => {
      btn.onclick = () => PDFStudy.tabs && PDFStudy.tabs.select(btn.getAttribute('data-go-tab'), false);
    });
  }

  const delegate = (mod, fn) => (...args) => (PDFStudy[mod] && PDFStudy[mod][fn] ? PDFStudy[mod][fn](...args) : undefined);

  PDFStudy.studyViews = {
    escapeHtml, rich, block, titled, pageJump, printedPage, pageText, pageRangeLabel, viewHead, emptyState, whyEmpty, chip, bindPageJumps,
    renderSummaryView: delegate('summaryView', 'renderSummaryView'),
    renderFlashcardsView: delegate('flashcardView', 'renderFlashcardsView'),
    renderQuizView: delegate('quizView', 'renderQuizView'),
    renderTestView: delegate('testView', 'renderTestView'),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyViews;
})(typeof window !== 'undefined' ? window : globalThis);

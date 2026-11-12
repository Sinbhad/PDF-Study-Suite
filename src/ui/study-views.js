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

  function pageJump(page, label) {
    const n = parseInt(page, 10);
    return n > 0 ? `<button class="page-jump" type="button" data-jump-page="${n}">${label || 'View'} p.&nbsp;${n}</button>` : '';
  }

  /** Shared header: eyebrow (view name), scope title, optional meta line. */
  function viewHead(eyebrow, scopeTitle, meta) {
    const scope = PDFStudy.main && PDFStudy.main.appState.selectedScope;
    const context = scope && scope.context ? RB().title(scope.context, 80).full : '';
    return `<header class="view-head">
        <p class="eyebrow">${escapeHtml(eyebrow)}${context ? ` · ${escapeHtml(context)}` : ''}</p>
        ${titled('h2', 'view-title', scopeTitle, 200) || '<h2 class="view-title">Untitled selection</h2>'}
        ${meta ? `<p class="view-meta">${meta}</p>` : ''}
      </header>`;
  }

  function emptyState(heading, text, actionHtml = '') {
    return `<div class="empty"><h3 class="empty-title">${escapeHtml(heading)}</h3><p>${escapeHtml(text)}</p>${actionHtml}</div>`;
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
    escapeHtml, rich, block, titled, pageJump, viewHead, emptyState, chip, bindPageJumps,
    renderSummaryView: delegate('summaryView', 'renderSummaryView'),
    renderFlashcardsView: delegate('flashcardView', 'renderFlashcardsView'),
    renderQuizView: delegate('quizView', 'renderQuizView'),
    renderTestView: delegate('testView', 'renderTestView'),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.studyViews;
})(typeof window !== 'undefined' ? window : globalThis);

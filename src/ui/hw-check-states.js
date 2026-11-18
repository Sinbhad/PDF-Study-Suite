/**
 * What the "Check what was read" screen shows in place of the list of lines when a page has no list to
 * show: still being read, nothing found, hard to read, kept as a picture, skipped, cannot be read here,
 * and the form for typing a page in. Markup only; each button names its action in data-act
 * (hw-check-actions.js). Every state has a title that can take focus, what happened, and a way on.
 *   html(kind, ctx)   kind: 'reading' | 'empty' | 'hard' | 'picture' | 'skipped' | 'unread' | 'type'
 *                     ctx: { pageNumber, total, last, left, guesses, readingPage, reason, draft }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const button = (cls, act, label) => `<button class="btn ${cls}" type="button" data-act="${act}">${label}</button>`;
  const onward = (ctx, cls) => (ctx.last ? button(cls, 'done', 'Done') : button(cls, 'next-page', 'Next page'));

  function block(title, text, actions, extra) {
    return `<div class="empty state hw-state">
        <h3 class="empty-title" id="hwStateTitle" tabindex="-1">${esc(title)}</h3>
        <p>${esc(text)}</p>
        ${extra || ''}
        ${actions ? `<div class="empty-actions">${actions}</div>` : ''}
      </div>`;
  }

  function reading(ctx) {
    const now = `Reading page ${ctx.readingPage || ctx.pageNumber} of ${ctx.total}`;
    const bar = `<div class="hw-reading">
        <div class="progress indeterminate" role="progressbar" aria-label="${esc(now)}"><div class="progress-fill"></div></div>
        <p class="loading-detail">${esc(now)}</p>
      </div>`;
    return block('Still reading this page', 'Pages are read in order. You can check pages that are ready meanwhile.',
      button('btn-secondary', 'ready-page', 'Go to a ready page'), bar);
  }

  function empty(ctx) {
    return block('No writing found on this page', 'If there is writing here, add it below.',
      onward(ctx, 'btn-primary') + button('btn-secondary', 'add', 'Add a line') + button('btn-ghost', 'keep-page', 'Keep page as picture'));
  }

  function hard(ctx) {
    const more = ctx.guesses ? '<p class="hw-state-more"><button class="btn-link note-link" type="button" data-act="guesses">Show the guesses</button></p>' : '';
    return block('This page was hard to read', "Most of the writing couldn't be read. Type it in with the page beside you, or skip it for now.",
      button('btn-primary', 'type', 'Type it in') + button('btn-ghost', 'skip', 'Skip this page')) + more;
  }

  function picture(ctx) {
    return block('Kept as a picture', 'This page can become a picture card.', onward(ctx, 'btn-primary') + button('btn-ghost', 'page-text', 'Use as text'));
  }

  function skipped(ctx) {
    const left = ctx.left > 0 ? `${ctx.left} ${ctx.left === 1 ? 'line is' : 'lines are'} still to check here.` : 'You can come back to it at any time.';
    return block('You skipped this page', left, button('btn-primary', 'unskip', 'Check this page') + onward(ctx, 'btn-ghost'));
  }

  /** The form for typing a page in. `cancel` is left out where typing is the only way forward. */
  function typeForm(ctx, cancel) {
    return `<section class="hw-type" aria-labelledby="hwTypeTitle">
        <h3 class="sec-title hw-lines-title" id="hwTypeTitle" tabindex="-1">Text of page ${ctx.pageNumber}</h3>
        <p class="view-note" id="hwTypeHint">One line of text per line of writing.</p>
        <textarea class="input hw-type-area" id="hwTypeArea" rows="12" aria-labelledby="hwTypeTitle" aria-describedby="hwTypeHint" autocomplete="off">${esc(ctx.draft || '')}</textarea>
        <p class="fc-form-error" id="hwTypeError" role="alert"></p>
        <div class="cta-actions">
          ${button('btn-primary', 'type-save', 'Save page')}
          ${cancel ? button('btn-ghost', 'type-cancel', 'Cancel') : onward(ctx, 'btn-ghost')}
        </div>
      </section>`;
  }

  function unread(ctx) {
    const why = ctx.reason ? `<details class="hw-setup"><summary>Setup details</summary><p>${esc(ctx.reason)}</p></details>` : '';
    return `<div class="hw-state-lead">
        <p class="hw-state-lead-text" id="hwStateTitle" tabindex="-1">Writing on these pages can't be read here. You can type it in.</p>
        ${why}
      </div>${typeForm(ctx, false)}`;
  }

  const KINDS = { reading, empty, hard, picture, skipped, unread, type: (ctx) => typeForm(ctx, true) };

  function html(kind, ctx) {
    return KINDS[kind] ? KINDS[kind](ctx) : '';
  }

  PDFStudy.hwCheckStates = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCheckStates;
})(typeof window !== 'undefined' ? window : globalThis);

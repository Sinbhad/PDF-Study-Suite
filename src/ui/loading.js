/**
 * Loading state: a progress bar rendered into a container, with a Cancel button whenever the
 * caller can stop the work, plus a lock that disables interactive controls while work is in
 * flight. Opening a document locks everything; building a selection leaves the outline usable,
 * so picking another section is always a way out.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LOCK_CHROME = '.topbar button:not(#themeToggleBtn):not(#railToggleBtn), #pdfDropzone button, #pdfFileInput';
  const LOCK_STUDY = '#workspaceArea .main button:not(#loadingCancelBtn), #workspaceArea .main input';
  const LOCK_OUTLINE = '#outlineRail button, #outlineRail input';
  let locked = [];
  let host = null;
  let busy = false;
  let focusCancel = false;

  function lock(keepOutline) {
    unlock();
    const selector = [LOCK_CHROME, LOCK_STUDY].concat(keepOutline ? [] : [LOCK_OUTLINE]).join(', ');
    document.querySelectorAll(selector).forEach((el) => {
      if (el.disabled) return;
      el.disabled = true;
      locked.push(el);
    });
    document.body.classList.add('is-busy');
  }

  function unlock() {
    locked.forEach((el) => { el.disabled = false; });
    locked = [];
    document.body.classList.remove('is-busy');
  }

  function find(sel) { return host ? host.querySelector(sel) : null; }

  /**
   * Show a progress bar inside `target` (indeterminate until update() gets a total).
   * opts: { onCancel?: () => void, keepOutline?: boolean }
   */
  function start(target, label, opts) {
    host = target;
    busy = true;
    // A button in the panel started this (Try again, Read the rest): the bar replaces it, so Cancel takes focus.
    focusCancel = !!(host && host.contains(document.activeElement));
    if (host) {
      host.innerHTML = `
        <div class="loading">
          <p class="loading-label" role="status" aria-live="polite">${PDFStudy.studyViews.escapeHtml(label || 'Working')}</p>
          <div class="progress indeterminate" role="progressbar" aria-label="Progress">
            <div class="progress-fill"></div>
          </div>
          <p class="loading-detail"></p>
        </div>`;
    }
    lock(!!(opts && opts.keepOutline));
    if (opts && opts.onCancel) showCancel(opts.onCancel);
  }

  /** Add a Cancel button under the bar (idempotent). It is created after lock(), so it stays enabled. */
  function showCancel(onCancel) {
    const box = find('.loading');
    if (!box || find('#loadingCancelBtn') || typeof onCancel !== 'function') return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'loadingCancelBtn';
    btn.className = 'btn btn-secondary btn-sm loading-cancel';
    btn.textContent = 'Cancel';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Stopping…';
      onCancel();
    });
    box.appendChild(btn);
    if (focusCancel) btn.focus();
  }

  function update(cur, total, detail, label) {
    if (!host) return;
    const bar = find('.progress');
    if (bar && total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((cur / total) * 100)));
      bar.classList.remove('indeterminate');
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(pct));
      bar.firstElementChild.style.width = `${pct}%`;
    }
    const detailEl = find('.loading-detail');
    if (detailEl) {
      detailEl.textContent = detail || (total > 0 ? `${cur} of ${total}` : '');
    }
    const labelEl = find('.loading-label');
    if (labelEl && label) labelEl.textContent = label;
  }

  function end() {
    if (host) host.innerHTML = '';
    host = null;
    busy = false;
    unlock();
  }

  PDFStudy.loading = { start, update, end, showCancel, isBusy: () => busy };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Handwriting UI: progress wording, the "read from handwriting" notice and the review/correct panel.
 * reviewItems() and noticeHtml() are pure (Node-testable); the rest touches the DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LOW = 0.6;
  let cropper = null;

  const esc = (s) => (PDFStudy.studyViews ? PDFStudy.studyViews.escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const plural = (c, w) => `${c} ${w}${c === 1 ? '' : 's'}`;
  const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const lowLimit = () => (PDFStudy.ocrLines && PDFStudy.ocrLines.LOW_CONFIDENCE) || LOW;

  function loadedPages(parsed) {
    const cache = parsed && parsed.pageCache;
    return cache && cache.size ? Array.from(cache.values()) : (parsed && parsed.pages) || [];
  }

  /** Recognised pieces in the scope: low-confidence first, then page and reading order. */
  function reviewItems(parsedPdf, startPage, endPage) {
    const items = [];
    for (const p of loadedPages(parsedPdf)) {
      if (!p || p.pageNumber < startPage || p.pageNumber > endPage) continue;
      const result = p.ink && p.ink.recognised && p.ink.result;
      if (!result) continue;
      for (const line of result.lines || []) {
        for (const r of line.regions || []) {
          const conf = typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0;
          items.push({
            pageNumber: p.pageNumber, lineIndex: line.index, regionId: r.id, kind: r.kind === 'math' ? 'math' : 'text',
            text: String(r.text == null ? '' : r.text), confidence: conf, low: conf < lowLimit(), source: r.source || 'model',
            box: r.box || null, scale: result.scale || 1,
          });
        }
      }
    }
    return items
      .map((it, i) => ({ it, i }))
      .sort((a, b) => (Number(b.it.low) - Number(a.it.low)) || (a.it.pageNumber - b.it.pageNumber) || (a.it.lineIndex - b.it.lineIndex)
        || (((a.it.box && a.it.box.x) || 0) - ((b.it.box && b.it.box.x) || 0)) || (a.i - b.i))
      .map((x) => x.it);
  }

  /** Notice markup ('' when there is nothing to say). The button carries data-hw-review. */
  function noticeHtml(stats) {
    if (!stats) return '';
    const parts = [];
    let btn = '';
    if (stats.pages > 0) {
      if (stats.engine && stats.engine.available === false) {
        parts.push('No handwriting model is installed, so the text could not be read automatically. You can type it in.');
        btn = 'Type it in';
      } else {
        parts.push(`Read ${plural(stats.pages, 'page')} from handwriting.`);
        parts.push(stats.low > 0 ? `${plural(stats.low, 'piece')} may be wrong and ${stats.low === 1 ? 'is' : 'are'} left out of your study material until you check ${stats.low === 1 ? 'it' : 'them'}.` : 'No pieces look doubtful.');
        btn = 'Review';
      }
    }
    if (stats.failed) parts.push(`${plural(stats.failed, 'page')} could not be read.`);
    const rest = stats.skipped > 0 || stats.cancelled;
    if (rest) parts.push('Reading was stopped early; pages not read are left out.');
    if (!parts.length) return '';
    return `<p class="hw-notice-text">${esc(parts.join(' '))}</p>`
      + (btn ? `<button class="btn btn-secondary btn-sm" id="hwReviewBtn" type="button" data-hw-review>${esc(btn)}</button>` : '')
      + (rest ? '<button class="btn btn-secondary btn-sm" id="hwResumeBtn" type="button" data-hw-resume>Read the rest</button>' : '');
  }

  function syncNotice(stats) {
    const box = byId('hwNotice');
    if (!box) return;
    const html = noticeHtml(stats);
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
    const btn = box.querySelector('[data-hw-review]');
    if (btn) btn.addEventListener('click', open);
    const more = box.querySelector('[data-hw-resume]');
    if (more) more.addEventListener('click', () => { if (PDFStudy.main) PDFStudy.main.recomputeStudyMaterials({ retrySkipped: true }); });
  }

  /** Loading-bar wording for ensureRecognised progress events. */
  function reportProgress(L, p) {
    if (!p || !L) return;
    if (p.phase === 'model') {
      L.update(p.done || 0, p.total || 0, p.total > 0 ? `${Math.round((100 * (p.done || 0)) / p.total)}%` : '', 'Loading the handwriting reader');
      return;
    }
    const t = p.total || 0;
    const d = Math.min(t, Math.max(1, p.done || 0));
    const where = `page ${(p.pageIndex || 0) + 1} of ${p.pageCount || 1}`;
    L.update((p.pageIndex || 0) + (t ? (p.done || 0) / t : 0), p.pageCount || 1,
      t ? `Page ${p.pageNumber}: piece ${d} of ${t} (${where})` : `Page ${p.pageNumber}: preparing (${where})`, 'Reading handwriting');
  }

  function close() {
    if (cropper) cropper.dispose();
    cropper = null;
  }

  const statusOf = (it) => (!it.text.trim() ? 'Not read' : it.low ? 'Low confidence' : 'OK');
  const fieldLabel = (it) => `${it.kind === 'math' ? 'Maths (LaTeX)' : 'Text'} on page ${it.pageNumber}, line ${it.lineIndex + 1}`;

  function rowHtml(it, i, crop) {
    const field = it.kind === 'math'
      ? `<textarea class="input hw-input" id="hwf-${i}" rows="2" spellcheck="false" autocapitalize="off"></textarea>`
      : `<input class="input hw-input" id="hwf-${i}" type="text" autocomplete="off" />`;
    return `<li class="hw-row" data-low="${it.low}">
        <div class="hw-crop">${crop ? '<canvas aria-hidden="true"></canvas>' : '<span class="hw-nocrop">Page image not available</span>'}</div>
        <div class="hw-field">
          <div class="hw-meta"><strong class="hw-status">${statusOf(it)}</strong> <span class="tag">${it.kind === 'math' ? 'Math' : 'Text'}</span>
            <span class="hw-where">Page ${it.pageNumber}, line ${it.lineIndex + 1}</span></div>
          <label class="sr-only" for="hwf-${i}">${esc(fieldLabel(it))}</label>${field}
          ${it.low && it.text.trim() ? `<label class="hw-ok" for="hwok-${i}"><input type="checkbox" id="hwok-${i}" class="hw-ok-box" /> Looks right</label>` : ''}
        </div>
      </li>`;
  }

  function pageOf(parsed, n) {
    return (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n);
  }

  async function applyAndRebuild(c, items, values, checked) {
    let changed = 0;
    items.forEach((it, i) => {
      if (values[i] === it.text && !(checked && checked[i])) return; // an unchanged row needs a tick to be confirmed
      const page = pageOf(c.parsedPdf, it.pageNumber);
      if (page && PDFStudy.ocrLines.applyCorrection(page, it.regionId, values[i])) changed++;
    });
    if (!changed) return 0;
    const M = PDFStudy.main;
    if (c.onApplied) await c.onApplied(changed);
    else if (M) {
      if (M.appState.activeMode === 'slide_deck') PDFStudy.studyPipeline.refreshSlideDeck(M.appState);
      await M.recomputeStudyMaterials();
    }
    return changed;
  }

  /** Renders the review panel into `container`. ctx: { parsedPdf, startPage, endPage, onBack?, onApplied? }. */
  function renderReview(container, ctx) {
    close();
    const c = ctx || {};
    const items = reviewItems(c.parsedPdf, c.startPage, c.endPage);
    const back = c.onBack || (() => {
      if (PDFStudy.main) PDFStudy.main.renderActiveTab();
      const b = byId('hwReviewBtn');
      if (b) b.focus();
    });
    const head = `<header class="view-head"><p class="eyebrow">Handwriting</p>
        <h2 class="view-title" id="hwReviewTitle" tabindex="-1">Check what was read</h2>
        <p class="view-meta">Fix any text that is wrong, then apply the corrections to rebuild the summary, flashcards and quizzes.</p></header>`;
    const backBtn = '<button class="btn btn-ghost btn-sm" id="hwBackBtn" type="button">Back to study view</button>';
    if (!items.length) {
      container.innerHTML = `<section class="hw-review">${head}${PDFStudy.studyViews.emptyState('Nothing to review', 'No handwriting was read in this selection.')}<p>${backBtn}</p></section>`;
      container.querySelector('#hwBackBtn').onclick = back;
      return;
    }
    const canCrop = !!(c.parsedPdf && c.parsedPdf.pdfDoc && PDFStudy.hwCrops);
    const anyLow = items.some((it) => it.low);
    let onlyLow = anyLow;
    container.innerHTML = `<section class="hw-review" aria-labelledby="hwReviewTitle">${head}
      <div class="hw-toolbar">${backBtn}
        <button class="chip" id="hwFilterBtn" type="button" aria-pressed="${onlyLow}">Only uncertain</button>
        <span class="hw-count" id="hwCount" role="status" aria-live="polite"></span>
        <button class="btn btn-primary btn-sm hw-apply" id="hwApplyBtn" type="button">Apply corrections</button>
      </div>
      <ol class="hw-list">${items.map((it, i) => rowHtml(it, i, canCrop && it.box)).join('')}</ol></section>`;
    const rows = Array.from(container.querySelectorAll('.hw-row'));
    const fields = rows.map((r, i) => { const f = r.querySelector('.hw-input'); f.value = items[i].text; return f; });
    const count = container.querySelector('#hwCount');
    const filterBtn = container.querySelector('#hwFilterBtn');
    const refresh = () => {
      let shown = 0;
      rows.forEach((r, i) => { const hide = onlyLow && !items[i].low; r.classList.toggle('hidden', hide); if (!hide) shown++; });
      filterBtn.setAttribute('aria-pressed', String(onlyLow));
      count.textContent = `Showing ${shown} of ${plural(items.length, 'piece')}`;
    };
    if (canCrop) {
      cropper = PDFStudy.hwCrops.createCropper(c.parsedPdf.pdfDoc);
      rows.forEach((r, i) => {
        const cv = r.querySelector('canvas');
        if (cv) cropper.watch(cv, { pageNumber: items[i].pageNumber, box: items[i].box, scale: items[i].scale });
      });
    }
    filterBtn.onclick = () => { onlyLow = !onlyLow; refresh(); };
    container.querySelector('#hwBackBtn').onclick = back;
    container.querySelector('#hwApplyBtn').onclick = async () => {
      const btn = container.querySelector('#hwApplyBtn');
      btn.disabled = true;
      const n = await applyAndRebuild(c, items, fields.map((f) => f.value),
        rows.map((r) => { const k = r.querySelector('.hw-ok-box'); return !!(k && k.checked); }));
      if (!n && btn.isConnected) { btn.disabled = false; count.textContent = 'No changes to apply.'; }
    };
    refresh();
    const title = container.querySelector('#hwReviewTitle');
    if (title && title.focus) title.focus();
  }

  /** Opens the review panel for the selected scope (the notice button calls this). */
  function open() {
    const M = PDFStudy.main;
    const panel = byId('activeStudyPanel');
    if (!M || !panel) return;
    const st = M.appState;
    if (st.activeTab === 'reader') st.activeTab = 'summary';
    M.renderActiveTab();
    panel.classList.remove('hidden');
    renderReview(panel, { parsedPdf: st.parsedPdf, startPage: st.selectedScope.startPage, endPage: st.selectedScope.endPage });
    if (root.scrollTo) root.scrollTo(0, 0);
  }

  PDFStudy.hwReview = { noticeHtml, syncNotice, reviewItems, renderReview, reportProgress, open, close };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwReview;
})(typeof window !== 'undefined' ? window : globalThis);

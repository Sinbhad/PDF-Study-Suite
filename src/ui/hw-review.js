/**
 * Text read from pictures, outside the checking dialog: progress wording while pages are read, the notice
 * above the study views, opening "Check what was read" (hw-check.js), and what happens when it closes:
 * the study material is rebuilt once, the student is put back where they were, and one line says what
 * changed. reviewItems() and noticeHtml() are pure (Node-testable); the rest touches the DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LOW = 0.6;
  const need = (name, file) => PDFStudy[name] || (typeof require === 'function' ? require(file) : null);
  const text = () => need('hwCheckText', './hw-check-text.js');

  const esc = (s) => (PDFStudy.studyViews ? PDFStudy.studyViews.escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  const byId = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
  const lowLimit = () => (PDFStudy.ocrLines && PDFStudy.ocrLines.LOW_CONFIDENCE) || LOW;

  function loadedPages(parsed) {
    const cache = parsed && parsed.pageCache;
    return cache && cache.size ? Array.from(cache.values()) : (parsed && parsed.pages) || [];
  }

  /** Read lines in the scope: unsure first, then page and reading order. Removed and picture lines are left out. */
  function reviewItems(parsedPdf, startPage, endPage) {
    const items = [];
    for (const p of loadedPages(parsedPdf)) {
      if (!p || p.pageNumber < startPage || p.pageNumber > endPage) continue;
      const result = p.ink && p.ink.recognised && p.ink.result;
      if (!result) continue;
      for (const line of result.lines || []) {
        for (const r of line.regions || []) {
          if (r.removed || r.kind === 'picture') continue;
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
    const n = text().notice(stats);
    if (!n.text) return '';
    const rest = stats.skipped > 0 || stats.cancelled;
    return `<p class="hw-notice-text">${esc(n.text)}</p>`
      + (n.button ? `<button class="btn btn-secondary btn-sm" id="hwReviewBtn" type="button" data-hw-review>${esc(n.button)}</button>` : '')
      + (rest ? '<button class="btn btn-secondary btn-sm" id="hwResumeBtn" type="button" data-hw-resume>Read the rest</button>' : '');
  }

  /** The build's counts, brought up to date with what the student has checked, skipped or typed in since. */
  function currentStats(stats) {
    const st = PDFStudy.main && PDFStudy.main.appState;
    if (!stats || !st || !st.parsedPdf || !PDFStudy.hwCheckModel || !PDFStudy.hwCheck) return stats;
    const now = PDFStudy.hwCheckModel.tally(st.parsedPdf, PDFStudy.hwCheck.env());
    return Object.assign({}, stats, { pages: Math.max(stats.pages || 0, now.pages), low: now.low, passed: now.passed });
  }

  function syncNotice(stats) {
    const box = byId('hwNotice');
    if (!box) return;
    const html = noticeHtml(currentStats(stats));
    box.innerHTML = html;
    box.classList.toggle('hidden', !html);
    const btn = box.querySelector('[data-hw-review]');
    if (btn) btn.addEventListener('click', () => open({ opener: btn }));
    const more = box.querySelector('[data-hw-resume]');
    if (more) more.addEventListener('click', () => { if (PDFStudy.main) PDFStudy.main.recomputeStudyMaterials({ retrySkipped: true }); });
    if (PDFStudy.hwCheckEntry) PDFStudy.hwCheckEntry.sync(Boolean(stats));
  }

  /** Loading-bar wording for ensureRecognised progress events. */
  function reportProgress(L, p) {
    if (!p || !L) return;
    if (p.phase === 'model') {
      L.update(p.done || 0, p.total || 0, p.total > 0 ? `${Math.round((100 * (p.done || 0)) / p.total)}%` : '', 'Getting the page reader ready');
      return;
    }
    const t = p.total || 0;
    const d = Math.min(t, Math.max(1, p.done || 0));
    const where = `picture page ${(p.pageIndex || 0) + 1} of ${p.pageCount || 1}`;
    L.update((p.pageIndex || 0) + (t ? (p.done || 0) / t : 0), p.pageCount || 1,
      t ? `Page ${p.pageNumber}: line ${d} of ${t} (${where})` : `Page ${p.pageNumber}: preparing (${where})`, 'Reading picture pages');
  }

  /** Opens "Check what was read". opts: { startPage?, opener? }. Returns false when no page was read. */
  function open(opts) {
    const o = opts || {};
    const opener = o.opener || (typeof document !== 'undefined' ? document.activeElement : null);
    const ok = Boolean(PDFStudy.hwCheck && PDFStudy.hwCheck.open({ startPage: o.startPage, opener }));
    if (!ok && PDFStudy.events && !(PDFStudy.hwCheck && PDFStudy.hwCheck.isOpen())) PDFStudy.events.setStatus('No text was read from pictures in this selection.');
    return ok;
  }

  /**
   * Called by main.js on every render of the study views (it used to close the old review panel). The
   * dialog is modal and closes itself, so all that is left to do is keep its entry points in step.
   */
  function close() {
    if (PDFStudy.hwCheckEntry) PDFStudy.hwCheckEntry.sync();
  }

  function returnFocus(opener) {
    const usable = (el) => el && el.isConnected && !el.disabled && el.offsetParent !== null;
    const target = [opener, byId('hwReviewBtn'), byId('hwCheckTextBtn'), byId('hwCheckTextNarrowBtn')].find(usable);
    if (!target) return;
    // Keep the student's place; scroll only when the button would otherwise sit out of sight
    // (the top bar is always in view; anything else is revealed clear of the sticky bars)
    target.focus({ preventScroll: true });
    if (!target.closest('.topbar')) target.scrollIntoView({ block: 'nearest' });
  }

  function say(message, isError) {
    if (PDFStudy.events) PDFStudy.events.setStatus(message, isError);
    if (PDFStudy.studyStates) PDFStudy.studyStates.announce(message);
  }

  /** Where the student is in the study view: how far down, and which card. */
  function place() {
    const card = document.querySelector('.fc-item[aria-current="true"]');
    return { y: root.scrollY || 0, card: card ? card.getAttribute('data-idx') : null };
  }

  function putBack(at) {
    if (at.card && at.card !== '0') {
      const card = Array.from(document.querySelectorAll('.fc-item')).find((el) => el.getAttribute('data-idx') === at.card);
      if (card) card.click();
    }
    root.scrollTo(0, at.y);
  }

  /**
   * The dialog closed. done: { lines, pictures, typed } counts what changed in it. With changes the study
   * material is rebuilt once (same section, tab, scroll position and card); without, nothing is rebuilt.
   */
  async function afterCheck(done, opener) {
    const M = PDFStudy.main;
    const st = M.appState;
    if (!done || done.lines + done.pictures + done.typed === 0) {
      syncNotice(st.handwriting);
      returnFocus(opener);
      return;
    }
    const at = place();
    say('Updating your study material…');
    if (st.activeMode === 'slide_deck') PDFStudy.studyPipeline.refreshSlideDeck(st);
    await M.recomputeStudyMaterials();
    if (st.runState && st.runState.kind === 'failed') {
      say("Your fixes are saved, but the cards couldn't be updated.", true);
      const again = document.createElement('button');
      again.type = 'button';
      again.className = 'btn-link status-dismiss';
      again.textContent = 'Try again';
      again.onclick = () => afterCheck(done, opener);
      const line = byId('uploadStatusText');
      line.insertBefore(again, line.querySelector('.status-dismiss'));
      return;
    }
    if (st.runState) return; // the student stopped the rebuild: the stopped state explains itself
    putBack(at);
    say(text().doneMessage(done));
    returnFocus(opener);
  }

  PDFStudy.hwReview = { noticeHtml, syncNotice, reviewItems, reportProgress, open, close, afterCheck };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwReview;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Outline rail: the scope tree for slides (all slides + each slide or reveal group) and books
 * (chapters with sections, filter box, custom page range). Rows are 32px, titles go through the
 * rich renderer, the selected scope always mirrors appState.selectedScope, and every row offers a
 * one-click "Quiz" action. Optional data: slide.kind / slide.pages, chapter/section isExtra
 * (collapsed "Other" group at the bottom) and section isExercises ("Exercises" tag).
 * onSelectScope(scope, readerPage, tabName?) is supplied by main.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  let searchQuery = '';
  let scopes = new Map(); // row key -> { scope, page }

  const range = (a, b) => (b > a ? `${a}–${b}` : `${a}`);

  /** One selectable row; registers its scope so clicks need no lookups. */
  function row(key, scope, page, o = {}) {
    const sv = PDFStudy.studyViews;
    const sel = PDFStudy.main.appState.selectedScope.id === scope.id;
    scopes.set(key, { scope, page });
    const t = PDFStudy.richBlocks.title(o.label, 120);
    const cls = ['tree-row', sel ? 'is-selected' : '', o.sub ? 'tree-sub' : '', o.cls || ''].filter(Boolean).join(' ');
    return `<div class="${cls}">
        <button class="tree-main" type="button" data-key="${sv.escapeHtml(key)}" title="${sv.escapeHtml(t.full)}" ${sel ? 'aria-current="true"' : ''}>
          ${o.num ? `<span class="tree-num">${o.num}</span>` : ''}<span class="tree-label">${t.html || 'Untitled'}</span>
          ${o.tag ? `<span class="tag">${o.tag}</span>` : ''}${o.meta ? `<span class="tree-meta">${o.meta}</span>` : ''}
        </button>
        <button class="tree-quiz" type="button" data-key="${sv.escapeHtml(key)}" data-quiz aria-label="Quiz: ${sv.escapeHtml(t.full)}">Quiz</button>
      </div>`;
  }

  function slidePages(s) {
    const p = s.pages;
    const nums = Array.isArray(p) ? p.map(Number).filter(Number.isFinite) : p && Number.isFinite(p.start) ? [p.start, p.end || p.start] : [];
    return nums.length ? [Math.min(...nums), Math.max(...nums)] : [s.slideNumber, s.slideNumber];
  }

  function slideTree(appState, q) {
    const total = appState.parsedPdf.numPages;
    const slides = ((appState.slideDeck && appState.slideDeck.slides) || [])
      .filter((s) => !q || String(s.title || '').toLowerCase().includes(q));
    const all = row('all', { id: 'all-slides', type: 'all_slides', title: `All slides (1–${total})`, startPage: 1, endPage: total }, 1,
      { label: 'All slides', meta: `${total}`, cls: 'is-strong' });
    const seen = {};
    slides.forEach((s) => { seen[s.title] = (seen[s.title] || 0) + 1; });
    const rows = slides.map((s) => {
      const [lo, hi] = slidePages(s);
      const ask = s.qa && (Array.isArray(s.qa) ? s.qa[0] : s.qa);
      // Several slides sharing one title (a run of lecture questions) are labelled by their question.
      const own = seen[s.title] > 1 && ask && PDFStudy.richBlocks.hasContent(ask.question) ? ask.question : s.title;
      const label = PDFStudy.richBlocks.hasContent(own) ? own : `Slide ${lo}`;
      const scope = { id: `slide-${s.slideNumber}`, type: 'single_slide', title: `${hi > lo ? `Slides ${range(lo, hi)}` : `Slide ${lo}`}: ${label}`, startPage: lo, endPage: hi };
      return row(`s${s.slideNumber}`, scope, lo, { label, num: range(lo, hi), cls: s.kind === 'section' ? 'is-strong' : s.kind === 'title' ? 'is-quiet' : '' });
    }).join('');
    return `${q ? '' : all}${rows || '<p class="tree-empty">No slides match.</p>'}`;
  }

  /** "CHAPTER 1 Limits" reads better as "Chapter 1 Limits"; the outline data itself is untouched. */
  const calm = (t) => String(t || '').replace(/^(CHAPTER|APPENDIX|PART|UNIT|SECTION)(?= )/, (m) => m[0] + m.slice(1).toLowerCase());

  function chapterNode(rawCh, appState, forceOpen) {
    const ch = { ...rawCh, title: calm(rawCh.title) };
    const selId = appState.selectedScope.id;
    const chScope = { id: ch.id, type: 'chapter', title: ch.title, startPage: ch.startPage, endPage: ch.endPage };
    const meta = `p. ${range(ch.startPage, ch.endPage)}`;
    const secs = ch.sections || [];
    if (!secs.length) return row(`c${ch.id}`, chScope, ch.startPage, { label: ch.title, meta, cls: 'is-strong' });
    const hasSel = selId === ch.id || secs.some((s) => s.id === selId);
    const t = PDFStudy.richBlocks.title(ch.title, 120);
    const esc = PDFStudy.studyViews.escapeHtml;
    return `<details class="tree-group" ${forceOpen || hasSel ? 'open' : ''}>
        <summary class="tree-row tree-summary${hasSel ? ' has-selected' : ''}" title="${esc(t.full)}">
          <span class="tree-main"><span class="tree-label">${t.html}</span><span class="tree-meta">${meta}</span></span>
        </summary>
        ${row(`c${ch.id}`, chScope, ch.startPage, { label: 'Whole chapter', meta, sub: true })}
        ${secs.map((sec) => sectionRow(ch, sec, true)).join('')}
      </details>`;
  }
  function sectionRow(ch, sec, sub) {
    const scope = { id: sec.id, type: 'section', title: `${sec.title} (${ch.title})`, label: sec.title, context: ch.title, startPage: sec.startPage, endPage: sec.endPage };
    return row(`x${sec.id}`, scope, sec.startPage, { label: sec.title, meta: `p. ${range(sec.startPage, sec.endPage)}`, sub, tag: sec.isExercises ? 'Exercises' : '' });
  }

  function bookTree(appState, q) {
    const match = (t) => String(t || '').toLowerCase().includes(q);
    const chapters = ((appState.bookHierarchy && appState.bookHierarchy.chapters) || []).map((ch) => {
      const secs = ch.sections || [];
      if (!q || match(ch.title)) return ch;
      const hit = secs.filter((s) => match(s.title));
      return hit.length ? { ...ch, sections: hit } : null;
    }).filter(Boolean);
    const core = chapters.filter((c) => !c.isExtra).map((c) => ({ ...c, sections: (c.sections || []).filter((s) => !s.isExtra) }));
    // Extra sections of real chapters (exercise sets, reviews) keep their chapter as a small heading.
    const extraSecs = chapters.filter((c) => !c.isExtra).map((c) => {
      const rows = (c.sections || []).filter((s) => s.isExtra).map((s) => sectionRow(c, s, false)).join('');
      return rows ? `<p class="tree-heading label" title="${PDFStudy.studyViews.escapeHtml(c.title)}">${PDFStudy.studyViews.escapeHtml(c.title)}</p>${rows}` : '';
    }).filter(Boolean);
    const extras = chapters.filter((c) => c.isExtra).map((c) => chapterNode(c, appState, !!q)).concat(extraSecs);
    const selInExtra = extras.some((h) => h.includes('is-selected'));
    const other = extras.length
      ? `<details class="tree-group tree-other" ${q || selInExtra ? 'open' : ''}>
          <summary class="tree-row tree-summary"><span class="tree-main"><span class="tree-label">Other</span><span class="tree-meta">${extras.length}</span></span></summary>
          ${extras.join('')}
        </details>`
      : '';
    const body = core.map((c) => chapterNode(c, appState, !!q)).join('');
    return (body || other) ? body + other : `<p class="tree-empty">${q ? 'Nothing matches that filter.' : 'No chapters were detected. Use a page range instead.'}</p>`;
  }

  function renderSidebarScopeTree(appState, onSelectScope) {
    const treeEl = document.getElementById('scopeTreeContainer');
    const headingEl = document.getElementById('sidebarHeading');
    if (!treeEl || !appState.parsedPdf) return;
    const esc = PDFStudy.studyViews.escapeHtml;
    const total = appState.parsedPdf.numPages;
    const isSlides = appState.activeMode === 'slide_deck';
    const q = searchQuery.trim().toLowerCase();
    const openRange = appState.selectedScope.type === 'custom_range';
    scopes = new Map();
    if (headingEl) headingEl.textContent = isSlides ? 'Slides' : 'Contents';

    treeEl.innerHTML = `
      <div class="tree-tools">
        <input type="search" id="sidebarSearchInput" class="input" placeholder="${isSlides ? 'Filter slides' : 'Filter chapters and sections'}"
               aria-label="${isSlides ? 'Filter slides' : 'Filter chapters and sections'}" value="${esc(searchQuery)}" />
        <details class="tree-range" ${openRange ? 'open' : ''}>
          <summary>Study a page range</summary>
          <div class="tree-range-row">
            <label class="sr-only" for="customStartPage">From page</label>
            <input type="number" id="customStartPage" min="1" max="${total}" value="${appState.selectedScope.startPage}" class="input input-num" />
            <label for="customEndPage">to</label>
            <input type="number" id="customEndPage" min="1" max="${total}" value="${Math.min(total, appState.selectedScope.endPage)}" class="input input-num" />
            <button class="btn btn-secondary btn-sm" id="applyCustomRangeBtn" type="button">Study</button>
          </div>
        </details>
      </div>
      <nav id="chapterTreeList" aria-label="${isSlides ? 'Slides' : 'Contents'}">${isSlides ? slideTree(appState, q) : bookTree(appState, q)}</nav>`;

    const searchInput = treeEl.querySelector('#sidebarSearchInput');
    searchInput.oninput = (e) => {
      searchQuery = e.target.value;
      const pos = searchInput.selectionStart;
      renderSidebarScopeTree(appState, onSelectScope);
      const next = document.getElementById('sidebarSearchInput');
      if (next) { next.focus(); next.setSelectionRange(pos, pos); }
    };
    treeEl.querySelector('#applyCustomRangeBtn').onclick = () => {
      const s = Math.max(1, Math.min(total, parseInt(treeEl.querySelector('#customStartPage').value, 10) || 1));
      const e = Math.max(s, Math.min(total, parseInt(treeEl.querySelector('#customEndPage').value, 10) || s));
      onSelectScope({ id: `custom-${s}-${e}`, type: 'custom_range', title: `Pages ${range(s, e)}`, startPage: s, endPage: e }, s);
    };
    treeEl.querySelectorAll('button[data-key]').forEach((btn) => {
      btn.onclick = () => {
        const hit = scopes.get(btn.getAttribute('data-key'));
        if (hit) onSelectScope(hit.scope, hit.page, btn.hasAttribute('data-quiz') ? 'quiz' : undefined);
      };
    });
    const current = treeEl.querySelector('.is-selected');
    if (current && current.scrollIntoView && !treeEl.contains(document.activeElement)) current.scrollIntoView({ block: 'nearest' });
  }

  PDFStudy.sidebarTree = { renderSidebarScopeTree, resetFilter: () => { searchQuery = ''; } };
})(typeof window !== 'undefined' ? window : globalThis);

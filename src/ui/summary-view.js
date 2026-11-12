/**
 * Summary view: a single reading column of key formulas, theorem/definition blocks (3px category
 * rule, no boxes), a definitions list, key concepts, takeaways and the slide-by-slide breakdown,
 * ending in a one-click "Quiz this section" action. Formatted text and math only: no page images.
 * Optional data rendered when present: summary.definitions [{term, definition, page?}], and per
 * slide kind / qa {question, answer} / definitions / table {rows} / pages.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const THEOREMISH = /theorem|formula|rule|law|lemma|corollary|algorithm|property|identity|principle|test/i;
  const SV = () => PDFStudy.studyViews;
  const RB = () => PDFStudy.richBlocks;
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

  function catClass(cat) {
    if (/example|exercise|note|remark|solution/i.test(cat)) return 'example';
    if (/guideline|summary|strategy|procedure|step/i.test(cat)) return 'guideline';
    return THEOREMISH.test(cat) ? 'theorem' : 'definition';
  }
  const math = (tex) => (PDFStudy.mathRenderer ? PDFStudy.mathRenderer.renderMath(tex, true) : SV().escapeHtml(tex));
  const texOf = (raw) => String(raw || '').replace(/^\$\$?|\$\$?$/g, '').trim();

  function section(title, count, inner, cls = '') {
    if (!inner) return '';
    return `<section class="sec ${cls}"><h3 class="sec-title">${title}${count ? `<span class="sec-count">${count}</span>` : ''}</h3>${inner}</section>`;
  }

  /** Block formulas that are not already written out in the body. */
  function extraFormulas(blk) {
    const body = norm(blk.body);
    const seen = new Set();
    return [].concat(blk.formulas || [], blk.formula ? [blk.formula] : []).map((raw) => {
      const tex = texOf(raw);
      const key = norm(tex);
      if (!key || seen.has(key) || body.includes(key)) return '';
      seen.add(key);
      return math(tex);
    }).join('');
  }

  function dblock(blk) {
    const sv = SV();
    const cat = String(blk.category || 'Definition');
    const title = norm(blk.title) === norm(cat) ? '' : sv.titled('h4', 'dblock-title', blk.title, 180);
    const body = sv.block(blk.body);
    const formulas = extraFormulas(blk);
    if (!title && !body && !formulas) return '';
    const page = blk.pageNumber || blk.page || (blk.bbox || blk.clip || blk.sourceBbox || {}).page;
    return `<article class="dblock cat-${catClass(cat)}">
        <div class="dblock-head"><span class="badge">${sv.escapeHtml(cat)}</span>${sv.pageJump(page)}</div>
        ${title}${body}${formulas ? `<div class="prose">${formulas}</div>` : ''}
      </article>`;
  }

  function defList(defs) {
    const sv = SV();
    const seen = new Set();
    const rows = (defs || []).map((d) => {
      const term = sv.rich(d && d.term);
      const text = sv.rich(d && d.definition);
      const key = norm(d && d.term);
      if (!term || !text || seen.has(key)) return '';
      seen.add(key);
      return `<div class="def"><dt>${term}</dt><dd>${text}${sv.pageJump(d.page || d.pageNumber)}</dd></div>`;
    }).join('');
    return rows ? `<dl class="deflist">${rows}</dl>` : '';
  }

  function formulaRows(list) {
    const sv = SV();
    return (list || []).map((f) => {
      const tex = texOf(typeof f === 'string' ? f : f.tex || f.formula);
      if (!tex) return '';
      const label = typeof f === 'string' ? '' : sv.rich(f.title || f.label);
      // A "formula" that still holds `$` after unwrapping is prose with inline math: render it as text.
      const body = /\$/.test(tex) ? sv.block(typeof f === 'string' ? f : f.tex || f.formula) : math(tex);
      return `<div class="formula-row">${label ? `<p class="formula-label">${label}</p>` : ''}${body}</div>`;
    }).join('');
  }

  function slideLabel(e) {
    const p = e.pages;
    const nums = Array.isArray(p) ? p.map(Number).filter(Number.isFinite) : p && Number.isFinite(p.start) ? [p.start, p.end || p.start] : [];
    const lo = nums.length ? Math.min(...nums) : e.slideNumber;
    const hi = nums.length ? Math.max(...nums) : e.slideNumber;
    return hi > lo ? `Slides ${lo}–${hi}` : `Slide ${lo}`;
  }

  /** qa: one { question, answer } or a list of them; each is a prompt with a click-to-reveal answer. */
  function qaHtml(qa, titleText) {
    if (Array.isArray(qa)) return qa.map((one) => qaHtml(one, titleText)).join('');
    const sv = SV();
    const answer = qa && sv.block(qa.answer);
    if (!answer) return '';
    const q = norm(qa.question) && norm(qa.question) !== norm(titleText) ? sv.block(qa.question) : '';
    return `<div class="qa">${q}<details class="reveal">
        <summary><span class="when-closed">Show answer</span><span class="when-open">Hide answer</span></summary>
        <div class="answer"><span class="label">Answer</span>${answer}</div></details></div>`;
  }

  function slideHtml(entry, slides) {
    const sv = SV();
    const src = slides.get(entry.slideNumber) || {};
    const e = { kind: src.kind, qa: src.qa, definitions: src.definitions, table: src.table, pages: src.pages, ...entry };
    const title = sv.titled('h4', 'slide-title', e.title, 220);
    // A takeaway that just restates one of the slide's definitions is shown once, as the definition.
    const defTexts = (e.definitions || []).map((d) => norm(d && d.definition)).filter(Boolean);
    const restated = (b) => defTexts.some((d) => norm(b).includes(d) || d.includes(norm(b)));
    const items = (e.takeaways || []).filter((b) => !restated(b)).map((b) => sv.rich(b)).filter(Boolean);
    const body = [
      items.length ? `<div class="prose"><ul>${items.map((b) => `<li>${b}</li>`).join('')}</ul></div>` : '',
      defList(e.definitions),
      e.table ? RB().table(e.table.rows || e.table) : '',
      qaHtml(e.qa, e.title),
    ].join('');
    if (!title && !body) return '';
    const kindTag = { question: 'Question', table: 'Table', section: 'Section' }[e.kind] || '';
    return `<article class="slide${e.kind === 'section' || e.kind === 'title' ? ' is-section' : ''}">
        <div class="slide-head"><span class="label nums">${slideLabel(e)}</span>${kindTag ? `<span class="tag">${kindTag}</span>` : ''}${sv.pageJump(e.slideNumber)}</div>
        ${title}${body}
      </article>`;
  }

  function quizCta() {
    const st = PDFStudy.main && PDFStudy.main.appState;
    if (!st) return '';
    const quizN = (st.generated.quiz || []).length;
    const cardN = (st.generated.flashcards || []).length;
    const what = { all_slides: 'all slides', single_slide: 'this slide', chapter: 'this chapter', custom_range: 'these pages' }[st.selectedScope.type] || 'this section';
    const sub = quizN ? `${quizN} question${quizN === 1 ? '' : 's'} from what you just read.` : 'There is not enough material here for quiz questions yet.';
    return `<aside class="cta" aria-label="Next steps">
        <div><p class="cta-title">Ready to test yourself?</p><p class="cta-sub">${sub}</p></div>
        <div class="cta-actions">
          ${cardN ? `<button class="btn btn-secondary" type="button" data-go-tab="flashcards">Review ${cardN} flashcard${cardN === 1 ? '' : 's'}</button>` : ''}
          <button class="btn btn-primary" type="button" id="quizScopeBtn" data-go-tab="quiz" ${quizN ? '' : 'disabled'}>Quiz ${what}</button>
        </div>
      </aside>`;
  }

  function renderSummaryView(container, data, scopeTitle) {
    if (!container) return;
    const sv = SV();
    const d = data || {};
    const blocks = (d.didacticBlocks || []).concat((d.keyFormulas || []).filter((f) => f && typeof f === 'object' && !f.tex && !f.formula && f.body));
    const pick = (test) => blocks.filter(test).map(dblock).filter(Boolean);
    const isDef = (b) => /definition/i.test(b.category || 'Definition');
    const theorems = pick((b) => !isDef(b) && catClass(b.category || '') === 'theorem');
    const defBlocks = pick(isDef);
    const others = pick((b) => !isDef(b) && catClass(b.category || '') !== 'theorem');
    // A mined definition that a Definition block already states in full is shown once, as the block.
    const blockBodies = blocks.filter(isDef).map((b) => norm(b.body)).filter(Boolean);
    const defs = defList((d.definitions || []).filter((x) => !blockBodies.some((b) => b.includes(norm(x && x.definition)) || norm(x && x.definition).includes(b))));
    const defCount = (defs.match(/class="def"/g) || []).length + defBlocks.length;
    const terms = (d.keyTerms || []).map((t) => sv.rich(t)).filter(Boolean);
    const points = (d.sentences || d.overviewSentences || []).map((s) => sv.rich(s)).filter(Boolean);
    const st = PDFStudy.main && PDFStudy.main.appState;
    const slideMap = new Map(((st && st.slideDeck && st.slideDeck.slides) || []).map((s) => [s.slideNumber, s]));
    const slides = (d.slideBreakdown || []).map((e) => slideHtml(e, slideMap)).filter(Boolean);
    const formulas = formulaRows(d.keyFormulas);

    const body = [
      section('Key formulas', 0, formulas),
      section('Theorems and rules', theorems.length, theorems.join('')),
      section('Definitions', defCount, defs + defBlocks.join('')),
      section('Guidelines and examples', others.length, others.join('')),
      section('Key concepts', 0, terms.length ? `<ul class="term-list">${terms.map((t) => `<li class="term">${t}</li>`).join('')}</ul>` : ''),
      section('Key takeaways', 0, points.length ? `<div class="prose"><ul>${points.map((s) => `<li>${s}</li>`).join('')}</ul></div>` : ''),
      section('Slide by slide', slides.length, slides.join('')),
    ].join('');

    container.innerHTML = sv.viewHead('Summary', scopeTitle) +
      (body || sv.emptyState('Nothing to summarise here', 'Pick a section with full paragraphs of text. Headings and exercise lists do not summarise well.')) +
      quizCta();
    sv.bindPageJumps(container);
  }

  PDFStudy.summaryView = { renderSummaryView, dblock, defList, slideHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.summaryView;
})(typeof window !== 'undefined' ? window : globalThis);

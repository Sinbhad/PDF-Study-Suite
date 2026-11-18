/**
 * Summary outline view: renders summary.outline (deck-outline.js / book-outline.js) as one honest lead
 * sentence, "What this lecture covers", linked key terms and the material's own sections as <details> (first
 * two open). Every line carries its "Slide N" / "View p. N" link.
 *   Deck: section -> topic -> each slide's points, with "N more on this slide" holding back the rest.
 *   Book: heading -> boxes the extraction found (definitions titled by term, theorems, key concepts, common
 *   errors), defined terms, formulas, tables, then lifted statements. A box whose symbols were lost in
 *   extraction says so instead of being shown as if it were right.
 *   outlineHtml(outline) -> '' when there is nothing to show (the caller shows its empty state)
 *   bindTermLinks(container), qaHtml(qa, titleText)
 * Uses studyViews / richBlocks for escaping, rich text, tables and page links.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const SV = () => PDFStudy.studyViews;
  const RB = () => PDFStudy.richBlocks;
  const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

  // Sections open on arrival; the rest stay collapsed so the outline reads as a map first.
  const OPEN_SECTIONS = 2;
  const FLAG_TEXT = {
    symbols: 'Some symbols (such as a complement bar) were lost when this page was read, so this may not be stated correctly. Check the page.',
    text: 'Part of this text was garbled when the page was read. Check the page.',
  };

  const slideJump = (n) => (n > 0 ? `<button class="page-jump" type="button" data-jump-page="${n}">Slide&nbsp;${n}</button>` : '');
  const refId = (ref) => `sum-${String(ref).replace(/[^\w-]/g, '')}`;
  const refAttr = (ref) => (ref ? ` id="${refId(ref)}" tabindex="-1"` : '');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

  /** Sub-points: each a text, or { text, children } with its own nested lines. */
  function subList(children) {
    const sv = SV();
    const items = (children || []).map((c) => {
      const text = sv.rich(typeof c === 'string' ? c : c && c.text);
      return text ? `<li>${text}${typeof c === 'string' ? '' : subList(c.children)}</li>` : '';
    }).join('');
    return items ? `<ul>${items}</ul>` : '';
  }

  /** A point with its sub-points; `jump` adds the slide link after its text. */
  function pointHtml(b, jump) {
    const text = SV().rich(b.text);
    if (!text) return '';
    return `<li${refAttr(b.ref)}>${text}${jump ? ` ${jump}` : ''}${subList(b.children)}</li>`;
  }

  /** The points of a slide that the outline held back: every one, behind "N more on this slide". */
  function heldHtml(e) {
    const sv = SV();
    if (!(e.held > 0)) return '';
    const units = (e.more || []).map((b) => pointHtml({ text: b.text, children: [...(b.children || []), ...(b.more || [])] }, ''));
    const tails = (e.bullets || []).filter((b) => (b.more || []).length)
      .map((b) => `<li><span class="sum-cont">${sv.rich(b.text)} (continued)</span>${subList(b.more)}</li>`);
    const items = units.concat(tails).join('');
    if (!items) return '';
    return `<details class="sum-more"><summary>${plural(e.held, 'more point')} on this slide</summary>
        <div class="prose sum-points"><ul>${items}</ul></div></details>`;
  }

  /** One slide's points; the slide link sits on its first line. */
  function slideGroup(e) {
    const items = (e.bullets || []).map((b, i) => pointHtml(b, i === 0 ? slideJump(e.page) : '')).join('');
    const rows = e.table && e.table.rows;
    const table = rows && rows.length ? `<div class="sum-table">${RB().table(rows)}<p class="sum-note">${e.table.more ? `${plural(e.table.more, 'more row')} on the slide. ` : ''}${slideJump(e.page)}</p></div>` : '';
    const qa = e.qa && e.qa.length ? qaHtml(e.qa, '') : '';
    const held = heldHtml(e);
    // A slide whose every point was held back still gets its link.
    const lone = !items && held ? `<p class="sum-note">${slideJump(e.page)}</p>` : '';
    if (!items && !table && !qa && !held) return '';
    const notes = PDFStudy.slideNotes ? PDFStudy.slideNotes.html(e.slide || e.page) : '';
    return `<div class="sum-slide">${items ? `<div class="prose sum-points"><ul>${items}</ul></div>` : ''}${lone}${held}${table}${qa}${notes}</div>`;
  }

  function deckSectionBody(sec) {
    const sv = SV();
    const single = sec.topics.length === 1 && norm(sec.topics[0].title) === norm(sec.title);
    return sec.topics.map((tp) => {
      const body = tp.slides.map(slideGroup).join('');
      if (!body) return '';
      return `<div class="sum-topic">${single ? '' : sv.titled('h4', 'sum-topic-title', tp.title, 200)}${body}</div>`;
    }).join('');
  }

  function catClass(cat) {
    if (/error|pitfall|caution|warning/i.test(cat)) return 'example';
    if (/key\s*concept/i.test(cat)) return 'guideline';
    return /theorem|law|rule|lemma|corollary|principle|property|identity|axiom|postulate|proposition/i.test(cat) ? 'theorem' : 'definition';
  }

  /** A box the extraction found: the book's label as its badge, the defined term as its title. */
  function boxHtml(b, ref) {
    const sv = SV();
    const title = sv.titled('h4', 'dblock-title', b.title, 180);
    const body = sv.block(b.body);
    if (!title && !body) return '';
    const flag = FLAG_TEXT[b.flag] ? `<p class="sum-flag" role="note">${FLAG_TEXT[b.flag]}</p>` : '';
    return `<article class="dblock cat-${catClass(b.category || '')}"${refAttr(ref)}>
        <div class="dblock-head"><span class="badge">${sv.escapeHtml(b.label || b.category || '')}</span>${sv.pageJump(b.page)}</div>
        ${title}${body}${flag}
      </article>`;
  }

  function bookSectionBody(sec, si) {
    const sv = SV();
    const math = (tex) => (PDFStudy.mathRenderer ? PDFStudy.mathRenderer.renderMath(tex, true) : sv.escapeHtml(tex));
    const blocks = (sec.blocks || []).map((b, bi) => boxHtml(b, `s${si}-b${bi}`)).join('');
    const defs = (sec.definitions || []).map((d, di) => {
      const term = sv.rich(d.term);
      const text = sv.rich(d.text);
      return term && text ? `<div class="def"${refAttr(`s${si}-d${di}`)}><dt>${term}</dt><dd>${text}${sv.pageJump(d.page)}</dd></div>` : '';
    }).join('');
    const formulas = (sec.formulas || []).map((f) => {
      const label = sv.rich(f.title);
      const tex = String(f.body || '').replace(/^\$\$?|\$\$?$/g, '').trim();
      // A listing (kind 'code') or prose with inline math is block text; a bare formula is typeset
      const body = f.kind === 'code' || /\$/.test(f.body) || !PDFStudy.mathRenderer ? sv.block(f.body) : math(tex);
      return body ? `<div class="formula-row">${label ? `<p class="formula-label">${label}</p>` : ''}${body}<p class="sum-note">${sv.pageJump(f.page)}</p></div>` : '';
    }).join('');
    const tables = (sec.tables || []).map((t) => {
      if (!t.rows || !t.rows.length) return '';
      const caption = t.title ? `<p class="formula-label">${sv.rich(t.title)}</p>` : '';
      return `<div class="sum-table">${caption}${RB().table(t.rows)}<p class="sum-note">${t.more ? `${plural(t.more, 'more row')} in the book. ` : ''}${sv.pageJump(t.page)}</p></div>`;
    }).join('');
    const points = (sec.statements || []).map((s, xi) => {
      const text = sv.rich(s.text);
      return text ? `<li${refAttr(`s${si}-x${xi}`)}>${text} ${sv.pageJump(s.page)}</li>` : '';
    }).join('');
    return [
      blocks ? `<div class="sum-blocks">${blocks}</div>` : '',
      defs ? `<dl class="deflist">${defs}</dl>` : '',
      formulas ? `<div class="sum-formulas">${formulas}</div>` : '',
      tables,
      points ? `<div class="prose sum-points"><ul>${points}</ul></div>` : '',
    ].join('');
  }

  function itemCount(sec) {
    if (sec.topics) {
      return sec.topics.reduce((n, tp) => n + tp.slides.reduce((m, e) => m + (e.bullets || []).length + (e.more || []).length + (e.table ? 1 : 0), 0), 0);
    }
    return ['blocks', 'definitions', 'formulas', 'tables', 'statements'].reduce((n, k) => n + (sec[k] || []).length, 0);
  }

  function section(title, count, inner) {
    if (!inner) return '';
    return `<section class="sec"><h3 class="sec-title">${title}${count ? `<span class="sec-count">${count}</span>` : ''}</h3>${inner}</section>`;
  }

  function outlineHtml(o) {
    const sv = SV();
    const deck = o.kind === 'deck';
    const sections = (o.sections || []).map((sec, i) => {
      const body = deck ? deckSectionBody(sec) : bookSectionBody(sec, i);
      if (!body) return '';
      const n = itemCount(sec);
      const where = sec.page ? `${deck ? 'Slide' : 'p.'}&nbsp;${sv.escapeHtml((!deck && sv.printedPage && sv.printedPage(sec.page)) || String(sec.page))}` : '';
      return `<details class="sum-sec"${i < OPEN_SECTIONS ? ' open' : ''}>
          <summary class="sum-sec-head"><span class="sum-sec-title">${sv.rich(sec.title) || 'Untitled part'}</span><span class="sum-sec-meta">${where}${where ? ' · ' : ''}${n}&nbsp;point${n === 1 ? '' : 's'}</span></summary>
          <div class="sum-sec-body">${body}</div>
        </details>`;
    }).filter(Boolean);
    if (!sections.length && !(o.covers || []).length) return '';
    const covers = (o.covers || []).map((c) => `<li>${sv.rich(c.text)} ${slideJump(c.page)}${subList(c.answers)}</li>`).join('');
    const terms = (o.terms || []).map((t) => `<li><a class="term term-link" href="#${refId(t.ref)}" data-sum-ref="${refId(t.ref)}">${sv.rich(t.term)}</a></li>`).join('');
    return [
      `<p class="sum-lead">${sv.escapeHtml(o.lead || '')}</p>`,
      covers ? section('What this lecture covers', 0, `<div class="prose sum-points"><ul>${covers}</ul></div>`) : '',
      terms ? section('Key terms', (o.terms || []).length, `<ul class="term-list">${terms}</ul>`) : '',
      sections.length ? `<section class="sec sum-outline" aria-label="Outline">${sections.join('')}</section>` : '',
    ].join('');
  }

  /** Key-term links open the collapsed part that holds the definition, then move focus to it. */
  function bindTermLinks(container) {
    container.querySelectorAll('[data-sum-ref]').forEach((a) => {
      a.onclick = (ev) => {
        const target = container.querySelector(`#${a.getAttribute('data-sum-ref')}`);
        if (!target) return;
        ev.preventDefault();
        const holder = target.closest('details');
        if (holder) holder.open = true;
        target.scrollIntoView({ block: 'center' });
        target.focus({ preventScroll: true });
      };
    });
  }

  PDFStudy.summaryOutline = { outlineHtml, bindTermLinks, qaHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.summaryOutline;
})(typeof window !== 'undefined' ? window : globalThis);

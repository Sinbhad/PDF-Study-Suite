/**
 * The list of lines on the "Check what was read" screen: one row per line with its number, its state as a
 * word, an editable field, and (in the row being worked on) the tools for that line. Markup and field
 * behaviour only; what the buttons and keys do is hw-check-actions.js.
 *   html(ctx)                 ctx: { pageNumber, rows, currentId, left, last }
 *   sync(pane, ctx)           update the rows in place when the same lines are shown (focus is kept), else redraw
 *   bind(pane, { focus(id), commit(id), hover(id | null) })
 *   field(pane, id) / valueOf(pane, id) / focusField(pane, id) / setCurrent(pane, id) / setHover(pane, id)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const T = () => PDFStudy.hwCheckText;
  const grows = () => Boolean(root.CSS && root.CSS.supports && root.CSS.supports('field-sizing', 'content'));

  const numberOf = (row) => (row.parts > 1 ? `${row.line}.${row.part}` : String(row.line));
  const metaHtml = (row) => `<span class="hw-line-num">${numberOf(row)}</span>${T().tags(row).map((t) => `<span class="tag">${t}</span>`).join('')}`;

  function toolsHtml(row) {
    const id = esc(row.id);
    if (row.state === 'picture') {
      return `<div class="hw-line-tools is-always"><button class="btn btn-ghost btn-sm" type="button" data-act="use-text" data-id="${id}">Use as text</button></div>`;
    }
    return `<div class="hw-line-tools">
        <button class="btn btn-ghost btn-sm" type="button" data-act="remove" data-id="${id}">Remove line</button>
        <button class="btn btn-ghost btn-sm" type="button" data-act="add" data-id="${id}">Add line below</button>
        ${row.box ? `<button class="btn btn-ghost btn-sm" type="button" data-act="picture" data-id="${id}">Keep as picture</button>` : ''}
      </div>`;
  }

  function rowHtml(row, currentId) {
    const id = esc(row.id);
    const body = row.state === 'picture'
      ? '<p class="hw-picture-note">Kept as a picture. It can become a picture card.</p>'
      : `<textarea class="input hw-input${row.math ? ' hw-input-math' : ''}" rows="1" data-field data-id="${id}" aria-label="${esc(T().fieldName(row))}"
          enterkeyhint="next" autocomplete="off" spellcheck="${row.math ? 'false' : 'true'}" autocapitalize="${row.math ? 'off' : 'sentences'}">${esc(row.text)}</textarea>`;
    return `<li class="hw-line" data-id="${id}" data-state="${row.state}" data-low="${row.state === 'check'}"${row.id === currentId ? ' data-current="true"' : ''}>
        <div class="hw-line-meta">${metaHtml(row)}</div>
        ${body}
        ${toolsHtml(row)}
      </li>`;
  }

  /** The one primary action: accept what is left on the page, then move on. */
  function footHtml(ctx) {
    if (ctx.left > 0) {
      return `<div class="cta-actions">
          <button class="btn btn-primary" type="button" id="hwPrimaryBtn" data-act="looks-right" aria-describedby="hwLooksNote">Looks right</button>
          <button class="btn btn-ghost" type="button" data-act="skip">Skip this page</button>
        </div>
        <p class="hw-foot-note" id="hwLooksNote">${esc(T().looksRightNote(ctx.left))}</p>`;
    }
    const next = ctx.last
      ? '<button class="btn btn-primary" type="button" id="hwPrimaryBtn" data-act="done">Done</button>'
      : '<button class="btn btn-primary" type="button" id="hwPrimaryBtn" data-act="next-page">Next page</button>';
    return `<div class="cta-actions">${next}</div>
        <p class="hw-foot-note" id="hwLooksNote">Nothing left to check on this page.</p>`;
  }

  function html(ctx) {
    return `<div class="hw-lines-head">
        <h3 class="sec-title hw-lines-title" id="hwLinesTitle" tabindex="-1">Lines on page ${ctx.pageNumber}</h3>
        <button class="btn btn-secondary btn-sm" type="button" data-act="next-unsure">Next unsure line <kbd class="hw-kbd">F8</kbd></button>
      </div>
      <p class="view-note hw-hint">
        <span class="hw-wide">Enter accepts a line and goes to the next one to check. Shift+Enter goes back.</span>
        <span class="hw-narrow">Tap return to accept a line and go to the next one.</span>
      </p>
      <ol class="hw-list" id="hwLineList" aria-labelledby="hwLinesTitle">${ctx.rows.map((r) => rowHtml(r, ctx.currentId)).join('')}</ol>
      <div class="hw-check-foot" id="hwLinesFoot" data-kind="${ctx.left > 0 ? 'left' : ctx.last ? 'last' : 'next'}">${footHtml(ctx)}</div>`;
  }

  const items = (pane) => Array.from(pane.querySelectorAll('.hw-line'));
  const item = (pane, id) => items(pane).find((li) => li.getAttribute('data-id') === String(id)) || null;
  const field = (pane, id) => {
    const li = item(pane, id);
    return li ? li.querySelector('[data-field]') : null;
  };

  /** A field is as tall as its text (CSS field-sizing where the browser has it, measured otherwise). */
  function fit(area) {
    if (grows()) return;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
  }

  /** Same lines as on screen: only states, tags, names and saved text change, so focus and caret stay put. */
  function updateInPlace(pane, ctx) {
    const shown = items(pane);
    const same = shown.length === ctx.rows.length && shown.every((li, i) => {
      const row = ctx.rows[i];
      return li.getAttribute('data-id') === String(row.id) && (li.getAttribute('data-state') === 'picture') === (row.state === 'picture');
    });
    if (!same) return false;
    shown.forEach((li, i) => {
      const row = ctx.rows[i];
      li.setAttribute('data-state', row.state);
      li.setAttribute('data-low', String(row.state === 'check'));
      li.querySelector('.hw-line-meta').innerHTML = metaHtml(row);
      const area = li.querySelector('[data-field]');
      if (!area) return;
      area.setAttribute('aria-label', T().fieldName(row));
      if (area.value !== row.text) area.value = row.text;
      fit(area);
    });
    const foot = pane.querySelector('#hwLinesFoot');
    const kind = ctx.left > 0 ? 'left' : ctx.last ? 'last' : 'next';
    if (foot.getAttribute('data-kind') === kind) foot.querySelector('#hwLooksNote').textContent = ctx.left > 0 ? T().looksRightNote(ctx.left) : 'Nothing left to check on this page.';
    else {
      foot.setAttribute('data-kind', kind);
      foot.innerHTML = footHtml(ctx);
    }
    return true;
  }

  function sync(pane, ctx) {
    if (!pane.querySelector('#hwLineList') || !updateInPlace(pane, ctx)) {
      pane.innerHTML = html(ctx);
      pane.querySelectorAll('[data-field]').forEach(fit);
    }
    setCurrent(pane, ctx.currentId);
  }

  function setCurrent(pane, id) {
    for (const li of items(pane)) {
      if (li.getAttribute('data-id') === String(id)) li.setAttribute('data-current', 'true');
      else li.removeAttribute('data-current');
    }
  }

  function setHover(pane, id) {
    for (const li of items(pane)) li.classList.toggle('is-hover', id != null && li.getAttribute('data-id') === String(id));
  }

  function valueOf(pane, id) {
    const area = field(pane, id);
    return area ? area.value : null;
  }

  function focusField(pane, id) {
    const area = field(pane, id);
    if (!area) return false;
    area.focus();
    area.setSelectionRange(area.value.length, area.value.length);
    return true;
  }

  function bind(pane, on) {
    const idOf = (el) => (el && el.closest && el.closest('.hw-line') ? el.closest('.hw-line').getAttribute('data-id') : null);
    pane.addEventListener('focusin', (e) => {
      if (e.target.matches && e.target.matches('[data-field]')) on.focus(idOf(e.target));
    });
    pane.addEventListener('input', (e) => {
      const area = e.target;
      if (!area.matches || !area.matches('[data-field]')) return;
      // a line is one line: a pasted paragraph is joined with spaces
      if (/[\r\n]/.test(area.value)) area.value = area.value.replace(/\s*[\r\n]+\s*/g, ' ');
      fit(area);
    });
    pane.addEventListener('change', (e) => {
      if (e.target.matches && e.target.matches('[data-field]')) on.commit(idOf(e.target));
    });
    pane.addEventListener('mouseover', (e) => on.hover(idOf(e.target)));
    pane.addEventListener('mouseleave', () => on.hover(null));
  }

  PDFStudy.hwCheckLines = { html, sync, bind, field, valueOf, focusField, setCurrent, setHover };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * The page image of the "Check what was read" screen: the rendered page with a mark on every line that
 * was read, zoom and pan, and (on a phone) the strip that shows the line being checked on its own.
 *   view = hwPageView.create(host, { onPick(id), onHover(id | null) })
 *   view.show({ pdfDoc, page, rows })   render a page (rows: hw-check-model.js)
 *   view.setRows(rows) / view.setCurrent(id) / view.setHover(id)
 *   view.act('zoom-in' | 'zoom-out' | 'fit' | 'pan-left' | ...)      the image group's keys and buttons
 *   view.setCount(text) / view.setWhole(bool) / view.dispose()
 * Marks are placed in percentages of the page, so they stay on their lines at every zoom.
 * Dragging, pinching and Ctrl + wheel are in hw-page-gestures.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const RENDER_WIDTH = 1600; // px the page is rendered at; zooming scales this one bitmap
  const MAX_RENDER_SCALE = 3;

  const TEMPLATE = `
    <div class="hw-strip" id="hwStrip"></div>
    <div class="reader-toolbar hw-image-bar">
      <span class="hw-strip-count" id="hwStripCount"></span>
      <button class="btn btn-ghost btn-sm hw-whole-btn" id="hwWholeBtn" type="button" aria-pressed="false">Show whole page</button>
      <div class="reader-group hw-zoom">
        <button class="btn btn-ghost btn-sm" type="button" data-view-act="zoom-out" aria-label="Zoom out">−</button>
        <span class="hw-zoom-label" id="hwZoomLabel" aria-live="off">100%</span>
        <button class="btn btn-ghost btn-sm" type="button" data-view-act="zoom-in" aria-label="Zoom in">+</button>
        <button class="btn btn-ghost btn-sm" type="button" data-view-act="fit">Fit</button>
      </div>
    </div>
    <div class="hw-page-scroll" id="hwPageScroll" role="group" tabindex="0" aria-describedby="hwImageHint">
      <div class="hw-page" id="hwPage"><div class="hw-marks" aria-hidden="true"></div></div>
      <div class="hw-page-state" id="hwPageState"></div>
    </div>
    <p class="sr-only" id="hwImageHint">Arrow keys move the page. Plus and minus zoom. 0 fits the page.</p>`;

  const WAIT = '<div class="loading"><p class="loading-label">Loading page…</p><div class="progress indeterminate" role="progressbar" aria-label="Progress"><div class="progress-fill"></div></div></div>';
  const FAILED = '<p class="hw-page-error" role="alert">This page couldn\'t be shown. You can still fix its lines.</p>';

  const calm = () => Boolean(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function create(host, opts) {
    const o = opts || {};
    const G = PDFStudy.hwPageGeometry;
    host.innerHTML = TEMPLATE;
    const find = (sel) => host.querySelector(sel);
    const scroller = find('#hwPageScroll');
    const pageEl = find('#hwPage');
    const marksEl = find('.hw-marks');
    const stateEl = find('#hwPageState');
    const wholeBtn = find('#hwWholeBtn');
    const strip = PDFStudy.hwCrops.createStrip(find('#hwStrip'));

    let zoom = 1;
    let token = 0;
    let canvas = null;
    let size = { w: 0, h: 0 };
    let rows = [];
    let currentId = null;
    let dead = false;

    function release() {
      if (!canvas) return;
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      canvas = null;
    }

    const markOf = (id) => Array.from(marksEl.children).find((m) => m.getAttribute('data-id') === String(id)) || null;

    function drawMarks() {
      marksEl.innerHTML = '';
      for (const row of rows) {
        const at = G.boxPercent(row.box, size);
        if (!at) continue;
        const mark = document.createElement('span');
        mark.className = 'hw-mark';
        mark.setAttribute('data-id', row.id);
        mark.setAttribute('data-state', row.state);
        mark.style.left = `${at.left}%`;
        mark.style.top = `${at.top}%`;
        mark.style.width = `${at.width}%`;
        mark.style.height = `${at.height}%`;
        const num = document.createElement('span');
        num.className = 'hw-mark-num';
        num.textContent = row.parts > 1 ? `${row.line}.${row.part}` : String(row.line);
        mark.appendChild(num);
        marksEl.appendChild(mark);
      }
      padMarks();
      markCurrent();
    }

    /** Small boxes get a larger area that takes the click (never a larger outline). */
    function padMarks() {
      const w = pageEl.clientWidth;
      const h = pageEl.clientHeight;
      for (const mark of marksEl.children) {
        const pad = G.hitPad((parseFloat(mark.style.width) / 100) * w, (parseFloat(mark.style.height) / 100) * h);
        mark.style.setProperty('--hit-x', `${-Math.min(pad.x, 8)}px`);
        mark.style.setProperty('--hit-y', `${-Math.min(pad.y, 8)}px`);
      }
    }

    function markCurrent() {
      for (const mark of marksEl.children) mark.classList.toggle('is-current', mark.getAttribute('data-id') === String(currentId));
    }

    function drawStrip() {
      const row = rows.find((r) => r.id === currentId);
      if (!canvas || !row) {
        strip.clear('');
        return;
      }
      strip.show(canvas, G.scaleBox(row.box, size, canvas.width));
    }

    function centre() {
      const mark = markOf(currentId);
      if (!mark) return;
      const to = G.centreScroll(
        { left: pageEl.offsetLeft + mark.offsetLeft, top: pageEl.offsetTop + mark.offsetTop, width: mark.offsetWidth, height: mark.offsetHeight },
        { width: scroller.clientWidth, height: scroller.clientHeight },
        { width: scroller.scrollWidth, height: scroller.scrollHeight }
      );
      scroller.scrollTo({ left: to.left, top: to.top, behavior: calm() ? 'auto' : 'smooth' });
    }

    function setZoom(next) {
      const cx = scroller.scrollWidth ? (scroller.scrollLeft + scroller.clientWidth / 2) / scroller.scrollWidth : 0.5;
      const cy = scroller.scrollHeight ? (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight : 0;
      zoom = G.clampZoom(next);
      pageEl.style.width = `${zoom * 100}%`;
      find('#hwZoomLabel').textContent = G.zoomLabel(zoom);
      scroller.scrollLeft = cx * scroller.scrollWidth - scroller.clientWidth / 2;
      scroller.scrollTop = cy * scroller.scrollHeight - scroller.clientHeight / 2;
      padMarks();
    }

    function act(name) {
      const dx = G.panStep(scroller.clientWidth);
      const dy = G.panStep(scroller.clientHeight);
      if (name === 'zoom-in') setZoom(G.zoomStep(zoom, 1));
      else if (name === 'zoom-out') setZoom(G.zoomStep(zoom, -1));
      else if (name === 'fit') setZoom(1);
      else if (name === 'pan-left') scroller.scrollLeft -= dx;
      else if (name === 'pan-right') scroller.scrollLeft += dx;
      else if (name === 'pan-up') scroller.scrollTop -= dy;
      else if (name === 'pan-down') scroller.scrollTop += dy;
      else return false;
      return true;
    }

    async function show(spec) {
      const mine = ++token;
      rows = spec.rows || [];
      const result = PDFStudy.ocrEdits.resultOf(spec.page);
      size = G.readSize(result, spec.page);
      scroller.setAttribute('aria-label', `Page ${spec.page.pageNumber} image`);
      release();
      marksEl.innerHTML = '';
      pageEl.classList.add('hidden');
      stateEl.innerHTML = WAIT;
      strip.clear('');
      const loader = PDFStudy.pdfLoader;
      const next = document.createElement('canvas');
      next.setAttribute('aria-hidden', 'true');
      try {
        if (!spec.pdfDoc || !loader || !loader.renderPageToCanvas) throw new Error('no page image');
        const scale = Math.min(MAX_RENDER_SCALE, RENDER_WIDTH / Math.max(1, spec.page.width || 612));
        await loader.renderPageToCanvas(spec.pdfDoc, spec.page.pageNumber, next, scale);
      } catch (_err) {
        if (mine === token && !dead) stateEl.innerHTML = FAILED;
        return;
      }
      if (mine !== token || dead) {
        next.width = 0;
        next.height = 0;
        return;
      }
      canvas = next;
      if (!(size.w > 0)) size = { w: canvas.width, h: canvas.height };
      stateEl.innerHTML = '';
      pageEl.insertBefore(canvas, marksEl);
      pageEl.classList.remove('hidden');
      drawMarks();
      drawStrip();
      centre();
    }

    function setRows(next) {
      rows = next || [];
      if (!canvas) return;
      drawMarks();
      drawStrip();
    }

    function setCurrent(id) {
      currentId = id;
      markCurrent();
      drawStrip();
      centre();
    }

    function setHover(id) {
      for (const mark of marksEl.children) mark.classList.toggle('is-hover', id != null && mark.getAttribute('data-id') === String(id));
    }

    PDFStudy.hwPageGestures.attach(scroller, {
      zoom: () => zoom,
      setZoom,
      step: (dir) => setZoom(G.zoomStep(zoom, dir)),
      pick: (mark) => { if (o.onPick) o.onPick(mark.getAttribute('data-id')); },
    });
    marksEl.addEventListener('mouseover', (e) => {
      const mark = e.target.closest ? e.target.closest('.hw-mark') : null;
      if (o.onHover) o.onHover(mark ? mark.getAttribute('data-id') : null);
    });
    marksEl.addEventListener('mouseleave', () => { if (o.onHover) o.onHover(null); });
    host.addEventListener('click', (e) => {
      const btn = e.target.closest ? e.target.closest('[data-view-act]') : null;
      if (btn) act(btn.getAttribute('data-view-act'));
    });
    /** Phone only: the strip shows either the line being checked or the whole page (with zoom and pan). */
    function setWhole(whole) {
      wholeBtn.setAttribute('aria-pressed', String(whole));
      wholeBtn.textContent = whole ? 'Show this line' : 'Show whole page';
      host.classList.toggle('is-whole', whole);
      if (whole) centre();
      else drawStrip();
    }
    wholeBtn.addEventListener('click', () => setWhole(wholeBtn.getAttribute('aria-pressed') !== 'true'));
    const onResize = () => {
      padMarks();
      drawStrip();
    };
    root.addEventListener('resize', onResize);

    function dispose() {
      dead = true;
      token += 1;
      root.removeEventListener('resize', onResize);
      release();
      host.innerHTML = '';
    }

    return {
      show, setRows, setCurrent, setHover, setWhole, act, dispose,
      setCount: (text) => { find('#hwStripCount').textContent = text || ''; },
      zoom: () => zoom,
    };
  }

  PDFStudy.hwPageView = { create };
})(typeof window !== 'undefined' ? window : globalThis);

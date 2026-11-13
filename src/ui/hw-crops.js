/**
 * Handwriting crops for the review panel. Pages are rendered one at a time, only when a row that needs them
 * scrolls into view, to an offscreen canvas that is released as soon as its rows are drawn.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PAD = 6; // rendered pixels of margin around each crop
  const BATCH = 40; // rows drawn per page render
  const MAX_SCALE = 3;
  const MAX_W = 640; // widest row canvas in px

  /** Draw one region of the rendered page onto a row canvas (white card, dark ink). */
  function drawCrop(src, canvas, box) {
    const x = Math.max(0, Math.floor(box.x - PAD));
    const y = Math.max(0, Math.floor(box.y - PAD));
    const w = Math.max(1, Math.min(src.width - x, Math.ceil(box.w + 2 * PAD)));
    const h = Math.max(1, Math.min(src.height - y, Math.ceil(box.h + 2 * PAD)));
    const k = Math.min(1, MAX_W / w); // downscale wide crops, keep aspect
    const dw = Math.max(1, Math.round(w * k));
    const dh = Math.max(1, Math.round(h * k));
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(src, x, y, w, h, 0, 0, dw, dh);
    canvas.setAttribute('data-ready', 'true');
  }

  /**
   * cropper = createCropper(pdfDoc); cropper.watch(canvas, { pageNumber, box, scale });
   * cropper.dispose() stops all pending work (called when the panel closes).
   */
  function createCropper(pdfDoc) {
    const pending = new Map(); // pageNumber -> [{ canvas, box, scale }]
    let running = false;
    let dead = false;
    let observer = null;
    const jobs = new WeakMap();

    let cached = null; // { n, canvas }: the last rendered page, kept for consecutive batches
    function release() {
      if (cached) { cached.canvas.width = 0; cached.canvas.height = 0; }
      cached = null;
    }

    async function drawBatch(pageNumber, batch) {
      try {
        const scale = Math.min(MAX_SCALE, batch[0].scale || 1);
        if (!cached || cached.n !== pageNumber) {
          release();
          const big = document.createElement('canvas');
          cached = { n: pageNumber, canvas: big };
          await PDFStudy.pdfLoader.renderPageToCanvas(pdfDoc, pageNumber, big, scale);
        }
        if (dead) return;
        const ratio = batch[0].scale ? scale / batch[0].scale : 1; // 1 unless the recognition scale exceeded the cap
        for (const j of batch) {
          const b = j.box;
          drawCrop(cached.canvas, j.canvas, { x: b.x * ratio, y: b.y * ratio, w: b.w * ratio, h: b.h * ratio });
        }
      } catch (_err) {
        release();
        for (const j of batch) j.canvas.setAttribute('data-failed', 'true');
      } finally {
        if (dead) release();
      }
    }

    function nextPage() {
      if (cached && pending.has(cached.n)) return [cached.n, pending.get(cached.n)];
      return pending.entries().next().value;
    }

    async function pump() {
      if (running) return;
      running = true;
      try {
        while (!dead && pending.size) {
          const [n, list] = nextPage();
          const batch = list.splice(0, BATCH);
          if (!list.length) pending.delete(n);
          await drawBatch(n, batch);
        }
      } finally {
        running = false;
      }
    }

    function request(job) {
      if (dead || job.canvas.hasAttribute('data-ready')) return;
      if (!pdfDoc || !PDFStudy.pdfLoader || !PDFStudy.pdfLoader.renderPageToCanvas) {
        job.canvas.setAttribute('data-failed', 'true');
        return;
      }
      const list = pending.get(job.pageNumber) || [];
      if (!list.includes(job)) list.push(job);
      pending.set(job.pageNumber, list);
      pump();
    }

    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          observer.unobserve(e.target);
          const job = jobs.get(e.target);
          if (job) request(job);
        }
      }, { rootMargin: '200px' });
    }

    function watch(canvas, spec) {
      const job = { canvas, pageNumber: spec.pageNumber, box: spec.box, scale: spec.scale };
      jobs.set(canvas, job);
      if (observer) observer.observe(canvas);
      else request(job);
    }

    function dispose() {
      dead = true;
      pending.clear();
      if (!running) release();
      if (observer) observer.disconnect();
    }

    return { watch, dispose };
  }

  PDFStudy.hwCrops = { createCropper, drawCrop, PAD, BATCH };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCrops;
})(typeof window !== 'undefined' ? window : globalThis);

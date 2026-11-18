/**
 * The line strip of the "Check what was read" screen: on a phone the page image has no room beside the
 * lines, so the line being checked is shown on its own, cut out of the rendered page with a little of
 * what is above and below it. The page itself is rendered by hw-page-view.js; this only crops from it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MAX_W = 1200; // widest strip canvas in px (a phone at 3x is narrower than this)

  /** Draw rectangle `rect` of the rendered page onto `canvas` (white paper, never upscaled past the source). */
  function drawCrop(src, canvas, rect) {
    const k = Math.min(1, MAX_W / rect.w);
    const dw = Math.max(1, Math.round(rect.w * k));
    const dh = Math.max(1, Math.round(rect.h * k));
    canvas.width = dw;
    canvas.height = dh;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, dw, dh);
  }

  /**
   * strip = createStrip(host)
   *   strip.show(source, box)   source: the rendered page canvas; box: the line's box in that canvas's pixels
   *   strip.clear(note)         nothing to show (no page image, or a line with no place on the page)
   */
  function createStrip(host) {
    host.innerHTML = '<canvas class="hw-strip-canvas" aria-hidden="true"></canvas><p class="hw-strip-note"></p>';
    const canvas = host.querySelector('canvas');
    const note = host.querySelector('.hw-strip-note');

    function clear(text) {
      canvas.classList.add('hidden');
      note.textContent = text || '';
    }

    function show(source, box) {
      const w = host.clientWidth;
      const h = host.clientHeight;
      const G = PDFStudy.hwPageGeometry;
      const rect = source && box && w > 0 && h > 0 ? G.stripRect(box, { w: source.width, h: source.height }, w / h) : null;
      if (!rect || rect.w < 1 || rect.h < 1) {
        clear(source && !box ? 'This line has no place on the page.' : '');
        return;
      }
      note.textContent = '';
      canvas.classList.remove('hidden');
      drawCrop(source, canvas, rect);
    }

    return { show, clear };
  }

  PDFStudy.hwCrops = { createStrip, drawCrop, MAX_W };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCrops;
})(typeof window !== 'undefined' ? window : globalThis);

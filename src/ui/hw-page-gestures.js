/**
 * Pointer gestures on the page image of the "Check what was read" screen: drag to pan, two fingers or
 * Ctrl + wheel to zoom, and a click that was not a drag picks the mark under it. The zoom buttons and
 * keys (hw-page-view.js, hw-check-keys.js) do the same without a pointer.
 *   hwPageGestures.attach(scroller, { zoom(), setZoom(z), step(dir), pick(markElement) })
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const DRAG_START = 4; // px a pointer must move before it pans instead of clicking

  function attach(scroller, on) {
    const G = PDFStudy.hwPageGeometry;
    const pointers = new Map();
    let drag = null;
    let pinch = null;
    let moved = false;

    const spread = () => {
      const [a, b] = Array.from(pointers.values());
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    scroller.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      drag = pointers.size === 1 ? { x: e.clientX, y: e.clientY, left: scroller.scrollLeft, top: scroller.scrollTop } : null;
      pinch = pointers.size === 2 ? { zoom: on.zoom(), distance: spread() } : null;
    });

    scroller.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        moved = true;
        on.setZoom(G.pinchZoom(pinch.zoom, pinch.distance, spread()));
        return;
      }
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!moved && Math.hypot(dx, dy) < DRAG_START) return;
      moved = true;
      scroller.scrollLeft = drag.left - dx;
      scroller.scrollTop = drag.top - dy;
    });

    const lift = (e) => {
      pointers.delete(e.pointerId);
      drag = null;
      pinch = null;
    };
    scroller.addEventListener('pointerup', lift);
    scroller.addEventListener('pointercancel', lift);
    scroller.addEventListener('pointerleave', lift);

    scroller.addEventListener('click', (e) => {
      const mark = e.target.closest ? e.target.closest('.hw-mark') : null;
      if (mark && !moved) on.pick(mark);
    });

    scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      on.step(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  PDFStudy.hwPageGestures = { attach, DRAG_START };
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Geometry of the page image on the "Check what was read" screen (no DOM): where a line's box sits on the
 * shown page, zoom steps, the part of the page the phone strip shows, and where to scroll to bring a line
 * into the middle. Boxes are in the pixels of the page as it was read (result.width x result.height).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const ZOOM_MIN = 0.7;
  const ZOOM_MAX = 2.4;
  const ZOOM_STEP = 0.2;
  const PAN_SHARE = 0.1; // one arrow key moves the page by a tenth of what is visible
  const STRIP_CONTEXT = 0.25; // share of the line's height shown above and below it in the strip
  const STRIP_SIDE = 12; // read pixels kept left and right of the line
  const MIN_HIT = 24; // CSS pixels: smallest area of a box that takes a click

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = (v) => Math.round(v * 1000) / 1000;

  /** Size of the page as it was read: the result's own, else the page's points times the read scale. */
  function readSize(result, page) {
    const scale = result && result.scale > 0 ? result.scale : 1;
    return {
      w: (result && result.width) || ((page && page.width) || 0) * scale,
      h: (result && result.height) || ((page && page.height) || 0) * scale,
    };
  }

  /** A box as percentages of the page, so it stays in place at every zoom: { left, top, width, height } or null. */
  function boxPercent(box, size) {
    if (!box || !(size.w > 0) || !(size.h > 0)) return null;
    const left = clamp(box.x / size.w, 0, 1);
    const top = clamp(box.y / size.h, 0, 1);
    return {
      left: round(left * 100),
      top: round(top * 100),
      width: round(clamp(box.w / size.w, 0, 1 - left) * 100),
      height: round(clamp(box.h / size.h, 0, 1 - top) * 100),
    };
  }

  /** Extra space (CSS px per side) that brings a box shown at w x h up to the smallest size that takes a click. */
  function hitPad(w, h) {
    return { x: Math.max(0, (MIN_HIT - w) / 2), y: Math.max(0, (MIN_HIT - h) / 2) };
  }

  const clampZoom = (zoom) => clamp(Math.round(zoom * 100) / 100, ZOOM_MIN, ZOOM_MAX);
  const zoomStep = (zoom, dir) => clampZoom(zoom + dir * ZOOM_STEP);
  /** Two fingers moving apart or together: the zoom the pinch started at, times how far they have moved. */
  const pinchZoom = (startZoom, startDistance, distance) => (startDistance > 0 ? clampZoom(startZoom * (distance / startDistance)) : clampZoom(startZoom));
  const zoomLabel = (zoom) => `${Math.round(zoom * 100)}%`;
  const panStep = (visible) => Math.max(1, Math.round(visible * PAN_SHARE));

  /**
   * The rectangle of the rendered page (source w x h pixels) the strip shows for a line: the line with a
   * little context, widened or heightened to the strip's shape (aspect = width / height) and kept on the page.
   * `box` is in source pixels.
   */
  function stripRect(box, source, aspect) {
    if (!box || !(source.w > 0) || !(source.h > 0) || !(aspect > 0)) return null;
    let w = Math.min(source.w, box.w + 2 * STRIP_SIDE);
    let h = Math.min(source.h, box.h * (1 + 2 * STRIP_CONTEXT));
    if (w / h < aspect) w = Math.min(source.w, h * aspect);
    else h = Math.min(source.h, w / aspect);
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return {
      x: Math.round(clamp(cx - w / 2, 0, source.w - w)),
      y: Math.round(clamp(cy - h / 2, 0, source.h - h)),
      w: Math.round(w),
      h: Math.round(h),
    };
  }

  /** Scale a box from the read page to another rendering of the same page (w pixels wide). */
  function scaleBox(box, size, width) {
    if (!box || !(size.w > 0)) return null;
    const k = width / size.w;
    return { x: box.x * k, y: box.y * k, w: box.w * k, h: box.h * k };
  }

  /**
   * Scroll offsets that put a mark in the middle of the scrolling pane.
   * mark: { left, top, width, height } inside the content; view: { width, height } visible; content: { width, height }.
   */
  function centreScroll(mark, view, content) {
    return {
      left: Math.round(clamp(mark.left + mark.width / 2 - view.width / 2, 0, Math.max(0, content.width - view.width))),
      top: Math.round(clamp(mark.top + mark.height / 2 - view.height / 2, 0, Math.max(0, content.height - view.height))),
    };
  }

  PDFStudy.hwPageGeometry = {
    ZOOM_MIN, ZOOM_MAX, ZOOM_STEP, MIN_HIT,
    readSize, boxPercent, hitPad, clampZoom, zoomStep, pinchZoom, zoomLabel, panStep, stripRect, scaleBox, centreScroll,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPageGeometry;
})(typeof window !== 'undefined' ? window : globalThis);

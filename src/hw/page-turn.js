/**
 * Turns a page bitmap upright for reading and maps what was found back onto the page as it was given. DOM-free.
 *   frame(w, h, deg)          -> the upright frame of a w x h page whose text lines slope by `deg` (skew-angle.js)
 *   rotate(img, frame)        -> the page resampled into that frame ({ data, w, h, ch })
 *   frame.toSource(x, y)      -> a point of the upright frame in page pixels
 *   frame.toFrame(x, y)       -> a page point in the upright frame
 *   frame.boxToSource(box)    -> the upright box { x, y, w, h } as the page rectangle that holds all of it
 * The upright frame is large enough for the whole turned page, so nothing is cut off.
 * Any angle works: a few degrees for a crooked photo, 90 / 180 / 270 for a page lying on its side or upside down.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** Below this many degrees a page is read as it is: turning costs sharpness and gains nothing. */
  const MIN_TURN = 0.3;

  /** Degrees folded into (-180, 180]. */
  function fold(deg) {
    const d = ((((Number(deg) || 0) + 180) % 360) + 360) % 360 - 180;
    return d === -180 ? 180 : d;
  }

  const needsTurn = (deg) => Math.abs(fold(deg)) >= MIN_TURN;

  /**
   * @param {number} w page width in pixels
   * @param {number} h page height in pixels
   * @param {number} deg slope of the text lines on the page (positive: a line drops towards the right)
   * @returns {{w:number, h:number, deg:number, srcW:number, srcH:number, toSource:function, toFrame:function, boxToSource:function}}
   */
  function frame(w, h, deg) {
    const angle = fold(deg);
    const rad = (angle * Math.PI) / 180;
    // exact values at the quarter turns, so those are pure pixel moves with no blur
    const quarter = Math.abs(angle) % 90 === 0;
    const cos = quarter ? Math.round(Math.cos(rad)) : Math.cos(rad);
    const sin = quarter ? Math.round(Math.sin(rad)) : Math.sin(rad);
    const fw = Math.max(1, Math.ceil(w * Math.abs(cos) + h * Math.abs(sin) - 1e-6));
    const fh = Math.max(1, Math.ceil(w * Math.abs(sin) + h * Math.abs(cos) - 1e-6));
    const cx = w / 2;
    const cy = h / 2;
    const fx = fw / 2;
    const fy = fh / 2;
    const toSource = (x, y) => {
      const dx = x - fx;
      const dy = y - fy;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    };
    const toFrame = (x, y) => {
      const dx = x - cx;
      const dy = y - cy;
      return { x: fx + dx * cos + dy * sin, y: fy - dx * sin + dy * cos };
    };
    /** The page rectangle (whole pixels, inside the page) that holds every corner of an upright box. */
    const boxToSource = (box) => {
      const corners = [toSource(box.x, box.y), toSource(box.x + box.w, box.y), toSource(box.x, box.y + box.h), toSource(box.x + box.w, box.y + box.h)];
      const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x)) + 1e-6));
      const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y)) + 1e-6));
      const x1 = Math.min(w, Math.ceil(Math.max(...corners.map((c) => c.x)) - 1e-6));
      const y1 = Math.min(h, Math.ceil(Math.max(...corners.map((c) => c.y)) - 1e-6));
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    };
    return { w: fw, h: fh, deg: angle, srcW: w, srcH: h, cos, sin, toSource, toFrame, boxToSource };
  }

  /**
   * Resample a byte image ({ data, w, h, ch }, `ch` interleaved channels) into its upright frame, bilinear.
   * The corners the turn adds repeat the nearest edge pixel: white paper stays white to the corner, and a dark
   * desk around a photographed sheet stays one dark border that the page clean-up can still remove whole.
   * The result has the same array type as the input.
   */
  function rotate(img, fr) {
    const { data, w, h } = img;
    const ch = img.ch || 1;
    const out = new (data.constructor)(fr.w * fr.h * ch);
    const { cos, sin } = fr;
    const lastX = w - 1;
    const lastY = h - 1;
    for (let y = 0; y < fr.h; y++) {
      // source position of the centre of the first pixel of this row; one step right adds (cos, sin)
      const start = fr.toSource(0.5, y + 0.5);
      let sx = start.x - 0.5;
      let sy = start.y - 0.5;
      let o = y * fr.w * ch;
      for (let x = 0; x < fr.w; x++, sx += cos, sy += sin, o += ch) {
        const px = sx < 0 ? 0 : sx > lastX ? lastX : sx;
        const py = sy < 0 ? 0 : sy > lastY ? lastY : sy;
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const x1 = x0 < lastX ? x0 + 1 : x0;
        const y1 = y0 < lastY ? y0 + 1 : y0;
        const tx = px - x0;
        const ty = py - y0;
        const a = (y0 * w + x0) * ch;
        const b = (y0 * w + x1) * ch;
        const c = (y1 * w + x0) * ch;
        const d = (y1 * w + x1) * ch;
        for (let k = 0; k < ch; k++) {
          const top = data[a + k] * (1 - tx) + data[b + k] * tx;
          const bot = data[c + k] * (1 - tx) + data[d + k] * tx;
          out[o + k] = top * (1 - ty) + bot * ty + 0.5;
        }
      }
    }
    return { data: out, w: fr.w, h: fr.h, ch };
  }

  PDFStudy.hwPageTurn = { frame, rotate, fold, needsTurn, MIN_TURN };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPageTurn;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

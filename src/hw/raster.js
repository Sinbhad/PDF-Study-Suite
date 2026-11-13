/**
 * Raster helpers for the handwriting pipeline: grayscale, Otsu threshold, binarise, crop.
 * DOM-free; works on plain typed arrays so Node and workers can use it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** RGBA (Uint8ClampedArray/Uint8Array) to 8-bit gray (Rec. 601 luma, integer maths). */
  function toGray(rgba, w, h) {
    const n = w * h;
    const out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      out[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
    }
    return out;
  }

  /**
   * RGBA to 8-bit gray for pen colours on white: the darkest channel, so pale purple, orange or pink ink keeps
   * its contrast (luma turns them almost white). Pale yellow highlighter (R and G above 210, B below) becomes paper.
   */
  function inkGray(rgba, w, h) {
    const n = w * h;
    const out = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const r = rgba[j];
      const g = rgba[j + 1];
      const b = rgba[j + 2];
      out[i] = r > 210 && g > 210 && b < 210 ? 255 : Math.min(r, g, b);
    }
    return out;
  }

  /** Otsu threshold: pixels <= result are "dark". Flat images return 127. */
  function otsu(gray) {
    const hist = new Float64Array(256);
    for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
    const total = gray.length;
    let sumAll = 0;
    for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    let wB = 0;
    let sumB = 0;
    let best = -1;
    let thr = 127;
    for (let t = 0; t < 256; t++) {
      wB += hist[t];
      if (wB === 0) continue;
      const wF = total - wB;
      if (wF === 0) break;
      sumB += t * hist[t];
      const mB = sumB / wB;
      const mF = (sumAll - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) {
        best = between;
        thr = t;
      }
    }
    return thr;
  }

  /**
   * Binarise so ink = 1. Ink is normally the minority class; when more than half of the pixels
   * are dark the paper is dark, so the result is inverted (`inverted: true`).
   */
  function binarise(gray, w, h) {
    const thr = otsu(gray);
    const n = w * h;
    const data = new Uint8Array(n);
    let dark = 0;
    for (let i = 0; i < n; i++) {
      if (gray[i] <= thr) {
        data[i] = 1;
        dark++;
      }
    }
    const inverted = dark > n / 2;
    if (inverted) for (let i = 0; i < n; i++) data[i] ^= 1;
    return { data, w, h, inverted };
  }

  /** Crop `box` (+ `pad` px each side, clamped to the bitmap) out of a gray bitmap. */
  function crop(gray, w, h, box, pad) {
    const p = pad || 0;
    const x0 = Math.max(0, Math.floor(box.x - p));
    const y0 = Math.max(0, Math.floor(box.y - p));
    const x1 = Math.min(w, Math.ceil(box.x + box.w + p));
    const y1 = Math.min(h, Math.ceil(box.y + box.h + p));
    const cw = Math.max(0, x1 - x0);
    const ch = Math.max(0, y1 - y0);
    const data = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      const s = (y0 + y) * w + x0;
      data.set(gray.subarray(s, s + cw), y * cw);
    }
    return { data, w: cw, h: ch };
  }

  PDFStudy.hwRaster = { toGray, inkGray, otsu, binarise, crop };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwRaster;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

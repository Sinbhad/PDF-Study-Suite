/**
 * Image preparation for the PP-OCRv5 engine (pure, DOM-free; Node-testable). Images are plain objects
 * { data, w, h, ch } with `ch` interleaved channels (1 gray, 3 RGB, 4 RGBA), values 0..255.
 * Detection input: BGR, /255, ImageNet mean/std, padded with white to a multiple of 32.
 * Recognition input: height 48 keeping the aspect, BGR, (x/255 - 0.5) / 0.5, right-padded with zeros to >= 320.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const DET_MEAN = [0.485, 0.456, 0.406];
  const DET_STD = [0.229, 0.224, 0.225];
  const REC_H = 48;
  const REC_MIN_W = 320;
  /** A line wider than this many times its height is squeezed (keeps a runaway box from building a huge tensor). */
  const REC_MAX_ASPECT = 80;

  /** Pale yellow highlighter: red and green high, blue clearly lower. */
  const isHighlight = (r, g, b) => r > 210 && g > 210 && b < 210;

  /** Copy of an RGBA buffer composited on white, with highlighter turned into paper. Returns a 4-channel image. */
  function neutralise(rgba, w, h) {
    const n = w * h;
    const out = new Uint8ClampedArray(n * 4);
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const a = rgba[j + 3] === undefined ? 255 : rgba[j + 3];
      const k = a / 255;
      const r = 255 - (255 - rgba[j]) * k;
      const g = 255 - (255 - rgba[j + 1]) * k;
      const b = 255 - (255 - rgba[j + 2]) * k;
      const hl = isHighlight(r, g, b);
      out[j] = hl ? 255 : r;
      out[j + 1] = hl ? 255 : g;
      out[j + 2] = hl ? 255 : b;
      out[j + 3] = 255;
    }
    return { data: out, w, h, ch: 4 };
  }

  /** Taps for one axis: area averaging when shrinking, bilinear (half-pixel centres) when enlarging. */
  function taps(src, dst) {
    const list = [];
    if (dst < src) {
      const s = src / dst;
      for (let i = 0; i < dst; i++) {
        const a = i * s;
        const b = a + s;
        const t = [];
        for (let j = Math.floor(a); j < Math.min(src, Math.ceil(b)); j++) {
          const c = Math.min(b, j + 1) - Math.max(a, j);
          if (c > 0) t.push(j, c / s);
        }
        list.push(t);
      }
      return list;
    }
    for (let i = 0; i < dst; i++) {
      const x = Math.max(0, Math.min(src - 1, ((i + 0.5) * src) / dst - 0.5));
      const j = Math.floor(x);
      const f = x - j;
      list.push(f > 0 && j + 1 < src ? [j, 1 - f, j + 1, f] : [j, 1]);
    }
    return list;
  }

  /** Resize an image to nw x nh (separable; Float32 output with the same channel count). */
  function resize(img, nw, nh) {
    const { data, w, h, ch } = img;
    nw = Math.max(1, Math.round(nw));
    nh = Math.max(1, Math.round(nh));
    const tx = taps(w, nw);
    const ty = taps(h, nh);
    const mid = new Float32Array(nw * h * ch);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < nw; x++) {
        const t = tx[x];
        for (let c = 0; c < ch; c++) {
          let acc = 0;
          for (let k = 0; k < t.length; k += 2) acc += t[k + 1] * data[(y * w + t[k]) * ch + c];
          mid[(y * nw + x) * ch + c] = acc;
        }
      }
    }
    const out = new Float32Array(nw * nh * ch);
    for (let y = 0; y < nh; y++) {
      const t = ty[y];
      for (let x = 0; x < nw * ch; x++) {
        let acc = 0;
        for (let k = 0; k < t.length; k += 2) acc += t[k + 1] * mid[t[k] * nw * ch + x];
        out[y * nw * ch + x] = acc;
      }
    }
    return { data: out, w: nw, h: nh, ch };
  }

  /** Sub-image inside box {x0,y0,x1,y1} (clamped, whole pixels). */
  function cropImage(img, box) {
    const x0 = Math.max(0, Math.floor(box.x0));
    const y0 = Math.max(0, Math.floor(box.y0));
    const x1 = Math.min(img.w, Math.ceil(box.x1));
    const y1 = Math.min(img.h, Math.ceil(box.y1));
    const w = Math.max(0, x1 - x0);
    const h = Math.max(0, y1 - y0);
    const ch = img.ch;
    const out = new (img.data.constructor)(w * h * ch);
    for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * img.w + x0) * ch, ((y0 + y) * img.w + x1) * ch), y * w * ch);
    return { data: out, w, h, ch };
  }

  /** Channel value in BGR order (0 = blue) for pixel i. */
  const bgr = (data, i, ch, c) => (ch >= 3 ? data[i * ch + 2 - c] : data[i * ch]);

  /** Detection tensor: { data: Float32Array [3,H,W], W, H } with H and W multiples of 32, padded white. */
  function detTensor(img) {
    const { data, w, h, ch } = img;
    const W = Math.max(32, Math.ceil(w / 32) * 32);
    const H = Math.max(32, Math.ceil(h / 32) * 32);
    const plane = W * H;
    const out = new Float32Array(3 * plane);
    for (let c = 0; c < 3; c++) {
      const white = (1 - DET_MEAN[c]) / DET_STD[c];
      const o = out.subarray(c * plane, (c + 1) * plane).fill(white);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) o[y * W + x] = (bgr(data, y * w + x, ch, c) / 255 - DET_MEAN[c]) / DET_STD[c];
      }
    }
    return { data: out, W, H };
  }

  /** Recognition tensor of a line image: { data: Float32Array [3,48,W], W, used } (`used` = columns with content). */
  function recTensor(img) {
    if (!img || img.w < 2 || img.h < 2) return null;
    const used = Math.max(8, Math.min(REC_H * REC_MAX_ASPECT, Math.ceil((REC_H * img.w) / img.h)));
    const r = resize(img, used, REC_H);
    const W = Math.max(REC_MIN_W, used);
    const plane = W * REC_H;
    const out = new Float32Array(3 * plane); // zero = mid gray, the padding the model was trained with
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < REC_H; y++) {
        for (let x = 0; x < used; x++) out[c * plane + y * W + x] = bgr(r.data, y * used + x, r.ch, c) / 127.5 - 1;
      }
    }
    return { data: out, W, used };
  }

  /** A page-prep gray crop {data,w,h} as a 1-channel image. */
  const fromGray = (crop) => ({ data: crop.data, w: crop.w | 0, h: crop.h | 0, ch: 1 });

  PDFStudy.hwPpocrPrep = { REC_H, REC_MIN_W, neutralise, resize, cropImage, detTensor, recTensor, fromGray, isHighlight };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPpocrPrep;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

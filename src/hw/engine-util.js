/** Pure, DOM-free helpers for the model engine (Node-testable). */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** The model's input size: every crop is stretched to this square, as in the original TrOCR preprocessing. */
  const MODEL_SIDE = 384;
  /** White margin added on every side, as a share of the crop height (the worker's crop already has some). */
  const MARGIN_FRAC = 0.04;
  /** lineConfidence = mean^MEAN_POWER * min^MIN_WEIGHT (geometric-mean and weakest token probability). */
  const MEAN_POWER = 2;
  const MIN_WEIGHT = 0.1;
  /** lineConfidence: ceiling for text that looks like a decoding loop or junk. */
  const LOOP_CAP = 0.1;

  /**
   * Per-output-pixel taps for resampling one axis from `src` to `dst` samples: area averaging when shrinking,
   * Catmull-Rom bicubic when enlarging (a plain copy when equal). Returns { start, count, weights } with
   * `count` taps per output pixel starting at `start[i]` (indices already clamped into the source).
   */
  function axisTaps(src, dst) {
    if (dst < src) {
      const scale = src / dst;
      const count = Math.ceil(scale) + 1;
      const start = new Int32Array(dst);
      const weights = new Float32Array(dst * count);
      for (let i = 0; i < dst; i++) {
        const a = i * scale;
        const b = a + scale;
        const s = Math.floor(a);
        start[i] = s;
        for (let k = 0; k < count; k++) {
          const j = s + k;
          const cover = Math.min(b, j + 1) - Math.max(a, j);
          weights[i * count + k] = j < src && cover > 0 ? cover / scale : 0;
        }
      }
      return { start, count, weights, clampTo: src - 1 };
    }
    const count = 4;
    const start = new Int32Array(dst);
    const weights = new Float32Array(dst * count);
    const cubic = (x) => {
      const t = Math.abs(x);
      if (t <= 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
      if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
      return 0;
    };
    for (let i = 0; i < dst; i++) {
      const x = ((i + 0.5) * src) / dst - 0.5;
      const s = Math.floor(x) - 1;
      start[i] = s;
      let sum = 0;
      for (let k = 0; k < count; k++) sum += (weights[i * count + k] = cubic(x - (s + k))); // equal sizes: weights 0,1,0,0
      for (let k = 0; k < count; k++) weights[i * count + k] /= sum;
    }
    return { start, count, weights, clampTo: src - 1 };
  }

  /** Resample `n` lines of `len` samples (stride `step` within a line, `lineStep` between lines). */
  function resampleAxis(input, out, taps, n, step, lineStep, outStep, outLineStep) {
    const { start, count, weights, clampTo } = taps;
    const dst = start.length;
    for (let l = 0; l < n; l++) {
      const base = l * lineStep;
      const obase = l * outLineStep;
      for (let i = 0; i < dst; i++) {
        let acc = 0;
        for (let k = 0; k < count; k++) {
          const wgt = weights[i * count + k];
          if (wgt === 0) continue;
          const j = Math.min(clampTo, Math.max(0, start[i] + k));
          acc += wgt * input[base + j * step];
        }
        out[obase + i * outStep] = acc;
      }
    }
  }

  /**
   * Gray crop (dark ink on white) -> the model's 384x384 gray input: a thin white margin, then a straight stretch
   * (no aspect padding: padding a line to a 4:1 box measured far worse). Deterministic plain JS, the same in Node and
   * in the browser. Returns null for an unusable crop (no data, or narrower or shorter than 2 pixels).
   * @param {{data:Uint8Array|Uint8ClampedArray,w:number,h:number}} crop
   * @param {{side?:number, marginFrac?:number}} [opts]
   * @returns {{data:Uint8Array,w:number,h:number}|null}
   */
  function prepareCrop(crop, opts) {
    const o = opts || {};
    const side = o.side > 0 ? o.side | 0 : MODEL_SIDE;
    const w = crop && crop.w | 0;
    const h = crop && crop.h | 0;
    const data = crop && crop.data;
    if (!data || w < 2 || h < 2 || data.length < w * h) return null;
    const m = o.marginFrac != null ? Math.max(0, Math.round(h * o.marginFrac)) : Math.max(1, Math.round(h * MARGIN_FRAC));
    const pw = w + 2 * m;
    const ph = h + 2 * m;
    const padded = new Float32Array(pw * ph).fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[(y + m) * pw + x + m] = data[y * w + x];
    const rows = new Float32Array(ph * side); // horizontal pass: ph rows of `side` samples
    resampleAxis(padded, rows, axisTaps(pw, side), ph, 1, pw, 1, side);
    const outF = new Float32Array(side * side); // vertical pass, one column at a time
    resampleAxis(rows, outF, axisTaps(ph, side), side, side, 1, side, 1);
    const out = new Uint8Array(side * side);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(0, Math.min(255, Math.round(outF[i])));
    return { data: out, w: side, h: side };
  }

  /** Replicate one gray channel into 3 channels (RGB). */
  function grayToRgb(gray, w, h) {
    const n = w * h;
    const rgb = new Uint8ClampedArray(n * 3);
    for (let i = 0; i < n; i++) {
      const v = gray[i];
      rgb[i * 3] = v;
      rgb[i * 3 + 1] = v;
      rgb[i * 3 + 2] = v;
    }
    return rgb;
  }

  /** Geometric mean of probabilities, clamped to [0,1]; 0 for an empty list or any non-positive entry. */
  function geoMean(values) {
    if (!values || !values.length) return 0;
    let sum = 0;
    for (const v of values) {
      if (!(v > 0)) return 0;
      sum += Math.log(Math.min(1, v));
    }
    return Math.max(0, Math.min(1, Math.exp(sum / values.length)));
  }

  /** Text-only confidence guess (used when no token probabilities exist): 0 junk-empty, 0.35 suspicious, else 0.7. */
  function heuristicConfidence(text) {
    const t = String(text == null ? '' : text).trim();
    if (t.length < 2) return 0;
    if (/(.)\1{5,}/.test(t)) return 0.35;
    const alnum = (t.match(/[A-Za-z0-9]/g) || []).length;
    if (alnum / t.length < 0.5) return 0.35;
    if (t.split(/\s+/).some((tok) => tok.length >= 8 && !/[aeiouyAEIOUY]/.test(tok))) return 0.35;
    return 0.7;
  }

  /**
   * True for the decoder's known junk on noise crops ("0 0 0 0", "# # # #", "a b c d e f", "the the the the",
   * "of the of the of the", "aaaaaaa", "abababab"). Real repeats ("had had", "that that nation", "1 2 3" in a
   * sentence, a phrase repeated across a long line) pass.
   */
  function looksLooped(text) {
    const t = String(text == null ? '' : text).trim();
    if (!t) return false;
    if (/(\S)\1{6,}/.test(t) || /(\S{2,4})\1{3,}/.test(t)) return true; // 7+ same character, 4+ repeats of a short unit
    const toks = t.toLowerCase().split(/\s+/);
    const word = (s) => s.replace(/^[^\w#]+|[^\w#]+$/g, '') || s;
    let single = [];
    let same = 1;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].length === 1) {
        single.push(toks[i]);
        if (single.length >= 6 || (single.length >= 4 && new Set(single).size <= 2)) return true;
      } else single = [];
      same = i && word(toks[i]) === word(toks[i - 1]) ? same + 1 : 1;
      if (same >= 4) return true;
      if (i >= 5 && toks[i] === toks[i - 2] && toks[i - 1] === toks[i - 3] && toks[i] === toks[i - 4] && toks[i - 1] === toks[i - 5]) return true;
    }
    if (toks.length >= 6) {
      const counts = new Map();
      for (const k of toks) counts.set(word(k), (counts.get(word(k)) || 0) + 1);
      if (Math.max(...counts.values()) * 5 >= toks.length * 3) return true; // one token is 60% of the line
    }
    return false;
  }

  /**
   * Confidence of one recognised line from the per-token probabilities: mean^MEAN_POWER * min^MIN_WEIGHT.
   * Fitted on 263 real handwritten lines with known text: the geometric mean separates right from wrong far
   * better than the weakest token, so the weakest token only nudges the score. At the app's 0.6 threshold the
   * lines that pass had about 12% character errors and the lines held back about 45%; tidy synthetic pages all
   * pass. Looping/junk text is capped at LOOP_CAP. Without probabilities the text heuristic decides.
   * @returns {{confidence:number, min:number, mean:number, tokens:number, looped:boolean}}
   */
  function lineConfidence(probs, text) {
    const t = String(text == null ? '' : text).trim();
    const p = (probs || []).filter((v) => typeof v === 'number' && isFinite(v));
    const mean = geoMean(p);
    const min = p.length ? Math.max(0, Math.min(1, Math.min(...p))) : 0;
    const looped = looksLooped(t);
    let confidence;
    if (!t) confidence = 0;
    else if (!p.length) confidence = heuristicConfidence(t);
    else {
      confidence = Math.pow(mean, MEAN_POWER) * Math.pow(min, MIN_WEIGHT);
      const h = t.length >= 2 ? heuristicConfidence(t) : 0.7;
      if (h < 0.5) confidence = Math.min(confidence, h);
    }
    if (looped) confidence = Math.min(confidence, LOOP_CAP);
    return { confidence, min, mean, tokens: p.length, looped };
  }

  /**
   * True when recognised text reads as ordinary words: at least three words of two or more letters, words making
   * up 70% of the pieces, and no equals sign. Underlines and t-bars make the layout check call plain handwriting
   * "math" quite often; such a line is only treated as math when its text does not read as prose.
   * A short line (one to three pieces: a heading, "do this.", "A thin membrane") is prose when every piece is a
   * word of three letters or more (not a function name) or an everyday short word: "x", "dx", "2c", "sin x" fail.
   */
  const SHORT_WORDS = /^(?:a|i|am|an|as|at|be|by|do|go|he|if|in|is|it|me|my|no|of|on|or|so|to|up|us|we)$/i;
  const MATH_WORDS = /^(?:sin|cos|tan|cot|sec|csc|log|lim|exp|max|min|det|mod)$/i;
  function proseLike(text) {
    const toks = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
    if (!toks.length || /=/.test(text)) return false;
    const word = /^[("']*[A-Za-z]+(?:['-][A-Za-z]+)*[)"',.;:!?-]*$/;
    const words = toks.filter((t) => word.test(t));
    const letters = (t) => t.replace(/[^A-Za-z]/g, '');
    if (toks.length <= 3) {
      const plain = (t) => (letters(t).length >= 3 && !MATH_WORDS.test(letters(t))) || SHORT_WORDS.test(letters(t));
      return words.length === toks.length && toks.every(plain) && toks.some((t) => letters(t).length >= 3);
    }
    const long = words.filter((t) => letters(t).length >= 2);
    return long.length >= 3 && words.length >= 0.7 * toks.length;
  }

  PDFStudy.hwEngineUtil = {
    MODEL_SIDE, MARGIN_FRAC, MEAN_POWER, MIN_WEIGHT, LOOP_CAP,
    prepareCrop, grayToRgb, geoMean, heuristicConfidence, looksLooped, lineConfidence, proseLike,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwEngineUtil;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

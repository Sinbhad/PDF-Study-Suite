/**
 * Greedy CTC decoding and line confidence for the PP-OCRv5 recogniser (pure; Node-testable).
 * The model's output is already softmax: [T steps x C classes], class 0 is the CTC blank.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  /** Ceiling for a read of one or two characters: too little to trust without a look. */
  const SHORT_CAP = 0.5;
  /**
   * Lines read from an enlarged tile of a canvas page score `confidence ^ TILE_POWER`. Small neat tablet print is
   * read at a steady, moderate certainty: on 24 hand-checked lines of such a page the lines under the 0.6 cut
   * had 14% character errors against 11% for the lines above it, so the plain score held back nearly half of a
   * page for no gain. With this the cut falls where the reads really get worse (mean probability near 0.75).
   */
  const TILE_POWER = 0.75;

  const util = () => PDFStudy.hwEngineUtil || require('./engine-util.js');

  /**
   * Greedy decode: best class per step, repeats collapsed, blanks dropped. Each kept character carries the
   * probability of the step that produced it; `chars` holds the vocabulary entry of each.
   * @returns {{text:string, chars:string[], probs:number[]}}
   */
  function decode(data, T, C, vocab) {
    const chars = [];
    const probs = [];
    let prev = 0;
    for (let t = 0; t < T; t++) {
      const o = t * C;
      let best = 0;
      let p = data[o];
      for (let c = 1; c < C; c++) if (data[o + c] > p) { p = data[o + c]; best = c; }
      if (best !== 0 && best !== prev) {
        chars.push(vocab[best] != null ? String(vocab[best]) : '');
        probs.push(p);
      }
      prev = best;
    }
    return { text: chars.join(''), chars, probs };
  }

  /**
   * Confidence of one read line from its character probabilities: the same formula as the handwriting model
   * (engine-util lineConfidence: geometric mean^2 x weakest^0.1, junk and loops capped), and one or two characters
   * capped at SHORT_CAP. Checked on 475 page-prep crops of the sample pages with known text (181 printed, 294
   * handwritten): at the app's 0.6 cut, printed lines that pass had 9% character errors (held back: 53%) and
   * handwritten ones 9% (held back: 33%).
   * stats: arithmetic mean and weakest character probability, character count.
   * @param {boolean} [tile] the line comes from an enlarged canvas tile (see TILE_POWER)
   * @returns {{confidence:number, mean:number, min:number, chars:number}}
   */
  function lineConfidence(probs, text, tile) {
    const p = (probs || []).filter((v) => typeof v === 'number' && isFinite(v));
    const t = String(text == null ? '' : text).trim();
    const mean = p.length ? p.reduce((a, b) => a + b, 0) / p.length : 0;
    const min = p.length ? Math.min(...p) : 0;
    let confidence = t ? util().lineConfidence(p, t).confidence : 0;
    if (tile) confidence = Math.pow(confidence, TILE_POWER);
    if (t.replace(/\s/g, '').length <= 2) confidence = Math.min(confidence, SHORT_CAP);
    return { confidence, mean, min, chars: p.length };
  }

  PDFStudy.hwPpocrCtc = { SHORT_CAP, TILE_POWER, decode, lineConfidence };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPpocrCtc;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

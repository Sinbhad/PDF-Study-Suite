/**
 * Picture noise is not review material. A photograph or diagram on a slide makes the page reader return
 * dozens of one- and two-character fragments at low confidence. A student cannot correct those, so they are
 * discarded before anything is counted, listed for review or judged (ocr-lines.js applyToPage).
 *   shape(text)            -> { chars, letters, words, run } what the text is made of
 *   lineLike(text)         true when the text has the substance of a written line (two words, or five
 *                          letters and digits: one word, or a short formula)
 *   isNoise(region)        true when the piece is discarded (the rule is below)
 *   strip(result)          the result without its noise pieces; `noise` counts what was discarded
 * Pure functions, no DOM. Result shape: see ocr-lines.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const LOW_CONFIDENCE = 0.6; // the same cut as ocr-merge.js and ocr-lines.js
  // A piece with fewer letters and digits than this is a label fragment, a bullet or a stray mark
  const MIN_CHARS = 3;
  // An unsure piece is kept for review only when it has the substance of a line: this many real words ...
  const LINE_WORDS = 2;
  // ... or this many letters and digits. Five, not more: on the font-drawn maths page two formula lines the
  // reader was unsure of have 5 and 6 of them and no word at all, and they are exactly what a student must
  // check. On a real deck of 24 picture slides only 2 of 389 unsure pieces reach five without being a line.
  const LINE_CHARS = 5;

  const LETTER = 'A-Za-zÀ-ɏ';
  const LETTERS_RE = new RegExp(`[${LETTER}]`, 'g');
  const CHARS_RE = new RegExp(`[${LETTER}0-9]`, 'g');
  const WORDS_RE = new RegExp(`[${LETTER}]{2,}`, 'g');
  const RUN_RE = new RegExp(`[${LETTER}0-9]{2,}`);

  const count = (text, re) => (text.match(re) || []).length;

  /**
   * chars: letters and digits; letters: letters only; words: runs of two or more letters;
   * run: true when two letters or digits stand together anywhere ("a . 1 | x" has none).
   */
  function shape(text) {
    const t = String(text == null ? '' : text);
    return { chars: count(t, CHARS_RE), letters: count(t, LETTERS_RE), words: count(t, WORDS_RE), run: RUN_RE.test(t) };
  }

  function lineLike(text) {
    const s = shape(text);
    return s.words >= LINE_WORDS || s.chars >= LINE_CHARS;
  }

  /**
   * THE RULE. A piece the reader produced is discarded when any of these holds:
   *   1. it has fewer than MIN_CHARS letters and digits (this includes a piece read as nothing);
   *   2. no two letters or digits stand together: a row of isolated symbols;
   *   3. its confidence is below LOW_CONFIDENCE and it is not line-like (LINE_WORDS real words, or LINE_CHARS
   *      letters and digits).
   * So a confident short label ("12 mm") stays, an unsure real line or formula stays for review, and an
   * unsure "eft" goes.
   * Never discarded: what the student typed or confirmed (source 'user'), pieces waiting to be typed in because
   * no reader ran (source 'manual'), and maths that was read as something.
   * Never discarded either: anything the student touched on the correction screen (ocr-edits.js). A removed
   * line or a line kept as a picture has text '' and must stay in the result, holding what it said, so the
   * removal can be undone, saved and restored; an added or edited line is the student's own. A piece marked
   * `guess` (one the student asked to see on a page taken for a picture) stays to be checked as well.
   */
  function isNoise(region) {
    if (!region || region.source === 'user' || region.source === 'manual') return false;
    if (region.edited || region.added || region.removed || region.kept || region.guess) return false;
    const text = String(region.text == null ? '' : region.text).trim();
    if (!text) return true;
    if (region.kind === 'math') return false;
    const s = shape(text);
    if (s.chars < MIN_CHARS || !s.run) return true;
    const confidence = typeof region.confidence === 'number' ? region.confidence : 0;
    return confidence < LOW_CONFIDENCE && !(s.words >= LINE_WORDS || s.chars >= LINE_CHARS);
  }

  /**
   * The result without its noise pieces (a line left with none is dropped). `noise` on the returned result is
   * how many were discarded, so a page that was nothing but noise can still be told from a page where nothing
   * was found. Returns the same object when nothing is discarded. Region ids and line indices are kept.
   */
  function strip(result) {
    if (!result || !Array.isArray(result.lines)) return result;
    let dropped = 0;
    const lines = [];
    for (const line of result.lines) {
      const all = line.regions || [];
      const regions = all.filter((r) => !isNoise(r));
      dropped += all.length - regions.length;
      if (regions.length === all.length) lines.push(line);
      else if (regions.length) lines.push(Object.assign({}, line, { regions }));
    }
    if (!dropped) return result;
    return Object.assign({}, result, { lines, noise: (result.noise || 0) + dropped });
  }

  PDFStudy.ocrNoise = { LOW_CONFIDENCE, MIN_CHARS, LINE_WORDS, LINE_CHARS, shape, lineLike, isNoise, strip };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.ocrNoise;
  }
})(typeof window !== 'undefined' ? window : globalThis);

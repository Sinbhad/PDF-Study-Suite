/**
 * How a page's recognised text joins the text the PDF already holds (used by ocr-lines.js applyToPage).
 *   outsideTyped(result, typedLines)  the result without the lines that re-read typed text
 *   judge(result)                     -> { emptyRender, picture, held, lowShare, lowLines }
 *   additions(lines, mixed, within)   the recognised page lines worth adding next to typed text
 *   mergeLines(typedLines, added)     typed lines kept in their order, recognised lines placed by position
 * Pure functions, no DOM. Result shape: see ocr-lines.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const LOW_CONFIDENCE = 0.6; // the same cut as ocr-lines.js, which re-exports this one
  /**
   * Page-level hold: when more than this share of a page's recognised characters sit below the confidence
   * cut, the whole page is held out of study text and listed for review, instead of giving prose with every
   * third phrase missing. PROVISIONAL: "about a third" is a judgement, not yet measured against real pages.
   */
  const PAGE_HOLD_LOW_SHARE = 0.35;
  // A recognised line that lies this much over typed lines is the reader re-reading the text layer
  const TYPED_OVERLAP = 0.3;
  // Next to typed text a recognised line must have this many real words (photo and diagram labels do not)
  const MIN_REAL_WORDS = 2;
  // ... and at most this many recognised lines are added to one page that already has typed text
  const MAX_ADDED_LINES = 12;
  // A read page with fewer confident words than this is a picture or a cover, not writing ...
  const PICTURE_MAX_WORDS = 1;
  // ... unless this many unsure pieces on it still look like lines of writing (ocr-noise.js lineLike): that is
  // handwriting the reader could not make out, and the page is held for the student to correct
  const HOLD_MIN_LINES = 3;

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const noise = () => mod('ocrNoise', './ocr-noise.js');

  const conf = (r) => (r && typeof r.confidence === 'number' && r.confidence >= 0 ? Math.min(1, r.confidence) : 0);
  const textOf = (r) => String((r && r.text) == null ? '' : r.text).trim();
  const realWords = (text) => (String(text || '').match(/[A-Za-zÀ-ɏ]{2,}/g) || []).length;

  function overlapArea(a, b) {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  }

  /** Box of a result line: its own box, else the union of its regions' boxes. */
  function resultLineBox(line) {
    if (line && line.box) return line.box;
    const boxes = ((line && line.regions) || []).map((r) => r.box).filter(Boolean);
    if (!boxes.length) return null;
    const x0 = Math.min(...boxes.map((b) => b.x));
    const y0 = Math.min(...boxes.map((b) => b.y));
    const x1 = Math.max(...boxes.map((b) => b.x + b.w));
    const y1 = Math.max(...boxes.map((b) => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /**
   * The reader sees the whole rendered page, typed text included. Lines lying over typed lines are dropped
   * so nothing typed is duplicated (or listed for review). Returns the same object when nothing is dropped.
   */
  function outsideTyped(result, typedLines) {
    if (!result || !Array.isArray(result.lines) || !typedLines || !typedLines.length) return result;
    const scale = result.scale > 0 ? result.scale : 1;
    const typed = typedLines.map((l) => ({
      x: l.x0 * scale,
      y: l.topY * scale,
      w: Math.max(0, l.x1 - l.x0) * scale,
      h: Math.max(0, l.bottomY - l.topY) * scale,
    }));
    const kept = result.lines.filter((line) => {
      const box = resultLineBox(line);
      if (!box || !(box.w * box.h > 0)) return true;
      const covered = typed.reduce((sum, t) => sum + overlapArea(box, t), 0);
      return covered / (box.w * box.h) < TYPED_OVERLAP;
    });
    return kept.length === result.lines.length ? result : Object.assign({}, result, { lines: kept });
  }

  /**
   * What the reader's result says about the page as a whole. Call it on a result that ocr-noise.js has
   * stripped: `result.noise` is how many pieces were discarded as picture noise.
   *   emptyRender  nothing was found on the rendered page at all
   *   picture      the reader read the page and found (almost) no confident words and fewer than HOLD_MIN_LINES
   *                unsure lines: a photo, diagram or cover. Nothing of it is added or listed for review.
   *   held         too much of the text is unsure (PAGE_HOLD_LOW_SHARE), which includes a page that is all
   *                unsure lines: review first
   * Pieces the reader never read (no model installed, cancelled) are empty and decide nothing.
   */
  function judge(result) {
    const out = { emptyRender: false, picture: false, held: false, lowShare: 0, lowLines: 0 };
    const regions = ((result && result.lines) || []).flatMap((l) => l.regions || []);
    const complete = Boolean(result && !result.skippedReason && !result.partial);
    if (!regions.length) {
      // only noise was found: a picture; nothing at all: an empty page
      out.picture = complete && result.noise > 0;
      out.emptyRender = complete && !out.picture;
      return out;
    }
    const looksLikeLine = noise().lineLike;
    let sureChars = 0;
    let lowChars = 0;
    let sureWords = 0;
    let wasRead = false;
    for (const r of regions) {
      const text = textOf(r);
      if (r.source !== 'manual' && r.source !== 'user') wasRead = true;
      if (!text) continue;
      if (conf(r) >= LOW_CONFIDENCE) {
        sureChars += text.length;
        sureWords += r.kind === 'math' ? MIN_REAL_WORDS : realWords(text);
      } else {
        lowChars += text.length;
        if (looksLikeLine(text)) out.lowLines += 1;
      }
    }
    out.lowShare = sureChars + lowChars ? lowChars / (sureChars + lowChars) : 0;
    out.picture = wasRead && complete && sureWords <= PICTURE_MAX_WORDS && out.lowLines < HOLD_MIN_LINES;
    out.held = !out.picture && out.lowShare > PAGE_HOLD_LOW_SHARE;
    return out;
  }

  /**
   * Recognised page lines to add. On a page that already has typed text (`mixed`) only lines with
   * MIN_REAL_WORDS real words (or maths) are kept, and at most MAX_ADDED_LINES of them, the surest first.
   * `within` (optional page boxes, e.g. the pictures that made the page worth reading) limits them further
   * to lines whose centre lies in one of the boxes.
   */
  function additions(lines, mixed, within) {
    if (!mixed) return lines;
    const boxes = within || [];
    const inside = (l) => {
      if (!boxes.length) return true;
      const cx = (l.x0 + l.x1) / 2;
      const cy = (l.topY + l.bottomY) / 2;
      return boxes.some((b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    };
    const wordy = lines.filter((l) => (l.hasMath || realWords(l.text) >= MIN_REAL_WORDS) && inside(l));
    if (wordy.length <= MAX_ADDED_LINES) return wordy;
    const surest = wordy
      .slice()
      .sort((a, b) => ((b.ocr && b.ocr.confidence) || 0) - ((a.ocr && a.ocr.confidence) || 0))
      .slice(0, MAX_ADDED_LINES);
    return wordy.filter((l) => surest.includes(l));
  }

  /**
   * Typed lines keep their order (columns were already put in reading order). Each recognised line goes in
   * front of the first typed line that starts below it, so a picture under the title reads after the title.
   */
  function mergeLines(typedLines, added) {
    const typed = typedLines || [];
    if (!typed.length) return added.slice();
    const slots = typed.map(() => []);
    const tail = [];
    const ordered = added.slice().sort((a, b) => a.topY - b.topY || a.x0 - b.x0);
    for (const line of ordered) {
      const at = typed.findIndex((t) => t.topY > line.topY);
      (at === -1 ? tail : slots[at]).push(line);
    }
    const out = [];
    typed.forEach((t, i) => {
      out.push(...slots[i]);
      out.push(t);
    });
    return out.concat(tail);
  }

  PDFStudy.ocrMerge = {
    LOW_CONFIDENCE, PAGE_HOLD_LOW_SHARE, TYPED_OVERLAP, MIN_REAL_WORDS, MAX_ADDED_LINES, HOLD_MIN_LINES,
    outsideTyped, judge, additions, mergeLines,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.ocrMerge;
  }
})(typeof window !== 'undefined' ? window : globalThis);

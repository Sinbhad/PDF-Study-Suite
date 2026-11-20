/**
 * Slide Captions (100% offline, deterministic): which lines of a slide label a picture rather than state a point.
 * Both taggers set kind 'caption' on the line (slide-kinds.js drops caption lines from every generator):
 *   tagSmallCaptions(lines, isBulletLine)   a plain line set clearly smaller than the slide's text that does not
 *                                           continue the line above it ("Numerous pulmonary granulomas due to ...")
 *   tagSideNotes(lines, h, isBulletLine)    short plain lines wholly right of the slide's text ("DIC" written beside
 *                                           the list, the names under structure drawings)
 * Used by slide-lines.js prepare(): small captions before the column split, side notes after it (a second
 * column of a side-by-side layout is a list of its own, never a side note).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const CAPTION_SIZE_RATIO = 0.9; // of the smallest bulleted line's size
  const CAPTION_MAX_SIZE = 13;
  const PLAIN_CAPTION_RATIO = 0.75; // of the median size, on a slide without bullets
  const MIN_PLAIN_LINES = 5;
  const SIDE_NOTE_WORDS = 4;
  const SIDE_NOTE_GAP = 20; // pt of clear space between the text's right edge and the note
  const TITLE_BAND = 0.2; // top share of the slide where the title sits

  /**
   * A line without a bullet set clearly smaller than every bulleted line of the slide, that does not continue the
   * line above it, labels a picture. Without bullets the reference is the slide's usual text size, and a caption
   * is set well below it ("Seroprevalence in dogs" at 18pt under a map, beside 26pt lists).
   */
  function tagSmallCaptions(lines, isBulletLine) {
    const bulleted = lines.filter((l) => isBulletLine(l) && l.fontSize);
    const sizes = lines.map((l) => l.fontSize).filter(Boolean).sort((a, b) => a - b);
    if (bulleted.length < 2 && sizes.length < MIN_PLAIN_LINES) return lines;
    const limit = bulleted.length >= 2
      ? Math.min(Math.min(...bulleted.map((l) => l.fontSize)) * CAPTION_SIZE_RATIO, CAPTION_MAX_SIZE)
      : sizes[Math.floor(sizes.length / 2)] * PLAIN_CAPTION_RATIO;
    const out = [];
    for (const l of lines) {
      if (isBulletLine(l) || !l.fontSize || l.kind || l.fontSize > limit) {
        out.push(l);
        continue;
      }
      const above = out.slice().reverse().find((o) => o.bottomY <= l.topY + 2 && o.x1 >= l.x0 && o.x0 <= l.x1);
      // A smaller line right under body text, starting at or inside it, is a sub-point or a wrap of that text.
      const continues = above && above.kind !== 'caption' && l.topY - above.bottomY <= l.fontSize * 1.5 && l.x0 >= above.x0 - 5;
      out.push(continues ? l : { ...l, kind: 'caption' });
    }
    return out;
  }

  /** Short plain lines set wholly right of the slide's text, outside any side-by-side column. */
  function tagSideNotes(lines, h, isBulletLine) {
    const isNote = (l) => !isBulletLine(l) && !l.column && String(l.text || '').trim().split(/\s+/).length <= SIDE_NOTE_WORDS;
    const body = lines.filter((l) => !isNote(l) && l.topY > h * TITLE_BAND && Number.isFinite(l.x1));
    if (body.length < 3) return lines;
    const edge = Math.max(...body.map((l) => l.x1));
    return lines.map((l) => (isNote(l) && !l.kind && l.topY > h * TITLE_BAND && l.x0 > edge + SIDE_NOTE_GAP ? { ...l, kind: 'caption' } : l));
  }

  PDFStudy.slideCaptions = { tagSmallCaptions, tagSideNotes };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideCaptions;
  }
})(typeof window !== 'undefined' ? window : globalThis);

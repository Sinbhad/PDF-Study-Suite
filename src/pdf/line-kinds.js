/**
 * Non-content Line Tagger (100% offline, deterministic).
 * Sets `line.kind` on page lines that are not study content, right after line building:
 *   'caption'   figure / table labels and their wrapped caption lines, photo credit lines
 *   'folio'     running heads and page numbers in the top / bottom band
 *   'url'       web addresses, e-mail and contact lines
 *   'objective' learning-objective / chapter-goal lists
 *   'biography' biography sidebars ("NAME (1815-1864) ...") set in a smaller size than the body
 *   'code'      code listings, including listing line numbers and comment rows between code rows
 * Lines without a kind are content. Every rule is stated as layout / typography evidence; thresholds are named.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // A caption label: "Figure 3", "FIGURE 3-1", "Table 2-1", "Fig. 4.2(b)", "Listing 7"
  const CAPTION_LABEL_RE = /^(?:Figure|Fig\.|Table|Exhibit|Listing|Chart|Plate)\s+[A-Z]?\d+(?:[.\-–]\d+)*(?:\s*\(?[a-z]\))?(?=\s|$|[.:])/i;
  // Photo / art credit segment: "© Name/Agency." (the whole line is a credit when nothing else is left)
  // Only the © sign: "(c)" is far more often a function argument ("q(c) ≠ 0") than a copyright mark
  const CREDIT_RE = /©[^©]{2,70}?(?:\.(?=\s|$|\$)|$)/g;
  const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|edu|net|gov|io)(?:\/\S*)?(?=$|[\s),.;])/gi;
  const CONTACT_LEAD_RE = /^(?:e-?mail|phone|tel|fax|office(?:\s+hours)?|website|web|contact|twitter|linkedin)\s*:/i;
  const OBJECTIVE_HEAD_RE = /^(?:(?:chapter|learning|lesson|lecture|session|section|course)\s+)?(?:objectives|goals|outcomes|aims)\b|^(?:in\s+this\s+(?:chapter|section|lecture|unit),?\s+you\s+will|after\s+(?:reading|studying|completing)\s+this)/i;
  const BIO_HEAD_RE = /^[A-Z][A-Z'’\-]{2,}(?:\s+[A-Z][A-Z'’.\-]*){0,4}\s*\((?:c\.\s*)?\d{3,4}\s*(?:B\.?C\.?E?\.?|A\.?D\.?|C\.?E\.?)?\s*[–\-]/;
  const FOLIO_NUMBER_RE = /^\d{1,4}\b|\b\d{1,4}$/;

  const BAND = 0.07; // top / bottom share of the page where running heads and folios sit
  const FOLIO_MAX_WORDS = 12; // a running head is short ("1.1 Propositional Logic 3")
  const CAPTION_MAX_CONT = 3; // wrapped caption lines after the label line
  const CAPTION_GAP = 0.8; // x font size: max vertical gap inside one caption
  const CAPTION_SIZE_TOL = 0.6; // pt: caption continuation lines share the label's size
  const SMALL = 0.95; // x body size: "set smaller than the body" (captions, sidebars)
  const URL_SHARE = 0.4; // share of a line's characters that are URL / e-mail text
  const OBJECTIVE_MAX = 12; // list rows after an objectives heading
  const BIO_GAP = 1.2; // x font size: max gap between two rows of one biography box
  const PROSE_WORDS = 8; // a row with this many words is running text, not a label
  const LISTING_LOOKAHEAD = 3; // rows: a listing's numbered / comment row is followed by code this soon

  const plainOf = (l) => String((l && (l.text || l.cleanText)) || '').replace(/\*\*/g, '').trim();
  const gapOf = (a, b) => (Number.isFinite(b.topY) && Number.isFinite(a.bottomY) ? b.topY - a.bottomY : 0);

  /** Character-weighted most common size of non-margin lines: the page's body size. */
  function bodySize(lines) {
    const counts = new Map();
    for (const l of lines) {
      if (!l.fontSize || l.isMargin) continue;
      const k = Math.round(l.fontSize * 2) / 2;
      counts.set(k, (counts.get(k) || 0) + plainOf(l).length);
    }
    let best = 0;
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
    return best || 10;
  }

  /** "Table 1 displays the truth table" is prose; a caption label is bold, small, in the margin or Title Case. */
  function isCaptionLabel(line, body) {
    const plain = plainOf(line);
    const m = plain.match(CAPTION_LABEL_RE);
    if (!m) return false;
    const fmt = String(line.formattedText || '');
    const boldLabel = /^\*\*(?:Figure|Fig\.|Table|Exhibit|Listing|Chart|Plate)\b/i.test(fmt) || line.isBold;
    const small = line.fontSize && line.fontSize < body * SMALL;
    const rest = plain.slice(m[0].length).trim();
    const titleLike = !rest || (/^[A-Z(“"]/.test(rest) && !/[.!?]$/.test(rest.replace(/\.$/, '')) && rest.split(/\s+/).length <= 14);
    return Boolean(boldLabel || small || line.isMargin || titleLike);
  }

  const isCreditOnly = (plain) => plain.includes('©') && plain.replace(CREDIT_RE, '').replace(/[\s$]/g, '').length < 3;

  function isUrlLine(plain) {
    if (CONTACT_LEAD_RE.test(plain)) return true;
    const hits = plain.match(URL_RE);
    if (!hits) return false;
    const n = hits.reduce((s, h) => s + h.length, 0);
    return n / Math.max(1, plain.replace(/\s/g, '').length) >= URL_SHARE;
  }

  function isFolio(line, plain, h) {
    if (!Number.isFinite(line.topY)) return false;
    const inBand = line.topY < h * BAND || line.topY > h * (1 - BAND);
    if (!inBand) return false;
    const words = plain.split(/\s+/).length;
    return words <= FOLIO_MAX_WORDS && FOLIO_NUMBER_RE.test(plain);
  }

  /** Lines in reading order that share one region with `i` (same column / margin flag). */
  const sameRegion = (a, b) => a.isMargin === b.isMargin && (a.column === undefined || a.column === b.column);

  function tagCaptions(lines, body) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.kind || !isCaptionLabel(l, body)) continue;
      l.kind = 'caption';
      let last = l;
      for (let k = i + 1, n = 0; k < lines.length && n < CAPTION_MAX_CONT; k++) {
        const c = lines[k];
        if (!sameRegion(l, c) || c.kind || c.isCode || c.hasBullet) break;
        const size = c.fontSize || 0;
        const gap = gapOf(last, c);
        const fits = Math.abs(size - (l.fontSize || 0)) <= CAPTION_SIZE_TOL && size < body * SMALL;
        if (!fits || gap > (size || 10) * CAPTION_GAP || gap < -(size || 10)) break;
        c.kind = 'caption';
        last = c;
        n += 1;
      }
    }
  }

  function tagObjectives(lines, body) {
    for (let i = 0; i < lines.length; i++) {
      const head = lines[i];
      if (head.kind || !OBJECTIVE_HEAD_RE.test(plainOf(head))) continue;
      const isHeading = head.isBold || (head.fontSize || 0) >= body * 1.1 || plainOf(head).split(/\s+/).length <= 4;
      if (!isHeading) continue;
      head.kind = 'objective';
      let last = head;
      for (let k = i + 1, n = 0; k < lines.length && n < OBJECTIVE_MAX; k++) {
        const c = lines[k];
        if (!sameRegion(head, c) || c.kind) break;
        const biggerHeading = (c.fontSize || 0) >= Math.max(head.fontSize || 0, body * 1.15) && c.isBold;
        if (biggerHeading || gapOf(last, c) > (c.fontSize || 10) * 2) break;
        c.kind = 'objective';
        last = c;
        n += 1;
      }
    }
  }

  /**
   * A biography box is set smaller than the page's running prose. A long box can outweigh the prose on its
   * page, so the reference is the largest size of any full prose row (>= PROSE_WORDS words), not the mode.
   */
  function tagBiographies(lines) {
    const prose = lines.filter((l) => !l.isMargin && plainOf(l).split(/\s+/).length >= PROSE_WORDS);
    const proseSize = prose.length ? Math.max(...prose.map((l) => l.fontSize || 0)) : 0;
    for (let i = 0; i < lines.length; i++) {
      const head = lines[i];
      if (head.kind || !(head.fontSize < proseSize * SMALL) || !BIO_HEAD_RE.test(plainOf(head))) continue;
      head.kind = 'biography';
      let last = head;
      for (let k = i + 1; k < lines.length; k++) {
        const c = lines[k];
        if (c.isMargin !== head.isMargin || c.kind) continue;
        if (Math.abs((c.fontSize || 0) - head.fontSize) > 0.3) break;
        if (gapOf(last, c) > head.fontSize * BIO_GAP || gapOf(last, c) < -head.fontSize * 3) break;
        c.kind = 'biography';
        last = c;
      }
    }
  }

  /** Listing rows PDF.js did not flag as code: line numbers ("13", "7 {") and comments between two code rows. */
  function tagCode(lines) {
    lines.forEach((l) => {
      if (l.isCode && !l.kind) l.kind = 'code';
    });
    // Two passes: a numbered row is code once its neighbour row turned out to be code ("13" / "14 // note" / "15")
    for (let pass = 0; pass < 2; pass++) tagCodePass(lines);
  }

  function tagCodePass(lines) {
    for (let i = 1; i < lines.length - 1; i++) {
      const l = lines[i];
      if (l.kind) continue;
      const prev = lines.slice(0, i).reverse().find((x) => sameRegion(x, l));
      // A code row follows within LISTING_LOOKAHEAD rows of the same region (numbered rows may sit in between)
      const ahead = lines.slice(i + 1).filter((x) => sameRegion(x, l)).slice(0, LISTING_LOOKAHEAD);
      const codeAhead = ahead.some((x) => x.isCode || x.kind === 'code');
      if (!prev || prev.kind !== 'code' || !codeAhead) continue;
      const sizeOk = Math.abs((l.fontSize || 0) - (prev.fontSize || 0)) <= 1.2;
      const numbered = /^\d{1,3}(?:\s|$)/.test(plainOf(l)) || plainOf(l).length <= 6;
      if (sizeOk && numbered && gapOf(prev, l) < (l.fontSize || 10)) l.kind = 'code';
    }
  }

  /** Sets line.kind on the page's non-content lines; returns the page. Lines already carrying a kind are kept. */
  function tagPage(page) {
    if (!page || !Array.isArray(page.lines)) return page;
    const lines = page.lines.filter((l) => l && typeof l.text === 'string');
    const h = page.height || 792;
    const body = bodySize(lines);
    tagCode(lines);
    for (const l of lines) {
      if (l.kind) continue;
      const plain = plainOf(l);
      if (isFolio(l, plain, h)) l.kind = 'folio';
      else if (isCreditOnly(plain)) l.kind = 'caption';
      else if (isUrlLine(plain)) l.kind = 'url';
    }
    tagCaptions(lines, body);
    tagObjectives(lines, body);
    tagBiographies(lines);
    return page;
  }

  /** Removes "© Name/Agency." credit segments glued onto a prose line by a neighbouring picture. */
  const stripCredits = (text) => String(text || '').replace(CREDIT_RE, ' ').replace(/[ \t]{2,}/g, ' ').trim();

  PDFStudy.lineKinds = { tagPage, bodySize, isCaptionLabel, isUrlLine, stripCredits, CAPTION_LABEL_RE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.lineKinds;
  }
})(typeof window !== 'undefined' ? window : globalThis);

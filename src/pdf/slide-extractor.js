/**
 * Deterministic Slide Deck Structure Extractor
 * Reconstructs each slide into
 *   { slideNumber, pages[], kind, title, formattedTitle, bullets, nestedBullets, rawText,
 *     qa?: { question, answer }, definitions: [{ term, definition }], table?: { rows: string[][] } }
 * Line preparation (marker glyphs, wrapped lines, grids) lives in slide-lines.js; build / reveal collapsing,
 * `kind` and `definitions` live in slide-reveal.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const need = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const SL = () => need('slideLines', './slide-lines.js');
  const SR = () => need('slideReveal', './slide-reveal.js');
  const SLIDE_BULLET_RE = /^[\s]*([✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○\-*+]|\d+[.)]|[a-zA-Z][.)])\s+/;

  function emptySlide(page) {
    const n = (page && page.pageNumber) || 0;
    return { slideNumber: n, title: `Slide ${n}`, formattedTitle: `Slide ${n}`, bullets: [], nestedBullets: [], rawText: '' };
  }

  /** Picks the title line (large, high on the slide, not a bullet) and absorbs its wrapped continuation lines. */
  function pickTitle(rawLines, h, w) {
    const sl = SL();
    const topCutoff = rawLines.length <= 4 ? h * 0.62 : h * 0.34;
    let candidates = rawLines.filter((l) => l.topY <= topCutoff && !sl.isBulletLine(l));
    if (candidates.length === 0) candidates = [rawLines[0]];
    const score = (line) =>
      line.fontSize * 2.2 + (line.isBold ? 6 : 0) - (line.topY / h) * 16 - (sl.isBulletLine(line) ? 40 : 0);
    let best = candidates[0];
    for (const cand of candidates.slice(1)) if (score(cand) > score(best)) best = cand;

    const plain = (l) => sl.cleanBulletText(l.cleanText || l.text).replace(/\*\*/g, '');
    const fmt = (l) => sl.stripMarkerFmt(l.formattedText || l.text).replace(/\*\*/g, '');
    const used = [best];
    let last = best;
    let idx = rawLines.indexOf(best) + 1;
    // A title can wrap over several lines of the same size ("Let m be ... is an" / "equivalence relation ...")
    while (idx < rawLines.length && used.length < 4) {
      const next = rawLines[idx];
      const vGap = next.topY - last.bottomY;
      const same = Math.abs(next.fontSize - best.fontSize) <= 1.2 && vGap >= -4 && vGap <= best.fontSize * 1.4;
      const wideEnough = used.length === 1 || last.x1 - last.x0 > w * 0.55;
      if (sl.isBulletLine(next) || !same || !wideEnough) break;
      used.push(next);
      last = next;
      idx++;
    }
    return {
      used,
      title: used.map(plain).join(' ').replace(/\s+/g, ' ').trim(),
      formattedTitle: used.map(fmt).join(' ').replace(/\s+/g, ' ').trim(),
    };
  }

  function extractSlidePage(page) {
    if (!page || !Array.isArray(page.lines)) return emptySlide(page);
    const sl = SL();
    const h = page.height || 600;
    const w = page.width || 800;
    const rawLines = sl.prepare(page);
    if (rawLines.length === 0) return emptySlide(page);

    const t = pickTitle(rawLines, h, w);
    const usedSet = new Set(t.used);
    const titleIdx = rawLines.indexOf(t.used[0]);
    let bodyLines = rawLines.filter((l, i) => i > titleIdx && !usedSet.has(l));

    const grid = sl.detectTable(bodyLines);
    if (grid) bodyLines = grid.rest;

    const nestedBullets = sl.toNested(sl.mergeBlocks(bodyLines, w));
    const bullets = nestedBullets.map((b) => b.text).filter(Boolean);
    const title = t.title || `Slide ${page.pageNumber}`;
    const slide = {
      slideNumber: page.pageNumber,
      title,
      formattedTitle: t.formattedTitle || title,
      bullets,
      nestedBullets,
      rawText: [title, ...bullets].join('. '),
    };
    if (grid) {
      slide.table = grid.table;
      slide.rawText = [slide.rawText, ...grid.table.rows.map((r) => r.join(' | '))].join('. ');
    }
    return slide;
  }

  function collapseNearDuplicateSlides(rawSlides) {
    return SR().collapse(rawSlides);
  }

  function safeExtract(page) {
    try {
      return extractSlidePage(page);
    } catch (_err) {
      // Odd input must degrade to clean plain lines, never throw
      const lines = ((page && page.lines) || []).map((l) => String((l && (l.cleanText || l.text)) || '').trim()).filter(Boolean);
      const slide = emptySlide(page);
      if (lines.length) {
        slide.title = slide.formattedTitle = lines[0];
        slide.bullets = lines.slice(1);
        slide.nestedBullets = slide.bullets.map((text) => ({ level: 0, text, formattedText: text }));
        slide.rawText = lines.join('. ');
      }
      return slide;
    }
  }

  function extractSlideDeck(parsedPdf) {
    const rawSlides = ((parsedPdf && parsedPdf.pages) || []).map(safeExtract);
    const slides = SR().annotate(SR().collapse(rawSlides));
    return {
      totalSlides: slides.length,
      rawSlideCount: rawSlides.length,
      slides,
    };
  }

  PDFStudy.slideExtractor = {
    extractSlidePage,
    extractSlideDeck,
    collapseNearDuplicateSlides,
    SLIDE_BULLET_RE,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideExtractor;
  }
})(typeof window !== 'undefined' ? window : globalThis);

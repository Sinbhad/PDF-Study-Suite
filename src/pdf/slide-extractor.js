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
  const TG = () => need('tableGrid', './table-grid.js');
  const SLIDE_BULLET_RE = /^[\s]*([✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○\-*+]|\d+[.)]|[a-zA-Z][.)])\s+/;

  function emptySlide(page) {
    const n = (page && page.pageNumber) || 0;
    return { slideNumber: n, title: `Slide ${n}`, formattedTitle: `Slide ${n}`, bullets: [], nestedBullets: [], rawText: '' };
  }

  /** Plain lines in type at least SIDE_TITLE_RATIO larger than every bulleted line (none when nothing is bulleted). */
  function sideTitle(rawLines) {
    const sl = SL();
    const bullets = rawLines.filter((l) => sl.isBulletLine(l) && l.fontSize);
    if (bullets.length < 2) return [];
    const largest = Math.max(...bullets.map((l) => l.fontSize));
    return rawLines.filter((l) => !sl.isBulletLine(l) && l.fontSize >= largest * SIDE_TITLE_RATIO);
  }
  const SIDE_TITLE_RATIO = 1.15;
  const SIDE_OVER_TOP_RATIO = 1.5; // a side title this much larger than every line at the top is the title

  /** Picks the title line (large, high on the slide, not a bullet) and absorbs its wrapped continuation lines. */
  function pickTitle(rawLines, h, w) {
    const sl = SL();
    const topCutoff = rawLines.length <= 4 ? h * 0.62 : h * 0.34;
    let candidates = rawLines.filter((l) => l.topY <= topCutoff && !sl.isBulletLine(l));
    // A title set beside the list rather than above it ("Why Remove / Horns?" left of the bullets): the plain
    // line in clearly larger type than every bullet, wherever it sits.
    // A plain line at the top set in list type ("Mild disease" over its list) loses to a side title in far larger type.
    const sideAll = sideTitle(rawLines);
    const topSize = candidates.length ? Math.max(...candidates.map((l) => l.fontSize || 0)) : 0;
    const side = candidates.length === 0 || (sideAll.length && topSize * SIDE_OVER_TOP_RATIO <= Math.min(...sideAll.map((l) => l.fontSize))) ? sideAll : [];
    if (side.length) candidates = side;
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
      // A line of a list beside a side title (no horizontal overlap with it) is passed over, not a wrap.
      if (best.x1 - best.x0 < w * 0.5 && (next.x0 > last.x1 || next.x1 < last.x0)) {
        idx++;
        continue;
      }
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
      side: side.length > 0,
      title: used.map(plain).join(' ').replace(/\s+/g, ' ').trim(),
      formattedTitle: used.map(fmt).join(' ').replace(/\s+/g, ' ').trim(),
    };
  }

  /** The reader's own notes on this slide (page.annotations from invisible-text.js), never title or bullets. */
  function withAnnotations(slide, page) {
    const notes = (page && Array.isArray(page.annotations)) ? page.annotations : [];
    slide.annotations = notes.map((a) => ({ ...a }));
    return slide;
  }

  function extractSlidePage(page) {
    return withAnnotations(extractSlideBody(page), page);
  }

  function extractSlideBody(page) {
    if (!page || !Array.isArray(page.lines)) return emptySlide(page);
    const sl = SL();
    const h = page.height || 600;
    const w = page.width || 800;
    const rawLines = sl.prepare(page);
    if (rawLines.length === 0) return emptySlide(page);

    const t = pickTitle(rawLines, h, w);
    const usedSet = new Set(t.used);
    const titleIdx = rawLines.indexOf(t.used[0]);
    // Lines above a side title are body lines too (the list starts higher than the title beside it).
    let bodyLines = rawLines.filter((l, i) => (i > titleIdx || t.side) && !usedSet.has(l));

    // Grid tables (header band + stacked cells, or aligned cell rows) become structures, never bullets
    const tg = TG();
    const tables = tg ? tg.fromCells(bodyLines, page.pageNumber) : [];
    const inTable = new Set(tables.flatMap((t) => [...t.lines]));
    bodyLines = bodyLines.filter((l) => !inTable.has(l));
    if (tg) tables.push(...tg.fromSegments(bodyLines, page.pageNumber));
    tables.forEach((t) => t.lines.forEach((l) => inTable.add(l)));
    bodyLines = bodyLines.filter((l) => !inTable.has(l));

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
    if (tables.length) {
      // slide.tables: [{ kind: 'table', header, rows, pageNumber, text }]; slide.table keeps the legacy { rows } form
      slide.tables = tables.map(tg.publicTable);
      if (!slide.table) {
        const first = slide.tables[0];
        const rows = [first.header, ...first.rows];
        slide.table = { rows, formattedRows: rows.map((r) => r.slice()) };
      }
      slide.rawText = [slide.rawText, ...slide.tables.map((t) => t.text.replace(/\n/g, '. '))].join('. ');
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
      return withAnnotations(slide, page);
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

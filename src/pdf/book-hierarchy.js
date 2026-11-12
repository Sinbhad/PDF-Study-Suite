/**
 * 3-Tier Deterministic Book Chapter & Section Hierarchy Extractor
 * Handles non-monotonic outlines (e.g. back-pointing Reference Sheets spanning p.2 + p.867),
 * separates Front/Back Matter (`isExtra`) from Core Chapters, and re-exports scope-builder.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const CHAPTER_RE =
    /^(?:(?:CHAPTER|PART|UNIT|MODULE|APPENDIX)\s+(?:[A-Z0-9]+|[IVXLCDM]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN)\b[:.\s-]*.*|(?:\d+)\s+[A-Z][A-Za-z0-9\s,&:-]{3,65})$/i;
  const SECTION_RE = /^([A-Z0-9]+\.\d+(?:\.\d+)?)\s+([A-Z][A-Za-z0-9\s,&:-]{2,75})$/;
  const FRONT_BACK_MATTER_RE =
    /^(?:front\s+cover|back\s+cover|cover|title\s+page|half\s+title|copyright|contents|table\s+of\s+contents|brief\s+contents|preface|foreword|dedication|acknowledg(?:e)?ments|about\s+the\s+authors?|list\s+of\s+(?:figures|tables)|index\b|answers\b|solutions\s+to|useful\s+reference|reference\s+sheets?|formula\s+cards?|(?:photo\s+|image\s+)?credits|about\s+the\s+(?:book|cover|publisher)|to\s+the\s+(?:student|instructor|reader)|additional\s+resources|front\s*matter|back\s*matter|endpapers?|colophon|glossary|bibliography|appendi(?:x|ces)\b)/i;
  const EXTRA_SECTION_RE =
    /^(?:Review\s+Exercises|(?:P\.S\.\s+)?Problem\s+Solving|Chapter\s+(?:Review|Summary|Test))\b/i;

  const EXERCISE_SECTION_RE =
    /^(?:(?:[A-Z0-9]+\.\d+\s+)?(?:Review\s+|Practice\s+|Chapter\s+|Section\s+|Cumulative\s+)*(?:Exercises|Problems|Problem\s+Set|Questions)\b|(?:P\.S\.\s+)?Problem\s+Solving\b|Chapter\s+Test\b)/i;

  const getNoiseFilter = () =>
    PDFStudy.noiseFilter || (typeof require === 'function' ? require('../nlp/noise-filter.js') : null);
  const getScope = () =>
    PDFStudy.scopeBuilder || (typeof require === 'function' ? require('./scope-builder.js') : null);

  function computeBodyFontSize(pages) {
    const counts = new Map();
    for (const p of pages || []) {
      for (const l of p.lines || []) {
        const bucket = Math.round(l.fontSize * 2) / 2;
        counts.set(bucket, (counts.get(bucket) || 0) + l.text.length);
      }
    }
    let bestSize = 11;
    let bestChars = -1;
    for (const [sz, chars] of counts.entries()) {
      if (chars > bestChars) {
        bestChars = chars;
        bestSize = sz;
      }
    }
    return bestSize;
  }

  function assignEndPages(chapters, totalPages) {
    // Track maximum page seen BEFORE chapter i so back-pointing outline chapters (e.g. "Useful Reference Sheets"
    // at end of outline pointing back to p.2 while core book already reached p.869) never span the entire book.
    const coreAnchors = chapters.filter((c) => !FRONT_BACK_MATTER_RE.test(c.title)).map((c) => c.startPage);
    let maxSeen = 0;

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      ch.id = `ch-${i + 1}`;
      ch.isExtra = FRONT_BACK_MATTER_RE.test(ch.title);
      ch.isExercises = EXERCISE_SECTION_RE.test(ch.title);
      const backPointing = ch.startPage < maxSeen - 5;

      let nextValidStart = totalPages + 1;
      for (let k = i + 1; k < chapters.length; k++) {
        if (chapters[k].startPage > ch.startPage) {
          nextValidStart = chapters[k].startPage;
          break;
        }
      }
      if (backPointing) {
        // Clamp against any core chapter that starts after ch.startPage (e.g. Front Cover/Ch P at p.24)
        for (const anchor of coreAnchors) {
          if (anchor > ch.startPage && anchor < nextValidStart) nextValidStart = anchor;
        }
        nextValidStart = Math.min(nextValidStart, ch.startPage + 10);
      }

      const secs = ch.sections || [];
      let secMaxEnd = ch.startPage;
      for (let j = 0; j < secs.length; j++) {
        const sec = secs[j];
        sec.id = `ch-${i + 1}-sec-${j + 1}`;
        sec.isExtra = ch.isExtra || EXTRA_SECTION_RE.test(sec.title);
        sec.isExercises = EXERCISE_SECTION_RE.test(sec.title);
        let nextSecStart = backPointing ? sec.startPage + 2 : Math.min(totalPages, nextValidStart - 1) + 1;
        for (let m = j + 1; m < secs.length; m++) {
          if (secs[m].startPage >= sec.startPage) {
            // A huge jump across core chapters (e.g. Trigonometry p.4 -> Algebra p.867) is split endpapers, not a 863-page section
            const jump = secs[m].startPage - sec.startPage;
            const crossesCore = coreAnchors.some((a) => a > sec.startPage + 2 && a < secs[m].startPage);
            nextSecStart = crossesCore && jump > 40 ? sec.startPage + 2 : secs[m].startPage;
            break;
          }
        }
        const capEnd = backPointing ? totalPages : Math.min(totalPages, Math.max(ch.startPage, nextValidStart - 1));
        sec.endPage =
          nextSecStart > sec.startPage ? Math.min(capEnd, nextSecStart - 1) : Math.min(capEnd, sec.startPage);
        secMaxEnd = Math.max(secMaxEnd, sec.endPage);
      }

      ch.endPage = backPointing
        ? Math.min(totalPages, Math.max(ch.startPage, nextValidStart - 1))
        : Math.min(totalPages, Math.max(ch.startPage, nextValidStart - 1));
      maxSeen = Math.max(maxSeen, ch.startPage, secMaxEnd);
    }
    return chapters;
  }

  // Outline titles can carry NUL padding ("1.1 A Preview of Calculus\u0000\u0000...")
  const cleanTitle = (t) =>
    String(t || '').replace(/[\u0000-\u001f\u007f-\u009f\uFFFD]/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled';

  function buildFromOutline(outline, totalPages) {
    if (!outline || outline.length === 0) return null;
    const chapters = outline.map((node) => ({
      title: cleanTitle(node.title),
      startPage: Math.min(totalPages, Math.max(1, node.startPage || 1)),
      sections: (node.children || []).map((child) => ({
        title: cleanTitle(child.title),
        startPage: Math.min(totalPages, Math.max(1, child.startPage || node.startPage || 1)),
      })),
    }));
    return assignEndPages(chapters, totalPages);
  }

  function buildFromBodyHeadings(pages, totalPages) {
    const bodySize = computeBodyFontSize(pages);
    const chapters = [];
    const nf = getNoiseFilter();

    for (const page of pages || []) {
      if (nf && nf.isBoilerplatePage(page)) continue;
      const h = page.height || 792;
      const lines = page.lines || [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.topY < h * 0.06 || line.topY > h * 0.93) continue;
        const text = line.cleanText;
        if (text.length < 3 || text.length > 95 || /[.;,]$/.test(text)) continue;

        const isChapterRegex = CHAPTER_RE.test(text);
        const isLargeChapterFont = line.fontSize >= bodySize * 1.45 && line.topY <= h * 0.42;
        const secMatch = text.match(SECTION_RE);
        const isSectionFont =
          line.fontSize >= bodySize * 1.18 && line.fontSize < bodySize * 1.45 && line.isBold && line.wordCount <= 10;

        if (isChapterRegex || isLargeChapterFont) {
          let title = text;
          const next = lines[i + 1];
          if (/^(chapter|part|unit)\s+[A-Z0-9]+$/i.test(text) && next && next.fontSize >= bodySize * 1.2) {
            title = `${text}: ${next.cleanText}`;
            i++;
          }
          chapters.push({ title, startPage: page.pageNumber, sections: [] });
        } else if (secMatch || isSectionFont) {
          if (chapters.length === 0) chapters.push({ title: 'Chapter 1', startPage: 1, sections: [] });
          chapters[chapters.length - 1].sections.push({ title: text, startPage: page.pageNumber });
        }
      }
    }

    if (chapters.length > 0) return assignEndPages(chapters, totalPages);

    const chunkSize = Math.max(5, Math.min(15, Math.ceil(totalPages / 8)));
    const fallback = [];
    for (let start = 1; start <= totalPages; start += chunkSize) {
      const end = Math.min(totalPages, start + chunkSize - 1);
      fallback.push({ title: `Pages ${start}–${end}`, startPage: start, sections: [] });
    }
    return assignEndPages(fallback, totalPages);
  }

  function extractBookHierarchy(parsedPdf) {
    const pages = (parsedPdf && parsedPdf.pages) || [];
    const totalPages = (parsedPdf && parsedPdf.numPages) || pages.length || 1;
    const fromOutline = buildFromOutline(parsedPdf && parsedPdf.outline, totalPages);
    if (fromOutline && fromOutline.length > 0) return { source: 'pdf_outline', chapters: fromOutline };
    return { source: 'typography_scanner', chapters: buildFromBodyHeadings(pages, totalPages) };
  }

  const extractScopeText = (pdf, s, e) => getScope().extractScopeText(pdf, s, e);
  const extractScopeTextAsync = (pdf, s, e, cb) => getScope().extractScopeTextAsync(pdf, s, e, cb);

  PDFStudy.bookHierarchy = {
    extractBookHierarchy,
    extractScopeText,
    extractScopeTextAsync,
    computeBodyFontSize,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.bookHierarchy;
  }
})(typeof window !== 'undefined' ? window : globalThis);

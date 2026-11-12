/**
 * Deterministic Non-AI PDF Document Classifier (Slide Deck vs. Book / Worksheet)
 * Uses geometric and typographic signals (Aspect Ratio, Words/Page, Font Size, Bullet Density)
 * plus portrait worksheet/homework cues so problem sets never misclassify as slide decks.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const WORKSHEET_CUE_RE =
    /\b(?:homework|problem\s+set|assignment|worksheet|exam|midterm|final\s+exam|quiz)\b|^Problem\s+\d+[.:]?\s*(?:\(\d+\s*Points?\))?|\(\d+\s*Points?\)|\bDue\s*:/i;

  function median(values) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Classifies a parsed PDF document into 'slide_deck' or 'book'.
   * @param {Object} parsedPdf - Output of loadPdfDocument ({ numPages, pages, outline })
   * @returns {Object} { type, slideScore, confidence, reasons, metrics }
   */
  function classifyDocument(parsedPdf) {
    const pages = (parsedPdf && parsedPdf.pages) || [];
    if (pages.length === 0) {
      return {
        type: 'slide_deck',
        slideScore: 50,
        confidence: 0,
        reasons: ['Empty document'],
        metrics: {},
      };
    }

    // Evenly sample up to 15 pages across the document to avoid front-matter bias
    const sampleCount = Math.min(pages.length, 15);
    const samplePages = [];
    for (let i = 0; i < sampleCount; i++) {
      const idx = Math.min(pages.length - 1, Math.floor(((i + 0.5) * pages.length) / sampleCount));
      samplePages.push(pages[idx]);
    }

    const aspectRatios = [];
    const wordsPerPage = [];
    const fontSizes = [];
    let totalLines = 0;
    let bulletOrShortLines = 0;
    let realBulletLines = 0;
    let worksheetCueHits = 0;

    for (const page of samplePages) {
      aspectRatios.push(page.aspectRatio || page.width / Math.max(1, page.height));
      wordsPerPage.push(page.wordCount || 0);

      for (const line of page.lines || []) {
        if (line.fontSize > 0) fontSizes.push(line.fontSize);
        totalLines++;
        const txt = String(line.cleanText || line.text || '').trim();
        if (WORKSHEET_CUE_RE.test(txt)) worksheetCueHits++;
        if (line.hasBullet) realBulletLines++;
        if (line.hasBullet || (line.wordCount >= 2 && line.wordCount <= 8)) {
          bulletOrShortLines++;
        }
      }
    }

    const landscapeRatio = aspectRatios.filter((ar) => ar > 1.18).length / Math.max(1, aspectRatios.length);
    const medianAR = Math.round(median(aspectRatios) * 100) / 100;
    const medianWPP = Math.round(median(wordsPerPage));
    const medianFS = Math.round(median(fontSizes) * 10) / 10;
    const bulletRatio = Math.round((bulletOrShortLines / Math.max(1, totalLines)) * 100) / 100;
    const realBulletRatio = Math.round((realBulletLines / Math.max(1, totalLines)) * 100) / 100;
    const isPortrait = landscapeRatio < 0.35 && medianAR < 0.95;

    let slideScore = 0;
    const reasons = [];

    // 1. Page Aspect Ratio (max 45 pts)
    if (landscapeRatio >= 0.7) {
      slideScore += 45;
      reasons.push(`Landscape slide layout (${medianAR}:1 aspect ratio)`);
    } else if (medianAR > 1.12) {
      slideScore += 25;
      reasons.push(`Wide page geometry (${medianAR}:1)`);
    } else {
      reasons.push(`Portrait book layout (${medianAR}:1 aspect ratio)`);
    }

    // 2. Words Per Page Density (max 25 pts)
    if (medianWPP <= 95) {
      slideScore += 25;
      reasons.push(`Concise slide text density (~${medianWPP} words/page)`);
    } else if (medianWPP <= 155) {
      slideScore += 12;
      reasons.push(`Moderate text density (~${medianWPP} words/page)`);
    } else {
      reasons.push(`Dense textbook prose (~${medianWPP} words/page)`);
    }

    // 3. Base Font Size (max 15 pts)
    if (medianFS >= 15) {
      slideScore += 15;
      reasons.push(`Presentation typography (${medianFS}pt median font)`);
    } else if (medianFS >= 13) {
      slideScore += 8;
    }

    // 4. Bullet & Short-Line Ratio (max 15 pts)
    if (bulletRatio >= 0.38) {
      slideScore += 15;
      reasons.push(`High bullet/point structure (${Math.round(bulletRatio * 100)}% of lines)`);
    } else if (bulletRatio >= 0.25) {
      slideScore += 7;
    }

    // Portrait homework / problem set / exam pages have sparse prose + short math/code lines, not slides
    if (isPortrait && worksheetCueHits >= 2 && medianFS < 14) {
      slideScore = Math.max(0, slideScore - 25);
      reasons.push('Portrait homework/worksheet problem structure');
    } else if (
      landscapeRatio < 0.5 &&
      medianWPP <= 105 &&
      bulletRatio >= 0.48 &&
      realBulletRatio >= 0.28 &&
      medianFS >= 13.5 &&
      worksheetCueHits < 2
    ) {
      // Portrait slide handout (large presentation font + actual slide bullets, not 12pt homework)
      slideScore = Math.max(slideScore, 55);
      reasons.push('Detected portrait slide handout structure');
    }

    const isSlide = slideScore >= 50;
    const confidence = Math.min(0.99, Math.max(0.55, Math.abs(slideScore - 50) / 50 + 0.45));

    return {
      type: isSlide ? 'slide_deck' : 'book',
      slideScore,
      confidence: Math.round(confidence * 100),
      reasons,
      metrics: {
        landscapeRatio,
        medianAspectRatio: medianAR,
        medianWordsPerPage: medianWPP,
        medianFontSize: medianFS,
        bulletLineRatio: bulletRatio,
        realBulletRatio,
        worksheetCueHits,
      },
    };
  }

  PDFStudy.classifier = { classifyDocument, median };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.classifier;
  }
})(typeof window !== 'undefined' ? window : globalThis);

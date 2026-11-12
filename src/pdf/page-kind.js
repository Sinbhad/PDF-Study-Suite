/**
 * Deterministic Textbook Page-Kind & Exercise-Region Classifier
 * Tags each parsed page with page.kind in:
 *   'content' | 'exercises' | 'answers' | 'index' | 'toc' | 'front' | 'appendix'
 * and recognizes exercise-region starts, section-opener resets, in-text exercise prompts,
 * and section-opener objective bullets for text-cleaner.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function getNoiseFilter() {
    return (
      PDFStudy.noiseFilter ||
      (typeof require === 'function' ? require('../nlp/noise-filter.js') : null)
    );
  }

  const plainOf = (line) =>
    String((line && (line.cleanText || line.text)) || '')
      .replace(/\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const EXERCISE_START_RE =
    /^(?:(?:[A-Z]|\d+)\.\d+(?:\.\d+)?\s+Exercises|Review\s+Exercises|(?:P\.S\.\s+)?Problem\s+Solving|Chapter\s+\d+\s+(?:Review\s+)?Exercises|Exercises\s+\d+\.\d+)\b(?:\s+See\s+CalcChat\.com\b.*)?$/i;

  const EXERCISE_BANNER_RE =
    /^(?:Review\s+Exercises\s+\d+|\d+\s+Review\s+Exercises|(?:P\.S\.\s+)?Problem\s+Solving\s+\d+|\d+\s+(?:P\.S\.\s+)?Problem\s+Solving)$/i;

  const SECTION_OPENER_RE =
    /^(?:SECTION\s+(?:[A-Z]|\d+)\.\d+|(?:[A-Z]|\d+)\.\d+(?:\.\d+)?\s+[A-Z][A-Za-z]|CHAPTER\s+(?:[A-Z0-9]+|[IVXLCDM]+)\b)/;

  const EXERCISE_INSTRUCTION_RE =
    /^(?:(?:[A-Z][A-Za-z0-9,\s\-–—()'\/]{2,55}\s+)?In\s+Exercises\s+\d+\s*(?:[-–—]|and\s+|through\s+|to\s+)\s*\d+\b|Writing\s+About\s+Concepts\b|True\s+or\s+False\?\s+In\s+Exercises\b|Graphical,\s+Numerical,\s+and\s+Analytic\s+Analysis\b|Think\s+About\s+It\s+In\s+Exercises\b|Conjecture\s+In\s+Exercises\b|HOW\s+DO\s+YOU\s+SEE\s+IT\?)/i;

  const ANSWERS_HEAD_RE =
    /^(?:(?:A\d+\s+)?Answers\s+to\s+(?:Odd-Numbered|Selected|Even-Numbered)?\s*(?:Exercises|Problems)|Answers\s+to\s+(?:Odd-Numbered|Selected)\s+Exercises\s+A\d+|ANSWERS(?:\s+TO\s+EXERCISES)?)$/i;

  const APPENDIX_HEAD_RE =
    /^(?:APPENDI(?:X|CES)\b(?:\s+[A-Z0-9]+\b)?|(?:[A-Z]\s+)?(?:Proofs\s+of\s+Selected\s+Theorems|Integration\s+Tables)|(?:A\d+\s+)?Appendix\s+[A-Z0-9]+\b|Appendix\s+[A-Z0-9]+[:\s].*?\s+A\d+)$/i;

  const INDEX_HEAD_RE = /^(?:(?:I\d+\s+)?INDEX(?:\s+I\d+)?|Subject\s+Index|Author\s+Index)$/i;
  const INDEX_ENTRY_RE = /^[A-Z][A-Za-z0-9\s,'\-()\/]{1,52},\s*(?:A?\d+(?:[-–]\d+)?(?:\s*,\s*A?\d+(?:[-–]\d+)?)*)$/;
  const INDEX_SUB_RE = /^[a-z][A-Za-z0-9\s,'\-()\/]{1,48},\s*\d+(?:[-–]\d+)?/;

  const TOC_HEAD_RE = /^(?:table\s+of\s+contents|brief\s+contents|(?:[ivxlcdm]+\s+)?contents(?:\s+[ivxlcdm]+)?)$/i;
  const FRONT_HEAD_RE =
    /^(?:(?:[ivxlcdm]+\s+)?(?:preface|foreword|dedication|acknowledg(?:e)?ments|about\s+the\s+authors?|to\s+the\s+(?:student|instructor)|additional\s+resources)(?:\s+[ivxlcdm]+)?|copyright\b|all\s+rights\s+reserved|title\s+page|index\s+of\s+applications\b|useful\s+reference|tear\s+out\s+formula\s+cards)/i;
  const REF_SHEET_HEAD_RE =
    /^(?:TRIGONOMETRY|ALGEBRA|GEOMETRY|FORMULAE\s+FROM\s+GEOMETRY|DERIVATIVES\s+AND\s+INTEGRALS)$/i;

  const NUMBERED_PROBLEM_RE = /^(\d{1,3})\.\s+\S/;
  const OBJECTIVE_VERB_RE =
    /^(?:Find|Use|Understand|Evaluate|Determine|Develop|Write|Sketch|Apply|Approximate|Solve|Verify|Identify|Recognize|Calculate|Compare|Graph|Analyze|Integrate|Differentiate|interpret|Estimate|Classify|Compute|Prove|Represent|Convert| Test)\b/;

  function isExerciseStart(plain) {
    return EXERCISE_START_RE.test(plain);
  }

  function isSectionStart(plain, line, bodySize) {
    if (!SECTION_OPENER_RE.test(plain) || EXERCISE_START_RE.test(plain)) return false;
    if (/\s\d{1,4}$/.test(plain) && !/^CHAPTER\s/i.test(plain)) return false; // running header "1.3 ... 59"
    const minSz = Math.max(12.5, (bodySize || 10) * 1.22);
    return Boolean(line && line.fontSize >= minSz);
  }

  function isExerciseInstruction(plain) {
    return EXERCISE_INSTRUCTION_RE.test(plain);
  }

  /**
   * Larson opens every section with 2-7 9pt GillSans-Bold learning-objective bullets directly
   * below the 21pt "N.N Title" banner and above the first 13pt subsection heading.
   */
  function isObjectiveLine(plain, line, bodySize) {
    if (!line || !line.isBold || line.isMargin) return false;
    const sz = line.fontSize || 10;
    const ref = bodySize || 10;
    if (sz > ref * 0.96 || sz < 7) return false;
    return OBJECTIVE_VERB_RE.test(plain) && /\.$/.test(plain) && plain.length <= 125;
  }

  /** Classifies a page object and caches/assigns `page.kind`. */
  function classifyPage(page) {
    if (!page || !Array.isArray(page.lines)) return 'front';
    const h = page.height || 792;
    const lines = page.lines.filter((l) => !l.isMargin);
    if (lines.length === 0) {
      page.kind = 'front';
      return page.kind;
    }

    const texts = lines.map(plainOf).filter(Boolean);
    const topTexts = lines.filter((l) => l.topY <= h * 0.16).map(plainOf).filter(Boolean);
    const nf = getNoiseFilter();
    if (texts.length > 0 && nf && texts.every((t) => nf.isBoilerplate(t))) {
      page.kind = 'front';
      return page.kind;
    }

    // 1. Answers (back-of-book odd-exercise solutions, e.g. Larson A7-A84 / p.776+)
    if (topTexts.some((t) => ANSWERS_HEAD_RE.test(t))) {
      page.kind = 'answers';
      return page.kind;
    }
    const ansCues = texts.filter((t) => /^Section\s+[A-Z0-9]+\.\d+\s*\(page\s+\d+\)/i.test(t)).length;
    if (ansCues >= 1) {
      page.kind = 'answers';
      return page.kind;
    }

    // 2. Index (heading or dense "Term, 366" alphabetized entries)
    if (topTexts.some((t) => INDEX_HEAD_RE.test(t))) {
      page.kind = 'index';
      return page.kind;
    }
    const idxHits = texts.filter((t) => INDEX_ENTRY_RE.test(t) || INDEX_SUB_RE.test(t)).length;
    if (texts.length >= 8 && idxHits / texts.length >= 0.42) {
      page.kind = 'index';
      return page.kind;
    }

    // 3. Table of Contents (before Appendix so TOC pages listing Appendices stay 'toc')
    const tocLines = nf ? texts.filter((t) => nf.isTocLine(t)).length : 0;
    if (
      (topTexts.some((t) => TOC_HEAD_RE.test(t)) && tocLines >= 2) ||
      (texts.length >= 6 && tocLines / texts.length >= 0.35)
    ) {
      page.kind = 'toc';
      return page.kind;
    }

    // 4. Appendix (Proofs of Selected Theorems, Integration Tables, Appendix A/B...)
    if (topTexts.some((t) => APPENDIX_HEAD_RE.test(t) && !/see\s+appendix/i.test(t))) {
      page.kind = 'appendix';
      return page.kind;
    }

    // 5. Front/back reference cards, copyright, preface, cover (before exercises only for explicit front cues)
    if (
      topTexts.some((t) => FRONT_HEAD_RE.test(t)) ||
      texts.some((t) => /^Tear\s+out\s+Formula\s+Cards\b/i.test(t)) ||
      (topTexts.some((t) => REF_SHEET_HEAD_RE.test(t)) &&
        lines.some((l) => l.topY <= h * 0.1 && l.fontSize >= 14 && REF_SHEET_HEAD_RE.test(plainOf(l))))
    ) {
      page.kind = 'front';
      return page.kind;
    }

    // 6. Pure Exercise / Review Exercise / Problem Solving pages
    let exStartIdx = -1;
    let secStartIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const t = plainOf(lines[i]);
      if (exStartIdx < 0 && isExerciseStart(t)) exStartIdx = i;
      if (secStartIdx < 0 && isSectionStart(t, lines[i], 10)) secStartIdx = i;
    }
    if (secStartIdx >= 0 && (exStartIdx < 0 || secStartIdx > exStartIdx)) {
      page.kind = 'content';
      return page.kind;
    }
    if (exStartIdx >= 0) {
      const preBody = lines
        .slice(0, exStartIdx)
        .filter((l) => l.topY >= h * 0.055 && l.topY <= h * 0.95 && (l.wordCount || 0) >= 6);
      if (preBody.length === 0) {
        page.kind = 'exercises';
        return page.kind;
      }
    }
    if (topTexts.some((t) => EXERCISE_BANNER_RE.test(t))) {
      page.kind = 'exercises';
      return page.kind;
    }
    const rawTexts = lines.map((l) => String(l.text || l.cleanText || '').replace(/\*\*/g, '').trim()).filter(Boolean);
    const instrHits = texts.filter((t) => EXERCISE_INSTRUCTION_RE.test(t)).length;
    const probNums = rawTexts
      .map((t) => {
        const m = t.match(NUMBERED_PROBLEM_RE);
        return m ? Number(m[1]) : 0;
      })
      .filter((n) => n > 0);
    const highProbs = probNums.filter((n) => n >= 8).length;
    if ((instrHits >= 1 && probNums.length >= 2) || instrHits >= 2 || (probNums.length >= 5 && highProbs >= 3)) {
      page.kind = 'exercises';
      return page.kind;
    }

    if (nf && nf.isBoilerplatePage(page)) {
      page.kind = 'front';
      return page.kind;
    }

    page.kind = 'content';
    return page.kind;
  }

  PDFStudy.pageKind = {
    classifyPage,
    isExerciseStart,
    isSectionStart,
    isExerciseInstruction,
    isObjectiveLine,
    EXERCISE_START_RE,
    EXERCISE_INSTRUCTION_RE,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.pageKind;
  }
})(typeof window !== 'undefined' ? window : globalThis);

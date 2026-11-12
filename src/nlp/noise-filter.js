/**
 * Publisher-Agnostic Boilerplate & Noise Filter (shared by the PDF cleaner and every NLP engine)
 * Detects copyright / legal / cataloging front matter, TOC dot-leader lines, credits, URLs and
 * exercise-procedural instructions using phrase-level patterns so real prose survives.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Publisher footers stripped inline from every line (Cengage / Larson running footers).
  const STRIP_PATTERNS = [
    /Due\s+to\s+electronic\s+rights[\s\S]{0,220}?(?:suppressed\s+from\s+the\s+eBook\s+and\/or\s+eChapter\(s\)\.?|learning\s+experience\.?)/gi,
    /Editorial\s+review\s+has\s+deemed\s+that\s+any\s+suppressed\s+content\s+does\s+not\s+materially\s+affect\s+the\s+overall\s+learning\s+experience\.?/gi,
    /Cengage\s+Learning\s+reserves\s+the\s+right\s+to\s+remove\s+additional\s+content\s+at\s+any\s+time\s+if\s+subsequent\s+rights\s+restrictions\s+require\s+it\.?/gi,
    /Copyright\s+©?\s*\d{4}\s+Cengage\s+Learning\.?\s*All\s+Rights\s+Reserved\.?/gi,
    /May\s+not\s+be\s+copied,\s+scanned,\s+or\s+duplicated,\s+in\s+whole\s+or\s+in\s+part\.?/gi,
    /978\d{10}\s+[\w\s-]+?\s+Page\s+\d+/gi,
  ];

  // Phrase-level boilerplate: any sentence or line matching one of these never becomes study material.
  const BOILERPLATE_PATTERNS = [
    // Copyright notices & reproduction restrictions
    /©|\(c\)\s*(?:19|20)\d{2}|\bcopyright\s*(?:©|\(c\)|by)?\s*(?:19|20)\d{2}/i,
    /\b(?:all|some)\s+rights\s+reserved\b/i,
    /\bno\s+part\s+of\s+this\s+(?:publication|book|work|text|material|e-?book|product)\b/i,
    /\b(?:may|must|shall)\s+not\s+be\s+(?:reproduced|copied|scanned|duplicated|distributed|transmitted|resold|posted|shared)\b/i,
    /\breproduced,?\s+(?:stored|distributed|transmitted|translated)\b|\bphotocopying,?\s+recording\b/i,
    /\bin\s+any\s+form\s+or\s+by\s+any\s+means\b/i,
    /\bstored\s+in\s+(?:a|any)\s+(?:retrieval|information\s+storage)\s+system\b/i,
    /\bwithout\s+(?:the\s+)?(?:express\s+|prior\s+)*written\s+(?:permission|consent)\b/i,
    /\bpermission\s+(?:of|from)\s+the\s+(?:publisher|copyright\s+(?:owner|holder)|author)\b/i,
    /\bpermission\s+to\s+(?:use|reproduce|reprint)\s+(?:material|this|any|content)\b|\bpermissions?\s+(?:department|requests?|questions)\b/i,
    /\b(?:reprinted|adapted|used)\s+(?:with|by)\s+(?:kind\s+)?permission\b/i,
    /\bunauthori[sz]ed\s+(?:copying|reproduction|use|distribution|duplication)\b/i,
    /\b(?:copy|copying|photocopy(?:ing)?|reproduc(?:e|ing|tion)|duplicat(?:e|ing|ion)|scanning|uploading|distribution|sharing)\s+(?:of\s+)?(?:this|any\s+part\s+of\s+this)\s+(?:text|book|publication|work|material|e-?book|content|document|manual|product)\b/i,
    /\b(?:allowed|permitted|entitled|authori[sz]ed)\s+to\s+(?:copy|reproduce|share|distribute|resell)\s+(?:this|the|any)\s+(?:text|book|publication|work|material|e-?book|content)\b/i,
    /\bunited\s+states\s+copyright\s+act\b|\bsection\s+10[78]\s+of\s+the\b|\bas\s+permitted\s+(?:by|under)\s+(?:u\.?s\.?\s+)?(?:copyright|law)\b/i,
    // Bibliographic & cataloging data
    /\bISBN(?:-1[03])?\b|\bISSN\b|\bLCCN\b|\b97[89](?:[-\s]?\d){9}[\dX]\b/i,
    /\blibrary\s+of\s+congress\s+(?:control\s+number|cataloging|catalog)|\bcatalog(?:u)?ing[-\s]in[-\s]publication\b/i,
    /\b[Pp]rinted\s+(?:and\s+bound\s+)?in\s+(?:the\s+)?(?:United\s+States|U\.?S\.?A?\b|Canada|China|Mexico|India|Singapore|Malaysia|Great\s+Britain|United\s+Kingdom|England|Germany|Japan|Korea)/,
    /\bprinted\s+on\s+(?:acid-free|recycled)\s+paper\b|\bprint\s+(?:number|year)\s*:/i,
    /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\d{1,2}(?:st|nd|rd|th))\s+edition\b/i,
    // Front matter, legal disclaimers, trademarks, licensing
    /\b(?:this\s+page\s+(?:is\s+)?)?intentionally\s+(?:left\s+)?blank\b/i,
    /\b(?:is\s+an?|are)\s+(?:registered\s+)?trademarks?\s+of\b|\btrademarks?\s+(?:used|appearing|referenced)\s+herein\b/i,
    /\bwithout\s+(?:any\s+)?warranty\b|\bmakes?\s+no\s+(?:representations?|warrant(?:y|ies))\b/i,
    /\b(?:author|authors|publisher)\s+(?:shall\s+not|will\s+not|assumes?\s+no|disclaims?|is\s+not\s+responsible)\b/i,
    /\bliable\s+for\s+any\s+(?:special|incidental|consequential|exemplary|damages|loss)\b/i,
    /\bnot\s+for\s+(?:sale|resale)\b|\bnot\s+authori[sz]ed\s+for\s+sale\b/i,
    /\blicensed\s+under\s+(?:a|the)\b|\bcreative\s+commons\s+(?:attribution|license|licence)\b/i,
    // Credits, publisher contact info, URLs, emails
    /\b(?:photo|image|cover|text|art|illustration)\s+credits?\b|\bcover\s+(?:image|photo(?:graph)?|design|art)\s*:/i,
    /\bcourtesy\s+of\b|\b(?:shutterstock|getty\s+images|istock(?:photo)?|alamy|corbis|wikimedia\s+commons)\b/i,
    /^(?:[A-Z][A-Za-z&.]*\s+){0,3}(?:Director|Manager|Editor|Designer|Coordinator|Specialist|Producer|Researcher|Buyer|Analyst)\s*:/,
    /\bfor\s+(?:product\s+information|technology\s+assistance)\b|\bcontact\s+us\s+at\b|\bsubmit\s+all\s+requests\b/i,
    /\b(?:customer|sales)\s+(?:&|and)\s+(?:sales\s+)?support\b|\baccess\s+for\s+free\s+at\b/i,
    /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\.|\b[\w.+-]+@[a-z0-9-]+\.[a-z.]{2,}\b/i,
    /\b(?:visit|see|go\s+to|at)\s+(?:us\s+at\s+)?[a-z0-9-]+\.(?:com|org|edu|net|gov|io)\b/i,
    /\b(?:Pearson\s+Education|McGraw[- ]Hill|John\s+Wiley\s+(?:&|and)\s+Sons|Cengage|Houghton\s+Mifflin|Brooks\/Cole|Prentice[- ]Hall|Addison[- ]Wesley|Macmillan\s+(?:Learning|Publishers|Education)|W\.\s*W\.\s*Norton|Elsevier|Springer(?:-Verlag|\s+Nature)|(?:Oxford|Cambridge)\s+University\s+Press)\b/,
    // Publisher marketing, supplements and acknowledgment lists (preface / resources pages)
    /\b(?:CourseMate|WebAssign|CengageBrain|MyMathLab|MyLab|Mastering(?:Biology|Chemistry|Physics)|companion\s+website|student\s+solutions\s+manual|instructor(?:'|’)?s\s+(?:resource|solutions|manual|edition)|test\s+bank)\b/i,
    /\b(?:we\s+would\s+like\s+to\s+thank|many\s+thanks\s+to|we\s+are\s+(?:grateful|indebted)\s+to|(?:new\s+to\s+)?this\s+edition|previous\s+editions|co-?author\s+[A-Z])/i,
    /(?:College|University)[^.;]{0,80};[^.;]{0,80}(?:College|University)/,
    // Table-of-contents dot leaders ("Limits ........ 47")
    /\.{4,}|(?:\.\s?){5,}\s*$|(?:\.\s?){4,}\s*[ivxlc\d]{1,4}\b|…{2,}|(?:\s·){3,}/i,
    // Cengage / Larson specific
    /\bdue\s+to\s+electronic\s+rights\b|\beditorial\s+review\s+has\s+deemed\b|\bsuppressed\s+content\b|\breserves\s+the\s+right\s+to\s+remove\b|\bLarsonCalculus\.com\b/i,
  ];

  // Exercise / procedural instructions (not legal, but never study content).
  const PROCEDURAL_PATTERNS = [
    /\bin\s+exercises\s+\d+/i,
    /\buse\s+a\s+(?:graphing\s+utility|computer\s+algebra\s+system|graphing\s+calculator)\b/i,
    /\bcomplete\s+the\s+table\b|\bverify\s+your\s+results?\b/i,
    /\bsee\s+(?:figure|fig\.|table)\s+\d+/i,
  ];

  // Single words that disqualify a short term / distractor (never applied to whole sentences).
  const TERM_NOISE_RE =
    /\b(?:copyright|isbn|issn|lccn|publishers?|trademarks?|permissions|edition|cataloging|warranty|cengage|larson|suppressed|editorial)\b/i;
  const STRUCTURAL_WORD_RE =
    /\b(?:figure|table|example|exercises?|solutions?|page|section|chapter|electronic)\b/i;

  // Page-level only signals (density decides, so single words are acceptable here).
  const FRONT_MATTER_LINE_RE =
    /^(?:contents|table\s+of\s+contents|brief\s+contents|detailed\s+contents|copyright|credits|index|dedication|about\s+the\s+authors?)$/i;
  const LEGAL_WORD_RE =
    /\b(?:copyright|permissions?|publisher|reproduced|transmitted|photocopying|retrieval|trademarks?|isbn|edition|printed|cataloging|warranty|warranties|liability|disclaim\w*|imprint)\b/i;
  const ADDRESS_RE = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|\b1-?800-?\d{3}-?\d{4}\b|\b(?:Inc|LLC|Ltd)\.?$/;
  const PRINT_LINE_RE = /^(?:\d{1,2}\s+){4,}\d{1,2}$/;
  const TOC_LINE_RE =
    /^(?:(?:Chapter|CHAPTER|Part|PART|Unit|UNIT|Section|Appendix|APPENDIX)\s+)?[A-Z0-9][^=<>+^|]{0,90}?[A-Za-z]{3,}[^=<>+^|!?]*?(?:\s*(?:\.\s?){2,}\s*|\s+)(?:\d{1,4}|[ivxlc]{1,6})$/;

  function norm(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function stripBoilerplate(text) {
    let cleaned = String(text || '');
    for (const re of STRIP_PATTERNS) cleaned = cleaned.replace(re, ' ');
    return cleaned;
  }

  function isBoilerplate(text) {
    const s = norm(text);
    return s.length > 0 && BOILERPLATE_PATTERNS.some((re) => re.test(s));
  }

  function isProcedural(text) {
    const s = norm(text);
    return PROCEDURAL_PATTERNS.some((re) => re.test(s));
  }

  // STEM garbage (exercise prompts, answer keys, figure/example callouts, biography): src/nlp/stem-noise.js
  const stem = () => PDFStudy.stemNoise || (typeof require === 'function' ? require('./stem-noise.js') : null);
  function isNoise(text) {
    return isBoilerplate(text) || isProcedural(text) || Boolean(stem() && stem().isStemNoise(text));
  }

  /** True for extraction debris (interleaved exercise numbers / equation fragments): < 60% letters. */
  function isGarbled(text) {
    const compact = String(text || '').replace(/\$[^$]*\$/g, 'math').replace(/\s+/g, '');
    if (compact.length < 12) return false;
    return (compact.match(/[A-Za-z]/g) || []).length / compact.length < 0.6;
  }

  function isTermNoise(term) {
    return isNoise(term) || TERM_NOISE_RE.test(norm(term)) || Boolean(stem() && stem().isLabelTerm(term));
  }

  function isDistractorNoise(phrase) {
    return isTermNoise(phrase) || STRUCTURAL_WORD_RE.test(norm(phrase));
  }

  function isTocLine(line) {
    const s = norm(line);
    if (s.length < 4 || s.length > 110 || s.split(' ').length > 14) return false;
    if (/\b(?:is|are|was|were|equals|then)\b/.test(s)) return false;
    return TOC_LINE_RE.test(s);
  }

  function isBoilerplateLine(line) {
    return (
      isBoilerplate(line) ||
      isTocLine(line) ||
      FRONT_MATTER_LINE_RE.test(line) ||
      LEGAL_WORD_RE.test(line) ||
      ADDRESS_RE.test(line) ||
      PRINT_LINE_RE.test(line)
    );
  }

  function collectLines(input) {
    if (!input) return [];
    if (typeof input === 'string') return input.split(/\n+/);
    const page = Array.isArray(input) ? { lines: input } : input;
    const h = page.height || 0;
    return (page.lines || [])
      .filter((l) => typeof l === 'string' || !h || l.topY === undefined || (l.topY >= h * 0.055 && l.topY <= h * 0.935))
      .map((l) => (typeof l === 'string' ? l : l.cleanText || l.text || ''));
  }

  function analyzePage(input) {
    const lines = collectLines(input)
      .map((l) => norm(stripBoilerplate(l)))
      .filter((l) => l.length >= 2 && !/^\d{1,4}$/.test(l));
    if (lines.length === 0) return { score: 0, lineCount: 0 };
    const lineFrac = lines.filter(isBoilerplateLine).length / lines.length;
    // Sentence pass catches legal sentences that wrap across several physical lines. Each hit is
    // capped at 250 chars so an unpunctuated run of equations ending in one stray URL or credit
    // cannot condemn a whole page of real content.
    const joined = norm(stripBoilerplate(lines.join(' '))) || ' ';
    let bpChars = 0;
    for (const s of joined.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)) {
      if (isBoilerplate(s)) bpChars += Math.min(s.length, 250);
    }
    return { score: Math.max(lineFrac, bpChars / joined.length), lineCount: lines.length };
  }

  /** Drops boilerplate / TOC / address / printer-key lines so keyphrase extraction never sees them. */
  function filterText(text) {
    return String(text || '')
      .split('\n')
      .filter((l) => {
        const s = norm(l);
        return !s || !(isNoise(s) || isTocLine(s) || ADDRESS_RE.test(s) || PRINT_LINE_RE.test(s));
      })
      .join('\n');
  }

  /** Fraction (0..1) of a page's (or text's) content that is boilerplate / TOC / front matter. */
  function boilerplateScore(input) {
    return analyzePage(input).score;
  }

  function isBoilerplatePage(input, threshold = 0.45) {
    const { score, lineCount } = analyzePage(input);
    if (lineCount === 0) return false;
    return score >= (lineCount >= 3 ? threshold : 0.99);
  }

  PDFStudy.noiseFilter = {
    STRIP_PATTERNS, BOILERPLATE_PATTERNS, PROCEDURAL_PATTERNS, stripBoilerplate, isBoilerplate, isProcedural,
    isNoise, isGarbled, isTermNoise, isDistractorNoise, isTocLine, filterText, boilerplateScore, isBoilerplatePage,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.noiseFilter;
  }
})(typeof window !== 'undefined' ? window : globalThis);

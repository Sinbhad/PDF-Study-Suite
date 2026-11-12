/**
 * Didactic Heading Recognizer for Textbooks & CS Lecture Slides
 * Recognizes single-line and wrapped 2-line headings across all 10 ratified categories:
 *   Theorem | Definition | Rule | Law | Corollary | Lemma | Algorithm | Formula | Summary | Guideline
 * Rejects margin/inline prose citations such as "Theorem 5.17, see the article...".
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const BULLET_LEAD_RE = /^[\s•▪▸◦‣⁃∙◆◇➢➣➤✦✧❖■□●○\-*+]+/;
  const PROSE_CITATION_RE =
    /\b(?:see\s+(?:the\s+)?(?:article|exercise|section|example|figure|page|appendix)|by\s+theorem|of\s+theorem|apply\s+theorem|given\s+theorem|prove\s+theorem|proves?\s+that|guaranteed?\s+by)\b|^,\s|^that\b/i;

  const NUMBERED_KIND_RE =
    /^(?<kind>THEOREM|COROLLARY|LEMMA|ALGORITHM|LAW)\s+(?<num>[A-Z]?\d+(?:\.\d+)?)\b(?:\s*[:.\-–—]\s*|\s+)?(?<title>[A-Za-z0-9\s,\-()'’\/]{0,75})?$/i;

  const INLINE_STATEMENT_RE =
    /^(?<kind>Theorem|Lemma|Corollary|Definition|Def)\s*:\s*(?<body>.{15,})$/i;

  const DEFINITION_HEADING_RE =
    /^(?<title>(?:Definitions?\s+of|Tests?\s+for)\s+[A-Za-z0-9\s,\-()'’\/]{3,82})$/i;

  const GUIDELINE_HEADING_RE =
    /^(?<title>(?:GUIDELINES?\s+FOR|A\s+Strategy\s+for|Strategies\s+for|Properties\s+of)\s+[A-Za-z0-9\s,\-()'’\/]{3,78})$/i;

  const SUMMARY_HEADING_RE =
    /^(?<title>SUMMARY(?:\s*[:\-–—]\s*|\s+OF\s+)[A-Za-z0-9\s,\-()'’\/]{3,78})$/i;

  const FORMULA_HEADING_RE =
    /^(?<title>(?:Basic|Common|Standard|Special| Fundamental)?\s*(?:Integration|Differentiation|Derivative|Reduction|Trigonometric|Quadratic|Compound\s+Interest|Arc\s+Length|Distance|Midpoint|Change-of-Base)\s+Formulas?(?:\s+for\s+[A-Za-z0-9\s,\-()\/]{2,50})?)$/i;

  const RULE_HEADING_RE =
    /^(?<title>(?:(?:The|Basic|General|Simple)\s+)?(?:Product|Quotient|Chain|Power|Constant(?:\s+Multiple)?|Sum(?:\s+and\s+Difference)?|Difference|L['’]H[oô]pital['’]s|Trapezoidal|Simpson['’]s|Midpoint|Cramer['’]s|Substitution|Log|Differentiation|Integration)\s+Rules?(?:\s+for\s+[A-Za-z0-9\s,\-()'’\/]{2,55})?)$/i;

  const LAW_HEADING_RE =
    /^(?<title>(?:The\s+)?(?:Laws?\s+of\s+[A-Za-z0-9\s,\-()'’\/]{3,60}|(?:De\s+Morgan['’]s|Kepler['’]s|Newton['’]s|Hooke['’]s|Boyle['’]s|Ohm['’]s|Snell['’]s|Cooling)\s+Laws?))$/i;

  const ALGO_SLIDE_RE =
    /^(?<title>Algorithm(?:\s+\d+)?\s*(?::\s*|\s+Pseudocode\b|\s+—\s*)[A-Za-z0-9\s,\-()'’\/]{0,65})$/i;

  const CAP_KIND = {
    theorem: 'Theorem',
    corollary: 'Corollary',
    lemma: 'Lemma',
    algorithm: 'Algorithm',
    law: 'Law',
    definition: 'Definition',
    def: 'Definition',
  };

  function stripWrap(raw) {
    return String(raw || '')
      .replace(/\*\*/g, '')
      .replace(BULLET_LEAD_RE, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Matches a single plain/formatted line as a didactic block heading.
   * When `line` is supplied, enforces bold / non-margin checks so prose mentions never trigger.
   * Returns `{ category, title, inlineBody? }` or null.
   */
  function matchHeading(plain, line, bodySize) {
    if (line && line.isMargin) return null;
    const text = stripWrap(plain);
    if (!text || text.length < 4 || text.length > 160) return null;
    if (PROSE_CITATION_RE.test(text)) return null;

    // Slide-style inline "✦ Lemma: Let our denominations..." / "✦ Def: Let f and g..."
    const inl = text.match(INLINE_STATEMENT_RE);
    if (inl) {
      const category = CAP_KIND[inl.groups.kind.toLowerCase()] || 'Definition';
      return {
        category,
        title: category,
        inlineBody: inl.groups.body.trim(),
      };
    }

    if (!/^[A-Z]/.test(text) || /[.;?]$/.test(text)) return null;
    // Major section / subsection banners (>= 12.2pt over ~10pt body, e.g. 13pt "The Product Rule") are section
    // headers, not inset boxes — unless explicitly titled THEOREM / COROLLARY / LEMMA / ALGORITHM / SUMMARY OF.
    const isExplicitCap = /^(?:THEOREM|COROLLARY|LEMMA|ALGORITHM|SUMMARY\b|GUIDELINES?\s+FOR)\b/i.test(text);
    if (line && bodySize && line.fontSize >= bodySize * 1.18 && line.fontSize < 20 && !isExplicitCap) {
      return null;
    }
    if (line && line.isBold === false && !/^(?:THEOREM|COROLLARY|LEMMA|ALGORITHM|SUMMARY\s+OF|GUIDELINES\s+FOR)\b/.test(text)) {
      return null;
    }

    const numMatch = text.match(NUMBERED_KIND_RE);
    if (numMatch) {
      const kindKey = numMatch.groups.kind.toLowerCase();
      const category = CAP_KIND[kindKey] || 'Theorem';
      const sub = (numMatch.groups.title || '').trim();
      if (sub && (/^[,;:]/.test(sub) || PROSE_CITATION_RE.test(sub))) return null;
      if (line && line.isBold === false && !/^[A-Z]{4,}/.test(numMatch.groups.kind)) return null;
      return {
        category,
        title: sub ? `${category} ${numMatch.groups.num} — ${sub}` : `${category} ${numMatch.groups.num}`,
      };
    }

    const algo = text.match(ALGO_SLIDE_RE);
    if (algo) return { category: 'Algorithm', title: algo.groups.title.trim() };

    const def = text.match(DEFINITION_HEADING_RE);
    if (def) return { category: 'Definition', title: def.groups.title.trim() };

    const sum = text.match(SUMMARY_HEADING_RE);
    if (sum) return { category: 'Summary', title: sum.groups.title.trim() };

    const guide = text.match(GUIDELINE_HEADING_RE);
    if (guide) return { category: 'Guideline', title: guide.groups.title.trim() };

    const form = text.match(FORMULA_HEADING_RE);
    if (form) return { category: 'Formula', title: form.groups.title.trim() };

    const law = text.match(LAW_HEADING_RE);
    if (law) return { category: 'Law', title: law.groups.title.trim() };

    const rule = text.match(RULE_HEADING_RE);
    if (rule) return { category: 'Rule', title: rule.groups.title.trim() };

    return null;
  }

  /**
   * Checks whether `nextLine` is the 2nd line of a wrapped bold box heading
   * (e.g. "THEOREM 5.17 Integrals Involving Inverse Trigonometric" + "Functions",
   * or "GUIDELINES FOR USING THE FUNDAMENTAL THEOREM OF" + "CALCULUS").
   */
  function matchWrappedContinuation(heading, headLine, nextLine, nextPlain) {
    if (!heading || heading.inlineBody || !headLine || !nextLine) return null;
    if (!nextLine.isBold || nextLine.isMargin || nextLine.hasMath) return null;
    if (Math.abs((nextLine.fontSize || 10) - (headLine.fontSize || 10)) > 1.2) return null;
    const vGap = (nextLine.topY || 0) - (headLine.bottomY || 0);
    if (vGap < -3 || vGap > Math.max(6, (headLine.fontSize || 10) * 0.55)) return null;
    const cont = stripWrap(nextPlain);
    if (!cont || cont.length > 55 || /[.:;?!]$/.test(cont)) return null;
    if (!/^[A-Z(]/.test(cont) || /^\d+[.)]/.test(cont)) return null;
    // Must not start a fresh sentence ("Let u be...", "If f is...", "For the...", "Suppose...")
    if (/^(?:Let|If|For|When|Suppose|Assume|Given|Consider|Proof|Solution|Example|Try|To|The\s+(?:derivative|product|quotient|limit|sum|integral|function))\b/i.test(cont)) {
      return null;
    }
    const headEndsPreposition = /\b(?:of|for|in|on|with|to|by|and|or|from|involving|using)\s*$/i.test(heading.title);
    const allCapsPair = /^[A-Z0-9\s,\-()\/]+$/.test(cont) && /[A-Z]{3}/.test(heading.title);
    const shortTail = cont.split(/\s+/).length <= 3 && (headLine.text || '').length >= 38;
    if (!headEndsPreposition && !allCapsPair && !shortTail) return null;
    return `${heading.title} ${cont}`.replace(/\s+/g, ' ').trim();
  }

  PDFStudy.blockHeadings = { matchHeading, matchWrappedContinuation, stripWrap };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.blockHeadings;
  }
})(typeof window !== 'undefined' ? window : globalThis);

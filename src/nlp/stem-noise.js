/**
 * STEM Garbage Gate: exercise prompts, answer keys, figure/example callouts, dangling-pronoun
 * fragments, biographical sidelines, structural labels ("Solution", "Proof", "Example 2") and orphan
 * formula fragments never become flashcards, quiz stems/options, summaries or test items.
 * Math spans ($...$) are masked first so their content never trips a prose rule.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const mt = () => PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);

  const IMPERATIVE =
    'Find|Evaluate|Compute|Determine|Calculate|Sketch|Graph|Prove|Verify|Solve|Differentiate|Integrate|Simplify|' +
    'Approximate|Estimate|Explain|Describe|Discuss|Identify|Complete|Rewrite|Write|Express|Classify|Analyze|' +
    'Implement|Trace|Draw|Construct|Give|List|Name|State|Justify|Compare|Plot|Decide|Test|Apply|Locate|Match|Answer|' +
    'Understand|Develop|Recognize|Use\\s+(?!of\\b)';
  const EXERCISE_RES = [
    new RegExp(`^(?:\\(?[a-z0-9]{1,3}[.)]\\s*)?(?:${IMPERATIVE})\\b`), // "Find the derivative", "15. Evaluate ..."
    /^(?:\(?[a-z0-9]{1,3}[.)]\s*)?(?:Show|Use|Let|Suppose|Assume|Consider)\b.*\b(?:find|show|prove|evaluate|determine|compute|verify)\b/i,
    /\bin\s+exercises?\s+\d+|\bproblem\s+\d+\.\s*\(\d+\s*points?\)/i,
    /^(?:review\s+)?exercises?\b|^problems?\s+(?:set\s+)?\d|^homework\b|^(?:hw|quiz|exam|midterm|final)\s*#?\d/i,
    /^\d{1,3}[.)]\s+(?:X\b|\$|lim\b|∫|\\int|\\lim|[a-zA-Z]\s*\(|[a-z]\s*=|y\s*=|\(?[-−]?\d)/, // "15. lim ...", "7. f(x) = ..."
    /\b(?:write\s+your\s+answer|round\s+(?:your\s+answer|to\s+(?:the\s+nearest|\w+\s+decimal))|show\s+your\s+work|graphing\s+utility|computer\s+algebra\s+system)\b/i,
    /\b(?:true\s+or\s+false\?|fill\s+in\s+the\s+blank|multiple\s+choice)\b/i,
  ];
  const ANSWER_KEY_RES = [
    /\banswers?\s+to\s+(?:odd|even|selected|all)\b|\bodd-numbered\b|\bsolutions?\s+to\s+(?:odd|even|selected)\b/i,
    /^(?:\d{1,3}\.\s+(?:[-−]?\d|\$|[a-z]\s*=)[^A-Za-z]{0,30}){2,}/, // "1. 3  3. -2  5. x = 4"
    /^(?:answer|ans)\s*[:.]|\bsample\s+answers?\b|\banswers?\s+will\s+vary\b/i,
    /\s\d{1,3}\.\s*$/, // glued trailing exercise number ("... at x = 2 41.")
  ];
  const CALLOUT_RES = [
    /\b(?:Figure|Fig\.|Table)\s*[A-Z]?\d|\bExample\s+\d+\b(?!\.)/i,
    /\b(?:as\s+(?:shown|seen|illustrated|indicated|discussed)\s+in|see|refer\s+to|shown\s+in)\s+(?:Exercise|Exercises|Section|Appendix|Chapter|Theorem)\s+[A-Z]?\d+(?:\.\d+)*/i,
    /^(?:Figure|Fig\.|Table|Example|Exploration|Check|Solution|Proof|Remark|Note)\s*[A-Z]?\d*(?:\.\d+)*\s*[:.]/i,
    /\b(?:the\s+(?:figure|graph|table)\s+(?:above|below|at\s+the\s+(?:left|right))|in\s+the\s+(?:figure|graph|margin))\b/i,
    /\bas\s+(?:shown|listed|indicated|illustrated|given|summarized)(?:\s+in\s+[^.]{1,45})?\s+(?:above|below)\b|\b(?:definition|theorem|table|list|diagram|graph|notation|formula)\s+(?:shown\s+)?(?:above|below)\b/i,
    /\bthis\s+(?:example|exercise|figure|table|exploration)\b/i,
  ];
  const BIO_RES = [
    /\(\s*1[5-9]\d\d\s*[–—-]\s*(?:1[5-9]\d\d|20\d\d)\s*\)/, // "(1646–1716)"
    /\b(?:was\s+born|died\s+in|named\s+after\s+[A-Z]|his\s+(?:father|mother|life|wife)|her\s+(?:father|mother|life|husband)|biograph\w*|historical\s+note)\b/i,
  ];
  const DANGLING_RE =
    /^(?:This|These|That|Those|It|Its|They|Their|Such|Therefore|Thus|Hence|So|Then|Here|Also|Similarly|Likewise|Consequently|Furthermore|Moreover|However|Again|Now|Next|Finally|Notice|Note|Recall|Clearly|Obviously|With\s+the\s+help\s+of\s+this\b|(?:The|This)\s+(?:theorem|definition|lemma|corollary|rule|law|result|equation|formula)\s+(?:says|states|tells|shows|implies)\b|In\s+(?:this|that|such|other|either|both|the\s+(?:above|previous|next))\b|For\s+(?:this|that|example|instance)\b|On\s+the\s+other\s+hand|As\s+a\s+result|Because\s+of\s+this)\b|\b(?:none|all|both|each)\s+of\s+the\s+(?:two|three|four|five)\s+(?:conditions|properties|cases|steps)\b/i;
  const LABEL_WORDS =
    'Solution|Solutions|Proof|Remark|Remarks|Note|Notes|Check|Checkpoint|Exploration|Example|Examples|Step|Steps|' +
    'Theorem|Definition|Def|Defs|Rule|Rules|Lemma|Corollary|Proposition|Figure|Table|Exercise|Exercises|Answer|Answers|Hint|Summary|' +
    'Review|Section|Chapter|Technology|Study\\s+Tip|Caution|Warning|Important|Key|Objectives?|Algorithm|Case|Part|' +
    'Problem|Problems|Question|Questions|Introduction|Conclusion|Applications?|Concept\\s+Check|Writing\\s+About\\s+Concepts|' +
    'Base\\s+Cases?|Inductive\\s+(?:Step|Hypothesis)|Sample\\s+Answers?|Homework|Name|Points?|The|What|Which|How|Why|Given';
  const LABEL_RE = new RegExp(`^(?:${LABEL_WORDS})(?:\\s+(?:[A-Z]|\\d+)(?:\\.\\d+)*[a-z]?)?\\s*[.:]?$`, 'i');

  const prose = (s) => {
    const m = mt();
    return m ? m.mask(String(s || '')).text.replace(/\u27E6M\d+\u27E7/g, 'X') : String(s || '');
  };

  function isExercisePrompt(text) {
    const s = prose(text).trim();
    return EXERCISE_RES.some((re) => re.test(s));
  }
  function isAnswerKey(text) {
    const s = prose(text).trim();
    return ANSWER_KEY_RES.some((re) => re.test(s));
  }
  function isCallout(text) {
    const s = prose(text).trim();
    return CALLOUT_RES.some((re) => re.test(s));
  }
  function isBiographical(text) {
    return BIO_RES.some((re) => re.test(String(text || '')));
  }
  /** Sentence opens with a pronoun / connective that needs the previous sentence ("This means that..."). */
  function isDangling(text) {
    return DANGLING_RE.test(String(text || '').replace(/^\*\*|\*\*$/g, '').trim());
  }
  const INCOMPLETE_TAIL_RE =
    /\b(?:the|a|an|and|or|then|of|in|into|on|to|for|with|by|at|from|as|is|are|be|that|which|when|where|called\s+the|into\s+X)\s*[.,;:]?\s*$/i;

  /** Orphan fragments: lowercase start, unbalanced $/{}/(), trailing operator/connector, or axis-label runs. */
  function isFragment(text) {
    const raw = String(text || '').trim();
    const s = prose(raw).trim(); // "$f$ is continuous" -> "X is continuous"
    if (!s) return true;
    if (/^[a-z]/.test(s) && !/^(?:e\.g|i\.e)/.test(s)) return true;
    if (/(?:[=+\-−×*/^,(]|\\(?:frac|cdot|times))\s*$/.test(s) || INCOMPLETE_TAIL_RE.test(s)) return true;
    if (/(?:\bX\s+){3,}/.test(s) || /\([a-f]\)\s*[A-Za-z$]/.test(raw)) return true; // "$y$ $x$ $-\pi$ $-3$" axis debris
    const m = mt();
    return m ? !m.isBalanced(raw) : false;
  }

  /** Section-level Answer Key detector (e.g. back-of-book odd-numbered exercise answers). */
  function isAnswerKeySection(text) {
    const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 6) return false;
    const numbered = lines.filter((l) => /^(?:\d{1,3}\.|\([a-f]\))\s/.test(l)).length;
    const markers = (String(text || '').match(/\b(?:Answers?\s+will\s+vary|Sample\s+answers?|Section\s+\d+\.\d+\s*\(page|\bProof\s*$)/gim) || []).length;
    return (numbered >= 8 && numbered / lines.length >= 0.22) || (markers >= 2 && numbered >= 5);
  }

  /** Line/sentence-safe STEM noise: exercises, answer keys, figure/example callouts, biography. */
  function isStemNoise(text) {
    return isExercisePrompt(text) || isAnswerKey(text) || isCallout(text) || isBiographical(text);
  }

  /** Never a flashcard front / quiz answer: structural labels, bare numbered heads, single variables. */
  function isLabelTerm(term) {
    const t = String(term || '').replace(/[*_]/g, '').trim();
    if (!t) return true;
    if (LABEL_RE.test(t) || /^(?:first|second|third)\s+forms?$/i.test(t)) return true;
    if (/^(?:Theorem|Definition|Lemma|Corollary|Example|Exercise|Figure|Table|Algorithm)\s+[A-Z]?\d+(?:\.\d+)*\s*$/i.test(t)) return true;
    if (/^\$?[A-Za-z]\$?$|^\$?[A-Za-z]_?\{?\d*\}?\$?$/.test(t)) return true; // "x", "$v$", "a_1"
    if (/^(?:Step|Case|Part)\s+\w+\b/i.test(t) || /\s\d+$/.test(t)) return true; // "Step 1", "Dutchess 4"
    if (/^[\d\s.,()+\-−=]+$/.test(t)) return true;
    if (/^[A-Z]{2,5}\s*\d{3,4}[A-Z]?$|^(?:Fall|Spring|Summer|Winter)\s+\d{4}$/.test(t)) return true; // "CSCI 2226", "Fall 2026"
    if (/\b(?:a|an|the|of|on|in|to|for|with|at|by|from|into|and|or|is|are|be)$/i.test(t)) return true; // "Differentiable on an"
    return isStemNoise(t);
  }

  /** Full gate for a standalone study sentence (quiz stem source, summary pick, definition back). */
  function isUnusableSentence(text) {
    const s = String(text || '').trim();
    if (/^\(|\bTHEOREM\s+[A-Z0-9]+\.\d|\bSections?\s+\d+\.\d+|\s[a-h]\.\s*$/i.test(s)) return true;
    if (/(?:\bPosition\s+function\b.*\bVelocity\s+function\b)/i.test(s)) return true;
    if (/\b(?!(?:vs|al|cf|etc|approx|resp)\.)[a-z]{2,}\.\s+[a-z]{2,}\b/.test(prose(s))) return true; // "a power. series"
    return isStemNoise(s) || isDangling(s) || isFragment(s) || /\?\s*$/.test(s);
  }

  const api = {
    isExercisePrompt, isAnswerKey, isAnswerKeySection, isCallout, isBiographical, isDangling, isFragment,
    isStemNoise, isLabelTerm, isUnusableSentence,
  };
  PDFStudy.stemNoise = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

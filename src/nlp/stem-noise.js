/**
 * STEM Garbage Gate: exercise prompts, answer keys, figure/example callouts, dangling-pronoun
 * fragments, biographical sidelines, structural labels ("Solution", "Proof", "Example 2") and orphan
 * formula fragments never become flashcards, quiz stems/options, summaries or test items.
 * hasUnresolvedReference is the stricter check for a statement shown alone as a quiz stem or option.
 * Math spans ($...$) are masked first so their content never trips a prose rule.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const mt = () => PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);

  const IMPERATIVE =
    'Find|Evaluate|Compute|Determine|Calculate|Sketch|Graph(?=\\s+(?:the|a|an|each|both|X|y|f)\\b)|Prove|Verify|Solve|Differentiate|Integrate|Simplify|' +
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
    /(?:\d|[=)\]}]|X)\s+\d{1,3}\.\s*$/, // glued trailing exercise number ("... at x = 2 41."), not "has length 10."
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
    'Review|Section|Chapter|Technology|Study\\s+Tip|Caution|Warning|Important|Key\\s+(?:Ideas?|Points?|Concepts?|Terms?)|Objectives?|Algorithm|Case|Part|' +
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

  const POINTS_OUTSIDE_RE = new RegExp([
    '\\b(?:as|see|shown|given|listed|described|mentioned|discussed|noted|defined|stated|the)\\s+(?:above|below)\\b',
    '\\b(?:tables?|figures?|diagrams?|lists?|examples?|equations?|graphs?|charts?|steps?)\\s+(?:above|below)\\b',
    '\\bthe\\s+following\\b',
    '\\bas\\s+(?:shown|follows)\\b',
    '\\bshown\\s+(?:in|here)\\b',
    '\\b(?:arrows?|arrowheads?|asterisks?|circled|pictured|inset)\\b',
    '\\b(?:Sections?|Chapters?|Figures?|Fig\\.|Tables?|Examples?|Appendix|Equations?|Eq\\.)\\s+[A-Z]?\\d',
    '^As\\s+(?:stated|noted|mentioned|discussed|described|explained|seen|before|we\\s+(?:saw|said|have\\s+seen))\\b',
  ].join('|'), 'i');
  // "Alternatively, ...", "Otherwise ...", "In addition, ...": the line continues one the reader does not see.
  const DISCOURSE_LINK_RE = /^(?:alternatively|otherwise|instead|conversely|likewise|similarly|additionally|furthermore|moreover|however|therefore|thus|hence|also|in\s+addition|on\s+the\s+other\s+hand|in\s+contrast)\b/i;
  /** A quiz statement that opens on a link to the line before it ("Alternatively, ~25% ..."). */
  const opensOnLink = (text) => DISCOURSE_LINK_RE.test(String(text || '').trim());
  const DEMONSTRATIVE_RE = /\b(?:this|these|those)\b|\bsuch\s+(?!as\b|that\b)/i;
  const THAT_NOUN_RE =
    /(?:^|\b(?:in|of|at|for|by|from|with|on|to|during|after|before|under)\s+)that\s+(?!is\b|are\b|was\b|were\b|has\b|have\b|can\b|may\b|will\b|the\b|an?\b)[a-z]{3,}/i;
  // "A very small one improves ...": "one" as the subject stands for a noun of the sentence before.
  const OPENING_ONE_RE = /^(?:A|An|The)\s+(?:[a-z-]+\s+){0,2}ones?(?![\w-])(?!\s+of\b)/;
  const PRONOUN_RE = /\b(?:it|they|them|its|their)\b/i;
  const NOT_A_NOUN = new Set(('a an the and or but nor so yet if when while whereas because although though unless ' +
    'until since whether of in on at by for from with to into onto over under between among through during ' +
    'before after about against across along around per via within without than as is are was were be been ' +
    'being has have had do does did can could will would shall should may might must not very only often ' +
    'usually always never also then thus hence however therefore there here who whom whose which what').split(' '));

  // An unqualified plural definite noun at sentence start ("The circuits are ...", "The storage elements are ...")
  // refers back to specific elements just introduced in context, unlike a bare generic plural ("Logic gates are ...").
  const PLURAL_THE_SUBJECT_RE =
    /^The\s+((?:[a-z][a-z-]*\s+){0,2}[a-z]{2,}(?:s|es|ies))\s+(?:are|were|have|can|may|might|must|will|shall|should|do|did|remain|become|contain|include|use|need|require|represent|store|hold|operate|perform)\b/;
  const QUALIFIER_WORD_RE = /\b(?:of|in|on|for|from|with|by|at|between|that|which|where|whose)\b|^(?:following|same|other)\b/i;

  function isAnaphoricPluralDefinite(s) {
    const m = s.match(PLURAL_THE_SUBJECT_RE);
    if (!m || QUALIFIER_WORD_RE.test(m[1])) return false;
    const last = m[1].trim().split(/\s+/).pop().toLowerCase();
    return !/(?:ss|us|is|ics|gas)$/.test(last);
  }

  /**
   * True when a statement shown on its own points at something the reader cannot see: "the table below",
   * "this process", "such cells", "in that case", an arrow in a picture, or "it"/"they" with no noun
   * before it in the same statement. Stricter than isDangling, which only reads the first word.
   */
  function hasUnresolvedReference(text) {
    const s = prose(String(text || '').replace(/\*\*|__/g, '')).trim();
    if (POINTS_OUTSIDE_RE.test(s) || DEMONSTRATIVE_RE.test(s) || THAT_NOUN_RE.test(s) || OPENING_ONE_RE.test(s)) return true;
    if (isAnaphoricPluralDefinite(s)) return true;
    const pronoun = s.match(PRONOUN_RE);
    if (!pronoun) return false;
    // "It is clear that ..." / "It follows that ...": an expletive, not a reference.
    if (/^it\s+(?:follows|is\s+\w+\s+(?:to|that))\b/i.test(s.slice(pronoun.index))) return false;
    const before = s.slice(0, pronoun.index).match(/[A-Za-z][A-Za-z'’-]*/g) || [];
    return !before.some((w) => w === 'X' || (w.length >= 3 && !NOT_A_NOUN.has(w.toLowerCase()) && !/ly$/i.test(w)));
  }

  /** Full gate for a standalone study sentence (quiz stem source, summary pick, definition back). */
  function isUnusableSentence(text) {
    const s = String(text || '').trim();
    if (/^\(|\bTHEOREM\s+[A-Z0-9]+\.\d|\bSections?\s+\d+\.\d+|\s[a-h]\.\s*$/i.test(s)) return true;
    if (/(?:\bPosition\s+function\b.*\bVelocity\s+function\b)/i.test(s)) return true;
    if (/\b(?!(?:vs|al|cf|etc|approx|resp)\.)[a-z]{2,}\.\s+[a-z]{2,}\b/.test(prose(s))) return true; // "a power. series"
    return isStemNoise(s) || isDangling(s) || isFragment(s) || /\?\s*$/.test(s);
  }

  // Extraction left-overs a question must not show (quiz and test only; isUnusableSentence stays the shared gate).
  // A line-break hyphen kept ("tab char- acters", "rela- tion"), told from a dash after a label ("signs- let it run")
  // by the scope printing the joined word, or else by a word ending left on the second line.
  const SPLIT_WORD_RE = /\b([a-z]{2,})-\s+([a-z]{2,})\b/g;
  // A short second half that is only a word ending ("tion", "dency", "ments"): the rest of a split word.
  const WORD_ENDING_RE = /^[a-z]{0,3}(?:tion|sion|ment|ness|ing|ity|itie|ally|ence|ance|able|ible|ure|ous|ive|ated|ating|ized|ised|ency|ical|ular|ology)s?$/;
  const MAX_ENDING_CHARS = 7;
  function hasSplitWord(text, isWord) {
    for (const [, a, b] of String(text || '').matchAll(SPLIT_WORD_RE)) {
      if ((isWord && isWord(a + b)) || (b.length <= MAX_ENDING_CHARS && WORD_ENDING_RE.test(b))) return true;
    }
    // "Tion are called ...", "a run-time excep tion": the second half of a word split at a break, standing alone.
    const first = (String(text || '').match(/^\s*([A-Za-z]+)\b/) || [])[1] || '';
    if (first.length <= 4 && WORD_ENDING_RE.test(first.toLowerCase()) && !(isWord && isWord(first.toLowerCase()))) return true;
    return /\b[a-z]{2,}\s+(?:tion|tions|sion|sions|ment|ments|ities)\b/.test(String(text || ''));
  }
  const DEBRIS_RES = [
    /^(?:[A-Z]{2,}[,:]?\s+)+(?:AND\s+|OR\s+)?[A-Z]{2,}\s+[A-Z][a-z]/, // a run-in heading: "CONVERSE, ... AND INVERSE We can"
    /(?:^|\s)([A-Z0-9][^\s,:;]*[/A-Z0-9][^\s,:;]*)\s+\1(?=[\s,:;.]|$)/, // a cell printed twice: "DK/NF DK/NF"
    /[a-z,]\s+You\s+[a-z]/, // a table cell glued to the next one: "Error You cannot"
  ];
  const PROSE_PAIR_RE = /\b(?:is|in|it|the|and|of|if|then|for|are)\s+(?:is|in|it|the|and|of|if|then|for|are)\b/;
  // Inside math a bare word of three letters or more that is no command ("\log") and no function name is prose
  // swallowed by the formula ("$p\oplus q(orp$", "$Sis a$"), as is a bare "is", "the" or "and".
  const MATH_FUNCTION_RE = /^(?:sin|cos|tan|sec|csc|cot|log|ln|exp|max|min|mod|gcd|lcm|lim|det|deg|dim|ker|sup|inf|arg|sgn)$/i;
  const MATH_TEXT_RE = /\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf|mathtt|textbf|textit)\s*\{[^}]*\}/g;
  function proseInMath(part) {
    const body = part.replace(MATH_TEXT_RE, ' ');
    if (PROSE_PAIR_RE.test(body) || /(?:^|[^\\A-Za-z])(?:is|are|the|and|then|where)(?![A-Za-z])/.test(body)) return true;
    return (body.match(/(?:^|[^\\A-Za-z])[A-Za-z]{3,}/g) || []).map((w) => w.replace(/^[^A-Za-z]/, '')).some((w) => !MATH_FUNCTION_RE.test(w));
  }
  /** Prose read as math: "$it is in 1NF$", "$Sis a$": a $...$ span holds running words. */
  const wordsInMath = (text) => String(text || '').split('$').some((part, i) => i % 2 === 1 && proseInMath(part));
  // A worked example's own talk: "if we assign the product to ...", "In the earlier example, ...", "values[i]".
  const EXAMPLE_TALK_RE =
    /\b(?:if|suppose)\s+we\b|\bwe\s+(?:would|could|might)\b|\b(?:in|from)\s+(?:the|this|that|our)\s+(?:(?:earlier|previous|last|above|first|second|next)\s+)?example\b|\b[A-Za-z_]\w*\[[^\]\s]{1,8}\]/i;
  // "THE EMPTY SET There is a special set ...": a run-in heading set in capitals before the sentence.
  const RUN_IN_HEADING_RE = /^(?:[A-Z][A-Z'’-]+[,:]?\s+)*[A-Z][A-Z'’-]+[,:]?\s+(?=[A-Z][a-z])/;

  /** The sentence without a run-in heading in capitals ("NAIVE SET THEORY Note that ..." -> "Note that ..."). */
  function stripRunInHeading(text) {
    const s = String(text || '');
    const m = s.match(RUN_IN_HEADING_RE);
    // Two capitalised words at least: "PCR Testing is ..." keeps its acronym.
    return m && m[0].trim().split(/\s+/).length >= 2 ? s.slice(m[0].length) : s;
  }

  /**
   * Does the text carry extraction debris (a kept line-break hyphen, a run-in heading, a doubled cell, words read
   * as math)? isWord (optional): does the scope print this word, to recognise "char- acters" as "characters".
   */
  const hasExtractionDebris = (text, isWord) => DEBRIS_RES.some((re) => re.test(String(text || ''))) || wordsInMath(text) || hasSplitWord(text, isWord);
  /** Does the sentence narrate a worked example rather than state a fact? */
  const isExampleTalk = (text) => EXAMPLE_TALK_RE.test(String(text || ''));

  const api = {
    isExercisePrompt, isAnswerKey, isAnswerKeySection, isCallout, isBiographical, isDangling, isFragment,
    isStemNoise, isLabelTerm, isUnusableSentence, hasUnresolvedReference, hasExtractionDebris, isExampleTalk, stripRunInHeading,
    opensOnLink,
  };
  PDFStudy.stemNoise = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

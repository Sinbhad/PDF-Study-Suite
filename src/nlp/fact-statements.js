/**
 * Fact Statements: whether a piece of text can be shown to a student as a statement, a point about a
 * subject, a definition, or a term. quiz-facts.js builds facts only from text these accept.
 *   isStandalone(text)       a statement that stands alone as a stem or an option: complete, no pointer
 *                            outside itself, no filler (quiz-content.js), no glued fragment or example value
 *   isPointStatement(text)   a point that says something about its subject (a verb or a relation), not a
 *                            list of names, a table cell, a heading (with or without a remark) or a remark
 *                            that leans on a subject it does not name ("Great for ...", "Less volume needed")
 *   isDefinitionText(text)   a definition, not a ranking, an acronym's expansion or two labels glued together
 *   isNameable(term, max)    a term short and plain enough to be asked for or offered
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');
  const nf = () => dep('noiseFilter', './noise-filter.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const content = () => dep('quizContent', './quiz-content.js');

  const MAX_STATEMENT_CHARS = 240;
  const MIN_STATEMENT_CHARS = 20;
  const MAX_TERM_WORDS = 10;

  /** Mostly capitals: a reminder shouted on a slide ("LAB WILL HAVE LIVE COWS"), not a fact. */
  function isShouted(text) {
    const letters = mt().mask(String(text || '')).text.replace(/[^A-Za-z]/g, '');
    return letters.length > 0 && letters.replace(/[^A-Z]/g, '').length > letters.length * 0.4;
  }

  /** Several note lines glued into one ("sp2 - 3 domains sp - 2 domains ..."): a block, not a statement. */
  function isRunTogether(text) {
    const outsideMath = mt().mask(String(text || '')).text;
    return (outsideMath.match(/\s(?:-|=|->|→)\s/g) || []).length >= 2;
  }

  // "(here, 10)": the value of one example. "active. in brain": a stray fragment glued after a full stop
  // (abbreviations such as "spp." and "e.g." excepted). "A fact that ...": a definition whose genus says nothing.
  const DANGLING_HERE_RE = /\(\s*here\b|\bhere,\s/i;
  const GLUED_SENTENCE_RE = /\b(?!(?:spp|sp|ssp|vs|al|cf|etc|approx|resp|ca|no|fig|eq|var|e\.g|i\.e)\.)[a-z]{2,}\.\s+[a-z]{2,}\b/;
  const VAGUE_GENUS_RE = /^(?:A|An|The)\s+(?:fact|thing|way|something|situation|matter)\b/;

  // Two lines run together: a new capitalised start glued after a lower-case word, twice
  // ("Isolated from all other groups Twice daily temperature checks If fever, ...").
  // ("Warm, dry, isolated area Soft palatable feeds NSAIDS as indicated": the second start may be an acronym.)
  const RUN_ON_RE = /[a-z]{3,}\s+[A-Z][a-z]+\b.*[a-z]{3,}\s+[A-Z][A-Za-z]+\b/;

  /** A statement that can stand alone as a stem or an option. */
  function isStandalone(statement) {
    const s = String(statement || '').trim();
    if (RUN_ON_RE.test(s.replace(/\$[^$]*\$/g, ' '))) return false;
    if (s.length < MIN_STATEMENT_CHARS || s.length > MAX_STATEMENT_CHARS) return false;
    if (/\n|[•▪◦]|\?\s*$|:\s*$/.test(s) || (s.match(/[A-Za-z]{2,}/g) || []).length < 4) return false;
    if (isShouted(s) || isRunTogether(s)) return false;
    if (!mt().isBalanced(s) || sn().isFragment(s) || sn().isStemNoise(s)) return false;
    if (sn().hasUnresolvedReference(s) || sn().opensOnLink(s) || content().isFillerText(s) || sn().hasExtractionDebris(s)) return false;
    if (DANGLING_HERE_RE.test(s) || GLUED_SENTENCE_RE.test(s) || VAGUE_GENUS_RE.test(s)) return false;
    return !(nf() && (nf().isNoise(s) || nf().isGarbled(s)));
  }

  // Words that make a line say something: a verb, or a preposition or conjunction relating two things.
  const PREDICATE_WORD_RE = /\b(?:is|are|was|were|be|been|being|has|have|had|can|cannot|may|might|must|will|would|should|does|do|did|not|no|of|in|on|at|by|for|from|with|to|into|than|as|and|or|via|after|before|during|without|against|through|between|within|due|because|if|when|while)\b/;
  const LEADING_FUNCTION_WORD_RE = /^(?:of|in|on|at|by|for|from|with|to|into|than|as|and|or|via|but)\b/i;
  const MIN_POINT_VALUE_WORDS = 3;

  /**
   * A point about a subject must say something: a bare list of names ("Sheep, Humans Rodents"), a table
   * cell ("Fasciola hepatica Snail, Salmonid") or a heading with a remark ("Indications (labeled ...)")
   * says nothing a student can be asked. A "Label: value" point needs a value of at least three words
   * that does not open in the middle of a phrase ("Distribution Blood saturation: of drug blood").
   */
  function isPointStatement(statement) {
    const s = String(statement || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!PREDICATE_WORD_RE.test(s.toLowerCase())) return false;
    if (isHeadingLine(s) || isSubjectlessRemark(s)) return false;
    const label = s.match(/^([^:]{2,60}):\s+(.+)$/);
    if (label) {
      const value = label[2].trim();
      if (value.split(/\s+/).length < MIN_POINT_VALUE_WORDS || /^[a-z]/.test(value) || LEADING_FUNCTION_WORD_RE.test(value)) return false;
    }
    return !subjects().isGenericHeading(s);
  }

  // "Proximal and Distal Paravertebrals": every content word capitalised and no verb — a heading, not a claim.
  const HEADING_VERB_RE = /\b(?:is|are|was|were|has|have|can|cannot|may|must|should|will|does|do|causes?|leads?|results?)\b/i;
  const MIN_HEADING_WORDS = 2;
  function isHeadingLine(s) {
    const long = s.replace(/\$[^$]*\$/g, ' ').match(/[A-Za-z][A-Za-z'’-]{3,}/g) || [];
    return long.length >= MIN_HEADING_WORDS && long.every((w) => /^[A-Z]/.test(w)) && !HEADING_VERB_RE.test(s);
  }

  // A remark that leans on a subject it does not name: "Great for abscesses, pneumothorax" (great what?), "Less
  // volume of lidocaine needed" (less than what?), "Screening to identify carriers" (a heading of a to-do list).
  const EVALUATIVE_OPENER_RE = /^(?:great|good|better|best|ideal|useful|excellent|poor|bad|worse|worst|helpful|preferred|nice)\s+(?:for|at|in|to|with|when|if)\b/i;
  const BARE_COMPARATIVE_RE = /^(?:less|more|fewer|greater|lower|higher|better|worse|smaller|larger|shorter|longer)\b/i;
  const GERUND_OPENER_RE = /^[A-Z][a-z]+ing\b/;
  const MAX_GERUND_HEADING_WORDS = 6;
  function isSubjectlessRemark(s) {
    if (EVALUATIVE_OPENER_RE.test(s)) return true;
    if (BARE_COMPARATIVE_RE.test(s) && !/\bthan\b/i.test(s)) return true;
    return GERUND_OPENER_RE.test(s) && s.split(/\s+/).length <= MAX_GERUND_HEADING_WORDS && !HEADING_VERB_RE.test(s);
  }

  function isNameable(term, maxWords = MAX_TERM_WORDS) {
    const t = String(term || '').trim();
    // A list glyph inside a name ("Mild disease •Streptococcus equi") is two table cells run together.
    if (t.length < 3 || t.length > 70 || /\n|\?\s*$|[•▪◦]/.test(t) || t.split(/\s+/).length > maxWords) return false;
    return !sn().isLabelTerm(t.replace(/^Theorem\s+[A-Z0-9.]+\s+[—–-]\s+/i, ''));
  }

  // Not a definition: a ranking ("The 3rd most common reason for culling"), or a second label glued into
  // the text ("Inflammation of the grey matter encephalitis: Inflammation of the white matter").
  const RANKING_RE = /^(?:The|A|An)\s+(?:\d+(?:st|nd|rd|th)|first|second|third|most|least|best|worst|main)\b/i;
  const GLUED_LABEL_RE = /\S\s*:\s+[A-Z]/;
  // An acronym's expansion ("Stands for ...") is a different kind of fact from a definition.
  const EXPANSION_RE = /^(?:stands\s+for|short\s+for|abbreviat(?:ion|ed)\b)/i;
  // "Long term administration contraindicated because ...": a definition says what a thing is; it does not argue.
  const ARGUES_RE = /\b(?:because|although|though|since\s+(?:it|the|a|an|they))\b/i;
  const isDefinitionText = (text) => !RANKING_RE.test(text) && !GLUED_LABEL_RE.test(text) && !EXPANSION_RE.test(text) && !ARGUES_RE.test(text);


  // Something only one subject could own: a number, a name or acronym inside the line, or a technical word (a
  // long one: "neurotropic", "pyogranulomas"). "Short to long term supportive care", "Signs vary based on regions
  // affected" or "Doses may vary based on age and species" could be said of any disease or drug, so they are never
  // borrowed as a False about another subject: there they may well be true.
  // distinctive(word), when given, says whether a long word is the owner's alone; without it any long word counts.
  const SPECIFIC_RE = /\d|\s[A-Z][A-Za-z]*[A-Z0-9]|\s[A-Z][a-z]{2,}/;
  const LONG_WORD_RE = /\b[a-z]{10,}\b/g;
  // "Neuronal dysfunction → clinical signs and death": a long abstract noun ("dysfunction", "inflammation",
  // "management") names a kind of process any subject can have, not something one subject owns.
  const ABSTRACT_NOUN_RE = /(?:tion|sion|ment|ness|ity|ance|ence|ing)s?$/;
  // "Parasites DIE prior to elimination": a common word set in capitals for emphasis (two or more vowels, unlike
  // "PCR" or "CNS") is no acronym; read in lower case it names nothing only one subject owns.
  const SHOUTED_RE = /\b(?=[A-Z]*[AEIOUY][A-Z]*[AEIOUY])[A-Z]{3,}\b/g;
  const isSpecificClaim = (text, distinctive) => {
    const t = String(text || '').replace(/\([^)]*\)/g, ' ').replace(SHOUTED_RE, (w) => w.toLowerCase());
    if (SPECIFIC_RE.test(t)) return true;
    const long = (t.match(LONG_WORD_RE) || []).filter((w) => !ABSTRACT_NOUN_RE.test(w));
    return typeof distinctive === 'function' ? long.some(distinctive) : long.length > 0;
  };

  const api = { isSpecificClaim, isStandalone, isPointStatement, isDefinitionText, isNameable, isShouted, isRunTogether };
  PDFStudy.factStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Slide Line Shapes: what one line of a slide is, judged from its typography and grammar, for the card
 * builders in slide-structure-cards.js.
 *   LABEL_RE / EQUALS_RE / DASH_RE   "Label: value", "Term = value", "Term – value" / "Term- value"
 *   needsEntity(label)    "Treatment", "Hind", "Tests to run" mean something only under the slide's subject
 *   isLabelHead(head)     a heading that labels the lines under it (noun phrase, or a lead-in ending ":" / "…"),
 *                         not a statement, a clause, an instruction or a predicate ("Most common in older dogs")
 *   goodHead / goodItems  a heading and its children that make a question and its answer
 *   isDebris(line)        a broken piece of the slide: a wrap, glued columns, overlapping text layers, a caption
 *   isNameOnly(text)      capitalised words only, as the labels of a diagram are
 *   definingWords(value)  words of a value that are not units ("1 ml / 15 lb" has none)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const quality = () => dep('cardQuality', './card-quality.js');

  const LABEL_RE = /^([A-Za-z][A-Za-z0-9 /&'’-]{1,34}?)\s*:\s+(\S.{1,300})$/;
  const EQUALS_RE = /^([A-Za-z][A-Za-z0-9 /&'’()-]{1,40}?)\s+=\s+(\S.{5,300})$/;
  // "Plant toxins – lilies", and the slide habit "Pneumonia- infection of the lung" (hyphen against the term).
  // (After a glued hyphen the definition must read as one — three words in lower case, or four — so
  // "Inverted- L Block", a hyphenated name broken by a space, is not split.)
  const DASH_RE = /^([A-Z0-9][A-Za-z0-9\s\-/()]{1,40}?)(?:\s+(?:—|–|-)\s+(.{6,250})|(?<=[a-z)])-\s+((?:[a-z]\S*(?:\s+\S+){2,}|\S+(?:\s+\S+){3,}).{0,230}))$/;
  // Labels that describe the slide's subject and mean nothing alone ("Treatment", "Dogs", "Net").
  const GENERIC_LABELS =
    'etiology|aetiology|causes?|agents?|clinical\\s+signs|signs|symptoms|presentation|diagnosis|differentials?|treatment|therapy|' +
    'prevention|control|transmission|pathogenesis|pathology|epidemiology|prognosis|hosts?|reservoirs?|vectors?|distribution|' +
    'morphology|life\\s+cycle|location|function|structure|indications?|contraindications?|mechanism|moa|dose|dosage|route|' +
    'side\\s+effects|adverse\\s+effects|uses?|advantages?|disadvantages?|pros|cons|examples?|notes?|net|inputs?|outputs?|results?|' +
    'goal|idea|key\\s+idea|time|space|best\\s+case|worst\\s+case|average\\s+case|summary|overview|types?|features|characteristics|' +
    'properties|history|samples?|tests?|species|dogs?|cats?|cattle|horses?|sheep|goats?|pigs?|swine|humans?|ruminants|wildlife|' +
    'small\\s+animals|large\\s+animals|onset|duration|risk\\s+factors|complications|key\\s+points?|important|remember|' +
    'absorption|metabolism|elimination|excretion|pharmacokinetics|pharmacodynamics|anesthesia|anaesthesia|technique|procedure|' +
    'disease|condition|syndrome|organism|pathogen|drug|answer|question';
  const GENERIC_LABEL_RE = new RegExp(`^(?:${GENERIC_LABELS})\\b`, 'i');
  // Positions, sides, stages and grades: "Hind: lateral claw > medial" only means something under its heading.
  const POSITION_LABEL_RE =
    /^(?:front|fore|hind|rear|left|right|top|bottom|upper|lower|inner|outer|medial|lateral|dorsal|ventral|cranial|caudal|proximal|distal|anterior|posterior|early|late|acute|chronic|mild|moderate|severe|before|after|male|female|adults?|juveniles?|young|old|yes|no|other|both)$/i;
  // Figure captions and their pointers: "Right: intranuclear inclusions (arrow)".
  const CAPTION_RE = /^(?:right|left|top|bottom|above|below|center|centre|middle|inset|image|photo|figure|fig|arrows?|arrowheads?|source|credit|courtesy)\b/i;
  const CAPTION_NOTE_RE = /\((?:arrows?|arrowheads?|asterisks?|inset|circled?|star)\)|\b(?:photo|image|picture)\s+(?:by|credit)\b|\bcourtesy\s+of\b/i;
  // A heading that states, explains or instructs is not a label for the lines under it.
  // (Words that are also nouns — "cause", "result", "lead" — are left out: "Cause of valley fever" is a label.)
  const STATEMENT_VERB_RE =
    /\b(?:is|are|was|were|has|have|had|can|cannot|could|will|would|may|might|must|should|does|do|did|occurs?|happens?|becomes?|requires?|remains?|seems?|depends?|varies|vary|differs?|affects?)\b/i;
  // Asides in the lecturer's voice, not a property of the subject: "Reality: no division exists!".
  const DISCOURSE_LABEL_RE = /^(?:reality|note|nb|hint|tip|remember|reminder|fun\s+fact|caution|warning|important|fyi)$/i;
  const CLAUSE_WORD_RE = /\b(?:if|when|whenever|because|then|so|but|unless|until|while)\b/i;
  // A percentage, or two values set against each other: the line reports a finding.
  const FIGURE_CLAIM_RE = /\d\s*%\s+[a-z]|\bvs\.?\s+\d/;
  // "(dead in cage) Diffuse hemorrhage": a bracketed note run into the next point (recognised handwriting).
  // ("(dead in cage)" alone is such a note too.)
  const LEADING_NOTE_RE = /^\([^)]{2,30}\)(?:\s+[A-Z]|\s*$)/;
  const INSTRUCTION_RE =
    /^(?:think|remember|note|consider|use|avoid|check|make|give|take|provide|place|insert|inject|apply|remove|ligate|loosen|tighten|block|cut|seat|saw|clip|clean|wash|monitor|repeat|stop|start|keep|ensure|call|submit|try|look|deposit|replace)\b/i;
  // "Most common in older dogs", "Almost always involves the spine": a predicate of the slide's subject, not a label.
  const PREDICATE_START_RE =
    /^(?:most|more|less|least|often|usually|rarely|always|never|almost|mostly|commonly|typically|especially|frequently|sometimes|generally|only)\b/i;
  // "Proximal and Distal Paravertebrals Pros:": a second column's label glued onto a line of the first.
  const GLUED_LABEL_RE = /\S\s+[A-Z][a-z]+:(?:\s|$)/;
  // "ofNerve", "eachThis": words run together by handwriting recognition (a slide's own text never does this).
  const GLUED_WORDS_RE = /(?:^|\s)[a-z]{2,}[A-Z][a-z]{2,}/;
  // "Ruminants, Horses Ruminants, Horses": a run of two or more words read twice (overlapping text layers).
  const REPEATED_RUN_RE = /\b(\w+[,;]?\s+\w+[,;]?(?:\s+\w+[,;]?)*)\s+\1\b/i;
  // One word of five or more letters said twice in a row (a four-letter "equi equi" is a real binomial name).
  const REPEATED_WORD_RE = /\b([A-Za-z]{5,})\s+\1\b/i;
  // A child line that opens with "of", "and", "to" is the second half of a wrapped line, not a point.
  const LEADING_FUNCTION_WORD_RE = /^(?:of|and|or|to|in|on|at|by|for|with|from|as|than|but|is|are|was|were|th|nd|rd|st)\s/i;
  // Bullet glyphs inside a line, a cut-off dash, braces, and CJK characters from a mis-read handwriting layer.
  const BROKEN_LINE_RE = /\s•\s|[-–—]\s*$|[{}　-鿿]/;
  // A value made of numbers and units ("1 ml / 15 lb") is a fact about the slide's subject, not a definition.
  const UNIT_RE = /^(?:mg|kg|g|ml|mL|l|lb|lbs|oz|mm|cm|m|km|min|hr|hrs|h|s|sec|wk|wks|mo|yr|yrs|day|days|IU|iu|mcg|µg|mmol|mol|bpm)$/;
  const MAX_ITEMS = 7;
  const MAX_ITEM_CHARS = 180;
  const MAX_LABEL_HEAD_WORDS = 10;
  const MAX_NAME_WORDS = 4;
  const MAX_AMOUNT_WORDS = 6;

  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const wordCount = (s) => tidy(s).split(/\s+/).filter(Boolean).length;
  const hasLetters = (s) => /[A-Za-z]{2}/.test(s);
  const balanced = (s) => (s.match(/\(/g) || []).length === (s.match(/\)/g) || []).length;
  const definingWords = (s) => (tidy(s).match(/[A-Za-z]{3,}/g) || []).filter((w) => !UNIT_RE.test(w)).length;

  /** "Tests to run", "Samples to collect", "Treatment", "Hind" need the slide's subject; "Heapsort" does not. */
  const needsEntity = (label) => GENERIC_LABEL_RE.test(label) || POSITION_LABEL_RE.test(label) || /\s(?:to|for|of|in)\s/i.test(label);

  /**
   * A heading that labels what follows: a short noun phrase, or a lead-in that ends in ":" or "…". `items`, when
   * given, lets an instruction head its amounts ("Deposit lidocaine at L1, L2" over "10-20 mL above").
   */
  function isLabelHead(head, items) {
    const h = tidy(head);
    if (!balanced(h) || /\s[•=]\s|[-–—]\s*$/.test(h) || /^\(/.test(h)) return false; // glued bullets, an equation, a cut-off line
    if (items && items.length && INSTRUCTION_RE.test(h) && items.every((x) => /\d/.test(x) && wordCount(x) <= MAX_AMOUNT_WORDS)) return true;
    if (/(?::|…|\.\.\.)$/.test(h)) return true;
    // Words in brackets qualify the label ("Acute infarct (occurred within 3 days)") and do not make it a sentence.
    const core = h.replace(/\([^)]*\)/g, ' ');
    if (!/^[A-Z0-9“"‘']/.test(h) || wordCount(core) > MAX_LABEL_HEAD_WORDS || PREDICATE_START_RE.test(h)) return false;
    // "Complications change prognosis- 60% survival vs. 92%": a line that states a figure is a claim, not a label.
    if (FIGURE_CLAIM_RE.test(core)) return false;
    return !STATEMENT_VERB_RE.test(core) && !CLAUSE_WORD_RE.test(core) && !INSTRUCTION_RE.test(h);
  }

  /** Capitalised words only ("Frontal Ridge (aka Frontal Crest)"): a name, as diagram labels are. */
  function isNameOnly(text) {
    const words = tidy(text).replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
    return words.length >= 1 && words.length <= MAX_NAME_WORDS && words.every((w) => /^[A-Z0-9]/.test(w) || /^(?:of|the|and|aka|vs\.?|or)$/.test(w));
  }

  /** A heading bullet names something: a label, not a caption, a wrapped half line, a question or a "Label: value" line. */
  function goodHead(head, itemCount, items) {
    if (!head || !hasLetters(head) || /\?\s*$/.test(head) || LABEL_RE.test(head) || CAPTION_RE.test(head)) return false;
    if (wordCount(head) > 10 || (wordCount(head) > 6 && itemCount < 2)) return false;
    if (/^(?:or|and|of|to|in|with|but|by|for)\b/.test(head) || !quality().readable(head) || hasOverlappingLayers(head)) return false;
    if (/\b(?:can|will|may|must|should|could|would|has|have|had|does|do|did|not)$/i.test(head)) return false; // a line that wraps mid-clause
    return isLabelHead(head, items) && !quality().endsMidPhrase(head.replace(/(?:…|\.\.\.)$/, ''));
  }

  /**
   * Two text layers read into one line: a word said twice in a row ("hemorrhage hemorrhage within ...").
   * (A token that ends in another word of the line is not enough: "Bronchopneumonia/pneumonia" is real text.)
   */
  function hasOverlappingLayers(x) {
    return REPEATED_WORD_RE.test(x);
  }

  /** A line that is a broken piece of the slide rather than a point: wraps, glued columns, overlapping layers. */
  function isDebris(x) {
    return !quality().readable(x) || CAPTION_NOTE_RE.test(x) || /\)\s*\/\s*\(/.test(x) || GLUED_LABEL_RE.test(x) ||
      GLUED_WORDS_RE.test(x) || REPEATED_RUN_RE.test(x) || LEADING_FUNCTION_WORD_RE.test(x) || quality().endsMidPhrase(x) ||
      BROKEN_LINE_RE.test(x) || !balanced(x) || hasOverlappingLayers(x) || LEADING_NOTE_RE.test(x) || isAside(x) || isLabelRun(x);
  }

  /** "Reality: No division exists!": the lecturer's aside, not a point of the slide. */
  // ("“save a vein to euthanize”": a saying set in quotes is the lecturer's aside too.)
  const isAside = (x) => {
    const m = tidy(x).match(/^([A-Za-z ]{2,14}):\s/);
    // (A quoted name, "‘Old dog encephalitis’", opens in capitals and stays.)
    return (Boolean(m) && DISCOURSE_LABEL_RE.test(m[1].trim())) || /^[“"‘'][a-z][^“”"]{3,80}[”"’']$/.test(tidy(x));
  };

  /**
   * "Neutrophil Lymphocyte Plasma cell Macrophage Eosinophil": the labels of a row of pictures read as one line.
   * Four or more words, half of them or more capitalised, with no punctuation, verb or function word between them.
   */
  function isLabelRun(x) {
    const words = tidy(x).split(/\s+/);
    if (words.length < MIN_LABEL_RUN || /[,;:.!?()→=–—-]/.test(x) || STATEMENT_VERB_RE.test(x) || /\b(?:of|the|a|an|in|with|to|for|and|or|by|on)\b/.test(x)) return false;
    return words.filter((w) => /^[A-Z]/.test(w)).length * 2 >= words.length;
  }
  const MIN_LABEL_RUN = 4;

  /** Three words or fewer, no verb, number or punctuation beyond a hyphen: a name, not a statement. */
  const isShortName = (x) => wordCount(x) <= MAX_SHORT_NAME_WORDS && !/[\d,;:!?→=]/.test(x) && !STATEMENT_VERB_RE.test(x) && !/:$/.test(x);
  const MAX_SHORT_NAME_WORDS = 3;
  const contentWords = (x) => tidy(x).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !/^(?:and|the|for|with|from)$/.test(w));
  const sharesWord = (a, b) => contentWords(a).some((w) => contentWords(b).includes(w));

  /** Children that read as points, not as the debris of a diagram or a table read row by row. */
  function goodItems(head, items) {
    if (!items.length || items.length > MAX_ITEMS) return false;
    if (items.some((x) => x.length > MAX_ITEM_CHARS || isDebris(x))) return false;
    if (new Set(items.map((x) => x.toLowerCase())).size !== items.length) return false;
    // "Frontal Ridge" over "Zygomatic Arch": two labels of one picture, not a question and its answer.
    if (items.length === 1 && isNameOnly(head) && isNameOnly(items[0])) return false;
    // "Blood-brain barrier" over "Blood-cerebrospinal fluid barrier", "Fox and Skunk" over "Arctic fox": two short
    // names that share a word (a legend, two kinds of one thing) say nothing about each other. An aspect heading
    // ("Anesthesia" over "Regional intravenous anesthesia") is a question its one line answers, and "Tick vectors"
    // over "Ixodes spp." a label and its value.
    if (items.length === 1 && !needsEntity(head) && isShortName(head) && isShortName(items[0]) && sharesWord(head, items[0])) return false;
    if (items.length === 1) return wordCount(items[0]) >= 2 || items[0].length >= 6;
    const words = items.reduce((n, x) => n + wordCount(x), 0) / items.length;
    const lowercase = /^[a-z]/.test(head) || items.some((x) => /^[a-z]/.test(x));
    return !(words < 2.2 && lowercase);
  }

  const api = {
    LABEL_RE, EQUALS_RE, DASH_RE, CAPTION_RE, CAPTION_NOTE_RE, DISCOURSE_LABEL_RE, GLUED_LABEL_RE, GLUED_WORDS_RE,
    MAX_ITEMS, MAX_ITEM_CHARS, needsEntity, isLabelHead, isNameOnly, goodHead, goodItems, isDebris, definingWords, balanced,
  };
  PDFStudy.slideLineShapes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

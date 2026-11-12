/**
 * Quiz Quality Gate (Deterministic, Non-AI)
 * Decides which source sentences are fit to become quiz questions and which phrases may serve as
 * distractors. Math spans ($...$) are masked before prose checks so TeX symbols never disqualify a
 * clean STEM sentence. Phrase-shape helpers live in phrase-shape.js and are re-exported here.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  function getDeps() {
    return {
      tokenizer: dep('tokenizer', './tokenizer.js'),
      noiseFilter: dep('noiseFilter', './noise-filter.js'),
      mathText: dep('mathText', './math-text.js'),
      stemNoise: dep('stemNoise', './stem-noise.js'),
      phraseShape: dep('phraseShape', './phrase-shape.js'),
    };
  }

  const IMPERATIVE_RE =
    /^(?:use|find|complete|determine|evaluate|sketch|graph|show|verify|explain|describe|write|consider|let|suppose|assume|compare|calculate|compute|solve|identify|list|discuss|draw|read|note|recall|see|refer|try|check|give|prove|make|label|fill|match|choose|select|answer|look|think|imagine|notice|remember|click|visit|go|estimate|approximate|simplify|rewrite|define|name|classify|predict|summarize|apply|analyze|construct|observe|examine|understand|develop|recognize)\s+(?:the|a|an|each|all|your|this|these|that|those|it|them|its|both|any|every|some|one|two|three|several|why|how|what|whether|which|who|when|where|out|up|at|for|on|in|to|you|yourself|[a-z]\b|\d)/i;
  const META_RE =
    /^(?:chapter|section|unit|part|lesson|module)\s+[\dIVX]|\b(?:this|the\s+(?:next|previous|following|preceding))\s+(?:chapter|section|book|text|unit|lesson|course|module|theorems?|definitions?|examples?|lemmas?|rules?|properties)\b|\bin\s+(?:examples?|exercises?|figures?|tables?)\s+\d|\bas\s+(?:shown|seen)\s+(?:above|below|in\s+figure)/i;
  const SECOND_PERSON_RE = /\b(?:you|your|yours|yourself)\b/i;
  const VERB_RE =
    /\b(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|may|might|must|shall|should|does|do|did)\b|\b[a-z]{3,}(?:ed|es)\b|\b(?:occurs|forms|contains|includes|produces|requires|causes|allows|means|consists|depends|remains|becomes|represents|describes|states|uses|helps|plays|makes|takes|gives|leads|results|refers|involves|exists|converts|stores|controls|regulates|binds|carries|lowers|raises|limits|holds|keeps|runs|converges|diverges|equals|approaches|satisfies)\b/i;
  const ANAPHORA_START_RE =
    /^(?:this|these|those|it|its|they|their|he|she|his|her|such|here|there|another|other|both|each|similarly|however|therefore|thus|hence|also|so|but|and|or|for\s+(?:example|instance)|in\s+(?:this|that|addition|contrast)|as\s+a\s+result|because|if|when|although|while)\b/i;
  const CONCEPT_CUE_RE =
    /\b(?:is|are)\s+(?:defined\s+as|called|known\s+as|referred\s+to\s+as|(?:a|an|the)\s+[a-z]+)|\brefers?\s+to\b|\bstates?\s+that\b|\bmeans?\s+that\b|\bconsists?\s+of\b|\bis\s+responsible\s+for\b|\boccurs?\s+(?:when|in|during)\b|\b(?:contains?|produces?|converts?|requires?|determines?|regulates?|increases?|decreases?|converges?|diverges?)\b/i;
  const GENERIC_WORDS = new Set([
    'thing', 'things', 'way', 'ways', 'part', 'parts', 'kind', 'kinds', 'type', 'types', 'number',
    'numbers', 'following', 'important', 'different', 'various', 'several', 'many', 'much', 'called',
    'known', 'used', 'given', 'shown', 'first', 'second', 'third', 'last', 'next', 'previous', 'well',
    'often', 'usually', 'instance', 'case', 'cases', 'fact', 'order', 'term', 'terms', 'text', 'book',
    'author', 'authors', 'reader', 'readers', 'student', 'students', 'information', 'material',
    'rights', 'reserved', 'copy', 'copies', 'permission', 'printed', 'online', 'website', 'contents',
  ]);
  const HEADING_LINE_RE =
    /^(?:\*\*)?(?:(?:chapter|section|unit|part|module|lesson)\s+[\dIVX]+\b|\d+(?:\.\d+)+\s+[A-Z])[^.!?]{0,100}$/i;

  const clean = (text) => String(text || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const isNoisy = (s) => Boolean(getDeps().noiseFilter && getDeps().noiseFilter.isNoise(s));

  /** True when a sentence is a well-formed, content-bearing declarative statement (math-safe). */
  function isQuizSentence(sentence) {
    const s = clean(sentence);
    const { tokenizer, mathText, stemNoise } = getDeps();
    if (s.length < 30 || s.length > 300 || /\$\$/.test(s) || isNoisy(s) || /^\(/.test(s)) return false;
    if (stemNoise && stemNoise.isUnusableSentence(s)) return false;
    if (mathText && !mathText.isBalanced(s)) return false;
    const prose = mathText ? mathText.mask(s).text.replace(/\u27E6M\d+\u27E7/g, 'math') : s;
    if (/\?/.test(prose) || !/[.!]["')\]]?$/.test(prose)) return false;
    if (!/^["']?[A-Z]|^math\b/.test(prose)) return false;
    if (IMPERATIVE_RE.test(prose) || META_RE.test(prose) || SECOND_PERSON_RE.test(prose)) return false;
    const words = prose.split(' ');
    if (words.length < 7 || words.length > 48) return false;
    const symbolRatio = (prose.match(/[=<>^+*/\\|{}[\]_~\d]/g) || []).length / prose.length;
    if (symbolRatio > 0.12 || !VERB_RE.test(prose)) return false;
    if (tokenizer) {
      const tokens = tokenizer.tokenize(prose);
      const content = tokens.filter(
        (w) => w.length > 2 && !tokenizer.STOPWORDS.has(w) && !/^\d/.test(w) && !GENERIC_WORDS.has(w)
      );
      if (content.length < 4 || content.length / Math.max(1, tokens.length) < 0.35) return false;
    }
    return true;
  }

  function isConceptualDeclarative(sentence) {
    const s = clean(sentence);
    if (!isQuizSentence(s) || s.length < 45 || s.length > 220) return false;
    if (ANAPHORA_START_RE.test(s) || /\b(?:we|our|us|i)\b/i.test(s) || /\d/.test(s)) return false;
    return CONCEPT_CUE_RE.test(s);
  }

  function isGoodDistractor(phrase, trusted = false) {
    const p = clean(phrase);
    if (p.length < 3 || p.length > (trusted ? 90 : 48)) return false;
    if (!trusted && /[@/\\=<>]|\.[a-z]{2,}\b|https?|www/i.test(p)) return false;
    if (trusted && /@|\.[a-z]{2,}\b|https?|www/i.test(p)) return false;
    const nf = getDeps().noiseFilter;
    if (nf && (trusted ? nf.isTermNoise(p) : nf.isDistractorNoise(p))) return false;
    if (trusted || /^[A-Z][A-Z0-9-]{1,7}$/.test(p)) return true;
    const words = p.toLowerCase().split(' ');
    if (words.length > 5) return false;
    const { tokenizer } = getDeps();
    const stop = tokenizer ? tokenizer.STOPWORDS : new Set();
    if (stop.has(words[0]) || stop.has(words[words.length - 1])) return false;
    return words.some((w) => w.length >= 4 && !stop.has(w) && !GENERIC_WORDS.has(w));
  }

  function splitHeadings(text) {
    const headings = [];
    const bodyLines = [];
    for (const line of String(text || '').split('\n')) {
      if (HEADING_LINE_RE.test(line.trim())) headings.push(clean(line));
      else bodyLines.push(line);
    }
    const headingWords = new Set(headings.join(' ').toLowerCase().match(/[a-z][a-z-]{2,}/g) || []);
    return { body: bodyLines.join('\n'), headings, headingWords };
  }

  function isHeadingFragment(phrase, headingWords) {
    const words = clean(phrase).toLowerCase().match(/[a-z][a-z-]{2,}/g) || [];
    return headingWords.size > 0 && words.length > 0 && words.every((w) => headingWords.has(w));
  }

  const isNounPhrase = (p) => getDeps().phraseShape.isNounPhrase(p, isGoodDistractor);
  const shapeFits = (t, c) => getDeps().phraseShape.shapeFits(t, c);
  const getShapeBucket = (t) => getDeps().phraseShape.getShapeBucket(t);
  const getMorphSuffix = (w) => getDeps().phraseShape.getMorphSuffix(w);

  PDFStudy.quizGate = {
    isQuizSentence, isConceptualDeclarative, isGoodDistractor, isNounPhrase,
    splitHeadings, isHeadingFragment, shapeFits, getShapeBucket, getMorphSuffix,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.quizGate;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Card Quality Gates shared by every flashcard source (prose, notes, slides).
 *   goodFront(front, opts)   a front names one thing: no pronoun or sentence opener, no clause, no dangling tail
 *   goodBack(back, front)    a back says something the front does not, and does not stop mid-phrase
 *   readable(text)           plain words and numbers, not recognition debris
 *   tidyClause(text)         a cut-out defining clause as a standalone answer ("which raises ..." -> "Raises ...")
 *   tidySentence(text)       a whole sentence as an answer: no leading "However,", no "(see Figure 3)"
 *   dedupe(cards)            drops repeated and near-repeated cards, keeping the first (strongest) one
 *   withTopic(card, topic)   every card carries the heading / slide title it came from, for same-topic quiz options
 *   topicFinder(text, ...)   the nearest heading above a sentence of running text
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Words that open a sentence or point at something else; a term never starts with one.
  const BAD_FIRST_WORD_RE = new RegExp(
    '^(?:it|its|this|that|these|those|they|them|their|we|our|you|your|he|she|his|her|there|here|such|one|each|every|' +
    'some|many|most|all|both|several|other|another|any|no|none|two|three|four|five|six|seven|eight|nine|ten|' +
    'however|therefore|thus|hence|moreover|furthermore|instead|otherwise|finally|next|then|also|' +
    'when|where|while|if|although|because|since|unless|whereas|after|before|during|as|for|in|on|at|by|with|from|to|of|' +
    'and|or|but|so|yet|what|which|who|why|how|is|are|was|were|be|not|only|just|even|still|again|now|today|' +
    'note|recall|consider|suppose|let|see|use|using|given|sometimes|often|usually|always|never|rarely|typically|generally)$', 'i');
  // A demonstrative anywhere in a front ("Length of this string") names something only the page shows.
  const DEMONSTRATIVE_IN_FRONT_RE = /\b(?:this|these|those|such)\b/i;
  // ...unless the word is a keyword being named: "if statement", "for loop", "not gate".
  const KEYWORD_TERM_RE = /^(?:if|for|while|do|in|not|and|or|is|as|with|to|no)[\s-]+(?:statements?|loops?|clauses?|blocks?|branch(?:es)?|keywords?|operators?|gates?|conditions?|expressions?)$/i;
  // A finite verb or a relative word inside the front means a clause was captured ("Four conditions must hold").
  const CLAUSE_VERB_RE = /\s(?:is|are|was|were|be|been|must|can|cannot|could|should|would|will|may|might|has|have|had|does|do|did|that|which|whose|because|we|you|they)\s/i;
  // A one-sentence answer that leans on the sentence before it: "We call such an array a partially filled array."
  const LEANS_BACK_RE = /\bsuch\s+an?\s+\w+|\bsuch\s+as\s+these\b|^(?:These|Those)\s+\w+\s+(?:is|are)\b|^(?:This|That)\s+\w+\s+is\b/i;
  const DANGLING_TAIL_RE =
    /\b(?:the|a|an|and|or|but|nor|of|in|into|on|onto|to|for|with|without|by|at|from|as|is|are|was|were|be|that|which|who|whose|when|where|while|if|than|via|per|its|their|this|these)\s*[.,;:]?\s*$/i;
  const STOP_RE = /^(?:the|a|an|and|or|of|in|on|to|for|with|by|at|from|as|is|are|was|were|be|that|which|it|its|this|these|those|not)$/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const contentWords = (s) => (plain(s).toLowerCase().match(/[a-z0-9][a-z0-9'+-]*/g) || []).filter((w) => !STOP_RE.test(w));
  const stem = (w) => (w.length > 4 ? w.replace(/(?:ies|es|s)$/, '') : w);

  /** Words of the front, not counting a trailing "(ABBR)". */
  function frontWords(front) {
    return plain(front).replace(/\s*\([^)]{1,12}\)\s*$/, '').split(/\s+/).filter(Boolean);
  }

  function goodFront(front, opts = {}) {
    const maxWords = opts.maxWords || 6;
    const text = plain(front);
    const words = frontWords(text);
    if (!words.length || words.length > maxWords || text.length < 2 || text.length > 70) return false;
    if (!/^[A-Za-z0-9$(]/.test(text)) return false; // an opening quote or bracket debris starts no term
    if (/\$\$|[{}\\]/.test(text.replace(/\$[^$]*\$/g, '')) || (text.match(/\$/g) || []).length % 2) return false; // formula debris
    if (BAD_FIRST_WORD_RE.test(words[0].replace(/[^A-Za-z]/g, '')) && !KEYWORD_TERM_RE.test(text)) return false;
    if (DEMONSTRATIVE_IN_FRONT_RE.test(text)) return false;
    if (CLAUSE_VERB_RE.test(` ${words.join(' ')} `) || DANGLING_TAIL_RE.test(words.join(' '))) return false;
    if (!/[A-Za-z]{2}/.test(text) || /[.!?;]$/.test(text)) return false;
    const sn = dep('stemNoise', './stem-noise.js');
    return !(sn && sn.isLabelTerm(text));
  }

  /** True when the text stops in the middle of a phrase: dangling function word, open bracket, trailing comma. */
  function endsMidPhrase(text) {
    const t = plain(text);
    if (!t) return true;
    const endsInSymbol = /\b[A-Z]\s*[.,;:]?\s*$/.test(t); // "... in sorted array A." names a variable, not the article
    if ((DANGLING_TAIL_RE.test(t) && !endsInSymbol) || /[,(\[{/&]\s*$/.test(t)) return true;
    const opens = (t.match(/[(\[]/g) || []).length;
    const closes = (t.match(/[)\]]/g) || []).length;
    return opens > closes;
  }

  const WORD_TOKEN_RE = /^[("'“‘*]*[A-Za-z][A-Za-z'’\-/.]*[)"'”’.,;:!?%*]*$/;
  const CODE_TOKEN_RE = /^[("'“‘]*[A-Za-z]{1,4}\d{1,3}[A-Za-z]?[)"'”’.,;:!?]*$/;
  const NUMBER_TOKEN_RE = /^[("'“‘]*[<>≤≥~±+\-–=]*\d[\d.,:%/+\-–°˚]*[A-Za-zµ°˚%]{0,5}[)"'”’.,;:!?]*$/;

  /**
   * Readable text, as opposed to recognition debris from an annotated slide ("Ca2t^∞ spaytic", ", fluke widrug"):
   * starts with a letter, digit or opening bracket, and most tokens are plain words or numbers.
   */
  function readable(text) {
    const t = plain(text).replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, 'x'); // a formula counts as one word
    if (!t || /^[,;:.)\]}_^=]/.test(t) || /\^[∞=(]|_\(|\)_/.test(t)) return false;
    const tokens = t.split(/\s+/).filter((tok) => !/^[•→–—\-&+/=|<>]+$/.test(tok));
    if (!tokens.length) return false;
    // Codes of letters and digits ("L1", "T13", "B12") are words of their field.
    const wordy = tokens.filter((tok) => WORD_TOKEN_RE.test(tok) || NUMBER_TOKEN_RE.test(tok) || CODE_TOKEN_RE.test(tok)).length;
    return wordy / tokens.length >= 0.75;
  }

  /** The back must add at least one content word the front does not already contain. */
  function restatesFront(back, front) {
    const frontSet = new Set(contentWords(front).map(stem));
    return !contentWords(back).some((w) => !frontSet.has(stem(w)));
  }

  /** True for a single sentence that only makes sense after the one before it. */
  function leansBack(back) {
    const t = plain(back);
    const oneSentence = !/[.!?]\s+[A-Z]/.test(t);
    return oneSentence && LEANS_BACK_RE.test(t);
  }

  function goodBack(back, front) {
    const lines = String(back || '').split('\n').map(plain).filter(Boolean);
    if (!lines.length) return false;
    // A list back is judged line by line; only its last line can leave the reader hanging.
    if (endsMidPhrase(lines[lines.length - 1])) return false;
    return !restatesFront(lines.join(' '), front);
  }

  /** A clause lifted out of its sentence, made to stand alone: leading relative word dropped, capital, full stop. */
  function tidyClause(text) {
    let t = plain(text)
      .replace(/^(?:in\s+which|which|who|where|whereby|that)\s+/i, '')
      .replace(/^(?:is|are|was|were|had\s+been|has\s+been)\s+(?=(?:an?|the)\s|[a-z]+ed\b)/i, '')
      .replace(/[\s,;:]+$/, '');
    if (!t) return '';
    if (/^[a-z]/.test(t)) t = t[0].toUpperCase() + t.slice(1);
    return /[.!?]["”')\]$]?$/.test(t) ? t : `${t}.`; // "... signal $X.$" already ends its sentence
  }

  const CONNECTIVE_RE =
    /^(?:Instead|However|Thus|Therefore|For\s+instance|For\s+example|In\s+other\s+words|Similarly|Moreover|In\s+addition|Also|Then|Finally|In\s+turn|As\s+a\s+result|Consequently|Hence),\s+/;
  // Asides that only make sense on the page: "(see Figure 3)", "..., which we will discuss later in this chapter".
  const ASIDE_RES = [
    /\s*\((?:see|as\s+shown\s+in|shown\s+in|cf\.?)\s+[^)]*\)/gi,
    /,?\s+(?:and\s+)?(?:which|as)\s+we\s+(?:will|shall|also)\b[^.;]*/gi,
    /,?\s+(?:as\s+)?shown\s+in\s+(?:Figure|Fig\.|Table)\s+[\w.-]+/gi,
  ];

  function withoutAsides(text) {
    return ASIDE_RES.reduce((t, re) => t.replace(re, ''), String(text || '')).replace(/\s+([.,;])/g, '$1').trim();
  }

  /** A whole sentence used as a back: leading "However," and page asides dropped, capital first letter. */
  function tidySentence(text) {
    const t = withoutAsides(plain(text).replace(CONNECTIVE_RE, ''));
    return /^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t;
  }

  const frontKey = (front) => {
    const bt = dep('boldTerms', './bold-terms.js');
    const text = plain(front).replace(/^(?:the|an?)\s+/i, '');
    return bt ? bt.termKey(text) : text.toLowerCase();
  };
  const backKey = (back) => contentWords(back).map(stem).join(' ');

  function overlap(a, b) {
    const setA = new Set(a.split(' '));
    const setB = new Set(b.split(' '));
    const shared = [...setA].filter((w) => setB.has(w)).length;
    // Measured against the longer back: one line of a list card is not a repeat of the whole list.
    return shared / Math.max(1, setA.size, setB.size);
  }

  /**
   * Keeps the first card of every group that asks the same thing: same front (lemma key), or a front that
   * contains another front while the two backs say nearly the same. Two different terms may share a back
   * (the one sentence that introduces both), so an equal back alone is not a repeat.
   */
  function dedupe(cards) {
    const kept = [];
    for (const card of cards || []) {
      const fk = frontKey(card.front);
      const bk = backKey(card.back);
      const repeat = kept.some((k) => {
        if (k.fk === fk) return true;
        // "Direct set or preset" after "Direct set": the same term with its synonym appended.
        if (fk.startsWith(`${k.fk} or `) || k.fk.startsWith(`${fk} or `)) return true;
        const nested = k.fk.length > 3 && fk.length > 3 && (k.fk.includes(fk) || fk.includes(k.fk));
        return nested && bk && k.bk && overlap(bk, k.bk) >= 0.8;
      });
      if (!repeat) kept.push({ card, fk, bk });
    }
    return kept.map((k) => k.card);
  }

  /** Adds `topic` without touching a topic the source already set. */
  function withTopic(card, topic) {
    const t = plain(topic).replace(/[:.]+$/, '');
    return card.topic || !t ? card : { ...card, topic: t };
  }

  /**
   * Nearest heading above a piece of running text. Returns lookup(snippet) -> heading title, or `fallback`
   * when the snippet cannot be found or nothing precedes it. `isHeadingLine` is the tokenizer's test.
   */
  function topicFinder(text, fallback, isHeadingLine) {
    const source = String(text || '');
    const headings = [];
    let offset = 0;
    for (const line of source.split('\n')) {
      if (isHeadingLine && isHeadingLine(line)) {
        const title = plain(line).replace(/^(?:(?:chapter|section|unit|part|theorem|definition)\s+)?[\dIVX]+(?:\.\d+)*[.:]?\s+(?=\S)/i, '');
        if (title.length >= 3) headings.push({ at: offset, title });
      }
      offset += line.length + 1;
    }
    return (snippet) => {
      const probe = String(snippet || '').slice(0, 24);
      const at = probe ? source.indexOf(probe) : -1;
      if (at < 0) return fallback;
      const above = headings.filter((h) => h.at <= at);
      return above.length ? above[above.length - 1].title : fallback;
    };
  }

  /**
   * A term the text first mentions inside a worked example's set-up ("For example, consider a program that
   * displays the effect of an earthquake, as measured by the Richter scale"): the example's prop, not a concept
   * of the section, however plainly a later sentence defines it.
   */
  function introducedByExample(term, text) {
    const t = String(term || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!t) return false;
    const at = String(text || '').search(new RegExp(`\\b${t}`, 'i'));
    // A term the author set in bold is the author's concept, wherever it first appears.
    if (at < 0 || new RegExp(`\\*\\*${t}`, 'i').test(String(text))) return false;
    const before = String(text).slice(Math.max(0, at - EXAMPLE_LOOKBACK), at);
    const sentenceStart = before.split(/[.!?]\s+|\n\s*\n/).pop();
    return EXAMPLE_SETUP_RE.test(sentenceStart.trim());
  }
  const EXAMPLE_LOOKBACK = 400;
  // The set-up of an example ("For example, consider a program ...", "Suppose a bank ..."); a definition introduced
  // "For instance, the limit from the right means ..." is not one.
  const EXAMPLE_SETUP_RE = /^(?:(?:for\s+(?:example|instance)|as\s+an\s+example),?\s+(?:consider|suppose|imagine|let'?s\s+say|take|look\s+at)|consider|suppose|imagine|let'?s\s+say)\b/i;

  const api = { introducedByExample, goodFront, goodBack, endsMidPhrase, restatesFront, leansBack, readable, tidyClause, tidySentence, withoutAsides, dedupe, withTopic, topicFinder, frontKey, plain };
  PDFStudy.cardQuality = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Quiz Option Vetting & Topical Ranking (Deterministic, Non-AI)
 * Builds a per-section term profile (word counts, sentence membership, line-end hyphen breaks) and uses
 * it to reject options that are truncated words, units / measurements, verb-final fragments or one-off
 * off-topic phrases, then ranks distractors by co-occurrence with the answer instead of by shape alone.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function getDeps() {
    return {
      tokenizer: PDFStudy.tokenizer || (typeof require === 'function' ? require('./tokenizer.js') : null),
      gate: PDFStudy.quizGate || (typeof require === 'function' ? require('./quiz-gate.js') : null),
    };
  }

  const UNIT_WORDS = new Set(('feet foot ft inch inches yard yards mile miles meter meters metre metres ' +
    'centimeter centimeters millimeter millimeters kilometer kilometers second seconds sec minute minutes ' +
    'hour hours day days week weeks month months year years gram grams kilogram kilograms pound pounds ' +
    'ounce ounces ton tons liter liters litre litres gallon gallons degree degrees celsius fahrenheit ' +
    'kelvin joule joules calorie calories watt watts newton newtons volt volts ampere amperes hertz mph ' +
    'percent dollar dollars cent cents radian radians').split(' '));
  const INFLECTIONS = new Set(['s', 'es', 'ed', 'd', 'ing', 'er', 'ers', 'ly']);
  const DETERMINER_AFTER =
    '(?:a|an|the|its|their|this|that|these|those|it|them|his|her|each|every|one|two|whether|how|what)';

  const lowerWords = (s) => String(s || '').toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  function stem(w) {
    if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + 'y';
    if (w.length > 4 && /(?:ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is|ics)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Precomputes the statistics every option check needs for one section of text. */
  function buildProfile(text) {
    const raw = String(text || '').replace(/\*\*|__/g, '');
    const flat = raw.replace(/\s+/g, ' ').toLowerCase();
    const wordCount = Object.create(null);
    const stemCount = Object.create(null);
    for (const w of lowerWords(flat)) {
      wordCount[w] = (wordCount[w] || 0) + 1;
      stemCount[stem(w)] = (stemCount[stem(w)] || 0) + 1;
    }
    const lineEnd = new Set((raw.match(/[A-Za-z]+-?(?=[ \t]*\r?\n)/g) || []).map((w) => w.replace(/-$/, '').toLowerCase()));
    const sentences = flat.split(/(?<=[.!?])\s+/).map((s) => new Set(lowerWords(s).map(stem)));
    return { flat, wordCount, stemCount, lineEnd, sentences, vocab: Object.keys(wordCount), cache: new Map() };
  }

  function phraseCount(lower, profile) {
    if (!profile.cache.has(lower)) {
      const re = new RegExp(`(?:^|[^a-z])${escapeRe(lower).replace(/\s+/g, '\\s+')}(?![a-z])`, 'g');
      profile.cache.set(lower, (profile.flat.match(re) || []).length);
    }
    return profile.cache.get(lower);
  }

  /** "feet per second", "degrees Celsius", "inches": measurements, not concepts. */
  function isUnitPhrase(phrase) {
    const words = lowerWords(phrase);
    if (words.length === 0) return false;
    if (words.includes('per') || UNIT_WORDS.has(words[words.length - 1])) return true;
    return words.filter((w) => UNIT_WORDS.has(w)).length * 2 >= words.length;
  }

  /** Last token was cut off: never a whole word in the source, or a line-end stub of a longer word. */
  function isTruncated(phrase, profile) {
    const words = lowerWords(phrase);
    const last = words[words.length - 1];
    if (!last || !profile) return false;
    if (!profile.wordCount[last]) return true;
    if (profile.wordCount[last] > 2 || !profile.lineEnd.has(last)) return false;
    return profile.vocab.some((v) => v.length > last.length + 1 && v.startsWith(last) && !INFLECTIONS.has(v.slice(last.length)));
  }

  /** Verb-final fragments: -izes/-ifies endings, or a phrase the source always follows with an object. */
  function isVerbTail(phrase, profile) {
    const words = lowerWords(phrase);
    const last = words[words.length - 1] || '';
    if (last.length >= 7 && /(?:izes|ises|yzes|ifies)$/.test(last)) return true;
    if (words.length < 2 || !profile) return false;
    const lower = words.join(' ');
    const total = phraseCount(lower, profile);
    if (!total) return false;
    const re = new RegExp(`(?:^|[^a-z])${escapeRe(lower).replace(/\s+/g, '\\s+')}\\s+${DETERMINER_AFTER}\\b`, 'g');
    return (profile.flat.match(re) || []).length * 2 > total;
  }

  /** On-topic for this section: the phrase recurs, or its head noun recurs. */
  function isTopical(phrase, profile) {
    const words = lowerWords(phrase);
    if (!profile || words.length === 0) return true;
    return phraseCount(words.join(' '), profile) >= 2 || (profile.stemCount[stem(words[words.length - 1])] || 0) >= 2;
  }

  /** Hard filter applied to every answer and option; trusted terms skip only the topicality rule. */
  function acceptTerm(term, profile, trusted = false) {
    const t = String(term || '').trim();
    if (!t || /\b(?:is|are|was|were|be|been)\b/i.test(t)) return false;
    if (isUnitPhrase(t) || isTruncated(t, profile) || isVerbTail(t, profile)) return false;
    return trusted || isTopical(t, profile);
  }

  /** Topical similarity of a candidate to the answer: shared words, sentence co-occurrence, recurrence. */
  function relevance(target, cand, profile) {
    if (!profile) return 0;
    const { tokenizer } = getDeps();
    const stop = tokenizer ? tokenizer.STOPWORDS : new Set();
    const content = (s) => lowerWords(s).filter((w) => w.length > 2 && !stop.has(w)).map(stem);
    const tS = content(target);
    const cS = content(cand);
    let score = cS.some((w) => tS.includes(w)) ? 1.5 : 0;
    const idx = (ws) => profile.sentences.reduce((acc, set, i) => (ws.some((w) => set.has(w)) ? acc.concat(i) : acc), []);
    const ti = idx(tS);
    const ci = idx(cS);
    const near = ci.filter((i) => ti.some((j) => Math.abs(i - j) <= 2)).length;
    score += Math.min(3, near);
    score += Math.min(1.5, Math.log2(Math.max(1, phraseCount(lowerWords(cand).join(' '), profile))) / 2);
    return score;
  }

  /** Filters and ranks distractor candidates for a (non-numeric) target. */
  function rankDistractors(target, candidatePool, questionStem, ctx = {}) {
    const { gate } = getDeps();
    const { trusted = new Set(), headingWords = new Set(), profile = null } = ctx;
    const tClean = target.trim();
    const tLower = tClean.toLowerCase();
    const tBucket = gate.getShapeBucket(tClean);
    const tWords = tClean.split(/\s+/);
    const tSuffix = gate.getMorphSuffix(tWords[tWords.length - 1]);
    const stemLower = (questionStem || '').toLowerCase();
    const seen = new Set([lowerWords(tLower).map(stem).join(' ')]);
    const scored = [];

    for (const rawCand of candidatePool) {
      const cClean = (rawCand || '').trim();
      const cLower = cClean.toLowerCase();
      const key = lowerWords(cLower).map(stem).join(' '); // "Secant line" ≡ "secant lines"
      if (!cClean || cClean.length < 3 || seen.has(key)) continue;
      const isTrusted = trusted.has(cLower);
      if (!gate.isGoodDistractor(cClean, isTrusted)) continue;
      if (!isTrusted && (!gate.isNounPhrase(cClean) || gate.isHeadingFragment(cClean, headingWords))) continue;
      if (!acceptTerm(cClean, profile, isTrusted) || !gate.shapeFits(tClean, cClean)) continue;
      if (cLower.includes(tLower) || tLower.includes(cLower)) continue;
      if (stemLower && stemLower.includes(cLower)) continue;
      seen.add(key);

      // Topicality is enforced by acceptTerm; relevance to this answer decides the ranking.
      let score = (isTrusted ? 3.5 : 0) + 1.5 * relevance(tClean, cClean, profile);
      if (gate.getShapeBucket(cClean) === tBucket) score += 3.0;
      const cWords = cClean.split(/\s+/);
      if (tSuffix && gate.getMorphSuffix(cWords[cWords.length - 1]) === tSuffix) score += 2.0;
      score += Math.max(0, 2.0 - Math.abs(tWords.length - cWords.length));
      score += 2.0 * (1 - Math.abs(tClean.length - cClean.length) / Math.max(tClean.length, cClean.length));
      if (/^[A-Z]/.test(tClean) === /^[A-Z]/.test(cClean)) score += 2.5;
      scored.push({ text: cClean, score });
    }
    return scored.sort((a, b) => b.score - a.score).map((x) => x.text);
  }

  PDFStudy.quizOptions = {
    buildProfile,
    isUnitPhrase,
    isTruncated,
    isVerbTail,
    isTopical,
    acceptTerm,
    relevance,
    rankDistractors,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.quizOptions;
  }
})(typeof window !== 'undefined' ? window : globalThis);

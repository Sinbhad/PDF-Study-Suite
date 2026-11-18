/**
 * Key Terms: the concepts a section actually teaches, in order of evidence:
 *   1. terms the text defines ("... is called reflexive", definition blocks)
 *   2. terms the author emphasised inline (**direct substitution**)
 *   3. named results ("Squeeze Theorem") and short topic titles of slides
 *   4. recurring noun phrases (keyphrase statistics) - only when seen at least twice
 * Everything is de-duplicated by lemma ("Equivalence Classes" == "equivalence class") and a later,
 * weaker candidate never displaces or repeats an earlier one.
 * rank({ definitions, text, titles, blockNames, max }) -> string[]
 * realTerm(term, sourceText?) -> boolean: the one test every Summary key term passes (outlines use it too)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const dm = () => dep('definitionMiner', './definition-miner.js');

  // Openers that make a phrase a remark about the text rather than a concept ("like factors", "next theorem").
  const FILLER_LEAD_RE =
    /^(?:like|such|many|several|next|previous|same|different|certain|various|given|following|important|useful|desirable|simple|basic|new|old|good|main|common|general|special|particular|whole|entire|own|real|only|just|even|still|also|much|more|most|less|least|two|three|four|five|six|both|each|every|another|other|whenever|wherever|however|therefore|thus|hence|note|recall|consider|suppose|let)\b/i;
  const FILLER_TAIL_RE = /\b(?:word|words|quality|way|ways|thing|things|case|cases|page|pages|times|belongs|part|parts|kind|kinds|sense|fact|idea|use|uses|look|example|examples)$/i;
  const NAMED_RESULT_RE = /\b(?:Theorem|Rule|Law|Test|Formula|Principle|Lemma|Method|Technique|Property|Identity|Inequality|Criterion|Algorithm)$/i;
  const HEAD_LABEL_RE = /^(?:REMARK|NOTE|Proof|Solution|Example|Exploration|Theorem|THEOREM|Definition|Figure|Table)\b/;

  const tidy = (t) => String(t || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').replace(/^(?:the|an?)\s+/i, '').replace(/[.,;:]+$/, '').trim();
  const display = (t) => (/^[a-z]{2}/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);
  /** "Domain of R" -> "Domain": a trailing "of <variable>" is notation, not part of the concept's name. */
  const concept = (t) => tidy(t).replace(/\s+of\s+(?:\$[^$]*\$|[A-Za-z](?:_\w+)?|\S{1,3})$/i, '');

  /** Inline bold terms of running text; whole-line bold is a heading and never a term. */
  function boldTerms(text) {
    const out = [];
    for (const line of String(text || '').split(/\n+/)) {
      const t = line.trim();
      if (/^\*\*[^*]+\*\*$/.test(t)) continue;
      for (const m of t.matchAll(/\*\*([^*$]{3,48})\*\*/g)) {
        const term = tidy(m[1]);
        if (m.index === 0 && HEAD_LABEL_RE.test(term)) continue;
        if (/^[A-Z\d\s.]+$/.test(term) || term.split(/\s+/).length > 5) continue; // "THEOREM 1.1", run-in headings
        if (/^(?:from|at|on|in|to|of|for|by|with|as|and|or)\b/i.test(term)) continue; // "from the right": emphasis, not a term
        out.push(term);
      }
    }
    return out;
  }

  function wordsOk(term) {
    return term.split(/\s+/).every((w) => !/[a-z][A-Z]/.test(w) && /^[A-Za-z][A-Za-z'’-]*$/.test(w));
  }

  // Words that name a part of a lecture or a book, never a concept it teaches ("Learning Objectives",
  // "Kahoot Question", "Problem Statement", "Clinical signs" as a slide heading). Structure, not subject.
  const FURNITURE_RE = /^(?:learning\s+)?(?:objectives?|targets?|outcomes?)$|^(?:summary|overview|introduction|intro|review|recap|references?|questions?|answers?|quiz|kahoot(?:\s+question)?|poll|case(?:\s+\d+)?|example|exercises?|figure|table|note|notes|tip|error|errors|warning|problem(?:\s+statement)?|solution|discussion|conclusions?|background|using|left(?:\s+side)?|right(?:\s+side)?|reality|clinical\s+signs|signs|treatment|diagnosis|prognosis|adverse\s+effects?(?:\s+\w+)?|indications|contraindications|pros|cons|definition(?:\s+\d+)?|theorem(?:\s+\d+)?|terms?|words?|items?|values?)$/i;
  const MAX_TERM_WORDS = 5;

  /**
   * A term a student could look up: a name of at most five words, made of words (an optional trailing number
   * as in "Hansen's type 1"), not a code identifier ("CookieCost", "sec01/File.java", "x_max"), not part of a
   * word split by a lost line-end hyphen ("Tab char-", "Acters"), not lecture furniture. `sourceText` (optional)
   * is the text the term came from: a term that only occurs as the tail of a hyphen break is a fragment.
   */
  function realTerm(raw, sourceText) {
    const t = tidy(raw).replace(/\$[^$]*\$/g, (m) => m.slice(1, -1));
    if (t.length < 3 || t.length > 48) return false;
    const words = t.split(/\s+/);
    if (words.length > MAX_TERM_WORDS || FURNITURE_RE.test(t)) return false;
    if (/^[-‐‑]|[-‐‑]$|[a-z][-‐‑]\s|[_/\\{}[\]<>=;#@|]|\(\)/.test(t)) return false;
    if (!words.every((w, i) => /^[A-Za-z][A-Za-z'’.-]*$/.test(w) || (i > 0 && /^\d{1,2}[a-z]?$/.test(w)))) return false;
    if (words.some((w) => /[a-z][A-Z]/.test(w))) return false; // camelCase identifier
    if (!/[A-Za-z]{3,}/.test(t)) return false;
    if (sourceText) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '(?:\\s|\\*\\*)+');
      const tail = new RegExp(`[a-z][-‐‑](?:\\*\\*)?\\s+(?:\\*\\*)?${esc}\\b`, 'i');
      const whole = new RegExp(`(?:^|[^A-Za-z-‐‑])${esc}\\b`, 'i');
      const src = String(sourceText);
      if (tail.test(src) && !whole.test(src.replace(new RegExp(tail.source, 'gi'), ' '))) return false;
    }
    return true;
  }

  function rank(input = {}) {
    const { definitions = [], text = '', titles = [], blockNames = [], max = 12 } = input;
    const nf = dep('noiseFilter', './noise-filter.js');
    const sn = dep('stemNoise', './stem-noise.js');
    const gate = dep('quizGate', './quiz-gate.js');
    const kw = dep('keywords', './keywords.js');
    const tok = dep('tokenizer', './tokenizer.js');
    const out = [];
    const seen = new Set();
    const add = (raw, strict) => {
      const term = concept(raw);
      const key = dm().termKey(term);
      if (!term || term.length < 3 || term.length > 48 || !key || seen.has(key)) return;
      if ((sn && sn.isLabelTerm(term)) || !realTerm(term, text)) return;
      // A candidate that only re-words a stronger term adds nothing ("Tangent line" after "Tangent Line with Slope m").
      const head = key.split(' ');
      const within = (a, b) => a.every((w) => b.includes(w));
      if ([...seen].some((k) => within(head, k.split(' ')))) return;
      if (strict) {
        if (!wordsOk(term) || FILLER_LEAD_RE.test(term) || FILLER_TAIL_RE.test(term)) return;
        if ((nf && nf.isTermNoise(term)) || (gate && !gate.isNounPhrase(term))) return;
        if ([...seen].some((k) => k.includes(' ') && within(k.split(' '), head))) return;
      }
      seen.add(key);
      out.push(display(term));
    };

    definitions.forEach((d) => add(d && d.term, false));
    boldTerms(text).forEach((t) => add(t, false));
    blockNames.map(tidy).filter((n) => NAMED_RESULT_RE.test(n) && n.split(/\s+/).length <= 5).forEach((n) => add(n, false));
    const stop = tok ? tok.STOPWORDS : new Set();
    titles.map(tidy).filter((t) => {
      const w = t.split(/\s+/);
      return w.length >= 2 && w.length <= 4 && !w.some((x) => stop.has(x.toLowerCase())) && !/[?:=]/.test(t);
    }).forEach((t) => add(t, true));
    if (kw && out.length < max) {
      const plain = nf ? nf.filterText(text) : text;
      const phrases = kw.extractRakeKeyphrases(plain, 3, 40).filter((k) => k.phrase.split(' ').length >= 2);
      for (const k of phrases) if (out.length < max && k.count >= 2) add(k.phrase, true);
      // Short inputs rarely repeat a phrase: top up a thin list with single-occurrence noun phrases.
      for (const k of phrases) if (out.length < Math.min(max, 3)) add(k.phrase, true);
    }
    return out.slice(0, max);
  }

  const api = { rank, boldTerms, concept, realTerm };
  PDFStudy.keyTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Bold Key-Term Cards: textbooks set defined terms in inline bold ("... a different type of limit called a
 * **one-sided limit**."). pdf-loader marks those runs with **, and every bold term that sits inside a real
 * sentence becomes a card whose back is the sentence that defines it (definitional cues preferred).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Bold labels and headings that are not terms
  const LABEL_RE =
    /^(?:solutions?|examples?|theorems?|definitions?(?:\s+of\b.*)?|proof|remarks?|notes?|exploration|figure|table|section|chapter|exercises?|hint|answers?|check|caution|warning|summary|review|guidelines?(?:\s+for\b.*)?|step\s+\d+|case\s+\d+|part\s+[a-z0-9]+|technology|objectives?)$/i;
  const STRONG_CUE_RE =
    /\b(?:is|are|was|were)\s+(?:called|termed|named|defined|said\s+to|known|referred)\b|\bcalled\b|\bdefined\s+(?:as|by|to\s+be)\b|\bknown\s+as\b|\bdenoted\b|\brefers?\s+to\b|\bmeans?\b|\bwe\s+say\b|\bthe\s+term\b/i;
  const WEAK_CUE_RE = /\b(?:is|are)\s+(?:a|an|the|any|one)\b|\bconsists?\s+of\b|\bdescribes?\b/i;
  const ANAPHOR_RE = /^(?:Such|This|These|That|Those|It|They|In\s+(?:such|this|that)|Here)\b/;
  const INCOMPLETE_END_RE =/(?::|\b(?:as|is|are|by|follows|that|where|the|of|to))\s*$/i;

  /** Singular/plural-insensitive key: "Step functions" == "step function", "discontinuities" == "discontinuity". */
  function termKey(term) {
    return String(term || '')
      .toLowerCase()
      .replace(/\s*\([^)]*\)$/, '') // "Gibbs Free Energy (G)" == "Gibbs Free Energy"
      .replace(/[^a-z0-9\s-]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => (w.length <= 3 || /(?:ss|us|is)$/.test(w) ? w : /ies$/.test(w) ? `${w.slice(0, -3)}y` : /(?:x|ch|sh|ss)es$/.test(w) ? w.slice(0, -2) : w.replace(/s$/, ''))) // "classes" -> "class"
      .join(' ');
  }

  /**
   * True when the sentence defines `term` itself, not merely mentions it next to a cue:
   * "... is called a one-sided limit", "the line x = c is a vertical asymptote", "A function f is continuous at c when",
   * "The limit from the right (or right-hand limit) means that ...", "the term continuous has ...".
   */
  function definesTerm(plain, term) {
    const t = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/s$/, '') + '(?:s|es)?';
    const after = new RegExp(
      `\\b(?:called|termed|named|known\\s+as|referred\\s+to\\s+as|denoted(?:\\s+by)?|is|are|be)\\s+(?:said\\s+to\\s+(?:be|have)\\s+)?(?:(?:a|an|the)\\s+)?${t}\\b`,
      'i'
    );
    const before = new RegExp(
      `^(?:[A-Z][a-z]+(?:\\s+[a-z]+)?,\\s+)?(?:(?:the|a|an)\\s+)?${t}\\b(?:\\s*\\([^)]*\\))?\\s+(?:is|are|refers|means|denotes|describes|consists)\\b`,
      'i'
    );
    return after.test(plain) || before.test(plain) || new RegExp(`\\bthe\\s+term\\s+${t}\\b`, 'i').test(plain);
  }

  function cleanTerm(raw) {
    return String(raw || '')
      .replace(/^[\s("'“]+|[\s)"'”.,;:!?]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isTermShape(term) {
    if (!term || term.length < 3 || term.length > 50) return false;
    if ((term.match(/[A-Za-z]/g) || []).length < 3 || !/[a-z]{2}/i.test(term)) return false;
    if (term.split(/\s+/).length > 6 || LABEL_RE.test(term)) return false;
    // Emphasis on a verb phrase ("fails to exist", "not", "must") is not a term
    if (/^(?:fails?|is|are|not|no|does|do|can|cannot|must|never|always|only|exists?|only|also|very)\b/i.test(term)) return false;
    if (/^(?:EXAMPLE|THEOREM|SECTION|CHAPTER)\b/.test(term) || /\d\.\d/.test(term)) return false;
    return true;
  }

  /** Readable back: balanced math, letters dominate outside $...$ spans, a few real words, not a novel. */
  function isUsableBack(text) {
    const mt = PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);
    const sn = PDFStudy.stemNoise || (typeof require === 'function' ? require('./stem-noise.js') : null);
    if ((mt && !mt.isBalanced(text)) || (sn && sn.isFragment(text))) return false;
    const deMath = String(text || '').replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, 'math');
    const words = deMath.match(/\b[A-Za-z]{2,}\b/g) || [];
    const letters = (deMath.match(/[A-Za-z]/g) || []).length;
    return words.length >= 6 && text.length >= 30 && text.length <= 460 && letters >= deMath.replace(/\s/g, '').length * 0.58;
  }

  /**
   * Returns [{ term, back, score }] in order of first appearance.
   * deps: { tokenizer, isValidTerm(term) -> bool, isNoise(text) -> bool }
   */
  function extractBoldTermCards(text, deps) {
    const { tokenizer } = deps;
    // Bold runs broken by a line wrap ("**limit from the** **right**") are one term
    const sentences = tokenizer.splitSentences(text || '').map((s) => s.replace(/\*\*\s+\*\*/g, ' '));
    const best = new Map();
    const plainOf = sentences.map((s) => tokenizer.cleanMarkdown(s));

    /** Back text for sentence idx (joined with the next / previous sentence when it needs them), or null. */
    function cardFor(idx, rawPlain) {
      // "[see Figure 1.28(a)]" / "(see Figure 1.31)" asides would trip the figure-caption noise filter
      // An equation tag glued in front ("Limit from the right Similarly, the limit from the left ...") is cut off
      const lead = rawPlain.match(/^.{3,60}?\s(?=(?:Similarly|However|For\s+instance|For\s+example|Thus|Therefore|Moreover|Likewise|In\s+other\s+words),\s)/);
      const plain = rawPlain.slice(lead ? lead[0].length : 0).replace(/\s*[[(]\s*see\s+Figures?\s+[\d.]+(?:\([a-z]\))?(?:\s*(?:and|,)\s*[\d.]*(?:\([a-z]\))?)*\s*[\])]/gi, '');
      if (deps.isNoise(plain)) return null;
      let back = plain;
      const next = plainOf[idx + 1];
      if (INCOMPLETE_END_RE.test(back) && next) back = `${back} ${next}`;
      if (!/[.!?]["”')\]]?$/.test(back)) return null; // glued figure / table fragments never end like a sentence
      const prev = idx > 0 ? plainOf[idx - 1] : '';
      const anaphoric = ANAPHOR_RE.test(plain);
      // "Such a line is called a secant line." needs the sentence before it to mean anything
      const resolved = anaphoric && prev && isUsableBack(prev) && /[.!?]$/.test(prev);
      if (resolved) back = `${prev} ${back}`;
      if (!isUsableBack(back)) return null;
      // An unresolved "Such well-behaved functions are continuous at c." scores below the card threshold
      return { back, anaphoric: anaphoric ? (resolved ? 0.5 : 1.5) : 0 };
    }

    /** 3 = the sentence defines this term, 2 = a definitional cue about something else, 1.5 = "is a", 1 = mention. */
    function scoreFor(plain, term, anaphoric) {
      const base = definesTerm(plain, term) ? 3 : STRONG_CUE_RE.test(plain) ? 2 : WEAK_CUE_RE.test(plain) ? 1.5 : 1;
      return base - (anaphoric || 0);
    }

    sentences.forEach((sentence, idx) => {
      const runs = [...sentence.matchAll(/\*\*([^*]{2,80}?)\*\*/g)];
      if (!runs.length) return;
      let plain = plainOf[idx];
      // "3. lim f(x) = f(c) Continuity on an Open Interval A function is continuous on..." (list item glued to
      // the next sentence): keep from the last sentence-like start before the first bold term
      if (/^(?:\d{1,2}|[a-h])[.)]\s/.test(plain)) {
        const firstTerm = tokenizer.cleanMarkdown(runs[0][1]);
        const cut = plain.slice(0, Math.max(0, plain.indexOf(firstTerm)));
        const starts = [...cut.matchAll(/(?:^|\s)(?=(?:A|An|The|If|For|When|In|We)\s)/g)];
        if (starts.length) plain = plain.slice(starts[starts.length - 1].index).trim();
      }
      const boldLen = runs.reduce((n, r) => n + r[1].length, 0);
      if (plain.split(/\s+/).length < 6 || boldLen > plain.length * 0.6) return; // heading, not prose
      const card = cardFor(idx, plain);
      if (!card) return;

      for (const r of runs) {
        // "**Power**: lim [f(x)]^n = L^n" is a list label inside a theorem, not a defined term
        if (/^\s*:/.test(sentence.slice(r.index + r[0].length))) continue;
        const term = cleanTerm(r[1]);
        if (!isTermShape(term) || !deps.isValidTerm(term)) continue;
        const key = termKey(term);
        const score = scoreFor(plain, term, card.anaphoric);
        const prev = best.get(key);
        if (!prev) best.set(key, { term, back: card.back, score, order: best.size });
        else if (score > prev.score) Object.assign(prev, { back: card.back, score });
      }
    });
    // A bold mention that is not defined where it is bold ("...the behavior of **step functions**.") looks for a
    // sentence elsewhere that does define it ("A discontinuity at c is called removable when ..."); else no card.
    for (const entry of best.values()) {
      if (entry.score >= 3) continue;
      const idx = plainOf.findIndex((p) => definesTerm(p, entry.term));
      const card = idx >= 0 ? cardFor(idx, plainOf[idx]) : null;
      const score = card ? scoreFor(plainOf[idx], entry.term, card.anaphoric) : 0;
      if (card && score > entry.score) Object.assign(entry, { back: card.back, score });
    }
    return [...best.values()].filter((e) => e.score >= 2).sort((a, b) => a.order - b.order).map(({ term, back, score }) => ({
      term: /^[a-z]/.test(term) ? term[0].toUpperCase() + term.slice(1) : term,
      back,
      score,
    }));
  }

  PDFStudy.boldTerms = { extractBoldTermCards, termKey, isTermShape };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.boldTerms;
  }
})(typeof window !== 'undefined' ? window : globalThis);

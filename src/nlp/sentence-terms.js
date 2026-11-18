/**
 * Sentence Terms: the term a single sentence defines or names, read from its grammar alone.
 *   copula   "A latch is a storage element that ..."        -> term "latch", statement "A storage element that ..."
 *   naming   "... an enzyme called ATP synthase", "... known as the Reign of Terror",
 *            "The union of A and B, denoted by ..."                                     -> term only
 * This covers running prose that defines its terms without bold type, a "Definition" box or the phrase
 * "is called", which is all definition-miner.js and the flashcard rules look for.
 *
 * definedIn(sentence) -> [{ term, statement, how }]   statement is '' for a naming
 * The caller decides whether a term is worth asking (noun-phrase shape, recurrence in the scope).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');

  const WORD = "[A-Za-z][A-Za-z'’-]*";
  const TERM = `${WORD}(?:\\s+${WORD}){0,3}`;
  // What a mathematical term is "of": a formula or a one-letter name ("the power set of S", "of A and B").
  const SYMBOL = '(?:⟦M\\d+⟧|[A-Za-z])';
  const OF_SYMBOLS = `(?:\\s+of\\s+${SYMBOL}(?:\\s*(?:,|and)\\s*${SYMBOL})*)?`;
  // "A <term> is a ...", "<Terms> are the ...": the subject must be the whole noun phrase before the verb.
  const COPULA_RE = new RegExp(`^(?:(?:The|An?)\\s+)?(${TERM})${OF_SYMBOLS}\\s+(?:is|are)\\s+((?:an?|the)\\s+\\S.*)$`);
  // A proper name may hold "of (the)" between capitalised words: "Reign of Terror", "Bill of Rights".
  const NAME_WORD = "[A-Z][A-Za-z'’-]*";
  const PROPER_NAME = `${NAME_WORD}(?:\\s+(?:of\\s+(?:the\\s+)?)?${NAME_WORD})+`;
  const NAMING_RE = new RegExp(
    `\\b(?:called|named|termed|known\\s+as|referred\\s+to\\s+as|said\\s+to\\s+be)\\s+(?:an?\\s+|the\\s+)?(${PROPER_NAME}|${TERM}?)` +
    '(?=\\s+(?:and|or|because|since|if|when|which|that|is|are|was|were|by|in|on|of|for|to|from)\\b|\\s*[.,;:)]|\\s*$)', 'g');
  // "The union of A and B, denoted by A ∪ B, is ...": introducing notation for a term introduces the term.
  const DENOTED_RE = new RegExp(`^(?:(?:The|An?)\\s+)?(${TERM})${OF_SYMBOLS},?\\s+(?:denoted|written|abbreviated)\\b`);

  // Subjects that point at something instead of naming it, or that are not a thing at all.
  const NOT_A_SUBJECT_RE =
    /^(?:it|this|that|these|those|they|there|here|he|she|we|you|one|each|another|such|which|what|who|both|all|some|most|many|result|results|answer|goal|idea|problem|reason|difference|advantage|disadvantage|example|following|first|second|third|next|last|other|same|former|latter|key|point|purpose|solution|trick|question|rest|case)\b/i;
  const FUNCTION_WORD_RE =
    /\b(?:of|in|on|at|by|for|from|with|to|into|and|or|but|if|when|while|that|which|who|whose|as|than|not|no|is|are|was|were|be|been|has|have|had|can|will|may|must|should|would|could|also|then|only|its|their|his|her|our|your|my)\b/i;

  const upperFirst = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  function definedIn(sentence) {
    const { text: masked, spans } = mt().mask(String(sentence || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim());
    const unmask = (s) => mt().unmask(s, spans);
    const out = [];
    const copula = masked.match(COPULA_RE);
    if (copula && !NOT_A_SUBJECT_RE.test(copula[1]) && !FUNCTION_WORD_RE.test(copula[1])) {
      out.push({ term: copula[1], statement: upperFirst(unmask(copula[2])), how: 'copula' });
    }
    const named = [...masked.matchAll(NAMING_RE)].map((m) => m[1]);
    const denoted = masked.match(DENOTED_RE);
    if (denoted) named.push(denoted[1]);
    const isProperName = new RegExp(`^${PROPER_NAME}$`);
    for (const term of named) {
      if (!term || NOT_A_SUBJECT_RE.test(term)) continue;
      if (FUNCTION_WORD_RE.test(term) && !isProperName.test(term)) continue;
      out.push({ term, statement: '', how: 'naming' });
    }
    return out;
  }

  const api = { definedIn };
  PDFStudy.sentenceTerms = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

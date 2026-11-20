/**
 * Recall Statements: the wording of a self-graded recall question built from one statement: a definition, or a
 * key-concept completion. recall-questions.js gathers the facts and cards; this module says how a statement is asked,
 * or that it cannot be asked as a question with one answer ('').
 *   definition    Define "Bit string".   (or, when the definition names its term, the term recalled from it:
 *                 Name the term: "A variable is called a ________ if its value is either true or false.")
 *                 What does it mean for two sets to be equal?   (a one-word term the definition uses as a predicate)
 *   completion    What is the SR latch?   What is a fixed point called?   What does Ohm's law state?
 * Refused: a completion that is not a definition or a named rule ("Copying the reference yields …", "An array index
 * must …": many right endings), an open is/are stem ("Surrogate keys are …" -> "used when ..."), a "Define" whose
 * answer is a bare name, advice, a run of attributes, the book's worked example told in the first person ("When we
 * delete one row, ..."), or a formula with letters it never introduces ("The proposition ¬q → ¬p": of which p, q?).
 *
 *   definitionPrompt(term, statement) -> { prompt, answer } | ''
 *   completionPrompt(front, back)     -> prompt | ''
 *   pinsOneAnswer(front, back, scope) -> may a key-concept completion be asked at all
 *   fullTerm(term, card)              -> the term with the number tidying dropped ("Hansen's type 2")
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const NAMED_RESULT_RE = /^(?:Theorem|Lemma|Corollary|Proposition)\s+[A-Z0-9]/;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const quoted = (t) => (NAMED_RESULT_RE.test(t) ? t : `"${t}"`);

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const STOP_ACRONYMS = new Set('OR IN ON OF TO IF AS IS AT BY NO AN SO DO IT UP US'.split(' '));

  function matchesAcronym(abbr, pos, ws, wi) {
    if (wi === ws.length) return pos === abbr.length;
    const word = ws[wi];
    const maxLen = abbr.length - pos - (ws.length - 1 - wi);
    for (let len = 1; len <= maxLen; len++) {
      const piece = abbr.slice(pos, pos + len);
      const ok = word.startsWith(piece) || (piece === 'x' && word.startsWith('ex'));
      if (ok && matchesAcronym(abbr, pos + len, ws, wi + 1)) return true;
    }
    return false;
  }

  /** Does the blanked sentence keep an uppercase acronym or blended abbreviation of `term` (e.g. XOR for Exclusive or)? */
  function leaksAbbreviation(blanked, term) {
    const ws = words(term).map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean);
    if (ws.length < 2) return false;
    const tokens = String(blanked || '').replace(/\\[a-zA-Z]+/g, ' ').match(/\b[A-Z]{2,}\b/g) || [];
    return tokens.some((tok) => !STOP_ACRONYMS.has(tok) && matchesAcronym(tok.toLowerCase(), 0, ws, 0));
  }

  /**
   * A definition that names its own term ("A variable is called a Boolean variable if ...") is asked the other
   * way round: the statement with the term blanked, the term to recall. -> { prompt, answer } | null
   */
  function termRecall(statement, term) {
    const re = new RegExp(`(?<![A-Za-z-])${escapeRe(term)}(?:e?s)?(?![A-Za-z-])`, 'i');
    if (!re.test(statement)) return { named: false };
    const blanked = statement.replace(re, '________');
    // Named twice, one blank would still show the answer; an inline acronym leaks it; a sentence that leans on another
    // ("Such a circuit is called ...") cannot be read alone. In any of those cases the definition is not asked by blanking.
    if (re.test(blanked) || leaksAbbreviation(blanked, term) || dep('stemNoise', './stem-noise.js').hasUnresolvedReference(blanked)) return { named: true };
    return { named: true, prompt: `Name the term: "${blanked}"`, answer: term };
  }

  const OTHER_SUBJECT_RE = /^([A-Z][\w-]*(?:\s+[A-Z0-9][\w-]*){0,2})\s+(?:is|are|was|were|has|have|requires?|contains?|causes?|uses?|includes?)\b/;

  // "Hansen's type 2": a kind word and its number name one thing; without the number the name is cut short.
  const KIND_NUMBER_RE = /\b(?:type|class|grade|stage|phase|degree|group|level|order)\s+(?:\d+|[IVX]{1,4})$/i;
  const BARE_KIND_RE = /\b(?:type|class|grade|stage|phase|degree|group|level)$/i;

  /** The term as its card names it, when tidying dropped the number of a numbered kind ("Hansen's type 2"). */
  function fullTerm(term, card) {
    const named = String((card && (card.subject || card.front)) || '').split(/\s+[—–]\s+/)[0].trim();
    if (KIND_NUMBER_RE.test(named) && norm(named).startsWith(norm(term))) return named;
    return term;
  }

  // "Large, marked size variation", "very thin and porous": attributes of the thing, not what it is.
  const ATTRIBUTES_RE = /^(?:very\s+|quite\s+|highly\s+)?[A-Za-z-]+,\s|^(?:very|quite|highly|extremely|relatively|rather)\s/i;

  /** Definition prompt: "Define X." or, when the definition names X, the term recalled from it. */
  function definitionPrompt(term, statement) {
    // A name cut before its number ("Hansen's type") cannot be defined: it could be either kind.
    if (BARE_KIND_RE.test(String(term).trim()) || ATTRIBUTES_RE.test(String(statement).trim())) return '';
    const recalled = termRecall(statement, term);
    if (recalled.prompt) return recalled;
    // A definition that names its term more than once cannot be blanked, but it can still be revealed for "Define X";
    // one that leans on the sentence before ("Such a circuit is called ...") cannot.
    if (recalled.named && dep('stemNoise', './stem-noise.js').hasUnresolvedReference(statement)) return '';
    // "Killed vaccine" => "Brandname II requires a series of injections": a sentence about another name is no definition.
    const opener = String(statement).match(OTHER_SUBJECT_RE);
    if (opener && !norm(term).includes(norm(opener[1])) && !norm(opener[1]).includes(norm(term))) return '';
    if (!definesSomething(statement) || !standsAlone(statement)) return '';
    // "Define "Equal"": a one-word term the definition uses as a predicate ("Two sets are equal if ...") is asked with
    // what it is said of.
    const said = words(term).length === 1 && String(statement).match(new RegExp(`^(.{3,40}?)\\s+(is|are)\\s+(?:said\\s+to\\s+be\\s+)?${escapeRe(term)}\\b`, 'i'));
    if (said && !norm(said[1]).includes(norm(term))) {
      const subj = said[1].replace(/^[A-Z][a-z]+/, (w) => w.toLowerCase());
      return { prompt: `When ${said[2].toLowerCase()} ${subj} ${term.toLowerCase()}?`, answer: statement };
    }
    return { prompt: `Define ${quoted(term)}.`, answer: statement };
  }

  // "When we delete one row, ...": the book's worked example told in the first person, not what the term means.
  const NARRATED_RE = /^(?:when|if|as|once)\s+(?:we|you)\b/i;
  /**
   * Does the definition stand without the sentence before it? Not when it narrates the book's example, nor when its
   * formula names letters it never introduces ("The proposition $\neg q \to \neg p$": of which p and q?).
   */
  function standsAlone(statement) {
    const s = String(statement || '').trim();
    if (NARRATED_RE.test(s)) return false;
    const formulas = s.match(/\$[^$]+\$/g) || [];
    const letters = formulas.join(' ').replace(/\\[a-zA-Z]+/g, ' ').match(/\b[a-z]\b/g) || [];
    return !letters.length || words(s).length > 8 || /\b(?:let|of|where|for|given)\b/i.test(s.replace(/\$[^$]+\$/g, ' '));
  }

  // "Some editors even have …", "Many important discrete structures are …": a quantified subject has no one answer.
  // ("Each column has …": one bare noun after "each" or "every" says nothing of which kind of thing is meant.)
  const QUANTIFIED_START_RE = /^(?:some|most|many|several|few|certain|other|various|lots|all|any)\b|^(?:each|every)\s+\S+\s+\S+\s*…?$/i;
  const MIN_COMPLETION_WORDS = 2;
  // ("To compare strings, …": a purpose clause says which task the rule is for, just as a "When ..." clause does.)
  const LEAD_CLAUSE_RE = /^(?:when|if|in|at|for|after|before|once|while|with|to\s+[a-z]+)\s[^,…]{3,60},\s+\S/i;

  /**
   * Does a key-concept completion ("An array cannot …") pin down one answer a student can recall? Not when the
   * answer is one word ("found", "executed": the prompt already says it), when its subject is quantified ("Some
   * editors"), when it talks to the reader ("Error You cannot …"), or when its subject is neither used again in the
   * scope nor holds a term the scope marks (quizScope.clozeTerms: defined, bold, card fronts): "Lowercase letters are …".
   */
  function pinsOneAnswer(front, back, scope) {
    if (words(back).length < MIN_COMPLETION_WORDS || QUANTIFIED_START_RE.test(front)) return false;
    // "When using multiple if statements, test …", "If the list is sorted, you can …": the opening clause says
    // which case the rule is about (the reader it addresses is then the one in that case).
    if (LEAD_CLAUSE_RE.test(front)) return true;
    if (/\byou\b/i.test(front)) return false;
    const subject = dep('keyStatements', './key-statements.js').subjectOf(front);
    if (!subject) return false;
    if (scope.recurs && scope.recurs(subject)) return true;
    return Boolean(scope.markedTerms) && dep('markedTerms', './marked-terms.js').locate(subject, scope.markedTerms).present.length > 0;
  }

  const IS_FRONT_RE = /^([^,]{3,80}?)\s+(is|are)\s*…$/;
  const CALLED_FRONT_RE = /^([^,]{3,80}?)\s+(is|are)\s+called\s*…$/;
  const STATES_FRONT_RE = /^(.{3,80}?)\s+(?:states|says)\s+that\s*…$/;
  const NOUN_PHRASE_BACK_RE = /^(?:a|an|the|one|two|three)\s/i;
  const PLURAL_PHRASE_BACK_RE = /^(?:[a-z-]+\s+){0,2}[a-z-]+s\s+(?:that|which|who|whose)\b/i;
  const lowerArticle = (s) => (/^(?:The|A|An)\s/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  /**
   * A completion is asked only where it is a definition or a named rule the section states once, the stem ending at
   * "is", "is called" or "states that" and the rest being the whole predicate: "The SR latch is …" => "a circuit ..."
   * becomes "What is the SR latch?", "Ohm's law states that …" becomes "What does Ohm's law state?". Any other
   * completion ("Copying the reference yields …", "An array index must …") has more than one right ending: ''.
   */
  function completionPrompt(front, back) {
    const called = front.match(CALLED_FRONT_RE);
    if (called) return `What ${called[2]} ${lowerArticle(called[1])} called?`;
    const rule = front.match(STATES_FRONT_RE);
    if (rule) return `What does ${lowerArticle(rule[1])} state?`;
    const m = front.match(IS_FRONT_RE);
    if (!m) return '';
    const sn = dep('stemNoise', './stem-noise.js');
    if (sn && sn.hasUnresolvedReference(`${m[1]} ${m[2]} ${back}`)) return '';
    // ("Logic gates are …" => "electronic circuits that operate ...": a plural noun phrase with its qualifier.)
    const nounPhrase = NOUN_PHRASE_BACK_RE.test(back) || (m[2] === 'are' && PLURAL_PHRASE_BACK_RE.test(back));
    // "Surrogate keys are …", "A disjunction is …" => "used when ...", "true when ...": an open stem that any true
    // property of the subject completes; only a defining noun phrase ("a circuit that ...") pins one answer.
    return nounPhrase ? `What ${m[2]} ${lowerArticle(m[1])}?` : '';
  }

  // "Do not fall into a common trap.": advice, not what a term means.
  const ADVICE_RE = /^(?:do\s+not|don['’]t|never|always|be\s+sure|make\s+sure|remember|note|avoid|beware)\b/i;
  const MIN_DEFINITION_WORDS = 4;

  /** Can this text be shown as the meaning of a term? Not a short name ("Protein losing nephropathy") or advice. */
  const definesSomething = (text) => words(text).length >= MIN_DEFINITION_WORDS && !ADVICE_RE.test(String(text).trim());

  const api = { definitionPrompt, completionPrompt, pinsOneAnswer, fullTerm, definesSomething, quoted };
  PDFStudy.recallStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

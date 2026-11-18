/**
 * Recall Questions: a fact that no multiple-choice form can ask honestly (fewer than three wrong options that
 * are false for its subject) is still asked, as a self-graded recall question: the student answers in their
 * head, reveals the answer, and marks "I got it" / "I missed it" (quiz-card.js draws type 'reveal').
 *
 * Prompts say what to recall, never where a line was printed:
 *   definition      Define "Bit string".   (or, when the definition names its term, the term recalled from it:
 *                   Name the term: "A variable is called a ________ if its value is either true or false.")
 *   theorem         State "De Morgan's laws".
 *   lecture Q&A     the lecturer's or the book's own question, as written
 *   table cell      What is the sample for "PCR"?
 *   labelled point  Explain: Praziquantel — adverse effects.
 *   list            Name the 4 key points about "Leptospira spp. (Transmission)".   (or a contrast card's own question)
 *   key concept     Complete: "An array cannot …"
 * Only material that already passed its own gates is used: a quiz fact (quiz-facts.js), or a card the content
 * gate accepts whose answer holds no recognition debris. A point without a label is not asked this way:
 * "Explain: Benzimidazoles" has no single answer. Nor is a completion that does not pin one answer down
 * ("Some editors even have …", "… until a match is …" -> "found") or a "Define" whose answer is a bare name
 * or a piece of advice ("Do not fall into a common trap.").
 *
 * candidates(scope) -> [question] best first (facts in the scope's order, then cards that gave no fact)
 *   question: { type: 'reveal', badge: 'Recall', skill: 'recall', selfGraded: true, question, answer, options: [],
 *               explanation, subject, source, factKey, page, pageNumber }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const content = () => dep('quizContent', './quiz-content.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const statements = () => dep('factStatements', './fact-statements.js');
  const mt = () => dep('mathText', './math-text.js');

  const MAX_ANSWER_CHARS = 600; // a longer answer is a whole slide, not one thing to recall
  const MAX_LABEL_WORDS = 6; // "Praziquantel — Adverse effects"; a longer label is a sentence cut in two
  const MIN_LIST_ITEMS = 2;
  const MAX_LIST_ITEMS = 8;
  const NAMED_RESULT_RE = /^(?:Theorem|Lemma|Corollary|Proposition)\s+[A-Z0-9]/;
  const KEY_POINTS_RE = /^What are the key points of\s+"([^"]+)"/;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const quoted = (t) => (NAMED_RESULT_RE.test(t) ? t : `"${t}"`);
  /** "Adverse Effects" -> "adverse effects"; an acronym or a name keeps its capitals ("PCR", "Taenia"). */
  const lower = (s) => String(s || '').replace(/\b([A-Z])([a-z]+)\b/g, (w, a, b) => a.toLowerCase() + b);
  const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

  function question(prompt, answer, from) {
    return {
      type: 'reveal', badge: 'Recall', skill: 'recall', selfGraded: true, question: prompt, answer, options: [],
      // The explanation shows where the answer comes from: the card or fact as the material states it.
      explanation: String(from.source || ''), subject: from.subject || '', source: from.source, factKey: from.factKey,
      page: from.page || null, pageNumber: from.page || null,
    };
  }

  /** A card's answer is fit to reveal: study content, no debris, not a whole slide. */
  function answerOk(text, scope) {
    const t = String(text || '').trim();
    if (!t || t.length > MAX_ANSWER_CHARS || !mt().isBalanced(t)) return false;
    return !content().isGarbled(t, scope.counts) && !dep('stemNoise', './stem-noise.js').hasExtractionDebris(t);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * A definition that names its own term ("A variable is called a Boolean variable if ...") is asked the other
   * way round: the statement with the term blanked, the term to recall. -> { prompt, answer } | null
   */
  function termRecall(statement, term) {
    const re = new RegExp(`(?<![A-Za-z-])${escapeRe(term)}(?:e?s)?(?![A-Za-z-])`, 'i');
    if (!re.test(statement)) return { named: false };
    const blanked = statement.replace(re, '________');
    // Named twice, one blank would still show the answer; a sentence that leans on another ("Such a circuit
    // is called ...") cannot be read alone. Either way the definition is not asked.
    if (re.test(blanked) || dep('stemNoise', './stem-noise.js').hasUnresolvedReference(blanked)) return { named: true };
    return { named: true, prompt: `Name the term: "${blanked}"`, answer: term };
  }

  const OTHER_SUBJECT_RE = /^([A-Z][\w-]*(?:\s+[A-Z0-9][\w-]*){0,2})\s+(?:is|are|was|were|has|have|requires?|contains?|causes?|uses?|includes?)\b/;

  /** Definition prompt: "Define X." or, when the definition names X, the term recalled from it. */
  function definitionPrompt(term, statement) {
    const recalled = termRecall(statement, term);
    if (recalled.prompt) return recalled;
    // A definition that names its term more than once cannot be blanked, but it can still be revealed for "Define X";
    // one that leans on the sentence before ("Such a circuit is called ...") cannot.
    if (recalled.named && dep('stemNoise', './stem-noise.js').hasUnresolvedReference(statement)) return '';
    // "Killed vaccine" => "Brandname II requires a series of injections": a sentence about another name is no definition.
    const opener = String(statement).match(OTHER_SUBJECT_RE);
    if (opener && !norm(term).includes(norm(opener[1])) && !norm(opener[1]).includes(norm(term))) return '';
    return definesSomething(statement) ? { prompt: `Define ${quoted(term)}.`, answer: statement } : '';
  }

  const YES_NO_Q_RE = /^(?:can|is|are|do|does|did|was|were|will|would|should|could|has|have)\b/i;
  const YES_NO_A_RE = /^(?:yes|no|not|never|always|only|none|usually|rarely)\b/i;

  /** The prompt for one quiz fact, or '' when the fact has no single answer to recall. */
  function factPrompt(fact) {
    const subject = fact.subject || fact.term;
    // "Can you hear air everywhere?" is answered by a yes or a no; a statement after it is the slide's next point.
    if (fact.kind === 'qa') return YES_NO_Q_RE.test(fact.term) && !YES_NO_A_RE.test(String(fact.statement || '').trim()) ? '' : fact.term;
    if (fact.kind === 'definition') return definitionPrompt(subject, fact.statement);
    if (fact.kind === 'theorem') return `State ${quoted(subject)}.`;
    if (fact.kind === 'algorithm') return `Describe ${quoted(subject)}.`;
    return '';
  }

  /** The prompt for a point fact that came from a labelled card ("Praziquantel — Adverse Effects"). */
  function pointPrompt(fact, card) {
    if (!card) return '';
    // A table cell is asked with both of its headers named (table-questions.js), or not at all.
    if (card.table && card.table.column) return dep('tableQuestions', './table-questions.js').stemFor(card);
    const parts = String(card.front || '').split(/\s+[—–]\s+/);
    const tail = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    if (!tail || words(tail).length > MAX_LABEL_WORDS || /[.!?…]$/.test(tail)) return '';
    return `Explain: ${fact.subject} — ${lower(tail)}.`;
  }

  // "Some editors even have …", "Many important discrete structures are …": a quantified subject has no one answer.
  // ("Each column has …": one bare noun after "each" or "every" says nothing of which kind of thing is meant.)
  const QUANTIFIED_START_RE = /^(?:some|most|many|several|few|certain|other|various|lots|all|any)\b|^(?:each|every)\s+\S+\s+\S+\s*…?$/i;
  const MIN_COMPLETION_WORDS = 2;
  const LEAD_CLAUSE_RE = /^(?:when|if|in|at|for|after|before|once|while|with)\s[^,…]{3,60},\s+\S/i;

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
  const NOUN_PHRASE_BACK_RE = /^(?:a|an|the|one|two|three)\s/i;
  const PLURAL_PHRASE_BACK_RE = /^(?:[a-z-]+\s+){0,2}[a-z-]+s\s+(?:that|which|who|whose)\b/i;

  /**
   * A completion asked as a question where its grammar allows: "The SR latch is …" => "a circuit ..." becomes "What is
   * the SR latch?". Other completions ("Copying the reference yields …") are asked as the statement to complete.
   */
  function completionPrompt(front, back) {
    const m = front.match(IS_FRONT_RE);
    // ("Logic gates are …" => "electronic circuits that operate ...": a plural noun phrase with its qualifier.)
    const nounPhrase = NOUN_PHRASE_BACK_RE.test(back) || (m && m[2] === 'are' && PLURAL_PHRASE_BACK_RE.test(back));
    if (!m || !nounPhrase) return `Complete: "${front}"`;
    const subject = /^(?:The|A|An)\s/.test(m[1]) ? m[1][0].toLowerCase() + m[1].slice(1) : m[1];
    return `What ${m[2]} ${subject}?`;
  }

  // "Do not fall into a common trap.": advice, not what a term means.
  const ADVICE_RE = /^(?:do\s+not|don['’]t|never|always|be\s+sure|make\s+sure|remember|note|avoid|beware)\b/i;
  const MIN_DEFINITION_WORDS = 4;

  /** Can this text be shown as the meaning of a term? Not a short name ("Protein losing nephropathy") or advice. */
  const definesSomething = (text) => words(text).length >= MIN_DEFINITION_WORDS && !ADVICE_RE.test(String(text).trim());

  /** A card that gave no fact: a list, a contrast, a key-concept completion, a book's self-check, a box. */
  function cardPrompt(card, scope) {
    const front = String(card.front || '').trim();
    const back = String(card.back || '').trim();
    // A slide's short list ("What are the key points of X?") is a whole slide, so no fact; recalled, it is one question.
    const shortList = card.sourceKind === 'list' && content().cardIsContent({ ...card, category: 'Concept' });
    if (!front || !(content().cardIsContent(card) || shortList)) return '';
    if (card.sourceKind === 'qa' || card.sourceKind === 'self-check') return /\?\s*$/.test(front) ? front : '';
    if (card.sourceKind === 'list') {
      if (/how do they differ\?$/.test(front)) return front;
      const items = back.split('\n').filter((l) => l.trim());
      const m = front.match(KEY_POINTS_RE);
      if (!m || items.length < MIN_LIST_ITEMS || items.length > MAX_LIST_ITEMS) return '';
      return `Name the ${items.length} key points about "${m[1]}".`;
    }
    if (card.sourceKind === 'key-concept' && /…$/.test(front)) return pinsOneAnswer(front, back, scope) ? completionPrompt(front, back) : '';
    // A margin note's advice asked as a question ("When should you use the enhanced for loop?", advice-cards.js) or a
    // syntax box's template ("How do you construct an array?", syntax-cards.js): the card's own question. A rule
    // card is asked by working its rule out (worked-questions.js), a code card is only studied.
    if (!card.rule && (card.sourceKind === 'key-concept' || card.category === 'Syntax') && /^(?:When|How|What|Which|Why)\b[^?]{8,}\?$/.test(front)) return front;
    // A common-error or tip box (boxed-cards.js): its heading names the pitfall, the answer is the book's rule for it
    const box = card.category === 'Rule' && !card.rule ? front.match(RULE_BOX_FRONT_RE) : null;
    if (box) return `${box[1]} (${box[2]}): what goes wrong, and what should you do instead?`;
    if (card.kind === 'theorem' && front && words(front).length <= MAX_LABEL_WORDS) return `State ${quoted(front)}.`;
    if ((card.sourceKind === 'definition' || card.category === 'Definition') && statements().isDefinitionText(back)) {
      const term = card.subject ? subjects().tidySubject(card.subject) : front;
      const named = Boolean(term) && words(term).length <= MAX_LABEL_WORDS && Boolean(subjects().specificOf(term, scope.ctx || {}));
      return named ? definitionPrompt(term, back) : '';
    }
    if (card.table && card.table.column) return dep('tableQuestions', './table-questions.js').stemFor(card);
    return LABELLED_KINDS.has(card.sourceKind) ? labelledPrompt(card, scope) : '';
  }

  // "Using == to Compare Strings (common error)": a rule box's card front
  const RULE_BOX_FRONT_RE = /^(.{6,80}?)\s+\((common error|programming tip|quality tip|common pitfall|pitfall|caution|warning)\)$/i;
  // Cards that print a subject and what the material lists or says under it: asked front -> back as printed.
  const LABELLED_KINDS = new Set(['label', 'table', 'list']);
  const ARROW_PROMPT_RE = /→\s*\?\s*$/;

  /**
   * A labelled card asked as the student sees it: its front names the subject and the label ("Lidocaine — Toxic
   * doses", "Rabies: Human exposure → ?"), the back is what to recall. Not when the front names no specific
   * subject ("Notes", a generic heading alone) or the back is a bare echo of the front.
   */
  function labelledPrompt(card, scope) {
    const front = String(card.front || '').trim();
    const back = String(card.back || '').trim();
    const parts = front.replace(ARROW_PROMPT_RE, '').split(/\s+[—–]\s+|:\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length || !parts.some((p) => subjects().specificOf(p, scope.ctx || {}))) return '';
    if (subjects().isGenericHeading(parts[parts.length - 1], scope.ctx || {}) && parts.length < 2) return '';
    if (norm(back) === norm(front) || norm(front).includes(norm(back))) return '';
    // "... — increased time in the GI" => "increased absorption": a sub-bullet cut in two, not a label and its point.
    if (parts.length > 1 && /^[a-z]/.test(parts[parts.length - 1]) && !ARROW_PROMPT_RE.test(front)) return '';
    if (ARROW_PROMPT_RE.test(front)) return `What follows? ${front}`;
    const items = back.split('\n').filter((l) => l.trim());
    if (items.length > MAX_LIST_ITEMS) return '';
    const subject = front.replace(/\s*[.:]\s*$/, '');
    return items.length >= MIN_LIST_ITEMS ? `Recall the ${items.length} points of "${subject}".` : `Recall: "${subject}".`;
  }

  function candidates(scope) {
    const out = [];
    const qs = dep('quizScope', './quiz-scope.js');
    if (!scope.markedTerms && qs && scope.summary) scope = { ...scope, markedTerms: qs.clozeTerms(scope) };
    const cardBySource = new Map((scope.allCards || []).map((c) => [`${c.front}: ${String(c.back || '').replace(/\s*\n\s*/g, ' ').trim()}`, c]));
    const usedSources = new Set();
    // A fact mined from a running sentence carries no page: it gets the page that prints its sentence.
    const placeOf = (...texts) => (scope.pageOf ? texts.map((t) => scope.pageOf(String(t || ''))).find(Boolean) || null : null);
    const front = (card) => String(card.front || '').replace(/\s*…$/, '');
    for (const fact of scope.facts || []) {
      const card = cardBySource.get(fact.source);
      const asked = fact.kind === 'point' ? pointPrompt(fact, card) : factPrompt(fact);
      const prompt = typeof asked === 'string' ? asked : asked.prompt;
      if (!prompt) continue;
      const answer = typeof asked === 'string' ? (card && card.sourceKind === 'table' ? card.back : fact.statement) : asked.answer;
      if (!prompt || !answerOk(fact.statement, scope) || !answerOk(prompt, scope)) continue;
      usedSources.add(norm(fact.source));
      out.push(question(prompt, answer, { subject: fact.subject, source: fact.source, factKey: fact.identity, page: fact.page || placeOf(fact.source, fact.statement) }));
    }
    for (const card of scope.allCards || []) {
      const back = String(card.back || '').trim();
      const source = `${card.front}: ${back.replace(/\s*\n\s*/g, ' ')}`;
      if (usedSources.has(norm(source))) continue;
      const asked = cardPrompt(card, scope);
      const prompt = typeof asked === 'string' ? asked : asked.prompt;
      if (!prompt || !answerOk(back, scope) || !answerOk(prompt, scope)) continue;
      usedSources.add(norm(source));
      const subject = card.subject || card.front;
      out.push(question(prompt, typeof asked === 'string' ? back : asked.answer, { subject, source, factKey: `r|${norm(source)}`, page: card.pageNumber || card.page || placeOf(back, front(card)) }));
    }
    return out;
  }

  const api = { candidates, MAX_ANSWER_CHARS };
  PDFStudy.recallQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

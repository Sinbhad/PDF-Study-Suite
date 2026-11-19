/**
 * Recall Questions: a fact that no multiple-choice form can ask honestly (fewer than three wrong options that
 * are false for its subject) is still asked, as a self-graded recall question: the student answers in their
 * head, reveals the answer, and marks "I got it" / "I missed it" (quiz-card.js draws type 'reveal').
 *
 * Every prompt is a question a student can answer without the page in front of them, chosen by what the answer is:
 *   definition      Define "Bit string".   Name the term: "A variable is called a ________ if ..."
 *                   (recall-statements.js words definitions and key-concept completions)
 *   theorem         State "De Morgan's laws".
 *   lecture Q&A     the lecturer's or the book's own question, as written
 *   table cell      What is the sample for the assay "PCR"?
 *   labelled card   List the adverse effects of Praziquantel (3 points).   What is the prognosis for an abscess?
 *                   (recall-labels.js words labelled, list, arrow and contrast cards from the slide's nesting)
 *   key concept     What is the SR latch?   (only a definition or a named rule; any other completion is dropped)
 * Only material that already passed its own gates is used: a quiz fact (quiz-facts.js), or a card the content
 * gate accepts whose answer holds no recognition debris. A point read off a labelled card is asked as that label,
 * whole; a point without a label is not asked this way ("Explain: Benzimidazoles" has no single answer).
 *
 * candidates(scope) -> [question] best first (facts in the scope's order, then cards that gave no fact)
 *   question: { type: 'reveal', badge: 'Recall', skill: 'recall', selfGraded: true, question, answer, options: [],
 *               explanation, subject, source, factKey, page, pageNumber, recallGroup? (the table it comes from) }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const content = () => dep('quizContent', './quiz-content.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const statements = () => dep('factStatements', './fact-statements.js');
  const mt = () => dep('mathText', './math-text.js');
  const labels = () => dep('recallLabels', './recall-labels.js');
  const st = () => dep('recallStatements', './recall-statements.js');

  const MAX_ANSWER_CHARS = 600; // a longer answer is a whole slide, not one thing to recall
  const MAX_LABEL_WORDS = 6; // a longer name is a sentence, not a term or a theorem's name

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const quoted = (t) => st().quoted(t);

  function question(prompt, answer, from) {
    return {
      type: 'reveal', badge: 'Recall', skill: 'recall', selfGraded: true, question: prompt, answer, options: [],
      // The explanation shows where the answer comes from: the card or fact as the material states it.
      explanation: String(from.source || ''), subject: from.subject || '', source: from.source, factKey: from.factKey,
      page: from.page || null, pageNumber: from.page || null, ...(from.group ? { recallGroup: from.group } : {}),
    };
  }

  /** A card's answer is fit to reveal: study content, no debris, not a whole slide. */
  function answerOk(text, scope) {
    const t = String(text || '').trim();
    if (!t || t.length > MAX_ANSWER_CHARS || !mt().isBalanced(t)) return false;
    return !content().isGarbled(t, scope.counts) && !dep('stemNoise', './stem-noise.js').hasExtractionDebris(t);
  }

  const YES_NO_Q_RE = /^(?:can|is|are|do|does|did|was|were|will|would|should|could|has|have)\b/i;
  const YES_NO_A_RE = /^(?:yes|no|not|never|always|only|none|usually|rarely)\b/i;

  /** The prompt for one quiz fact, or '' when the fact has no single answer to recall. */
  function factPrompt(fact, card) {
    const subject = st().fullTerm(fact.subject || fact.term, card);
    // "Can you hear air everywhere?" is answered by a yes or a no; a statement after it is the slide's next point.
    if (fact.kind === 'qa') return YES_NO_Q_RE.test(fact.term) && !YES_NO_A_RE.test(String(fact.statement || '').trim()) ? '' : fact.term;
    if (fact.kind === 'definition') return st().definitionPrompt(subject, fact.statement);
    if (fact.kind === 'theorem') return `State ${quoted(subject)}.`;
    if (fact.kind === 'algorithm') return `Describe ${quoted(subject)}.`;
    return '';
  }

  /** A card that gave no fact: a list, a contrast, a key-concept completion, a book's self-check, a box. */
  function cardPrompt(card, scope) {
    const front = String(card.front || '').trim();
    const back = String(card.back || '').trim();
    // A slide's short list ("What are the key points of X?") is a whole slide, so no fact; recalled, it is one question.
    const shortList = card.sourceKind === 'list' && content().cardIsContent({ ...card, category: 'Concept' });
    // A rule card (rule-cards.js and its siblings) is written from checked notation: its own question is asked as it is
    // where its worked question is not (the set refuses a second question from one card). A code card is only studied.
    if (front && card.rule) return card.rule.kind !== 'code' && /\?$/.test(front) && !/```/.test(front) ? front : '';
    if (!front || !(content().cardIsContent(card) || shortList)) return '';
    if (card.sourceKind === 'qa' || card.sourceKind === 'self-check') return /\?\s*$/.test(front) ? front : '';
    // A slide's list, a contrast or a labelled line: worded from the slide's own nesting (recall-labels.js).
    if (card.sourceKind === 'list') return labels().labelled(card, scope) || '';
    if (card.sourceKind === 'key-concept' && /…$/.test(front)) return st().pinsOneAnswer(front, back, scope) ? st().completionPrompt(front, back) : '';
    // A margin note's advice asked as a question ("When should you use the enhanced for loop?", advice-cards.js) or a
    // syntax box's template ("How do you construct an array?", syntax-cards.js): the card's own question.
    if ((card.sourceKind === 'key-concept' || card.category === 'Syntax') && /^(?:When|How|What|Which|Why)\b[^?]{8,}\?$/.test(front)) return front;
    // A common-error or tip box (boxed-cards.js): its heading names the pitfall, the answer is the book's rule for it
    const box = card.category === 'Rule' && !card.rule ? front.match(RULE_BOX_FRONT_RE) : null;
    if (box) return `${box[1]} (${box[2]}): what goes wrong, and what should you do instead?`;
    if (card.kind === 'theorem' && front && words(front).length <= MAX_LABEL_WORDS) return `State ${quoted(front)}.`;
    if ((card.sourceKind === 'definition' || card.category === 'Definition') && statements().isDefinitionText(back)) {
      const term = st().fullTerm(card.subject ? subjects().tidySubject(card.subject) : front, card);
      const named = Boolean(term) && words(term).length <= MAX_LABEL_WORDS && Boolean(subjects().specificOf(term, scope.ctx || {}));
      return named ? st().definitionPrompt(term, back) : '';
    }
    if (card.table && card.table.column) return labels().cellPrompt(card);
    return LABELLED_KINDS.has(card.sourceKind) ? labels().labelled(card, scope) || '' : '';
  }

  // "Using == to Compare Strings (common error)": a rule box's card front
  const RULE_BOX_FRONT_RE = /^(.{6,80}?)\s+\((common error|programming tip|quality tip|common pitfall|pitfall|caution|warning)\)$/i;
  // Cards that print a subject and what the material lists or says under it: recall-labels.js words the prompt from
  // the slide's nesting and gives the complete content under the label as the answer.
  const LABELLED_KINDS = new Set(['label', 'table', 'list']);
  const isLabelled = (card) => Boolean(card) && (LABELLED_KINDS.has(card.sourceKind) || Boolean(card.table && card.table.column));

  function candidates(scope) {
    const out = [];
    const qs = dep('quizScope', './quiz-scope.js');
    if (!scope.markedTerms && qs && scope.summary) scope = { ...scope, markedTerms: qs.clozeTerms(scope) };
    const cardBySource = new Map((scope.allCards || []).map((c) => [`${c.front}: ${String(c.back || '').replace(/\s*\n\s*/g, ' ').trim()}`, c]));
    const usedSources = new Set();
    // A fact mined from a running sentence carries no page: it gets the page that prints its sentence.
    const placeOf = (...texts) => (scope.pageOf ? texts.map((t) => scope.pageOf(String(t || ''))).find(Boolean) || null : null);
    const front = (card) => String(card.front || '').replace(/\s*…$/, '');
    const sourceOf = (card) => `${card.front}: ${String(card.back || '').trim().replace(/\s*\n\s*/g, ' ')}`;
    /** A card's recall question, or null; asked where its first fact (or the card itself) comes in the scope. */
    const fromCard = (card, factKey) => {
      const back = String(card.back || '').trim();
      const source = sourceOf(card);
      if (usedSources.has(norm(source))) return null;
      usedSources.add(norm(source));
      const asked = cardPrompt(card, scope);
      const prompt = typeof asked === 'string' ? asked : asked.prompt;
      const answer = typeof asked === 'string' ? back : asked.answer;
      // (A rule card's code and notation, "`if (floor > 13) ...`", is checked notation, not recognition debris.)
      const fits = (t) => (card.rule ? String(t).length <= MAX_ANSWER_CHARS : answerOk(t, scope));
      if (!prompt || !fits(answer) || !fits(prompt)) return null;
      const subject = card.subject || card.front;
      // The cells of one table are one figure: a set asks a few of them, not all (quizAssembly, recallGroup).
      const group = card.table && card.table.key ? `table|${card.table.key}` : '';
      return question(prompt, answer, { subject, source, factKey: factKey || `r|${norm(source)}`, group, page: card.pageNumber || card.page || placeOf(back, front(card)) });
    };
    for (const fact of scope.facts || []) {
      const card = cardBySource.get(fact.source);
      // A point read off a labelled card is one line of that label: the label is asked whole, with all its lines.
      if (isLabelled(card)) {
        const q = fromCard(card, fact.identity);
        if (q) out.push(q);
        continue;
      }
      if (fact.kind === 'point') continue;
      const asked = factPrompt(fact, card);
      const prompt = typeof asked === 'string' ? asked : asked.prompt;
      if (!prompt) continue;
      const answer = typeof asked === 'string' ? fact.statement : asked.answer;
      if (!answerOk(fact.statement, scope) || !answerOk(prompt, scope)) continue;
      usedSources.add(norm(fact.source));
      out.push(question(prompt, answer, { subject: fact.subject, source: fact.source, factKey: fact.identity, page: fact.page || placeOf(fact.source, fact.statement) }));
    }
    for (const card of scope.allCards || []) {
      const q = fromCard(card);
      if (q) out.push(q);
    }
    return out;
  }

  const api = { candidates, MAX_ANSWER_CHARS };
  PDFStudy.recallQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

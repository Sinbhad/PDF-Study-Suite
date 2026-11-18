/**
 * Quiz Facts: the subject -> statement pairs a scope teaches, in one shape for every question builder.
 *   fromCards(cards, text, ctx)  flashcards that name a subject and say one self-contained thing about it
 *   fromSentences(...)           "A <term> is a ..." sentences of running prose
 *   fromNoteLines(text)          "term - what it is" lines of hand-typed notes
 *   siblings(fact, facts)        same kind of fact about another subject, nearest in the document first
 * Lecture points of a slide deck come from deck-facts.js in the same shape; whether a text may be a
 * statement, a point, a definition or a term is decided by fact-statements.js.
 *
 * fact = { id, term, subject, subjectKey, statement, kind, sourceKind, category, context, page, order,
 *          selfNaming, siblingOnly, source, identity }
 *   term / subject  what the fact is about (the same text; `term` is kept for the builders that say "term")
 *   kind         'definition' | 'theorem' | 'algorithm' | 'point' | 'qa'   (options only mix facts of one kind)
 *   sourceKind   the card's own sourceKind when the card mining set one ('definition', 'label', 'table', ...)
 *   order        position in the document, used to rank siblings by distance
 *   selfNaming   the statement contains its own term ("... is called the length"): usable only as a cloze
 *   siblingOnly  the statement shares a word with its term ("Binary heap" / "a complete binary tree"):
 *                asked either way the shared word would give the match away, so the fact is never
 *                asked itself, but its term and statement still serve as options for its siblings
 *   source       the sentence or card the fact came from (the key a student's "bad question" flag uses)
 *   identity     subject + predicate: one fact however it is asked, in the quiz or in the practice test
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');
  const nf = () => dep('noiseFilter', './noise-filter.js');
  const tok = () => dep('tokenizer', './tokenizer.js');
  const os = () => dep('optionSets', './option-sets.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const content = () => dep('quizContent', './quiz-content.js');

  // Whether a text can be a statement, a point, a definition or a term: fact-statements.js.
  const statements = () => dep('factStatements', './fact-statements.js');
  const isStandalone = (s) => statements().isStandalone(s);
  const isNameable = (t, maxWords) => statements().isNameable(t, maxWords);
  const isPointStatement = (s) => statements().isPointStatement(s);
  const isDefinitionText = (s) => statements().isDefinitionText(s);

  /** Content words of a text as crude stems (math masked out): the unit for leak and duplicate checks. */
  function contentStems(text) {
    const stop = tok().LINGUISTIC_STOPWORDS;
    const plain = mt().mask(String(text || '').replace(/\*\*|__/g, '')).text.replace(/⟦M\d+⟧/g, ' ');
    const words = plain.toLowerCase().match(/[a-z][a-z'’-]*[a-z]/g) || [];
    return words.filter((w) => w.length >= 3 && !stop.has(w)).map(os().stem);
  }

  const termPattern = (term) => new RegExp(`(?:^|[^A-Za-z])${String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?![A-Za-z])`, 'i');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * Builds a fact, or null when the term cannot be named or the statement cannot stand alone.
   * extra.source defaults to "term: statement"; extra.identity to subject + predicate.
   */
  function makeFact(term, statement, extra = {}) {
    if (!isNameable(term) || !isStandalone(statement)) return null;
    const t = term.trim();
    const s = statement.trim();
    const selfNaming = termPattern(t).test(s);
    const termWords = new Set(contentStems(t));
    const shared = contentStems(s).some((w) => termWords.has(w));
    const subjectKey = subjects().subjectKey(t);
    return {
      term: t, subject: t, subjectKey, statement: s, selfNaming, siblingOnly: shared && !selfNaming,
      source: `${t}: ${s}`, identity: `${subjectKey}|${norm(s)}`, ...extra,
    };
  }

  const KIND_OF_CARD = { theorem: 'theorem', algorithm: 'algorithm', definition: 'definition', concept: 'definition' };
  // The card mining's sourceKind -> the kind of fact. Formula cards are asked by stem-questions.js; a note
  // (reminder, aside) carries no fact. Labelled lines, list items, table rows and key concepts are points
  // about the card's subject; the lecturer's self-check questions are asked with sibling answers.
  const KIND_OF_SOURCE = {
    definition: 'definition', label: 'point', list: 'point', table: 'point', 'key-concept': 'point',
    qa: 'qa', 'self-check': 'qa',
  };
  const SKIPPED_CATEGORY_RE = /^(?:Slide Overview|Key Concept|Worked Example)$/;

  /** -> 'definition' | 'theorem' | 'algorithm' | 'point' | 'qa' | null for one card. */
  function factKindOf(card) {
    if (card.sourceKind) return KIND_OF_SOURCE[card.sourceKind] || null;
    if (card.kind === 'qa' || card.category === 'Question') return 'qa';
    if (card.kind === 'overview' || SKIPPED_CATEGORY_RE.test(card.category || '')) return null;
    if (card.category === 'Slide Fact') return 'point';
    return KIND_OF_CARD[card.kind || 'definition'] || null;
  }

  /** The part of a card front that is not its subject: "Epsiprantel — Dogs" about Epsiprantel -> "Dogs". */
  function labelOf(front, subject) {
    const key = subjects().subjectKey(subject);
    const parts = String(front || '').split(/\s+[—–]\s+|\s+-\s+|:\s+/).map((p) => p.trim()).filter(Boolean);
    // "Clinical signs of pneumonia — Bronchitis" about pneumonia: the first part names the subject, "Bronchitis" is
    // the label the line sat under, and stays with it.
    const namesSubject = (p) => subjects().subjectKey(subjects().tidySubject(p)) === key || subjects().subjectKey(subjects().specificOf(p, {}) || '') === key;
    const rest = parts.filter((p) => !namesSubject(p));
    return rest.length && rest.length < parts.length ? rest.join(' — ') : '';
  }

  const MAX_QUESTION_WORDS = 30;
  /**
   * A lecturer's self-check question and its answer. The question is the subject and is asked as
   * written, so it may be long; it must end in a question mark and the answer must stand alone.
   */
  function qaFact(question, answer, extra) {
    const words = question.split(/\s+/).length;
    if (!/\?\s*$/.test(question) || words < 4 || words > MAX_QUESTION_WORDS || !isStandalone(answer)) return null;
    if (sn().hasUnresolvedReference(question) || content().isFillerText(question)) return null;
    const subjectKey = subjects().subjectKey(question);
    return {
      term: question, subject: question, subjectKey, statement: answer, selfNaming: false, siblingOnly: false,
      source: `${question} ${answer}`, identity: `${subjectKey}|${norm(answer)}`, ...extra,
    };
  }

  /**
   * A key-concept completion card ("The null reference refers to …" => "no object") as a point about the concept
   * it names: subject "null reference", statement "Refers to no object." The statement leaves the subject out,
   * so it can be asked "which of these is it true of?" without naming the answer.
   */
  const MIN_STATEMENT_SUBJECT_WORDS = 2;
  // "A common error is ...", "The longer string is ...": an evaluative or comparative word before the noun names
  // no concept, only a remark about one.
  const EVALUATIVE_SUBJECT_RE = /^(?:common|typical|usual|frequent|main|major|important|good|bad|best|worst|simple|other|[a-z]+er)\s/i;

  function conceptFact(card, back, base) {
    const front = String(card.front || '').replace(/\s*…$/, '').trim();
    const subject = dep('keyStatements', './key-statements.js').subjectOf(card.front);
    const at = subject ? front.toLowerCase().lastIndexOf(subject.toLowerCase()) : -1;
    if (at < 0) return null;
    // The book's own key-concept note names a concept on purpose; a statement picked from the prose only when
    // its subject is a compound term ("partially filled array"), not a passing noun ("editors").
    if (card.category !== 'Key Concept' && subject.split(/\s+/).length < MIN_STATEMENT_SUBJECT_WORDS) return null;
    if (EVALUATIVE_SUBJECT_RE.test(subject)) return null;
    const predicate = `${front.slice(at + subject.length).trim()} ${back.replace(/[.\s]+$/, '')}`.trim();
    if (!/^[a-z]/.test(predicate) || /\b(?:it|they|this|these)\b/i.test(predicate)) return null;
    const statement = `${predicate[0].toUpperCase()}${predicate.slice(1)}.`;
    if (!isPointStatement(statement)) return null;
    return makeFact(subject, statement, { ...base, kind: 'point', concept: true, source: base.source });
  }

  /**
   * Flashcards -> facts. ctx: { repeated (quizSubjects.repeatedHeadings), deck (true on a slide deck) }.
   * A card that the content gate refuses, that has no specific subject, or whose statement cannot stand
   * alone gives no fact.
   */
  function fromCards(cards, text, ctx = {}) {
    const flat = String(text || '');
    const out = [];
    (cards || []).forEach((card, i) => {
      const kind = factKindOf(card);
      if (!kind || !content().cardIsContent(card) || mt().isFormula(card.back)) return;
      const page = card.pageNumber || card.page || null;
      const back = tok().cleanMarkdown(String(card.back || '')).replace(/\s*\n\s*/g, ' ').trim();
      const at = flat.indexOf(back.slice(0, 30));
      const order = page ? page * 1000 + i : at >= 0 ? at : flat.length + i;
      const base = {
        kind, sourceKind: card.sourceKind || '', category: card.category || 'Concept', context: card.context || '', page, order,
        // The card's own text, not its position: a position changes when the deck is mined again.
        topic: card.topic || '', source: `${card.front}: ${back}`,
      };
      let fact = null;
      if (kind === 'qa') {
        fact = qaFact(String(card.front || '').trim(), back, base);
      } else if (card.sourceKind === 'key-concept' && /…$/.test(String(card.front || ''))) {
        fact = conceptFact(card, back, base);
      } else if (kind === 'point') {
        const subject = subjects().resolve(card, ctx);
        if (!subject) return;
        const label = labelOf(card.front, subject);
        // "Human exposure → ?" asks for the step after the arrow: the statement is the chain itself, never "→ ?:".
        const arrow = /\s*→\s*\?\s*$/.test(label);
        const statement = arrow ? `${label.replace(/\s*→\s*\?\s*$/, '')} → ${back}`
          : label && !/^(?:[A-Z][a-z]+\s*){1,3}$/.test(back) ? `${label}: ${back}` : back;
        if (!isPointStatement(statement)) return;
        fact = makeFact(subject, statement, base);
      } else {
        const term = (card.subject ? subjects().tidySubject(card.subject) : String(card.front || '')).replace(/\s*\([^)]+\)$/, '').trim();
        if (card.subject && subjects().isGenericHeading(term, ctx)) return;
        if (kind === 'definition' && !isDefinitionText(back)) return;
        fact = makeFact(term, back, base);
      }
      if (fact) out.push(fact);
    });
    return out.map((f, i) => ({ id: `card-${i}`, ...f }));
  }

  /**
   * Running sentences of the form "A <term> is a ..." -> facts (sentence-terms.js reads the grammar).
   * scopeTerm(subject) is the caller's gate: it returns the term as the scope writes it, or null when
   * the subject is not a term the scope keeps using.
   */
  function fromSentences(sentences, text, scopeTerm) {
    const flat = String(text || '');
    const seen = new Set();
    const out = [];
    (sentences || []).forEach((sentence, i) => {
      for (const found of dep('sentenceTerms', './sentence-terms.js').definedIn(sentence)) {
        const term = found.how === 'copula' ? scopeTerm(found.term) : null;
        const key = term ? os().termKey(term) : '';
        if (!key || seen.has(key)) continue;
        // The predicate is shown without its subject, so a pronoun in it would point at nothing.
        if (SUBJECT_PRONOUN_RE.test(found.statement) || !isDefinitionText(found.statement)) continue;
        const at = flat.indexOf(sentence.slice(0, 30));
        const fact = makeFact(term, found.statement, {
          kind: 'definition', category: 'Definition', context: '', page: null, order: at >= 0 ? at : flat.length + i, source: sentence,
        });
        if (!fact) continue;
        seen.add(key);
        out.push(fact);
      }
    });
    return out.map((f, i) => ({ id: `sentence-${i}`, ...f }));
  }

  const SUBJECT_PRONOUN_RE = /\b(?:it|its|they|them|their)\b/i;
  // Labels a note-taker puts before a remark; what follows is not a definition of the label.
  const NOTE_LABEL_RE = /^(?:mnemonic|eg|ex|nb|reminder|remember|recall|todo|tip|trick|aka|ie|exceptions?|hw|exam|quiz|due|ask|see|ps)$/i;
  const NOTE_LINE_RE =/^([A-Za-z][A-Za-z0-9'’ -]{1,38}?)\s*(?:\s[-–—=]\s|:\s|\s->\s)\s*(\S.{10,200})$/;
  const MIN_NOTE_LINES = 3;
  const MAX_NOTE_LINE_MEDIAN = 60; // typed notes are short lines; wrapped book prose is not

  /** Hand-typed notes: "ionic bond - transfer of electrons from a metal to a nonmetal" lines -> facts. */
  function fromNoteLines(text) {
    const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const lengths = lines.map((l) => l.length).sort((a, b) => a - b);
    if (!lines.length || lengths[Math.floor(lengths.length / 2)] > MAX_NOTE_LINE_MEDIAN) return [];
    const stop = tok().PHRASE_BREAK_WORDS;
    const out = [];
    lines.forEach((line, i) => {
      const m = line.match(NOTE_LINE_RE);
      const words = m ? m[1].trim().toLowerCase().split(/\s+/) : [];
      if (!m || words.length > 4 || words.some((w) => stop.has(w)) || NOTE_LABEL_RE.test(m[1].trim())) return;
      const statement = m[2].trim();
      const fact = makeFact(m[1].trim(), statement[0].toUpperCase() + statement.slice(1), {
        kind: 'definition', category: 'Note', context: '', page: null, order: i, source: line,
      });
      if (fact) out.push(fact);
    });
    return out.length >= MIN_NOTE_LINES ? out.map((f, i) => ({ id: `note-${i}`, ...f })) : [];
  }

  /** Facts of the same kind about another subject, nearest in the document first. */
  function siblings(fact, facts) {
    const key = fact.subjectKey || os().termKey(fact.term);
    return facts
      .filter((o) => o !== fact && o.kind === fact.kind && !o.selfNaming && (o.subjectKey || os().termKey(o.term)) !== key)
      .sort((a, b) => Math.abs(a.order - fact.order) - Math.abs(b.order - fact.order));
  }

  const api = { fromCards, fromSentences, fromNoteLines, siblings, contentStems, isStandalone, isNameable, isPointStatement, makeFact, factKindOf };
  PDFStudy.quizFacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Deterministic Non-AI Quiz Generator.
 * quiz-scope.js gathers what the selected scope teaches; five families of builders then propose questions:
 *   structured  slide definitions / lecture Q&A / worked problems (slide-quiz.js) or textbook theorem and
 *               definition blocks (block-quiz.js)
 *   formula     name -> expression for formula and complexity cards (stem-questions.js)
 *   table       a comparison table asked down one column, other rows' values as options (table-questions.js), and
 *               its remarks column row by row (table-notes.js)
 *   list        a labelled list asked by membership against its sibling lists (list-questions.js)
 *   number      a fact's one quantity among the scope's other values of that unit (number-questions.js)
 *   fact        every good flashcard, defining sentence and lecture point, asked subject -> statement,
 *               statement -> subject or as a True/False whose False half borrows a sibling subject's
 *               statement that is false of this one (fact-questions.js)
 *   cloze       a marked term blanked out of a self-contained sentence (cloze-questions.js)
 *   naming      a sentence that names a term, kept or with a sibling term swapped in (naming-questions.js)
 * quiz-assembly.js keeps a question only if the set does not already ask for that answer, offer those
 * options or test that fact. A short scope therefore yields fewer questions, never padded ones. A statement
 * the set borrowed for a False is not asked again about its own subject, and a statement the quiz offered as
 * a wrong option is not borrowed for a False of the practice test.
 *
 * Choice questions are drawn first. Then a typed round (typed-round.js) asks, with an answer the student types and
 * the app checks, the definitions, blanks, table cells, numbers and worked answers where one short answer is right.
 * Then a recall round (recall-questions.js) asks, self-graded, the facts and cards no choice or typed form could ask,
 * in every slot left: a set is short only when the scope has no more to ask.
 *
 * generateQuiz(input, { maxQuestions, mode, didacticBlocks, seedOffset, variant, excludeSources, avoid, cards, reviewOf })
 *   cards           the flashcards the app shows for the scope; they are what the quiz asks (mined when absent)
 *   lines           extraction's scope.lines of a textbook scope: a sentence question gets the page it is printed on
 *   reviewOf        questions asked already (the quiz, when the practice test runs out of facts): a fact they
 *                   ask may be asked again only in another form (another question type)
 *   maxSelfGraded   at most this many self-graded questions (a practice test's review round shares the test's third)
 *   seedOffset      reshuffles which siblings and sentences are used (the "new quiz" button)
 *   variant         0 for the quiz, 1 for the practice test: it rotates the form each fact is asked in and
 *                   the order of the families
 *   excludeSources  Set of source keys (studyKeys.sourceKey, 's…') or source texts the student flagged as
 *                   bad questions: nothing built from those sentences or cards is asked
 *   avoid           questions already asked elsewhere (the quiz, when building the practice test): no
 *                   question about the same fact is asked again
 * Every question carries `source` (the sentence or card it was built from: the key a flag is stored
 * under), `factKey` (subject + predicate, or the source sentence) and, where it has one, `subject`.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  function getDeps() {
    return {
      scope: dep('quizScope', './quiz-scope.js'),
      gate: dep('quizGate', './quiz-gate.js'),
      optionSets: dep('optionSets', './option-sets.js'),
      distractors: dep('stemDistractors', './stem-distractors.js'),
      stemQuestions: dep('stemQuestions', './stem-questions.js'),
      factQuestions: dep('factQuestions', './fact-questions.js'),
      cloze: dep('clozeQuestions', './cloze-questions.js'),
      naming: dep('namingQuestions', './naming-questions.js'),
      assembly: dep('quizAssembly', './quiz-assembly.js'),
      keys: dep('studyKeys', './study-keys.js'),
      recall: dep('recallQuestions', './recall-questions.js'),
      table: dep('tableQuestions', './table-questions.js'),
      worked: dep('workedQuestions', './worked-questions.js'),
      typedRound: dep('typedRound', './typed-round.js'),
      tableNotes: dep('tableNotes', './table-notes.js'),
      lists: dep('listQuestions', './list-questions.js'),
      numbers: dep('numberQuestions', './number-questions.js'),
    };
  }

  // The order in which the families take turns; structured and fact questions get two turns per round, and
  // worked questions (a rule of the section applied, the key computed) three, first. A family with nothing to
  // ask gives its turn away, so a scope without checkable rules is drawn exactly as before.
  // A sentence can often be asked either as a cloze or as a naming True/False, and whichever family
  // comes first takes it: the quiz lets cloze go first, the practice test lets naming go first.
  // A labelled list asked by membership and a single quantity asked among the scope's other values of its unit take a
  // turn after the table family (list-questions.js, number-questions.js).
  const TURNS = [
    ['worked', 'structured', 'fact', 'formula', 'worked', 'table', 'list', 'structured', 'cloze', 'number', 'worked', 'fact', 'naming'],
    ['worked', 'structured', 'fact', 'table', 'number', 'worked', 'formula', 'list', 'structured', 'naming', 'worked', 'fact', 'cloze'],
  ];
  // Worked questions fill at most this share of a set: the section's terms and facts are asked too.
  const MAX_WORKED_SHARE = 0.5;
  const FACT_FORMS = ['name', 'describe', 'trueFalse'];
  const CLOZE_REDRAWS = 2;
  const OPTION_REDRAWS = 2; // other draws of a fact's nearest siblings when its options were offered already

  const normKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** The fact a sentence question tests: the sentence itself (case, spacing and punctuation folded). */
  const sentenceKey = (sentence) => `s|${normKey(sentence)}`;

  function generateQuiz(input, options = {}) {
    const { maxQuestions = 10, mode = 'book', didacticBlocks = [], seedOffset = 0, variant = 0 } = options;
    const D = getDeps();
    const scope = D.scope.gather(input, { maxQuestions, mode, didacticBlocks, seedOffset, cards: options.cards, lines: options.lines });
    if (!scope) return [];
    const set = D.assembly.createSet(maxQuestions, {
      avoid: options.avoid || [],
      reviewOf: options.reviewOf || [],
      excludeSources: options.excludeSources,
      sourceKey: D.keys ? D.keys.sourceKey : null,
      gradedOnly: Boolean(options.gradedOnly),
      selfGradedRoom: 0, // choice questions first; the recall round below opens the room
    });
    const forms = D.optionSets.textForms(scope.text);

    // Formula and complexity cards are asked name -> expression, never the reverse.
    const formulaCards = scope.cards.filter(D.stemQuestions.isFormulaCard);
    const formulaPool = formulaCards.map((c) => c.back.trim());
    const formulaQuestions = formulaCards.map((c) => {
      const q = D.stemQuestions.formulaQuestion(c, formulaPool, '', seedOffset);
      return q ? { ...q, source: `${c.front}: ${c.back}` } : null;
    }).filter(Boolean);

    // One question per fact; the form rotates with the fact's position and the variant.
    // True/False goes False first, then True, alternating: the mix stays even and no True stands alone.
    // `shown`: statements a question already shows; a slide or block question counts from the start.
    const shown = new Set(scope.structured.map((q) => normKey((String(q.question).match(/\n"([\s\S]*)"\s*$/) || [])[1])).filter(Boolean));
    // Statements that questions elsewhere already showed (the quiz, when the practice test is drawn) are not
    // borrowed for a False either: shown again under another subject, the student has seen them before.
    // A statement offered there as a wrong option counts as shown too: borrowed again it is the same trick.
    for (const q of options.avoid || []) {
      const quoted = (String(q.question || '').match(/\n"([\s\S]*)"\s*$/) || [])[1];
      if (quoted) shown.add(normKey(quoted));
      if (q.type !== 'true_false' && q.answer) shown.add(normKey(q.answer));
      if (q.type === 'multiple_choice') for (const o of q.options || []) shown.add(normKey(o));
    }
    const factCtx = {
      facts: scope.facts, seed: seedOffset, forms, claimed: new Set(), shown, described: new Map(), claims: scope.claims, kinds: scope.kinds,
      peers: scope.peers, text: scope.text,
    };
    let factAt = 0;
    let factSwaps = 0;
    const donated = new Set(); // statements borrowed for a False in this set
    const nextFact = () => {
      while (factAt < scope.facts.length) {
        const index = factAt++;
        const fact = scope.facts[index];
        // A statement this set already borrowed for a False is not asked again about its own subject.
        if (donated.has(normKey(fact.statement))) continue;
        for (let k = 0; k < FACT_FORMS.length; k++) {
          const form = FACT_FORMS[(index + variant + k) % FACT_FORMS.length];
          const wantTrue = factSwaps % 2 === 1;
          // When the wanted truth value cannot be built for this fact, the other one may still be. A choice
          // question whose options the set already offered is drawn again from the next-nearest siblings.
          let q = null;
          if (form === 'trueFalse') {
            const built = D.factQuestions.trueFalse(fact, factCtx, wantTrue) || D.factQuestions.trueFalse(fact, factCtx, !wantTrue);
            q = set.accept(built) ? built : null;
          } else {
            for (let redraw = 0; redraw <= OPTION_REDRAWS && !q; redraw++) {
              const built = D.factQuestions[form](fact, redraw ? { ...factCtx, seed: factCtx.seed + redraw } : factCtx);
              if (!built) break;
              if (set.accept(built)) q = built;
            }
          }
          if (!q) continue;
          // A subject that has been asked about is not named again in a later True/False of the set, and
          // a statement the set has shown is not borrowed for a later False.
          factCtx.claimed.add(fact.subjectKey);
          factCtx.shown.add(normKey(fact.statement));
          if (q.shows) {
            factCtx.shown.add(normKey(q.shows));
            donated.add(normKey(q.shows));
          }
          if (form === 'describe') factCtx.described.set(fact.subjectKey, (factCtx.described.get(fact.subjectKey) || 0) + 1);
          if (form === 'trueFalse') factSwaps++;
          return true;
        }
      }
      return false;
    };

    // Sentences and terms are only worked out when a sentence family gets its first turn.
    let sentenceCtx = null;
    const sentenceWork = () => {
      if (!sentenceCtx) {
        sentenceCtx = {
          sentences: D.scope.clozeSentences(scope, seedOffset),
          terms: D.scope.clozeTerms(scope),
          seed: seedOffset,
          variant,
          forms,
          kinds: scope.kinds,
          text: scope.text, // a blank before a noun only takes terms the text writes before that noun
          // What the scope defines each term as (facts and definition cards): a cloze option defined as a kind of
          // the answer is not offered (cloze-questions.js).
          definitions: [...scope.facts.filter((f) => f.kind === 'definition').map((f) => ({ term: f.term, statement: f.statement })),
            ...scope.allCards.filter((c) => D.factQuestions && /definition|theorem/i.test(`${c.category} ${c.sourceKind}`)).map((c) => ({ term: String(c.front || ''), statement: String(c.back || '') }))],
          skip: (term) => set.asked(term),
        };
      }
      return sentenceCtx;
    };
    // A sentence question remembers its sentence, so the set never asks one sentence twice. On a deck
    // it also carries its slide number, and a sentence that cannot be placed on a slide is not asked.
    const placed = (q, sentence) => {
      if (!q) return null;
      const tagged = { ...q, source: sentence, sourceKey: normKey(sentence), factKey: sentenceKey(sentence) };
      const page = scope.pageOf(sentence);
      if (!scope.isDeck) return page ? { ...tagged, page, pageNumber: page } : tagged;
      return page ? { ...tagged, page, pageNumber: page } : null;
    };
    let clozeAt = 0;
    const nextCloze = () => {
      const ctx = sentenceWork();
      while (clozeAt < ctx.sentences.length) {
        const sentence = ctx.sentences[clozeAt++];
        // With few terms two blanks can draw the same options; another draw of the nearest terms may not.
        for (let redraw = 0; redraw <= CLOZE_REDRAWS; redraw++) {
          const q = D.cloze.forSentence(sentence, { ...ctx, seed: ctx.seed + redraw });
          if (set.accept(placed(q, sentence))) return true;
          if (!q) break;
        }
      }
      return false;
    };
    let namingAt = 0;
    let namingSwaps = 0;
    const nextNaming = () => {
      const ctx = sentenceWork();
      while (namingAt < ctx.sentences.length) {
        const sentence = ctx.sentences[namingAt++];
        if (set.accept(placed(D.naming.forSentence(sentence, ctx, namingSwaps % 2 === 1), sentence))) {
          namingSwaps++;
          return true;
        }
      }
      return false;
    };

    const turns = TURNS[variant % TURNS.length];
    const withSource = (q) => (q.source || !D.keys ? q : { ...q, source: D.keys.questionSource(q) });
    const structured = scope.structured.map(withSource);
    const factBySource = new Map(scope.facts.map((f) => [f.source, f]));
    const fromSlidesOrCards = {
      structured: D.assembly.listFamily(set, structured.filter((q) => !D.assembly.isSelfGraded(q))),
      formula: D.assembly.listFamily(set, formulaQuestions),
      table: D.assembly.listFamily(set, [
        ...D.table.candidates(scope.allCards, { seed: seedOffset + variant, factOf: (source) => factBySource.get(source) }),
        ...(D.tableNotes ? D.tableNotes.candidates(scope.allCards, { seed: seedOffset + variant, isDeck: scope.isDeck }) : []),
      ]),
      list: D.assembly.listFamily(set, D.lists ? D.lists.candidates(scope.allCards, { seed: seedOffset + variant }) : []),
      number: D.assembly.listFamily(set, D.numbers ? D.numbers.candidates(scope, { seed: seedOffset + variant }) : []),
      fact: nextFact,
    };
    // Worked questions come from the rule cards the student sees (opts.cards; mined cards otherwise), each kind in
    // turn; the variant and seed choose other instances for the practice test and for "New quiz".
    // (A card that is itself a rule carries `rule`; a definition card that also states one carries `teaches`.)
    const ruleCards = (Array.isArray(options.cards) ? options.cards : scope.allCards).filter((c) => c && (c.rule || c.teaches));
    const workedList = D.worked && ruleCards.length ? D.worked.build(ruleCards, { seed: seedOffset, variant }) : [];
    const workedRoom = Math.ceil(maxQuestions * MAX_WORKED_SHARE);
    const nextWorked = D.assembly.listFamily(set, workedList);
    let workedTaken = 0;
    fromSlidesOrCards.worked = () => workedTaken < workedRoom && nextWorked() && ++workedTaken > 0;
    const fromSentences = { cloze: nextCloze, naming: nextNaming };
    if (scope.isDeck) {
      // A deck's own definitions, questions and points are asked first; its few running sentences
      // restate them, so they only fill what room is left.
      D.assembly.fill(set, fromSlidesOrCards, turns);
      D.assembly.fill(set, fromSentences, turns);
    } else {
      D.assembly.fill(set, { ...fromSlidesOrCards, ...fromSentences }, turns);
    }

    // Typed round (typed-round.js): what the choice forms left is asked with an answer the app checks.
    if (D.typedRound) {
      D.typedRound.fill(set, { scope, ctx: sentenceWork(), placed, ruleCards, factOf: (source) => factBySource.get(source), seed: seedOffset, variant });
    }

    // Recall round: what no choice form could ask honestly is asked self-graded. The choice families have run
    // dry by now, so the recall round may fill every slot left: a short set only when the scope has no more.
    const share = maxQuestions - set.size();
    set.allowSelfGraded(Number.isFinite(options.maxSelfGraded) ? Math.min(share, options.maxSelfGraded) : share);
    D.assembly.fill(set, {
      structured: D.assembly.listFamily(set, structured.filter(D.assembly.isSelfGraded)),
      recall: D.assembly.listFamily(set, D.recall.candidates(scope)),
    }, ['structured', 'recall']);

    // Builder-internal fields stay inside; questions are numbered q-1..q-N.
    return set.list().map(({ factId, claims, sourceKey, shows, pointOptions, ...q }, i) => ({
      ...q, id: `q-${i + 1}`, page: q.page || q.pageNumber || null, factKey: q.factKey || sentenceKey(q.source),
    }));
  }

  const selectDistractors = (...a) => getDeps().distractors.selectDistractors(...a); // kept for API compatibility
  const getShapeBucket = (t) => getDeps().gate.getShapeBucket(t);
  PDFStudy.quizEngine = { generateQuiz, selectDistractors, getShapeBucket };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.quizEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

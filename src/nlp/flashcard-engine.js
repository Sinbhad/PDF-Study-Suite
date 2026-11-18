/**
 * Deterministic Rule-Based Flashcard Generator (Slides & STEM/Academic Textbooks)
 * Extracts Boxed Definitions, Named Theorems, Guidelines, Bold Key Terms, and Syntactic Definitions.
 * Book text is read through content-spans.js first (no worked examples, biographies, captions); every card
 * must stand alone (self-contained.js) and leaves with subject / sourceKind / page (card-fields.js).
 * Sources by module: definition-rules.js (sentence patterns), prose-definitions.js (defining clauses),
 * boxed-cards.js (tagged and numbered boxes), key-statements.js (facts without terms), contrast-cards.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function getDeps() {
    const tokenizer =
      PDFStudy.tokenizer || (typeof require === 'function' ? require('./tokenizer.js') : null);
    const boldTerms =
      PDFStudy.boldTerms || (typeof require === 'function' ? require('./bold-terms.js') : null);
    const noiseFilter =
      PDFStudy.noiseFilter || (typeof require === 'function' ? require('./noise-filter.js') : null);
    return { tokenizer, boldTerms, noiseFilter };
  }

  // Boilerplate/exercise noise comes from shared noise-filter.js; "second degree" ordinals are local.
  const DEGREE_TERM_RE = /\b(?:zeroth|first|second|third|fourth|nth)\s+degree\b/i;
  // Two or more capitalised words, joined by nothing but "of / the / and": a proper name.
  const PROPER_NAME_RE = /^[A-Z][\w'’-]*(?:\s+(?:(?:of|the|and)\s+)*[A-Z][\w'’-]*)+$/;
  const NO_INVALID_STARTS = new Set();
  const ORGANISATION_RE =
    /\b(?:Institute|Association|Society|Organi[sz]ation|Committee|University|College|Corporation|Council|Foundation|Agency|Administration|Department|Bureau|Academy|Federation|Union|Board)\b/;

  const nf = () => getDeps().noiseFilter;
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const stemCards = () => dep('stemCards', './stem-cards.js');
  const mathText = () => dep('mathText', './math-text.js');
  const isNoise = (t) => Boolean(nf() && nf().isNoise(t)) || DEGREE_TERM_RE.test(t);
  const isTermNoise = (t) => isNoise(t) || Boolean(nf() && nf().isTermNoise(t));
  // Standalone sentences (not didactic bodies) must not dangle ("This means..."), be fragments or questions.
  const isBadSentence = (t) => isNoise(t) || dep('stemNoise', './stem-noise.js').isUnusableSentence(t);

  function isValidTerm(term, invalidStarts, maxWords = 9) {
    if (!term) return false;
    const clean = term.replace(/[*_]/g, '').trim();
    const words = clean.split(/\s+/);
    if (words.length < 1 || words.length > maxWords) return false;
    if (clean.length < 3 || clean.length > maxWords * 9) return false;
    if (invalidStarts.has(words[0].toLowerCase())) return false;
    if (isTermNoise(clean) || /^\d+$/.test(clean)) return false;
    return true;
  }

  /**
   * Cards of a textbook section. `opts.lines` (scope.lines from extraction: { text, kind, isAnnotation }) tags
   * captions, sidebars and code when present; examples, biographies and code are found from the text otherwise.
   */
  function extractBookFlashcards(rawText, contextLabel = 'Book Section', didacticBlocks = [], opts = {}) {
    if (dep('stemNoise', './stem-noise.js').isAnswerKeySection(rawText)) return [];
    // Worked examples, biography sidebars, captions and stray code are not exposition (content-spans.js).
    const text = dep('contentFilter', './content-filter.js').studyText(rawText, { tags: opts.lines });
    const { tokenizer, boldTerms } = getDeps();
    const { INVALID_TERM_STARTS, cleanMarkdown, splitSentences } = tokenizer;
    const cards = [];
    const seen = new Set();
    const quality = dep('cardQuality', './card-quality.js');
    const selfContained = dep('selfContained', './self-contained.js');
    const topicOf = quality.topicFinder(text, contextLabel, tokenizer.isHeadingLine);

    /** Appends a finished card; `source` is the sentence it came from, used to find its heading (topic). */
    function pushCard(front, back, category, extra = {}) {
      const pageNumber = extra.pageNumber || null;
      cards.push({
        id: `fc-${cards.length + 1}`,
        front,
        back,
        context: pageNumber ? `${contextLabel} (p. ${pageNumber})` : contextLabel,
        pageNumber,
        category,
        kind: extra.kind || stemCards().kindOf(category),
        topic: extra.topic || topicOf(extra.source),
        ...(extra.subject ? { subject: extra.subject } : {}),
        ...(extra.sourceKind ? { sourceKind: extra.sourceKind } : {}),
        // A rule card's checkable rule (worked-questions.js) and the text the scope prints for it
        ...(extra.rule ? { rule: extra.rule, quote: extra.quote || '' } : {}),
        // A table cell's row and headers, so its question names both columns (table-questions.js)
        ...(extra.table ? { table: extra.table } : {}),
      });
    }

    const flat = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    /** Does a card made so far show this sentence (or does the sentence hold that card's whole back)? */
    const restatesCard = (sentence) => {
      const s = flat(sentence);
      return s.length >= 20 && cards.some((c) => { const b = flat(c.back); return b.length >= 20 && (b.includes(s) || s.includes(b)); });
    };

    /** Cards that arrive whole (key statements, self-check Q&A, table cells): same key, same stand-alone gate. */
    function addFact(card) {
      const list = card.sourceKind === 'table' || card.sourceKind === 'self-check';
      // A table row named by a symbol (">=", "!=") keeps its symbol in the key; a term key would drop it.
      const key = `fact:${card.sourceKind === 'table' ? quality.frontKey(card.front) : boldTerms ? boldTerms.termKey(card.front) : card.front.toLowerCase()}`;
      if (seen.has(key) || selfContained.reason(card, { list })) return false;
      // "The Richter scale is …": a statement about a worked example's prop.
      const about = card.category === 'Key Statement' ? dep('keyStatements', './key-statements.js').subjectOf(card.front) : '';
      if (about && quality.introducedByExample(about, text)) return false;
      // A completion ("The null reference refers to … no object") of a sentence another card already shows whole
      // asks one fact twice.
      if (/…$/.test(card.front) && restatesCard(`${card.front.replace(/\s*…$/, '')} ${card.back}`)) return false;
      seen.add(key);
      pushCard(card.front, card.back, card.category, { ...card, pageNumber: card.page || null, source: card.sentence || card.back });
      return true;
    }

    // A card exists only when the text defines or states something: no keyword-frequency filler cards.
    function addCard(front, back, category, pageNumber, boxed, source, concise) {
      let fClean = cleanMarkdown(front).replace(/^(the|a|an)\s+/i, '').trim();
      if (/^[a-z]{2}/.test(fClean)) fClean = fClean[0].toUpperCase() + fClean.slice(1); // "infinite limit" -> "Infinite limit"
      const didactic = /^(?:Theorem|Definition|Guideline|Rule|Law|Corollary|Lemma|Algorithm|Formula|Summary)$/.test(category);
      // A key term names one thing: "Four conditions must hold for it to arise" is a sentence start, not a term.
      // A proper name ("Declaration of the Rights of Man and of the Citizen", "Third Estate") is one thing however long.
      const properName = PROPER_NAME_RE.test(fClean);
      if (category === 'Key Term' && !quality.goodFront(fClean, { maxWords: properName ? 10 : 6 })) return false;
      const lines = String(back || '').split('\n').map((l) => cleanMarkdown(l)).filter(Boolean).join('\n'); // list backs keep their lines
      let bClean = mathText().safeSlice(lines, didactic ? 950 : 460);
      // "Primary Keys When designing a database, ...": a heading glued onto the sentence under it is cut off.
      if (category === 'Key Term') bClean = dep('proseDefinitions', './prose-definitions.js').dropGluedHeading(bClean);
      if (/^[a-z]/.test(bClean)) bClean = bClean[0].toUpperCase() + bClean.slice(1);
      if (!mathText().isBalanced(bClean) || dep('stemNoise', './stem-noise.js').isFragment(bClean)) return false;
      if (!isValidTerm(fClean, properName ? NO_INVALID_STARTS : INVALID_TERM_STARTS, didactic ? 14 : properName ? 10 : 9)) return false;
      const realWords = bClean.match(/\b[A-Za-z]{3,}\b/g) || [];
      const formula = /^(?:Formula|Algorithm)$/.test(category) && mathText().hasMath(bClean);
      // `concise` = a defining clause cut out of its sentence ("A legal maximum price."): short but complete.
      const minWords = formula ? 0 : didactic && boxed ? 1 : concise ? 2 : 5;
      if (realWords.length < minWords || bClean.length < (boxed || formula ? 6 : concise ? 10 : 24) || isNoise(boxed ? bClean.replace(/^\d{1,2}\.\s+/gm, '') : bClean)) return false; // a boxed "1. $...$" item is not an exercise
      // "Theorem 1.2 — ..." == "Theorem 1.2: ..."; "Step functions" == "step function"; "Gibbs Free Energy (G)" == "Gibbs Free Energy"
      const thm = fClean.match(/^theorem\s+[A-Z0-9]+\.\d+/i);
      const key = thm ? thm[0].toLowerCase() : boldTerms ? boldTerms.termKey(fClean) : fClean.toLowerCase();
      if (seen.has(key)) return false;
      if (category === 'Key Term' && (quality.restatesFront(bClean, fClean) || quality.leansBack(bClean))) return false;
      // A sentence that only mentions the term ("... formed using logical operators") does not say what it is.
      if (category === 'Key Term' && !boxed && dep('cardAnswers', './card-answers.js').mentionsOnly(fClean, bClean)) return false;
      // A prop of a worked example (the scale an example program measures with) is not a term of the section.
      if (category === 'Key Term' && !boxed && quality.introducedByExample(fClean, text)) return false;
      // A card is studied alone: no "this condition", "(here, 10)", praise, or the author talking to the reader.
      // (A term the author set in bold may be named in the author's voice: "you need a limit called a **...**".)
      const emphasised = text.toLowerCase().includes(`**${fClean.toLowerCase()}`) && /\b(?:called|known\s+as|termed|named)\b/i.test(bClean);
      if (selfContained.reason({ front: fClean, back: bClean }, { prose: category === 'Key Term' && !boxed && !emphasised })) return false;
      seen.add(key);
      pushCard(fClean, bClean, category, { pageNumber, source: source || back });
      return true;
    }

    /**
     * A rule card (rule-cards.js) is built from checked notation, so the sentence gates do not apply. Its front
     * holds symbols a term key would drop ("Simplify X + X" vs "Simplify X ⋅ X"): it is keyed as written.
     */
    function addRuleCard(card) {
      const key = `rule:${card.front}`;
      if (seen.has(key)) return false;
      // A definition box already made a card of the same sentence: the rule rides on that card instead
      const probe = flat(card.quote).slice(0, 40);
      const twin = card.rule.kind === 'set' && probe.length >= 20 ? cards.find((c) => !c.rule && flat(c.back).includes(probe)) : null;
      if (twin) {
        twin.teaches = card.rule;
        return false;
      }
      seen.add(key);
      pushCard(card.front, card.back, card.category, { ...card, pageNumber: card.page || null, source: card.quote || card.back });
      return true;
    }

    /** Note-style cards are fragments by nature, so they skip the sentence gates above (note-patterns.js has its own). */
    function addNoteCard(card) {
      const front = /^[a-z]{3,}(?=[\s-]|$)/.test(card.front) ? card.front[0].toUpperCase() + card.front.slice(1) : card.front;
      const key = boldTerms ? boldTerms.termKey(front) : front.toLowerCase();
      if (seen.has(key) || isNoise(front)) return false;
      seen.add(key);
      pushCard(front, card.back, card.category, { kind: card.kind, topic: card.topic || contextLabel });
      return true;
    }

    // 1. First-Class STEM Didactic Blocks (Definitions, Theorems, Rules, Algorithms...): boxed text is trusted as-is.
    //    Blocks extraction tags as margin notes, self-checks, tables or syntax boxes become cards of their own kind;
    //    examples and sidebars become none (boxed-cards.js).
    const boxed = dep('boxedCards', './boxed-cards.js');
    const tagged = boxed.fromBlocks(didacticBlocks);
    for (const blk of tagged.didactic) {
      addCard(blk.title, stemCards().didacticBack(blk), blk.category, blk.pageNumber, true);
    }
    // Numbered boxes ("Definition 4") are cards named by the term they define; the box wins over any prose
    // sentence that defines the same term later.
    for (const box of tagged.boxes) {
      if (addFact(box)) seen.add(boldTerms ? boldTerms.termKey(box.front) : box.front.toLowerCase());
    }
    // 1a. "Definition 4 ..." / "Theorem 2 (Name) ..." boxes whose frame the extraction did not keep.
    for (const c of boxed.fromText(text)) addCard(c.front, c.back, c.category, null, true);
    // 1b. Named theorems/rules, core formulas, complexities & recurrences stated in running text
    for (const sc of stemCards().extractStemCards(text, splitSentences)) addCard(sc.front, sc.back, sc.category);

    // 1c. Rules the section teaches that a question can work out (section-rules.js): its laws and identities, the
    //     operators of its truth tables, bit operations, the 2^n counts. Read from the whole scope text, displays
    //     included; each card carries the rule for worked-questions.js.
    const ruleInput = { text: rawText, blocks: didacticBlocks, lines: opts.lines, startPage: firstPage(opts.lines) };
    ruleInput.tables = (didacticBlocks || []).filter((b) => b && b.kind === 'table');
    dep('ruleCards', './rule-cards.js').fromRules(dep('sectionRules', './section-rules.js').read(ruleInput)).forEach(addRuleCard);
    // A family of short listings under numbered headings ("7.3.2 Sum and Average Value"): which algorithm is this?
    dep('codeCards', './code-cards.js').fromScope(ruleInput).forEach(addRuleCard);

    // 1d. Line-shaped notes ("term - definition", arrows, headings over bullets) have no sentences to mine.
    const notes = dep('notePatterns', './note-patterns.js');
    if (notes.looksLikeNotes(text)) {
      notes.extractNoteCards(text).forEach(addNoteCard);
      addAbbreviationCards();
      return finishBook();
    }

    const lines = (text || '').split(/\n+/).map((l) => l.trim()).filter((l) => l.length >= 6);

    // 2. Multi-line Heading Scanner for plain-text inputs ("Definition of X" / "THEOREM X.Y")
    const rules = dep('definitionRules', './definition-rules.js');
    for (const h of rules.headingBlocks(lines, { cleanMarkdown, isHeadingLine: tokenizer.isHeadingLine })) addCard(h.title, h.body, h.category);

    const sentences = splitSentences(text);
    // Full sentences first (wrapped lines rejoined), then only lines that aren't a mid-sentence wrap
    const candidates = [...sentences, ...tokenizer.selfContainedLines(lines).filter((l) => l.length >= 20)];

    // 2b. Terms the prose introduces, each with its defining clause (prose-definitions.js); strongest readings first.
    const defined = dep('proseDefinitions', './prose-definitions.js').mine(sentences, { isNoise });
    for (const d of [...defined].sort((a, b) => b.strength - a.strength)) {
      if (d.strength >= 3 || !isBadSentence(d.back)) addCard(d.term, d.back, 'Key Term', null, false, d.sentence, d.strength >= 3);
    }

    // 2c. Definitions written as conditions ("A relation is in 2NF if and only if ...", "This condition is called a
    //     **deletion anomaly**"): condition-cards.js.
    for (const c of dep('conditionCards', './condition-cards.js').fromText(text)) {
      if (addFact({ front: c.front, back: c.back, category: 'Definition', kind: 'definition', sourceKind: 'definition', subject: c.term, sentence: c.sentence })) seen.add(boldTerms ? boldTerms.termKey(c.term) : c.term.toLowerCase());
    }

    for (const item of candidates) {
      if (isBadSentence(item)) continue;

      // 3. Bold inline lead-in term ("**Mitosis** is the process...")
      const boldMatch = item.match(
        /^(?:The\s+|A\s+|An\s+)?\*\*([A-Za-z0-9\s\-]{2,42})\*\*\s*(?::|—|–|-|\s+(?:is|are|refers\s+to|means|describes|consists\s+of|represents|states\s+that))\s*(.{15,420})$/i
      );
      if (boldMatch && addCard(boldMatch[1], boldMatch[2].replace(/^(?:defined|known)\s+as\s+/i, ''), 'Key Term')) {
        continue;
      }

      // 4. Syntactic & Punctuation Definition Rules (definition-rules.js), strongest reading first
      for (const r of rules.read(cleanMarkdown(item))) {
        if (addCard(r.term, r.def, 'Key Term')) break;
      }
    }

    // 4b. Explicit "X is called a T" / "T is defined as" statements the rules above missed
    for (const d of dep('definitionMiner', './definition-miner.js').mineText(text, splitSentences)) {
      if (!isBadSentence(d.definition)) addCard(d.term, d.definition, 'Key Term');
    }

    // 5. Inline bold key terms ("... a different type of limit called a **one-sided limit**.")
    if (boldTerms) {
      const found = boldTerms.extractBoldTermCards(text, {
        tokenizer,
        isNoise,
        isValidTerm: (t) => isValidTerm(t, INVALID_TERM_STARTS),
      });
      for (const bt of found) addCard(bt.term, bt.back, 'Key Term');
    }

    // 5b. Tagged boxes (margin notes, self-checks, tables), then the section's stand-alone key statements:
    //     prose that teaches facts without naming terms still yields cards (key-statements.js).
    tagged.cards.forEach(addFact);
    const taken = new Set(cards.map((c) => quality.plain(c.back).toLowerCase()));
    dep('keyStatements', './key-statements.js').extract(text, { taken }).forEach(addFact);
    dep('contrastCards', './contrast-cards.js').fromSentences(sentences).forEach(addFact);

    addAbbreviationCards();
    return finishBook();

    /** Contrast pairs over the finished cards, repeats dropped, and every card given subject / sourceKind / page. */
    function finishBook() {
      const contrasts = dep('contrastCards', './contrast-cards.js').fromCards(cards);
      const fields = dep('cardFields', './card-fields.js');
      // A card mined from running text gets the page its back is printed on (extraction's scope.lines).
      const pageOf = fields.pageLocator(opts.lines);
      const placed = (c) => (c.page || c.pageNumber ? c : { ...c, pageNumber: pageOf(c.back) || pageOf(c.front) || null });
      // Rule cards were keyed as written when added; the word-based repeat check would merge "X + X" with "X ⋅ X".
      // A back that does not answer its front (card-answers.js) is dropped before repeats are judged.
      const all = [...cards, ...contrasts].map(dep('cardAnswers', './card-answers.js').answered).filter(Boolean);
      const kept = new Set(quality.dedupe(all.filter((c) => !c.rule)));
      return all.filter((c) => c.rule || kept.has(c))
        .map((c, i) => fields.finish({ ...placed(c), id: `fc-${i + 1}` }, { topic: contextLabel }));
    }

    /** The first page the extraction's lines are on (book-sections.js places paragraphs from it). */
    function firstPage(lines) {
      const pages = (lines || []).map((l) => l && l.pageNumber).filter(Number.isFinite);
      return pages.length ? Math.min(...pages) : 1;
    }

    /** 6. "process control block (PCB)": the abbreviation gets a card unless a term card already shows it. */
    function addAbbreviationCards() {
      for (const { abbr, long } of dep('abbreviations', './abbreviations.js').find(text)) {
        const shown = cards.some((c) => c.front === abbr || c.front.includes(`(${abbr})`));
        // An organisation's initials ("Institute of Electrical and Electronics Engineers") are not a concept.
        if (shown || seen.has(abbr.toLowerCase()) || ORGANISATION_RE.test(long)) continue;
        seen.add(abbr.toLowerCase());
        pushCard(abbr, `Stands for "${long}".`, 'Abbreviation', { source: `(${abbr})` });
      }
    }
  }

  // Slide decks + Anki export live in slide-cards.js (re-exported here for existing callers).
  const slideCards = () => PDFStudy.slideCards || (typeof require === 'function' ? require('./slide-cards.js') : null);
  function extractSlideFlashcards(slides) {
    const { INVALID_TERM_STARTS } = getDeps().tokenizer;
    return slideCards().extractSlideFlashcards(slides, { isNoise, isValidTerm: (t) => isValidTerm(t, INVALID_TERM_STARTS) });
  }
  const exportAnkiTsv = (cards) => slideCards().exportAnkiTsv(cards);

  PDFStudy.flashcardEngine = { extractBookFlashcards, extractSlideFlashcards, exportAnkiTsv };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.flashcardEngine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

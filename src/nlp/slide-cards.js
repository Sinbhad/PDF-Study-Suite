/**
 * Slide-Deck Flashcards (extracted from flashcard-engine.js; re-exported there). Anki export: deck-export.js.
 * Cards come from the normalised slide model (slide-model.js): definitions, Q -> A, worked problems.
 * Slide terms must pass the STEM label gate ("Proof", "Case 1", "Base Case" never become fronts).
 * Card kind: 'definition' | 'theorem' | 'formula' | 'algorithm' | 'qa' | 'concept' | 'overview'.
 * Only content and question slides make cards (an objectives slide only the terms it defines on the way); every
 * card is self-contained (self-contained.js) and carries subject / sourceKind / page (card-fields.js).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Per-slide defaults for card-fields.js, carried on each card until the deck is finished.
  const FIELDS = Symbol('cardFieldDefaults');
  const HOMEWORK_SLIDE_RE = /\bProblem\s+\d+\.\s*\(\d+\s*Points?\)|^Homework\s*#?\d/i;
  const titleKey = (t) => t.toLowerCase().replace(/\(cont(?:'d|inued)?\.?\)|\b(?:part|step|frame)\s*\d+\b|[\d#:]+/g, '').replace(/\s+/g, ' ').trim();
  const dotList = (items, max) => items.slice(0, max).map((b) => `• ${b}`).join('\n');

  /**
   * "Merge Sort: Divide-and-conquer sort that merges sorted halves in $O(n \log n)$ time" is a term described
   * in words that happens to contain math, not a formula: it is filed as a slide term.
   */
  function describedTerm(card) {
    if (card.category !== 'Formula') return card;
    const words = String(card.back).replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, ' ').match(/[A-Za-z]{3,}/g) || [];
    return words.length >= 3 ? { ...card, category: 'Slide Term', kind: 'concept' } : card;
  }

  /**
   * Deck order of usefulness: term -> definition, STEM statements, the lecturer's own Q -> A, worked
   * problems, cards read off the slide layout (labels, heading groups, tables), and a "key points" overview
   * only for a plain content slide that produced nothing else. isNoise / isValidTerm come from
   * flashcard-engine so the gates stay identical.
   */
  function extractSlideFlashcards(slides, gates) {
    const stemCards = dep('stemCards', './stem-cards.js');
    const structure = dep('slideStructure', './slide-structure-cards.js');
    const sn = dep('stemNoise', './stem-noise.js');
    const model = dep('slideModel', './slide-model.js');
    const dm = dep('definitionMiner', './definition-miner.js');
    const quality = dep('cardQuality', './card-quality.js');
    const selfContained = dep('selfContained', './self-contained.js');
    const cardFields = dep('cardFields', './card-fields.js');
    const { isNoise } = gates;
    // "Graph Algorithms and Complexity" opens with a word exercises also open with ("Graph the function"), but a
    // Title Case heading whose remainder is clean is a topic, not a task.
    const isNoiseTitle = (t) => isNoise(t) && !(sn.isExercisePrompt(t) && /^[A-Z][\w-]*\s+[A-Z]/.test(t) && !isNoise(t.replace(/^\S+\s+/, '')));
    const groups = { definition: [], stem: [], qa: [], worked: [], concept: [], overview: [] };
    const seen = new Set();
    const overviewsByTitle = new Map();
    const worked = new Map();
    const take = (key) => (seen.has(key) ? false : Boolean(seen.add(key)));
    const { slides: norm } = model.normalize(slides);
    // Row names two or more of the deck's tables list ("IHC" for two diseases): their cards name their table's subject.
    const tableCards = dep('tableCards', './table-cards.js');
    const rowCount = new Map();
    norm.filter((s) => s.kind === 'table' && s.table)
      .forEach((s) => new Set(tableCards.rowNames(s.table)).forEach((n) => rowCount.set(n, (rowCount.get(n) || 0) + 1)));
    const ambiguous = new Set([...rowCount].filter(([, n]) => n > 1).map(([name]) => name));
    gates = { ...gates, ambiguous };

    for (const slide of norm) {
      const { title, slideNumber: page } = slide;
      if (!title || (!slide.isExample && isNoiseTitle(title)) || HOMEWORK_SLIDE_RE.test(title) || slide.bullets.some((b) => HOMEWORK_SLIDE_RE.test(b))) continue;
      if (slide.kind === 'title' || slide.kind === 'section') continue;
      // Title, contact, reference and case slides are not study content (content-filter.js). An objectives slide
      // asks nothing, but a term it defines on the way ("Pneumonia- infection of the lung parenchyma") is a term.
      if (slide.contentKind === 'objectives') {
        const terms = structure.build({ ...slide, entity: '', subject: '' }, { ...gates, isNoise: isNoiseTitle }).filter((c) => c.category === 'Slide Term');
        for (const card of terms) {
          if (!selfContained.reason(card, { list: true }) && take(dm.termKey(card.front))) groups.concept.push({ ...card, context: `Slide ${page}: ${title}`, pageNumber: page, page, topic: card.front });
        }
        continue;
      }
      if (slide.contentKind && slide.contentKind !== 'content' && slide.contentKind !== 'question') continue;
      // Every card keeps its slide number (for the "go to slide" link), its slide's entity as the topic and
      // the slide's subject ("Benzimidazoles" on a "Pharmacokinetics" slide) unless the card names its own.
      // An empty entity means the title names nothing ("Remember your anatomy!"): no prefix, no list card.
      const entity = slide.entity !== undefined ? slide.entity : structure.entityOf(title);
      const topic = entity || structure.entityOf(title);
      const ctx = { context: `Slide ${page}: ${title}`, pageNumber: page, page, topic, [FIELDS]: { subject: slide.subject || '', page, topic } };
      const bullets = slide.bullets.filter((b) => !isNoise(b));
      let made = 0;

      for (const d of slide.definitions) {
        // A bold half sentence ("Lameness is the 3rd most") is emphasis, not a term being defined.
        const card = { front: d.term, back: d.definition, ...ctx, category: 'Definition', kind: 'definition' };
        if (!quality.goodFront(d.term) || selfContained.reason(card) || !take(dm.termKey(d.term))) continue;
        groups.definition.push(card);
        made++;
      }
      // The fact the lecture marks for the exam ("the correct answer ... is", "drug of choice", Gram stain).
      for (const k of slide.keyLines || []) {
        const card = { front: `${entity || topic} — ${k.aspect}`, back: k.value, ...ctx, category: 'Key Fact', kind: 'concept' };
        if (!(entity || topic) || selfContained.reason(card, { list: true }) || !take(`fact:${card.front.toLowerCase()}`)) continue;
        groups.definition.push(card);
        made++;
      }
      const hasDefBullets = slide.bullets.some((b) => /^Def(?:inition)?\b/i.test(b));
      if (slide.kind !== 'table') {
        for (const sc of stemCards.extractStemCards(bullets.join('\n'))) {
          if (sc.category === 'Definition' && (hasDefBullets || sc.front.split(/\s+/).length > 4)) continue; // mined above
          if (!take(dm.termKey(sc.front))) continue;
          groups.stem.push({ ...describedTerm(sc), ...ctx });
          made++;
        }
      }
      for (const q of slide.qa) {
        // The revealed answer must read as one: "to not" is recognition debris, not the lecturer's answer.
        const answer = String(q.answer).trim();
        const debris = /^[a-z]+(?:\s+[a-z]+)?$/.test(answer) && !/^(?:yes|no|true|false)$/i.test(answer) && answer.length < 12;
        // A yes/no question ("Can you hear air everywhere?") is answered by a yes or a no; a statement after it
        // is the next point of the slide.
        const yesNo = /^(?:can|is|are|do|does|did|was|were|will|would|should|could|has|have)\b/i.test(String(q.question || q.prompt));
        const saysYesNo = /^(?:yes|no|not|never|always|only|none|usually|rarely)\b/i.test(answer);
        const answered = !debris && !quality.endsMidPhrase(answer) && (!yesNo || saysYesNo);
        if (!answered || !take(`qa:${q.prompt.toLowerCase()}`)) continue;
        groups.qa.push({ front: q.prompt, back: q.answer, ...ctx, category: 'Question', kind: 'qa' });
        made++;
      }
      if (slide.kind === 'table') made += addStructureCards(slide, ctx);
      if (slide.kind !== 'content') continue;

      if (slide.isExample) {
        // Worked problem: the problem statement is the prompt, the labelled steps are the answer.
        const prior = worked.get(titleKey(title));
        const setUp = /^(?:Let|Suppose|Consider|Given|Assume)\b/.test(title) && slide.bullets.length >= 2; // stated example
        if (slide.labelled.length < 2 && !prior && !setUp) continue;
        const steps = model.workedSteps(slide);
        if (prior) prior.back = `${prior.back}
${dotList(steps, 6)}`;
        else {
          const card = { front: slide.prompt ? `${title}
${slide.prompt}` : title, back: dotList(steps, 6), ...ctx, category: 'Worked Example', kind: 'qa' };
          worked.set(titleKey(title), card);
          groups.worked.push(card);
        }
        continue;
      }
      // A deck's opening slide with a line or two under its title is a cover (course, lecturer), not content.
      if (slide === norm[0] && slide.bullets.length <= 3) continue;
      made += addStructureCards({ ...slide, bullets }, ctx);
      // Last resort: a plain content slide whose bullets state points but fit none of the shapes above.
      if (made || sn.isLabelTerm(title) || model.isQuestionText(title)) continue;
      const overview = structure.listCard({ ...slide, bullets }, entity, model.proseRatio)[0];
      if (!overview) continue;
      // A later slide under the same title gets a card of its own only when every point is new: a reveal frame
      // that repeats the first slide's bullets adds nothing.
      const tKey = titleKey(title);
      const earlier = overviewsByTitle.get(tKey) || [];
      const said = new Set(earlier.flatMap((c) => c.back.split('\n')));
      if (overview.back.split('\n').some((line) => said.has(line))) continue;
      const front = earlier.length ? overview.front.replace(/\??$/, (end) => ` (part ${earlier.length + 1})${end}`) : overview.front;
      const card = { ...overview, front, ...ctx, context: `Slide ${page}` };
      overviewsByTitle.set(tKey, [...earlier, card]);
      groups.overview.push(card);
    }
    const contrasts = dep('contrastCards', './contrast-cards.js').fromCards([...groups.definition, ...groups.concept], norm);
    const ordered = [...groups.definition, ...groups.stem, ...groups.qa, ...groups.worked, ...groups.concept, ...contrasts, ...groups.overview];
    // Every card leaves with subject, sourceKind and page (card-fields.js); the slide's defaults sit under FIELDS.
    return quality.dedupe(ordered).map((c, i) => {
      const { [FIELDS]: fields, ...card } = c;
      return { id: `fc-${i + 1}`, ...cardFields.finish(card, fields || {}) };
    });

    /** Cards read off the slide layout (slide-structure-cards.js): labels, heading groups, arrows, table rows. */
    function addStructureCards(slide, ctx) {
      let added = 0;
      for (const card of structure.build(slide, { ...gates, isNoise: isNoiseTitle })) {
        const key = card.category === 'Slide Term' ? dm.termKey(card.front) : `fact:${card.front.toLowerCase()}`;
        // A layout card's back is a fragment or a list: only a pointer at the page ("as shown") disqualifies it.
        if (selfContained.reason(card, { list: true }) || !take(key)) continue;
        groups.concept.push({ ...card, ...ctx });
        added++;
      }
      return added;
    }
  }

  /** Kept for callers of flashcardEngine.exportAnkiTsv; the serialiser lives in deck-export.js. */
  function exportAnkiTsv(cards, opts) {
    return dep('deckExport', './deck-export.js').ankiTsv(cards, opts);
  }

  function slidesToText(slides) {
    const endDot = (s) => {
      const t = String(s || '').trim().replace(/(?<!\.)\.{2,}(?!\.)/g, '.');
      if (!t) return '';
      return /(?:[.!?]|\.\${1,2}|[.!?]['"])\s*$/.test(t) ? t : `${t}.`;
    };
    return (slides || [])
      .map((s) => [s.title, ...(s.bullets || []).flatMap((b) => String(b).split(/\s*[✦✧▪•◦]\s*/))].map(endDot).filter(Boolean).join(' '))
      .join('\n\n');
  }

  const api = { extractSlideFlashcards, exportAnkiTsv, slidesToText };
  PDFStudy.slideCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

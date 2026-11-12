/**
 * Slide-Deck Flashcards + Anki export (extracted from flashcard-engine.js; re-exported there).
 * Cards come from the normalised slide model (slide-model.js): definitions, Q -> A, worked problems.
 * Slide terms must pass the STEM label gate ("Proof", "Case 1", "Base Case" never become fronts).
 * Card kind: 'definition' | 'theorem' | 'formula' | 'algorithm' | 'qa' | 'concept' | 'overview'.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const LIST_TITLE_RE =
    /^(types|kinds|stages|phases|steps|components|factors|causes|effects|properties|characteristics|advantages|disadvantages|cases|operations|applications)\b/i;
  const CLOCK_RE = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  const HOMEWORK_SLIDE_RE = /\bProblem\s+\d+\.\s*\(\d+\s*Points?\)|^Homework\s*#?\d/i;
  const titleKey = (t) => t.toLowerCase().replace(/\(cont(?:'d|inued)?\.?\)|\b(?:part|step|frame)\s*\d+\b|[\d#:]+/g, '').replace(/\s+/g, ' ').trim();
  const dotList = (items, max) => items.slice(0, max).map((b) => `• ${b}`).join('\n');

  /**
   * Deck order of usefulness: term -> definition, STEM statements, the lecturer's own Q -> A, worked
   * problems, "Term: text" bullets, and a "key points" overview only for a plain content slide that
   * produced nothing else. isNoise / isValidTerm come from flashcard-engine so the gates stay identical.
   */
  function extractSlideFlashcards(slides, gates) {
    const stemCards = dep('stemCards', './stem-cards.js');
    const sn = dep('stemNoise', './stem-noise.js');
    const model = dep('slideModel', './slide-model.js');
    const dm = dep('definitionMiner', './definition-miner.js');
    const { isNoise, isValidTerm } = gates;
    const groups = { definition: [], stem: [], qa: [], worked: [], concept: [], overview: [] };
    const seen = new Set();
    const seenTitles = new Set();
    const worked = new Map();
    const take = (key) => (seen.has(key) ? false : Boolean(seen.add(key)));
    const { slides: norm } = model.normalize(slides);

    for (const slide of norm) {
      const { title, slideNumber: page } = slide;
      if (!title || (!slide.isExample && isNoise(title)) || HOMEWORK_SLIDE_RE.test(title) || slide.bullets.some((b) => HOMEWORK_SLIDE_RE.test(b))) continue;
      if (slide.kind === 'title' || slide.kind === 'section') continue;
      const ctx = { context: `Slide ${page}: ${title}`, pageNumber: page, page };
      const bullets = slide.bullets.filter((b) => !isNoise(b));
      let made = 0;

      for (const d of slide.definitions) {
        if (!take(dm.termKey(d.term))) continue;
        groups.definition.push({ front: d.term, back: d.definition, ...ctx, category: 'Definition', kind: 'definition' });
        made++;
      }
      const hasDefBullets = slide.bullets.some((b) => /^Def(?:inition)?\b/i.test(b));
      if (slide.kind !== 'table') {
        for (const sc of stemCards.extractStemCards(bullets.join('\n'))) {
          if (sc.category === 'Definition' && (hasDefBullets || sc.front.split(/\s+/).length > 4)) continue; // mined above
          if (!take(dm.termKey(sc.front))) continue;
          groups.stem.push({ ...sc, ...ctx });
          made++;
        }
      }
      for (const q of slide.qa) {
        if (!take(`qa:${q.prompt.toLowerCase()}`)) continue;
        groups.qa.push({ front: q.prompt, back: q.answer, ...ctx, category: 'Question', kind: 'qa' });
        made++;
      }
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
      for (const b of bullets) {
        if (CLOCK_RE.test(b) || /^Def(?:inition)?\b/i.test(b)) continue;
        const m = b.match(/^([A-Z0-9][A-Za-z0-9\s\-\/()]{1,40}?)\s*(?::(?!\d)|—|–|\s-\s|→|=>)\s*(.{10,250})$/);
        if (!m || !isValidTerm(m[1]) || sn.isLabelTerm(m[1]) || sn.isUnusableSentence(m[2])) continue;
        if (!take(dm.termKey(m[1]))) continue;
        groups.concept.push({ front: m[1].trim(), back: m[2].trim(), ...ctx, category: 'Slide Term', kind: 'concept' });
        made++;
      }
      // Last resort: a plain content slide that states prose points but defines nothing.
      const points = bullets.filter((b) => model.proseRatio(b) >= 0.4 && b.split(/\s+/).length >= 4 && !CLOCK_RE.test(b));
      const tKey = titleKey(title);
      if (made || points.length < 2 || bullets.length > 8 || seenTitles.has(tKey) || sn.isLabelTerm(title) || model.isQuestionText(title)) continue;
      seenTitles.add(tKey);
      const front = LIST_TITLE_RE.test(title) ? `What are the ${title.toLowerCase()}?` : `What are the key points of "${title}"?`;
      groups.overview.push({ front, back: dotList(points, 6), context: `Slide ${page}`, pageNumber: page, page, category: 'Slide Overview', kind: 'overview' });
    }
    return [...groups.definition, ...groups.stem, ...groups.qa, ...groups.worked, ...groups.concept, ...groups.overview]
      .map((c, i) => ({ id: `fc-${i + 1}`, ...c }));
  }

  function exportAnkiTsv(cards) {
    return (cards || [])
      .map((c) => {
        const front = c.front.replace(/\t|\n/g, ' ');
        const back = c.back.replace(/\t/g, ' ').replace(/\n/g, '<br>');
        const tag = (c.context || 'StudySuite').replace(/\s+/g, '_');
        return `${front}\t${back}\t${tag}`;
      })
      .join('\n');
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

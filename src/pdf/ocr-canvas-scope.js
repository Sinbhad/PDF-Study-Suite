/**
 * Study scope for recognised canvas (mind-map) pages, used by scope-builder.js and study-pipeline.js.
 *   formatScope(pages, formatPlain) -> { text, exerciseText, didacticBlocks, canvas }
 *     canvas pages give their topics in reading order (ocr-canvas.js); runs of ordinary pages go through
 *     formatPlain (the text cleaner) unchanged. canvas = { slides, topics: [{ name, slides }], share }
 *     where share is the canvas part of the scope's lines.
 *   useSlides(scopeObj)      true when the canvas blocks should feed the slide-deck engines
 *   expandSlides(slides, pageOf) replaces the one slide of a canvas page by its block slides (slide mode)
 *   decorateSummary(summary, slides) puts each block's term / definition pairs next to its takeaways
 *   completeCards / topUpQuiz / mergeTests complete the slide engines' output for short notes
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const canvasLib = () => PDFStudy.ocrCanvas || (typeof require === 'function' ? require('./ocr-canvas.js') : null);

  const isCanvasPage = (page) => Boolean(canvasLib() && canvasLib().isCanvasPage(page));
  const MIN_SHARE = 0.5;

  /** Topics across pages (a topic never spans pages): [{ name, slides }]. */
  function topicsOf(slides) {
    const out = [];
    for (const s of slides) {
      const last = out[out.length - 1];
      if (last && last.page === s.slideNumber && last.cluster === s.cluster) last.slides.push(s);
      else out.push({ name: s.topic, page: s.slideNumber, cluster: s.cluster, slides: [s] });
    }
    return out.map(({ name, slides: list }) => ({ name, slides: list }));
  }

  function formatScope(pages, formatPlain) {
    const lib = canvasLib();
    const texts = [];
    const exercises = [];
    const blocks = [];
    const slides = [];
    let run = [];
    let canvasLines = 0;
    let allLines = 0;
    const flush = () => {
      if (!run.length) return;
      const plain = formatPlain(run);
      if (plain.text) texts.push(plain.text);
      if (plain.exerciseText) exercises.push(plain.exerciseText);
      blocks.push(...(plain.didacticBlocks || []));
      run = [];
    };
    for (const page of pages || []) {
      const n = ((page && page.lines) || []).length;
      allLines += n;
      if (!isCanvasPage(page)) { run.push(page); continue; }
      flush();
      canvasLines += n;
      const text = lib.pageText(page);
      if (text) texts.push(text);
      slides.push(...lib.slidesFor(page));
    }
    flush();
    return {
      text: texts.join('\n\n'),
      exerciseText: exercises.join('\n'),
      didacticBlocks: blocks,
      canvas: { slides, topics: topicsOf(slides), share: allLines ? canvasLines / allLines : 0 },
    };
  }

  const useSlides = (scopeObj) => Boolean(scopeObj && scopeObj.canvas && scopeObj.canvas.slides.length && scopeObj.canvas.share >= MIN_SHARE);

  /** Slide mode: a canvas page's own slide is replaced by one slide per block of the page. */
  function expandSlides(slides, pageOf) {
    const lib = canvasLib();
    return (slides || []).flatMap((s) => {
      const page = pageOf(s.slideNumber);
      return isCanvasPage(page) ? lib.slidesFor(page) : [s];
    });
  }

  /** Practice-test sections: one per topic that has something to ask about. */
  const sectionsOf = (topics) => (topics || []).filter((t) => t.slides.some((s) => s.bullets.length))
    .map((t) => ({ name: t.name, input: t.slides }));

  /**
   * The slide summary lists each block's takeaways; on a canvas page each block's term / definition pairs
   * are shown as its definitions. Breakdown entries follow the content blocks in order (matched by title).
   */
  function decorateSummary(summary, slides) {
    const content = (slides || []).filter((s) => s.kind === 'content' && s.bullets.length);
    let i = 0;
    for (const entry of (summary && summary.slideBreakdown) || []) {
      while (i < content.length && content[i].title !== entry.title) i++;
      const slide = content[i++];
      if (!slide) break;
      entry.topic = slide.topic;
      entry.qa = entry.qa || [];
      if (!slide.pairs.length) continue;
      const pairText = new Set(slide.pairs.map((p) => `${p.term} – ${p.definition}`));
      entry.definitions = slide.pairs.map((p) => ({ term: p.term, definition: p.definition }));
      entry.takeaways = slide.bullets.filter((b) => !pairText.has(b)).slice(0, 12);
    }
    return summary;
  }

  /**
   * Completes the slide engine's cards for handwritten notes, which are mostly short pairs:
   *  - a term used in several blocks ("Cause", "Example") is named with its block ("Block: Cause"), so each
   *    block keeps its own card instead of only the first one surviving;
   *  - short pairs the engine leaves out for typed slides ("Ion - charged atom") are added;
   *  - a titled block that pairs nothing becomes a "key points" card of its lines.
   * The engine's noise gates still apply; nothing is added twice.
   */
  function completeCards(slides, cards) {
    const nf = PDFStudy.noiseFilter;
    const dm = PDFStudy.definitionMiner;
    const termKey = (t) => (dm ? dm.termKey(t) : String(t || '').toLowerCase());
    const noisy = (t) => Boolean(nf && (nf.isNoise(t) || nf.isGarbled(t)));
    const uses = new Map();
    for (const s of slides || []) for (const k of new Set((s.pairs || []).map((p) => termKey(p.term)))) uses.set(k, (uses.get(k) || 0) + 1);
    const upFirst = (t) => (/^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);
    const named = (p) => (uses.get(termKey(p.term)) > 1 && termKey(p.owner) !== termKey(p.term) ? `${upFirst(p.owner)}: ${p.term}` : p.term);
    const pairCard = new Map(); // "term|definition" -> engine card
    const out = (cards || []).map((c) => ({ ...c }));
    out.forEach((c) => pairCard.set(`${c.front}|${c.back}`, c));
    const taken = new Set(out.map((c) => termKey(c.front)).concat(out.map((c) => c.front.toLowerCase())));
    const add = (card) => out.push({ id: `fc-${out.length + 1}`, ...card });
    for (const s of slides || []) {
      const ctx = { context: s.title, pageNumber: s.slideNumber, page: s.slideNumber };
      for (const p of s.pairs || []) {
        const front = named(p);
        const own = pairCard.get(`${p.term}|${p.definition}`);
        if (own) { own.front = front; taken.add(termKey(front)); continue; }
        const k = termKey(front);
        if (!k || taken.has(k) || (p.definition.match(/[A-Za-z]/g) || []).length < 3) continue;
        if (/[,+&/(]\s*$|^[^A-Za-z0-9]/.test(p.definition) || noisy(p.term) || noisy(p.definition) || (nf && nf.isTermNoise(p.term))) continue;
        taken.add(k);
        add({ front, back: p.definition, ...ctx, category: 'Note', kind: 'concept' });
      }
      const front = `What are the key points of "${s.title}"?`;
      const lines = s.bullets.filter((b) => !noisy(b));
      const asked = [front, `What are the ${s.title}?`].some((f) => taken.has(f.toLowerCase())); // the engine's own wording
      if (s.kind !== 'content' || (s.pairs || []).length || lines.length < 2 || lines.length > 8 || asked || taken.has(termKey(s.title))) continue;
      taken.add(front.toLowerCase());
      add({ front, back: lines.map((b) => `• ${b}`).join('\n'), ...ctx, category: 'Slide Overview', kind: 'overview' });
    }
    return out;
  }

  /** Short notes give few whole-page questions: top the quiz up from the per-topic practice-test questions. */
  function topUpQuiz(quiz, test, max) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const asked = new Set((quiz || []).map((q) => norm(q.question)));
    const extra = ((test && test.questions) || []).filter((q) => q.options && q.options.length >= 2 && !asked.has(norm(q.question)));
    return [...(quiz || []), ...extra].slice(0, max)
      .map(({ section, ...q }, i) => ({ ...q, id: `q-${i + 1}`, page: q.page || q.pageNumber || null }));
  }

  /**
   * Practice test by topic, then topped up to `max` from the whole-page test (small topics cannot find three
   * same-topic options on their own) as one last section.
   */
  function mergeTests(byTopic, whole, max, name) {
    if (!byTopic || !whole || !Array.isArray(byTopic.questions)) return byTopic || whole;
    const qKey = (q) => `${String(q.question).toLowerCase()}|${String(q.answer).toLowerCase()}`;
    const asked = new Set(byTopic.questions.map(qKey));
    const extra = (whole.questions || []).filter((q) => !asked.has(qKey(q))).slice(0, Math.max(0, max - byTopic.questions.length));
    if (!extra.length) return byTopic;
    let n = 0;
    const sections = byTopic.sections.concat({ name, questions: extra.map((q) => ({ ...q, section: name })) })
      .map((s) => ({ ...s, questions: s.questions.map((q) => ({ ...q, id: `t-${++n}` })) }));
    const questions = sections.flatMap((s) => s.questions);
    const skills = questions.reduce((m, q) => ({ ...m, [q.skill]: (m[q.skill] || 0) + 1 }), {});
    return { ...byTopic, sections, questions, total: questions.length, skills };
  }

  const api = { formatScope, useSlides, expandSlides, sectionsOf, decorateSummary, completeCards, topUpQuiz, mergeTests, isCanvasPage, MIN_SHARE };
  PDFStudy.ocrCanvasScope = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

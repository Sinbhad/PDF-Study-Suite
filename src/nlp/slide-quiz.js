/**
 * Slide Section Quiz: questions built from the normalised slide model (slide-model.js), not from keyword
 * statistics. For whatever slide range is selected it produces, in a round-robin mix:
 *   - definition completion  ("... is called reflexive if ...")  options = sibling definitions' conditions
 *   - term cloze             ("... is called ________ if xRx ...") options = sibling defined terms
 *   - true / false           a definition with its condition kept (True) or swapped with a sibling's (False)
 *   - the lecturer's own Q -> A slides: MCQ when same-shape sibling answers exist, otherwise 'reveal'
 *   - worked problems        'reveal' (show answer + self-grade)
 * Options are always the same type as the answer and never empty or duplicated; a question that cannot
 * get at least two sound distractors is asked as 'reveal' or dropped.
 * build(slides, { seedOffset, maxQuestions }) -> [{ type, badge, question, options, answer, explanation, skill, page }]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const model = () => dep('slideModel', './slide-model.js');
  const dm = () => dep('definitionMiner', './definition-miner.js');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, '').replace(/[.;]+$/, '');
  const uniq = (arr, k = key) => arr.filter((v, i) => arr.findIndex((w) => k(w) === k(v)) === i);
  const baseTerm = (t) => String(t || '').replace(/\s+of\s+.+$/i, '').trim();
  const lowerFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);

  /** The term inside its sentence; group 1 = text kept before the blank, group 2 = an article/determiner before it. */
  const termRe = (term) => new RegExp(`(^|[\\s(])((?:an?|the|its)\\s+)?${esc(term)}(?![\\w-])`, 'i');

  function mcq(badge, question, answer, distractors, extra, seed) {
    const ds = uniq(distractors).filter((d) => d && key(d) !== key(answer)).slice(0, 3);
    if (ds.length < 2) return null;
    return { type: 'multiple_choice', badge, question, options: shuffle([answer, ...ds], question, seed), answer, ...extra };
  }
  const reveal = (badge, question, answer, extra) => ({ type: 'reveal', badge, question, options: [], answer, ...extra });

  /** Definition -> sentence completion, term cloze, true/false; `defs` is the deduped deck definition list. */
  function definitionQuestions(defs, seed) {
    const primary = [];
    const tf = [];
    defs.forEach((d, i) => {
      const extra = { explanation: `${d.term} (slide ${d.page}): ${d.definition}`, skill: 'definition', page: d.page, pageNumber: d.page };
      const sibs = defs.filter((o) => o !== d && o.family && o.family === d.family && o.tail && key(o.tail) !== key(d.tail));
      const near = shuffle(sibs, d.term, seed).sort((a, b) => Math.abs(a.page - d.page) - Math.abs(b.page - d.page));
      const completion = d.head && d.tail && d.family !== 'isa'
        ? mcq('Complete the Definition', `Complete the definition:\n"${d.head} …"`, d.tail, near.map((o) => o.tail), extra, seed)
        : null;

      const term = lowerFirst(baseTerm(d.term));
      const m = d.sentence && d.sentence.match(termRe(term));
      let cloze = null;
      if (m) {
        const blanked = d.sentence.replace(termRe(term), (all, pre, art) => `${pre}${art && !/^an?\s/.test(art) ? art : ''}________`); // only a lowercase a/an is blanked away
        const words = term.split(/\s+/).length;
        // Same grammatical slot first: "called reflexive" (bare adjective) vs "called an equivalence relation".
        const fit = (o) => (o.bare !== !m[2]) * 4 + Math.abs(o.term.split(/\s+/).length - words);
        const pool = defs.map((o) => ({ term: lowerFirst(baseTerm(o.term)), bare: !((o.sentence || '').match(termRe(lowerFirst(baseTerm(o.term)))) || [])[2] }))
          .filter((o) => key(o.term) !== key(term) && !new RegExp(`\\b${esc(o.term)}\\b`, 'i').test(blanked) && !key(o.term).includes(key(term)) && !key(term).includes(key(o.term)));
        const ranked = uniq(shuffle(pool, term, seed).sort((a, b) => fit(a) - fit(b)).map((o) => o.term), dm().termKey);
        const at = d.definition.indexOf(d.sentence.slice(0, 20));
        const lead = at > 0 ? d.definition.slice(0, at) : '';
        cloze = mcq('Fill in the Blank', `Complete the statement:\n"${lead}${blanked}"`, term, ranked, extra, seed);
        if (cloze) cloze.type = 'cloze';
      }
      const pick = (i + seed) % 2 === 0 ? completion || cloze : cloze || completion;
      primary.push(pick || reveal('Define the Term', `What is meant by "${d.term}"?`, d.definition, extra));

      if (d.head && d.tail && near.length) {
        const isTrue = (i + seed) % 2 === 1;
        const statement = isTrue ? `${d.head} ${d.tail}` : `${d.head} ${near[0].tail}`;
        tf.push({
          type: 'true_false', badge: 'True / False', question: `True or False:\n"${statement}."`, options: ['True', 'False'],
          answer: isTrue ? 'True' : 'False', ...extra,
          explanation: isTrue ? `True — ${d.definition}` : `False — that describes "${near[0].term}". ${d.definition}`,
        });
      }
    });
    return { primary, tf };
  }

  const LABEL_AT_START_RE = /^([A-Za-z](?:_\{?\w+\}?|\d+)?)\s*(?:=|:)/;
  const fmtList = (items) => (items.length <= 1 ? items.join('') : items.length === 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`);
  const splitList = (s) => String(s || '').split(/\s*,\s*(?:and\s+)?|\s+and\s+/).map((x) => x.trim()).filter(Boolean);

  /** "R_3 and R_5" where every item is one of the labelled candidates listed on the slide. */
  function labelAnswer(q) {
    const labels = q.context.map((b) => (b.match(LABEL_AT_START_RE) || [])[1]).filter(Boolean);
    const items = splitList(q.answer);
    if (labels.length < 3 || !items.length || items.length >= labels.length || !items.every((x) => labels.includes(x))) return null;
    return { labels, items };
  }

  function qaQuestions(slides, seed) {
    const out = [];
    const all = slides.flatMap((s) => s.qa.map((q) => ({ ...q, slide: s })));
    for (const q of all) {
      const page = q.slide.slideNumber;
      const extra = { explanation: `Answer shown on slide ${page}: ${q.answer}`, skill: 'application', page, pageNumber: page, group: q.slide.title };
      const question = q.prompt;
      if (/^(?:yes|no|true|false)\b/i.test(q.answer) && q.answer.length <= 6) {
        const yn = /^(?:yes|no)/i.test(q.answer) ? ['Yes', 'No'] : ['True', 'False'];
        out.push({ type: 'true_false', badge: 'Lecture Question', question, options: yn, answer: yn.find((o) => o.toLowerCase() === q.answer.toLowerCase().replace(/\W+$/, '')) || q.answer, ...extra });
        continue;
      }
      const la = labelAnswer(q);
      if (la) {
        // Same candidate set: other revealed answers first, then rotated subsets of the same size.
        const idx = la.items.map((x) => la.labels.indexOf(x));
        const sib = all.filter((o) => o !== q).map(labelAnswer).filter((o) => o && o.labels.join() === la.labels.join()).map((o) => fmtList(o.items));
        const rotated = [1, 2, 3].map((k) => fmtList(idx.map((n) => (n + k) % la.labels.length).sort((a, b) => a - b).map((n) => la.labels[n])));
        const item = mcq('Lecture Question', question, fmtList(la.items), [...shuffle(uniq(sib), q.question, seed), ...rotated], extra, seed);
        if (item) { out.push(item); continue; }
      }
      const len = q.answer.length;
      const peers = q.slide.qa.filter((o) => o !== q && o.answer.length >= len * 0.5 && o.answer.length <= len * 2 && len <= 160).map((o) => o.answer);
      out.push(mcq('Lecture Question', question, q.answer, shuffle(peers, q.question, seed), extra, seed) || reveal('Lecture Question', question, q.answer, extra));
    }
    return out;
  }

  function workedQuestions(slides) {
    const out = [];
    const byTitle = new Map();
    for (const s of slides) {
      if (!s.isExample || s.kind !== 'content') continue;
      const prior = byTitle.get(s.title);
      const steps = model().workedSteps(s);
      if (prior) { prior.answer += `\n${steps.map((b) => `• ${b}`).join('\n')}`; continue; }
      if (s.labelled.length < 2) continue;
      const q = reveal('Worked Problem', s.prompt ? `${s.title}\n${s.prompt}` : s.title, steps.map((b) => `• ${b}`).join('\n'),
        { explanation: `Worked on slide ${s.slideNumber}.`, skill: 'application', page: s.slideNumber, pageNumber: s.slideNumber });
      byTitle.set(s.title, q);
      out.push(q);
    }
    return out;
  }

  /** One question per slide per pass, so the quiz walks the whole selected range instead of its first slide. */
  function spread(list) {
    const byPage = new Map();
    for (const q of list) byPage.set(q.page, [...(byPage.get(q.page) || []), q]);
    const cols = [...byPage.values()];
    const out = [];
    for (let i = 0; out.length < list.length; i++) cols.forEach((c) => c[i] && out.push(c[i]));
    return out;
  }

  /** Round-robin over the question families so a short quiz still mixes definitions, lecture Q&A and T/F. */
  function build(slides, options = {}) {
    const { seedOffset = 0, maxQuestions = 10 } = options;
    const { slides: norm, definitions } = model().normalize(slides);
    const defs = definitions.filter((d) => dm().goodTerm(d.term));
    const { primary, tf } = definitionQuestions(defs, seedOffset);
    const rot = (list, tag) => spread(seedOffset > 0 ? shuffle(list, tag, seedOffset) : list);
    const lists = { A: rot(primary, 'defs'), B: rot(qaQuestions(norm, seedOffset), 'qa'), C: rot(tf, 'tf'), D: rot(workedQuestions(norm), 'worked') };
    // Reveal-only definition prompts wait until the auto-graded items of their family are used up.
    lists.A.sort((a, b) => (a.type === 'reveal') - (b.type === 'reveal'));
    lists.B.sort((a, b) => (a.type === 'reveal') - (b.type === 'reveal'));
    const out = [];
    const order = ['A', 'B', 'A', 'C', 'B', 'D'];
    const perGroup = new Map(); // reveal frames of one question series share a title
    for (let i = 0, idle = 0; out.length < maxQuestions && idle < order.length; i++) {
      const list = lists[order[i % order.length]];
      // No more than two lecture questions from one series while other material is still waiting.
      const at = list.findIndex((q) => order[i % order.length] !== 'B' || (perGroup.get(q.group) || 0) < 2);
      if (at === -1) { idle++; continue; }
      const [q] = list.splice(at, 1);
      perGroup.set(q.group, (perGroup.get(q.group) || 0) + 1);
      idle = 0;
      out.push(q);
    }
    for (const q of [...lists.B, ...lists.A, ...lists.C, ...lists.D]) if (out.length < maxQuestions) out.push(q);
    return out.map(({ group, ...q }) => q);
  }

  /** Text for the generic keyword-based fill: plain content slides only, without "Def:" lead-ins or Q&A lines. */
  function studyText(slides) {
    const { slides: norm } = model().normalize(slides);
    const sc = dep('slideCards', './slide-cards.js');
    return sc.slidesToText(norm.filter((s) => s.kind === 'content' && !s.isExample).map((s) => ({ title: s.title, bullets: s.bullets.map(dm().stripLead) })));
  }

  const api = { build, definitionQuestions, qaQuestions, workedQuestions, studyText };
  PDFStudy.slideQuiz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

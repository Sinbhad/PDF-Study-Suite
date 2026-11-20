/**
 * Slide Model: one normalised, study-oriented view of a slide deck shared by cards, quiz and summary.
 * Reads the optional extraction fields (kind, qa, definitions, table, pages) and infers them cheaply
 * when they are missing, so old decks and fixtures behave the same:
 *   kind        'title' | 'section' | 'content' | 'question' | 'table'
 *   isExample   worked problem / proof slide (its title is a problem statement, not a topic)
 *   qa          [{ question, answer, context[], prompt }]  lecturer's own question -> revealed answer
 *   definitions [{ term, definition, statement, head, tail, family, page }]  first occurrence in the deck only
 *   labelled    [{ label, text }]  "Reflexive: ..." bullets;  prompt = the worked problem's instruction line
 *   contentKind content-filter.js slideKind: only 'content' and 'question' slides yield definitions and Q&A
 *   subject / aspect / entity   slide-subjects.js: what the slide is about ("Benzimidazoles", "Pharmacokinetics")
 *   outline     [{ text, level, column }]  the kept outline lines, for flat "aspect line + facts" groups
 * Bullets that are links, captions, references, remarks or extraction annotations are dropped here, and an
 * outline group never takes children from another visual column (nestedBullets[].column when extraction sets it).
 * normalize(slides) -> { slides: [...], definitions: [...] }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const dm = () => dep('definitionMiner', './definition-miner.js');
  const tok = () => dep('tokenizer', './tokenizer.js');

  const PROBLEM_TITLE_RE =
    /^(?:Let|Suppose|Consider|Prove|Show|Determine|Find|Given|Compute|Solve|Evaluate|Assume|Proving|Proof|Motivation)\b|\b(?:examples?|exercises?|problems?|proofs?|solutions?|homework|trace|schedule|walkthrough|prove|disprove|show\s+that)\b/i;
  const RELATION_RE = /[=≡≠≤≥<>∈∉⊆⊂∣]|\$[^$]*(?:=|\\(?:le|ge|ne|equiv|in)\b)[^$]*\$/;
  const PROMPT_RE = /^(?:Prove|Show|Determine|Find|Compute|Solve|Evaluate|Is|Are|Does|Do|Can|What|Which|Why|How)\b/;
  const LABEL_RE = /^([A-Z][A-Za-z][A-Za-z -]{0,26}):\s+(\S.{6,})$/;
  const isQ = (s) => /\?\s*$/.test(s);
  const QUESTION_WORD_RE =
    /\b(?:what|which|why|how|when|where|who|whom|whose|is|are|was|were|does|do|did|can|could|should|would|will|true\s+or\s+false)\b/i;
  // Candidate answers listed on a question slide: "R_1 = {...}", "(a) ...", "B. ..."
  const CANDIDATE_RE = /^(?:[A-Za-z](?:_\{?\w+\}?|\d+)?\s*(?:=|:)\s*\S|\(?[a-eA-E][.)]\s+\S)/;

  const COLOR_ASIDE_RE = /\s*\(\s*shown\s+in\s+(?:red|blue|green|yellow|orange|purple|black|white|pink)(?:\s+(?:below|above))?\s*\)/gi;
  const clean = (s) => tok().cleanMarkdown(String(s || '')).replace(COLOR_ASIDE_RE, '').replace(/(?:\s*[✦✧▪◦‣•]\s*)+$/g, '').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** Fraction of tokens that are real words: equation dumps and table cells score low. */
  function proseRatio(text) {
    const toks = String(text || '').split(/\s+/).filter(Boolean);
    if (!toks.length) return 0;
    return toks.filter((t) => /^[A-Za-z][A-Za-z'’-]{2,}[.,;:!?)]*$/.test(t)).length / toks.length;
  }

  /** Keeps the lines a slide teaches (content-filter.js): no links, captions, remarks or annotations. */
  const lineFilter = (slide, ctx) => dep('contentFilter', './content-filter.js').slideLineFilter(slide, ctx, clean);

  function bulletsOf(slide, ctx = {}) {
    const keeps = lineFilter(slide, ctx);
    const src = (slide.bullets && slide.bullets.length ? slide.bullets : (slide.nestedBullets || []).map((b) => b.text)) || [];
    return src.flatMap((b) => String(b || '').split(/\s*[✦✧▪◦‣]\s+(?=\S)/)).map(clean).filter(Boolean).filter(keeps);
  }

  /** A "?" bullet with deeper bullets under it: the slide reveals the answer to its own question. */
  function hasAnsweredQuestion(slide) {
    if (Array.isArray(slide.qa) ? slide.qa.length : slide.qa) return true;
    const nodes = (slide.nestedBullets || []).filter((b) => b && Number.isFinite(b.level));
    return nodes.some((b, i) => isQ(clean(b.text)) && nodes[i + 1] && nodes[i + 1].level > b.level && !isQ(clean(nodes[i + 1].text)));
  }

  function looksTabular(slide, bullets) {
    if (slide.table && Array.isArray(slide.table.rows) && slide.table.rows.length) return true;
    return bullets.length >= 8 && bullets.filter((b) => b.length <= 4).length / bullets.length >= 0.5;
  }

  /** Indent level of every bullet text, when the extractor kept the outline (nestedBullets). */
  function levelLookup(slide) {
    const levels = new Map();
    for (const b of slide.nestedBullets || []) {
      const text = clean(b && b.text);
      if (text && !levels.has(text) && Number.isFinite(b.level)) levels.set(text, b.level);
    }
    return (text) => (levels.has(text) ? levels.get(text) : null);
  }

  /**
   * Outline groups: a bullet with deeper bullets under it -> { head, items } (items = its direct children).
   * Slides without outline levels have no groups.
   */
  /** The outline's kept lines with their indent level (and visual column when extraction sets one). */
  function outlineNodes(slide, ctx = {}) {
    const keeps = lineFilter(slide, ctx);
    return (slide.nestedBullets || [])
      .map((b) => ({ text: clean(b && b.text), level: b && b.level, column: b && b.column }))
      .filter((n) => n.text && Number.isFinite(n.level) && keeps(n.text));
  }

  function outlineGroups(slide, ctx = {}) {
    const nodes = outlineNodes(slide, ctx);
    const groups = [];
    // Bullets set in another visual column are never the children of this one, however they are indented.
    const sameColumn = (a, b) => a.column == null || b.column == null || a.column === b.column;
    nodes.forEach((node, i) => {
      const below = [];
      for (let k = i + 1; k < nodes.length && nodes[k].level > node.level && sameColumn(node, nodes[k]); k++) below.push(nodes[k]);
      if (!below.length) return;
      const childLevel = Math.min(...below.map((n) => n.level));
      groups.push({ head: node.text, items: below.filter((n) => n.level === childLevel).map((n) => n.text) });
    });
    if (groups.length) return groups;
    // A multi-column diagram slide sets each bold column label above a smaller explanation that extraction tagged as
    // a caption only for its small type ("Blood-brain barrier" > "Tight junctions between ...").
    const cf = dep('contentFilter', './content-filter.js');
    const nb = slide.nestedBullets || [];
    const cols = [...new Set(nb.map((b) => b && b.column).filter((c) => c != null))];
    if (cols.length < 2) return groups;
    for (const col of cols) {
      const colItems = nb.filter((b) => b && b.column === col).map((b) => ({ ...b, text: clean(b.text) })).filter((b) => b.text);
      if (colItems.length < 2) continue;
      const head = colItems[0];
      if (!head.isBold || (head.fontSize || 0) < 16 || head.text.split(/\s+/).length > 5 || /[.!?]$/.test(head.text)) continue;
      const items = colItems.slice(1).map((b) => b.text).filter((t) => !/^\d+$/.test(t) && cf.lineKind(t, ctx) === 'content');
      if (items.length) groups.push({ head: head.text, items });
    }
    return groups;
  }

  /** A real question asks something; "Plant toxins – lilies, ivy, etc. Rodenticides?" is a list that ends in doubt. */
  function asksSomething(bullet) {
    if (!isQ(bullet) || bullet.length < 8 || !QUESTION_WORD_RE.test(bullet)) return false;
    const opensAsking = /^(?:What|Which|Why|How|When|Where|Who)\b/i.test(bullet);
    const onlyTailAsks = /[.!]\s+\S[^?]*\?\s*$/.test(bullet);
    return opensAsking || !onlyTailAsks;
  }

  /**
   * Question bullets and the bullet(s) that answer them are the slide's own Q -> A pairs. With outline levels
   * the answer is everything nested under the question; a following bullet that is a sibling heading or sits
   * higher in the outline is unrelated and never an answer. Without levels the next bullet answers.
   */
  function inlineQa(bullets, levelOf) {
    const qa = [];
    const used = new Set();
    for (let i = 0; i + 1 < bullets.length; i++) {
      if (!asksSomething(bullets[i]) || isQ(bullets[i + 1]) || LABEL_RE.test(bullets[i + 1])) continue;
      const asked = levelOf(bullets[i]);
      const first = levelOf(bullets[i + 1]);
      if (asked !== null && first !== null && first < asked) continue;
      const answer = [bullets[i + 1]];
      if (asked !== null && first !== null && first > asked) {
        for (let k = i + 2; k < bullets.length && levelOf(bullets[k]) !== null && levelOf(bullets[k]) > asked && !isQ(bullets[k]); k++) answer.push(bullets[k]);
      }
      qa.push({ question: bullets[i], answer: answer.join('\n') });
      for (let k = i; k <= i + answer.length; k++) used.add(k);
      i += answer.length;
    }
    return { qa, rest: bullets.filter((_, i) => !used.has(i)) };
  }

  function givenQa(slide) {
    const list = Array.isArray(slide.qa) ? slide.qa : slide.qa ? [slide.qa] : [];
    return list
      .map((q) => ({ question: clean(q && q.question), answer: clean(q && q.answer) }))
      .filter((q) => q.question && q.answer);
  }

  function normalize(slides) {
    const list = (slides || []).filter(Boolean);
    const out = [];
    const seenDefs = new Set();
    const allDefs = [];
    const studyKinds = dep('contentFilter', './content-filter.js').slideKinds(list, { hasQa: (s) => hasAnsweredQuestion(s) });
    const stamps = dep('contentFilter', './content-filter.js').deckStamps(list, clean);
    const subjects = dep('slideSubjects', './slide-subjects.js').chain(list, studyKinds);
    list.forEach((slide, idx) => {
      let title = clean(slide.title);
      const contentKind = studyKinds[idx];
      // Title, objectives, contact, reference and case slides teach no definitions and ask nothing of their own.
      const teaches = contentKind === 'content' || contentKind === 'question';
      const lineCtx = { slideKind: contentKind, stamps };
      const all = bulletsOf(slide, lineCtx);
      // A wrapped title whose tail landed in the first bullet ("... is an" + "equivalence relation on ...").
      if (all.length > 1 && /\b(?:an?|the|of|is|are|and|or|to|that)$/i.test(title) && /^[a-z]/.test(all[0])) title = `${title} ${all.shift()}`;
      const tabular = looksTabular(slide, all);
      let qa = givenQa(slide);
      let bullets = all;
      if (!qa.length && !tabular) {
        // "Which is reflexive?" then the same slide retitled "Which is reflexive? R_3 and R_5" (answer revealed).
        const prev = out[out.length - 1];
        const m = title.match(/^(.{8,}?\?)\s+(\S.*)$/);
        if (m && !isQ(m[2])) {
          qa = [{ question: m[1], answer: m[2] }];
          title = m[1];
          if (prev && norm(prev.title) === norm(title) && !prev.qa.length) out.pop();
        }
        const inl = inlineQa(all, levelLookup(slide));
        if (inl.qa.length) { qa = qa.concat(inl.qa); bullets = inl.rest; }
      }
      const inferred = tabular ? 'table' : qa.length || isQ(title) ? 'question'
        : !all.length ? 'section' : idx === 0 && all.length <= 2 && all.every((b) => b.length <= 40) ? 'title' : 'content';
      const kind = slide.kind && !(slide.kind === 'content' && qa.length) ? slide.kind : inferred;
      const labelled = bullets.map((b) => b.match(LABEL_RE)).filter((m) => m && !/^Def(?:inition)?$/i.test(m[1]) && !PROMPT_RE.test(m[1]))
        .map((m) => ({ label: m[1].trim(), text: m[2].trim() }));
      const isExample = kind === 'content' && (PROBLEM_TITLE_RE.test(title) || RELATION_RE.test(title) ||
        (bullets.length > 0 && (/^examples?\b/i.test(bullets[0]) || (PROMPT_RE.test(bullets[0]) && labelled.length >= 2))));
      const prompt = isExample && bullets.length > 1 && (PROMPT_RE.test(bullets[0]) || (labelled.length >= 2 && !LABEL_RE.test(bullets[0]))) ? bullets[0] : '';
      const page = slide.slideNumber || (slide.pages && slide.pages[0]) || null;

      const defs = [];
      const addDef = (d) => {
        const key = dm().termKey(d.term);
        if (!key || seenDefs.has(key)) return;
        if (/\?/.test(d.definition)) return; // a bold word inside a list of questions is not defined there
        seenDefs.add(key);
        const rec = { head: '', tail: '', family: '', statement: d.definition, ...d, page }; // statement = shortest complete form
        defs.push(rec);
        allDefs.push(rec);
      };
      if (!teaches) {
        qa = [];
      } else if (Array.isArray(slide.definitions) && slide.definitions.length) {
        for (const g of slide.definitions) {
          const term = clean(g && g.term), definition = dm().stripLead(clean(g && g.definition));
          if (!term || !definition) continue;
          // Recover the head/tail split for the term extraction named; further terms defined in the same bullet follow.
          const found = dm().mine(definition, { strong: true });
          const same = (x) => { const a = dm().termKey(x.term), b = dm().termKey(term); return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `); };
          const mined = found.find(same);
          addDef(mined ? { ...mined, statement: mined.definition, definition } : { term: /^[a-z]{2}/.test(term) ? term[0].toUpperCase() + term.slice(1) : term, definition });
          found.filter((x) => x !== mined).forEach(addDef);
        }
      } else if (kind !== 'table' && kind !== 'title') {
        for (const b of bullets) {
          if (isExample && !/^Def/i.test(b)) continue;
          dm().mine(b).forEach(addDef);
        }
      }
      // A problem-statement title ("Let R = {...}") is part of every question asked on the slide.
      const setup = qa.length && norm(title) !== norm(qa[0].question) && (PROBLEM_TITLE_RE.test(title) || RELATION_RE.test(title)) ? title : '';
      for (const q of qa) {
        // Only the candidates the question chooses between belong to it; other bullets of the slide are unrelated.
        q.context = bullets.filter((b) => CANDIDATE_RE.test(b) && b !== q.question && b !== q.answer).slice(0, 8);
        q.prompt = [setup, q.question, ...q.context.map((c) => `• ${c}`)].filter(Boolean).join('\n'); // full self-contained question
      }
      out.push({
        slideNumber: page, pages: slide.pages || (page ? [page] : []), title, kind, isExample, prompt, bullets, qa,
        definitions: defs, labelled, table: slide.table || null,
        groups: tabular ? [] : outlineGroups(slide, lineCtx),
        outline: tabular ? [] : outlineNodes(slide, lineCtx),
        qualifiers: dep('contentFilter', './content-filter.js').lineQualifiers(slide, clean),
        keyLines: teaches ? dep('contentFilter', './content-filter.js').keyLines(slide, clean) : [],
        contentKind, ...subjects[idx],
      });
    });
    return { slides: out, definitions: allDefs };
  }

  /** Steps of a worked problem: wrapped / equation-only lines are folded into the labelled step above them. */
  function workedSteps(slide) {
    const steps = [];
    for (const b of slide.bullets) {
      if (b === slide.prompt) continue;
      if (steps.length && slide.labelled.length >= 2 && !LABEL_RE.test(b)) steps[steps.length - 1] += ` ${b}`;
      else steps.push(b);
    }
    return steps;
  }

  const api = { normalize, proseRatio, workedSteps, isQuestionText: isQ };
  PDFStudy.slideModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

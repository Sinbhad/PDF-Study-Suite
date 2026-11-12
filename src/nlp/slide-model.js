/**
 * Slide Model: one normalised, study-oriented view of a slide deck shared by cards, quiz and summary.
 * Reads the optional extraction fields (kind, qa, definitions, table, pages) and infers them cheaply
 * when they are missing, so old decks and fixtures behave the same:
 *   kind        'title' | 'section' | 'content' | 'question' | 'table'
 *   isExample   worked problem / proof slide (its title is a problem statement, not a topic)
 *   qa          [{ question, answer, context[], prompt }]  lecturer's own question -> revealed answer
 *   definitions [{ term, definition, statement, head, tail, family, page }]  first occurrence in the deck only
 *   labelled    [{ label, text }]  "Reflexive: ..." bullets;  prompt = the worked problem's instruction line
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

  const clean = (s) => tok().cleanMarkdown(String(s || '')).replace(/(?:\s*[✦✧▪◦‣•]\s*)+$/g, '').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** Fraction of tokens that are real words: equation dumps and table cells score low. */
  function proseRatio(text) {
    const toks = String(text || '').split(/\s+/).filter(Boolean);
    if (!toks.length) return 0;
    return toks.filter((t) => /^[A-Za-z][A-Za-z'’-]{2,}[.,;:!?)]*$/.test(t)).length / toks.length;
  }

  function bulletsOf(slide) {
    const src = (slide.bullets && slide.bullets.length ? slide.bullets : (slide.nestedBullets || []).map((b) => b.text)) || [];
    return src.flatMap((b) => String(b || '').split(/\s*[✦✧▪◦‣]\s+(?=\S)/)).map(clean).filter(Boolean);
  }

  function looksTabular(slide, bullets) {
    if (slide.table && Array.isArray(slide.table.rows) && slide.table.rows.length) return true;
    return bullets.length >= 8 && bullets.filter((b) => b.length <= 4).length / bullets.length >= 0.5;
  }

  /** Question bullets immediately followed by a non-question bullet are the slide's own Q -> A pairs. */
  function inlineQa(bullets) {
    const qa = [];
    const used = new Set();
    for (let i = 0; i + 1 < bullets.length; i++) {
      if (!isQ(bullets[i]) || isQ(bullets[i + 1]) || bullets[i].length < 8 || LABEL_RE.test(bullets[i + 1])) continue;
      qa.push({ question: bullets[i], answer: bullets[i + 1] });
      used.add(i).add(i + 1);
      i++;
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
    list.forEach((slide, idx) => {
      let title = clean(slide.title);
      const all = bulletsOf(slide);
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
        const inl = inlineQa(all);
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
        seenDefs.add(key);
        const rec = { head: '', tail: '', family: '', statement: d.definition, ...d, page }; // statement = shortest complete form
        defs.push(rec);
        allDefs.push(rec);
      };
      if (Array.isArray(slide.definitions) && slide.definitions.length) {
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
        q.context = bullets.filter((b) => !/^Def(?:inition)?\b/i.test(b) && b !== q.question && b !== q.answer).slice(0, 8);
        q.prompt = [setup, q.question, ...q.context.map((c) => `• ${c}`)].filter(Boolean).join('\n'); // full self-contained question
      }
      out.push({
        slideNumber: page, pages: slide.pages || (page ? [page] : []), title, kind, isExample, prompt, bullets, qa,
        definitions: defs, labelled, table: slide.table || null,
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

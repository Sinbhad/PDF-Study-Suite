/**
 * Book outline: the Summary of a textbook scope, organised by the book's own headings. Under each heading,
 * in this order: what the extraction already identified (definition boxes titled by their term, theorems and
 * laws, key-concept notes, common-error boxes: book-blocks.js), defined terms, formulas and rules, tables whose
 * rows line up, and only then 0-3 lifted key statements chosen by summary-statements.js. Everything is verbatim
 * text from the scope and carries the page it is on. A box whose notation is known to be damaged is flagged.
 *   build(text, { pages, startPage, endPage, didacticBlocks, tables, lines, title }) ->
 *     { kind: 'book', lead, sections: [{ title, page, blocks, definitions, formulas, tables, statements }], terms }
 *   blocks [{ category, label, title, body, page, flag? }]   definitions [{ term, text, page }]
 *   formulas [{ title, body, page }]   tables [{ title, rows, more, page }]   statements [{ text, page }]
 *   terms [{ term, page, ref }]
 * didacticBlocks: the scope's tagged blocks (scope.blocks, or the legacy didacticBlocks list); lines: scope.lines.
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const bb = () => dep('bookBlocks', './book-blocks.js');

  // A numbered definition / theorem box written inline: "Definition 4 Let p and q be propositions. ..."
  const BOX_RE = /^(Definition|Theorem|Lemma|Corollary|Proposition|Law|Rule|Principle|Postulate|Axiom)s?\s+(\d+(?:[.\-]\d+)*)\.?\s+(\S[\s\S]*)$/i;
  // Text before the first heading of the selection has no heading of its own.
  const UNTITLED = 'Before the first heading';
  // A term name longer than this many words is a phrase, not a term.
  const TERM_MAX_WORDS = 5;
  // Lifted statements allowed under a heading that already shows this many identified items: [items, cap].
  const STATEMENT_CAPS = [[3, 1], [1, 2]];
  // A numbered section heading: "2.1.3 Subsets", "4-2 Latches", "1.1 Propositions".
  const NUMBERED_RE = /^(?:\d+(?:[.\-]\d+)+)\s+\S/;
  // "A **surrogate key** is an artificial column ...", "**Normalization** is the process of ..."
  const BOLD_DEFINITION_RE = /^(?:(?:An?|The)\s+)?\*\*([^*$]{3,40})\*\*,?\s+(?:is|are|refers\s+to|means)\s+(?:an?|the|one|any|said|called|defined|used|any)\b/;

  const norm = (s) => String(s || '').toLowerCase().replace(/\*\*|__|\$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const titleCase = (t) => (/^[a-z]{2}/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);

  function rangeLabel(start, end) {
    if (!start) return 'this selection';
    return end && end > start ? `pages ${start}–${end}` : `page ${start}`;
  }

  /** Sentences of a paragraph, each with the page its first words sit on. */
  function sentencesOf(para, splitSentences) {
    const out = [];
    let from = 0;
    for (const s of splitSentences(para.text)) {
      const probe = s.slice(0, 20);
      const at = para.text.indexOf(probe, from);
      if (at >= 0) from = at + probe.length;
      // Which line holds the start: walk the line lengths up to the offset.
      let pos = 0;
      let page = para.page;
      for (let k = 0; k < para.lines.length; k++) {
        if (pos > (at < 0 ? 0 : at)) break;
        page = para.pages[k] || page;
        pos += para.lines[k].length + 1;
      }
      out.push({ text: s, page });
    }
    return out;
  }

  /** A mined definition is kept only when it reads on its own and really names its term. */
  function usableDefinition(d) {
    const st = dep('summaryStatements', './summary-statements.js');
    const sn = dep('stemNoise', './stem-noise.js');
    const kt = dep('keyTerms', './key-terms.js');
    const term = String(d.term || '').trim();
    if (!term || term.split(/\s+/).length > TERM_MAX_WORDS || (sn && sn.isLabelTerm(term)) || (kt && !kt.realTerm(term))) return false;
    if (!norm(d.definition).includes(norm(term).split(' ')[0])) return false;
    if (/\b(?:here|for\s+example|for\s+instance|of\s+this\s+type|this\s+condition)\b/i.test(d.definition)) return false;
    const reason = st.rejectReason(d.definition);
    return !reason || reason === 'length';
  }

  /** Boxes written inline in prose ("Definition 4 Let p ..."), when the extraction did not tag them. */
  function inlineBoxes(prose, used) {
    const out = [];
    for (const p of prose) {
      const m = p.box ? [p.text, p.box.category, p.box.number, p.text] : p.text.match(BOX_RE);
      // "Theorem 1 shows that ...": a reference to a box, not the box itself.
      if (!m || !/^[A-Z$“"(\\]/.test(m[3])) continue;
      const category = titleCase(m[1].toLowerCase());
      const body = bb().trimBody(m[3]);
      const isDef = /definition/i.test(category);
      const term = isDef ? bb().boxTerm(body) : '';
      out.push({ category, label: `${category} ${m[2]}`, title: term, body, page: p.page, flag: bb().flagOf(body), terms: term ? [term] : [] });
      used.add(norm(p.text));
    }
    return out;
  }

  const CODE_MIN_LINES = 2;
  const CODE_MAX_LINES = 10;
  // Program statements, not program output or sample data ("32 | 54 | 67.5")
  const STATEMENT_RE = /[;{}]|\b(?:for|while|if|return)\s*\(|=/;
  // A figure's cell label printed beside a listing: "32 [0]", "65 [currentSize - 1]", ". currentSize 34.5 [pos]"
  const FIGURE_LABEL_RE = /^[.\s]*(?:\w+\s+)?[\d.]+\s*(?:\[[\w\s-]+\]\s*)+$/;

  /**
   * The first short listing in a section the extraction marked as code, as a fenced block titled by the
   * sentence that introduces it ("Here is the implementation of that algorithm:"), or null.
   */
  function codePattern(paragraphs) {
    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      if (p.kind !== 'code') continue;
      let rows = (p.lines || []).filter((l) => !/^```/.test(l.trim()) && l.trim())
        .map((l) => l.replace(/\s*[❶-❿➀-➉]\s*$/, '')) // callout numbers pointing into a figure
        .filter((l) => !FIGURE_LABEL_RE.test(l.trim()));
      // A listing printed with line numbers ("27 double largest = ...") loses them
      if (rows.length && rows.every((r) => /^\s*\d{1,3}\s/.test(r))) rows = rows.map((r) => r.replace(/^\s*\d{1,3}\s/, ''));
      if (rows.length < CODE_MIN_LINES || rows.length > CODE_MAX_LINES || !rows.some((r) => STATEMENT_RE.test(r))) continue;
      // A whole program unit (a module, class or entity of a worked example) is a listing, not a pattern
      if (/^\s*(?:module|class|entity|architecture|package|library|program|interface|public\s+class|def\s+main)\b/.test(rows[0])) continue;
      // A figure's labels run into the code ("values = 54 [1] [i]") or a brace lost: not shown as code
      const opens = rows.join('').split('{').length - rows.join('').split('}').length;
      if (opens !== 0 || rows.some((r) => /\b\d+(?:\.\d+)?\s+\[[\w\s-]+\]/.test(r))) continue;
      // Prose run into the listing ("Use ==, not =. String input;", a lone "equals:") is not code
      if (rows.some((r) => /[a-z=]\.\s+[A-Z]/.test(r) || /^\s*[A-Za-z]+:\s*$/.test(r))) continue;
      const prev = paragraphs[i - 1];
      const lead = prev && prev.kind === 'prose' ? String(prev.text).split(/(?<=[.!?])\s+/).pop() : '';
      const title = /:\s*$/.test(lead) && lead.split(/\s+/).length <= 20 ? lead.replace(/:\s*$/, '') : 'Code';
      return { title, body: ['```', ...rows, '```'].join('\n'), page: p.page, kind: 'code' };
    }
    return null;
  }

  function buildSection(sec, ctx) {
    const tok = dep('tokenizer', './tokenizer.js');
    const dm = dep('definitionMiner', './definition-miner.js');
    const stemCards = dep('stemCards', './stem-cards.js');
    const st = dep('summaryStatements', './summary-statements.js');
    const sn = dep('stemNoise', './stem-noise.js');
    // A biography sidebar ("... (1872–1970) ... was born ...") is about a person, not the section's subject.
    const prose = sec.paragraphs.filter((p) => p.kind === 'prose' && !(sn && sn.isBiographical(p.text)));
    const used = new Set(); // sentences shown as a box or definition are not repeated as statements

    const blocks = [];
    const seenBody = (b) => {
      const key = norm(`${b.label} ${b.body}`).slice(0, 80);
      if (ctx.seenBlocks.has(key) || ctx.seenBlocks.has(norm(b.body).slice(0, 80))) return true;
      ctx.seenBlocks.add(key);
      ctx.seenBlocks.add(norm(b.body).slice(0, 80));
      return false;
    };
    for (const b of ctx.blocksBySection.get(sec) || []) {
      const it = bb().item(b, ctx.blockCtx);
      if (!it || (!it.body && !it.title) || seenBody(it)) continue;
      // The paragraph that holds the block's own text is shown as the block, not again as statements.
      const probe = norm(b.body).slice(0, 24);
      prose.filter((p) => probe.length >= 12 && norm(p.text).includes(probe)).forEach((p) => used.add(norm(p.text)));
      blocks.push(it);
    }
    inlineBoxes(prose, used).forEach((b) => { if (!seenBody(b)) blocks.push(b); });

    const sentences = [];
    prose.forEach((p) => {
      if (used.has(norm(p.text))) return;
      sentencesOf(p, tok.splitSentences).forEach((s, k) => sentences.push({ ...s, indexInParagraph: k }));
    });

    const definitions = [];
    const proseText = prose.filter((p) => !used.has(norm(p.text))).map((p) => p.text).join('\n\n');
    blocks.forEach((b) => b.terms.forEach((t) => ctx.seenTerms.add(dm.termKey(t))));
    for (const mined of dm.mineText(proseText, tok.splitSentences)) {
      // "is said to be in the set state" names the term "set state", not "In the set state"
      const d = { ...mined, term: String(mined.term || '').replace(/^(?:in|into|at|on)\s+(?:the\s+|an?\s+)?/i, '') };
      const key = dm.termKey(d.term);
      if (!key || ctx.seenTerms.has(key) || !usableDefinition(d)) continue;
      ctx.seenTerms.add(key);
      const src = sentences.find((s) => norm(s.text).includes(norm(d.definition).slice(0, 40))) || sentences.find((s) => norm(s.text).includes(norm(d.term)));
      definitions.push({ term: titleCase(d.term.replace(/\*\*/g, '').trim()), text: d.definition, page: src ? src.page : sec.page });
      if (src) used.add(norm(src.text));
    }

    // The section's displayed results first: numbered identity lists and named theorems (book-formulas.js)
    // The author's own definitions: a term set in bold as the subject of its sentence ("A **foreign key** is a
    // column ..."), which the general miner may not read as a definition
    for (const s of sentences) {
      if (used.has(norm(s.text))) continue;
      const m = String(s.text).match(BOLD_DEFINITION_RE);
      if (!m) continue;
      const term = titleCase(m[1].trim());
      const key = dm.termKey(term);
      if (!key || ctx.seenTerms.has(key) || !usableDefinition({ term, definition: s.text })) continue;
      ctx.seenTerms.add(key);
      definitions.push({ term, text: s.text.replace(/\*\*/g, ''), page: s.page });
      used.add(norm(s.text));
    }

    const formulas = [];
    const bf = dep('bookFormulas', './book-formulas.js');
    for (const f of bf ? bf.pick(sec.paragraphs) : []) {
      // Operators matter here: "X̄₁X̄₂ = ..." and "X̄₁ + X̄₂ = ..." are different laws
      const key = String(f.body).replace(/\s+/g, '');
      if (!key || ctx.seenFormulas.has(key)) continue;
      ctx.seenFormulas.add(key);
      formulas.push(f);
    }
    if (stemCards) {
      for (const c of stemCards.extractStemCards(proseText, tok.splitSentences)) {
        if (c.category === 'Definition' || ctx.seenFormulas.has(norm(c.front))) continue;
        if (st.rejectReason(`${c.back}.`) === 'garbled' || st.mathDamage(c.back) || st.isMangled(c.back)) continue;
        ctx.seenFormulas.add(norm(c.front));
        const src = sentences.find((s) => norm(s.text).includes(norm(c.back).slice(0, 30)));
        formulas.push({ title: c.front, body: c.back, category: c.category, page: src ? src.page : sec.page });
        if (src) used.add(norm(src.text));
      }
    }

    // A section taught through a short listing ("7.3.1 Filling": one loop) shows that listing as code
    if (formulas.length + blocks.length + definitions.length <= 1) {
      const code = codePattern(sec.paragraphs);
      if (code) formulas.push(code);
    }

    const tables = (ctx.tablesBySection.get(sec) || []).map((t) => bb().table(t, ctx.blockCtx)).filter(Boolean);
    const terms = definitions.map((d) => norm(d.term)).concat(blocks.flatMap((b) => b.terms.map(norm)));
    const headingWords = st.headingWords(sec.title);
    const candidates = sentences
      .filter((s) => !used.has(norm(s.text)) && !st.rejectReason(s.text))
      .map((s) => ({ ...s, score: st.score(s.text, { indexInParagraph: s.indexInParagraph, terms, headingWords }) }));
    const words = prose.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
    const items = blocks.length + definitions.length + formulas.length;
    return { title: sec.title, page: sec.page, endPage: sec.endPage, definitions, blocks, formulas, tables, candidates, words, items };
  }

  /** Pick each section's share of the statement budget: best-scored, near-duplicates skipped, shown in reading order. */
  function pickStatements(built) {
    const st = dep('summaryStatements', './summary-statements.js');
    const total = st.budget(built.reduce((n, s) => n + s.words, 0));
    // A heading the extraction already covers with boxes needs fewer lifted sentences.
    const cap = (s) => (STATEMENT_CAPS.find(([n]) => s.items >= n) || [0, Infinity])[1];
    const shares = st.allocate(built.map((s) => ({ words: s.words, available: Math.min(cap(s), s.candidates.length) })), total);
    built.forEach((sec, i) => {
      const chosen = [];
      for (const c of [...sec.candidates].sort((a, b) => b.score - a.score)) {
        if (chosen.length >= shares[i]) break;
        const key = norm(c.text);
        if (chosen.some((x) => norm(x.text).includes(key.slice(0, 50)) || key.includes(norm(x.text).slice(0, 50)))) continue;
        chosen.push(c);
      }
      sec.statements = chosen.sort((a, b) => sec.candidates.indexOf(a) - sec.candidates.indexOf(b)).map((c) => ({ text: c.text, page: c.page }));
    });
  }

  /**
   * Each block goes under the heading whose paragraphs the extraction filed it in (blockId), else under the
   * heading whose text holds the block's opening words, else under the last heading on or before its page.
   */
  function placeBlocks(split, blocks, pages) {
    const out = new Map();
    for (const b of blocks) {
      const probe = norm(`${b.title || ''} ${b.body || ''}`).slice(0, 40);
      // A note in the margin is read after its page's main text, so it is filed by where it is printed:
      // under the last heading above it on its page (or on an earlier page)
      const byPosition = b.kind === 'key-concept' && b.bbox ? besideHeading(split, pages, b.bbox) : null;
      const byId = byPosition || (b.id && split.find((s) => s.paragraphs.some((p) => p.blockId === b.id)));
      const byText = !byId && probe.length >= 12 && split.find((s) => s.paragraphs.some((p) => norm(p.text).includes(probe.slice(0, 24))));
      const home = byId || byText || byPage(split, b.pageNumber || b.page);
      if (!home) continue;
      if (!out.has(home)) out.set(home, []);
      out.get(home).push(b);
    }
    return out;
  }

  /** The section whose heading is printed last above a margin note's top (same page or an earlier one). */
  function besideHeading(split, pages, box) {
    const yOf = (s) => {
      const page = (pages || []).find((p) => p && p.pageNumber === s.page);
      const line = page && (page.lines || []).find((l) => !l.isMargin && norm(l.text) === norm(s.title));
      return line && Number.isFinite(line.topY) ? line.topY : null;
    };
    let home = null;
    for (const s of split) {
      if (!s.title || s.page > box.page) continue;
      if (s.page < box.page) { home = s; continue; }
      const y = yOf(s);
      if (y === null) return null; // a heading on the note's page whose place is unknown: do not guess
      if (y <= box.top + 2) home = s;
    }
    return home;
  }

  /** The last heading that starts on or before `page`; a table on the first page goes to the first heading. */
  const byPage = (split, page) => [...split].reverse().find((s) => s.page <= (page || 0)) || split[0];

  function placeTables(split, tables) {
    const out = new Map();
    for (const t of tables || []) {
      const home = split.find((s) => s.paragraphs.some((p) => p.kind === 'table' && p.page === t.pageNumber && norm(p.text).includes(norm((t.rows && t.rows[0] && t.rows[0][0]) || '').slice(0, 20)))) || byPage(split, t.pageNumber);
      if (!home) continue;
      if (!out.has(home)) out.set(home, []);
      out.get(home).push(t);
    }
    return out;
  }

  /** Terms the author set in bold inside what the outline shows: "A **relational operator** tests ...". */
  function boldTerms(sections, text) {
    const kt = dep('keyTerms', './key-terms.js');
    const out = [];
    sections.forEach((s, si) => {
      const shown = [
        ...s.blocks.map((b, bi) => ({ text: b.body, ref: `s${si}-b${bi}`, page: b.page })),
        ...s.statements.map((x, xi) => ({ text: x.text, ref: `s${si}-x${xi}`, page: x.page })),
      ];
      shown.forEach((x) => {
        // Adjacent bold runs are one emphasised phrase: "**binary** **search**" -> "binary search".
        const joined = String(x.text || '').replace(/\*\*(\s+)\*\*/g, '$1');
        for (const m of joined.matchAll(/\*\*([^*$]{3,48})\*\*/g)) {
          const term = m[1].trim().replace(/[.,;:]+$/, '');
          if (kt && kt.realTerm(term, text) && !/^[A-Z\d\s.]+$/.test(term)) out.push({ term: titleCase(term), page: x.page, ref: x.ref });
        }
      });
    });
    return out;
  }

  function build(text, opts = {}) {
    const split = dep('bookSections', './book-sections.js').split(text, { pages: opts.pages, startPage: opts.startPage, lines: opts.lines });
    // Each section runs to the page before the next section starts.
    split.forEach((s, i) => { s.endPage = split[i + 1] ? split[i + 1].page : opts.endPage || s.page; });
    const ctx = {
      blocksBySection: placeBlocks(split, opts.didacticBlocks || [], opts.pages),
      tablesBySection: placeTables(split, opts.tables),
      blockCtx: bb().context(opts.lines),
      seenTerms: new Set(), seenFormulas: new Set(), seenBlocks: new Set(),
    };
    // A chapter's opening pages before its first numbered section ("2.1 Sets") preview the whole chapter
    // ("we will study functions, sequences and matrices"): they are not this selection's content.
    const numbered = split.filter((s) => NUMBERED_RE.test(s.title || ''));
    const firstNumbered = numbered.length >= 2 ? split.indexOf(numbered[0]) : -1;
    const built = split.map((s) => buildSection(s, ctx));
    built.forEach((b, i) => { if (i < firstNumbered && !b.items) b.candidates = []; });
    pickStatements(built);
    const sections = built
      .map((s) => ({
        title: s.title || UNTITLED,
        page: s.page, blocks: s.blocks, definitions: s.definitions, formulas: s.formulas, tables: s.tables, statements: s.statements,
      }))
      .filter((s) => s.definitions.length || s.blocks.length || s.formulas.length || s.tables.length || s.statements.length);
    const terms = [];
    const seen = new Set();
    const addTerm = (t) => {
      const key = norm(t.term);
      if (!key || seen.has(key)) return;
      seen.add(key);
      terms.push(t);
    };
    sections.forEach((s, si) => {
      s.blocks.forEach((b, bi) => b.terms.forEach((t) => addTerm({ term: t, page: b.page, ref: `s${si}-b${bi}` })));
      s.definitions.forEach((d, di) => addTerm({ term: d.term, page: d.page, ref: `s${si}-d${di}` }));
    });
    boldTerms(sections, text).forEach(addTerm);
    return {
      kind: 'book',
      lead: `Key points from ${rangeLabel(opts.startPage, opts.endPage)}, in the book's own words.`,
      sections,
      terms,
    };
  }

  const api = { build, usableDefinition, rangeLabel };
  PDFStudy.bookOutline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

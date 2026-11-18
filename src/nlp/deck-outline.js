/**
 * Deck outline: the Summary of a slide deck as an outline that follows the lecture, never as sentences.
 * Sections and topics come from deck-sections.js; under each topic every slide lists its points verbatim,
 * read into units by slide-units.js (columns, labels and indentation from the extraction's layout). Nothing on
 * a content slide is dropped silently: the points that do not fit the outline are held back on the entry
 * (`more`, `held`) for the view to show as "N more on this slide". Tables stay tables. Every line knows its slide.
 *   build(rawSlides, { model }) ->
 *     { kind: 'deck', lead, covers: [{ text, page }],
 *       sections: [{ title, page, topics: [{ title, page, slides: [entry] }] }],
 *       terms: [{ term, page, ref }] }   (terms: deck-terms.js)
 *   entry: { page, slide, bullets: [{ text, children: [child], more: [child], ref? }], more: [bullet], held,
 *            (child: its text, or { text, children: [text] } when lines nest under it)
 *            table, qa }   page: where the slide's text is complete (the last page of a build-up), slide: its number
 * Lines flagged `isAnnotation` (a notes app's handwriting layer), captions, URLs and figure labels never enter.
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const su = () => dep('slideUnits', './slide-units.js');

  // Units shown per slide, in slide order, before the rest is held back; children shown under one unit.
  const MAX_UNITS = 6;
  const MAX_CHILDREN = 5;
  const MAX_STEPS = 12; // numbered steps of one slide shown in full up to this many
  // Rows of a table shown in the outline; the rest stay on the slide.
  const MAX_TABLE_ROWS = 12;
  // A "bullet" longer than this is a whole text box flattened into one line by extraction: held back.
  const MAX_BULLET_WORDS = 50;
  // A short line repeated on at least this many slides is a badge, logo or footer, not a point.
  const FURNITURE_SLIDES = 3;
  const FURNITURE_WORDS = 4;
  // At least this many short items in a row (no children) are listed on one line: "Trauma; Esophageal perforation; ...".
  const RUN_MIN_ITEMS = 3;
  const RUN_ITEM_WORDS = 4;
  // A body line this much larger than the slide's bullets is the slide's real title, misplaced by extraction.
  const TITLE_SIZE_RATIO = 1.4;

  // A bullet cut off mid-phrase by the slide layout ("... contains both clorsulon and").
  const CUT_TAIL_RE = /\b(?:and|or|of|the|a|an|to|with|by|in|for|both|from|that)$/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const norm = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wordCount = (s) => plain(s).split(/\s+/).filter(Boolean).length;

  /** Table rows from the extractor's table (rows or header + rows), a table block, or " | "-joined bullets. */
  function tableOf(raw, slide) {
    const sources = [raw && raw.table, slide.table].concat((raw && raw.blocks) || []).concat((raw && raw.tables) || []);
    for (const t of sources) {
      if (!t || (t.kind && t.kind !== 'table')) continue;
      const rows = Array.isArray(t) ? t : (t.header ? [t.header] : []).concat(t.rows || []);
      const clean = rows.filter((r) => Array.isArray(r) && r.some((c) => plain(c)));
      if (clean.length) return { rows: clean.slice(0, MAX_TABLE_ROWS + 1), more: Math.max(0, clean.length - MAX_TABLE_ROWS - 1) };
    }
    const piped = (slide.bullets || []).filter((b) => (String(b).match(/\s\|\s/g) || []).length >= 1);
    if (piped.length >= 2) {
      const rows = piped.map((b) => String(b).split(/\s\|\s/).map((c) => c.trim()));
      return { rows: rows.slice(0, MAX_TABLE_ROWS + 1), more: Math.max(0, rows.length - MAX_TABLE_ROWS - 1), fromBullets: true };
    }
    return null;
  }

  /**
   * The slide's own lines with its real title: a title that swallowed a bullet line gives it back, and a body
   * line set at title size ("Antimicrobial •Cephalosporins ...") gives its head to the title.
   */
  function readSlide(raw, slide) {
    let nodes = su().nodesOf(raw, slide);
    const size = su().mainSize(nodes);
    let title = String(slide.rawTitle || slide.title || '');
    const split = su().splitTitle(title);
    const big = size ? nodes.findIndex((n) => n.fontSize >= size * TITLE_SIZE_RATIO && !n.glyph && !n.isAnnotation) : -1;
    const bigTitle = big >= 0 && nodes[big + 1] && nodes[big + 1].glyph && nodes[big + 1].fontSize === nodes[big].fontSize ? plain(nodes[big].text) : '';
    if (bigTitle) {
      // The bullets glued onto the title line belong to the list around it: give them its level and size.
      const near = nodes[big - 1] || nodes[big + 2] || nodes[big];
      const bigSize = nodes[big].fontSize;
      let k = big + 1;
      while (nodes[k] && nodes[k].glyph && nodes[k].fontSize === bigSize) {
        nodes[k] = { ...nodes[k], level: near.level, fontSize: near.fontSize };
        k++;
      }
      nodes = nodes.filter((_, i) => i !== big);
    }
    if (split.rest.length) {
      const first = nodes[0] || { level: 0, fontSize: size };
      const back = split.rest.map((r) => ({ ...first, text: r.text, glyph: true, isAnnotation: false, column: null }));
      // When the body pairs short labels with glyph items, the title's head is one more label, not the title.
      const labelled = nodes.some((n, i) => !n.glyph && nodes[i + 1] && nodes[i + 1].glyph && wordCount(n.text) <= 5);
      if (labelled && split.title) back.unshift({ ...first, text: split.title, glyph: false, isAnnotation: false, column: null });
      nodes = back.concat(nodes);
      title = bigTitle || (labelled ? '' : split.title) || split.title;
    } else if (bigTitle && !title) title = bigTitle;
    return { nodes, size, title };
  }

  /** "Trauma", "Esophageal perforation", "Penetrating foreign body" -> one line, so a list is shown whole. */
  function joinRuns(list, textOf, make) {
    const out = [];
    let run = [];
    const flush = () => {
      if (run.length >= RUN_MIN_ITEMS) out.push(make(run.map(textOf).map(plain).join('; '), run));
      else out.push(...run);
      run = [];
    };
    for (const x of list) {
      const nested = (x.children && x.children.length) || (x.kids && x.kids.length);
      const short = wordCount(textOf(x)) <= RUN_ITEM_WORDS && !/[:.]$/.test(plain(textOf(x))) && !nested;
      if (short) run.push(x);
      else { flush(); out.push(x); }
    }
    flush();
    return out;
  }

  /**
   * Children deeper than the first child level stay under the child above them ("Swine" over "10 ml / 200 lb"):
   * such a child becomes { text, children: [text] }; a plain child stays a string.
   */
  function nestGrandchildren(children) {
    if (!children.length) return [];
    const base = Math.min(...children.map((c) => c.level));
    const out = [];
    for (const c of children) {
      const prev = out[out.length - 1];
      if (c.level > base && prev) prev.kids.push(c);
      else out.push({ ...c, kids: [] });
    }
    return out;
  }
  const childText = (c) => (typeof c === 'string' ? c : c.text);
  /** A child as the outline stores it: its text, or { text, children } when lines nest under it. */
  const childOf = (c) => (c.kids && c.kids.length ? { text: c.text, children: joinRuns(c.kids, (k) => k.text, (t) => ({ text: t })).map((k) => k.text) } : c.text);

  /**
   * The slide's units in slide order: the first MAX_UNITS shown (a flattened text box or a line cut off
   * mid-phrase is held instead), every other content line held back for "N more on this slide".
   */
  function pickBullets(raw, slide, seen, read, furniture) {
    const { nodes: all, size } = read || readSlide(raw, slide);
    const qaText = new Set((slide.qa || []).flatMap((q) => [norm(q.question), norm(q.answer)]));
    // A recurring badge is dropped unless lines nest under it (then it is a recurring heading, kept).
    // A bulleted item ("• albendazole" listed on several slides) is content, never a badge.
    const badge = (n, i) => furniture && !n.glyph && furniture.has(norm(n.text)) && !(all[i + 1] && all[i + 1].level > n.level);
    const content = all.filter((n, i) => !qaText.has(norm(n.text)) && !/\s\|\s/.test(n.text) && !badge(n, i));
    const top = content.length ? Math.min(...content.map((n) => n.level)) : 0;
    // A nested line is judged against the line above it at a shallower level.
    const kept = content.filter((n, i) => {
      const parent = n.level > top ? content.slice(0, i).reverse().find((p) => p.level < n.level) : null;
      return !su().lineNoise(n, size, parent && parent.fontSize);
    });
    let units = su().units(kept).map((u) => ({
      text: u.node.text,
      children: joinRuns(nestGrandchildren(u.children), (c) => c.text, (t) => ({ text: t, kids: [] })).map(childOf),
    }));
    units = joinRuns(units, (u) => u.text, (t) => ({ text: t, children: [] }));
    const fresh = units.filter((u) => !seen.has(norm(u.text)));
    const fits = (u) => wordCount(u.text) <= MAX_BULLET_WORDS && !(CUT_TAIL_RE.test(plain(u.text)) && !u.children.length);
    // A numbered list of steps ("1. ..." to "8. ...") is shown whole: holding its end back cuts the sequence
    const steps = fresh.filter((u) => /^\d{1,2}[.)]\s/.test(plain(u.text))).length;
    const cap = steps >= 3 ? Math.max(MAX_UNITS, Math.min(steps, MAX_STEPS)) : MAX_UNITS;
    const show = new Set(fresh.filter(fits).slice(0, cap));
    const shape = (u) => {
      seen.add(norm(u.text));
      const kids = u.children.filter((c) => !seen.has(norm(childText(c))));
      kids.forEach((c) => seen.add(norm(childText(c))));
      return { text: u.text, children: kids.slice(0, MAX_CHILDREN), more: kids.slice(MAX_CHILDREN) };
    };
    const shown = fresh.filter((u) => show.has(u)).map(shape);
    const more = fresh.filter((u) => !show.has(u)).map(shape);
    return { shown, more };
  }

  /** Short lines that recur on several slides: a badge ("One-Health"), a logo line, a footer. */
  function furnitureOf(rawSlides) {
    const counts = new Map();
    for (const s of rawSlides || []) {
      if (!s) continue;
      const lines = new Set(su().nodesOf(s, s).filter((n) => wordCount(n.text) <= FURNITURE_WORDS).map((n) => norm(n.text)).filter(Boolean));
      lines.forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    }
    return new Set([...counts].filter(([, n]) => n >= FURNITURE_SLIDES).map(([k]) => k));
  }

  /** Table cells without a web address or a badge that extraction ran into them. */
  function cleanTable(table, furniture) {
    if (!table) return table;
    const strip = (c) => {
      let t = String(c || '').replace(/\bhttps?:\/\/\S+|\bwww\.\S+/gi, ' ');
      furniture.forEach((f) => {
        const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s\\W]+');
        t = t.replace(new RegExp(`(^|\\s)${esc}(?=\\s|$)`, 'i'), ' ');
      });
      return t.replace(/\s+/g, ' ').trim();
    };
    return { ...table, rows: table.rows.map((r) => r.map(strip)) };
  }

  function slideEntry(slide, raw, seen, furniture = new Set()) {
    const table = cleanTable(tableOf(raw, slide), furniture);
    const read = readSlide(raw, slide);
    const picked = table && table.fromBullets ? { shown: [], more: [] } : pickBullets(raw, slide, seen, read, furniture);
    const qa = (slide.qa || []).filter((q) => q.question && q.answer).map((q) => ({ question: q.question, answer: q.answer }));
    const pages = Array.isArray(raw && raw.pages) && raw.pages.length ? raw.pages : [slide.slideNumber];
    const held = picked.more.reduce((n, b) => n + 1 + b.children.length + b.more.length, 0) + picked.shown.reduce((n, b) => n + b.more.length, 0);
    return { page: Math.max(...pages.filter(Number.isFinite), slide.slideNumber), slide: slide.slideNumber, title: read.title, bullets: picked.shown, more: picked.more, held, table, qa };
  }

  const hasContent = (e) => e.bullets.length || e.more.length || e.table || e.qa.length;

  /**
   * "What this lecture covers": each objective once. Several questions run together on one line are split;
   * on a slide that lists questions, a line that is not a question is the lecturer's answer to the question
   * above it and is kept with that question (`answers`), never dropped.
   */
  function coversOf(slides, rawBy) {
    const seen = new Set();
    const out = [];
    for (const s of slides) {
      const nodes = su().nodesOf(rawBy.get(s.slideNumber), s).filter((n) => !n.isAnnotation);
      const asks = nodes.some((n) => /\?/.test(n.text));
      let question = null;
      for (const n of nodes) {
        const parts = String(n.text).split(/(?<=\?(?:\*\*)?)\s+(?=\S)/);
        for (const part of parts) {
          const key = norm(part);
          if (!key || su().lineNoise({ text: part }, 0)) continue;
          if (/^(?:learning\s+)?(?:objectives?|targets?)\b/i.test(plain(part))) continue;
          // A line worded as a question ("Why is it “Lyme disease” ...") is never the answer to the one above
          if (asks && !/\?\s*$/.test(plain(part)) && QUESTION_WORD_RE.test(plain(part))) { question = null; continue; }
          if (asks && !/\?\s*$/.test(plain(part))) {
            if (question && !seen.has(`a ${key}`)) { seen.add(`a ${key}`); question.answers.push(part.trim()); }
            continue;
          }
          if (seen.has(key) || wordCount(part) < 3) { question = out.find((c) => norm(c.text) === key) || null; continue; }
          seen.add(key);
          question = { text: part.replace(/^\s*[•·▪◦‣]\s*/, ''), page: s.slideNumber, answers: [] };
          out.push(question);
        }
      }
    }
    // An objective asked again later with its answer ("How is it treated?" then "How is it treated and
    // prevented?" + answers) is listed once, with the answer
    const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
    const alike = (a, b) => { const x = words(a); const y = words(b); const shared = [...x].filter((w) => y.has(w)).length; return shared / Math.min(x.size, y.size || 1) >= SAME_QUESTION; };
    const kept = out.filter((c) => c.answers.length || !out.some((d) => d !== c && d.answers.length && alike(c.text, d.text)));
    return kept.map((c) => (c.answers.length ? c : { text: c.text, page: c.page }));
  }
  const QUESTION_WORD_RE = /^(?:Why|How|What|Which|When|Where|Who|Is|Are|Does|Do|Can)\s/;
  const SAME_QUESTION = 0.8; // share of the shorter question's words the longer one repeats

  function rangeLabel(slides) {
    const nums = slides.map((s) => s.slideNumber).filter(Number.isFinite);
    if (!nums.length) return 'these slides';
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    return hi > lo ? `slides ${lo}–${hi}` : `slide ${lo}`;
  }

  function build(rawSlides, opts = {}) {
    const model = opts.model || dep('slideModel', './slide-model.js').normalize(rawSlides);
    const rawBy = new Map((rawSlides || []).filter(Boolean).map((s) => [s.slideNumber, s]));
    // Titles repaired before grouping, so a slide is filed under its own subject.
    const titled = model.slides.map((s) => {
      const raw = rawBy.get(s.slideNumber) || {};
      const fixed = readSlide(raw, s).title;
      return { ...s, title: fixed || s.title, rawTitle: s.title, nestedBullets: raw.nestedBullets };
    });
    const grouped = dep('deckSections', './deck-sections.js').group(titled);
    const covers = coversOf(grouped.covers, rawBy);
    const furniture = furnitureOf(rawSlides);
    const sections = grouped.sections.map((sec) => ({
      title: sec.title,
      page: sec.page,
      topics: sec.topics.map((tp) => {
        const seen = new Set(); // a bullet repeated on a follow-up slide is listed once per topic
        const slides = tp.slides.map((s) => slideEntry(s, rawBy.get(s.slideNumber), seen, furniture)).filter(hasContent);
        return { title: tp.title, page: slides.length ? slides[0].page : tp.slides[0].slideNumber, slides };
      }).filter((tp) => tp.slides.length),
    })).filter((sec) => sec.topics.length);
    sections.forEach((sec) => { sec.page = sec.topics[0].page; });
    return {
      kind: 'deck',
      lead: `Outline of ${rangeLabel(model.slides)}: each topic with its points, worded as on the slides.`,
      covers,
      sections,
      terms: dep('deckTerms', './deck-terms.js').link(model.definitions, sections, rawBy),
    };
  }

  const lineNoise = (...a) => su().lineNoise(...a);
  const bulletScore = (...a) => su().bulletScore(...a);
  const api = { build, pickBullets, tableOf, lineNoise, bulletScore, readSlide };
  PDFStudy.deckOutline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

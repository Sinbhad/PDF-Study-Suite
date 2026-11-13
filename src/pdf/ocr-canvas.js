/**
 * Canvas (mind-map) handwriting pages: the recogniser returns such a page with `layout: 'canvas'` and every
 * line tagged with a `cluster` (a spatially separate topic) and a `group` (one block of adjacent lines),
 * already in reading order. Their boxes are scattered over the page, so nothing here ever re-sorts by
 * position: topics are rebuilt from the cluster / group indices that ocr-lines.js keeps on each page line
 * (line.ocr.cluster / group / title).
 *   dedupe(items)        drops a second reading of the same ink (two result lines on one box)
 *   titleItems(items)    first line of a block that reads as its title (short, no bullet mark)
 *   topics(page)         [{ name, cluster, groups: [{ title, lines }] }] from the page lines
 *   slidesFor(page)      one slide-shaped block per group (title + bullets), for the slide-deck engines
 *   pairOf(text)         "term - definition", "label: text", "a = b", "a -> b" -> { term, def } or null
 * Pure functions, no DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MARK_RE = /^[-–—•·*>~]+\s*/; // handwritten bullet marks: "-", "•", "->"
  // First separator of a pair: colon, equals, an arrow, or a dash with a space on at least one side ("Na-K pump- moves ions").
  const SEP_RE = /\s*(?::|=>|->|→|=|\s[-–—]+\s*|[-–—]+\s+)\s*/;
  const CONNECTOR_END_RE = /(?:[,+&/(]|\b(?:and|or|of|to|in|on|for|with|w\/|the|a|an|by|from|at))\s*$/i;
  const TITLE_MAX_WORDS = 6;
  const TITLE_MAX_CHARS = 48;

  const isCanvas = (result) => Boolean(result && result.layout === 'canvas');
  const isCanvasPage = (page) => Boolean(page && page.ink && page.ink.recognised && isCanvas(page.ink.result));
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const letters = (s) => (String(s || '').match(/[A-Za-z]/g) || []).length;
  const upFirst = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  function overlap(a0, a1, b0, b1) {
    const span = Math.min(a1 - a0, b1 - b0);
    return span > 0 ? Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / span : 0;
  }

  const confOf = (item) => Math.min(...item.parts.map((p) => Number(p.region.confidence) || 0));

  /** Two lines of one group on (almost) the same box are two readings of the same ink: keep the surer one. */
  function dedupe(items) {
    const out = [];
    for (const item of items) {
      const b = item.box;
      const twin = out.slice(-3).find((o) => o.line.group === item.line.group &&
        overlap(o.box.x, o.box.x + o.box.w, b.x, b.x + b.w) >= 0.7 && overlap(o.box.y, o.box.y + o.box.h, b.y, b.y + b.h) >= 0.7);
      if (!twin) { out.push(item); continue; }
      if (confOf(item) > confOf(twin)) out[out.indexOf(twin)] = item;
    }
    return out;
  }

  function looksLikeTitle(text, groupSize) {
    const t = String(text || '').trim();
    const n = words(t).length;
    if (!t || MARK_RE.test(t) || /^\d{1,2}[.)]\s*/.test(t) || /[.!?;,=+&\-–—]$/.test(t)) return false;
    if (letters(t) < 3 || t.length > TITLE_MAX_CHARS || n > TITLE_MAX_WORDS) return false;
    return groupSize >= 2 || n <= 4; // a lone short line is a label for what sits next to it
  }

  /** Set of items that open their group as its title. */
  function titleItems(items) {
    const set = new Set();
    let i = 0;
    while (i < items.length) {
      let j = i;
      while (j < items.length && items[j].line.group === items[i].line.group) j++;
      if (looksLikeTitle(items[i].text, j - i)) set.add(items[i]);
      i = j;
    }
    return set;
  }

  /** "term - definition" style line -> { term, def }; null for a plain line. */
  function pairOf(text) {
    const t = String(text || '').replace(MARK_RE, '').trim();
    const m = t.slice(1).match(SEP_RE); // a separator needs at least one character of term before it
    if (!m) return null;
    const at = m.index + 1;
    const term = t.slice(0, at).trim();
    const def = t.slice(at + m[0].length).trim();
    if (letters(term) < 2 || term.length > 40 || words(term).length > 6 || CONNECTOR_END_RE.test(term)) return null;
    if (letters(def) < 2) return null;
    return { term, def };
  }

  /** Wrapped handwriting: a line ending in a comma / "+" / "of" continues on the next one. */
  function joinWraps(lines) {
    const out = [];
    for (const l of lines) {
      const prev = out[out.length - 1];
      if (prev && CONNECTOR_END_RE.test(prev) && !MARK_RE.test(l) && !pairOf(l)) out[out.length - 1] = `${prev} ${l}`;
      else out.push(l);
    }
    return out;
  }

  /** Topics of one recognised canvas page, in the recogniser's reading order. */
  function topics(page) {
    const list = [];
    for (const l of (page && page.lines) || []) {
      const o = l.ocr || {};
      if (!Number.isFinite(o.cluster) || !Number.isFinite(o.group)) continue;
      let topic = list[list.length - 1];
      if (!topic || topic.cluster !== o.cluster) list.push((topic = { cluster: o.cluster, name: '', groups: [] }));
      let group = topic.groups[topic.groups.length - 1];
      if (!group || group.group !== o.group) topic.groups.push((group = { group: o.group, title: '', lines: [] }));
      if (o.title && !group.title && !group.lines.length) group.title = l.text;
      else group.lines.push(l.text);
    }
    for (const topic of list) {
      const named = topic.groups.find((g) => g.title);
      topic.name = named ? named.title : words(topic.groups[0].lines[0]).slice(0, 5).join(' ');
      for (const g of topic.groups) g.lines = joinWraps(g.lines);
    }
    return list;
  }

  /**
   * One slide-shaped block per group: { slideNumber, pages, title, bullets, kind, topic, cluster, pairs }.
   * A pair line becomes the bullet "Term – Definition" (the shape the slide engines read as a term card);
   * pairs = [{ term, definition, owner }] where owner names the block ("Napoleon - early life" -> "Napoleon").
   */
  function slidesFor(page) {
    const n = page.pageNumber;
    const slides = [];
    for (const topic of topics(page)) {
      for (const g of topic.groups) {
        const title = g.title || topic.name;
        const head = pairOf(title);
        const owner = head ? head.term : title;
        const pairs = [];
        const bullets = g.lines.map((l) => {
          const p = pairOf(l);
          if (!p) return upFirst(l.replace(MARK_RE, '').trim());
          pairs.push({ term: upFirst(p.term), definition: upFirst(p.def), owner });
          return `${upFirst(p.term)} – ${upFirst(p.def)}`;
        }).filter(Boolean);
        slides.push({
          slideNumber: n, pages: [n], title, formattedTitle: title, bullets,
          nestedBullets: bullets.map((text) => ({ level: 0, text, formattedText: text })),
          rawText: [title, ...bullets].join('. '), kind: bullets.length ? 'content' : 'section',
          topic: topic.name, cluster: topic.cluster, pairs,
        });
      }
    }
    return slides;
  }

  /** Plain text of a canvas page: each block's title and lines in reading order; a blank line between topics. */
  function pageText(page) {
    return topics(page).map((t) => t.groups.map((g) => (g.title ? [g.title] : []).concat(g.lines).join('\n')).join('\n')).join('\n\n');
  }

  const api = { isCanvas, isCanvasPage, dedupe, titleItems, looksLikeTitle, pairOf, topics, slidesFor, pageText };
  PDFStudy.ocrCanvas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

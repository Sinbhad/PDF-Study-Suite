/**
 * Slide units: one slide's lines read as outline units for the deck Summary (deck-outline.js). A unit is a
 * point with the lines that belong to it. What belongs together is read from the layout the extraction kept,
 * never from line order alone:
 *   - side-by-side columns (nestedBullets[].column / .layoutColumn): each column is its own group, headed by
 *     its first line ("Inverted-L block" | "Paravertebral block"), so items never cross to the other column;
 *   - a label ending in ":" ("Pros:", "Cons:") owns the lines under it, up to the next label in its column;
 *   - a short plain line followed by bullet-glyph items ("Moderate disease" over "•Penicillin ...") owns them;
 *   - otherwise indentation (nestedBullets[].level) nests a line under the line above it.
 * Bullets glued into one line by extraction ("•Cephalosporins •Potentiated sulfas") are split at the glyph.
 *   nodesOf(raw, slide)            -> [{ text, level, fontSize, isAnnotation, column, glyph }]
 *   lineNoise(node, size, parent)  -> '' | 'debris' | 'annotation' | 'caption' | 'label' | 'garbled' | 'mangled'
 *   units(nodes)                   -> [{ node, children: [node], label: bool }]
 *   splitTitle(title)              -> { title, rest }: a title that swallowed a bullet line gives the line back
 *   mainSize(nodes), bulletScore(node, childCount)
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // A line set this much smaller than the slide's main bullet size is a figure label or caption.
  const LABEL_SIZE_RATIO = 0.82;
  // A bulleted line at least this share of the main size is an item of the list, however small.
  const LIST_ITEM_MIN_RATIO = 0.6;
  // A nested line at least this share of its parent's size is a sub-point even when small on the slide.
  const CHILD_SIZE_RATIO = 0.85;
  // A label ("Pros:", "Moderate disease") is at most this many words.
  const LABEL_MAX_WORDS = 5;
  const SUBHEADING_MAX_WORDS = 3;
  // A column counts as a column when it holds at least this many lines.
  const MIN_COLUMN_LINES = 2;
  // A remark about the course this short is furniture; a longer one carries a fact and is kept.
  const QUIP_MAX_WORDS = 6;
  // Numbered lines that make a slide one ordered list of steps.
  const MIN_STEPS = 3;
  // When the top level holds less than this share of a slide's text, it is a misplaced title, not the bullets.
  const TOP_SHARE = 0.25;

  const GLYPH_RE = /[•▪◦‣●■◆➢➤►▶]/;
  const GLYPH_SPLIT_RE = /\s*[•▪◦‣●■◆➢➤►▶]\s*/;
  const CAPTION_RE = /^\(?(?:photo|image|picture|figure|fig\.|source|courtesy|credit|adapted\s+from|from\s+https?|retrieved)\b/i;
  const URL_RE = /\bhttps?:\/\/|\bwww\.\S+\.\w/i;
  const DECOR_ONLY_RE = /^[\s\-–—•·*_.,:;!?()[\]{}|/\\^~=+<>☆★✦✧❖➢➤►▶◆◇♦λ]*$/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const wordCount = (s) => plain(s).split(/\s+/).filter(Boolean).length;
  const tidy = (t) => String(t || '').replace(/\*{4}/g, '**'); // bold inside bold: "****x****"

  /** "A •B •C" -> ["A", "B", "C"]; glyph tells whether the piece was a bullet item of its own. */
  function splitGlyphs(text) {
    // A glyph that extraction wrapped in a math span with the words after it: "$•Cephalosporins$".
    let s = String(text || '').replace(/\$([^$]*[•▪◦‣●■◆➢➤►▶][^$]*)\$/g, '$1');
    // A symbol-font sub-bullet read as the letter "o": "o rumen is a reservoir ... o acid pH ...".
    if ((s.match(/(?:^|\s)o\s+(?=[A-Za-z0-9(])/g) || []).length >= 2) s = s.replace(/(^|\s)o\s+(?=[A-Za-z0-9(])/g, '$1• ');
    if (!GLYPH_RE.test(s)) return [{ text: s, glyph: false }];
    const leading = GLYPH_RE.test(plain(s).charAt(0)) || /^\*\*\s*[•▪◦‣●■◆➢➤►▶]/.test(s.trim());
    return s.split(GLYPH_SPLIT_RE)
      .map((part, i) => ({ text: part.replace(/^\*\*\s*\*\*/, '').trim(), glyph: i > 0 || leading }))
      .filter((p) => plain(p.text));
  }

  /** Outline nodes of a slide: nestedBullets when the extractor kept them, otherwise the flat bullets. */
  function nodesOf(raw, slide) {
    const nested = (raw && raw.nestedBullets) || [];
    const base = nested.length
      ? nested.map((b) => ({
        text: tidy(b.formattedText || b.text),
        level: Number.isFinite(b.level) ? b.level : 0,
        fontSize: b.fontSize,
        isAnnotation: !!b.isAnnotation,
        column: Number.isFinite(b.column) ? b.column : Number.isFinite(b.layoutColumn) ? b.layoutColumn : null,
        bullet: Boolean(b.bullet),
        ...(b.kind ? { kind: b.kind } : {}),
      }))
      : ((slide && slide.bullets) || []).map((t) => ({ text: tidy(t), level: 0, fontSize: 0, isAnnotation: false, column: null }));
    // A line whose bullet glyph the extractor stripped (nestedBullets[].bullet) is a glyph item all the same
    return base.flatMap((n) => splitGlyphs(n.text).map((p, i) => ({ ...n, text: p.text, glyph: p.glyph || (i === 0 && n.bullet) })));
  }

  /**
   * Main bullet size of a slide: the most common font size among its top-level lines (captions and figure
   * labels sit deeper in the outline and may hold more text than the bullets themselves). When the top level
   * is a single line (a misplaced title), the next level down is counted with it.
   */
  function mainSize(nodes) {
    const counts = new Map();
    const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
    const top = levels.length ? levels[0] : 0;
    const chars = (list) => list.reduce((k, n) => k + plain(n.text).length, 0);
    const lonely = levels.length > 1 && chars(nodes.filter((n) => n.level === top)) < TOP_SHARE * chars(nodes);
    const counted = (n) => n.level === top || (lonely && n.level === levels[1]);
    for (const n of nodes) if (n.fontSize && counted(n)) counts.set(Math.round(n.fontSize), (counts.get(Math.round(n.fontSize)) || 0) + plain(n.text).length);
    let best = 0;
    let bestN = -1;
    for (const [k, v] of counts) if (v > bestN || (v === bestN && k > best)) { best = k; bestN = v; }
    return best;
  }

  /**
   * Why a line is not slide content (label, caption, URL, debris), or '' when it is. A top-level line is
   * compared with the slide's main size; a nested line with the line it sits under, since sub-points are
   * normally set smaller than their parent.
   */
  function lineNoise(node, size, parentSize) {
    const t = plain(node.text);
    const nf = dep('noiseFilter', './noise-filter.js');
    const st = dep('summaryStatements', './summary-statements.js');
    if (!t || DECOR_ONLY_RE.test(t) || t.length < 3) return 'debris';
    if (node.isAnnotation) return 'annotation';
    if (URL_RE.test(t) || CAPTION_RE.test(t)) return 'caption';
    if (node.kind === 'label') return 'label'; // a diagram's labels split off a sentence (slide-lines.js)
    // A row of a diagram's labels ("L4 L3 L2 L1 T13")
    if (/^(?:[A-Z]?\d{1,3}[A-Za-z]?\s+){2,}[A-Z]?\d{1,3}[A-Za-z]?$/.test(t)) return 'label';
    // The shared content filter: links, citations, captions, a patient's signalment, and a short remark
    // about the course ("Warning: soapbox!"); a longer remark keeps its content and stays.
    const cf = dep('contentFilter', './content-filter.js');
    const kind = cf ? cf.lineKind(t) : 'content';
    if (['url', 'citation', 'caption', 'signalment'].includes(kind)) return 'caption';
    if (kind === 'quip' && wordCount(t) <= QUIP_MAX_WORDS) return 'quip';
    // The lecturer's own aside under a photo: "My cat Luna, who ...".
    if (/^My\s+[a-z]/.test(t)) return 'quip';
    // Small type is a label or caption unless it is a sub-point set only a little smaller than its parent,
    // or an item of the list itself: a bulleted line ("• 4-pt Block") squeezed into smaller type to fit
    const listItem = node.glyph && node.fontSize >= size * LIST_ITEM_MIN_RATIO;
    if (node.fontSize && size && !listItem && node.fontSize < size * LABEL_SIZE_RATIO && (!parentSize || node.fontSize < parentSize * CHILD_SIZE_RATIO)) return 'label';
    // A short dose or measure ("10-20 mL above") is mostly digits and still plain words, never garbled
    const measured = t.split(/\s+/).every((w) => /^[\d.,\-–/:%+<>~×]+$/.test(w) || /^[A-Za-z][a-z]*[.,:;]?$/.test(w) || /^(?:mL|IU|mEq|[mµ]g|kg|lb|cc)$/i.test(w));
    if (nf && !measured && nf.isGarbled(t)) return 'garbled';
    if (/^[^(]*\)/.test(t)) return 'debris'; // "Beef) pias ...": the tail of a cut line
    if (st && st.isMangled(node.text, { slide: true })) return 'mangled';
    return '';
  }

  /** Informativeness of one bullet: a complete point, emphasised or definitional, beats a stray word. */
  function bulletScore(node, childCount) {
    const t = plain(node.text);
    const n = wordCount(t);
    let s = 0;
    if (n >= 3 && n <= 30) s += 1;
    else if (n > 30) s += 0.3;
    else if (!childCount) s -= 0.5;
    if (/\*\*[^*]+\*\*/.test(String(node.text))) s += 0.5;
    if (/[=:]|\s[-–]\s/.test(t)) s += 0.5;
    if (/\d/.test(t)) s += 0.2;
    if (childCount) s += 0.5;
    if (/\?\s*$/.test(t)) s -= 0.5;
    if (/^[a-z]/.test(t) && n <= 5) s -= 0.5; // a lower-case scrap
    return s;
  }

  const isColonLabel = (n) => /:\s*$/.test(plain(n.text)) && wordCount(n.text) <= LABEL_MAX_WORDS;
  /** A short plain line that heads bullet-glyph items: "Moderate disease" over "•Penicillin/Gentamicin". */
  const isGlyphLabel = (n, next) => !n.glyph && next && next.glyph && wordCount(n.text) <= LABEL_MAX_WORDS && !/[.;!?]$/.test(plain(n.text));

  /** A short line wholly in bold over a line that is not: "**Flukes**" over "Albendazole is effective ...". */
  const isBoldLabel = (n, next) => Boolean(n) && /^\*\*[^*]+\*\*$/.test(String(n.text).trim()) && wordCount(n.text) <= LABEL_MAX_WORDS &&
    !/[.;!?]$/.test(plain(n.text)) && Boolean(next) && !/^\*\*[^*]+\*\*$/.test(String(next.text).trim());

  /**
   * A short plain line in Title Case with no punctuation ("Pharmacodynamics", "Adverse Effects"): once a
   * labelled group has items, such a line is the next group's label even when no bulleted item follows it.
   */
  const isSubheading = (n) => !n.glyph && wordCount(n.text) <= SUBHEADING_MAX_WORDS && /^[A-Z]/.test(plain(n.text)) &&
    !/[.,;:!?…)]$/.test(plain(n.text)) && plain(n.text).split(' ').every((w) => /^[A-Z(&]/.test(w) || /^(?:of|and|or|the|in|to|vs)$/.test(w));

  /** Units by labels: each label owns what follows it, up to the next label. Lines before the first label stand alone. */
  function byLabels(nodes, isLabel) {
    const out = [];
    let current = null;
    nodes.forEach((n, i) => {
      if (isLabel(n, nodes[i + 1]) || (isLabel === isGlyphLabel && current && current.children.length && isSubheading(n))) {
        current = { node: n, children: [], label: true };
        out.push(current);
      } else if (current) current.children.push(n);
      else out.push({ node: n, children: [], label: false });
    });
    return out;
  }

  /** Units by indentation: a deeper line nests under the line above it. */
  function byLevels(nodes) {
    const top = Math.min(...nodes.map((n) => n.level));
    const out = [];
    for (const n of nodes) {
      if (n.level <= top || !out.length) out.push({ node: n, children: [], label: false });
      else out[out.length - 1].children.push(n);
    }
    return out;
  }

  /** One column (or a slide without columns) read into units. */
  function readGroup(nodes) {
    if (nodes.some(isColonLabel)) return byLabels(nodes, isColonLabel);
    if (nodes.some((n) => n.glyph) && nodes.some((n, i) => isGlyphLabel(n, nodes[i + 1]))) return byLabels(nodes, isGlyphLabel);
    // Two or more short lines set wholly in bold over plain sentences ("Tapeworms" / "Flukes") head them
    if (nodes.filter((n, i) => isBoldLabel(n, nodes[i + 1])).length >= 2 && isBoldLabel(nodes[0], nodes[1])) return byLabels(nodes, isBoldLabel);
    return byLevels(nodes);
  }

  /**
   * Units of a slide. With side-by-side columns each column becomes one unit headed by its first line; its
   * labelled groups ("Pros:" + items) become that unit's children, as "Pros: a; b; c" lines, and its other
   * lines keep their nesting one level further down.
   */
  function units(nodes) {
    if (!nodes.length) return [];
    // Numbered steps set around a picture (a cycle "1. ..." to "8. ...") are one ordered list, whatever
    // column the layout reader put each label in; a build-up slide's cut-short copy of a step is dropped.
    const stepOf = (n) => { const m = plain(n.text).match(/^(\d{1,2})[.)]\s+\S/); return m ? Number(m[1]) : null; };
    const steps = nodes.filter((n) => stepOf(n) !== null);
    if (steps.length >= MIN_STEPS && steps.length * 2 >= nodes.length) {
      const longer = (n) => steps.some((o) => o !== n && stepOf(o) === stepOf(n) && plain(o.text).length > plain(n.text).length && plain(o.text).startsWith(plain(n.text)));
      const flat = nodes.filter((n) => !(stepOf(n) !== null && longer(n))).map((n) => ({ ...n, column: null }));
      const ordered = flat.filter((n) => stepOf(n) !== null).sort((a, b) => stepOf(a) - stepOf(b));
      const numbers = ordered.map(stepOf);
      if (numbers.every((k, i) => k === i + 1)) return byLevels(ordered.map((n) => ({ ...n, level: 0 })).concat(flat.filter((n) => stepOf(n) === null)));
    }
    const cols = [...new Set(nodes.map((n) => n.column).filter((c) => c !== null && c !== undefined))];
    const sized = cols.filter((c) => nodes.filter((n) => n.column === c).length >= MIN_COLUMN_LINES);
    if (sized.length < 2) return readGroup(nodes);
    const out = [];
    const loose = nodes.filter((n) => !sized.includes(n.column));
    if (loose.length) out.push(...readGroup(loose));
    for (const c of sized.sort((a, b) => a - b)) {
      const col = nodes.filter((n) => n.column === c);
      const [head, ...rest] = col;
      // A column of labelled lists ("Cestocides" + items, "Flukicides" + items) gives one unit per label
      const labelled = isGlyphLabel(head, rest[0]) && rest.some((n, i) => isGlyphLabel(n, rest[i + 1]));
      if (!rest.length || isColonLabel(head) || labelled) { out.push(...readGroup(col)); continue; }
      // A labelled group reads "Pros: a; b; c"; any other line keeps its own sub-lines one level below it.
      const base = head.level + 1;
      const children = readGroup(rest).flatMap((u) => {
        if (!u.children.length) return [{ ...u.node, level: base }];
        if (u.label) return [{ ...u.node, level: base, text: `${plain(u.node.text).replace(/:?\s*$/, ':')} ${u.children.map((k) => plain(k.text)).join('; ')}` }];
        return [{ ...u.node, level: base }, ...u.children.map((k) => ({ ...k, level: base + 1 }))];
      });
      out.push({ node: head, children, label: false });
    }
    return out;
  }

  /** A title that swallowed the first bullet line ("Mild disease •Streptococcus ...") gives it back. */
  function splitTitle(title) {
    const parts = splitGlyphs(title);
    if (parts.length < 2) return { title: String(title || ''), rest: [] };
    return { title: parts[0].glyph ? '' : parts[0].text, rest: parts.slice(parts[0].glyph ? 0 : 1).map((p) => ({ text: p.text, glyph: true })) };
  }

  const api = { nodesOf, lineNoise, mainSize, bulletScore, units, splitTitle, splitGlyphs, isColonLabel };
  PDFStudy.slideUnits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Recall Outline: the nesting of one slide's lines, so a recall question can name the label a line sits under, the
 * heading above that label, and the complete content under it, in source order.
 *
 * A slide's lines carry a level (indent) and, on most decks, a bullet mark: a line without a bullet among bulleted
 * ones is a heading ("Absorption", then its bullets). Depth is the level, with a bulleted line one step deeper than a
 * plain one at the same level. A line's children are the lines after it that sit deeper, up to the next line at its
 * depth or shallower; a line of another layout column is not its content. A label with no deeper lines takes the plain
 * lines after it that are not heading-shaped ("Pharmacodynamics" over "Altered calcium homeostasis, leading to …").
 *
 * The content under a label is not trusted, and the label is not asked, when
 *   - a line after its content could be one more of its points: a sentence at the label's own depth right after its
 *     bulleted points ("Absorption: • … • …" then "Distributed throughout the body"), or a line indented deeper than
 *     the line before it allows (an orphan two levels in, which belongs to no label for sure);
 *   - the label goes on over another slide: the same label under the same title elsewhere, or a "(cont)" label.
 *
 *   tree(slide)                 -> nodes [{ text, depth, column, index, parent, children: [node] }]
 *   locate(slide, label, scope) -> { node, nodes, items, ancestors, siblings, inlineValue } | null
 *   render(items)               -> the answer: one "• item" line per point, its sub-points after it ("   – sub")
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');

  const MAX_HEADING_WORDS = 5;
  // "is", "are", "can", "may": a line that states something is a point, not a heading.
  const STATES_RE = /\b(?:is|are|was|were|has|have|can|may|will|should|must|remains?|causes?|leads?|results?|occurs?|requires?)\b/i;
  const CONTINUED_RE = /\(?\bcont(?:inued|'d|d|\.)?\)?\.?\s*$/i;
  // "Dogs: Dipylidium caninum": a line that opens with its own short label
  const INLINE_LABEL_RE = /^([^:]{1,40}?):\s+(\S.*)$/;

  const norm = (s) => String(s || '').toLowerCase().replace(/[®™©]/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  const bare = (s) => String(s || '').replace(CONTINUED_RE, '').replace(/[\s:–-]+$/, '').trim();

  /** A line shaped like a heading: short, no sentence end, says nothing ("Absorption", "Clinical signs"). */
  function headingShaped(text) {
    const t = String(text || '').trim();
    return Boolean(t) && words(t).length <= MAX_HEADING_WORDS && !/[.;,]$/.test(t) && !STATES_RE.test(t) && /^[A-Z0-9(“"]/.test(t);
  }

  function linesOf(slide) {
    const nested = Array.isArray(slide && slide.nestedBullets) && slide.nestedBullets.length
      ? slide.nestedBullets
      : ((slide && slide.bullets) || []).map((text) => ({ text, level: 0 }));
    return nested.map((b) => ({ text: String(b.text || '').trim(), level: Number(b.level) || 0, bullet: Boolean(b.bullet), column: b.layoutColumn }))
      .filter((l) => l.text);
  }

  function tree(slide) {
    const lines = linesOf(slide);
    const marked = lines.some((l) => l.bullet) && lines.some((l) => !l.bullet);
    const nodes = lines.map((l, index) => ({ ...l, index, marked, depth: l.level * 2 + (marked && l.bullet ? 1 : 0), parent: null, children: [] }));
    const stack = [];
    for (const n of nodes) {
      while (stack.length && (stack[stack.length - 1].depth >= n.depth || !sameColumn(stack[stack.length - 1], n))) stack.pop();
      // Where lines are bulleted, a plain line under a bulleted one is a caption or a note, not its point.
      if (marked && !n.bullet && stack.length && stack[stack.length - 1].bullet) stack.length = 0;
      if (stack.length) {
        n.parent = stack[stack.length - 1];
        n.parent.children.push(n);
      }
      stack.push(n);
    }
    return nodes;
  }

  const sameColumn = (a, b) => a.column === undefined || b.column === undefined || a.column === b.column;

  /** The node whose text is the label, or opens with it ("Dogs: …"); null unless exactly one. */
  function find(nodes, label) {
    const want = norm(bare(label).replace(/\s*\([^)]*\)\s*$/, ''));
    const full = norm(bare(label));
    const hits = nodes.filter((n) => {
      const own = norm(bare(n.text));
      const inline = n.text.match(INLINE_LABEL_RE);
      return own === full || own === want || (inline && (norm(inline[1]) === full || norm(inline[1]) === want));
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /** The label's content: its children, or (none) the plain non-heading lines after it at its own depth. */
  function contentOf(node, nodes) {
    if (node.children.length) return { items: node.children, end: lastOf(node).index };
    const items = [];
    let i = node.index + 1;
    while (i < nodes.length && nodes[i].depth === node.depth && sameColumn(node, nodes[i]) && !headingShaped(nodes[i].text) && !nodes[i].bullet) {
      items.push(nodes[i]);
      i = lastOf(nodes[i]).index + 1;
    }
    return { items, end: items.length ? lastOf(items[items.length - 1]).index : node.index };
  }

  const lastOf = (n) => (n.children.length ? lastOf(n.children[n.children.length - 1]) : n);

  /** Could a line after the label's content be one more of its points? */
  function ambiguousAfter(node, nodes, end, items) {
    const next = nodes[end + 1];
    // A plain label over bulleted points at its own indent, then a plain sentence at that indent: another label's
    // line, or this one's last point ("Absorption • … • …" then "Distributed throughout the body").
    const sameIndent = node.children.length && node.children.every((c) => c.level === node.level);
    if (next && sameIndent && next.level === node.level && !next.bullet && sameColumn(node, next) && !headingShaped(next.text)) return true;
    // A line two levels deeper than the one before it hangs under no label for sure: it may be this one's. (Where
    // lines are bulleted, a plain line is a caption.)
    for (let i = end + 1; i < nodes.length; i++) {
      if (node.marked && !nodes[i].bullet) continue;
      if (nodes[i].level > nodes[i - 1].level + 1 && nodes[i].level > node.level) return true;
    }
    return items.some((n, k) => k > 0 && n.level > items[k - 1].level + 1);
  }

  /** Does the label go on over another slide (same title, same label), or say it does? */
  function continued(slide, node, scope) {
    if (CONTINUED_RE.test(node.text)) return true;
    const key = norm(bare(node.text.replace(INLINE_LABEL_RE, '$1')));
    const title = norm(subjects().tidySubject(bare(slide.title)));
    return (scope.slides || []).some((s) => s !== slide && s.slideNumber !== slide.slideNumber &&
      norm(subjects().tidySubject(bare(s.title))) === title && tree(s).some((n) => norm(bare(n.text.replace(INLINE_LABEL_RE, '$1'))) === key));
  }

  /**
   * The label's place on its slide: the node, its points in order, its ancestors (nearest first), its siblings (the
   * other children of its parent, or the slide's other top lines), and the value on its own line ("Dogs: <value>").
   */
  function locate(slide, label, scope) {
    if (!slide) return null;
    const nodes = tree(slide);
    const node = find(nodes, label);
    if (!node) return null;
    const { items, end } = contentOf(node, nodes);
    if (ambiguousAfter(node, nodes, end, items) || continued(slide, node, scope)) return null;
    const ancestors = [];
    for (let p = node.parent; p; p = p.parent) ancestors.push(p);
    const siblings = (node.parent ? node.parent.children : nodes.filter((n) => !n.parent)).filter((n) => n !== node);
    const inline = node.text.match(INLINE_LABEL_RE);
    return { node, nodes, items: pruned(items, scope), ancestors, siblings, inlineValue: inline ? inline[2].trim() : '' };
  }

  // quizSubjects.repeatedHeadings keys: lower case, no brackets, no punctuation
  const headingKey = (s) => String(s || '').toLowerCase().replace(/[®™©]/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  /**
   * Without a badge the deck prints on many slides, hanging under a sentence ("One-Health" under "Stops glycolysis
   * by …"): it is no sub-point of that sentence. (Under a heading, a short repeated line is an item: "Fever".)
   */
  function pruned(items, scope, under = null) {
    const repeated = (scope.ctx && scope.ctx.repeated) || new Set();
    const badge = (n) => under && !headingShaped(under.text) && !n.children.length && headingShaped(n.text) && repeated.has(headingKey(n.text));
    return items.filter((n) => !badge(n)).map((n) => ({ ...n, children: pruned(n.children, scope, n) }));
  }

  /** The slide's top lines when one heading holds all of them ("Technique" over every line), else null. */
  function soleHeading(slide) {
    const nodes = tree(slide);
    const tops = nodes.filter((n) => !n.parent);
    return tops.length === 1 && tops[0].children.length ? tops[0] : null;
  }

  function render(items) {
    const line = (n, depth) => [`${depth ? `${'   '.repeat(depth)}– ` : '• '}${n.text}`, ...n.children.flatMap((c) => line(c, depth + 1))];
    return items.flatMap((n) => line(n, 0)).join('\n');
  }

  const api = { tree, locate, soleHeading, render, headingShaped, INLINE_LABEL_RE };
  PDFStudy.recallOutline = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

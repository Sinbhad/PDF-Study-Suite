/**
 * Numbered Block Labels for textbooks (100% offline, deterministic).
 * Recognises the labels that open a didactic block, whatever the publisher's styling:
 *   "Definition 1", "THEOREM 2", "Example 3", "Corollary 1", "Lemma 4", "Proposition 2", "Proof:",
 *   "Syntax 5.1", "Self Check", "Common Error 7.2", "Programming Tip 5.1", "Special Topic 6.3", ...
 * A label is accepted only with typographic evidence that it is a label and not a prose mention
 * ("as Example 5 illustrates"): it starts the line and is bold, ALL CAPS, larger than the body, or set
 * alone in the margin beside the first body row (matched by baseline in alignMarginLabels).
 *
 * kind (block.kind): 'definition' | 'theorem' | 'example' | 'proof' | 'key-concept' | 'self-check' | 'sidebar' | 'syntax'
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const LABEL_RE = /^(?<name>Definitions?|Theorems?|Corollary|Lemma|Proposition|Examples?|Worked\s+Example|Proof|Syntax|Self[-\s]Check|Common\s+Errors?|Programming\s+Tips?|Special\s+Topics?|How\s+To|Computing\s+&\s+Society)(?:\s+(?<num>\d+(?:[.\-]\d+)*))?(?<rest>.*)$/i;

  const KIND_OF = {
    definition: 'definition',
    theorem: 'theorem',
    corollary: 'theorem',
    lemma: 'theorem',
    proposition: 'theorem',
    example: 'example',
    'worked example': 'example',
    proof: 'proof',
    syntax: 'syntax',
    'self check': 'self-check',
    'common error': 'sidebar',
    'programming tip': 'sidebar',
    'special topic': 'sidebar',
    'how to': 'sidebar',
    'computing & society': 'sidebar',
  };
  // Names that never need a number ("Proof:", "SELF CHECK"); every other label must be numbered
  const UNNUMBERED_OK = new Set(['proof', 'self check']);

  const MARGIN_ALIGN = 0.6; // x font size: margin label and first body row share a baseline within this
  const BIG_LABEL = 1.25; // x body size: an unbolded label this large is a box title ("Syntax 5.1")
  const GLUED_LABEL = 1.1; // x body size: a long row reporting this size carries a larger label span
  const GLUED_MIN_WORDS = 8; // ... and is a full body row, not a heading
  const TITLE_MAX_WORDS = 8; // text after a label this short (no closing period) is the block's title

  const plainOf = (l) => String((l && (l.text || l.cleanText)) || '').replace(/\*\*/g, '').trim();
  const norm = (name) => name.toLowerCase().replace(/[-\s]+/g, ' ').replace(/s$/, '').replace(/^definition$/, 'definition');

  /** Parses a label at the start of `plain`: { name, kind, num, title, rest } or null. */
  function parseLabel(plain) {
    const m = String(plain || '').match(LABEL_RE);
    if (!m) return null;
    const key = norm(m.groups.name);
    const kind = KIND_OF[key];
    if (!kind) return null;
    const num = m.groups.num || '';
    const rest = (m.groups.rest || '').trim();
    if (!num && !UNNUMBERED_OK.has(key)) return null;
    // "Proof" must be followed by ":" or "." or stand alone, so the word "Proof" in a sentence is never a label
    if (key === 'proof' && rest && !/^[:.]/.test(rest)) return null;
    // A sentence that merely mentions a label ("Example 5 illustrates ...", "Theorem 2 shows") continues lowercase
    if (rest && /^[a-z]/.test(rest)) return null;
    const cap = key.replace(/\b\w/g, (c) => c.toUpperCase());
    return { name: cap, kind, num, title: num ? `${cap} ${num}` : cap, rest: rest.replace(/^[:.\s]+/, '') };
  }

  /** The formatted row without its leading label ("**Definition 4** Let $p$ ..." -> "Let $p$ ..."). */
  function stripLabel(raw, label) {
    const words = label.name.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[-\\s]+');
    const re = new RegExp(`^(?:\\*\\*)?\\s*${words}s?\\s*${label.num.replace(/\./g, '\\.')}\\s*(?:\\*\\*)?\\s*[:.]?\\s*`, 'i');
    return String(raw || '').replace(re, '').trim();
  }

  /**
   * Block heading for a label: "Syntax 5.1 if Statement" -> title "Syntax 5.1 — if Statement"; a sentence
   * after the label ("Definition 4 Let p and q be ...") is the block's first body row instead.
   */
  function headingFor(label, rawRest) {
    const rest = label.rest || '';
    const titleLike = rest && rest.split(/\s+/).length <= TITLE_MAX_WORDS && !/[.!?]$/.test(rest);
    const title = titleLike ? `${label.title} — ${rest}` : label.title;
    const heading = { category: label.name, title, kind: label.kind, labeled: true };
    return { heading, body: titleLike ? '' : rawRest || rest };
  }

  /** True when the label at the start of `line` carries typographic label evidence. */
  function hasLabelStyle(line, label, bodySize) {
    const fmt = String(line.formattedText || '').trim();
    const head = fmt.slice(0, label.title.length + 4);
    const boldLabel = line.isBold || /^\*\*/.test(head);
    const allCaps = /^[A-Z][A-Z\s&-]+\b/.test(plainOf(line).slice(0, label.name.length));
    const big = bodySize && line.fontSize >= bodySize * BIG_LABEL;
    const colonForm = /^(?:Proof)[:.]/i.test(plainOf(line));
    // A margin label glued onto the first body row by baseline: the row reports the label's larger size
    const wordCount = plainOf(line).split(/\s+/).length;
    const gluedLargeLabel = bodySize && line.fontSize >= bodySize * GLUED_LABEL && wordCount >= GLUED_MIN_WORDS;
    return Boolean(boldLabel || allCaps || big || colonForm || gluedLargeLabel);
  }

  /** Label that opens a block at this main-column line, or null. */
  function matchLabelLine(line, bodySize) {
    if (!line || line.isMargin || line.isCode) return null;
    const label = parseLabel(plainOf(line));
    if (!label || !hasLabelStyle(line, label, bodySize)) return null;
    return label;
  }

  /**
   * Margin labels ("Definition 1" set in the outer margin beside the box): returns Map mainLine -> label and
   * the Set of margin lines consumed. A margin line qualifies only when its whole text is a numbered label.
   */
  function alignMarginLabels(lines) {
    const byMain = new Map();
    const used = new Set();
    const mains = lines.filter((l) => l && !l.isMargin && Number.isFinite(l.bottomY));
    for (const m of lines) {
      if (!m || !m.isMargin || !Number.isFinite(m.bottomY)) continue;
      const label = parseLabel(plainOf(m));
      if (!label || label.rest || !label.num) continue;
      const tol = (m.fontSize || 10) * MARGIN_ALIGN;
      let best = null;
      for (const l of mains) {
        const d = Math.abs(l.bottomY - m.bottomY);
        if (d <= tol && (!best || d < Math.abs(best.bottomY - m.bottomY))) best = l;
      }
      if (best && !byMain.has(best)) {
        byMain.set(best, label);
        used.add(m);
      }
    }
    return { byMain, used };
  }

  // Body extent of a labelled block, per kind. Gaps are x font size, measured from the block's last row.
  const END_GAP = { definition: 1.2, theorem: 1.2, 'self-check': 1.6, syntax: 2.5, sidebar: 2.5, example: 2.6, proof: 2.6, 'key-concept': 1.2 };
  // Kinds whose box never runs onto the next page (boxed statements); worked examples and sidebars may
  const SINGLE_PAGE = new Set(['definition', 'theorem', 'syntax', 'self-check', 'key-concept']);
  const END_MARK_RE = /[◂◀■□∎▪]\s*\$?$/; // end-of-example / end-of-proof marks
  const SIDEBAR_SIZE_TOL = 0.6; // pt: a sidebar ends when rows return to a larger (body) size
  const MAX_LABELED_LINES = 60;

  /** True when `line` no longer belongs to the labelled block (didactic-blocks.js ends() delegates here). */
  function endsLabeled(block, line, plain, page) {
    if (block.endMarkSeen || block.bodyLines.length >= MAX_LABELED_LINES) return true;
    const head = block.headLine || {};
    const fs = line.fontSize || 10;
    if (line.isBold && !line.isCode && fs >= (head.fontSize || fs) * 1.1 && fs >= (block.firstBodySize || fs) * 1.1) return true;
    const samePage = page.pageNumber === block.lastPage;
    if (!samePage && SINGLE_PAGE.has(block.kind)) return true;
    if (samePage && Number.isFinite(line.topY) && Number.isFinite(block.lastBottom)) {
      if (line.topY < block.lastTop - 2) return true; // jumped up: another column or region
      if (line.topY - block.lastBottom > fs * (END_GAP[block.kind] || 1.2)) return true;
    }
    if (block.kind === 'sidebar' && block.firstBodySize && !line.isCode && fs > block.firstBodySize + SIDEBAR_SIZE_TOL) return true;
    return false;
  }

  /** Bookkeeping after a row was added to a labelled block (end marks, page, body size). */
  function noteAdded(block, line, plain, page) {
    if (!block.labeled) return;
    block.lastPage = page.pageNumber;
    if (!block.firstBodySize && !line.isCode && plain.length > 3) block.firstBodySize = line.fontSize || 0;
    if (END_MARK_RE.test(plain)) block.endMarkSeen = true;
  }

  PDFStudy.blockLabels = { parseLabel, matchLabelLine, alignMarginLabels, stripLabel, headingFor, endsLabeled, noteAdded, KIND_OF };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.blockLabels;
  }
})(typeof window !== 'undefined' ? window : globalThis);

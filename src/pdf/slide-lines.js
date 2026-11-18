/**
 * Slide Line Preparation for slide-extractor.js (100% offline, deterministic).
 * - drops footer / page-number lines
 * - re-attaches bullet glyphs that the PDF drew as their own text runs (`✧` at x=71, text at x=103)
 * - strips marker glyphs from plain + formatted text (also inside `$...$` / `**...**`)
 * - detects small grids (x / y / value columns) and returns them as table rows
 * - joins wrapped continuation lines (hard line breaks inside one bullet)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const GLYPHS = '✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○';
  const SLIDE_BULLET_RE = /^[\s]*([✦✧•▪▸◦‣⁃∙◆◇➢➣➤❖■□●○\-*+]|\d+[.)]|[a-zA-Z][.)])\s+/;
  const GLYPH_ONLY_RE = new RegExp(`^[${GLYPHS}\\s]+$`);
  const GLYPH_FMT_RE = new RegExp(`^((?:\\*\\*|\\\${1,2})?)\\s*[${GLYPHS}]\\s*`);
  const TERMINAL_RE = /[.!?:;]["”')\]]?$/;

  const isBulletLine = (line) => Boolean((line && line.hasBullet) || SLIDE_BULLET_RE.test((line && line.text) || '') || GLUED_GLYPH_RE.test((line && line.text) || ''));
  // A glyph set flush against its text ("•2% Lidocaine") is a bullet too.
  const GLUED_GLYPH_RE = new RegExp(`^\\s*[${GLYPHS}]\\s*(?=\\S)`);
  const cleanBulletText = (str) => String(str || '').replace(SLIDE_BULLET_RE, '').replace(GLUED_GLYPH_RE, '').trim();

  /** Removes a leading bullet marker from formatted text ("**✦ Text**", "$$✦R = ...$$", "- Text"). */
  function stripMarkerFmt(fmt) {
    const s = String(fmt || '').trim().replace(GLYPH_FMT_RE, '$1');
    const wrapped = s.match(/^\*\*([\s\S]*)\*\*$/);
    if (wrapped) {
      const inner = cleanBulletText(wrapped[1]);
      return inner ? `**${inner}**` : '';
    }
    return cleanBulletText(s);
  }

  /** Footer band / page-number filter + pairing of stand-alone marker glyphs with the text on their row. */
  function prepare(page) {
    const h = page.height || 600;
    const kept = (page.lines || []).filter((line) => {
      if (!line || typeof line.text !== 'string') return false;
      const isFooterBand = line.topY > h * 0.93;
      const isPageNum = /^\s*(slide\s+|page\s+)?\d+(\s*\/\s*\d+)?\s*$/i.test(line.text);
      return !(isFooterBand && (line.fontSize <= 11.5 || isPageNum));
    });
    const cols = PDFStudy.slideColumns || (typeof require === 'function' ? require('./slide-columns.js') : null);
    // Picture labels set small or beside the text are tagged as captions (slide-captions.js).
    const caps = PDFStudy.slideCaptions || (typeof require === 'function' ? require('./slide-captions.js') : null);
    const marked = markLostPrefixes(pairMarkers(splitMixedSizes(kept)));
    const paired = caps ? caps.tagSmallCaptions(marked, isBulletLine) : marked;
    // Two lists set side by side on shared baselines: left column fully, then right (slide-columns.js); two
    // lists side by side whose rows never shared a baseline are split at the gutter no line crosses.
    if (!cols) return paired;
    const split = cols.splitPairs(paired, page.width);
    const columns = split !== paired ? split : cols.splitStacked ? cols.splitStacked(paired, page.width) : paired;
    return caps ? caps.tagSideNotes(columns, h, isBulletLine) : columns;
  }

  const MIXED_SIZE_RATIO = 1.4;

  /**
   * A row that line building ran across a large side title and a list item beside it ("Antimicrobial" at 27pt
   * and "•Cephalosporins/gentamicin" at 15pt share a baseline) is two lines: each segment becomes its own line
   * with its own size, so the title stays a title and the item stays in its list.
   */
  function splitMixedSizes(lines) {
    return lines.flatMap((l) => {
      const segs = l.segments || [];
      const sizes = segs.map((s) => s.fontSize).filter((n) => n > 0);
      // A sentence with a diagram's labels on its baseline ("... below the transverse process   L4  L3  L2  L1")
      const labelTail = segs.length >= 4 && segs[0].text.split(/\s+/).length >= 4 && segs.slice(1).every((s) => /^[A-Z]?\d{0,3}[A-Za-z]?\d{0,3}$/.test(s.text.trim()) && s.text.trim().length <= 4);
      if (labelTail) {
        const [first, ...rest] = segs;
        return [
          { ...l, text: first.text, cleanText: cleanBulletText(first.text), formattedText: first.text, x1: first.x1, segments: undefined },
          { ...l, text: rest.map((s) => s.text).join(' '), cleanText: rest.map((s) => s.text).join(' '), formattedText: rest.map((s) => s.text).join(' '),
            x0: rest[0].x0, textX0: rest[0].x0, hasBullet: false, segments: rest, kind: 'label' },
        ];
      }
      if (segs.length < 2 || sizes.length !== segs.length || Math.max(...sizes) < Math.min(...sizes) * MIXED_SIZE_RATIO) return [l];
      return segs.map((s) => ({
        ...l, text: s.text, cleanText: cleanBulletText(s.text), formattedText: s.text, x0: s.x0, x1: s.x1, textX0: s.x0,
        fontSize: s.fontSize, topY: l.bottomY - s.fontSize, hasBullet: SLIDE_BULLET_RE.test(s.text) || GLUED_GLYPH_RE.test(s.text),
        isBold: l.isBold, segments: undefined, wordCount: s.text.split(/\s+/).length,
      }));
    });
  }

  const TERM_LINE_RE = /^([A-Za-z][\w-]*):\s+\S/;
  const LABEL_ROW_RE = /^(?:[A-Z]?\d{1,3}[A-Za-z]?\s+){2,}[A-Z]?\d{1,3}[A-Za-z]?$/;
  const LOST_MARK = '¿'; // read as damaged by summary-statements.isMangled and noise-filter.isGarbled

  /**
   * "Polioencephalitis: ..." over "encephalitis: Inflammation of the white matter", the second line starting a
   * term's width further right: the start of that term was drawn as a picture ("Leuko" in word art) and is not
   * in the text. Without it the line states something false, so it is marked as damaged, never shown as is.
   */
  function markLostPrefixes(lines) {
    const terms = lines.filter((l) => TERM_LINE_RE.test(String(l.text || '').trim()));
    return lines.map((l) => {
      const m = String(l.text || '').trim().match(TERM_LINE_RE);
      if (!m || !/^[a-z]/.test(m[1])) return l;
      const fs = l.fontSize || 12;
      const sibling = terms.find((o) => o !== l && /^[A-Z]/.test(o.text.trim()) && Math.abs((o.fontSize || 12) - fs) <= 1.5 &&
        Math.abs(o.topY - l.topY) < fs * 4 && l.x0 - o.x0 >= fs * 1.5);
      if (!sibling) return l;
      return { ...l, text: `${LOST_MARK}${l.text}`, cleanText: `${LOST_MARK}${l.cleanText || l.text}`, formattedText: `${LOST_MARK}${l.formattedText || l.text}` };
    });
  }

  /** Pairs stand-alone marker glyphs with the text on their row. */
  function pairMarkers(kept) {
    const markers = kept.filter((l) => GLYPH_ONLY_RE.test(l.text));
    if (!markers.length) return kept;
    const texts = kept.filter((l) => !GLYPH_ONLY_RE.test(l.text)).map((l) => ({ ...l }));
    for (const m of markers) {
      const midY = (m.topY + m.bottomY) / 2;
      let best = null;
      for (const t of texts) {
        if (t.markerX0 !== undefined || isBulletLine(t)) continue;
        if (midY < t.topY - 2 || midY > t.bottomY + 2 || t.x0 < m.x0) continue;
        if (!best || t.x0 < best.x0) best = t;
      }
      if (best) {
        best.markerX0 = m.x0;
        best.hasBullet = true;
        best.textX0 = best.x0;
        best.x0 = m.x0;
      }
    }
    return texts;
  }

  const cluster = (values, tol) => {
    const out = [];
    for (const v of [...values].sort((a, b) => a - b)) {
      if (!out.length || v - out[out.length - 1].max > tol) out.push({ min: v, max: v });
      else out[out.length - 1].max = v;
    }
    return out;
  };

  /**
   * Grid detection: >= 2 left-aligned columns x >= 3 baseline rows of short cells, mostly filled.
   * Returns { table: { rows, formattedRows }, rest } or null. Bullet lines are never cells.
   */
  function detectTable(lines) {
    const cand = lines.filter((l) => !isBulletLine(l) && (l.text || '').length <= 48);
    if (cand.length < 6) return null;
    const cols = cluster(cand.map((l) => l.x0), 6).filter((c) => cand.filter((l) => l.x0 >= c.min && l.x0 <= c.max).length >= 3);
    if (cols.length < 2) return null;
    const inCol = (l) => cols.findIndex((c) => l.x0 >= c.min - 0.5 && l.x0 <= c.max + 0.5);
    const cells = cand.filter((l) => inCol(l) >= 0);
    const fs = Math.max(6, Math.min(...cells.map((l) => l.fontSize || 12)));
    const rows = cluster(cells.map((l) => l.bottomY), fs * 0.45);
    if (rows.length < 3) return null;
    const grid = rows.map(() => cols.map(() => null));
    for (const l of cells) {
      const r = rows.findIndex((rw) => l.bottomY >= rw.min - 0.5 && l.bottomY <= rw.max + 0.5);
      const c = inCol(l);
      if (r < 0 || grid[r][c]) return null; // two lines in one cell: prose columns, not a grid
      grid[r][c] = l;
    }
    const filled = cells.length / (rows.length * cols.length);
    const avgLen = cells.reduce((a, l) => a + l.text.length, 0) / cells.length;
    if (filled < 0.75 || (cols.length === 2 && avgLen > 16) || avgLen > 30) return null;
    const cellSet = new Set(cells);
    const txt = (key) => grid.map((row) => row.map((l) => (l ? String(l[key] || l.text).replace(/\*\*/g, '').trim() : '')));
    return { table: { rows: txt('text'), formattedRows: txt('formattedText') }, rest: lines.filter((l) => !cellSet.has(l)) };
  }

  /** Normalises body lines and joins wrapped continuations; never merges across bullet or code lines. */
  function mergeBlocks(bodyLines, pageWidth) {
    const w = pageWidth || 800;
    const merged = [];
    for (const line of bodyLines) {
      const hasBul = isBulletLine(line);
      const step = String(line.text || '').match(/^\s*(\d{1,2})[.)]\s+\S/);
      const norm = {
        ...line,
        ...(step ? { step: Number(step[1]) } : {}),
        hasBullet: hasBul,
        cleanText: cleanBulletText(line.cleanText || line.text),
        formattedText: hasBul ? stripMarkerFmt(line.formattedText || line.text) : line.formattedText || line.text,
      };
      const prev = merged[merged.length - 1];
      if (!prev) {
        merged.push(norm);
        continue;
      }
      const vGap = line.topY - prev.bottomY;
      // Never join a row of one side-by-side column onto the other column's row
      const sameColumn = line.column === prev.column || line.column === undefined || prev.column === undefined;
      const sameFont = sameColumn && Math.abs(line.fontSize - prev.fontSize) <= 1.2;
      const aligned = Math.abs(line.textX0 - prev.textX0) <= 10 || Math.abs(line.x0 - prev.x0) <= 10;
      // A short "Pros:" / "Cons:" label is a heading of its own, and nothing joins onto a row ending in ":"
      const isLabel = /^\S+(?:\s+\S+){0,2}:$/.test(norm.cleanText) || /:\s*$/.test(prev.cleanText);
      // A caption never joins body text, and body text never joins a caption.
      const sameKind = (line.kind || '') === (prev.kind || '');
      // Centred lines that each open with a capital and follow a complete line are separate points, not one
      // wrapped sentence ("Clinical signs overlap ..." / "Serology is of limited use ..." under a heading).
      const restarts = !aligned && !prev.hasBullet && /^[A-Z]/.test(norm.cleanText) && !/[,;(–—→-]$|…\.?$|\.\.\.$|\b(?:and|or|of|the|a|an|to|in|for|with|by|on|at|as)$/i.test(prev.cleanText);
      // "Polioencephalitis: ..." then "Leukoencephalitis: ...": each "Term: meaning" line is an item of its own
      const nextTerm = TERM_LINE_RE.test(norm.cleanText.replace(/^¿/, '')) && TERM_LINE_RE.test(prev.cleanText.replace(/^¿/, ''));
      // A short heading line ("Tapeworms", "Adverse Effects") over a sentence that starts afresh is a label for
      // that sentence, not the first half of it: a wrapped line runs most of the width of the line after it.
      const shortHead = /^[A-Z]/.test(norm.cleanText) && prev.cleanText.split(/\s+/).length <= 3 && !/[,;(–—-]$/.test(prev.cleanText) &&
        !/\b(?:and|or|of|the|a|an|to|in|for|with|by|on|at|as)$/i.test(prev.cleanText) && (prev.x1 - prev.x0) < (line.x1 - line.x0) * 0.5;
      // A row of a diagram's labels ("L4 L3 L2 L1 T13") never continues the sentence above it
      const codes = LABEL_ROW_RE.test(norm.cleanText);
      // A capitalised line after a line that ended a phrase with room to spare is a new item whose bullet
      // glyph was lost ("Tick larvae feed on 1˚ host (...)" / "Larvae molt into nymphs, ..."): a wrapped line
      // breaks only when its next word would not fit.
      const roomy = /^[A-Z]/.test(norm.cleanText) && !/[,;:(–—-]$|\b(?:and|or|of|the|a|an|to|in|for|with|by|on|at|as)$/i.test(prev.cleanText) &&
        (/[)\].!?”"]$/.test(prev.cleanText) || prev.x1 + firstWordWidth(line) < rightEdge(bodyLines, prev) - 4);
      const plain = !hasBul && !line.isCode && !prev.isCode && sameFont && sameKind && vGap >= -4 && !isLabel && !restarts && !nextTerm && !shortHead && !codes && !roomy;
      const tight = plain && vGap <= prev.fontSize * 0.72 && (aligned || prev.x1 > w * 0.62);
      // Hard break inside a sentence: previous line runs wide and stops mid-sentence, next starts lowercase
      const loose = plain && vGap <= prev.fontSize * 1.35 && prev.x1 > w * 0.62 && !TERMINAL_RE.test(prev.cleanText) &&
        /^[a-z(]/.test(norm.cleanText) && line.x0 >= (prev.textX0 || prev.x0) - 10;
      // A numbered label of a diagram wraps centred under itself ("7. Virus moves" / "down peripheral").
      const centre = (l) => (l.x0 + l.x1) / 2;
      const labelWrap = plain && prev.step != null && vGap <= prev.fontSize * 0.72 && Math.abs(centre(line) - centre(prev)) <= CENTRE_WRAP_TOL;
      if (tight || loose || labelWrap) {
        prev.cleanText = `${prev.cleanText} ${norm.cleanText}`.trim();
        prev.formattedText = `${prev.formattedText} ${norm.formattedText}`.trim();
        prev.bottomY = Math.max(prev.bottomY, line.bottomY);
        prev.x1 = Math.max(prev.x1, line.x1);
      } else merged.push(norm);
    }
    return merged;
  }

  const CENTRE_WRAP_TOL = 12;

  /** Width of a line's first word, from its share of the line's characters. */
  function firstWordWidth(line) {
    const t = String(line.cleanText || line.text || '').trim();
    const word = (t.match(/^\S+/) || [''])[0];
    return t.length ? ((line.x1 - line.x0) * word.length) / t.length : 0;
  }

  /** Right edge of the text block a line sits in: the widest line starting at the same left edge. */
  function rightEdge(lines, line) {
    const x = line.textX0 || line.x0;
    const same = lines.filter((l) => Math.abs((l.textX0 || l.x0) - x) <= 10 && l.column === line.column);
    return Math.max(line.x1, ...same.map((l) => l.x1));
  }
  const MIN_STEPS = 3;

  /**
   * Numbered labels set around a picture (a cycle drawn as "1. Wound is contaminated" ... "8. Virus shed") are
   * read column by column, out of their order, and their left edges say nothing about nesting: they are put in
   * the order of their numbers, at one level, keeping their numbers. Other lines keep their places.
   */
  function orderSteps(nodes, blocks) {
    const numbered = blocks.map((b, i) => ({ b, i })).filter(({ b, i }) => b.step != null && nodes[i]);
    if (numbered.length < MIN_STEPS) return nodes;
    const numbers = numbered.map(({ b }) => b.step);
    const ascending = numbers.every((n, k) => k === 0 || n > numbers[k - 1]);
    if (ascending || new Set(numbers).size !== numbers.length) return nodes;
    const sorted = numbered.slice().sort((x, y) => x.b.step - y.b.step)
      .map(({ b, i }) => ({ ...nodes[i], level: 0, text: `${b.step}. ${nodes[i].text}`, formattedText: `${b.step}. ${nodes[i].formattedText}` }));
    const slots = new Set(numbered.map(({ i }) => i));
    let next = 0;
    return nodes.map((n, i) => (slots.has(i) ? sorted[next++] : n));
  }

  /** Indent tiers of one set of rows: distinct x0 values more than 14pt apart. */
  function tiersOf(blocks) {
    const tiers = [];
    for (const x of [...new Set(blocks.map((b) => Math.round(b.x0)))].sort((a, b) => a - b)) {
      if (!tiers.length || x - tiers[tiers.length - 1] > 14) tiers.push(x);
    }
    return tiers;
  }

  const FAR_GAP = 2.5; // x font size: an empty band this tall between two lines holds a picture

  /**
   * Centre-aligned lines (each line centred on one axis, so their left edges say nothing about nesting) take
   * their level from their shape: a heading is 0, a "Pros:" label 1, a bulleted point under it 2 (1 without
   * labels). Returns a level function, or null when the lines are not centred.
   */
  function centredLevels(rows) {
    if (rows.length < 4) return null;
    const centres = rows.map((b) => (b.x0 + b.x1) / 2);
    const lefts = rows.map((b) => b.x0);
    const spread = (v) => Math.max(...v) - Math.min(...v);
    if (spread(centres) > CENTRE_TOL || spread(lefts) < CENTRE_TOL * 2) return null;
    const isLabelRow = (b) => !b.hasBullet && /^\S+(?:\s+\S+){0,2}:$/.test(b.cleanText);
    const labels = rows.some(isLabelRow);
    return (b) => (b.hasBullet ? (labels ? 2 : 1) : isLabelRow(b) ? 1 : 0);
  }
  const CENTRE_TOL = 40; // pt: centres of a centred block stay this close; their left edges spread wider

  /**
   * Indent tiers -> nestedBullets[{ level, text, formattedText, ... }]. Side-by-side columns (slide-columns.js)
   * get their own tiers, so each column's heading is level 0 and its items nest under it.
   */
  function toNested(blocks) {
    const sideBySide = new Set(blocks.map((b) => b.column).filter((c) => c >= 1000));
    const tierMap = new Map();
    const tiersFor = (b) => {
      const key = sideBySide.has(b.column) ? b.column : 'main';
      if (!tierMap.has(key)) tierMap.set(key, tiersOf(blocks.filter((o) => (sideBySide.has(o.column) ? o.column : 'main') === key)));
      return tierMap.get(key);
    };
    const centred = new Map();
    const centredLevel = (b) => {
      const key = sideBySide.has(b.column) ? b.column : 'main';
      if (!centred.has(key)) centred.set(key, centredLevels(blocks.filter((o) => (sideBySide.has(o.column) ? o.column : 'main') === key)));
      return centred.get(key) ? centred.get(key)(b) : null;
    };
    const nodes = blocks
      .map((b, i) => {
        const tiers = tiersFor(b);
        let level = tiers.findIndex((t) => Math.abs(b.x0 - t) <= 14);
        if (level === -1) level = tiers.length - 1;
        const byCentre = centredLevel(b);
        if (byCentre !== null) level = byCentre;
        // A deeper line far below the line above it (a picture between them) is not that line's child.
        const prev = blocks.slice(0, i).reverse().find((o) => o.column === b.column);
        if (byCentre === null && prev && b.topY - prev.bottomY > FAR_GAP * (prev.fontSize || 12) && b.x0 > prev.x0 + 14) level = 0;
        return {
          level: Math.max(0, Math.min(level, 2)),
          text: b.cleanText,
          formattedText: b.formattedText,
          fontSize: b.fontSize,
          isBold: b.isBold,
          isCode: Boolean(b.isCode),
          firstSpanBold: b.firstSpanBold || '',
          ...(b.kind ? { kind: b.kind } : {}),
          // the line carried a bullet glyph (stripped from its text): an item of a list, never its label
          ...(b.hasBullet ? { bullet: true } : {}),
          // side-by-side list this item belongs to: 0 = left, 1 = right (absent on single-column slides)
          ...(sideBySide.has(b.column) ? { column: [...sideBySide].sort().indexOf(b.column) } : {}),
          // the page column the layout reader put the line in (Summary keeps each column's lines together)
          ...(!sideBySide.has(b.column) && Number.isFinite(b.column) ? { layoutColumn: b.column } : {}),
        };
      });
    return orderSteps(nodes, blocks).filter((b) => b.text);
  }

  PDFStudy.slideLines = { SLIDE_BULLET_RE, isBulletLine, cleanBulletText, stripMarkerFmt, prepare, detectTable, mergeBlocks, toNested };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideLines;
  }
})(typeof window !== 'undefined' ? window : globalThis);

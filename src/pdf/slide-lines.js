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

  const isBulletLine = (line) => Boolean((line && line.hasBullet) || SLIDE_BULLET_RE.test((line && line.text) || ''));
  const cleanBulletText = (str) => String(str || '').replace(SLIDE_BULLET_RE, '').trim();

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
      const norm = {
        ...line,
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
      const sameFont = Math.abs(line.fontSize - prev.fontSize) <= 1.2;
      const aligned = Math.abs(line.textX0 - prev.textX0) <= 10 || Math.abs(line.x0 - prev.x0) <= 10;
      const plain = !hasBul && !line.isCode && !prev.isCode && sameFont && vGap >= -4;
      const tight = plain && vGap <= prev.fontSize * 0.72 && (aligned || prev.x1 > w * 0.62);
      // Hard break inside a sentence: previous line runs wide and stops mid-sentence, next starts lowercase
      const loose = plain && vGap <= prev.fontSize * 1.35 && prev.x1 > w * 0.62 && !TERMINAL_RE.test(prev.cleanText) &&
        /^[a-z(]/.test(norm.cleanText) && line.x0 >= (prev.textX0 || prev.x0) - 10;
      if (tight || loose) {
        prev.cleanText = `${prev.cleanText} ${norm.cleanText}`.trim();
        prev.formattedText = `${prev.formattedText} ${norm.formattedText}`.trim();
        prev.bottomY = Math.max(prev.bottomY, line.bottomY);
        prev.x1 = Math.max(prev.x1, line.x1);
      } else merged.push(norm);
    }
    return merged;
  }

  /** Indent tiers -> nestedBullets[{ level, text, formattedText, ... }]. */
  function toNested(blocks) {
    const tiers = [];
    for (const x of [...new Set(blocks.map((b) => Math.round(b.x0)))].sort((a, b) => a - b)) {
      if (!tiers.length || x - tiers[tiers.length - 1] > 14) tiers.push(x);
    }
    return blocks
      .map((b) => {
        let level = tiers.findIndex((t) => Math.abs(b.x0 - t) <= 14);
        if (level === -1) level = tiers.length - 1;
        return {
          level: Math.max(0, Math.min(level, 2)),
          text: b.cleanText,
          formattedText: b.formattedText,
          fontSize: b.fontSize,
          isBold: b.isBold,
          isCode: Boolean(b.isCode),
          firstSpanBold: b.firstSpanBold || '',
        };
      })
      .filter((b) => b.text);
  }

  PDFStudy.slideLines = { SLIDE_BULLET_RE, isBulletLine, cleanBulletText, stripMarkerFmt, prepare, detectTable, mergeBlocks, toNested };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideLines;
  }
})(typeof window !== 'undefined' ? window : globalThis);

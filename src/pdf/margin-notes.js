/**
 * Margin Notes for text-cleaner.js (100% offline, deterministic).
 * Groups one page's margin rows into notes and turns full-sentence notes into key-concept blocks
 * (textbooks that restate each paragraph's point in the outer margin). Icon labels such as "Links" or
 * "Extra Examples" are not sentences and stay plain margin text.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const NOTE_GAP = 1.0; // x font size: rows further apart belong to different notes
  const MIN_WORDS = 6; // a key concept is a sentence, not an icon caption
  const SENTENCE_END_RE = /[.!?]["”')\]]?$/;

  /** rows: [{ line, raw }] in reading order -> [[row, ...], ...] */
  function groupNotes(rows) {
    const groups = [];
    let cur = [];
    for (const r of rows) {
      const prev = cur[cur.length - 1];
      const fs = (r.line && r.line.fontSize) || 10;
      const gap = prev && Number.isFinite(r.line.topY) && Number.isFinite(prev.line.bottomY) ? r.line.topY - prev.line.bottomY : 0;
      if (prev && (gap > fs * NOTE_GAP || gap < -fs)) {
        groups.push(cur);
        cur = [];
      }
      cur.push(r);
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  /** Joins a note's rows, mending "contribu-" + "tions" wraps. */
  function noteText(group) {
    let out = '';
    for (const r of group) {
      const t = String(r.raw || '').replace(/\*\*/g, '').trim();
      if (!t) continue;
      if (/[a-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
      else out = out ? `${out} ${t}` : t;
    }
    return out.replace(/\s+/g, ' ').trim();
  }

  /** A full-sentence note -> { category: 'Key Concept', kind: 'key-concept', id, title, body, ... } or null. */
  function keyConcept(group, pageNumber, seq) {
    const body = noteText(group);
    if (body.split(/\s+/).length < MIN_WORDS || !SENTENCE_END_RE.test(body) || !/^[A-Z“"(]/.test(body)) return null;
    const ls = group.map((r) => r.line).filter((l) => Number.isFinite(l.topY));
    const r1 = (v) => Math.round(v * 10) / 10;
    const box = ls.length
      ? { page: pageNumber, top: r1(Math.min(...ls.map((l) => l.topY))), bottom: r1(Math.max(...ls.map((l) => l.bottomY))),
        left: r1(Math.min(...ls.map((l) => l.x0))), right: r1(Math.max(...ls.map((l) => l.x1))) }
      : null;
    return {
      category: 'Key Concept', kind: 'key-concept', id: `blk-${seq}`, title: 'Key Concept', body, formulas: [], pageNumber,
      clip: box, bbox: box ? { ...box } : null,
    };
  }

  PDFStudy.marginNotes = { groupNotes, keyConcept, noteText };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.marginNotes;
  }
})(typeof window !== 'undefined' ? window : globalThis);

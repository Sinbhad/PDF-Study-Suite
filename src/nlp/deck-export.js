/**
 * Flashcard export serialisers (DOM-free): an Anki text import file and a Quizlet CSV.
 * Both take the deck the student sees, so edits are included and deleted cards are not.
 *   ankiTsv(cards, { docName })   tab-separated, with Anki's file headers, HTML fields, MathJax
 *                                 delimiters ( \( … \) inline, \[ … \] display ) and a tags column
 *   quizletCsv(cards, { plain })  term,definition per line; `plain` turns rich text into readable text
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const ANKI_HEADER = ['#separator:tab', '#html:true', '#columns:Front\tBack\tTags', '#tags column:3'];
  const BASE_TAG = 'StudySuite';

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /** `$$…$$` -> `\[…\]`, `$…$` -> `\(…\)`; text already written with `\(` or `\[` is left alone. */
  function mathToAnki(text) {
    return String(text)
      .replace(/\$\$([\s\S]+?)\$\$/g, (_all, tex) => `\\[${tex.trim()}\\]`)
      .replace(/\$([^$\n]+?)\$/g, (_all, tex) => `\\(${tex.trim()}\\)`);
  }

  /** One Anki field: escaped for HTML, math converted, never a raw tab or line break. */
  function ankiField(text) {
    return mathToAnki(escapeHtml(text == null ? '' : text))
      .replace(/\t/g, ' ')
      .replace(/\r?\n/g, '<br>')
      .trim();
  }

  /** Anki tags are separated by spaces, so a tag is one run of letters, digits and - . : _ */
  function tag(text) {
    return String(text == null ? '' : text)
      .replace(/\.pdf$/i, '')
      .replace(/[^\p{L}\p{N}\-.:]+/gu, '_')
      .replace(/^_+|_+$/g, '');
  }

  function ankiTags(card, docName) {
    const tags = [BASE_TAG, tag(docName), tag(card.context || card.category)];
    return tags.filter((t, i) => t && tags.indexOf(t) === i).join(' ');
  }

  function ankiTsv(cards, opts) {
    const docName = (opts && opts.docName) || '';
    const rows = (cards || []).map((c) => `${ankiField(c.front)}\t${ankiField(c.back)}\t${ankiTags(c, docName)}`);
    return `${ANKI_HEADER.concat(rows).join('\n')}\n`;
  }

  /** RFC 4180 quoting; a field never keeps a line break because Quizlet starts a new card there. */
  function csvField(text) {
    const flat = String(text == null ? '' : text).replace(/\s*\r?\n\s*/g, '; ').replace(/\s+/g, ' ').trim();
    return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
  }

  function quizletCsv(cards, opts) {
    const plain = (opts && opts.plain) || ((t) => String(t == null ? '' : t));
    const rows = (cards || []).map((c) => `${csvField(plain(c.front))},${csvField(plain(c.back))}`);
    return rows.length ? `${rows.join('\n')}\n` : '';
  }

  /** A file name that is safe on every platform: `Chapter 2 (notes).pdf` -> `Chapter_2_notes`. */
  const fileStem = (docName) => String(docName || 'flashcards').replace(/\.pdf$/i, '').replace(/[^\p{L}\p{N}\-]+/gu, '_').replace(/^_+|_+$/g, '') || 'flashcards';

  const api = { ankiTsv, quizletCsv, mathToAnki, ankiField, ankiTags, csvField, fileStem };
  PDFStudy.deckExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

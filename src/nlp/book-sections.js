/**
 * Book sections: splits a textbook scope's cleaned text into the book's own headed sections, each a list of
 * paragraphs that know their page and what kind of text they are. DOM-free.
 *   split(text, { pages, startPage, lines }) -> [{ title, page, paragraphs: [{ text, page, kind, lines, blockId? }] }]
 *     kind: 'prose' | 'example' | 'box' | 'objectives' | 'math' | 'code' | 'table' | 'list' | 'margin'
 * `lines` (optional) are the extraction's tagged lines (scope.lines). With them a line filed under a block
 * (sidebar, key concept, definition box) joins a 'box' paragraph carrying that blockId, table rows form
 * 'table' paragraphs, and a heading-shaped line inside a box, caption, table or listing is not a section.
 * `pages` (optional) are the raw extracted pages of the scope ({ pageNumber, lines: [{ text, fontSize, isBold,
 * x0 }] }). They give every line its page and let font size confirm a heading. Without them every paragraph
 * sits on `startPage` and only numbered headings ("2.1 Sets", "2-3 Latches") are recognised.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // A heading is a short line: at most this many characters / words, with no sentence punctuation at the end.
  const HEADING_MAX_CHARS = 80;
  const HEADING_MAX_WORDS = 12;
  // Heading type sizes relative to the page's body text: a bold heading may be slightly larger, a plain one clearly so.
  const BOLD_HEADING_RATIO = 1.08;
  const PLAIN_HEADING_RATIO = 1.08;
  // A line ending a sentence and shorter than this share of the typical line length ends its paragraph.
  const SHORT_LAST_LINE = 0.8;
  // A first line indented this far (points) past the column's left edge starts a paragraph.
  const INDENT_PT = 6;
  // An example with no end marker in the book ends after this many lines at most.
  const EXAMPLE_MAX_LINES = 40;

  const NUMBERED_HEADING_RE = /^(?:\d+(?:[.\-]\d+)+|[A-Z]\.\d+(?:\.\d+)*)\s+[A-Z(]/;
  const END_MARK_RE = /[◂◀∎□]\s*\$*\s*$/;
  // A numbered list item or exercise ("8. Suppose that ...", "(b) ..."): never a standalone statement.
  const LIST_ITEM_RE = /^(?:\d{1,3}[.)]|\([a-z0-9]{1,3}\))\s+\S/;
  // "Syntax 5.1 …", "Table 2-3 …", "Figure 4": a numbered label of a box, table or figure, not a section.
  const LABEL_RE = /^(?:[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+[A-Z]?\d+(?:[.\-]\d+)*\b/;
  const OBJECTIVES_RE = /\b(?:objectives?|learning\s+(?:outcomes?|goals?|targets?)|chapter\s+goals?|what\s+you\s+will\s+learn)\b/i;
  // A learning-objective line: a bullet glyph or an infinitive goal ("To understand ...").
  const OBJECTIVE_LINE_RE = /^(?:[■▪•◦\-–]|To\s+[a-z]|[a-z])/;
  const EXAMPLE_START_RE = /^(?:EXAMPLE|Example|Worked\s+Example)\s+[A-Z]?\d+(?:[.\-]\d+)*\b|^(?:Solution|SOLUTION)\b/;
  const EXAMPLE_END_RE = /[◂◀∎□■▪]\s*\$*\s*$/;
  // The label of a box, not a sentence that opens with the same word: "Note 2.1", "Note:", "Common Error 5.2 ..."
  // open a box; "Note that identity 9 states ..." is prose.
  const BOX_LABEL_WORDS_RE = /^(?:Syntax|Program\s+Run|Self\s+Check|Common\s+Error|Programming\s+Tip|Special\s+Topic|How\s+To|Worked\s+Example|Computing\s+&\s+Society|Pitfall|Caution|Warning|Tip|Note|Remark|By\s+the\s+Way|Box)\b/i;
  const BOX_LABEL_RE = { test: (t) => { const m = String(t).match(BOX_LABEL_WORDS_RE); return Boolean(m) && !/^\s+[a-z]/.test(String(t).slice(m[0].length)); } };

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').trim();
  // Ties cleaned lines to the raw page lines (page, type size, dropped labels): page-lines.js.
  const pageLines = () => PDFStudy.pageLines || (typeof require === 'function' ? require('./page-lines.js') : null);

  function looksLikeHeading(line, raw) {
    const full = plain(line).replace(END_MARK_RE, '').trim();
    if (END_MARK_RE.test(plain(line))) return false; // the last line of an example
    // A symbol inside a set heading ("SR and $\overline{S}\overline{R}$ Latches") counts as one word; a formula never heads a section
    const t = raw && raw.isBold ? full.replace(/\$[^$=<>]{1,40}\$/g, 'X') : full;
    const wordCount = t.split(/\s+/).length;
    if (!t || t.length > HEADING_MAX_CHARS || wordCount > HEADING_MAX_WORDS) return false;
    if (/[.,;:?!]$/.test(t) || /\$/.test(t) || !/^[A-Z0-9(]/.test(t)) return false;
    if (/[a-z][.!?]\s+[A-Z]/.test(t)) return false; // a sentence ends inside it: wrapped prose, not a heading
    if (/\/\/|\/\*|[;{}]/.test(t)) return false; // a line of a program listing ("25 // Find the largest value")
    if ((t.match(/[A-Za-z]{2,}/g) || []).length < 1) return false;
    if (LABEL_RE.test(t) && !NUMBERED_HEADING_RE.test(t)) return false;
    if (BOX_LABEL_RE.test(t) || EXAMPLE_START_RE.test(t)) return false;
    if (/\b(?:a|an|the|of|to|and|or|is|are|be|as|in|for|with|by|that)$/i.test(t)) return false; // a wrapped sentence
    if (NUMBERED_HEADING_RE.test(t)) return true;
    if (!raw || !raw.body || !raw.fontSize) return false;
    const ratio = raw.fontSize / raw.body;
    return ratio >= PLAIN_HEADING_RATIO || (raw.isBold && ratio >= BOLD_HEADING_RATIO);
  }

  // The second line of a two-line title: an optional chapter number, then a joining word ("3 and Normalization")
  const CONTINUED_TITLE_RE = /^(?:\d{1,2}\s+)?((?:and|of|in|for|with|to|the|from|on)\s+\S.*)$/;
  const RUN_IN_MAX_WORDS = 5;
  const BOLD_RUN_IN_MAX_WORDS = 8;
  const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'with', 'vs']);

  /**
   * A sub-heading set in body type on its own line ("Surrogate Keys" between two paragraphs): a short Title
   * Case line after a finished sentence, followed by a line that starts a sentence. Without it the heading
   * is glued to the definition after it ("Surrogate Keys A surrogate key is ...").
   */
  function runInHeading(line, prev, next, bold) {
    const t = plain(line);
    const words = t.split(/\s+/);
    // A line set wholly in bold may be a little longer: "Eliminating Anomalies with BCNF"
    if (!t || words.length > (bold ? BOLD_RUN_IN_MAX_WORDS : RUN_IN_MAX_WORDS) || /[.,;:?!$]/.test(t) || !/^[A-Z]/.test(t)) return false;
    if (!words.every((w) => SMALL_WORDS.has(w) || /^[A-Z0-9]/.test(w)) || words.length < 2) return false;
    if (LABEL_RE.test(t) || BOX_LABEL_RE.test(t) || EXAMPLE_START_RE.test(t)) return false;
    const before = plain(prev || '');
    const after = plain(next || '');
    if (!/[.!?:"”)]\s*\$*$/.test(before)) return false;
    // In bold, the heading's type says what it is: any sentence may follow ("However, the conditions ...")
    if (bold) return /^[A-Z]/.test(after) && !/^[A-Z][A-Za-z_]*\s*\(/.test(t);
    return /^(?:An?|The|In|When|If|Each|Every|To|This|These)\s/.test(after);
  }

  /** Every word capitalised except the small joining words: "Basic Identities of Boolean Algebra". */
  const titleCased = (line) => plain(line).replace(/\$[^$]*\$/g, 'X').split(/\s+/)
    .every((w, i) => /^[A-Z0-9(“"'‘]/.test(w) || (i > 0 && SMALL_WORDS.has(w.toLowerCase())));

  /** Key under which a running head repeats from page to page: its letters, without page numbers. */
  const runningKey = (line) => plain(line).toLowerCase().replace(/[^a-z]+/g, '');

  /**
   * Heading-like lines that recur (running heads: "38 CHAPTER 2 / Combinational Logic Circuits") are page
   * furniture; so is a short line opening or closing with a page number around a " / " or "CHAPTER".
   */
  function runningHeads(lines, aligned) {
    const counts = new Map();
    lines.forEach((l, i) => {
      if (!looksLikeHeading(l, aligned[i].raw)) return;
      const k = runningKey(l);
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    });
    return (line) => {
      const t = plain(line);
      if (/^\d+\s+(?:CHAPTER|Chapter)\b|\s\/\s.*\d+$|^\d+\s.*\s\/\s/.test(t) && t.length <= HEADING_MAX_CHARS) return true;
      return (counts.get(runningKey(line)) || 0) >= 2;
    };
  }

  /** Small-caps extraction yields "BooLean aLgeBra": words with inner capitals are re-cased. */
  function tidyHeading(title) {
    return plain(title).replace(/[A-Za-z][A-Za-z-]*/g, (w) => (/[a-z][A-Z]/.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w));
  }

  // Line kinds of the extraction (scope.lines) that are never a section heading.
  const NOT_HEADING_KINDS = new Set(['caption', 'table', 'code', 'margin', 'example', 'syntax', 'self-check', 'folio', 'url', 'biography']);
  // A program file name set as a listing's title: "sec01/ElevatorSimulation.java".
  const FILE_NAME_RE = /^\**[\w./-]+\.(?:java|py|cpp|cc|cs|js|ts|c|h|txt|html|sql|xml|json)\**$/i;
  // A title that points at a figure or table is that figure's caption: "VHDL Model for the Circuit of Figure 2-5".
  const FIGURE_REF_RE = /\b(?:Figure|Fig\.|Table)\s+[A-Z]?\d+(?:[.\-]\d+)*\b/;

  /**
   * The extraction's record of each text line (scope.lines: { text, pageNumber, kind, blockId, inText }),
   * matched in reading order. scope.text is exactly the inText lines, so a forward walk pairs them up.
   */
  function tagLines(lines, scopeLines) {
    const src = (scopeLines || []).filter((l) => l && l.inText !== false && typeof l.text === 'string');
    const out = new Array(lines.length).fill(null);
    if (!src.length) return out;
    const key = (s) => plain(s).replace(/\s+/g, ' ');
    let j = 0;
    lines.forEach((line, i) => {
      const k = key(line);
      if (!k) return;
      for (let m = j; m < Math.min(src.length, j + 60); m++) {
        if (key(src[m].text) === k) { out[i] = src[m]; j = m + 1; return; }
      }
    });
    return out;
  }

  /** A heading-shaped line the extraction placed in a box, a caption, a table or a listing is not a section. */
  const vetoedHeading = (line, tag) => FILE_NAME_RE.test(plain(line)) || FIGURE_REF_RE.test(plain(line)) ||
    Boolean(tag && (tag.blockId || NOT_HEADING_KINDS.has(tag.kind)));

  /** Typical (median) length of full prose lines: the column width in characters. */
  function typicalLength(lines) {
    const lens = lines.map((l) => l.length).filter((n) => n >= 40).sort((a, b) => a - b);
    return lens.length ? lens[Math.floor(lens.length / 2)] : 80;
  }

  function split(text, opts = {}) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const pl = pageLines();
    const raws = pl.index(opts.pages);
    const aligned = pl.align(lines, raws);
    const edges = pl.leftEdges(aligned);
    const typical = typicalLength(lines);
    const usesEndMarker = lines.some((l) => EXAMPLE_END_RE.test(l));
    const isRunningHead = runningHeads(lines, aligned);
    const tags = tagLines(lines, opts.lines);
    // A book that numbers its sections ("5.2.1 Relational Operators") sets its other headings in Title Case:
    // a sentence-case line in larger type there is a step or a label inside a box ("Type the skeleton")
    const numberedBook = lines.filter((l, i) => NUMBERED_HEADING_RE.test(plain(l)) && looksLikeHeading(l.trim(), aligned[i].raw)).length >= 2;
    let page = opts.startPage || (raws[0] && raws[0].page) || null;

    const sections = [];
    let section = { title: '', page, paragraphs: [] };
    let para = null;
    let region = 'prose'; // 'example' | 'box' | 'objectives' while inside one
    let regionLines = 0;
    let inFence = false;

    const closePara = () => {
      if (para && para.lines.length) section.paragraphs.push({ ...para, text: para.lines.join(' ').replace(/\s+/g, ' ').trim() });
      para = null;
    };
    const openPara = (kind, blockId) => {
      closePara();
      para = { kind, page, lines: [], pages: [], ...(blockId ? { blockId } : {}) };
    };
    const startSection = (title) => {
      closePara();
      if (section.title || section.paragraphs.length) sections.push(section);
      section = { title, page, paragraphs: [] };
    };

    lines.forEach((line, i) => {
      const t = line.trim();
      const { raw, skipped } = aligned[i];
      // The extraction's own record of the line knows its page; the raw-line alignment is the fallback
      if (tags[i] && tags[i].pageNumber && tags[i].kind !== 'margin') page = tags[i].pageNumber;
      else if (raw && !raw.isMargin) page = raw.page;
      if (!t) { closePara(); return; }
      if (isRunningHead(t)) return;
      // Margin notes (biographies, asides, box labels) are never part of the section's own text.
      if (raw && raw.isMargin) {
        if (!para || para.kind !== 'margin') openPara('margin');
        para.lines.push(t);
        para.pages.push(raw.page);
        return;
      }
      if (/^```/.test(t)) {
        if (!inFence) openPara('code');
        inFence = !inFence;
        para.lines.push(t);
        if (!inFence) closePara();
        return;
      }
      if (inFence) { para.lines.push(line); return; }

      // A line the extraction filed under a box (sidebar, key concept, definition) or a table stays with it.
      const tag = tags[i];
      if (tag && (tag.blockId || tag.kind === 'table') && tag.kind !== 'margin') {
        const kind = tag.kind === 'table' && !tag.blockId ? 'table' : 'box';
        if (!para || para.kind !== kind || para.blockId !== (tag.blockId || undefined)) openPara(kind, tag.blockId);
        para.lines.push(t);
        para.pages.push(tag.pageNumber || page);
        return;
      }

      // A dropped "EXAMPLE 6" label (the cleaner removes it) still opens the example that follows.
      if (skipped.some((r) => EXAMPLE_START_RE.test(r.text)) || EXAMPLE_START_RE.test(plain(t))) {
        if (region !== 'example') { region = 'example'; regionLines = 0; openPara('example'); }
      }
      // A run-in sub-heading is read only from a laid-out page (raw lines or the extraction's line record)
      const near = (step) => { for (let k = i + step; k >= 0 && k < lines.length; k += step) if (lines[k].trim()) return lines[k]; return ''; };
      // A bold row split into cells is a table's header ("Source of Anomaly | Normal Forms | ..."), not a heading
      // and neither is a bold label set smaller than the body text (a figure's or table's own labels)
      const wholeBold = (Boolean(raw && raw.isBold) || /^\*\*[^*]+\*\*$/.test(t)) && !(raw && (raw.cells || (raw.body && raw.fontSize < raw.body * 0.95))) && !/_/.test(t);
      const shaped = looksLikeHeading(t, raw) || ((raw || tag) && runInHeading(t, near(-1), near(1), wholeBold));
      if (shaped && !vetoedHeading(t, tag) && (!numberedBook || NUMBERED_HEADING_RE.test(plain(t)) || titleCased(t))) {
        region = OBJECTIVES_RE.test(t) ? 'objectives' : 'prose';
        // A title set on two lines ("The Relational Model" / "3 and Normalization", the chapter number printed
        // large beside the second line) is one heading: a line that goes on with a joining word continues it
        const cont = plain(t).match(CONTINUED_TITLE_RE);
        if (cont && section.title && !section.paragraphs.length && !(para && para.lines.length)) {
          section.title = `${section.title} ${tidyHeading(cont[1])}`;
          return;
        }
        startSection(tidyHeading(t));
        return;
      }
      if (BOX_LABEL_RE.test(plain(t)) && region === 'prose') { region = 'box'; regionLines = 0; openPara('box'); }
      // Objectives are a run of bullet-like lines under their heading; the first ordinary line ends them.
      if (region === 'objectives' && !OBJECTIVE_LINE_RE.test(t)) {
        region = 'prose';
        startSection('');
      }

      // The label of a numbered definition / theorem box, set apart by the cleaner, opens the box's paragraph.
      const boxName = region !== 'prose' ? null : (raw && raw.boxName) || skipped.map((r) => r.text.match(pl.BOX_NAME_RE)).find(Boolean) || null;
      const listItem = region === 'prose' && LIST_ITEM_RE.test(t);
      const kind = region !== 'prose' ? region : /^\$\$[\s\S]*\$\$$/.test(t) ? 'math' : listItem || (para && para.kind === 'list' && !boxName) ? 'list' : 'prose';
      const prev = i > 0 ? lines[i - 1].trim() : '';
      const endedSentence = /[.!?:"”)◂]\s*\$*$/.test(prev);
      const shortPrev = prev.length < typical * SHORT_LAST_LINE;
      const edge = raw && edges.get(raw.page);
      const indented = raw && Number.isFinite(raw.x0) && Number.isFinite(edge) && raw.x0 - edge >= INDENT_PT && raw.x0 - edge < 60;
      const paraBreak = endedSentence && (shortPrev || indented);
      // A list runs on over its items' wrapped lines and ends at a paragraph break.
      const listKind = kind === 'list' && !listItem && paraBreak ? 'prose' : kind;
      const newPara = !para || para.kind !== listKind || listKind === 'math' || listItem || boxName || paraBreak;
      if (newPara) openPara(listKind);
      if (boxName) para.box = { category: boxName[1], number: boxName[2] };
      para.lines.push(t);
      para.pages.push(page);

      if (region === 'example' || region === 'box') {
        regionLines++;
        const lastShort = /[.!?:"”)]\s*\$*$/.test(t) && t.length < typical * SHORT_LAST_LINE;
        const ended = region === 'example' && usesEndMarker ? EXAMPLE_END_RE.test(t) : lastShort;
        if (ended || regionLines >= EXAMPLE_MAX_LINES) { region = 'prose'; closePara(); }
      }
    });
    closePara();
    if (section.title || section.paragraphs.length) sections.push(section);
    return sections.filter((s) => s.paragraphs.length || s.title);
  }

  const api = { split, looksLikeHeading };
  PDFStudy.bookSections = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

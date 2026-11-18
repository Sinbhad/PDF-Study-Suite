/**
 * Book blocks: the extraction's tagged blocks and tables (scope.blocks, scope.tables) as Summary items for
 * book-outline.js. Which blocks a student revises from is read from the block's kind, never from its subject:
 * definitions, theorems / laws / rules, key-concept notes and common-error boxes are shown; worked examples,
 * proofs, self-checks, syntax diagrams and other sidebars (tips, history, how-to walkthroughs) are not.
 *   item(block, ctx)   -> null | { category, label, title, body, page, flag?, terms: [term], blockId }
 *     label: the book's own name for the box ("Definition 4", "Common Error 5.1"); title: the term a
 *     definition defines ("Disjunction"), or the box's own subtitle. flag: why the text cannot be trusted as is.
 *   table(t, ctx)      -> null | { title, rows, more, page }   (only tables whose rows line up in columns)
 *   boxTerm(body)      -> the term a definition box defines, or ''
 * ctx: { linesByBlock: Map(blockId -> [scope line]), captionsByPage: Map(page -> [caption text]) }. DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Longest box body kept, in characters (cut at a sentence end).
  const BOX_MAX_CHARS = 600;
  // A common-error box shows its subtitle and at most this many sentences of its text.
  const PITFALL_SENTENCES = 2;
  // A term name longer than this many words is a phrase, not a term.
  const TERM_MAX_WORDS = 5;
  // Table rows shown; a table is read as a table when this share of its rows has the full column count.
  const MAX_TABLE_ROWS = 12;
  const ALIGNED_SHARE = 0.75;
  // A column whose cells average this many words explains its rows in prose.
  const PROSE_CELL_WORDS = 5;

  const RESULT_RE = /^(?:theorem|lemma|corollary|proposition|law|rule|principle|postulate|axiom|property|identity|algorithm)s?\b/i;
  const PITFALL_RE = /^(?:common\s+error|pitfall|caution|warning|common\s+mistake)s?\b/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const norm = (s) => plain(s).toLowerCase().replace(/\$/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const titleCase = (t) => (/^[a-z]{2}/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);

  /** Cut a box body at the last sentence end before the limit. */
  function trimBody(text) {
    const t = String(text || '').trim();
    if (t.length <= BOX_MAX_CHARS) return t;
    const cut = t.slice(0, BOX_MAX_CHARS);
    const end = cut.lastIndexOf('. ');
    return end > 80 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')} …`;
  }

  /**
   * Prose that extraction swallowed into a math span, for finding the term only (the shown body is flagged
   * instead): "$Aset$ is" -> "A set is", "$Sis a$ finite" -> "S is a finite".
   */
  /**
   * The same damage repaired for display where the reading is certain: a variable followed by "is"/"are"
   * ("$Sis a$ finite" -> "$S$ is a finite"), or the article "A"/"An" before a word ("$Aset$ is" -> "A set is").
   */
  const repairSwallowed = (s) => String(s || '')
    .replace(/\$([A-Z])((?:is|are)\b[a-z ]*?)\s*\$/g, '$$$1$$ $2')
    .replace(/\$(An?)([a-z]{2,}(?:\s+[a-z]+)*)\$/g, '$1 $2');
  const unswallow = (s) => String(s || '').replace(/\$([A-Z])([a-z]{2,}(?:\s+[a-z]+)*)\$/g, '$1 $2');

  /**
   * The term a definition box defines: the subject of its first "The X (of p, denoted by ...) is" or
   * "A X is" sentence ("The disjunction of p and q, denoted by ..., is" -> "Disjunction"), else the term it
   * names with "called" or sets in bold.
   */
  function boxTerms(body) {
    // A formula stands for one symbol X; a ")" right after it closes the formula's own "(" ("$(p ∧ q$)"),
    // never the parenthesis around it ("(also denoted by $\overline{p}$)")
    const opens = (m) => (m.match(/\(/g) || []).length - (m.match(/\)/g) || []).length;
    const s = unswallow(body).replace(/\$[^$]*\$\)?/g, (m) => (m.endsWith(')') && opens(m.slice(0, -1)) <= 0 ? 'X)' : 'X')).replace(/\*\*/g, '');
    // The defining sentence: the first one that is not a "Let p be a proposition." preamble.
    const tok = dep('tokenizer', './tokenizer.js');
    const first = (tok ? tok.splitSentences(s) : [s]).find((x) => !/^Let\s/.test(x)) || s;
    const found = [];
    const add = (m) => { if (m && m[1]) found.push(m[1].trim().replace(/\s+[a-z]$/, '')); };
    // Named outright: "... is called a tautology", "A set is said to be infinite if ...", "we say that S is a finite set".
    add(s.match(/\b(?:is|are)\s+(?:said\s+to\s+be|called)\s+(?:an?\s+|the\s+)?([a-z][a-z\- ]{2,40}?)(?:\s+(?:if|when|of|and)\b|[.,;]|$)/));
    add(s.match(/\bwe\s+say\s+that\s+X\s+is\s+(?:an?\s+)?([a-z][a-z\- ]{2,30}?)\b(?:\s+and|[.,;])/));
    // A variable given a predicate: "The set A is a subset of B" -> subset.
    add(first.match(/\b(?:X|[A-Z])\s+is\s+an?\s+([a-z][a-z\- ]{2,30}?)\s+(?:of|if|when|and|for)\b/));
    // The subject of the box: "The disjunction of p and q, denoted by ..., is" -> disjunction.
    const VAR = '(?:X|[a-z])';
    add(first.match(new RegExp(`(?:^|[.:,]\\s+|X\\s+)(?:[Tt]he|An?)\\s+([A-Za-z][a-z\\- ]{2,40}?)\\s+(?:of\\s+(?:the\\s+[a-z]+\\s+)?${VAR}(?:\\s+and\\s+${VAR})?\\s*,?\\s*)?(?:denoted\\s+by\\s+X(?:\\s*\\([^)]*\\))?,?\\s*)?(?:X\\s+)?(?:is|are)\\b`)));
    if (!found.length) {
      const bold = String(body || '').match(/\*\*([^*$]{3,40})\*\*/);
      if (bold) found.push(bold[1].trim());
    }
    const seen = new Set();
    return found.filter((t) => t && t.split(/\s+/).length <= TERM_MAX_WORDS)
      .map(titleCase).filter((t) => !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  }

  /** The term a definition box defines (the first of boxTerms), or ''. */
  const boxTerm = (body) => boxTerms(body)[0] || '';

  /** The text of a box as the extraction emitted it: its lines minus the box's own label and subtitle. */
  function boxText(block, ctx) {
    const lines = (ctx.linesByBlock && ctx.linesByBlock.get(block.id)) || [];
    // The subtitle is a heading line, or a first line set wholly in bold ("**Using** $==$ **to Compare Strings**").
    const allBold = (t) => /^\*\*/.test(t.trim()) && /\*\*$/.test(t.trim()) && !/[.:]\**$/.test(t.trim());
    const isHead = (l, i) => l.kind === 'heading' || (i <= 1 && allBold(String(l.text)));
    const heads = lines.filter(isHead).map((l) => String(l.text).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim());
    // A code listing ends the sentence before it: the prose runs are kept apart, never glued across the code.
    const runs = [[]];
    lines.forEach((l, i) => {
      if (isHead(l, i)) return;
      if (l.kind === 'code') runs.push([]);
      else runs[runs.length - 1].push(String(l.text).trim());
    });
    const segments = runs.map((r) => r.join(' ').trim()).filter(Boolean);
    const subtitle = heads.find((h) => norm(h) !== norm(block.title)) || '';
    return { subtitle, text: segments.join(' '), segments };
  }

  /** The sentences of a box that state its point on their own, best first: cue words, completeness. */
  function pointSentences(segments, max) {
    const tok = dep('tokenizer', './tokenizer.js');
    const st = dep('summaryStatements', './summary-statements.js');
    const sentences = segments.flatMap((seg) => (tok ? tok.splitSentences(seg) : [seg]));
    const ok = sentences.filter((s) => { const r = st ? st.rejectReason(s) : null; return !r || r === 'length'; });
    return ok.map((s, i) => ({ s, i, v: st ? st.score(s, {}) : 0 }))
      .sort((a, b) => b.v - a.v).slice(0, max).sort((a, b) => a.i - b.i).map((x) => x.s).join(' ');
  }

  const FOLLOW_LINES = 40; // scope lines searched after a box title for its text
  const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'after', 'before', 'and', 'or', 'not', 'is', 'are', 'using', 'use', 'when', 'your', 'you']);

  /**
   * The sentences after a box's title (within FOLLOW_LINES scope lines) that share two content words with
   * the title ("A Semicolon After the if Condition" -> "There should be no semicolon after the if condition.").
   */
  function followingPoint(block, title, ctx) {
    const lines = ctx.lines || [];
    const at = lines.findIndex((l) => l && l.blockId === block.id);
    if (at < 0) return '';
    const keys = plain(title).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    if (keys.length < 2) return '';
    // Each paragraph on its own: a sentence never runs on across a code listing or a paragraph break
    const paras = new Map();
    lines.slice(at + 1, at + 1 + FOLLOW_LINES).filter((l) => l && l.kind === 'prose' && !l.blockId && l.inText !== false)
      .forEach((l) => paras.set(l.paragraph, `${paras.get(l.paragraph) || ''} ${l.text}`));
    const tok = dep('tokenizer', './tokenizer.js');
    const st = dep('summaryStatements', './summary-statements.js');
    const hit = [...paras.values()].flatMap((p) => (tok ? tok.splitSentences(p.trim()) : [p.trim()])).filter((s) => {
      const low = s.toLowerCase();
      const r = st ? st.rejectReason(s) : null;
      return keys.filter((k) => low.includes(k)).length >= 2 && (!r || r === 'length');
    });
    return hit.slice(0, PITFALL_SENTENCES).join(' ');
  }

  /** Why a box's text cannot be shown as is: notation lost (a false statement) or text damaged. */
  function flagOf(text) {
    const st = dep('summaryStatements', './summary-statements.js');
    if (!st) return '';
    if (st.mathDamage(text)) return 'symbols';
    return st.isMangled(text) ? 'text' : '';
  }

  function item(block, ctx = {}) {
    const kind = String(block.kind || '').toLowerCase();
    const cat = String(block.category || '');
    const page = block.pageNumber || block.page;
    const body = repairSwallowed(String(block.body || '').trim());
    const base = { page, blockId: block.id, terms: [] };
    if (kind === 'definition' || (!kind && /^definition/i.test(cat))) {
      const named = String(block.title || '').replace(/^Definitions?\s+(?:of\s+(?:the\s+|an?\s+)?)?/i, '').trim();
      const terms = named && !/^\d/.test(named) && !/^definition/i.test(named) ? [titleCase(named)] : boxTerms(body).slice(0, 2);
      const label = /^definition\s+\d/i.test(String(block.title || '')) ? plain(block.title) : 'Definition';
      return { ...base, category: 'Definition', label, title: terms[0] || '', body: trimBody(body), flag: flagOf(body), terms };
    }
    if (kind === 'theorem' || ((!kind || kind === 'definition') && RESULT_RE.test(cat))) {
      const label = plain(block.title) || titleCase(cat || 'Theorem');
      return { ...base, category: titleCase(cat || 'Theorem'), label, title: '', body: trimBody(body), flag: flagOf(body) };
    }
    if (kind === 'key-concept' || (!kind && /^key\s*(?:concept|point|idea)/i.test(cat))) {
      // A margin note about reading the book ("unless you read this paragraph carefully") is not a concept.
      const st = dep('summaryStatements', './summary-statements.js');
      const tok = dep('tokenizer', './tokenizer.js');
      if (st && tok && tok.splitSentences(body).some((s) => st.rejectReason(s) === 'meta')) return null;
      return body ?{ ...base, category: 'Key concept', label: 'Key concept', title: '', body: trimBody(body), flag: flagOf(body) } : null;
    }
    if (kind === 'sidebar' && PITFALL_RE.test(cat || block.title || '')) {
      const { subtitle, text, segments } = boxText(block, ctx);
      // Without its lines, the body opens with the subtitle: keep only that title, never a cut-off guess.
      const title = subtitle || (text ? '' : plain(body));
      // A box whose body the extraction did not file under it (the layout put other notes between its
      // title and its text) is completed from the prose after its title that speaks of the same thing.
      const kept = (text ? pointSentences(segments, PITFALL_SENTENCES) : '') || (title ? followingPoint(block, title, ctx) : '');
      if (!title && !kept) return null;
      return { ...base, category: 'Common error', label: plain(block.title) || 'Common error', title, body: trimBody(kept), flag: flagOf(kept) };
    }
    return null;
  }

  /** A table worth showing: its rows line up in two or more columns. */
  function table(t, ctx = {}) {
    if (!t) return null;
    const rows = (t.header ? [t.header] : []).concat(t.rows || []).filter((r) => Array.isArray(r) && r.some((c) => plain(c)));
    if (rows.length < 2) return null;
    const width = Math.max(...rows.map((r) => r.length));
    if (width < 2 || rows.filter((r) => r.length === width).length / rows.length < ALIGNED_SHARE) return null;
    const filled = rows.flat().filter((c) => plain(c)).length / (rows.length * width);
    if (filled < 0.6) return null;
    // A teaching table names its columns in a header row of words, or explains each row in a prose column.
    // Sample records (an EMPLOYEE table of names, e-mails and phone numbers) do neither and are left out.
    if (rows.flat().some((c) => /@[\w-]+\.\w|https?:\/\//.test(String(c)))) return null;
    // A cell whose notation is known to be damaged ("XY # 1", "Z + Z") would teach something false.
    const st = dep('summaryStatements', './summary-statements.js');
    if (st && rows.flat().some((c) => st.mathDamage(c) || /(?:^|[^\w'])([A-Z])\s*\+\s*\1(?![\w'])/.test(plain(c)))) return null;
    const wordy = (c) => /^[A-Za-z][A-Za-z\s()'’/-]*$/.test(plain(c));
    const headCells = rows[0].map(plain).filter(Boolean);
    // Two header cells alike ("X | X") mean a complement bar or prime was lost: the table would mislead.
    if (new Set(headCells).size < headCells.length) return null;
    const header = headCells.every(wordy);
    // Words of prose only: the symbols of a formula ("= X̄ Y ( Z + Z̄ )") are not words
    const wordsIn = (c) => (plain(c).replace(/\$[^$]*\$/g, ' ').match(/[A-Za-z]{2,}/g) || []).length;
    const proseColumn = Array.from({ length: width }, (_, k) => rows.map((r) => wordsIn(r[k])))
      .some((counts) => counts.reduce((a, b) => a + b, 0) / counts.length >= PROSE_CELL_WORDS);
    if (!header && !proseColumn) return null;
    const captions = (ctx.captionsByPage && ctx.captionsByPage.get(t.pageNumber)) || [];
    const tableCaptions = captions.filter((c) => /^table\s+[\w.-]+/i.test(plain(c)));
    return {
      title: tableCaptions.length === 1 ? plain(tableCaptions[0]) : '',
      rows: rows.slice(0, MAX_TABLE_ROWS + 1),
      more: Math.max(0, rows.length - MAX_TABLE_ROWS - 1),
      page: t.pageNumber,
    };
  }

  /** ctx for item()/table() from the scope's tagged lines. */
  function context(lines) {
    const linesByBlock = new Map();
    const captionsByPage = new Map();
    for (const l of lines || []) {
      if (!l) continue;
      if (l.blockId) {
        if (!linesByBlock.has(l.blockId)) linesByBlock.set(l.blockId, []);
        linesByBlock.get(l.blockId).push(l);
      }
      if (l.kind === 'caption') {
        if (!captionsByPage.has(l.pageNumber)) captionsByPage.set(l.pageNumber, []);
        captionsByPage.get(l.pageNumber).push(l.text);
      }
    }
    return { linesByBlock, captionsByPage, lines: lines || [] };
  }

  const api = { item, table, context, boxTerm, boxTerms, trimBody, flagOf, repairSwallowed };
  PDFStudy.bookBlocks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

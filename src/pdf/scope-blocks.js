/**
 * Scope Block Tracker for text-cleaner.js (100% offline, deterministic).
 * Owns the didactic block being read, the pending code listing and the page's tables while text-cleaner
 * walks the lines, and decides where each row goes:
 *   - every finished block -> scope.blocks (with block.kind); fact kinds also -> legacy didacticBlocks
 *   - rows of example / self-check / syntax blocks -> scope.lines only (inText false)
 *   - code rows -> one fenced block; table rows -> " | "-joined rows, one per line
 *   - margin notes -> their page's end; sentence notes -> key-concept blocks (margin-notes.js)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const need = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);

  // block.kind values whose rows stay out of scope.text: worked examples, questions to the reader, syntax diagrams
  const OUT_OF_TEXT_KINDS = new Set(['example', 'self-check', 'syntax']);
  // block.kind values that state facts; only these go to the legacy didacticBlocks list
  const FACT_KINDS = new Set(['definition', 'theorem', 'key-concept']);

  /** emitter: scope-emitter.js instance; cleanText: text-cleaner's boilerplate stripper (block bodies). */
  function createTracker(emitter, cleanText) {
    const blocks = need('didacticBlocks', './didactic-blocks.js');
    const sl = need('scopeLines', './scope-lines.js');
    const all = [];
    const facts = [];
    const tables = [];
    let active = null;
    let codeRun = [];
    let seq = 0;
    let pageNumber = null;

    /** Where a row goes: { pageNumber, kind, blockId, inText? } */
    function meta(kind) {
      const id = active ? active.id : null;
      if (active && OUT_OF_TEXT_KINDS.has(active.kind)) return { pageNumber, kind: active.kind, blockId: id, inText: false };
      return { pageNumber, kind, blockId: id };
    }

    function flushCode() {
      if (!codeRun.length) return;
      const m = meta('code');
      emitter.push(codeRun[0].line, sl.formatCodeFence(codeRun), m);
      codeRun = [];
    }

    function flushBlock() {
      const out = active ? blocks.finalize(active, cleanText) : null;
      if (out) {
        all.push(out);
        if (FACT_KINDS.has(out.kind)) facts.push(out);
      }
      if (active) emitter.breakParagraph();
      active = null;
    }

    function start(heading, line, page, proseX0, pageTitle) {
      flushCode();
      flushBlock();
      active = blocks.start(heading, line, page, proseX0, pageTitle);
      seq += 1;
      active.id = `blk-${seq}`;
      emitter.breakParagraph();
    }

    /** Emits a page table where its first row stood; its rows never reach prose. */
    function table(t, line) {
      flushCode();
      emitter.breakParagraph();
      tables.push(t);
      for (const row of t.text.split('\n')) emitter.push(line, row, { ...meta('table'), kind: active && OUT_OF_TEXT_KINDS.has(active.kind) ? active.kind : 'table' });
      emitter.breakParagraph();
    }

    function marginNotes(rows) {
      const mn = need('marginNotes', './margin-notes.js');
      if (!rows.length || !mn) return;
      flushCode();
      flushBlock();
      emitter.breakParagraph();
      for (const group of mn.groupNotes(rows)) {
        const note = mn.keyConcept(group, pageNumber, seq + 1);
        if (note) {
          seq += 1;
          all.push(note);
        }
        for (const r of group) emitter.push(r.line, r.raw, { pageNumber, kind: 'margin', blockId: note ? note.id : null });
        emitter.breakParagraph();
      }
    }

    return {
      meta,
      start,
      table,
      marginNotes,
      flushCode,
      flushBlock,
      setPage: (n) => { pageNumber = n; },
      pushCode: (row) => codeRun.push(row),
      get active() { return active; },
      result: () => ({ didacticBlocks: facts, blocks: all, tables, ids: new Set(all.map((b) => b.id)) }),
    };
  }

  PDFStudy.scopeBlocks = { createTracker, OUT_OF_TEXT_KINDS, FACT_KINDS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.scopeBlocks;
  }
})(typeof window !== 'undefined' ? window : globalThis);

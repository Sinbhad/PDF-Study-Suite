/**
 * STEM & Textbook Pre-NLP Sanitizer
 * Drops non-content pages (`page-kind.js`), publisher fluff and sidebar boxes (`scope-lines.js`), figure
 * labels (`figure-filter.js`), section-opener objective bullets and in-text exercise prompts; separates
 * end-of-section Exercise sets into `exerciseText`; preserves `$...$`/`$$...$$` TeX math, fences consecutive
 * `line.isCode` blocks with indentation, de-hyphenates prose wraps, and captures structured didactic blocks.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const need = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const getNoiseFilter = () => need('noiseFilter', '../nlp/noise-filter.js');
  const getBlocks = () => need('didacticBlocks', './didactic-blocks.js');
  const getPageKind = () => need('pageKind', './page-kind.js');
  const getLines = () => need('scopeLines', './scope-lines.js');
  const getFigures = () => need('figureFilter', './figure-filter.js');

  const getLabels = () => need('blockLabels', './block-labels.js');
  const getKinds = () => need('lineKinds', './line-kinds.js');
  const getEmitter = () => need('scopeEmitter', './scope-emitter.js');
  const getTex = () => need('mathProse', './math-prose.js');
  const getTracker = () => need('scopeBlocks', './scope-blocks.js');
  const getTables = () => need('tableGrid', './table-grid.js');

  const NOISE_LINE_RE = /^(?:Figure|Table)\s+(?:[A-Z]\.)?\d+(?:\.\d+)?\b/i;
  // line.kind values (line-kinds.js) that never enter scope.text; code is kept, as a fenced block
  const QUARANTINED_KINDS = new Set(['caption', 'folio', 'url', 'objective', 'biography']);

  function stripPublisherBoilerplate(text) {
    const nf = getNoiseFilter();
    const cleaned = nf ? nf.stripBoilerplate(text) : String(text || '');
    return cleaned
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f-�]/g, ' ')
      .replace(/([^\n ])[ \t]{2,}/g, '$1 ');
  }

  /** Most common (character-weighted) font size on a page: the body text size. */
  function bodyFontSize(page) {
    const counts = new Map();
    for (const l of page.lines || []) {
      if (!l.fontSize || l.isMargin) continue;
      const k = Math.round(l.fontSize * 2) / 2;
      counts.set(k, (counts.get(k) || 0) + (l.text || '').length);
    }
    let best = 0;
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
    return best;
  }

  function processSectionPages(pages) {
    const blocks = getBlocks();
    const pk = getPageKind();
    // Rows a cleaned page sends where: tr (scope-blocks.js) owns blocks, code fences, tables and margin notes
    const nf = getNoiseFilter();
    const sl = getLines();
    const ff = getFigures();
    const lb = getLabels();
    const lk = getKinds();
    const tg = getTables();
    const emitter = getEmitter().createEmitter();
    const tr = getTracker().createTracker(emitter, stripPublisherBoilerplate);
    const exerciseLines = [];
    let inExercises = false;
    let inOpenerObjectives = false;
    let recentProse = [];
    let box = null; // sidebar box being skipped: { top, bottom, x0 }
    const flushCode = () => tr.flushCode();
    const flushBlock = () => tr.flushBlock();
    const startBlock = (heading, line, page, pageTitle) =>
      tr.start(heading, line, page, recentProse.length ? Math.min(...recentProse) : null, pageTitle);

    const inBand = (line, h) => line.topY < h * 0.055 || line.topY > h * 0.95;
    function keepExercise(line, raw, plain, h) {
      if (inBand(line, h) || sl.isFluffLine(plain) || (nf && nf.isBoilerplate(plain))) return;
      sl.splitEnumerated(raw).forEach((part) => sl.pushProseLine(exerciseLines, part));
    }

    for (const page of pages || []) {
      if (!page || !Array.isArray(page.lines)) continue;
      // Margin notes are read after the main flow: only those printed below the exercise heading belong to it
      let exStartY = inExercises ? -Infinity : null;
      const kind = pk ? pk.classifyPage(page) : nf && nf.isBoilerplatePage(page) ? 'front' : 'content';
      const h = page.height || 792;
      box = null;
      if (kind !== 'content') {
        flushCode();
        flushBlock();
        inExercises = kind === 'exercises';
        if (inExercises) {
          const figures = ff ? ff.markFigureText(page, bodyFontSize(page), { ticksOnly: true }) : new Set(); // graph ticks
          for (const line of page.lines || []) {
            if (figures.has(line)) continue;
            const raw = sl.stripPromo(stripPublisherBoilerplate(line.formattedText || line.text));
            if (raw && !(pk && pk.isExerciseStart(raw.replace(/\*\*/g, '')))) keepExercise(line, raw, raw.replace(/\*\*/g, ''), h);
          }
        }
        continue;
      }

      const bodySize = bodyFontSize(page);
      const figureText = ff ? ff.markFigureText(page, bodySize) : new Set();
      const exerciseTicks = ff ? ff.markFigureText(page, bodySize, { ticksOnly: true }) : new Set();
      recentProse = [];
      flushCode();
      const pageNumber = page.pageNumber;
      tr.setPage(pageNumber);
      const marginRows = [];
      const labels = lb ? lb.alignMarginLabels(page.lines || []) : { byMain: new Map(), used: new Set() };
      // Book tables: rows of aligned cells on one baseline each (table-grid.js); emitted where the first row stood
      const pageTables = tg ? (tg.fromPageLines ? tg.fromPageLines(page.lines || [], pageNumber) : tg.fromSegments((page.lines || []).filter((l) => !l.isMargin && !l.isCode && (!l.kind || (l.kind === 'folio' && l.segments && l.segments.length >= 2))), pageNumber)) : [];
      const tableOf = new Map(pageTables.flatMap((t) => [...t.lines].map((l) => [l, t])));
      const emittedTables = new Set();

      const firstMain = (page.lines || []).find((l) => !l.isMargin && l.topY >= h * 0.04);
      const pageTitle = firstMain && firstMain.isBold ? (firstMain.cleanText || firstMain.text || '').trim() : '';

      for (const line of page.lines || []) {
        if (labels.used.has(line)) continue; // margin label: opens the block at its main row instead
        const table = tableOf.get(line);
        if (table) {
          if (!emittedTables.has(table) && !inExercises) tr.table(tg.publicTable(table), line);
          emittedTables.add(table);
          if (!inExercises) continue;
        }
        const unwrapped = getTex() ? getTex().unwrapProse(line.formattedText || line.text) : line.formattedText || line.text;
        const raw = sl.stripPromo(stripPublisherBoilerplate(lk ? lk.stripCredits(unwrapped) : unwrapped));
        const plain = raw.replace(/\*\*/g, '').trim();
        const hasTeX = raw.includes('$') || Boolean(line.hasMath);
        if (!plain || (plain.length < 2 && !hasTeX && !line.isCode)) continue;
        // Non-content rows tagged at extraction (line-kinds.js) are listed in scope.lines but kept out of the text
        if (QUARANTINED_KINDS.has(line.kind) && !inExercises) {
          emitter.push(line, plain, { pageNumber, kind: line.kind, blockId: null, inText: false });
          continue;
        }

        if (pk && pk.isExerciseStart(plain)) {
          flushCode();
          flushBlock();
          inExercises = true;
          inOpenerObjectives = false;
          exStartY = Number.isFinite(line.topY) ? line.topY : -Infinity;
          continue;
        }
        if (pk && pk.isSectionStart(plain, line, bodySize)) {
          inExercises = false;
          inOpenerObjectives = true;
        }
        if (inExercises && !(line.isMargin && exStartY !== null && line.topY < exStartY)) {
          if (!exerciseTicks.has(line)) keepExercise(line, raw, plain, h);
          continue;
        }

        if (inBand(line, h) || sl.isFluffLine(plain)) continue;
        if (NOISE_LINE_RE.test(plain) || (pk && pk.isExerciseInstruction(plain))) continue;

        // Sidebar boxes (technology pitfalls, explorations): skip the header and every line stacked under it
        if (sl.isBoxHeader(plain)) {
          if (!line.isMargin) flushBlock();
          box = line.isMargin || !Number.isFinite(line.topY) ? null : { top: line.topY, bottom: line.bottomY, x0: line.x0 };
          continue;
        }
        if (!line.isMargin && Number.isFinite(line.topY)) {
          const isHeading = line.isBold && bodySize && line.fontSize >= bodySize * 1.15;
          if (box && !isHeading && line.topY >= box.top - 2 && line.x0 >= box.x0 - 2 && line.topY - box.bottom <= (line.fontSize || 10)) {
            box.bottom = Math.max(box.bottom, line.bottomY);
            continue;
          }
          box = null;
        }

        // Drop 9pt GillSans-Bold learning-objective bullets at section openers
        if (inOpenerObjectives) {
          if (pk.isSectionStart(plain, line, bodySize)) {
            // keep the section heading itself, stay ready to strip objectives right under it
          } else if (pk && pk.isObjectiveLine(plain, line, bodySize)) {
            continue;
          } else {
            inOpenerObjectives = false;
          }
        } else if (pk && line.topY < h * 0.24 && pk.isObjectiveLine(plain, line, bodySize)) {
          continue;
        }

        const tocLike = !hasTeX && /(?:\d|\b[ivxlcdm]{2,})$/i.test(plain) && nf && nf.isTocLine(plain);
        if (nf && (nf.isBoilerplate(plain) || tocLike)) continue;
        if (figureText.has(line)) continue; // axis ticks, curve labels, diagram fragments

        if (line.isMargin) {
          marginRows.push({ line, raw });
          continue;
        }

        // Wrapped 2nd line of an active didactic heading (e.g. "THEOREM 5.17 ..." + "Functions")
        if (tr.active && !tr.active.bodyLines.length && blocks.extendHeading(tr.active, line, plain)) {
          emitter.push(line, raw, tr.meta('heading'));
          continue;
        }

        // Numbered label ("Definition 1" in the margin beside this row, "**EXAMPLE 3**", "Syntax 5.1", "Proof:")
        const label = labels.byMain.get(line) || (lb ? lb.matchLabelLine(line, bodySize) : null);
        if (label) {
          const headTitle = lb.headingFor(label, lb.stripLabel(raw, label));
          startBlock(headTitle.heading, line, page, pageTitle);
          const ownRow = labels.byMain.has(line) ? raw : headTitle.body;
          if (!labels.byMain.has(line)) emitter.push(line, headTitle.body ? `**${headTitle.heading.title}**` : raw, tr.meta('heading'));
          if (!ownRow) continue;
          blocks.add(tr.active, line, ownRow, ownRow.replace(/\*\*/g, ''), page);
          if (line.isCode || line.kind === 'code') tr.pushCode({ raw: ownRow, x0: line.x0, fontSize: line.fontSize, line });
          else emitter.push(line, ownRow, tr.meta('prose'));
          continue;
        }

        const heading = blocks.matchHeading(plain, line, bodySize);
        if (heading) {
          startBlock(heading, line, page, pageTitle);
          emitter.push(line, raw, tr.meta('heading'));
          continue;
        }

        if (tr.active) {
          if (blocks.ends(tr.active, line, plain, page)) flushBlock();
          else blocks.add(tr.active, line, raw, plain, page);
        }
        if (!tr.active && Number.isFinite(line.x0) && (line.wordCount || 0) >= 5 && !line.isCode) {
          recentProse = recentProse.concat(line.x0).slice(-3);
        }

        if (line.isCode || line.kind === 'code') {
          tr.pushCode({ raw, x0: line.x0, fontSize: line.fontSize, line });
          continue;
        }
        flushCode();

        // Keep small lines that state a formula; drop small-print captions, figure labels (even with a
        // barred symbol in them: "SR S̄R̄ D with 1 Control") and bare number rows
        const formula = hasTeX && /[=<>≤≥≠]|\\(?:le|ge|ne|frac|sqrt|sum|int)\b/.test(raw);
        if (!formula && bodySize && line.fontSize && line.fontSize < bodySize * 0.85) continue;
        if (!hasTeX) {
          const digitRatio = (plain.match(/[\d.+-]/g) || []).length / plain.length;
          if (digitRatio > 0.55 && plain.length < 60) continue;
        }

        const kind = getEmitter().isHeadingLine(line, plain, bodySize) ? 'heading' : 'prose';
        for (const part of sl.splitEnumerated(raw)) emitter.push(line, part, tr.meta(kind));
      }
      flushCode();
      // Margin notes stay with their page: after the page's main flow, as their own paragraphs
      tr.marginNotes(marginRows);
    }
    flushCode();
    flushBlock();

    const found = tr.result();
    const assembled = emitter.finish(stripPublisherBoilerplate, found.ids);
    return {
      text: stripPublisherBoilerplate(assembled.text),
      exerciseText: stripPublisherBoilerplate(exerciseLines.join('\n')),
      didacticBlocks: found.didacticBlocks,
      blocks: found.blocks,
      tables: found.tables,
      lines: assembled.lines,
    };
  }

  PDFStudy.textCleaner = {
    stripPublisherBoilerplate,
    processSectionPages,
    pushProseLine: (out, text) => getLines().pushProseLine(out, text),
    formatCodeFence: (run) => getLines().formatCodeFence(run),
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.textCleaner;
  }
})(typeof window !== 'undefined' ? window : globalThis);

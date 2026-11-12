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

  const NOISE_LINE_RE = /^(?:Figure|Table)\s+(?:[A-Z]\.)?\d+(?:\.\d+)?\b/i;

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
    const nf = getNoiseFilter();
    const sl = getLines();
    const ff = getFigures();
    const cleanLines = [];
    const marginLines = [];
    const exerciseLines = [];
    const didacticBlocks = [];
    let inExercises = false;
    let inOpenerObjectives = false;
    let activeBlock = null;
    let recentProse = [];
    let codeRun = [];
    let box = null; // sidebar box being skipped: { top, bottom, x0 }

    function flushCode() {
      if (!codeRun.length) return;
      cleanLines.push(sl.formatCodeFence(codeRun));
      codeRun = [];
    }

    function flushBlock() {
      const out = activeBlock ? blocks.finalize(activeBlock, stripPublisherBoilerplate) : null;
      if (out) didacticBlocks.push(out);
      activeBlock = null;
    }

    const inBand = (line, h) => line.topY < h * 0.055 || line.topY > h * 0.95;
    function keepExercise(line, raw, plain, h) {
      if (inBand(line, h) || sl.isFluffLine(plain) || (nf && nf.isBoilerplate(plain))) return;
      sl.splitEnumerated(raw).forEach((part) => exerciseLines.push(part));
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
          for (const line of page.lines || []) {
            const raw = sl.stripPromo(stripPublisherBoilerplate(line.formattedText || line.text));
            if (raw && !(pk && pk.isExerciseStart(raw.replace(/\*\*/g, '')))) keepExercise(line, raw, raw.replace(/\*\*/g, ''), h);
          }
        }
        continue;
      }

      const bodySize = bodyFontSize(page);
      const figureText = ff ? ff.markFigureText(page, bodySize) : new Set();
      recentProse = [];
      flushCode();

      const firstMain = (page.lines || []).find((l) => !l.isMargin && l.topY >= h * 0.04);
      const pageTitle = firstMain && firstMain.isBold ? (firstMain.cleanText || firstMain.text || '').trim() : '';

      for (const line of page.lines || []) {
        const raw = sl.stripPromo(stripPublisherBoilerplate(line.formattedText || line.text));
        const plain = raw.replace(/\*\*/g, '').trim();
        const hasTeX = raw.includes('$') || Boolean(line.hasMath);
        if (!plain || (plain.length < 2 && !hasTeX && !line.isCode)) continue;

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
          keepExercise(line, raw, plain, h);
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
          if (marginLines.lastPage !== page.pageNumber) marginLines.push('');
          marginLines.lastPage = page.pageNumber;
          marginLines.push(raw);
          continue;
        }

        // Wrapped 2nd line of an active didactic heading (e.g. "THEOREM 5.17 ..." + "Functions")
        if (activeBlock && !activeBlock.bodyLines.length && blocks.extendHeading(activeBlock, line, plain)) {
          cleanLines.push(raw);
          continue;
        }

        const heading = blocks.matchHeading(plain, line, bodySize);
        if (heading) {
          flushCode();
          flushBlock();
          const proseX0 = recentProse.length ? Math.min(...recentProse) : null;
          activeBlock = blocks.start(heading, line, page, proseX0, pageTitle);
          cleanLines.push(raw);
          continue;
        }

        if (activeBlock) {
          if (blocks.ends(activeBlock, line, plain, page)) flushBlock();
          else blocks.add(activeBlock, line, raw, plain, page);
        }
        if (!activeBlock && Number.isFinite(line.x0) && (line.wordCount || 0) >= 5 && !line.isCode) {
          recentProse = recentProse.concat(line.x0).slice(-3);
        }

        if (line.isCode) {
          codeRun.push({ raw, x0: line.x0, fontSize: line.fontSize });
          continue;
        }
        flushCode();

        // Keep lines containing `$` (TeX math); drop small-print captions and bare number rows
        if (!hasTeX && bodySize && line.fontSize && line.fontSize < bodySize * 0.85) continue;
        if (!hasTeX) {
          const digitRatio = (plain.match(/[\d.+-]/g) || []).length / plain.length;
          if (digitRatio > 0.55 && plain.length < 60) continue;
        }

        for (const part of sl.splitEnumerated(raw)) sl.pushProseLine(cleanLines, part);
      }
      flushCode();
    }
    flushCode();
    flushBlock();

    return {
      text: stripPublisherBoilerplate(cleanLines.concat(marginLines).join('\n')),
      exerciseText: stripPublisherBoilerplate(exerciseLines.join('\n')),
      didacticBlocks,
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

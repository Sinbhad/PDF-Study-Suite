/**
 * Slide Build / Reveal Collapser + per-slide semantics for slide-extractor.js (offline, deterministic).
 * - collapses progressive-reveal sequences (frame N+1 = frame N plus new text) into ONE slide with
 *   `pages[]`, and captures `qa { question, answer }` when the revealed text answers a "...?" prompt
 * - keeps the legacy near-duplicate merge for animation / trace frames
 * - tags `kind` ('title' | 'section' | 'content' | 'question' | 'table') and extracts `definitions[]`
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const TRACE_TITLE_RE = /\b(?:trace|walkthrough|animation|step[\s-]*by[\s-]*step|simulation)\b/i;
  const DEF_PREFIX_RE = /^(?:\*\*)?\s*(?:Def(?:inition)?\.?)\s*(?:\*\*)?\s*[:.—-]\s*/i;
  const DEF_VERB_RE = /\b(?:is|are)\s+(?:defined\s+as|called|said\s+to\s+be|known\s+as|an?|the)\b|\bmeans\b|\brefers\s+to\b|\bdenotes\b/i;
  const CALLED_RE = /\b(?:is|are)\s+(?:called|said\s+to\s+be|known\s+as)\s+(?:an?\s+|the\s+)?([^.,;:]+?)(?=\s+(?:if|when|whenever|of|and|for|with|provided)\b|[.,;:]|$)/i;
  const NOUN_IS_RE = /\b(?:An?|The)\s+((?:[\w-]+\s+){0,3}?[\w-]+?)\s+(?:(?:on|of|from|to|in)\s+[^.]{1,40}?\s+)?is\s+(?:an?|the|defined)\b/;
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  /** Word-set Jaccard + prefix overlap for step-by-step trace / animation frames with the same title. */
  function areNearDuplicateSlides(a, b) {
    if (!a || !b) return false;
    const ta = a.title.toLowerCase().trim();
    const tb = b.title.toLowerCase().trim();
    if (!ta || ta !== tb) return false;
    if (TRACE_TITLE_RE.test(ta)) return true;
    const wordsOf = (s) => new Set(s.bullets.join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !/^\d+$/.test(w)));
    const wa = wordsOf(a);
    const wb = wordsOf(b);
    if (wa.size === 0 && wb.size === 0) return true;
    let shared = 0;
    for (const w of wa) if (wb.has(w)) shared++;
    const minSz = Math.max(1, Math.min(wa.size, wb.size));
    const maxSz = Math.max(1, Math.max(wa.size, wb.size));
    return shared / maxSz >= 0.72 || (wa.size >= 4 && shared / minSz >= 0.88 && a.bullets[0] === b.bullets[0]);
  }

  /** b = a + extra text (title suffix and/or new bullets)? -> { titleExtra, extra[] } (both empty = exact duplicate). */
  function revealDelta(a, b) {
    const ta = norm(a.title);
    const tb = norm(b.title);
    if (!ta || !(tb === ta || tb.startsWith(`${ta} `))) return null;
    const pool = b.bullets.slice();
    for (const bullet of a.bullets) {
      const at = pool.indexOf(bullet);
      if (at < 0) return null;
      pool.splice(at, 1);
    }
    if (JSON.stringify((a.table || {}).rows || null) !== JSON.stringify((b.table || {}).rows || null)) return null;
    return { titleExtra: tb.slice(ta.length).trim(), extra: pool };
  }

  function findPrompt(frame, delta) {
    const title = norm(frame.title);
    if (delta.titleExtra && /\?$/.test(title)) return title;
    const lastBullet = frame.bullets[frame.bullets.length - 1];
    if (lastBullet && /\?$/.test(lastBullet.trim())) return lastBullet.trim();
    return /\?$/.test(title) ? title : '';
  }

  function mergeNearDuplicate(prev, slide) {
    const mergedBullets = [...prev.bullets];
    const mergedNested = [...prev.nestedBullets];
    slide.nestedBullets.forEach((nb) => {
      if (nb.text && !mergedBullets.includes(nb.text)) {
        mergedBullets.push(nb.text);
        mergedNested.push(nb);
      }
    });
    // Pure trace frames (`temp = 15` -> `temp = 55`): keep the final frame's snapshot
    if (TRACE_TITLE_RE.test(prev.title) && slide.bullets.length >= prev.bullets.length - 1) {
      prev.bullets = slide.bullets.slice();
      prev.nestedBullets = slide.nestedBullets.slice();
    } else {
      prev.bullets = mergedBullets;
      prev.nestedBullets = mergedNested;
    }
  }

  function collapse(rawSlides) {
    const out = [];
    let lastFrame = null;
    for (const slide of rawSlides || []) {
      const prev = out[out.length - 1];
      const delta = prev && lastFrame ? revealDelta(lastFrame, slide) : null;
      const isDup = delta && !delta.titleExtra && !delta.extra.length;
      if (delta && !isDup) {
        const answer = [delta.titleExtra, ...delta.extra].filter(Boolean).join('\n');
        const question = prev.qa ? '' : findPrompt(lastFrame, delta);
        if (prev.qa) prev.qa.answer = `${prev.qa.answer}\n${answer}`;
        else if (question) prev.qa = { question, answer };
        else {
          prev.title = slide.title;
          prev.formattedTitle = slide.formattedTitle;
          prev.bullets = slide.bullets.slice();
          prev.nestedBullets = slide.nestedBullets.slice();
        }
      } else if (!delta) {
        if (!prev || prev.qa || !areNearDuplicateSlides(prev, slide)) {
          out.push({ ...slide, pages: [slide.slideNumber] });
          lastFrame = slide;
          continue;
        }
        mergeNearDuplicate(prev, slide);
      }
      prev.pages.push(slide.slideNumber);
      prev.endSlideNumber = slide.slideNumber;
      prev.rawText = [prev.title, ...prev.bullets].join('. ');
      lastFrame = slide;
    }
    return out;
  }

  const cleanTerm = (t) => norm(String(t || '').replace(/\*\*|\$/g, '')).replace(/^[\s"“'(]+|[\s"”').,;:]+$/g, '');

  /** "Def: ..." lines and lines with an emphasised term + defining verb -> [{ term, definition }]. */
  function extractDefinitions(nestedBullets) {
    const defs = [];
    for (const b of nestedBullets || []) {
      const fmt = String(b.formattedText || b.text || '');
      const text = norm(b.text);
      const hasPrefix = DEF_PREFIX_RE.test(text);
      const body = fmt.replace(DEF_PREFIX_RE, '');
      const wholeBold = /^\*\*[^*]+\*\*$/.test(body.trim());
      const bold = wholeBold ? [] : [...body.matchAll(/\*\*([^*]{2,60})\*\*/g)].map((m) => cleanTerm(m[1])).filter((t) => /[A-Za-z]{2}/.test(t));
      if (!hasPrefix && !(bold.length && DEF_VERB_RE.test(text))) continue;
      const definition = norm(text.replace(DEF_PREFIX_RE, ''));
      const called = definition.match(CALLED_RE);
      const noun = definition.match(NOUN_IS_RE);
      const first = called && noun ? (noun.index < called.index ? noun : called) : called || noun; // earliest defined phrase wins
      const term = bold[0] || cleanTerm(first ? first[1] : '');
      if (definition.length >= 12 && term && term.length <= 60) defs.push({ term, definition });
    }
    return defs;
  }

  function classifyKind(slide, index) {
    if (slide.qa) return 'question';
    if (slide.table) return 'table';
    const bullets = slide.bullets || [];
    const thin = bullets.length <= 2 && bullets.every((b) => b.split(/\s+/).length <= 8 && !/[.?!=]/.test(b));
    if (index === 0 && thin) return 'title';
    return bullets.length === 0 ? 'section' : 'content';
  }

  /** Adds kind / pages / definitions to every collapsed slide (never throws on odd input). */
  function annotate(slides) {
    slides.forEach((s, i) => {
      s.pages = s.pages || [s.slideNumber];
      s.definitions = extractDefinitions(s.nestedBullets);
      s.kind = classifyKind(s, i);
    });
    return slides;
  }

  PDFStudy.slideReveal = { collapse, annotate, revealDelta, extractDefinitions, classifyKind, areNearDuplicateSlides };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.slideReveal;
  }
})(typeof window !== 'undefined' ? window : globalThis);

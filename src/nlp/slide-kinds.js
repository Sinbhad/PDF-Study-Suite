/**
 * Slide Kinds: which slides of a deck are study content (content-filter.js re-exports this API).
 *   slideKind(slide, ctx)    'title' | 'objectives' | 'case' | 'contact' | 'references' | 'aside' | 'question' | 'content'
 *                            ('aside': the slide itself, or a note written on it, says it is not to be learned:
 *                            "Do not memorize", "not on the exam", "for your interest only")
 *   slideKinds(slides)       the same for a whole deck: a case runs on over the slides that keep its title
 *   slideLineFilter(slide)   predicate over a slide's line texts: no links, captions, remarks, annotations, and on a
 *                            case slide no patient details
 *   deckStamps(slides)       short lines repeated across the deck (a logo text, a running note)
 * A case is recognised from its signals, not one deck's wording: a signalment (age + sex or name), a history
 * line, an owner's report, past-tense findings about a group of patients ("All had small kidneys"), a work-up
 * heading ("Differential diagnosis", "Tests to run"), a question put to the student, a
 * demonstrative patient ("This bovine is ..."), or a "Case 3" title. ctx: { index, hasQa, inCase }.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const lines = () => dep('contentFilter', './content-filter.js');

  const SLIDE_KINDS = new Set(['title', 'objectives', 'case', 'contact', 'references', 'aside', 'question', 'content']);
  // The lecturer marks a slide as background: nothing on it is to be learned for the exam.
  const NOT_EXAMINED_RE =
    /\b(?:do\s*n[o']?t|no\s+need\s+to|you\s+(?:do\s+not|don'?t)\s+(?:need|have)\s+to)\s+(?:need\s+to\s+)?(?:memori[sz]e|learn|know)\b|\bnot\s+(?:on|in)\s+(?:the\s+)?(?:exam|test|quiz)\b|\b(?:will\s+)?not\s+be\s+(?:examined|tested|on\s+the\s+exam)\b|\bfor\s+(?:your\s+)?(?:interest|information|reference)\s+only\b/i;
  const OBJECTIVES_TITLE_RE =
    /\b(?:learning\s+(?:objectives?|outcomes?|targets?|goals?)|objectives?|intended\s+outcomes|by\s+the\s+end\s+of\s+(?:this|today))\b/i;
  const REFERENCES_TITLE_RE =
    /^(?:references?|bibliography|works\s+cited|citations?|sources|further\s+reading|suggested\s+reading|literature(?:\s+cited)?|resources|image\s+credits)\b/i;
  const CLOSING_TITLE_RE = /^(?:thank\s+you|thanks|questions\s*\??|any\s+questions|the\s+end|contact(?:\s+information)?)\b/i;
  const CREDENTIAL_RE =
    /\b(?:DVM|VMD|PhD|Ph\.D\.|MD|MSc?|MPH|MBA|BVSc|BVMS|MRCVS|DACV\w*|ACV\w+|Dipl\.?|DABVP|RN|PharmD|Prof\.|Dr\.)(?=[\s,.)]|$)/;
  const CASE_TITLE_RE = /^case\b|\bcase\s+(?:\d+|study|report|presentation|example|scenario|history)\b|\bsignalment\b|\bclinical\s+case\b/i;
  // Work-up headings of a case: what was found, what to consider, what to run. A heading stands alone or ends
  // in a colon ("History and Clinical Findings:"); "History of upper respiratory infections" is a fact line.
  const CASE_LABEL_RE =
    /^(?:history|histories|presenting\s+complaint|chief\s+complaint|signalment|physical\s+exam(?:ination)?|clinical\s+findings|differential\s+diagnos[ie]s|differentials|samples\s+to\s+collect|(?:additional\s+)?tests\s+to\s+run|diagnostic\s+(?:plan|work-?up)|treatment\s+plan|outcome|follow[-\s]?up)(?:\s+and\s+[a-z\s]+)?\s*(?::|$)/i;
  // "How would you treat this?": the slide asks the student to act on the patient shown.
  const ASKS_STUDENT_RE = /\b(?:how|what)\s+would\s+you\b|\bwhat\s+is\s+your\b|\byour\s+(?:next\s+step|plan|diagnosis|differentials?)\b/i;
  // What the owner saw is a report about one patient, a signal of its own beside the history line.
  const OWNER_REPORT_RE = /\b(?:owners?|clients?)\s+(?:reports?|reported|noticed|notices|states?|stated|says|said|describes?|described|observed)\b/i;
  // Findings told in the past tense about a group of patients ("All had small kidneys", "Two of them died"):
  // a case series. A rate in the present tense ("25% have ...") is epidemiology and does not match.
  const COHORT_RE =
    /^(?:all|both|none|most|several|two|three|four|five|six)\s+(?:of\s+(?:them|the\s+[a-z]+)\s+)?(?:had|were|was|showed|developed|presented|died|recovered|tested)\b/i;
  const MIN_CASE_SIGNALS = 2;
  const DATED_EVENT_RE = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)?(?:19|20)\d\d\s*[:–—-]\s+\S/i;
  const MIN_DATED_EVENTS = 2;
  const MAX_TITLE_SLIDE_BULLETS = 6;
  // Line kinds that are never study material on a slide, whatever the slide is about.
  const DROPPED_SLIDE_LINE_KINDS = new Set(['url', 'caption', 'citation', 'quip', 'annotation', 'folio', 'code', 'biography']);
  // A short line repeated on this many slides is a stamp (a logo text, a running note), not a point of any one.
  const STAMP_MIN_SLIDES = 3;
  const STAMP_MAX_WORDS = 3;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const words = (s) => plain(s).split(/\s+/).filter(Boolean);
  const textOf = (line) => (line && typeof line === 'object' ? line.text : line);

  function slideLines(slide) {
    if (Array.isArray(slide.nestedBullets) && slide.nestedBullets.length) return slide.nestedBullets.map((b) => b && b.text).filter(Boolean);
    return (slide.bullets || []).map(textOf).filter(Boolean);
  }

  /**
   * Distinct kinds of case signal: signalment, history, an owner's report, a finding told about a group of
   * patients, a work-up heading, a question to the student. Two
   * kinds make a case; one kind repeated ("25% have a history of transport", "12% have a history of ...") is
   * epidemiology. A case title ("Case 3", a signalment) or a demonstrative patient is a case on its own.
   */
  function caseSignals(title, list) {
    const f = lines();
    if (CASE_TITLE_RE.test(title) || f.isSignalment(title)) return MIN_CASE_SIGNALS;
    const kinds = new Set();
    // "December 2015: outbreak in show dogs ...", "April 2016: cluster of cases ...": a dated timeline of one outbreak.
    if (list.filter((l) => DATED_EVENT_RE.test(plain(l))).length >= MIN_DATED_EVENTS) return MIN_CASE_SIGNALS;
    for (const l of list) {
      const t = plain(l);
      if (f.THIS_PATIENT_RE.test(t)) return MIN_CASE_SIGNALS;
      if (f.isSignalment(t)) kinds.add('signalment');
      if (OWNER_REPORT_RE.test(t)) kinds.add('owner');
      else if (f.HISTORY_RE.test(t)) kinds.add('history');
      if (COHORT_RE.test(t)) kinds.add('cohort');
      if (CASE_LABEL_RE.test(t)) kinds.add('work-up');
      if (ASKS_STUDENT_RE.test(t)) kinds.add('asks');
    }
    return kinds.size;
  }

  function slideKind(slide, ctx = {}) {
    if (!slide) return 'content';
    if (SLIDE_KINDS.has(slide.contentKind)) return slide.contentKind;
    const f = lines();
    const title = plain(slide.title);
    const list = slideLines(slide).map(plain);
    const opening = [title, list[0] || ''];
    if (opening.some((t) => OBJECTIVES_TITLE_RE.test(t))) return ctx.hasQa ? 'question' : 'objectives';
    if (REFERENCES_TITLE_RE.test(title)) return 'references';
    if (list.length >= 2 && list.filter((l) => f.isCitation(l) || f.isLink(l)).length / list.length >= 0.6) return 'references';
    // Closing slides and course logistics ("Lab requirements", "Kahoot question") carry nothing to study.
    if (CLOSING_TITLE_RE.test(title) || f.META_RE.test(title)) return 'contact';
    const notes = (slide.annotations || []).map((a) => plain(textOf(a)));
    if ([title, ...list, ...notes].some((t) => NOT_EXAMINED_RE.test(t))) return 'aside';
    const personal = [title, ...list].some((l) => CREDENTIAL_RE.test(l) || /@[\w-]+\./.test(l));
    if (personal && list.length <= MAX_TITLE_SLIDE_BULLETS) return ctx.index === 0 ? 'title' : 'contact';
    if (ctx.inCase || caseSignals(title, list) >= MIN_CASE_SIGNALS) return 'case';
    if (slide.kind === 'title') return 'title';
    if (ctx.hasQa || slide.kind === 'question' || /\?\s*$/.test(title)) return 'question';
    return 'content';
  }

  const titleKey = (t) => plain(t).toLowerCase().replace(/\(cont(?:'d|inued)?\.?\)|[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 3).join(' ');

  /** Kinds for a whole deck; a slide that keeps a case slide's title (its first three words) continues the case. */
  function slideKinds(slides, opts = {}) {
    let caseKey = '';
    return (slides || []).map((slide, index) => {
      const key = titleKey(slide && slide.title);
      const hasQa = opts.hasQa ? Boolean(opts.hasQa(slide, index)) : false;
      const kind = slideKind(slide, { index, hasQa, inCase: Boolean(caseKey) && key === caseKey });
      caseKey = kind === 'case' ? key : slide && slide.kind === 'section' ? '' : caseKey;
      return kind;
    });
  }

  /**
   * Predicate over a slide's line texts. Tags are read off nestedBullets by (cleaned) text, so plain `bullets`
   * strings are judged with them too. `clean` is the caller's text normaliser; ctx: { slideKind, stamps }.
   */
  function slideLineFilter(slide, ctx = {}, clean = plain) {
    const tags = new Map();
    for (const b of (slide && slide.nestedBullets) || []) {
      if (b && (b.isAnnotation || b.kind) && !tags.has(clean(b.text))) tags.set(clean(b.text), b);
    }
    return (text) => {
      if (ctx.stamps && ctx.stamps.has(text)) return false;
      const kind = lines().lineKind(tags.get(text) || text, ctx);
      if (DROPPED_SLIDE_LINE_KINDS.has(kind)) return false;
      return !(ctx.slideKind === 'case' && kind === 'signalment');
    };
  }

  /**
   * Short lines that recur across the deck's slides (pass the result to slideLineFilter as ctx.stamps).
   * A recurring heading ("Absorption", "Treatment") is structure, not a stamp: a line that names an aspect
   * or is a heading most of the times it appears is kept.
   */
  function deckStamps(slides, clean = plain) {
    const count = new Map();
    const heads = new Map();
    const aspect = dep('slideSubjects', './slide-subjects.js').ASPECT_RE;
    for (const slide of slides || []) {
      const nodes = (slide && slide.nestedBullets) || [];
      nodes.forEach((b, i) => {
        if (b && nodes[i + 1] && nodes[i + 1].level > b.level) heads.set(clean(b.text), (heads.get(clean(b.text)) || 0) + 1);
      });
      const seen = new Set(slideLines(slide || {}).map(clean).filter((t) => t && words(t).length <= STAMP_MAX_WORDS));
      seen.forEach((t) => count.set(t, (count.get(t) || 0) + 1));
    }
    const stamp = ([t, n]) => n >= STAMP_MIN_SLIDES && (heads.get(t) || 0) * 2 < n && !aspect.test(t.replace(/:$/, ''));
    return new Set([...count].filter(stamp).map(([t]) => t));
  }

  /**
   * What an emphatic lead-in line says the lines after it are ("KNOW TOXIC DOSES!" over "Goats: 4-5 mg/kg"):
   * the lead-in itself is a remark and is dropped, but the lines it introduces are toxic doses, not doses.
   * -> Map(cleaned line text -> qualifier), for the lines at the lead-in's level up to a line higher in the
   * outline or the next lead-in.
   */
  function lineQualifiers(slide, clean = plain) {
    const out = new Map();
    const nodes = ((slide && slide.nestedBullets) || []).filter((b) => b && b.text);
    nodes.forEach((node, i) => {
      const m = plain(node.text).match(LEAD_IN_RE);
      if (!m) return;
      const qualifier = m[1].toLowerCase().replace(/[!.:]+$/, '').trim();
      if (!qualifier || words(qualifier).length > 4) return;
      for (let k = i + 1; k < nodes.length && (nodes[k].level || 0) >= (node.level || 0); k++) {
        if (LEAD_IN_RE.test(plain(nodes[k].text))) break;
        if ((nodes[k].level || 0) === (node.level || 0)) out.set(clean(nodes[k].text), qualifier);
      }
    });
    return out;
  }
  // "KNOW TOXIC DOSES!", "Remember the doses:", "Learn these side effects!"
  const LEAD_IN_RE = /^(?:know|remember|learn|note|memori[sz]e)\s+(?:the\s+|these\s+|your\s+|all\s+)?([A-Za-z][A-Za-z -]{2,40}?)\s*[!:]+\s*$/i;

  /**
   * Lines that mark the fact a lecture wants known, read before the remark filter drops their wording:
   *   "The correct answer on the NAVLE is penicillin (...)"  -> { aspect: 'answer the exam expects', value }
   *   "Drug of choice: ...", "X is the treatment of choice"  -> { aspect: 'drug of choice', value }
   *   "Gram (-), motile", "Are gram-positive"                  -> { aspect: 'Gram stain', value: the line }
   * -> [{ aspect, value }] for one raw slide.
   */
  function keyLines(slide, clean = plain) {
    const out = [];
    for (const raw of slideLines(slide || {})) {
      const t = clean(raw);
      const exam = t.match(EXAM_ANSWER_RE);
      const choiceAfter = t.match(CHOICE_AFTER_RE);
      const choiceBefore = t.match(CHOICE_BEFORE_RE);
      if (exam) out.push({ aspect: 'answer the exam expects', value: exam[1].replace(/[.!]+$/, '') });
      else if (choiceAfter) out.push({ aspect: `${choiceAfter[1].toLowerCase()} of choice`, value: choiceAfter[2].replace(/[.!]+$/, '') });
      else if (choiceBefore) out.push({ aspect: `${choiceBefore[2].toLowerCase()} of choice`, value: choiceBefore[1] });
      else if (GRAM_RE.test(t) && words(t).length <= 6) out.push({ aspect: 'Gram stain', value: t.replace(/^are\s+/i, '').replace(/[.!]+$/, '') });
    }
    return out;
  }
  const EXAM_ANSWER_RE = /^(?:the\s+)?(?:correct|right|expected|best)\s+answer\s+(?:on|for|in)\s+(?:the\s+|your\s+)?(?:[A-Z]{3,}|boards?|exam|test)\s+is\s+(.{3,80})$/i;
  const CHOICE_AFTER_RE = /^(drug|treatment|antibiotic|antimicrobial|test|therapy)\s+of\s+choice\s*(?::|-|–|=|\bis\b)\s*(.{3,80})$/i;
  const CHOICE_BEFORE_RE = /^([A-Z][\w\s()/-]{2,50}?)\s+is\s+the\s+(drug|treatment|antibiotic|antimicrobial|test|therapy)\s+of\s+choice\b/i;
  const GRAM_RE = /^(?:are\s+)?gram[\s-]*(?:\(\s*[-+]\s*\)|positive|negative|variable)/i;

  const api = { slideKind, slideKinds, slideLineFilter, deckStamps, lineQualifiers, keyLines, SLIDE_KINDS, NOT_EXAMINED_RE };
  PDFStudy.slideKinds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

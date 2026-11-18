/**
 * Deck Facts: the lecture points of a slide deck as quiz facts about a real subject.
 * A point is a self-contained sentence bullet on a content slide. Its subject is the slide's title when
 * that title names something specific ("Clorsulon"), else the nearest specific title before it: a slide
 * titled "Pharmacokinetics" right after "Benzimidazoles" is about benzimidazoles. A stage of a course
 * ("Complications", "Prognosis") is not carried from a list of alternatives or from an item an earlier slide
 * listed (slide-subjects.js carriesCourse). A point whose subject cannot be found that way is not a fact:
 * "which topic was this line under" is not a question.
 *
 * Refused: slides the content gate calls non-content (title, objectives, case, contact, references),
 * example slides, lines that are filler or recognised pen annotations, generic sub-headings, lines
 * that a flashcard of the same slide already carries, and lines nested under a label or short heading
 * that names something else ("Bastard strangles: ..." > "Treatment with prolonged antibiotics").
 *
 *   fromSlides(slides, ctx)   -> facts (quiz-facts.js shape, kind 'point')
 *   subjectIndex(slides, ctx) -> [{ slide, subject, topic }] each content slide with the subject it is about;
 *                                topic: for a procedure or a list of options met in a lecture's course, the
 *                                subject whose story it is part of (its lines are true of that topic too)
 *   ctx: { repeated (quizSubjects.repeatedHeadings), cardLines (Set of normalised card backs) }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const content = () => dep('quizContent', './quiz-content.js');
  const model = () => dep('slideModel', './slide-model.js');
  const slideSubjects = () => dep('slideSubjects', './slide-subjects.js');

  const MIN_POINT_WORDS = 4;
  const MAX_POINT_WORDS = 30;
  const MIN_POINT_CHARS = 25;
  const MIN_PROSE_RATIO = 0.6;
  const MAX_SUBJECT_WORDS = 7;
  const FIRST_PERSON_RE = /\b(?:i|i['’](?:ve|m|d|ll)|we|we['’](?:ve|re|ll)|our|us|you|your|you['’](?:re|ll|ve))\b/i;
  const POINT_LABEL_RE = /^[A-Z0-9][^:]{0,40}:\s/;
  const CONTINUED_RE = /\s*[-–(]?\s*\(?\bcont(?:inued|'d|\.)?\)?\s*$/i;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  function isPoint(bullet) {
    const b = String(bullet || '').trim();
    const words = b.split(/\s+/);
    if (words.length < MIN_POINT_WORDS || words.length > MAX_POINT_WORDS || b.length < MIN_POINT_CHARS) return false;
    if (!/^[A-Z][a-z]/.test(b) || POINT_LABEL_RE.test(b) || FIRST_PERSON_RE.test(b)) return false;
    if (/^Def(?:inition)?\b/i.test(b) || /!{2,}|\.{3,}|…/.test(b)) return false;
    return model().proseRatio(b) >= MIN_PROSE_RATIO && qf().isStandalone(b);
  }

  /** The slide's own subject, or null when its title is generic, administrative or a question. */
  function ownSubject(slide, ctx) {
    const raw = String(slide.title || '').replace(CONTINUED_RE, '');
    if (model().isQuestionText(slide.title) || content().ADMIN_TITLE_RE.test(subjects().tidySubject(raw))) return null;
    const title = subjects().specificOf(raw, ctx);
    return title && qf().isNameable(title, MAX_SUBJECT_WORDS) ? title : null;
  }

  function subjectIndex(slides, ctx = {}) {
    const out = [];
    const ss = slideSubjects();
    let current = null; // the last specific subject, carried over generic slides that follow it
    let currentCarriesCourse = false;
    let topic = null; // the last subject a course may be about: a procedure or an option is part of its story
    const listed = new Set(); // items printed as list lines on the course slides so far
    for (const slide of model().normalize(slides).slides) {
      const own = ownSubject(slide, ctx);
      const generic = !own && subjects().isGenericHeading(slide.title, ctx);
      if (own) {
        current = own;
        currentCarriesCourse = ss.carriesCourse(own, listed);
        if (currentCarriesCourse) topic = own;
      } else if (!generic) {
        current = null; // an admin, question or unnameable slide breaks the chain
        // The topic only widens what counts as said about it (fewer wrong options): a garbled title does not end it.
        if (slide.kind !== 'content') topic = null;
      }
      if (ss.isCourseTitle(slide.title)) for (const b of slide.bullets || []) listed.add(ss.itemKey(b));
      if (slide.kind !== 'content' || slide.isExample || !content().slideIsContent(slide)) continue;
      // "Complications" after "Pleural drainage" is about the disease the lecture is on, not the procedure.
      const inherits = generic && current && (currentCarriesCourse || !ss.isCourseTitle(slide.title));
      if (own || inherits) out.push({ slide, subject: own || current, topic: currentCarriesCourse ? null : topic });
    }
    return out;
  }

  /** The raw bullets of a slide with their extraction details, matched by text, for the ink check. */
  function rawBullet(rawSlides, slide, text) {
    const raw = (rawSlides || []).find((s) => s && s.slideNumber === slide.slideNumber);
    const bullet = raw && (raw.nestedBullets || []).find((b) => norm(b.text) === norm(text));
    return bullet ? { raw, bullet } : null;
  }

  const MAX_HEAD_LINE_WORDS = 6;

  /**
   * The line a nested bullet hangs under names something other than the slide's subject: a label ("Bastard
   * strangles: any lymph nodes ...") or a short heading line ("Inverted L", "Toxic dose"). The bullet is then
   * about that thing, and stated of the slide's subject it would be wrong or lose its qualifier.
   */
  function underOtherHead(found, subject, ctx) {
    const list = found.raw.nestedBullets || [];
    const at = list.indexOf(found.bullet);
    const level = found.bullet.level || 0;
    let parent = null;
    for (let k = at - 1; k >= 0 && !parent; k--) if ((list[k].level || 0) < level) parent = list[k];
    if (!parent) return false;
    const text = String(parent.text || '').trim();
    const label = (text.match(/^([^:]{2,40}):\s/) || [])[1];
    // A parent without a verb names things ("Klebsiella spp.", a run of organism names); a sentence does not.
    const names = !/[.!?]$/.test(text.replace(/\b(?:spp|sp|ssp)\.$/, 'spp')) && !/\s(?:is|are|was|were|has|have|can|will|may|cause[sd]?|result[sd]?)\s/i.test(` ${text} `);
    const head = label || (names ? text.split(/\s+/).slice(0, MAX_HEAD_LINE_WORDS).join(' ') : '');
    if (!head || subjects().isGenericHeading(head, ctx)) return false;
    return subjects().subjectKey(head) !== subjects().subjectKey(subject);
  }

  function fromSlides(slides, ctx = {}) {
    const out = [];
    const cardLines = ctx.cardLines || new Set();
    for (const { slide, subject } of subjectIndex(slides, ctx)) {
      const defined = new Set(slide.definitions.map((d) => d.statement));
      slide.bullets.forEach((bullet, i) => {
        if (defined.has(bullet) || cardLines.has(norm(bullet)) || !isPoint(bullet) || !qf().isPointStatement(bullet)) return;
        if (!content().lineIsContent(bullet, { slide })) return;
        const found = rawBullet(slides, slide, bullet);
        if (found && content().isInkLine(found.bullet, found.raw)) return;
        if (found && underOtherHead(found, subject, ctx)) return;
        const fact = qf().makeFact(subject, bullet, {
          kind: 'point', category: 'Lecture Point', context: `Slide ${slide.slideNumber}: ${slide.title}`,
          page: slide.slideNumber, order: (slide.slideNumber || 0) * 1000 + i, source: bullet,
        });
        if (fact && !fact.selfNaming) out.push(fact);
      });
    }
    return out.map((f, i) => ({ id: `point-${i}`, ...f }));
  }

  const api = { fromSlides, subjectIndex, isPoint };
  PDFStudy.deckFacts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

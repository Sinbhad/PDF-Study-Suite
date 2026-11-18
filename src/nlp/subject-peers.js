/**
 * Subject Peers: which subjects of a scope are real entities of the same kind, so that a statement about one may
 * be set under the other as a False, or offered as a wrong option about it. Two slide titles are not alternatives
 * because they share a deck: "Biosecurity" and "Pneumonia", or a claw bandage and an eyelid block, only test
 * which slide a line sits on.
 *
 * Evidence comes from the scope's own structure, never from a list of names:
 *   aspects    the organising headings a subject's material sits under ("Treatment of strangles", a slide titled
 *              "Pathogenesis" after the strangles slide, a card "Praziquantel — Adverse effects", an aspect line
 *              on its slide). A subject the lecture tells in two or more aspects is an entity it describes
 *              (a drug, a disease); a management topic or a procedure slide has none.
 *   co-listing one line or sentence that names both subjects ("praziquantel and epsiprantel ...") sets them side
 *              by side as things of one kind; so do names on one head word ("Leptospira spp" / "Borrelia spp").
 *   groups     a deck that files its entities under category slides ("Viral infections", "Traumatic lesions")
 *              keeps each entity with the others of its category.
 * Peers: two subjects named in one line, or, within one group, two entities or two names on one head word.
 * A fact's own aspect matters too: a line from "Prevention of strangles" is only a fair False about another
 * subject whose prevention the scope also teaches; otherwise the student can only reject it by its slide.
 *
 *   index({ facts, subjectSlides, lines }) -> {
 *     isEntity(key), peers(keyA, keyB), aspectsOf(fact), fitsAspect(key, fact), aspectPhrase(fact) }
 *   facts carry their merged subjectKey; subjectSlides as deckFacts.subjectIndex gives them (keyed by `key`).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');

  const MIN_ENTITY_ASPECTS = 2;
  const MIN_ENTITY_SLIDES = 2;
  const PLURAL_RE = /^[a-z][a-z-]*[^siu]s$/; // "infections", "lesions"; not "disease", "virus", "analysis"
  const ASPECT_PREFIX = 7; // "diagnosis" and "diagnostic" are one aspect
  const MAX_ASPECT_LINE_WORDS = 3;
  const MIN_NAME_CHARS = 4;
  const GENERIC_OF_RE = /^(.+?)\s+(?:of|in|for)\s+(?:the\s+)?(.+)$/i;

  const aspectKeys = (text) => subjects().aspectWords(text).map((w) => w.slice(0, ASPECT_PREFIX));
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** "Slide 12: Prevention" -> "Prevention"; a card's front from its source "front: back". */
  const titleOf = (fact) => String(fact.context || '').replace(/^Slide\s+\d+:\s*/, '');
  const frontOf = (fact) => (fact.sourceKind && fact.source ? String(fact.source).split(/:\s/)[0] : '');

  /**
   * The heading part of a title that names an aspect: "Treatment of strangles" -> "Treatment", "Prevention" -> itself,
   * "Leptospira spp. Transmission" -> "Transmission".
   */
  function headingOf(title) {
    const t = subjects().tidySubject(String(title || '').split(/:\s/)[0]);
    if (!t) return '';
    if (subjects().isGenericHeading(t)) return t;
    const of = t.match(GENERIC_OF_RE);
    if (of && subjects().isGenericHeading(of[1])) return of[1];
    const words = t.split(/\s+/);
    let k = words.length;
    while (k > 1 && subjects().aspectWords(words[k - 1]).length) k--;
    return k < words.length ? words.slice(k).join(' ') : '';
  }

  /**
   * A deck that sorts its entities under category slides ("Viral infections", "Traumatic lesions": a title of two
   * or more words ending in a plural, a slide of its own and naming no subject of the deck) groups them: a virus
   * is a peer of the next virus, not of a trauma. -> { group: key -> group number, slideCount: key -> slides }
   */
  function deckGroups(subjectSlides, names) {
    const group = new Map();
    const slideCount = new Map();
    for (const { key } of subjectSlides) slideCount.set(key, (slideCount.get(key) || 0) + 1);
    const nameRes = names.map(([k, n]) => ({ k, re: new RegExp(`(?:^|[^A-Za-z])${escapeRe(n)}(?![A-Za-z])`, 'i') }));
    const isCategory = ({ slide, key }) => {
      const words = String(slide.title || '').trim().split(/\s+/);
      return words.length >= 2 && PLURAL_RE.test(words[words.length - 1]) && slideCount.get(key) === 1 &&
        !nameRes.some(({ k, re }) => k !== key && re.test(slide.title));
    };
    let at = 0;
    for (const s of subjectSlides) {
      if (isCategory(s)) {
        at++;
        slideCount.set(s.key, 0);
      }
      if (!group.has(s.key)) group.set(s.key, at);
    }
    return { group, slideCount };
  }

  function index(parts) {
    const facts = parts.facts || [];
    const aspects = new Map(); // subjectKey -> Set of aspect keys
    const note = (key, list) => {
      if (!key || !list.length) return;
      if (!aspects.has(key)) aspects.set(key, new Set());
      for (const a of list) aspects.get(key).add(a);
    };
    const aspectsOf = (fact) => [...new Set([...aspectKeys(headingOf(titleOf(fact))), ...frontOf(fact).split(/\s+[—–]\s+/).slice(1).flatMap(aspectKeys)])];
    for (const f of facts) note(f.subjectKey, aspectsOf(f));
    // Every card's label counts, whether or not it gave a fact: "Distemper — Clinical signs" tells distemper in signs.
    for (const card of parts.cards || []) {
      const subject = subjects().resolve(card, parts.ctx || {});
      const key = subject && parts.keyOf ? parts.keyOf(subject) : null;
      note(key, String(card.front || '').split(/\s+[—–]\s+|:\s+/).slice(1).flatMap((p) => aspectKeys(headingOf(p) || p)));
    }
    for (const { slide, key } of parts.subjectSlides || []) {
      note(key, aspectKeys(headingOf(slide.title)));
      for (const b of slide.bullets || []) {
        const line = String(b || '').trim();
        if (line.split(/\s+/).length <= MAX_ASPECT_LINE_WORDS && subjects().isGenericHeading(line)) note(key, aspectKeys(line));
      }
    }

    // Subjects named together in one line.
    const names = new Map();
    for (const f of facts) if (f.kind !== 'qa' && String(f.subject || '').length >= MIN_NAME_CHARS) names.set(f.subjectKey, f.subject);
    const patterns = [...names].map(([key, name]) => ({ key, re: new RegExp(`(?:^|[^A-Za-z])${escapeRe(name)}(?:e?s)?(?![A-Za-z])`, 'i') }));
    const together = new Set();
    for (const line of parts.lines || []) {
      const hit = patterns.filter((p) => p.re.test(line)).map((p) => p.key);
      for (const a of hit) for (const b of hit) if (a !== b) together.add(`${a}|${b}`);
    }

    const { group, slideCount } = deckGroups(parts.subjectSlides || [], [...names]);
    // An entity is told in several aspects, or over several slides of its own (not a one-slide topic or procedure).
    const isEntity = (key) => (aspects.get(key) || new Set()).size >= MIN_ENTITY_ASPECTS || (slideCount.get(key) || 0) >= MIN_ENTITY_SLIDES;
    const sameGroup = (a, b) => (group.get(a) || 0) === (group.get(b) || 0);
    // Names on one head word ("Leptospira spp" / "Borrelia spp", "Caudal epidural" / "Lumbosacral epidural") name kin;
    // a shared modifier does not ("Pleural disease" / "Pleural drainage").
    const headWord = (key) => (String(names.get(key) || '').toLowerCase().match(/[a-z]{3,}/g) || []).pop() || '';
    const kinNames = (a, b) => Boolean(headWord(a)) && headWord(a) === headWord(b);
    const peers = (a, b) => a !== b && (together.has(`${a}|${b}`) || (sameGroup(a, b) && (kinNames(a, b) || (isEntity(a) && isEntity(b)))));
    /** May a statement of `fact` be said of the subject `key`? Only when the scope teaches that subject in the same aspect. */
    const fitsAspect = (key, fact) => {
      const own = aspectsOf(fact);
      return !own.length || own.some((a) => (aspects.get(key) || new Set()).has(a));
    };
    /** The aspect heading a fact sits under, lower-cased for a sentence ("clinical signs"), or ''. */
    const aspectPhrase = (fact) => {
      const h = headingOf(titleOf(fact));
      return h ? h.replace(/\b([A-Z])([a-z]+)\b/g, (w, a, b) => a.toLowerCase() + b) : '';
    };
    return { isEntity, peers, aspectsOf, fitsAspect, aspectPhrase };
  }

  const api = { index, headingOf };
  PDFStudy.subjectPeers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Slide Subjects: what each slide is about. A title that names an aspect ("Pharmacokinetics", "Treatment",
 * "Pharmacokinetics (cont)") belongs to the last slide that named an entity ("Benzimidazoles"); a title that
 * names an entity and an aspect ("Leptospira spp. Transmission") is split; deck-level titles ("Summary",
 * "Overview") and question or remark titles name no subject. A stage of a course ("Complications",
 * "Prognosis") is not carried from a list of alternatives or from an item an earlier slide listed.
 * chain(slides, studyKinds) -> [{ subject, aspect, entity }] per slide, where
 *   subject  the entity ('' when the slide names none),
 *   aspect   the generic title it was read under ('' when the title is the entity itself),
 *   entity   the prefix for card fronts: "Benzimidazoles (Pharmacokinetics)", or the bare title as before.
 * entityOf(title) strips a trailing colon and a brand / synonym bracket ("Praziquantel (Droncit®, ...)").
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Aspects of an entity that a lecture gives a slide of their own.
  const ASPECTS =
    'pharmacokinetics|pharmacodynamics|mechanisms?(?:\\s+of\\s+action)?|moa|adverse\\s+(?:effects|reactions|events)|side\\s+effects|' +
    'toxicity|toxicities|indications?|contraindications?|dos(?:e|es|age|ing)|administration|treatment|therapy|management|' +
    'diagnosis|diagnostics|diagnostic\\s+tests|clinical\\s+(?:signs|presentation|findings|features)|signs|symptoms|pathogenesis|' +
    'pathology|pathophysiology|lesions|epidemiology|transmission|prevention|control|prognosis|etiology|aetiology|morphology|' +
    'life\\s+cycle|classification|absorption|distribution|metabolism|elimination|excretion|spectrum|resistance|' +
    'virulence\\s+factors|hosts|vaccination|risk\\s+factors|complications|anatomy|physiology|structure|function|properties|' +
    'characteristics|uses|applications|advantages|disadvantages|limitations|examples';
  const ASPECT_RE = new RegExp(`^(?:${ASPECTS})$`, 'i');
  // Stages of a disease's or a case's course. A lecture walks one topic through them, and a procedure or a
  // list of options it names on the way ("Pleural drainage", "Thoracoscopy/Thoracotomy") is not what the
  // next "Complications" or "Prognosis" slide is about: such a slide names no subject.
  const COURSE =
    'treatment|treatments|therapy|management|diagnosis|diagnostics|diagnostic\\s+tests|clinical\\s+(?:signs|presentation|findings|features)|' +
    'signs|symptoms|pathogenesis|pathology|pathophysiology|lesions|epidemiology|transmission|prevention|control|prognosis|' +
    'etiology|aetiology|vaccination|risk\\s+factors|complications|sequelae|outcomes?';
  const COURSE_RE = new RegExp(`^(?:${COURSE})$`, 'i');
  // "Thoracoscopy/Thoracotomy/rib resection": alternatives, not one thing a later slide can be about.
  const ALTERNATIVES_RE = /[A-Za-z]{3}\s*\/\s*[A-Za-z]{3}/;
  const TRAILING_ASPECT_RE = new RegExp(`^(.{3,}?)\\s*[:–—-]?\\s+(${ASPECTS})$`, 'i');
  // Titles about the lecture itself rather than one entity.
  const DECK_LEVEL_RE =
    /^(?:overview|introduction|intro|summary|review|recap|outline|agenda|background|key\s+points|take[-\s]home(?:\s+messages?)?|conclusions?|questions?|discussion|definitions?|terminology|general\s+(?:overview|principles)|basics)\b/i;
  const CONTINUED_RE = /\s*(?:\((?:cont(?:'d|inued)?\.?|part\s*\d+)\)|[–—-]\s*(?:cont(?:'d|inued)?\.?|part\s*\d+)|\bcont(?:'d|inued)?\.?)\s*$/i;
  // Openers of a question, an instruction or a remark: such a title names no entity.
  const NOT_ENTITY_START_RE =
    /^(?:why|how|what|which|when|where|who|do|does|did|is|are|can|could|should|would|will|remember|let'?s|note|the\s+most|a\s+few|some|more|kahoot|quiz|case|learning)\b/i;
  const REMARK_START_RE = /^(?:remember|let'?s|note|kahoot|quiz|case|learning)\b/i;
  const FINITE_VERB_RE =/\s(?:is|are|was|were|has|have|had|can|cannot|will|would|do|does|did|must|should|may|might)\s/i;
  const MAX_ENTITY_WORDS = 8;

  const tidy = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const wordCount = (s) => tidy(s).split(/\s+/).filter(Boolean).length;

  /** The slide's subject as a card prefix: no trailing colon, no brand or synonym list in brackets. */
  function entityOf(title) {
    const t = tidy(title).replace(CONTINUED_RE, '').replace(/\s*:+$/, '');
    const bare = t.replace(/\s*\([^)]*\)\s*$/, '');
    const bracket = (t.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
    const brandList = /[®™]|,/.test(bracket);
    return (wordCount(t) > 6 || brandList) && bare.length >= 3 ? bare : t;
  }

  function namesEntity(title) {
    const t = tidy(title).replace(CONTINUED_RE, '');
    const core = t.replace(/\([^)]*\)/g, ' ');
    if (!t || /[?!…^•_{}]|\.\.\./.test(t) || !/^[A-Za-z0-9]/.test(t) || wordCount(core) > MAX_ENTITY_WORDS || NOT_ENTITY_START_RE.test(t)) return false;
    if ((t.match(/\(/g) || []).length !== (t.match(/\)/g) || []).length) return false; // a title overwritten by recognition
    if (FINITE_VERB_RE.test(` ${core} `) || DECK_LEVEL_RE.test(t)) return false;
    return /[A-Za-z]{3}/.test(core);
  }

  const lineKey = (s) => tidy(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const MAX_ITEM_TAIL_WORDS = 3;
  /**
   * "Pleural drainage/lavage", "Pleural drainage (chest tube)" -> "pleural drainage": the item a short list line
   * names; '' for a sentence ("Pneumonia/bronchopneumonia is most common ...").
   */
  function itemKey(line) {
    const [head, ...rest] = String(line || '').split(/\s*[/,(–—]\s*|\s+-\s+/);
    return wordCount(rest.join(' ')) <= MAX_ITEM_TAIL_WORDS ? lineKey(head) : '';
  }
  // "Treatment of strangles", "Complications of strangles: 20%": the slide is about strangles, and so is the
  // aspect slide that follows it.
  const ASPECT_OF_RE = new RegExp(`^(?:${ASPECTS}|${COURSE})\\s+(?:of|in|for)\\s+(?:the\\s+|an?\\s+)?(.{3,})$`, 'i');

  /** The subject an aspect slide after this title is about: the X of "Treatment of X", else the title's entity. */
  function carriedName(title) {
    const of = tidy(title).split(/:\s/)[0].match(ASPECT_OF_RE);
    return of && namesEntity(of[1]) ? entityOf(of[1]) : entityOf(title);
  }

  /**
   * May a course slide ("Complications", "Prognosis") after this subject's slide be about it? Not when the subject
   * is a list of alternatives, or an item an earlier course slide listed (a procedure under "Supportive therapy"):
   * the course belongs to the topic the lecture is walking through, not to that item.
   * listedBefore: item keys (itemKey) of the lines of the course slides so far.
   */
  function carriesCourse(name, listedBefore) {
    return !ALTERNATIVES_RE.test(name) && !listedBefore.has(lineKey(name));
  }

  function chain(slides, studyKinds = []) {
    let last = '';
    let lastCarriesCourse = false;
    const listed = new Set(); // items printed as list lines on the slides so far
    const carry = (name) => {
      last = name;
      lastCarriesCourse = carriesCourse(name, listed);
    };
    return (slides || []).map((slide, i) => {
      const kind = studyKinds[i] || 'content';
      const title = tidy(slide && slide.title).replace(CONTINUED_RE, '').replace(/\s*:+$/, '');
      const out = (() => {
        if (kind === 'case' || kind === 'title') last = '';
        if (kind !== 'content' && kind !== 'question') return { subject: '', aspect: '', entity: '' };
        if (ASPECT_RE.test(title) || COURSE_RE.test(title)) {
          const inherits = last && (lastCarriesCourse || !COURSE_RE.test(title));
          return inherits ? { subject: last, aspect: title, entity: `${last} (${title})` } : { subject: '', aspect: title, entity: title };
        }
        const split = title.match(TRAILING_ASPECT_RE);
        // "Clinical pathology", "Supportive therapy": one adjective before the aspect is part of its name.
        const adjectiveOnly = split && /^[A-Za-z]+(?:al|ic|ive|ous|ary|ory)$/i.test(split[1]);
        if (split && !adjectiveOnly && namesEntity(split[1])) {
          carry(entityOf(split[1]));
          return { subject: last, aspect: split[2], entity: `${last} (${split[2]})` };
        }
        if (namesEntity(title)) {
          carry(carriedName(title));
          return { subject: last, aspect: '', entity: entityOf(title) };
        }
        return null;
      })();
      if (isCourseTitle(title)) for (const b of (slide && slide.bullets) || []) listed.add(itemKey(typeof b === 'string' ? b : b && b.text));
      if (out) return out;
      // Deck-level, question and remark titles keep their wording as a prefix but name no subject.
      // ("Why Relations Matter" keeps its wording; "Remember your anatomy!" and a garbled title do not.)
      const garbled = /[•^_{}]/.test(title) || (title.match(/\(/g) || []).length !== (title.match(/\)/g) || []).length;
      const keepsWording = !DECK_LEVEL_RE.test(title) && !/[?!…]/.test(title) && wordCount(title) <= 12 && !REMARK_START_RE.test(title) && !garbled;
      return { subject: '', aspect: '', entity: keepsWording ? entityOf(title) : '' };
    });
  }

  /** Is this title a stage of a course ("Prognosis", "Treatment"), on which carrying a subject needs care? */
  const COURSE_END_RE = new RegExp(`(?:^|\\s)(?:${COURSE})$`, 'i'); // "Supportive therapy", "Clinical pathology"
  const isCourseTitle = (title) => COURSE_END_RE.test(tidy(title).replace(CONTINUED_RE, '').replace(/\s*:+$/, ''));

  const api = { chain, entityOf, namesEntity, carriesCourse, isCourseTitle, itemKey, ASPECT_RE };
  PDFStudy.slideSubjects = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

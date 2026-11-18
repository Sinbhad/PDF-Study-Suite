/**
 * Deck sections: decides which slides carry study content and groups them into the deck's sections and
 * topics, so the Summary can show a lecture as an outline. DOM-free.
 *   role(slide, index)  -> 'content' | 'header' | 'objectives' | 'case' | 'skip'  (a case is skipped with its follow-ups)
 *   group(slides)       -> { covers: [slide], sections: [{ title, page, topics: [{ title, slides: [slide] }] }] }
 * Which slides are cases, objectives or non-content is PDFStudy.contentFilter's call (slideKind /
 * isStudyContent); the checks below add the outline's own roles (headers, dividers). Slides are slide-model.js normalised slides ({ slideNumber, title, kind, bullets, ... }).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Two titles name the same topic when this share of their content words is shared (Jaccard).
  const SAME_TOPIC_OVERLAP = 0.5;
  // A section header title is at most this long; longer "titles" are sentences or recognised handwriting.
  const HEADER_MAX_CHARS = 60;
  // Objective slides this close to the start are the lecture's overview, not a section boundary.
  const OPENING_SLIDES = 3;
  // A slide whose only text is a caption this short is a section divider over a picture.
  const DIVIDER_CAPTION_WORDS = 3;
  // A title word found in more than this share of the deck's slides (and at least this many) is not distinctive.
  const COMMON_SHARE = 0.15;
  const COMMON_MIN_SLIDES = 3;

  const OBJECTIVES_RE = /\b(?:learning\s+(?:objectives?|targets?|outcomes?|goals?)|course\s+objectives?|objectives?|lecture\s+goals?|outcomes)\b/i;
  const CLOSING_RE = /^(?:questions?|any\s+questions|thank\s+you|thanks|q\s*&\s*a|discussion|the\s+end)\W*$/i;
  const REFERENCES_RE = /^(?:references?|bibliography|sources?|citations?|further\s+reading|acknowledg(?:e)?ments?|credits?)\b/i;
  const QUIZ_GAME_RE = /\b(?:kahoot|poll\s*everywhere|clicker|quiz\s+question|question\s+time|pop\s+quiz)\b/i;
  const CONTACT_RE = /@[\w-]+\.\w|\b(?:https?:\/\/|www\.)|\b(?:DVM|PhD|MD|MSc|DACV\w*|Dipl\.?)\b|\(\d{3}\)\s*\d{3}/;
  const URL_RE = /^(?:https?:\/\/|www\.)\S+$/i;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function contentWords(title) {
    const tok = dep('tokenizer', './tokenizer.js');
    const stop = tok ? tok.STOPWORDS : new Set();
    return norm(title).split(' ').filter((w) => w.length > 2 && !stop.has(w) && !/^\d+$/.test(w));
  }

  /** "Pharmacokinetics (cont)", "Leptospira spp. – 2" -> the topic's key title. */
  function topicKey(title) {
    return norm(String(title || '').replace(/\((?:cont(?:inued|'d|’d)?|\d+)\)|\bcont(?:inued|'d|’d)?\b\.?|[-–—:]\s*\d+\s*$/gi, ''));
  }

  function sameTopic(a, b) {
    const ka = topicKey(a);
    const kb = topicKey(b);
    if (!ka || !kb) return false;
    if (ka === kb || `${kb} `.startsWith(`${ka} `) || `${ka} `.startsWith(`${kb} `)) return true;
    const wa = new Set(contentWords(ka));
    const wb = new Set(contentWords(kb));
    if (!wa.size || !wb.size) return false;
    const shared = [...wa].filter((w) => wb.has(w)).length;
    return shared / (wa.size + wb.size - shared) >= SAME_TOPIC_OVERLAP;
  }

  /** A title that reads as a heading: letters, starts upper-case, not a slide number, a URL or a sentence. */
  function credibleTitle(title) {
    const t = String(title || '').trim();
    if (!t || t.length > HEADER_MAX_CHARS || URL_RE.test(t) || /^slide\s+\d+$/i.test(t)) return false;
    if (!/^[A-Z0-9]/.test(t) || /[=^_{}]/.test(t)) return false;
    const tokens = t.split(/\s+/);
    const wordy = tokens.filter((w) => /^[A-Za-z][A-Za-z'’.-]*[,:]?$/.test(w)).length;
    return wordy / tokens.length >= 0.6 && /[A-Za-z]{3,}/.test(t);
  }

  const bulletsOf = (slide) => (slide.bullets || []).map(String);

  /** Case presentation, by the one definition every generator shares (content-filter.js slideKind). */
  const isCase = (slide) => dep('contentFilter', './content-filter.js').slideKind(slide) === 'case';

  /** Roles the shared filter has no word for: header and divider slides, closing and quiz-game slides. */
  function ownRole(slide, index) {
    const title = String(slide.title || '').trim();
    const bullets = bulletsOf(slide);
    if (slide.kind === 'title' || (index === 0 && bullets.length <= 3 && bullets.some((b) => CONTACT_RE.test(b)))) return 'skip';
    if (OBJECTIVES_RE.test(title) || (bullets[0] && bullets[0].length <= 30 && OBJECTIVES_RE.test(bullets[0]))) return 'objectives';
    if (CLOSING_RE.test(title) || REFERENCES_RE.test(title) || URL_RE.test(title)) return 'skip';
    if (QUIZ_GAME_RE.test(title) && bullets.length < 3) return 'skip';
    if (bullets.length && bullets.filter((b) => CONTACT_RE.test(b) || URL_RE.test(b.trim())).length / bullets.length > 0.5) return 'skip';
    if (isCase(slide)) return 'case';
    if (slide.kind === 'section' || (!bullets.length && !slide.table && !(slide.qa || []).length)) return credibleTitle(title) ? 'header' : 'skip';
    // A divider slide: a heading over a picture whose only text is a short caption ("Sgt. Pepper").
    if (bullets.length === 1 && bullets[0].split(/\s+/).length <= DIVIDER_CAPTION_WORDS && !slide.table && credibleTitle(title)) return 'header';
    return 'content';
  }

  function role(slide, index) {
    const cf = dep('contentFilter', './content-filter.js');
    const kind = cf.slideKind(slide);
    if (kind === 'objectives') return 'objectives';
    // A case is kept as a role of its own: the outline skips it together with the slides that continue it.
    if (kind === 'case') return 'case';
    return cf.isStudyContent(slide) ? ownRole(slide, index) : 'skip';
  }

  function group(slides) {
    const list = slides || [];
    const covers = [];
    const sections = [];
    let section = null;
    let caseTitle = '';
    // A header slide heads a section only when the slide after it is about the same subject: a picture
    // slide with a caption-like title ("One-Health", "Types of Dehorners") must not claim the next topics.
    let header = null;
    const relates = relatesWith(commonWords(list));

    const openSection = (title, page) => {
      section = { title, page, topics: [] };
      sections.push(section);
    };
    list.forEach((slide, i) => {
      const r = role(slide, i);
      // A case runs on over the following slides that keep its title.
      if (r === 'case' || (caseTitle && sameTopic(caseTitle, slide.title) && r === 'content')) {
        caseTitle = slide.title;
        return;
      }
      caseTitle = '';
      if (r === 'skip') return;
      if (r === 'objectives') {
        covers.push(slide);
        if (i >= OPENING_SLIDES) section = null; // an objective mid-deck opens the next part of the lecture
        return;
      }
      if (r === 'header') {
        header = slide;
        return;
      }
      if (header) {
        if (relates(header.title, slide.title)) openSection(header.title, header.slideNumber);
        else section = null;
        header = null;
      }
      const topics = section ? section.topics : null;
      const last = topics && topics[topics.length - 1];
      if (last && sameTopic(last.title, slide.title)) {
        last.slides.push(slide);
        return;
      }
      // A new title starts a new section unless it continues the subject of the section or of its last topic.
      const continues = section && last && (relates(section.title, slide.title) || relates(last.title, slide.title));
      if (!continues && !(section && !section.topics.length)) openSection(slide.title, slide.slideNumber);
      section.topics.push({ title: slide.title, slides: [slide] });
    });
    return { covers, sections: sections.filter((s) => s.topics.length) };
  }

  /** Content words without a plural "s", so "Impellers" and "Impeller" match. */
  const stems = (title) => contentWords(title).map((w) => w.replace(/(?<=[a-z]{3})s$/, ''));

  /**
   * Words that sit in so many slide titles of the deck that sharing one says nothing ("block" in a deck on
   * nerve blocks): they never link two titles.
   */
  function commonWords(slides) {
    const df = new Map();
    for (const s of slides) new Set(stems(s.title)).forEach((w) => df.set(w, (df.get(w) || 0) + 1));
    const limit = Math.max(COMMON_MIN_SLIDES, slides.length * COMMON_SHARE);
    return new Set([...df].filter(([, n]) => n > limit).map(([w]) => w));
  }

  /** Two titles relate when they share a distinctive content word. */
  function relatesWith(common) {
    return (a, b) => {
      const anchor = new Set(stems(a).filter((w) => !common.has(w)));
      return stems(b).some((w) => anchor.has(w));
    };
  }

  const api = { role, group, sameTopic, topicKey, credibleTitle, isCase };
  PDFStudy.deckSections = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

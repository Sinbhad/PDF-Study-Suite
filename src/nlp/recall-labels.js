/**
 * Recall Labels: the question and answer for a self-graded recall of a labelled slide card, worded by what the answer
 * is. recall-outline.js finds the label on its slide, the heading above it and everything under it; this module picks
 * the template, and refuses the card ('' / null) when none fits:
 *   a list under an aspect     List the adverse effects of Praziquantel (3 points).
 *                              Describe the pharmacodynamics of Benzimidazoles (3 points).
 *   steps                      What are the steps of the Claw care technique, in order? (4 steps)
 *   a list under its own name  List the two parts of a filter (2 points).
 *   one value under an aspect  What is the prognosis for pulmonary abscess?   What are the clinical signs of bronchitis?
 *   a case under a heading     What are the indications of Epsiprantel for dogs?   (the parent heading names what is given)
 *   labelled points            What are the pros and cons of the line block?
 *   a chain of arrows          In blunt trauma, what does raised pressure lead to?   (2+ arrows, or a causal verb)
 *   a case arrow               What is the diagnostic testing of rabies for human exposure?
 *   a contrast                 How does Hansen's type 1 differ from Hansen's type 2?
 *   a table cell               What is the sample for the assay "PCR"?
 * Refused: a label that is a lead-in sentence ("In very severe cases…") or describes the subject; a case label ("In
 * vivo", "Swine") whose parent names no aspect or set, or whose siblings are sentences (then it is one point of a list
 * of things, not a case); one item under a plural label; a single arrow with no causal verb ("Hematoma → bleeding
 * between skull and dura" is what a hematoma is, not what it leads to); a table header that is abbreviated or names
 * the table's own parts ("Maint.", "Column").
 *   labelled(card, scope) -> { prompt, answer } | null
 *   cellPrompt(card)      -> prompt | ''
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const shapes = () => dep('slideLineShapes', './slide-line-shapes.js');
  const outline = () => dep('recallOutline', './recall-outline.js');

  const MIN_LIST_ITEMS = 2;
  const MAX_LIST_ITEMS = 8;
  const MAX_LABEL_WORDS = 6;
  const MAX_CASE_WORDS = 6;
  const ARROW_FRONT_RE = /^(.+?):\s+(.+?)\s*→\s*\?\s*$/;
  const CONTRAST_RE = /^(.+?)\s+vs\.?\s+(.+?)\s+—\s+how do they differ\?$/;
  const KEY_POINTS_RE = /^What are the key points of\s+"([^"]+)"/;
  // "Possible lesions", "Clinical signs": a heading that names several things ("-ss", "-us", "-is" are singular, and
  // so is a field of study: "pharmacokinetics", "genetics")
  const PLURAL_HEAD_RE = /[a-z]{2,}[^siu\W]s$|[a-z]ies$/i;
  const MASS_NOUN_RE = /ics$/i;
  const STEPS_RE = /^(?:technique|techniques|procedure|procedures|steps|method|protocol)$/;
  const PREPOSITION_RE = /^(?:in|on|at|for|with|without|during|after|before|outside|inside|under|from|within)\b/i;
  const STATES_RE = /\b(?:is|are|was|were|has|have|can|may|will|should|must|remains?)\b/i;
  const CAUSAL_RE = /\b(?:lead(?:s|ing)?\s+to|results?\s+in|causes|cause(?!\s+of\b)|caused\s+by|triggers?|allows?|induces?|produces?)\b/i;
  // A label starting with a relative qualifier ("Other causes ...") leans on earlier points on the slide.
  const RELATIVE_START_RE = /^(?:other|additional|further|remaining|more|else|extra|similar|related|such|these|those)\b/i;
  // A broad disease/event noun after "<aspect> of" ("Routes of infection") names no specific subject.
  const GENERIC_BROAD_RE = /^(?:infection|infections|disease|diseases|illness|disorder|disorders|injury|injuries|trauma|pain|inflammation|pathology|treatment|therapy)$/i;
  // A header that is a table's own part ("Table | Column | Row"), not a property of its rows
  const TABLE_PART_RE = /^(?:table|column|row|field|record|cell|value|item|entry|name|term)s?$/i;
  // Aspects whose sibling labels name members of the set rather than topics having that aspect ("Complications of X" > "Myositis").
  const MEMBER_ASPECT_RE = /^(?:complications?|side\s+effects?|adverse\s+effects?|risk\s+factors?|causes?|types?|examples?|manifestations?|sequelae)$/i;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  /** "Adverse Effects" -> "adverse effects"; an acronym keeps its capitals ("PCR"). */
  const lower = (s) => String(s || '').replace(/\b([A-Z])([a-z]+)\b/g, (w, a, b) => a.toLowerCase() + b).replace(/[:\s]+$/, '').trim();
  const lowerFirst = (s) => String(s || '').replace(/^([A-Z])(?=[a-z])/, (c) => c.toLowerCase()).trim();
  // (quizSubjects knows "diagnosis"; a slide may head the same aspect "Diagnostic testing")
  const TESTING_RE = /^(?:(?:diagnostic|laboratory|lab)\s+)?(?:testing|tests|workup)$/i;
  const isAspect = (text) => subjects().isGenericHeading(text, {}) || TESTING_RE.test(String(text || '').replace(/[:\s]+$/, '').trim());
  /** The head noun of a label: before "of"/"to"/"for", else its last word ("Other causes of effusion" -> "causes"). */
  const headNoun = (label) => {
    const part = String(label || '').replace(/\([^)]*\)/g, ' ').split(/\s+(?:of|to|for|in|on)\s+/i)[0];
    return (words(part).pop() || '').replace(/[^A-Za-z]/g, '');
  };
  const plural = (label) => PLURAL_HEAD_RE.test(headNoun(label)) && !MASS_NOUN_RE.test(headNoun(label));
  // A label that names a set it heads: a noun phrase of two words or more ("Possible lesions", "Two parts of a filter"),
  // not one plural word ("Dogs": a case), a run of names ("Stalls, trailers") or an action ("Disinfecting stalls").
  // Its head noun opens it ("Two parts to …"): "Targets multiple organ systems" is a verb and its object, and
  // "Inclusions within neurons" names where, not a set.
  const MAX_HEAD_AT = 3;
  const namesSet = (label) => {
    // ("Local blocks – practical blocks": the first of two names joined by a dash)
    const part = String(label || '').replace(/\([^)]*\)/g, ' ').split(/\s+(?:of|to|for|in|on)\s+|\s+[–—-]\s+/i)[0];
    return plural(label) && words(label).length >= 2 && words(part).length <= MAX_HEAD_AT && !/,/.test(label) && !/^[A-Za-z]+ing\b/.test(label);
  };
  // A case is a thing or a setting ("Pulmonary abscess", "On the farm"), not an action ("Screening to find carriers").
  const isCase = (label) => !/^[A-Za-z]+ing\b/.test(label) && !/\bto\s+[a-z]+/.test(label);
  // "Etc.", "and more": the slide did not give the whole set.
  const FILLER_ITEM_RE = /^(?:etc\.?|and (?:more|others|so on)\.?|\.{3}|…)$/i;
  /** "Clinical signs of pneumonia" -> "clinical signs": an aspect heading that names its own subject. */
  const aspectOf = (heading) => {
    const m = String(heading || '').split(':')[0].match(/^(.+?)\s+of\s+(.+)$/i);
    return m && isAspect(m[1]) ? lower(m[1]) : '';
  };
  const connector = (subject) => (/^[A-Za-z]+ing\b/.test(subject) ? 'for' : 'of');
  const joinList = (xs) => (xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

  /** The subject a card is about ("Benzimidazoles (Pharmacokinetics)" -> Benzimidazoles) and its title's aspect. */
  function subjectOf(card) {
    const head = String(card.front || '').split(/\s+[—–]\s+/)[0];
    const paren = head.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const name = (paren && isAspect(paren[2]) ? paren[1] : head).split(/\s+(?:aka|a\.k\.a\.)\s+/i)[0];
    return { subject: subjects().tidySubject(name) || String(card.subject || ''), titleAspect: paren && isAspect(paren[2]) ? paren[2] : '' };
  }

  const slideOf = (card, scope) => (scope.slides || []).find((s) => s.slideNumber === (card.pageNumber || card.page)) || null;

  /** The answer: one value as it stands, several as a list in slide order with their sub-points. */
  function answerOf(place) {
    const { items, inlineValue } = place;
    if (inlineValue) return [inlineValue, outline().render(items)].filter(Boolean).join('\n');
    if (items.length === 1) return [items[0].text, outline().render(items[0].children)].filter(Boolean).join('\n');
    return outline().render(items);
  }

  const countOf = (place) => place.items.length + (place.inlineValue ? 1 : 0);

  /** A label under an aspect of the subject ("Absorption", "Adverse effects", "Technique"). */
  function aspectPrompt(label, subject, n) {
    const l = lower(label);
    const of = `${connector(subject)} ${subject}`;
    if (n >= MIN_LIST_ITEMS && STEPS_RE.test(norm(label))) return `What are the steps of the ${subject} ${l}, in order? (${n} steps)`;
    if (n >= MIN_LIST_ITEMS) return plural(label) ? `List the ${l} ${of} (${n} points).` : `Describe the ${l} ${of} (${n} points).`;
    return `What ${plural(label) ? 'are' : 'is'} the ${l} ${of}?`;
  }

  /** A label naming the set it heads ("Two parts of a filter", "Possible lesions"). */
  function setPrompt(label, subject, place) {
    const n = countOf(place);
    const own = /\s(?:of|to|for|in)\s/i.test(label) || (subject && norm(label).includes(norm(subject)));
    if (!own && !subject) return '';
    const tail = own ? '' : ` ${connector(subject)} ${subject}`;
    if (n >= MIN_LIST_ITEMS) return `List the ${lower(label)}${tail} (${n} points).`;
    // One line under a plural label is one of several, unless it lists them itself.
    return /,|\band\b/.test(answerOf(place)) ? `What are the ${lower(label)}${tail}?` : '';
  }

  /** Short noun phrases side by side ("Head:", "Abdomen:"; "On the farm", "In the hospital"): cases of one heading. */
  function parallel(label, place) {
    const labelled = place.siblings.filter((s) => s.children.length || outline().INLINE_LABEL_RE.test(s.text));
    const nameOf = (t) => (String(t).match(outline().INLINE_LABEL_RE) || [null, t])[1];
    const shortName = (t) => words(nameOf(t)).length <= MAX_CASE_WORDS && !STATES_RE.test(nameOf(t)) && !/[.…]$/.test(nameOf(t).trim());
    return labelled.length >= 1 && labelled.every((s) => shortName(s.text)) && shortName(label);
  }

  /** A case under a heading that names what is given for each ("Prognosis" > "Pulmonary abscess"). */
  function casePrompt(label, subject, place, slide) {
    const parentNode = place.ancestors[0];
    const parent = parentNode ? String(parentNode.text).replace(/[:\s]+$/, '') : String(slide.title || '');
    const tidyParent = subjects().tidySubject(parent);
    const named = aspectOf(tidyParent);
    if (!(named || isAspect(tidyParent) || namesSet(tidyParent)) || !isCase(label) || !parallel(label, place)) return '';
    const l = lower(label);
    let phrase;
    if (PREPOSITION_RE.test(label)) {
      if (named && !parentNode) phrase = `${lower(tidyParent)} ${l}`;
      else if (subject) phrase = `${lower(tidyParent)} ${connector(subject)} ${subject} ${l}`;
      else return '';
    } else if (named && !parentNode && MEMBER_ASPECT_RE.test(named)) {
      const parentCtx = lower(String(tidyParent).replace(/:\s*\d+%?$/, '').replace(/\s+\d+%$/, '').trim());
      const n = countOf(place);
      return n >= MIN_LIST_ITEMS ? `List the features of ${l} (${parentCtx}) (${n} points).` : `Describe ${l} (${parentCtx}).`;
    } else if (named && !parentNode) {
      phrase = `${named} of ${l}`;
    } else if (parentNode && !subject) {
      return '';
    } else if (parentNode) {
      phrase = `${lower(tidyParent)} ${connector(subject)} ${subject} for ${l}`;
    } else {
      phrase = `${lower(tidyParent)} for ${l}`;
    }
    const n = countOf(place);
    if (n >= MIN_LIST_ITEMS) return `List the ${phrase} (${n} points).`;
    return `What ${plural(named || tidyParent) ? 'are' : 'is'} the ${phrase}?`;
  }

  /** Points that carry their own aspect labels ("Pros: …", "Cons: …"): asked by those labels. */
  function labelledPointsPrompt(label, place) {
    if (place.inlineValue || place.items.length < MIN_LIST_ITEMS) return '';
    // ("Pros:" over its own points, or "Pros: quick, easy" on one line)
    const names = place.items.map((n) => {
      const m = n.text.match(/^([^:]{1,40}?):\s*(.*)$/);
      return m && (m[2] || n.children.length) ? m[1] : '';
    });
    if (!names.every((x) => x && isAspect(x))) return '';
    return `What are the ${joinList(names.map(lower))} of ${label.replace(/[:\s]+$/, '')}?`;
  }

  /** One label on its slide, worded by what is under it. */
  function labelPrompt(card, label, subject, scope) {
    const slide = slideOf(card, scope);
    const place = outline().locate(slide, label, scope);
    if (!place) return null;
    const n = countOf(place);
    if (!n || place.items.length > MAX_LIST_ITEMS || place.items.some((i) => FILLER_ITEM_RE.test(i.text.trim()))) return null;
    // ("Treatment (1-2 >4 weeks)": a dose note in brackets is detail of the answer, not part of what is asked)
    const printed = String(place.node.text.match(outline().INLINE_LABEL_RE) ? place.node.text.match(outline().INLINE_LABEL_RE)[1] : label);
    const note = (printed.match(/\([^)]*[\d<>=][^)]*\)/) || [''])[0];
    const name = printed.replace(/\s*\([^)]*[\d<>=][^)]*\)/g, '').trim();
    if (words(name).length > MAX_LABEL_WORDS || /[.!?…]$/.test(name) || (shapes() && shapes().isDescription && shapes().isDescription(name))) return null;
    if (shapes() && shapes().fusedNames && shapes().fusedNames(name)) return null;
    if (RELATIVE_START_RE.test(name)) return null;
    // "List the treatment of Diagnosis": a subject that is itself a generic heading names nothing.
    const about = subject && !isAspect(subject) ? subject : '';
    const aspect = isAspect(name);
    const labelledPts = !aspect && labelledPointsPrompt(name, place);
    const isSet = !aspect && !labelledPts && namesSet(name);
    const prompt = aspect ? (about && aspectPrompt(name, about, n))
      : labelledPts || (isSet ? setPrompt(name, about, place) : casePrompt(name, about, place, slide));
    const resolvedSubject = !about && !aspect && !labelledPts && !isSet && !PREPOSITION_RE.test(name) ? name : '';
    return prompt ? { prompt, answer: [note, answerOf(place)].filter(Boolean).join('\n'), ...(resolvedSubject ? { subject: resolvedSubject } : {}) } : null;
  }

  /** "Subject: Left → ?": a chain asks what follows; a case arrow under an aspect asks its value; else nothing. */
  function arrowPrompt(card, scope) {
    const m = String(card.front || '').match(ARROW_FRONT_RE);
    const right = String(card.back || '').trim();
    if (!m || !right) return null;
    let subject = subjects().tidySubject(m[1]);
    if (!subject || isAspect(subject)) return null;
    if (aspectOf(subject)) {
      const of = subject.match(/^.+?\s+of\s+(.+)$/i);
      const target = of ? subjects().tidySubject(of[1]) : '';
      if (!target || isAspect(target) || GENERIC_BROAD_RE.test(target)) return null;
      subject = target;
    }
    const left = m[2].trim();
    const line = `${left} → ${right}`;
    if ((line.match(/→/g) || []).length >= 2 || CAUSAL_RE.test(line.replace(/\([^)]*\)/g, ' '))) {
      // "Fibrocartilage is forced into circulation → …": a clause on the left asks what happens when it does.
      const clause = /\b(?:is|are|was|were|becomes?|gets?)\s+[a-z]+(?:ed|en)\b|\b(?:is|are)\b/.test(left);
      return { prompt: clause ? `In ${subject}, what happens when ${lowerFirst(left)}?` : `In ${subject}, what does ${lowerFirst(left)} lead to?`, answer: right };
    }
    const slide = slideOf(card, scope);
    const nodes = slide ? outline().tree(slide) : [];
    const node = nodes.find((n) => norm(n.text).startsWith(norm(left)) && /→/.test(n.text));
    const parent = node && node.parent;
    if (!parent || !isAspect(parent.text)) return null;
    const cases = parent.children.filter((c) => /→/.test(c.text));
    if (cases.length < MIN_LIST_ITEMS || cases.length !== parent.children.length) return null;
    return { prompt: `What is the ${lower(parent.text)} of ${subject} for ${lowerFirst(left)}?`, answer: right };
  }

  /** "Type 1 vs type 2 — how do they differ?" -> "How does Type 1 differ from Type 2?" */
  function contrastPrompt(card) {
    const m = String(card.front || '').match(CONTRAST_RE);
    if (!m) return null;
    const a = words(m[1]);
    const b = words(m[2]);
    // "Hansen's type 1 vs type 2": the second name borrows the first one's opening words.
    const at = a.findIndex((w, i) => i > 0 && norm(w) === norm(b[0]));
    const second = at > 0 ? [...a.slice(0, at), ...b].join(' ') : m[2];
    return { prompt: `How does ${m[1]} differ from ${second}?`, answer: String(card.back || '').trim() };
  }

  /** A slide's list with no label of its own: its one heading, or the aspect its title names. */
  function listPrompt(card, scope) {
    const slide = slideOf(card, scope);
    if (!slide) return null;
    const sole = outline().soleHeading(slide);
    const { subject } = subjectOf({ front: card.topic || card.subject || '' });
    if (sole) return labelPrompt(card, sole.text, subject, scope);
    // 'What are the key points of "Drug A (Pharmacokinetics)"?': the subject, and the aspect its slide is titled
    const topic = String((String(card.front || '').match(KEY_POINTS_RE) || [])[1] || card.topic || '');
    const paren = topic.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    const aspect = paren && isAspect(paren[2]) ? paren[2] : aspectOf(slide.title);
    const about = paren && isAspect(paren[2]) ? subjects().tidySubject(paren[1]) : (String(slide.title).match(/\s+of\s+(.+)$/i) || [])[1];
    if (!aspect || !about) return null;
    const nodes = outline().tree(slide);
    const items = nodes.filter((n) => !n.parent && (!n.marked || n.bullet));
    if (items.length < MIN_LIST_ITEMS || items.length > MAX_LIST_ITEMS) return null;
    return { prompt: aspectPrompt(aspect, subjects().tidySubject(about), items.length), answer: outline().render(items) };
  }

  function labelled(card, scope) {
    const front = String(card.front || '').trim();
    if (CONTRAST_RE.test(front)) return contrastPrompt(card);
    if (ARROW_FRONT_RE.test(front)) return arrowPrompt(card, scope);
    if (KEY_POINTS_RE.test(front)) return listPrompt(card, scope);
    const parts = front.split(/\s+[—–]\s+/);
    if (parts.length < 2) return null;
    return labelPrompt(card, parts[parts.length - 1], subjectOf(card).subject, scope);
  }

  /** A header a question can name: present, short, written out, and a property of the rows. */
  const header = (h) => {
    const t = String(h || '').trim();
    return t && words(t).length <= 4 && !/\.$/.test(t) && !TABLE_PART_RE.test(t) && !/\b[a-z][a-z.]*\s+[A-Z][a-z]/.test(t) ? t : '';
  };

  /** "What is the sample for the assay "PCR"?": both headers named; a row named by a fragment ("hepatica") is not. */
  function cellPrompt(card) {
    const t = card && card.table;
    if (!t || !Array.isArray(t.header) || !header(t.header[0]) || !header(t.column)) return '';
    const entity = String(t.entity || '').trim();
    if (!entity || /^[a-z]/.test(entity)) return '';
    const tq = dep('tableQuestions', './table-questions.js');
    const shown = tq && tq.qualifiedEntity ? tq.qualifiedEntity(t) : entity;
    return `What is the ${lower(header(t.column))} for the ${lower(header(t.header[0]))} "${shown}"?`;
  }

  const api = { labelled, cellPrompt, MAX_LABEL_WORDS };
  PDFStudy.recallLabels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

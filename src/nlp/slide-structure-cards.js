/**
 * Slide Structure Cards: cards read off the layout of a bullet slide, for decks that define nothing in
 * sentences (a title, nested fragments, "Label: value" lines, a table).
 *   label slide       title "Parvovirus", bullet "Treatment: fluids"        -> "Parvovirus — Treatment" => fluids
 *   definition bullet "Isosthenuria: urine neither concentrated nor dilute" -> "Isosthenuria" => ...
 *                     "Cribriform plate = very thin and porous"            -> "Cribriform plate" => ...
 *   heading group     bullet "Clinical signs" with nested bullets           -> "Parvovirus — Clinical signs" => the bullets
 *   dash bullet       "Plant toxins – lilies, aloe, ivy"                    -> "Plant toxins" => lilies, aloe, ivy
 *   arrow bullet      "Low calcium → muscle tremors"                        -> "<title>: Low calcium → ?" => muscle tremors
 *   comparison table  header row + one row per entity                       -> "<row> — <column>" => cell (table-cards.js)
 *   plain list        title + 2-7 short bullets, nothing else on the slide  -> key-points card
 * The prefix is the slide's entity from slide-subjects.js ("Benzimidazoles (Pharmacokinetics)"), never a bare
 * aspect title, and every card carries `subject`. A heading is grouped with its children only when it reads as
 * a label (slide-line-shapes.js); a statement, an instruction or a diagram label over another diagram label is a
 * reading-order accident, not a question and its answer.
 * build(slide, gates) -> [{ front, back, category, kind, subject }] for one normalised slide (slide-model.js);
 * the caller adds slide number, topic and ids. gates: { isNoise, isValidTerm }.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const quality = () => dep('cardQuality', './card-quality.js');
  const notes = () => dep('notePatterns', './note-patterns.js');
  const stemNoise = () => dep('stemNoise', './stem-noise.js');
  const subjects = () => dep('slideSubjects', './slide-subjects.js');
  const aspects = () => dep('aspectGroups', './aspect-groups.js');
  const shapes = () => dep('slideLineShapes', './slide-line-shapes.js');

  const LIST_TITLE_RE =
    /^(types|kinds|stages|phases|steps|components|factors|causes|effects|properties|characteristics|advantages|disadvantages|cases|operations|applications)\b/i;
  const CLOCK_RE = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/i;
  // "Hansen's type 1" ends in a number like a structural label ("Case 1") but names a kind.
  const NUMBERED_KIND_RE = /\b(?:type|class|grade|stage|phase|form|degree)\s+(?:\d+|[IVX]{1,4})$/i;
  const MAX_FOLDED_CHARS = 420;
  const MAX_FOLDED_ITEMS = 5; // lines under one child heading that still fit on the parent's card
  const MAX_STEPS = 10;
  const GENERAL_HEAD_RE = /\b(?:disease|disorder|signs|syndrome|failure|infection|lesions?|findings|form)$/i;
  const MIN_INLINE_VALUE_WORDS = 3;
  const MIN_DEFINING_WORDS = 2;
  const ATTRIBUTE_RUN_RE = /^(?:very\s+)?[a-z]+,\s+[a-z]/i;

  // Shorthand "a = b" notes starting lower case, or instructional/dosing contraindications that are not standalone definitions.
  const NON_DEF_NOTE_RE = /^(?:do\s+not|never|always|avoid|keep|use|give|consider|these|those|this|they|it)\b|\b(?:contraindicated|advisable|injections?|series\s+of|intranasally|weeks?\s+apart|twice\s+daily|q\d+hrs?|\d+\s*(?:cc|ml|mg)\b)\b/i;
  const ROUTE_TERM_RE = /^(?:live|killed(?:\s+\w+)*|intranasal|intramuscular|subcutaneous|oral)$/i;

  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  // "Infrequently progressive and fatal:" leads into the lines after it: no "; " after its colon.
  const joinItems = (items) => items.map((x, i) => (i < items.length - 1 && !/[:;.!?]$/.test(x) ? `${x};` : x)).join(' ');
  const wordCount = (s) => tidy(s).split(/\s+/).filter(Boolean).length;
  const bulletList = (items) => items.map((x) => `• ${x}`).join('\n');
  const entityOf = (title) => subjects().entityOf(title);
  const sameText = (a, b) => tidy(a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === tidy(b).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hasLetters = (s) => /[A-Za-z]{2}/.test(s);

  /**
   * The name an outline line's parent gives it: "Purpura hemorrhagica" for a line under "Purpura hemorrhagica:
   * aseptic ...", "2% Lidocaine HCl" for one under that heading. Empty when the parent is an aspect ("Treatment"),
   * a statement or missing, so the slide's own entity stays the subject.
   */
  function parentName(slide, text) {
    const nodes = slide.outline || [];
    const at = nodes.findIndex((n) => n.text === text);
    if (at <= 0) return '';
    const { LABEL_RE, needsEntity, isLabelHead } = shapes();
    let want = nodes[at].level;
    for (let i = at - 1; i >= 0; i--) {
      const parent = nodes[i];
      if (parent.column != null && nodes[at].column != null && parent.column !== nodes[at].column) continue;
      if (parent.level >= want) continue;
      want = parent.level;
      const labelled = parent.text.match(LABEL_RE);
      const raw = tidy(labelled ? labelled[1] : parent.text).replace(/:$/, '');
      const name = wordCount(raw) > MAX_PARENT_NAME_WORDS ? tidy(raw.replace(/\s*\([^)]*\)\s*$/, '')) : raw;
      if (!name || needsEntity(name) || wordCount(name) > MAX_PARENT_NAME_WORDS || !isLabelHead(name) || stemNoise().isLabelTerm(name)) continue;
      return name;
    }
    return '';
  }
  const MAX_PARENT_NAME_WORDS = 5;

  function labelCards(slide, ctx, gates) {
    const { LABEL_RE, EQUALS_RE, CAPTION_RE, CAPTION_NOTE_RE, DISCOURSE_LABEL_RE, GLUED_LABEL_RE, needsEntity, definingWords } = shapes();
    const out = [];
    for (const bullet of slide.bullets) {
      if (CLOCK_RE.test(bullet) || /^Def(?:inition)?\b/i.test(bullet) || /\?\s*$/.test(bullet)) continue;
      // A child of a labelled heading is shown on that heading's card; only a named term of two or more words
      // ("Annulus fibrosis: outer fibrous shell") also earns a card of its own ("Hind: ..." does not).
      const label0 = (bullet.match(LABEL_RE) || bullet.match(EQUALS_RE) || [])[1] || '';
      const parallelCase = Boolean(label0 && ctx.caseLabels && ctx.caseLabels.has(bullet));
      if (ctx.grouped.has(bullet) && !(wordCount(label0) >= 2 && !needsEntity(label0)) && !parallelCase) continue;
      // "Adverse Effects None are documented ...": an aspect run into its fact is a label line without the colon.
      const inline = !LABEL_RE.test(bullet) && !EQUALS_RE.test(bullet) ? aspects().inlineAspect(bullet) : null;
      const m = bullet.match(LABEL_RE) || bullet.match(EQUALS_RE) || (inline && wordCount(inline.value) >= MIN_INLINE_VALUE_WORDS ? [bullet, inline.label, inline.value] : null);
      if (!m || !(hasLetters(m[2]) || /\d/.test(m[2]))) continue;
      const label = tidy(m[1]);
      // "Inflammation of the grey matter encephalitis: Inflammation of ...": the next column's label ends the value.
      const value = tidy(m[2]).replace(/\s+[A-Za-z-]+:\s.*$/, '');
      const numberedKind = NUMBERED_KIND_RE.test(label);
      if ((!numberedKind && stemNoise().isLabelTerm(label)) || /^(?:https?|www)$/i.test(label) || CAPTION_RE.test(label) || CAPTION_NOTE_RE.test(value)) continue;
      // ("Streptococcus pneumonia Klebsiella spp: Guarded prognosis": two names of a list read across its columns,
      // so the value may belong to either.)
      if (DISCOURSE_LABEL_RE.test(label) || shapes().fusedNames(label)) continue;
      if (!quality().readable(value) || !quality().readable(label) || GLUED_LABEL_RE.test(value)) continue;
      if (/!\s*$/.test(value) && wordCount(value) <= 3) continue; // "Before any surgical procedure: Anesthesia!" is a cheer
      // "Urine collection: zoonotic": one lower-case word is a note on the line, not an answer to it.
      if (/^[a-z][a-z-]+$/.test(value)) continue;
      // A lower-case shorthand "increased time in the GI = increased absorption" is an internal note, not a standalone label.
      if (/^[a-z]/.test(label) && wordCount(label) >= 3 && EQUALS_RE.test(bullet)) continue;
      if (needsEntity(label) || ROUTE_TERM_RE.test(label) || definingWords(value) < MIN_DEFINING_WORDS) {
        // The line belongs to what its outline parent names ("Treatment: ..." under "Purpura hemorrhagica: ...")
        // and keeps what a lead-in said of it ("KNOW TOXIC DOSES!" over "Goats: 4-5 mg/kg").
        const owner = parentName(slide, bullet) || ctx.entity;
        const qualifier = slide.qualifiers && slide.qualifiers.get ? slide.qualifiers.get(bullet) : '';
        const named = qualifier ? `${owner} (${qualifier})` : owner;
        if (owner) out.push({ front: `${named} — ${label}`, back: value, category: 'Slide Fact', kind: 'concept', subject: owner === ctx.entity ? ctx.subject : owner });
      } else if ((numberedKind || (gates.isValidTerm(label) && quality().goodFront(label))) && value.length >= 10 && !/!\s*$/.test(value) && !NON_DEF_NOTE_RE.test(value)) {
        out.push({ front: label, back: value, category: 'Slide Term', kind: 'concept', subject: label });
      }
    }
    return out;
  }

  function dashAndArrowCards(slide, ctx, gates) {
    const { LABEL_RE, EQUALS_RE, DASH_RE, needsEntity } = shapes();
    const out = [];
    for (const bullet of slide.bullets) {
      if (CLOCK_RE.test(bullet) || LABEL_RE.test(bullet) || EQUALS_RE.test(bullet) || /\?\s*$/.test(bullet)) continue;
      const parsed = notes().parseLine(bullet);
      if (parsed && parsed.type === 'arrow') {
        const meaty = parsed.parts.some((p) => wordCount(p) >= 3);
        if (meaty && ctx.entity) out.push({ front: `${ctx.entity}: ${parsed.parts[0]} → ?`, back: parsed.parts.slice(1).join(' → '), category: 'Cause and Effect', kind: 'concept', subject: ctx.subject });
        continue;
      }
      const m = bullet.match(DASH_RE);
      const value = m ? tidy(m[2] || m[3]) : '';
      // A slide definition starts in lower case ("infection involving the lung"); judge it as a sentence would read.
      const definition = value ? value[0].toUpperCase() + value.slice(1) : '';
      if (!m || needsEntity(m[1]) || !gates.isValidTerm(m[1]) || !quality().goodFront(m[1]) || stemNoise().isUnusableSentence(definition)) continue;
      const { definingWords } = shapes();
      if (definingWords(value) < MIN_DEFINING_WORDS) continue;
      // One word glued to its hyphen on a slide about something, followed by a name or a number rather than a
      // lower-case definition ("Live- Brand X, two doses 2 weeks apart"), is a kind of that thing; "Allele - one
      // version of a gene" and "Allele – One version of a gene" are a term and its definition.
      // "Renal disease – protein losing nephropathy" on a Borrelia slide is a form the disease takes, not what
      // renal disease means: a term that ends in a general head noun is asked under the slide's subject.
      const general = ctx.entity && GENERAL_HEAD_RE.test(tidy(m[1]));
      if ((wordCount(m[1]) === 1 && ctx.entity && m[3] && !/^[a-z]/.test(value)) || general) {
        out.push({ front: `${ctx.entity} — ${tidy(m[1])}`, back: value, category: 'Slide Fact', kind: 'concept', subject: ctx.subject });
        continue;
      }
      // "Fungal spherules – large, marked size variation": a run of attributes (a word and a comma) describes the
      // thing on the slide's picture; it is not what the term means. Route words ("Live", "Killed Intramuscular")
      // and dosing notes are not standalone terms either once unqualified by a parent slide entity.
      if (ATTRIBUTE_RUN_RE.test(value) || ROUTE_TERM_RE.test(tidy(m[1])) || NON_DEF_NOTE_RE.test(value)) continue;
      out.push({ front: tidy(m[1]), back: definition, category: 'Slide Term', kind: 'concept', subject: tidy(m[1]) });
    }
    return out;
  }

  /**
   * A bullet with deeper bullets under it: the bullet is the question, its children the answer. When every
   * child is itself a small heading ("Non-infectious" / "Infectious", each over a line or two) the card shows
   * the two levels together and the children get no cards of their own.
   */
  function groupCards(slide, ctx) {
    const { goodHead, goodItems, needsEntity } = shapes();
    const out = [];
    const groups = slide.groups || [];
    const folded = new Set();
    const { entity } = ctx;
    groups.forEach((group, index) => {
      const head = tidy(group.head).replace(/:$/, '');
      const items = group.items;
      if (folded.has(index) || !goodHead(group.head, items.length, items) || !goodItems(head, items)) return;
      // A lone child that heads lines of its own is the next point of the slide, not this heading's answer.
      // ("Anesthesia" over "Regional intravenous anesthesia" is still an aspect and its answer, shown with the
      // lines under it.)
      if (items.length === 1 && !needsEntity(head) && groups.some((g, k) => k !== index && g.head === items[0] && g.items.length > 1)) return;
      if (!entity && wordCount(head) < 2) return;
      // Children that head lines of their own are shown with those lines ("Small Animals: 1° renal ..."), so a
      // card never keeps only the sub-headings; children without lines of their own are shown as they are.
      const children = items.map((item) => groups.findIndex((g, k) => k > index && !folded.has(k) && g.head === item));
      const usable = (k) => k >= 0 && goodItems(groups[k].head, groups[k].items) && groups[k].items.length <= MAX_FOLDED_ITEMS;
      const heads = children.filter((k) => k >= 0);
      const small = heads.length > 0 && heads.every(usable);
      const twoLevels = small
        ? items.map((item, i) => (children[i] >= 0 ? `${item.replace(/:$/, '')}: ${joinItems(groups[children[i]].items)}` : item))
        : [];
      const lone = items.length === 1 && needsEntity(head);
      const fold = small && (items.length >= 2 || lone) && twoLevels.join(' ').length <= MAX_FOLDED_CHARS;
      if (fold) children.forEach((k) => folded.add(k));
      const shown = fold ? twoLevels : items;
      // Lines a lead-in qualified ("KNOW TOXIC DOSES!") keep that word on the card that lists them.
      const quals = new Set(items.map((x) => (slide.qualifiers && slide.qualifiers.get ? slide.qualifiers.get(x) : '') || ''));
      const qualified = quals.size === 1 && [...quals][0] ? `${head} (${[...quals][0]})` : head;
      const named = !entity || sameText(head, entity) ? qualified : `${entity} — ${qualified}`;
      // "Types of hosts" over two bullets asks for a count: "What are the 2 types of hosts?"
      const counted = `What are the ${items.length} ${head[0].toLowerCase()}${head.slice(1)}?`;
      const asksCount = LIST_TITLE_RE.test(head) && items.length >= 2;
      out.push({
        front: asksCount ? (entity ? `${entity}: ${counted}` : counted) : named,
        back: shown.length === 1 ? shown[0] : bulletList(shown),
        category: 'Slide Fact',
        kind: shown.length === 1 ? 'concept' : 'overview',
        subject: ctx.subject || (needsEntity(head) ? '' : head),
      });
    });
    return out;
  }

  /**
   * Numbered steps of one process ("1. Wound is contaminated ..." to "8. Virus shed in saliva", put in order by
   * slide-lines.js) are one card, whatever else the slide holds: the run 1..n with no gap and no broken line.
   */
  function stepsCard(slide, ctx) {
    const steps = [];
    for (const b of slide.bullets) {
      const m = b.match(/^(\d{1,2})\.\s+(\S.*)$/);
      if (m && Number(m[1]) === steps.length + 1) steps.push(b);
    }
    if (!ctx.entity || steps.length < MIN_STEP_RUN || steps.length > MAX_STEPS || steps.some((s) => shapes().isDebris(s.replace(/^\d+\.\s+/, '')))) return [];
    return [{ front: `What are the steps of "${ctx.entity}", in order?`, back: bulletList(steps), category: 'Slide Overview', kind: 'overview', subject: ctx.subject }];
  }
  const MIN_STEP_RUN = 4;

  /** Last resort for a plain slide: its title asks, its bullets answer. `proseRatio` comes from slide-model. */
  function listCard(slide, entity, proseRatio) {
    const { CAPTION_RE, GLUED_WORDS_RE, MAX_ITEMS, MAX_ITEM_CHARS, isDebris } = shapes();
    const isPoint = (b) => proseRatio(b) >= 0.4 && wordCount(b) >= 2 && !CLOCK_RE.test(b) && b.length <= MAX_ITEM_CHARS &&
      !CAPTION_RE.test(b) && !isDebris(b);
    // One run-together line marks the slide as overwritten by recognised handwriting: its list is not trusted.
    if (slide.bullets.some((b) => GLUED_WORDS_RE.test(b))) return [];
    const found = slide.bullets.filter(isPoint);
    // Numbered steps of one process ("1. Wound is contaminated ..." to "8. Virus shed in saliva") are one answer.
    const stepped = found.length >= 3 && found.every((p) => /^\d{1,2}\.\s/.test(p));
    const most = stepped ? MAX_STEPS : MAX_ITEMS;
    if (!entity || slide.bullets.length > Math.max(8, most) || !found.length || found.length > most) return [];
    if (found.length * 2 < slide.bullets.length) return []; // mostly labels, numbers or debris: nothing to list
    // "Proximal Paravertebral" / "Distal Paravertebral": the labels of a diagram name its parts and say nothing;
    // beside statements they are a legend ("Fox and Skunk" over a map), and only the statements are listed.
    const named = (p) => shapes().isNameOnly(p.replace(/\s+[A-Z]{4,}$/, ''));
    if (found.every(named)) return [];
    const stated = found.filter((p) => wordCount(p) >= 5);
    // ("Arctic fox" beside "Bats pose the biggest risk in the US": a map's label, two words among a slide of
    // statements, is not a point. Short lines on a slide of short lines, "Loosen tourniquet", are its points.)
    const mostlyStated = stated.length * 2 > found.length;
    const label = (p) => named(p) || (mostlyStated && wordCount(p) <= 2 && /^[A-Z]/.test(p) && !/[\d:;,]/.test(p));
    const points = stated.length >= 2 ? found.filter((p) => !label(p)) : found;
    const subject = slide.subject || entity;
    if (points.length === 1) {
      // "Types of inflammation" -> "Type of inflammation can help hint at the cause" mostly repeats the title.
      const stems = (s) => tidy(s).toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z]/g, '').replace(/s$/, ''));
      const repeats = stems(points[0]).slice(0, stems(entity).length).join(' ') === stems(entity).join(' ');
      return wordCount(points[0]) >= 5 && !repeats ? [{ front: entity, back: points[0], category: 'Slide Fact', kind: 'concept', subject }] : [];
    }
    const front = stepped ? `What are the steps of "${entity}", in order?`
      : LIST_TITLE_RE.test(entity) ? `What are the ${entity[0].toLowerCase()}${entity.slice(1)}?` : `What are the key points of "${entity}"?`;
    return [{ front, back: bulletList(points), category: 'Slide Overview', kind: 'overview', subject }];
  }

  /** The prefix and subject a slide's cards use: the slide model's entity, or the title read the older way. */
  function slideEntity(slide, gates) {
    if (slide.entity !== undefined) return { entity: slide.entity || '', subject: slide.subject || '' };
    const unusable = gates.isNoise(slide.title) || stemNoise().isLabelTerm(slide.title) || wordCount(slide.title) > 12;
    const entity = unusable ? '' : entityOf(slide.title);
    return { entity, subject: entity };
  }

  /** Structured cards of one slide; the plain list card is offered separately so the caller can hold it back. */
  function build(slide, gates) {
    const { entity, subject } = slideEntity(slide, gates);
    // Outline groups first, then flat "aspect line + facts" groups for the lines no outline heading owns.
    const owned = new Set((slide.groups || []).flatMap((g) => [g.head, ...g.items]));
    const flat = aspects().flatGroups(slide.outline).filter((g) => !owned.has(g.head));
    // An aspect line ("Adverse Effects") heads the outline groups inside it ("Albendazole:" over its lines), so it
    // is read first and can show those groups on its own card.
    const withFlat = { ...slide, groups: [...flat, ...(slide.groups || [])] };
    // Lines shown as the children of a labelled heading belong to that heading's card, not to cards of their own.
    const grouped = new Set(withFlat.groups.filter((g) => shapes().goodHead(g.head, g.items.length, g.items)).flatMap((g) => g.items));
    // Parallel "Species: value" cases inside a grouped aspect heading ("Indications (labeled)" > "Dogs: ...", "Cats: ...")
    // earn individual case cards when at least two siblings carry short "Label: value" pairs.
    const caseLabels = new Set();
    const qs = dep('quizSubjects', './quiz-subjects.js');
    for (const g of withFlat.groups) {
      if (!shapes().goodHead(g.head, g.items.length, g.items)) continue;
      const headName = tidy(g.head).replace(/:$/, '');
      if (!(qs ? qs.isGenericHeading(headName, {}) : shapes().needsEntity(headName))) continue;
      const pairs = g.items.filter((it) => shapes().LABEL_RE.test(it));
      if (pairs.length >= 2) pairs.forEach((it) => caseLabels.add(it));
    }
    const ctx = { entity, subject: subject || entity, grouped, caseLabels };
    const tables = dep('tableCards', './table-cards.js');
    const cards = slide.kind === 'table'
      ? tables.rowCards(slide.table, { subject: ctx.subject, ambiguous: gates.ambiguous })
      : [...stepsCard(slide, ctx), ...labelCards(slide, ctx, gates), ...dashAndArrowCards(slide, ctx, gates), ...groupCards(withFlat, ctx)];
    return cards.filter((c) => quality().goodBack(c.back, c.front));
  }

  const api = { build, listCard, entityOf, isLabelHead: (head, items) => shapes().isLabelHead(head, items) };
  PDFStudy.slideStructure = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

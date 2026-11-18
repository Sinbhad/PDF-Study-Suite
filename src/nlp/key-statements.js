/**
 * Key Statements: textbook prose that teaches facts without naming terms ("In Java, the elements of an array
 * are numbered starting at 0.") yields no definition card. This picks, per section, the sentences that carry the
 * section's subject or the author's emphasis and that stand alone, and asks each as a completion card:
 *   "Arrays suffer from a significant limitation: their length is …"  =>  "fixed"
 * A sentence qualifies only when it is self-contained (no "this", "it", "you", figure or example pointers, no
 * leading connective), states a present-tense fact, and either contains a bold term or a content word of its
 * section heading. Each section gives at most MAX_PER_SECTION cards, the scope at most MAX_TOTAL (more for a long
 * scope: one per WORDS_PER_TOTAL words, up to MAX_LONG_TOTAL).
 * extract(text, { taken }) -> [{ front, back, category: 'Key Statement', kind: 'concept', subject, topic, sourceKind }]
 *   taken: Set of lower-cased sentences already used as a card back (they are not asked twice).
 * subjectOf(front) -> the noun phrase a completion card is about ("The if statement is …" -> "if statement"), or ''
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_WORDS = 6;
  const MAX_WORDS = 32;
  const MAX_PER_SECTION = 2;
  const MAX_TOTAL = 12;
  const WORDS_PER_TOTAL = 450;
  const MAX_LONG_TOTAL = 20;
  const MIN_SCORE = 2;
  const BOLD_SCORE = 3;
  const HEADING_WORD_SCORE = 2;
  // Present-tense statement verbs, where a completion card splits the sentence ("... are | numbered from 0").
  const SPLIT_VERB_RE =
    /\s(is|are|can(?:not)?|must|need\s+to|have\s+to|should|does\s+not|do\s+not|has|have|yields?|returns?|contains?|refers?\s+to|holds?|stores?|means|consists?\s+of|requires?|uses?|causes?|produces?|determines?|depends\s+on|compares?|tests?|evaluates?|executes?|gives?|represents?|becomes?|remains?|stays?|directs?|deals?\s+with|states\s+that|occurs?|appears?|includes?)\s/i;
  // Heading words too general to tie a sentence to its section.
  const GENERIC_HEADING_WORDS = new Set(['introduction', 'using', 'use', 'common', 'basic', 'basics', 'more', 'other', 'some', 'overview',
    'summary', 'review', 'example', 'examples', 'working', 'with', 'about', 'advanced', 'simple', 'general', 'special', 'topics', 'part']);
  const NARRATIVE_RE = /\b(?:was|were|had|did)\b|\b1[5-9]\d\d\b|\b20[0-2]\d\b/;
  const CODE_RE = /[;{}]|\b\w+\(\)|\w\[\w*\]|==|!=|<=|>=|&&|\|\|/;
  // Openers that continue or qualify the sentence before ("Instead, ...", "Both object variables ...", "There are").
  const LEANING_START_RE =
    /^(?:instead|conversely|in\s+particular|but|and|or|so|as\s+a\s+consequence|in\s+contrast|otherwise|still|yet|indeed|in\s+fact|of\s+course|both|either|neither|each\s+of|all\s+of|another|the\s+other|the\s+same|there\s+(?:is|are)|here|the\s+(?:two|three|next|last|first|second|third|fourth|previous|following|situation|result|answer|problem|reason|idea|remaining|usual|main|key|only|best|simplest|remedy|solution|trick|fix|catch))\b/i;
  // Words that tie a sentence to its neighbours or to an example on the page.
  const LEANING_WORD_RE =
    /\balso\b|\bin\s+both\b|\b(?:thus|so)\s+far\b|\b[a-z]+s\s+\d+\s+(?:and|or|through|to)\s+\d+\b|\bthe\s+[a-z]+\s+(?:variable|array|object|list)\b|\b(?:if|when)\s+[a-z]+\s+(?:is|equals)\s+-?\d|\b(?:above|below|earlier|previously)\b|\b(?:presented|discussed|shown|covered|described)\s+(?:next|later)\b|\b(?:sentences?|items?|parts?|cases?|steps?|rows?|columns?|lines?|statements?)\s+\d|\w-\s+\w/i;
  // Three capitalised words run into lower case mid-sentence: a heading glued into the text.
  const GLUED_HEADING_RE = /\s(?:[A-Z][a-z]+\s+){3,}[a-z]/;
  // A completion whose answer is a judgement ("a good idea", "particularly important") tests no fact.
  // ("has … become intrinsic to the design process": a trend remark, not a fact either.)
  const JUDGEMENT_TAIL_RE =
    /^(?:become\s+|been\s+|grown\s+)?(?:an?\s+)?(?:very\s+|particularly\s+|extremely\s+|quite\s+|really\s+|increasingly\s+)?(?:good|bad|great|nice|useful|important|helpful|essential|critical|crucial|esoteric|interesting|obvious|easy|hard|difficult|advantages|benefits|drawbacks|pros|intrinsic|integral|indispensable|vital|central|popular|widespread|ubiquitous|prevalent|standard)\b/i;
  // Sections that are not exposition: worked examples, program output, objectives, boxed tips and asides.
  const SKIPPED_SECTION_RE =
    /^(?:examples?|program\s+run|summary|review|exercises|problems|self\s+check|common\s+error|programming\s+tip|special\s+topic|how\s+to|worked\s+example|computing\s*&\s*society|historical\s+notes?|by\s+the\s+way|key\s+terms)\b/i;
  // A chapter's objectives head the whole text when it has no other headings, so they are judged per sentence:
  // "To understand ...", "To learn how to ..." is a goal, not a fact.
  // ("To compare objects, you need to use equals" has a main clause after its comma and is a rule, not a goal.)
  const OBJECTIVE_SENTENCE_RE = /^To\s+[a-z]+\b(?![^,]*,\s)/;
  // The author talking about the book or the reader, except a rule put to the reader ("you need to use ...").
  const READER_RE = /\b(?:we|our|ours|us|your|yours|let'?s)\b|\byou\b(?!\s+(?:need\s+to|must|should|can|cannot|can’t|can't|have\s+to)\b)/i;
  // Definitions are mined elsewhere: a naming sentence is not asked again as a completion.
  const NAMING_RE = /\b(?:called|known\s+as|referred\s+to\s+as|termed|denoted|defined\s+as|said\s+to\s+be)\b/i;
  const SUBORDINATE_START_RE = /^(?:if|when|whenever|unless|although|though|while|because|since|before|after|once|to)\b/i;
  const RELATIVE_RE = /\b(?:that|which|who|whose|whom|where)\b/i;
  const MAX_FRONT_WORDS = 12;
  const PARTICIPLE_RE = /^(?:[a-z]+ed|found|done|made|given|taken|known|shown|seen|held|kept|met|set|run|built|written|chosen)$/i;
  const QUANTIFIED_SUBJECT_RE = /^(?:some|many|most|several|few|certain|various)\s/i;
  // "The <noun> <verb>": one common noun with the definite article and nothing to say which one is meant.
  const BARE_SUBJECT_RE = /^the\s+[a-z]+\s+\S+$/i;
  const GLUED_LABEL_RE = /^[A-Z][a-z]+\s+(?:You|We|The|A|An|It|This|If)\s/;
  const MIN_TAKEN_CHARS = 20;
  // A real section heading: numbered ("7.1.4 Partially Filled Arrays", "2-1 Binary Logic") or a boxed title,
  // never a running page header ("CHAPTER 2 / Combinational ...") or a formula set alone ("SKU S Price").
  const RUNNING_HEADER_RE = /\s\/\s|\b[A-Z]\b(?![.:])|[(),=]/;
  // A sentence whose subject is a named concept ("Sensory memory holds ...", "Procedural memory, such as ...,
  // is ...") states a fact about that concept even when no heading or emphasis points at it.
  const CONCEPT_SUBJECT_RE = /^(?:The\s+)?(?:[A-Z][a-z-]+|[a-z-]+)(?:\s+[a-z-]+){1,3}(?:,\s[^,]{3,60},)?\s+(?:is|are|can|has|have|holds|directs|deals|states|occurs|means|refers|consists|contains|produces|appears|includes|requires|uses|represents)\b/;
  const CONCEPT_SCORE = 2;
  const WORDS_PER_STATEMENT = 100;
  const MAX_PER_LONG_SECTION = 6;
  // Headings that name the chapter's goals, not a subject a statement could be about.
  const NON_SUBJECT_HEADING_RE = /^(?:chapter\s+|learning\s+)?(?:objectives|goals|outcomes|introduction|overview)$/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const stem = (w) => w.toLowerCase().replace(/(?:ies|es|s|ing|ed)$/, '');
  const words = (s) => plain(s).split(/\s+/).filter(Boolean);

  /** "7.1.4 Partially Filled Arrays" -> ["partially", "filled", "array"] stems of the heading's content words. */
  function headingStems(heading) {
    const stop = dep('tokenizer', './tokenizer.js').STOPWORDS;
    return plain(heading).replace(/^[\d.]+\s+/, '').toLowerCase().split(/[^a-z-]+/)
      .filter((w) => w.length >= 3 && !stop.has(w) && !GENERIC_HEADING_WORDS.has(w)).map(stem);
  }

  /** Sections of the text: [{ heading, body }] split at heading lines. */
  function sections(text) {
    const tok = dep('tokenizer', './tokenizer.js');
    const out = [{ heading: '', lines: [] }];
    for (const line of String(text || '').split('\n')) {
      const heading = plain(line).replace(/^\d+(?:[.-]\d+)*\.?\s+/, '');
      if (!tok.isHeadingLine(line)) out[out.length - 1].lines.push(line);
      // A running header or formula line is skipped; the section it interrupts keeps its own heading.
      else if (!RUNNING_HEADER_RE.test(heading) && /[a-z]{3}/.test(heading) && !/\s(?:is|are|must|can|will|has|have)\s/.test(heading)) {
        out.push({ heading, lines: [] });
      }
    }
    return out.filter((s) => s.lines.length).map((s) => ({ heading: s.heading, body: s.lines.join('\n') }));
  }

  /** A sentence that can be shown alone and states a fact. */
  function standsAlone(sentence) {
    const t = plain(sentence);
    const n = words(t).length;
    if (n < MIN_WORDS || n > MAX_WORDS || /\?\s*$/.test(t) || !/[.!]$/.test(t) || !/^[A-Z]/.test(t)) return false;
    if (CODE_RE.test(t) || NARRATIVE_RE.test(t) || (t.match(/\$/g) || []).length > 2) return false;
    if (LEANING_START_RE.test(t) || LEANING_WORD_RE.test(t) || NAMING_RE.test(t) || GLUED_HEADING_RE.test(t) || OBJECTIVE_SENTENCE_RE.test(t)) return false;
    const sn = dep('stemNoise', './stem-noise.js');
    const sc = dep('selfContained', './self-contained.js');
    if (sn.isUnusableSentence(t) || sn.hasUnresolvedReference(t)) return false;
    if (READER_RE.test(t) || sc.unresolvedBack(t) || sc.praiseBack(t)) return false;
    return SPLIT_VERB_RE.test(` ${t} `);
  }

  /** "X are numbered starting at 0." -> { front: "X are …", back: "numbered starting at 0" } split at the first verb. */
  /**
   * The split verb is the main clause's: after the comma of a leading "If / When ..." clause, and never inside
   * a relative clause of the subject ("an element whose index is ..." is still the subject).
   */
  function completion(sentence) {
    const t = plain(sentence).replace(/[.!]$/, '');
    const start = SUBORDINATE_START_RE.test(t) ? t.indexOf(', ') + 2 : 0;
    if (start === 1) return null; // "If ..." with no comma: no main clause to split
    const re = new RegExp(SPLIT_VERB_RE.source, 'gi');
    const padded = ` ${t} `;
    for (const m of padded.matchAll(re)) {
      if (m.index < start) continue;
      const cut = m.index + m[0].length - 1; // index in t of the character after the verb
      const head = t.slice(0, cut).trim();
      const tail = t.slice(cut).trim();
      if (RELATIVE_RE.test(head.slice(start))) continue;
      if (/^(?:they|it|this|these|those|he|she)\b/i.test(head.slice(start))) return null; // "..., they are …": who?
      if (start === 0 && /^(?:you|we)\s/i.test(head)) return null; // "You have to …" names nothing to be asked about
      // "Formulate two test cases": a verb-looking word after a number or an article is a noun of the subject.
      if (/\b(?:a|an|the|two|three|four|each|every|one|this|that)$/i.test(head.replace(/\s+\S+$/, ''))) continue;
      // A one-word passive answer ("is … executed", "is … found") tests the end of a sentence, not a fact;
      // a one-word adjective ("unimportant", "fixed") is the fact.
      const participle = words(tail).length === 1 && PARTICIPLE_RE.test(tail);
      if (words(head).length < 3 || words(head).length > MAX_FRONT_WORDS || !tail || (words(tail).length < 2 && tail.length < 4) || participle) return null;
      // A sentence that opens with a bare preposition and no comma ("In statements can be ...") lost its start.
      if (/^(?:in|on|at|for|with|by|from|of)\s/i.test(head) && !head.includes(',')) return null;
      if (JUDGEMENT_TAIL_RE.test(tail)) return null;
      // "Most editors have …", "Many important structures are …": a hedged generalisation, not a fact to recall.
      // "The output is …", "The window is …": a bare noun the page around it pinned down (which output?).
      // "Error You cannot …": a table label glued in front of the sentence.
      const subject = head.slice(start);
      if (QUANTIFIED_SUBJECT_RE.test(subject) || BARE_SUBJECT_RE.test(subject) || GLUED_LABEL_RE.test(head)) return null;
      return shaped(head, tail, start);
    }
    return null;
  }

  // "Sometimes the roster method is …", "Perhaps the most common …": a hedged remark, not a fact to recall.
  const HEDGE_START_RE = /^(?:sometimes|often|usually|generally|typically|occasionally|perhaps|probably)\b/i;
  // "a different structure is …", "another way is …": a subject that only points at something unnamed.
  // ("Each column has …", "Every if contains …": one bare noun after each/every names no kind of thing.)
  const VAGUE_SUBJECT_RE = /^(?:a|an|the)\s+(?:different|other|new|separate|similar|same|certain|particular)\b|^(?:each|every)\s+\S+\s+\S+$/i;
  // "Sets may have …": a bare subject and a modal leave the predicate open; anything could follow.
  const OPEN_MODAL_FRONT_RE = /^\S+\s+(?:may|might|can)(?:\s+\S+)?$/i;
  // "Every if statement contains … a condition", "Each slot contains … an element": one noun after an article.
  const TRIVIAL_BACK_RE = /^(?:a|an|the|some|one)\s+[\w-]+$/i;
  // A one-word answer is a fact only when it is a quality or a number ("fixed", "immutable", "zero").
  const ADJECTIVE_RE = /(?:ed|able|ible|al|ive|ous|ic|ent|ant|ful|less|ary|ory|ile|ar)$|^(?:zero|one|two|three|four|true|false|null|empty)$/i;
  // "is … used to implement a decision": the participle belongs to the question, the purpose is the answer.
  const PARTICIPLE_LEAD_RE = /^((?:usually|often|typically|generally|commonly|always|only)\s+)?((?:[a-z]+ed|known|done|made|given|taken|shown|seen|held|kept|built|written|chosen)\s+(?:to|for|as|in|by|with|from|on|at|into))\s+(\S.*)$/i;
  // "the variable element", "the parameter x": a name from the example program on the page.
  const EXAMPLE_NAME_RE = /\bthe\s+(?:variable|parameter|field)\s+[a-z_]\w*\b|\bthe\s+(?:array|list|string|object)\s+[a-z_]\w*$/i;
  const TAUTOLOGY_SHARE = 0.6;
  // The split fell inside a clause that is still open: "In a flip-flop, before an output can | change, ...".
  const OPEN_SUBORDINATE_RE = /\b(?:before|after|when|whenever|if|unless|until|while|because|since|once|although)\b[^,]*$/i;

  /**
   * The finished card of a split, or null when it is no card worth studying: the back stops at the sentence's end,
   * names more than one noun, says more than the front already says, and names nothing only the example knows.
   */
  function shaped(head, tail, start) {
    const subject = head.slice(start);
    if (start === 0 && OPEN_SUBORDINATE_RE.test(subject.replace(/^[^,]*,\s*/, ''))) return null;
    if (HEDGE_START_RE.test(head) || VAGUE_SUBJECT_RE.test(subject) || OPEN_MODAL_FRONT_RE.test(subject.trim())) return null;
    // A back runs to its own sentence's end only: "values. The == operator tests ..." is two notes, not one answer.
    let back = tail.split(/(?<=[a-z0-9)\]])[.!?]\s+(?=[A-Z$])/)[0].trim();
    let front = head;
    const lead = back.match(PARTICIPLE_LEAD_RE);
    if (lead && words(lead[3]).length >= 2) {
      front = `${head} ${(lead[1] || '')}${lead[2]}`.replace(/\s+/g, ' ');
      back = lead[3];
    }
    if (TRIVIAL_BACK_RE.test(back) || (words(back).length === 1 && !ADJECTIVE_RE.test(back))) return null;
    if (EXAMPLE_NAME_RE.test(`${front} ${back}`)) return null;
    const stop = dep('tokenizer', './tokenizer.js').STOPWORDS;
    const content = (s) => words(s).map((w) => w.replace(/[^A-Za-z-]/g, '').toLowerCase()).filter((w) => w.length >= 3 && !stop.has(w)).map(stem);
    const own = new Set(content(front));
    const said = content(back);
    if (said.length >= 2 && said.filter((w) => own.has(w)).length / said.length >= TAUTOLOGY_SHARE) return null;
    return { front: `${front} …`, back };
  }

  /** "In general, a key is …" -> "Key": the noun phrase before the verb, without lead-in, article or verb. */
  function subjectOf(front) {
    const head = plain(front).replace(/\s*…$/, '').replace(/^[^,]{2,30},\s+/, '');
    const m = ` ${head} `.match(SPLIT_VERB_RE);
    const np = (m ? head.slice(0, Math.max(0, m.index - 1)) : head).replace(/^(?:the|an?)\s+/i, '').trim();
    return np ? np[0].toUpperCase() + np.slice(1) : '';
  }

  function extract(text, opts = {}) {
    const tok = dep('tokenizer', './tokenizer.js');
    const taken = opts.taken || new Set();
    const out = [];
    for (const section of sections(text)) {
      if (SKIPPED_SECTION_RE.test(section.heading)) continue;
      const stems = new Set(headingStems(section.heading));
      const scored = [];
      tok.splitSentences(section.body).forEach((raw, order) => {
        // "(see Syntax 5.1)" asides and a heading glued in front ("Primary Keys When designing ...") are dropped.
        const unglued = dep('proseDefinitions', './prose-definitions.js').dropGluedHeading(plain(raw));
        const t = dep('cardQuality', './card-quality.js').withoutAsides(unglued);
        // Not asked twice: a sentence that already is, or contains, another card's answer is skipped.
        const low = t.toLowerCase();
        // (A rule card that quotes this sentence among others has asked it too.)
        const bare = low.replace(/[.!]$/, '');
        const asked = [...taken].some((b) => (b.length >= MIN_TAKEN_CHARS && low.includes(b.replace(/[.!]$/, ''))) || (bare.length >= MIN_TAKEN_CHARS && b.includes(bare)));
        if (taken.has(low) || asked || !standsAlone(t)) return;
        const bold = /\*\*[^*]{3,}\*\*/.test(raw);
        const overlap = new Set(words(t).map((w) => stem(w.replace(/[^A-Za-z-]/g, ''))).filter((w) => stems.has(w))).size;
        const concept = CONCEPT_SUBJECT_RE.test(t) && !/^(?:The\s+)?(?:it|this|that|these|those|they|we|you)\b/i.test(t);
        const score = (bold ? BOLD_SCORE : 0) + overlap * HEADING_WORD_SCORE + (concept ? CONCEPT_SCORE : 0);
        if (score >= MIN_SCORE) scored.push({ t, score, order });
      });
      scored.sort((a, b) => b.score - a.score || a.order - b.order);
      // A long section may give a few more statements than a short one: one per WORDS_PER_STATEMENT words.
      const allowed = Math.min(MAX_PER_LONG_SECTION, Math.max(MAX_PER_SECTION, Math.floor(words(section.body).length / WORDS_PER_STATEMENT)));
      for (const { t } of scored.slice(0, allowed)) {
        const card = completion(t);
        if (!card) continue;
        // The section heading, or the sentence's own subject when the text has no usable heading.
        const subject = section.heading && !NON_SUBJECT_HEADING_RE.test(section.heading) ? section.heading : subjectOf(card.front);
        out.push({ ...card, category: 'Key Statement', kind: 'concept', subject, topic: subject, sourceKind: 'key-concept', sentence: t });
      }
    }
    return out.slice(0, Math.min(MAX_LONG_TOTAL, Math.max(MAX_TOTAL, Math.round(words(text).length / WORDS_PER_TOTAL))));
  }

  // Words between the subject and the split verb, and determiners in front of it, that are no part of the subject.
  const SUBJECT_TAIL_RE = /\s+(?:even|also|often|usually|always|never|only|not|simply|still|can(?:not)?|must|should|need\s+to|have\s+to|does|do)$/i;
  const SUBJECT_DETERMINER_RE = /^(?:the|a|an|every|each|any|all|most|some|many|two)\s+/i;
  const MAX_SUBJECT_WORDS = 4;

  /**
   * The noun phrase a completion card is about: its front up to the split verb, after a leading clause's comma,
   * without determiners or adverbs. '' for a pronoun, a clause, or anything longer than MAX_SUBJECT_WORDS words.
   */
  function subjectOf(front) {
    let head = plain(front).replace(/\s*…$/, '');
    if (SUBORDINATE_START_RE.test(head)) head = head.includes(', ') ? head.slice(head.indexOf(', ') + 2) : '';
    if (!/\s/.test(head)) return ''; // "..., test …": an instruction, no subject before the verb
    head = head.replace(/\s+\S+$/, ''); // the split verb itself
    for (let prev = ''; prev !== head;) {
      prev = head;
      head = head.replace(SUBJECT_TAIL_RE, '');
    }
    const subject = head.replace(SUBJECT_DETERMINER_RE, '').trim();
    const n = words(subject).length;
    if (!n || n > MAX_SUBJECT_WORDS || /,|\b(?:it|they|this|these|that|those|he|she|you|we)\b/i.test(subject)) return '';
    return subject;
  }

  const api = { extract, completion, standsAlone, subjectOf };
  PDFStudy.keyStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

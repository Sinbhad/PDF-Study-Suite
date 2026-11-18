/**
 * Quiz Subjects: what a fact is about, and which other subjects are the same kind of thing.
 * A question needs a real subject (a drug, a disease, a structure, a concept) and a predicate about it.
 * An organising heading ("Pharmacokinetics", "Overview", "Diagnosis") is never a subject, and neither is
 * a heading the scope repeats under several entities: such a heading only says which part of a subject's
 * story a line belongs to.
 *
 *   resolve(card, ctx)            the card's subject: its own `subject` field when the card mining set one,
 *                                 else the specific part of its front ("Clorsulon — Pharmacodynamics" ->
 *                                 "Clorsulon"), else its topic; null when only generic headings are left
 *   specificOf(heading, ctx)      the specific subject a heading names ("Treatment of strangles" ->
 *                                 "strangles"), or null for a category, generic or filler heading
 *   mergeKeys(names)              one key for subjects whose names are one inside the other
 *   isGenericHeading(text, ctx)   closed list of organising headings, or a short line ctx.repeated says the
 *                                 scope prints under several different titles
 *   repeatedHeadings(slides)      Set of normalised short lines printed under two or more slide titles
 *   subjectKey(text)              identity of a subject (case, number, trademark signs and brackets folded)
 *   typeScore(a, b)               how alike two subjects are as kinds of thing (head noun, suffix, shape)
 *   sameType(a, b)                typeScore high enough to offer one beside the other
 *   aspectWords(text)             the organising-heading words a text holds ("Clinical signs of X" -> ['signs'])
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const os = () => dep('optionSets', './option-sets.js');

  // Organising headings, general across subjects; glue words may join them ("Clinical signs and treatment").
  const GENERIC_WORDS = new Set(`overview introduction summary background review recap outline objectives objective
    pharmacokinetics pharmacodynamics absorption distribution metabolism elimination excretion indications
    contraindications toxicity dosage dose doses administration mechanism mechanisms diagnosis diagnostics
    treatment treatments therapy management prognosis prevention control pathology pathogenesis pathophysiology
    etiology aetiology epidemiology transmission signs symptoms history signalment lesions definition definitions
    example examples properties applications advantages disadvantages pros cons notes conclusion conclusions
    discussion results methods characteristics features types classification structure functions uses usage
    basics concepts effects findings exam route routes spectrum efficacy safety resistance concerns
    considerations precautions monitoring options approach workup diagnostic complications complication imaging
    supportive etiologic agents causes sequelae differentials factors risk outcome outcomes procedure procedures
    technique techniques indication landmarks anatomy vaccination vaccines immunization`.split(/\s+/).filter(Boolean));
  const GENERIC_GLUE = new Set('and of the a an in for clinical adverse side physical differential key important general main common other most helpful'.split(' '));
  // A heading about a category rather than a thing ("Types of inflammation", "Variety of ways").
  const CATEGORY_RE = /^(?:(?:a|the)\s+)?(?:types?|kinds?|class(?:es)?|forms?|categories|category|examples?|variety|number|lot|set|range|series|ways?|parts?|pieces?|list)\s+of\b/i;
  // "<generic heading> of <subject>": the subject is what follows ("Treatment of strangles" -> "strangles").
  const GENERIC_OF_RE = /^(.+?)\s+(?:of|in|for)\s+(?:the\s+)?(.+)$/i;
  // "<subject> aka <alias>" / "<subject> also called <alias>": the alias names the same subject.
  const ALIAS_RE = /\s+(?:aka|a\.k\.a\.|also\s+(?:called|known\s+as))\s+/i;
  const REPEATED_UNDER_TITLES = 2; // a short line printed under this many different titles is a heading
  const MAX_HEADING_WORDS = 6;
  const FRONT_SPLIT_RE = /\s+[—–]\s+|\s+-\s+|:\s+/;
  const MIN_TYPE_SCORE = 2;
  const MIN_FUZZY_CHARS = 8; // a misspelt generic heading is only recognised in a long word
  const MAX_FUZZY_EDITS = 2;

  const norm = (s) => String(s || '').toLowerCase().replace(/[®™©]/g, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

  function subjectKey(text) {
    return os().termKey(norm(text));
  }

  function repeatedHeadings(slides) {
    const under = new Map();
    for (const slide of slides || []) {
      const title = norm(slide && slide.title);
      for (const b of (slide && slide.bullets) || []) {
        const line = norm(b);
        if (!line || line.split(' ').length > MAX_HEADING_WORDS) continue;
        if (!under.has(line)) under.set(line, new Set());
        under.get(line).add(title);
      }
    }
    return new Set([...under].filter(([, titles]) => titles.size >= REPEATED_UNDER_TITLES).map(([line]) => line));
  }

  function isGenericHeading(text, ctx) {
    const n = norm(text).replace(/\b(?:cont(?:inued|d)?|part \d+|\d+)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return true;
    const words = n.split(' ');
    if (words.every((w) => GENERIC_WORDS.has(w) || GENERIC_GLUE.has(w))) return true;
    // A long generic word misspelt by a recogniser ("pathenogenesis") is still that word.
    if (words.length === 1 && words[0].length >= MIN_FUZZY_CHARS && [...GENERIC_WORDS].some((g) => editDistance(g, words[0]) <= MAX_FUZZY_EDITS)) return true;
    return Boolean(ctx && ctx.repeated && ctx.repeated.has(norm(text)));
  }

  /** Levenshtein distance, stopping early once it passes MAX_FUZZY_EDITS. */
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > MAX_FUZZY_EDITS) return MAX_FUZZY_EDITS + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
      if (Math.min(...row) > MAX_FUZZY_EDITS) return MAX_FUZZY_EDITS + 1;
      prev = row;
    }
    return prev[b.length];
  }

  /**
   * "Praziquantel (Droncit®, ...)" -> "Praziquantel"; "(cont.)", "(part 2)", a trailing part number,
   * an ellipsis, quotes and trailing punctuation dropped.
   */
  function tidySubject(text) {
    return String(text || '').replace(/\s*\((?:cont[^)]*|part\s*\d+|pt\.?\s*\d+|[^)]*®[^)]*)\)\s*/gi, ' ')
      .replace(/\s*[-–—,:]?\s*\b(?:part|pt\.?)\s*\d+\s*$/i, '').replace(/\s+(?:II|III|IV|\d)\s*$/, '')
      .replace(/[®™©…“”"]/g, '').replace(/\.{3,}/g, '').replace(/[.:;,\s]+$/, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * The specific subject a heading names, or null: a category or a generic heading names none;
   * "<generic> of X" names X; "X <generic words>" names X; "X aka Y" names X.
   */
  function specificOf(text, ctx) {
    // "Complications of strangles: 20%": what follows a colon is a detail, not the name.
    let t = tidySubject(String(text || '').split(ALIAS_RE)[0].split(/:\s/)[0]);
    if (!t || CATEGORY_RE.test(t)) return null;
    const of = t.match(GENERIC_OF_RE);
    if (of && isGenericHeading(of[1], ctx) && !isGenericHeading(of[2], ctx)) t = tidySubject(of[2]);
    // Generic words trailing a name: "Leptospira spp. Transmission" -> "Leptospira spp".
    const parts = t.split(/\s+/);
    while (parts.length > 1 && GENERIC_WORDS.has(norm(parts[parts.length - 1]))) parts.pop();
    t = tidySubject(parts.join(' '));
    if (!t || isGenericHeading(t, ctx) || CATEGORY_RE.test(t)) return null;
    const content = dep('quizContent', './quiz-content.js');
    return content && content.isFillerText(t) ? null : t;
  }

  /** The card's subject, or null when nothing specific is left. ctx: { repeated } */
  function resolve(card, ctx) {
    if (!card) return null;
    if (card.subject) return specificOf(card.subject, ctx);
    const parts = String(card.front || '').split(FRONT_SPLIT_RE).map((p) => specificOf(p, ctx)).filter(Boolean);
    if (parts.length) return parts[0];
    return card.topic ? specificOf(card.topic, ctx) : null;
  }

  /**
   * One key per subject of a scope: two subjects whose words are one inside the other ("Leptospira spp"
   * and "Leptospira spp small animals", "strangles" and "streptococcus equi equi aka strangles") are
   * treated as one, so a statement about one is never offered as false of the other. Conservative on
   * purpose: "pneumonia" and "aspiration pneumonia" merge too, which costs a question, never a key.
   * names: [subject text] -> Map(subjectKey -> shared key)
   */
  function mergeKeys(names) {
    const variants = (name) => String(name || '').split(ALIAS_RE).map(subjectKey).filter(Boolean);
    const entries = [...new Set((names || []).filter(Boolean))].map((name) => ({ key: subjectKey(name), forms: variants(name) }));
    const parent = new Map(entries.map((e) => [e.key, e.key]));
    const find = (k) => (parent.get(k) === k ? k : find(parent.get(k)));
    const inside = (a, b) => ` ${b} `.includes(` ${a} `);
    for (const a of entries) {
      for (const b of entries) {
        if (a === b || find(a.key) === find(b.key)) continue;
        if (a.forms.some((fa) => b.forms.some((fb) => inside(fa, fb) || inside(fb, fa)))) parent.set(find(a.key), find(b.key));
      }
    }
    return new Map(entries.map((e) => [e.key, find(e.key)]));
  }

  const words = (s) => norm(s).split(' ').filter(Boolean);

  /**
   * How alike two subjects are as kinds of thing, from their form only:
   *   +2 same head noun ("foreign key" / "primary key"), +1 same three-letter ending of the head word
   *   ("praziquantel" / "clorsulon" do not share it; "albendazole" / "fenbendazole" do), +1 same number of
   *   words, +1 same shape (both acronyms, both capitalised names, or both lower-case phrases),
   *   +1 same card source kind.
   */
  function typeScore(a, b, kindA, kindB) {
    const wa = words(a);
    const wb = words(b);
    if (!wa.length || !wb.length) return 0;
    const headA = os().lemma(wa[wa.length - 1]);
    const headB = os().lemma(wb[wb.length - 1]);
    let score = 0;
    if (headA === headB) score += 2;
    else if (headA.length > 4 && headB.length > 4 && headA.slice(-3) === headB.slice(-3)) score += 1;
    if (wa.length === wb.length) score += 1;
    const shape = (s) => (/^[A-Z0-9]{2,}s?$/.test(String(s).trim()) ? 'acronym' : /^[A-Z]/.test(String(s).trim()) ? 'capital' : 'lower');
    if (shape(a) === shape(b)) score += 1;
    if (kindA && kindB && kindA === kindB) score += 1;
    return score;
  }

  const sameType = (a, b, kindA, kindB) => typeScore(a, b, kindA, kindB) >= MIN_TYPE_SCORE;

  /** The organising-heading words of a text ("Treatment of strangles" -> ['treatment']), for subject-peers.js. */
  const aspectWords = (text) => norm(text).split(' ').filter((w) => GENERIC_WORDS.has(w));

  const api = { resolve, specificOf, mergeKeys, isGenericHeading, repeatedHeadings, subjectKey, typeScore, sameType, tidySubject, aspectWords, MIN_TYPE_SCORE };
  PDFStudy.quizSubjects = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Subject Claims: everything the scope says about each subject, so a distractor or a False statement can
 * be checked against it. A wrong option must be FALSE for the subject the question names:
 *   - it comes from another subject,
 *   - the scope never says it (or most of it) about the asked subject, on any line, in any card,
 *   - it is not a paraphrase or a part of the right answer,
 *   - it has words of its own: at least one content word the asked subject's material never uses, and no
 *     more than half of its content words shared with that material. An option made mostly of words the
 *     scope also uses for the asked subject may well be true of it, so it is not offered.
 * When that cannot be established the caller asks nothing: no question beats a wrong key.
 *
 *   create()                                 -> index
 *   index.add(subjectKey, text)              record a line, sentence or card back as said about a subject
 *   index.says(subjectKey, statement)        does the scope say (most of) this about the subject?
 *   index.isFalseOf(subjectKey, name, text)  may this text stand as a wrong claim about that subject?
 *   index.isFalseFor(fact, other)            may `other`'s statement stand as a wrong answer about `fact`'s subject?
 *   index.isDistinctive(subjectKey, text)    does the text hold a content word no other subject's material uses?
 *                                            A point borrowed for a wrong answer must: "Formulated for PO
 *                                            administration" could be said of several drugs, so it is never offered
 *                                            as false of one of them.
 *   index.uses(subjectKey, text)             does the subject's material use every content word of the text?
 *   index.inherits(subjectKey, name)         does a line about the subject point to `name` as its model ("per X",
 *                                            "same as X")? What is said of X may then hold for the subject too.
 *   overlap(a, b)                            share of a's content stems that b also has (0..1)
 *   family(word)                             a word's inflection family ("die", "dying", "dead", "death" are one):
 *                                            a borrowed claim whose words are the asked subject's in another form
 *                                            is not offered as false of it
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qf = () => dep('quizFacts', './quiz-facts.js');

  const SAID_SHARE = 0.6; // this share of a statement's content words on one line of the subject = said about it
  const PARAPHRASE_SHARE = 0.6; // either statement this much contained in the other = the same claim
  const MIN_OWN_WORDS = 1; // content words of a wrong claim that the asked subject's material never uses
  const MAX_SHARED_SHARE = 0.5; // share of a wrong claim's content words the subject's material may also use

  const STRICT_KINDS = new Set(['point', 'qa']);
  const LABEL_RE = /^([^:]{2,40}):\s/;
  // A line that sets another subject apart from this one ties nothing together.
  const CONTRAST_RE = /\b(?:unlike|whereas|versus|vs\.?|instead\s+of|rather\s+than|compared\s+(?:to|with)|not|no|except)\b/i;
  // Words a subject's name shares with many others ("disease", "infection", "species"): no tie between two subjects.
  const GENERIC_NAME_WORD_RE = /^(?:disease|diseas|infection|infect|syndrome|disorder|species|spp|type|form|general|other|lesion)$/;
  const normLabel = (s) => String(s || '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Content stems plus two-letter acronyms ("PO", "IV"), which carry meaning in a claim but are too
  // short for the content-word rules.
  const stems = (text) => new Set([...qf().contentStems(text), ...(String(text || '').match(/\b[A-Z]{2}\b/g) || []).map((a) => a.toLowerCase())]);

  /**
   * A word's inflection family: its ending ("-ing", "-ed", "-s", "-th") dropped, and a short root reduced to its
   * consonants around its vowels, so "die", "dies", "died", "dying", "dead" and "death" are one family. Two words of
   * one family may be unrelated ("day"): a family match only ever refuses a wrong option, never makes one.
   */
  function family(word) {
    const w = String(word || '').toLowerCase();
    const root = w.length > 4 ? w.replace(/(?:ing|ed|es|th|s)$/, '') : w.replace(/(?:ing|ed|th|s)$/, '');
    if (root.length > 4 || root.length < 2) return root;
    return root.replace(/[aeiouy]+/g, 'V').replace(/Vd$/, 'V');
  }

  function overlap(a, b) {
    if (!a.size) return 0;
    let shared = 0;
    for (const w of a) if (b.has(w)) shared++;
    return shared / a.size;
  }

  function create() {
    const lines = new Map(); // subjectKey -> [Set of stems]
    const vocabulary = new Map(); // subjectKey -> Set of every stem used about it
    const raw = new Map(); // subjectKey -> [line as written]

    function add(key, text) {
      if (!key || !text) return;
      if (!raw.has(key)) raw.set(key, []);
      raw.get(key).push(String(text));
      const s = stems(text);
      if (!s.size) return;
      if (!lines.has(key)) {
        lines.set(key, []);
        vocabulary.set(key, new Set());
      }
      lines.get(key).push(s);
      for (const w of s) vocabulary.get(key).add(w);
    }

    function says(key, statement) {
      const s = stems(statement);
      return (lines.get(key) || []).some((line) => overlap(s, line) >= SAID_SHARE);
    }

    /**
     * strict: also demand words of its own. Used for points and lecture answers, where many lines talk
     * about one subject; a glossary definition is checked by says() alone, because the definitions of
     * one section share their vocabulary ("column", "key", "table") without being true of each other.
     */
    function isFalseOf(key, name, text, strict = true) {
      const s = stems(text);
      if (!key || !s.size || says(key, text)) return false;
      // The claim names the subject itself ("... unlike praziquantel ...").
      const named = stems(name);
      if (named.size && overlap(named, s) >= 1) return false;
      if (!strict) return true;
      const own = vocabulary.get(key) || new Set();
      // "Cats: Dipylidium and Taenia" is about cats; when the asked subject's material also speaks of
      // cats, the claim may hold for it as well ("all tapeworms in dogs and cats").
      const label = String(text).match(LABEL_RE);
      if (label && [...stems(label[1])].every((w) => own.has(w))) return false;
      // "Parasites DIE prior to elimination" against a subject whose slide shows "Dead tapeworms": a word of the
      // same family (another inflection of it) is the subject's own word too.
      const ownFamilies = new Set([...own].map(family));
      const fresh = [...s].filter((w) => !own.has(w) && !ownFamilies.has(family(w))).length;
      return fresh >= MIN_OWN_WORDS && 1 - fresh / s.size <= MAX_SHARED_SHARE;
    }

    function isDistinctive(key, text) {
      return [...stems(text)].some((w) => [...vocabulary].every(([k, words]) => k === key || !words.has(w)));
    }

    function isFalseFor(fact, other) {
      if (!other || other === fact || !other.subjectKey || other.subjectKey === fact.subjectKey) return false;
      const s = stems(other.statement);
      const answer = stems(fact.statement);
      if (overlap(s, answer) >= PARAPHRASE_SHARE || overlap(answer, s) >= PARAPHRASE_SHARE) return false;
      const strict = STRICT_KINDS.has(fact.kind);
      if (strict && !isDistinctive(other.subjectKey, other.statement)) return false;
      return isFalseOf(fact.subjectKey, fact.subject || fact.term, other.statement, strict);
    }

    /** Does the scope's material about the subject use every content word of the text? */
    const uses = (key, text) => {
      const own = vocabulary.get(key);
      return Boolean(own) && [...stems(text)].every((w) => own.has(w));
    };

    /**
     * Does a line said about `key` refer to `name` as its model ("PD: per praziquantel", "same as fenbendazole",
     * "similar to X", "like X", "as for X")? Then what the scope says of `name` may hold for `key` as well.
     */
    function inherits(key, name) {
      const n = String(name || '').trim();
      if (!key || n.length < 3) return false;
      const re = new RegExp(`\\b(?:per|same\\s+as|similar\\s+to|as\\s+(?:for|with|in)|like|see)\\s+(?:the\\s+|that\\s+of\\s+)?${escapeRe(n)}`, 'i');
      return (raw.get(key) || []).some((line) => re.test(line));
    }

    /**
     * What the scope gives `key` under a label ("Metabolism: ..." -> the text after it), from its "Label: value"
     * lines; [] when it never uses the label. A False that borrows another subject's "Metabolism: X" is only
     * contradicted when the subject has a "Metabolism:" line of its own.
     */
    function valuesFor(key, label) {
      const want = normLabel(label);
      if (!key || !want) return [];
      return (raw.get(key) || []).map((line) => String(line).match(LABEL_RE)).filter((m) => m && normLabel(m[1]) === want)
        .map((m) => String(m.input).slice(m[0].length - 1).trim());
    }

    /**
     * Does the scope's material about `key` speak of `name` without setting it apart ("unlike", "whereas", "not")?
     * "In very severe pneumonia ... invade the pleural fluid" ties pneumonia to pleural disease, "Pneumonia is the most
     * common complication" ties strangles to pneumonia: a statement of one may well hold for the other.
     * Only the name's own words count (a word of four letters or more that is no organising heading).
     */
    function mentions(key, name) {
      const own = qf().contentStems(name).filter((w) => w.length >= 4 && !GENERIC_NAME_WORD_RE.test(w));
      if (!key || !own.length) return false;
      return (raw.get(key) || []).some((line) => !CONTRAST_RE.test(line) && qf().contentStems(line).some((w) => own.includes(w)));
    }

    return { add, says, isFalseOf, isFalseFor, isDistinctive, uses, inherits, mentions, valuesFor, has: (key) => lines.has(key) };
  }

  const CLAUSE_BREAK_RE = /,\s+(?:whereas|while|but|unlike)\s+|;\s+/i;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * The index of one scope. parts: { facts, subjectSlides: [{ slide, subject }], sentences, keyOf }
   *   keyOf(subject) gives a subject's key (default quizSubjects.subjectKey; the scope passes its merged keys);
   *   every fact's statement is said about its subject; on a deck every line of a slide is said about the
   *   slide's subject (and about the topic whose course a procedure slide is part of: deckFacts.subjectIndex);
   *   in prose every sentence that names a subject is said about it.
   */
  function fromScope(parts) {
    const index = create();
    const keyOf = parts.keyOf || dep('quizSubjects', './quiz-subjects.js').subjectKey;
    const facts = parts.facts || [];
    for (const f of facts) index.add(f.subjectKey, f.statement);
    for (const { slide, subject, topic } of parts.subjectSlides || []) {
      for (const line of [slide.title, ...(slide.bullets || [])]) {
        index.add(keyOf(subject), line);
        // A procedure met in a disease's course ("Pleural drainage" under pleural disease): its lines are part
        // of the disease's story, so none of them is offered as false of the disease.
        if (topic) index.add(keyOf(topic), line);
      }
    }
    const names = new Map(facts.filter((f) => f.kind !== 'qa').map((f) => [f.subjectKey, f.subject || f.term]));
    for (const [key, name] of names) {
      const re = new RegExp(`(?:^|[^A-Za-z])${escapeRe(name)}(?:e?s)?(?![A-Za-z])`, 'i');
      // Clause by clause: "A occurs when ..., whereas B occurs when ..." says the second half about B only.
      for (const s of parts.sentences || []) {
        for (const clause of String(s).split(CLAUSE_BREAK_RE)) if (re.test(clause)) index.add(key, clause);
      }
    }
    return index;
  }

  const api = { create, fromScope, overlap, family };
  PDFStudy.subjectClaims = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Borrowed Statements: may a statement the scope says about one subject be shown as a wrong option, or as a False,
 * about another? fact-questions.js builds the questions; this module holds the rules a borrowed statement must pass.
 * Each rule refuses a statement a student could defend as true of the asked subject, or reject for its form alone:
 *   namesItsOwner     it names the subject it really belongs to ("Caused by equine herpesvirus 1" under a feline
 *                     disease), opens on another name ("Fenbendazole is effective ..."), or is a labelled line whose
 *                     label names something else ("Bronchitis: may be normal at rest ...")
 *   fitsSubject       its bare verb agrees with the asked subject, its head noun is of the same kind, and the scope
 *                     does not call one subject a kind of the other
 *   partlySaid        one clause of it is said of the asked subject ("Not metabolized, not distributed")
 *   inherited         the scope says one subject behaves "per" / "same as" / "like" the other, or one subject's
 *                     material speaks of the other: what is said of one may hold for the other
 *   sameStanding      an identity line (from the subject's own title slide) only faces identity lines
 *   fairBeside        a line that belongs to its subject only by its slide's place (a bare "Clinical pathology"
 *                     title) only faces a subject the scope teaches in that aspect too
 *   contradicts       a borrowed point is False only when the subject has its own line under the same label,
 *                     saying something else: not being mentioned does not make a statement false
 *   sameAspect        it comes from the same aspect as the asked fact (both from the subject's own title slide, or
 *                     both under "Diagnosis"): the asked subject's own statement there is the fact that contradicts it,
 *                     and a statement from another aspect is told apart by its kind, not by knowing the subject
 *   isPredicate / agrees   a predicate cut from its subject ("Are circuits ...", "Can be extended ...")
 * ctx: { forms, claims (subject-claims.js), kinds (quiz-kinds.js), peers (subject-peers.js) }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qf = () => dep('quizFacts', './quiz-facts.js');
  const os = () => dep('optionSets', './option-sets.js');
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');

  const subjectOf = (f) => f.subject || f.term;

  // "Fenbendazole is effective ...": a statement that opens on a name and a verb has a subject of its own.
  const OWN_SUBJECT_RE = /^([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\s+(?:is|are|was|were|has|have|can|cannot|does|do|causes?|produces?|inhibits?|kills?|binds?)\b/;
  // "Bronchitis: May be normal at rest ...": a short label before a colon names what the line is about.
  const LABEL_RE = /^([^:]{3,40}):\s+\S/;

  /** Does the label of a "Label: text" line name something other than the asked subject and its aspects? */
  function labelNamesOther(fact, statement, ctx) {
    const label = (String(statement || '').match(LABEL_RE) || [])[1];
    if (!label || subjects().isGenericHeading(label)) return false;
    const words = qf().contentStems(label).filter((w) => !subjects().isGenericHeading(w));
    if (!words.length) return false;
    const asked = new Set(qf().contentStems(subjectOf(fact)));
    if (words.some((w) => asked.has(w))) return false;
    // A label the asked subject's own material also uses ("Dose: ...") is one of its headings, not another name.
    return !(ctx.claims && ctx.claims.uses && ctx.claims.uses(fact.subjectKey, label));
  }

  /**
   * A wrong option that names the thing it is really about gives itself away: "Caused by equine herpesvirus 1"
   * offered for a feline disease, "... in cats with Cryptococcus rhinitis" offered for Coccidioides, or a
   * statement whose grammatical subject is another drug ("Fenbendazole is effective ..."). `other` is the fact the
   * statement comes from; a word the asked subject's own name shares is no tell.
   */
  function namesItsOwner(fact, other, ctx) {
    const asked = new Set(qf().contentStems(subjectOf(fact)));
    const said = qf().contentStems(other.statement);
    const owner = qf().contentStems(subjectOf(other)).filter((w) => !asked.has(w) && !subjects().isGenericHeading(w));
    if (owner.some((w) => said.includes(w))) return true;
    if (labelNamesOther(fact, other.statement, ctx)) return true;
    const opener = String(other.statement || '').match(OWN_SUBJECT_RE);
    if (!opener || qf().contentStems(opener[1]).some((w) => asked.has(w))) return false;
    // A name the scope never writes in lower case, or one its material about the asked subject never uses
    // ("Fenbendazole" beside clorsulon); not a common noun opening a sentence about it ("Bacteria enter ...").
    const name = opener[1];
    if (ctx.forms && ctx.forms.running(name) === null) return true;
    return Boolean(ctx.claims && ctx.claims.uses) && !ctx.claims.uses(fact.subjectKey, name);
  }

  // A predicate cut from "The storage elements are …" keeps its verb: "Are circuits that ...".
  const BARE_PREDICATE_RE = /^(is|are|was|were|has|have|does|do)\b/i;
  const PLURAL_VERB_RE = /^(?:are|were|have|do)$/i;
  const BARE_MODAL_RE = /^(?:can|cannot|may|must|should|will|might)\b/i;
  /** A predicate cut from its subject ("Are circuits ...", "Can be extended ..."). */
  const isPredicate = (s) => BARE_PREDICATE_RE.test(String(s || '')) || BARE_MODAL_RE.test(String(s || ''));
  /** Does a bare predicate's verb agree in number with the fact's subject? (modals agree with either) */
  const agrees = (fact, s) => {
    const verb = (String(s || '').match(BARE_PREDICATE_RE) || [])[1];
    return !verb || os().isPlural(subjectOf(fact)) === PLURAL_VERB_RE.test(verb);
  };
  const headOf = (name) => os().lemma(String(name || '').toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).pop() || '');

  /** Does the scope say one of the two subjects is a kind of the other? (ctx.kinds: quizKinds.index) */
  const kindOf = (fact, other, ctx) => Boolean(ctx.kinds && ctx.kinds.related(subjectOf(fact), subjectOf(other)));

  /**
   * May `other`'s statement be set under `fact`'s subject as a False? Not when its verb disagrees in number with
   * the subject ("SR latch" + "Are circuits ..." reads false for its grammar alone), and not when the scope says one
   * subject is a kind of the other ("The most basic storage elements are latches"): what is true of storage
   * elements is true of the SR latch as well.
   */
  function fitsSubject(fact, other, ctx) {
    const statement = String(other.statement || '');
    const verb = (statement.match(BARE_PREDICATE_RE) || [])[1];
    if (verb && os().isPlural(subjectOf(fact)) !== PLURAL_VERB_RE.test(verb)) return false;
    // A predicate without its subject ("Can be extended to three or more variables") only reads as a claim about
    // a thing of the same kind: under a subject with another head noun (a theorem's line under "Digital circuits")
    // it is false for its grammar alone.
    if ((verb || BARE_MODAL_RE.test(statement)) && headOf(subjectOf(fact)) !== headOf(subjectOf(other))) return false;
    return !kindOf(fact, other, ctx);
  }

  const CLAUSE_SPLIT_RE = /\s*(?:[,;]|\band\b|\bbut\b)\s*/i;
  const MIN_CLAUSE_WORDS = 2;

  /** Does the scope say one clause of the borrowed statement about the asked subject? Then the False is half true. */
  function partlySaid(fact, other, ctx) {
    if (!ctx.claims || !ctx.claims.says) return false;
    const clauses = String(other.statement || '').split(CLAUSE_SPLIT_RE).filter((c) => qf().contentStems(c).length >= MIN_CLAUSE_WORDS);
    return clauses.length > 1 && clauses.some((c) => ctx.claims.says(fact.subjectKey, c));
  }

  /**
   * Are the two subjects tied together? The scope says one behaves "per" / "same as" / "like" the other, or one's
   * material speaks of the other without setting it apart (subject-claims.js inherits, mentions): a statement of one
   * may then hold for the other, so it is no wrong answer about it.
   */
  const inherited = (fact, other, ctx) => {
    const c = ctx.claims;
    if (!c || !c.inherits) return false;
    const [a, b] = [fact.subjectKey, other.subjectKey];
    if (c.inherits(a, subjectOf(other)) || c.inherits(b, subjectOf(fact))) return true;
    return Boolean(c.mentions) && fact.kind === 'point' && (c.mentions(a, subjectOf(other)) || c.mentions(b, subjectOf(fact)));
  };

  /** Same aspect as the asked fact: both untitled (the subject's own slide) or one shared aspect heading. */
  function sameAspect(fact, other, ctx) {
    if (fact.kind !== 'point' || !ctx.peers || !ctx.peers.aspectsOf) return true;
    const mine = ctx.peers.aspectsOf(fact);
    const theirs = ctx.peers.aspectsOf(other);
    if (!mine.length || !theirs.length) return !mine.length && !theirs.length;
    return mine.some((a) => theirs.includes(a));
  }

  /**
   * For a wrong option beside a point: a line from the subject's own title slide (what the thing is) only faces
   * lines of the same standing; beside "Clinical signs" or "Etiology" lines it is the only one that describes a thing.
   * A point from an aspect may face lines of other aspects: each is still something one peer is told.
   */
  function sameStanding(fact, other, ctx) {
    if (fact.kind !== 'point' || !ctx.peers || !ctx.peers.aspectsOf) return true;
    return ctx.peers.aspectsOf(fact).length > 0 || ctx.peers.aspectsOf(other).length === 0;
  }

  /**
   * A wrong option from a slide whose title is a bare heading ("Clinical pathology", "Diagnostic imaging") belongs to
   * its subject only by where the slide sits; such a line (a lab marker, an imaging remark) is often true of any
   * disease of the lecture. It may stand beside a subject only when the scope teaches that subject in the same aspect.
   */
  function fairBeside(fact, other, ctx) {
    if (fact.kind !== 'point' || !ctx.peers || !ctx.peers.fitsAspect) return true;
    const title = String(other.context || '').replace(/^Slide\s+\d+:\s*/, '').trim();
    if (!title || !subjects().isGenericHeading(title)) return true;
    return ctx.peers.fitsAspect(fact.subjectKey, other) && ctx.peers.aspectsOf(other).length > 0;
  }

  const CONTRADICTION_OVERLAP = 0.5; // the subject's own value may share at most this share of the borrowed one's words

  /**
   * Does the scope say something about the asked subject that contradicts a borrowed point? Only a labelled point
   * ("Metabolism: metabolites produced by dogs are active") can be checked: the subject must have a line under the
   * same label, and every such line must say something else. An unlabelled point is never contradicted this way:
   * that the scope does not say it of the subject does not make it false.
   */
  function contradicts(fact, other, ctx) {
    if (fact.kind !== 'point') return true;
    const m = String(other.statement || '').match(LABEL_RE);
    if (!m || !ctx.claims || !ctx.claims.valuesFor) return false;
    const own = ctx.claims.valuesFor(fact.subjectKey, m[1]);
    const theirs = new Set(qf().contentStems(String(other.statement).slice(m[0].length - 1)));
    const shared = (v) => qf().contentStems(v).filter((w) => theirs.has(w)).length / Math.max(1, theirs.size);
    return own.length > 0 && own.every((v) => shared(v) <= CONTRADICTION_OVERLAP);
  }

  const api = { namesItsOwner, fitsSubject, partlySaid, inherited, sameAspect, sameStanding, fairBeside, contradicts, isPredicate, agrees, kindOf, labelNamesOther };
  PDFStudy.borrowedStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

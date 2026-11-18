/**
 * Self-Contained Cards: a card is studied alone, so each half must make sense without the page.
 *   unresolvedBack(back)    the first sentence points at something the reader cannot see: "this condition",
 *                           "of this type", "(here, 10)", "as shown", "the following", "it" with no noun before,
 *                           "a much better choice" (than what?), "If, for example, ..." (an illustration)
 *   praiseBack(back)        a remark about importance, not a fact: "The heart of the database design process."
 *   addressesReader(back)   "we" / "you" / "our": the author talking to the reader, not a statement of fact
 *   instanceOfFront(b, f)   "Hemorrhage and edema are a space-occupying lesion" names an instance of the front;
 *                           it does not say what the front is
 *   badFront(front)         doubled heading ("Functional Dependencies Functional dependencies"), stutter ("4NF 4NF")
 *   reason(card, opts)      the first failed check's name, or '' when the card can stand alone
 * Later sentences of a back may lean on the first one ("A change ... This change is called a trigger.").
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Deictic words that only make sense on the page: "(here, 10)", "shown above", "the following".
  const ON_THE_PAGE_RE =
    /\(\s*here\b|\bhere,\s|\b(?:as|is|are)\s+shown\b|\bthe\s+following\b|\b(?:shown|given|listed|see|seen|described|defined)\s+(?:above|below|here)\b|\bin\s+(?:the\s+)?(?:figure|table|example|margin)\b|\bin\s+(?:chapter|section|appendix|figure|table|example)\s+\d/i;
  // "this condition", "of this type", "in this manner", "such a circuit": a noun the previous sentence supplied.
  const DEMONSTRATIVE_NOUN_RE =
    /\b(?:this|that|these|those)\s+(?:[a-z]+\s+)?(?:condition|type|kind|sort|form|fashion|manner|way|case|situation|error|problem|example|process|approach|method|step|result|value|one|ones|circuit|change|idea|case|figure|table|section|chapter|statement|property|definition|rule|structure|arrangement|setup|configuration|fact|point|issue|notion|observation|concept|requirement|relation|relationship|operation|set|function|technique|quantity|design)s?\b|\bsuch\s+(?:an?\s+)?(?!as\b|that\b)[a-z]+/i;
  // "A much better choice for ...": better than what the page compared it with, which the card does not show.
  const BARE_COMPARISON_RE =
    /\b(?:an?|the)\s+(?:much\s+|far\s+|lot\s+)?(?:better|worse|easier|harder|simpler|faster|slower|cheaper|safer|preferable)\s+(?:choice|option|way|approach|alternative|solution|method|idea)\b(?![^.]*\bthan\b)/i;
  // "Computing & Society 7.1 Computer Viruses In November ...": a boxed feature's label run into the text.
  const BOX_LABEL_RE = /\b[A-Z][a-z]+(?:\s+(?:&|[A-Z][a-z]+)){0,3}\s+\d+\.\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+[A-Z]/;
  // A definition by illustration or by vagueness: "If, for example, ...", "A fact that gives rise to ...".
  // (A leading "For instance, the limit from the right means ..." introduces a definition and is not caught.)
  const ILLUSTRATION_RE = /,\s*for\s+(?:example|instance),|\be\.g\.,?\s/i;
  // Three different capital symbols ($DX$, $A$, $L$) in one sentence name the parts of a worked example; a
  // definition uses one or two ("The closure of $S$ ... contains $S$").
  const EXAMPLE_SYMBOLS = 3;
  const LEADING_CONNECTIVE_RE = /^(?:for\s+(?:instance|example)|however|similarly|likewise|in\s+general|in\s+particular|moreover|furthermore),\s+/i;
  const VAGUE_BACK_RE = /^(?:an?|the)\s+(?:fact|thing|something|way|matter|bit)\s+(?:that|which|of|to)\b|^something\s+(?:that|which)\b/i;
  const PRAISE_RE =
    /^(?:it\s+is\s+)?(?:the|an?|one)\s+(?:(?:very|most|really|truly)\s+)?(?:heart|core|crux|cornerstone|foundation|essence|backbone|centerpiece|centrepiece|linchpin|soul|key|basis|bedrock)\s+of\b|^(?:an?\s+)?(?:(?:very|extremely|really)\s+)?(?:important|useful|helpful|powerful|essential|critical|crucial|fundamental)\s+(?:concept|idea|tool|topic|part|step)\b/i;
  // The author addressing the reader ("you", "our database", "we will discuss"); a generic "what we perceive" is fine.
  const READER_RE =
    /\b(?:you|your|yours|let'?s|our|ours)\b|\bwe\s+(?:will|shall|have|now|can|could|discuss|saw|see|say|call|need|must|begin|start|turn|consider|introduce|define|use|write|denote|assume|want|wish|present|presented|study|studied|show|showed|describe|described)\b|\bas\s+we\b/i;
  // A copula with a short subject and the front as the whole predicate: "<2-4 words> are a <front>."
  const MAX_INSTANCE_SUBJECT_WORDS = 4;
  const COUNTED_REF_RE = /\ball\s+(?:two|three|four|five|six|eight)\s+[a-z]+/i;
  // "A means to study such.": a sentence cut off at a page or column break ends in a word that needs more.
  // (Lower case only: "for every x in A" ends in a variable, not an article.)
  const CUT_OFF_END_RE = /\b(?:such|these|those|the|an?|of|to|for|with|from|and|or)\s*[.!]?$/;
  // Advice where a definition should be: "Do not fall into a common trap."
  const ADVICE_RE = /^(?:do\s+not|don['’]t|never|be\s+sure|make\s+sure|remember|beware|avoid)\b/i;
  // A program statement in the answer: "final int LENGTH = 10; It is a good idea ..."
  const CODE_IN_BACK_RE = /\b(?:final|int|double|boolean|char|long|String|void)\s+[\w[\]]+\s*(?:\$?\s*=|;)|;\s*\$?\s+[A-Z]/;
  // A lone capital symbol ("input logic signal $X$") names one drawing's signal, not the general case.
  const LONE_SYMBOL_RE = /\$[A-Z]\.?\$/;
  const MAX_TAUTOLOGY_WORDS = 4;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const firstSentence = (s) => (plain(s).match(/^.+?[.!?](?=\s+[A-Z(]|\s*$)/) || [plain(s)])[0];
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function unresolvedBack(back) {
    // "In particular, ordered 2-tuples." continues the sentence before; it is not an answer on its own.
    if (/^in\s+particular,/i.test(plain(back))) return true;
    // A leading connective ("For instance, the limit from the right means ...") is judged without itself.
    const first = firstSentence(back).replace(LEADING_CONNECTIVE_RE, '');
    // "The two parts of the expression, $DX$ and $A$, ... for $L$": named symbols of one worked example.
    if (new Set((first.match(/\$[A-Z]{1,2}\.?\$/g) || []).map((s) => s.replace(/[$.]/g, ''))).size >= EXAMPLE_SYMBOLS) return true;
    if (ON_THE_PAGE_RE.test(first) || DEMONSTRATIVE_NOUN_RE.test(first) || BARE_COMPARISON_RE.test(first)) return true;
    if (ILLUSTRATION_RE.test(first) || VAGUE_BACK_RE.test(first) || BOX_LABEL_RE.test(first)) return true;
    // "Occurs when all three inputs are equal to 1": a count of things only the figure shows.
    if (COUNTED_REF_RE.test(first) || CUT_OFF_END_RE.test(first)) return true;
    const sn = dep('stemNoise', './stem-noise.js');
    // "It"/"they" before any noun, or a sentence that opens with "This"/"Such": the subject is elsewhere.
    // ("Recall is best when ..." uses "recall" as a noun, not as the imperative "Recall that ...".)
    const nounOpener = /^(?:recall|note|notice|consider)\s+(?:is|are|was|were|can|has)\b/i.test(first);
    return Boolean(sn && ((sn.isDangling(first) && !nounOpener) || /^(?:it|they|its|their)\b/i.test(first)));
  }

  const praiseBack = (back) => PRAISE_RE.test(plain(back));
  const addressesReader = (back) => READER_RE.test(firstSentence(back));

  function instanceOfFront(back, front) {
    const f = plain(front).replace(/\s*\([^)]*\)\s*$/, '').toLowerCase();
    if (!f) return false;
    const m = plain(back).toLowerCase().match(new RegExp(`^(.+?)\\s+(?:is|are|was|were)\\s+(?:an?|the)?\\s*${esc(f)}s?\\s*[.!]?$`));
    return Boolean(m) && m[1].split(/\s+/).length <= MAX_INSTANCE_SUBJECT_WORDS;
  }

  /**
   * A front that repeats a run of its own words ("Functional Dependencies Functional dependencies", "4NF 4NF").
   * One repeated ordinary word is a real name ("Streptococcus equi equi"); one repeated code ("4NF") is a stutter.
   */
  function badFront(front) {
    const raw = plain(front).split(/\s+/).filter(Boolean);
    const w = raw.map((x) => x.toLowerCase());
    for (let n = 1; n <= Math.floor(w.length / 2); n++) {
      for (let i = 0; i + 2 * n <= w.length; i++) {
        if (w.slice(i, i + n).join(' ') !== w.slice(i + n, i + 2 * n).join(' ')) continue;
        if (n > 1 || /\d|^[A-Z]{2,}$/.test(raw[i])) return true;
      }
    }
    return false;
  }

  /**
   * "An inverted version of input logic signal $X$": one capital symbol, named once, that the front does not
   * carry ("The closure of $S$ ... contains $S$" introduces its symbol and uses it again).
   */
  function oneInstance(back, front) {
    const first = firstSentence(back);
    const m = first.match(LONE_SYMBOL_RE);
    if (!m || /\$/.test(front)) return false;
    const symbol = m[0].replace(/[$.]/g, '');
    return (first.match(new RegExp(`\\$${symbol}\\.?\\$`, 'g')) || []).length === 1;
  }

  /** "Propositional language" -> "An artificial language.": a short back that only repeats the front's head noun. */
  function restatesHead(back, front) {
    const b = plain(back).replace(/[.!]$/, '').toLowerCase().split(/\s+/);
    const head = plain(front).replace(/\s*\([^)]*\)\s*$/, '').toLowerCase().split(/\s+/).pop();
    return b.length <= MAX_TAUTOLOGY_WORDS && Boolean(head) && b[b.length - 1].replace(/s$/, '') === head.replace(/s$/, '');
  }

  /**
   * opts.prose: the back is a sentence lifted from running text (stricter: no reader address).
   * opts.list:  the back is a bullet list; only the page-pointer check applies.
   */
  function reason(card, opts = {}) {
    const back = String((card && card.back) || '');
    const front = String((card && card.front) || '');
    if (badFront(front)) return 'doubled-front';
    if (opts.list) return ON_THE_PAGE_RE.test(plain(back)) ? 'points-at-page' : '';
    if (unresolvedBack(back)) return 'unresolved-reference';
    if (praiseBack(back)) return 'praise';
    if (CODE_IN_BACK_RE.test(plain(back))) return 'code';
    if (opts.prose && addressesReader(back)) return 'addresses-reader';
    if (opts.prose && ADVICE_RE.test(plain(back))) return 'advice-not-definition';
    if (opts.prose && oneInstance(back, front)) return 'one-instance';
    if (opts.prose && restatesHead(back, front)) return 'restates-front';
    if (instanceOfFront(back, front)) return 'instance-not-definition';
    // "The term domain means ..." on a "Domain integrity constraint" card defines a different term.
    const other = plain(back).match(/^the\s+term\s+([A-Za-z][\w\s-]{1,40}?)\s+(?:means|refers\s+to|denotes)\b/i);
    if (other && other[1].toLowerCase() !== plain(front).toLowerCase()) return 'defines-another-term';
    return '';
  }

  const api = { unresolvedBack, praiseBack, addressesReader, instanceOfFront, badFront, reason, firstSentence };
  PDFStudy.selfContained = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

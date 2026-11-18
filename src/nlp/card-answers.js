/**
 * Card Answers: does a card's back answer its front? Rules every card source applies after it has built a card:
 *   mentionsOnly(front, back)   the back names the front's term without saying what it is: "Often, a set ... turns
 *                               out to be the null set" for "Null set", "... formed using logical operators" for
 *                               "Logical operators", or a naming sentence with nothing else in it ("Each basic
 *                               circuit is referred to as a logic gate")
 *   circular(front, back)       every content word of the back is already in the front ("... gives a 'spongy
 *                               appearance' → ?" => "spongiform encephalopathy")
 *   withoutFiller(back)         a list back without its "Etc." / "..." item; '' when nothing is left to list
 *   statementCue(front)         the front's label after " — " is a statement, not a label ("Distemper — Morbillivirus,
 *                               family paramyxoviridae, enveloped"): a sibling line is no answer to it
 *   answered(card)              the card with those rules applied: null, or the card (filler items dropped)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const STOP = new Set(('the a an and or of in on to for with by at from as is are was were be been it its this that these ' +
    'those which who whose not no can may into than then also each every any all some such').split(' '));
  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\$[^$]*\$/g, ' x ').replace(/\s+/g, ' ').trim();
  const stem = (w) => (w.length > 4 ? w.replace(/ies$/, 'y').replace(/(?:sses|ches|shes|xes)$/, (m) => m.slice(0, -2)).replace(/(?<!s)s$/, '') : w);
  const content = (s) => (plain(s).toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).filter((w) => !STOP.has(w)).map(stem);
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Words that say "this is what the term is" right after it: "X is ...", "X, the ..., is", "X (Y) means ...".
  // ("The dual of $p \wedge q$ is ...": the term with what it is taken of, then the verb.)
  const DEFINING_AFTER_RE = /^\s*(?:\([^)]*\)\s*)?(?:of\s+[^.;]{1,80}?(?:,|\s+(?:is|are)\b)|,|:|—|–|-\s|is\b|are\b|was\b|were\b|means\b|refers?\s+to\b|denotes?\b|consists?\s+of\b|represents?\b|describes?\b|holds?\b|stores?\b|contains?\b|has\b|have\b|can\b|must\b|does\b|do\b)/i;
  // A naming verb right before it: "... is called a negation indicator", "... known as bi-implications".
  const NAMING_BEFORE_RE = /\b(?:called|known\s+as|termed|named|referred\s+to\s+as|denoted\s+(?:by|as)|defined\s+as|said\s+to\s+be)\s+(?:(?:a|an|the)\s+)?["“']?$/i;
  // A lead-in before the term at the start: "In general, a ", "The ", "A(n) ".
  const LEAD_RE = /^(?:(?:in\s+general|formally|informally|simply\s+put|in\s+short),\s+)?(?:(?:a|an|the)\s+)?["“']?$/i;
  const COPULA_BEFORE_RE = /\b(?:is|are|be)\s+(?:(?:a|an|the)\s+)?$/i;
  const CONDITION_AFTER_RE = /^\s*(?:if|when|whenever|provided|exactly\s+when)\b/i;
  const MIN_NAMING_CONTENT = 5; // content words besides the term that a naming sentence needs to say what it is

  /** Where the term (or its plural/singular) stands in the back, or null. */
  function locate(term, back) {
    const t = plain(term).replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (t.length < 3) return null;
    const forms = [t, `${t}s`, `${t}es`, t.replace(/s$/, ''), t.replace(/es$/, ''), t.replace(/y$/, 'ies'), t.replace(/ies$/, 'y')]
      .filter((f) => f.length >= 3);
    const re = new RegExp(`(?<![A-Za-z-])(?:${[...new Set(forms)].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?![A-Za-z-])`, 'i');
    const text = plain(back);
    const m = text.match(re);
    return m ? { before: text.slice(0, m.index), after: text.slice(m.index + m[0].length), text } : null;
  }

  function mentionsOnly(front, back) {
    const at = locate(front, back);
    if (!at) return false; // a definition that does not repeat its term ("A grouping of data that ...")
    if (LEAD_RE.test(at.before) && DEFINING_AFTER_RE.test(at.after)) return false;
    if (DEFINING_AFTER_RE.test(at.after) && /[,;:]\s*(?:(?:a|an|the)\s+)?$/.test(at.before)) return false; // "..., and X is ..."
    // "Two compounds are isomers if they share a formula ...": a condition that makes a thing the term.
    if (COPULA_BEFORE_RE.test(at.before) && CONDITION_AFTER_RE.test(at.after)) return false;
    if (NAMING_BEFORE_RE.test(at.before)) {
      const termWords = new Set(content(front));
      return content(at.text).filter((w) => !termWords.has(w)).length < MIN_NAMING_CONTENT;
    }
    return true;
  }

  // A formula is one token of its own, compared as written ("$\sec^{2} x$" is not the "x" of "Derivative of $\tan x$").
  const formulas = (s) => String(s || '').match(/\$[^$]*\$/g) || [];

  /**
   * A cue whose answer it already prints. A question that lists its candidates ("Which of these is reflexive? R_1 ...")
   * prints its answer among them by design, so only a label or an arrow cue ("... → ?") is judged.
   */
  function circular(front, back) {
    const cue = String(front || '').replace(/→\s*\?\s*$/, '');
    if (/\?/.test(cue)) return false;
    if (formulas(back).some((f) => !formulas(cue).includes(f))) return false;
    const own = new Set(content(cue));
    const said = content(back);
    return said.length > 0 && said.every((w) => own.has(w));
  }

  const FILLER_ITEM_RE = /^(?:[•▪◦-]\s*)?(?:etc\.?|and\s+so\s+on|\.{3}|…|others?)$/i;

  function withoutFiller(back) {
    const lines = String(back || '').split('\n');
    if (lines.length < 2) return FILLER_ITEM_RE.test(lines[0].trim()) ? '' : back;
    const kept = lines.filter((l) => !FILLER_ITEM_RE.test(l.trim()));
    return kept.length ? kept.join('\n') : '';
  }

  const MIN_STATEMENT_WORDS = 4;
  function statementCue(front) {
    const parts = String(front || '').split(/\s+[—–]\s+/);
    if (parts.length < 2) return false;
    const label = parts[parts.length - 1].trim();
    return label.split(/\s+/).length >= MIN_STATEMENT_WORDS && /,/.test(label) && !/\?$/.test(label);
  }

  /**
   * A finished card checked by the rules above: the card (its back without filler items), or null when its back
   * does not answer its front. A rule card is built from checked notation and passes as it is.
   */
  function answered(card) {
    if (!card || card.rule) return card;
    if (statementCue(card.front) || circular(card.front, card.back)) return null;
    const back = withoutFiller(card.back);
    if (!back) return null;
    if (back === card.back) return card;
    // "What are the 3 ...?" counted the filler item too.
    const before = String(card.back).split('\n').length;
    const after = back.split('\n').length;
    const front = String(card.front).replace(new RegExp(`\\bthe ${before}\\b`), `the ${after}`);
    return { ...card, front, back };
  }

  const api = { mentionsOnly, circular, withoutFiller, statementCue, answered };
  PDFStudy.cardAnswers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

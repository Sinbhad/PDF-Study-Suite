/**
 * Recall Labels: the prompt for a self-graded recall of a labelled slide card ("Praziquantel — Adverse effects",
 * "Clinical signs of pneumonia — Bronchitis", a slide's list of key points). recall-questions.js asks the
 * question; this module decides whether the card's own heading and label say what is asked, in words a student
 * would recognise, and whether the card's back is the whole answer to that.
 *   pointPrompt(fact, card, scope)  one labelled line:   Explain: Praziquantel — adverse effects.
 *                                                       Under "Clinical signs of pneumonia", what is given for "Bronchitis"?
 *   labelledPrompt(card, scope)     a label and its lines: Recall the 3 points of "Clorsulon — Indications".
 *   listPrompt(card, items, scope)  a slide's list:      Name the 5 key points about "Claw amputation" on slide 15.
 * A prompt is refused (''):
 *   - when the label describes the subject instead of naming a heading ("A gram-positive coccus", "Caused by a
 *     herpesvirus", "Diagnostic as well as therapeutic"): the line under it is another fact, not the answer;
 *   - when the label is plural ("Possible lesions") and the card holds one line: the slide's other lines under it
 *     went elsewhere, so the shown answer is not the complete set;
 *   - when a card has one line and no label ("Recall: Transtracheal wash"): nothing says which of the slide's lines
 *     about it is meant.
 * A slide's list whose topic the deck prints as the title of several slides is named with the slide it comes from.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const subjects = () => dep('quizSubjects', './quiz-subjects.js');
  const shapes = () => dep('slideLineShapes', './slide-line-shapes.js');

  const MAX_LABEL_WORDS = 6; // "Praziquantel — Adverse effects"; a longer label is a sentence cut in two
  const MIN_LIST_ITEMS = 2;
  const MAX_LIST_ITEMS = 8;
  const ARROW_PROMPT_RE = /→\s*\?\s*$/;
  // "Possible lesions", "Clinical signs": a heading that names several things ("-ss", "-us", "-is" are singular)
  const PLURAL_HEAD_RE = /[a-z]{2,}[^su\W]s$|[a-z]ies$/i;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
  /** "Adverse Effects" -> "adverse effects"; an acronym or a name keeps its capitals ("PCR", "Taenia"). */
  const lower = (s) => String(s || '').replace(/\b([A-Z])([a-z]+)\b/g, (w, a, b) => a.toLowerCase() + b);
  const plural = (label) => PLURAL_HEAD_RE.test(String(label || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).pop() || '');
  const describes = (label) => Boolean(shapes() && shapes().isDescription && shapes().isDescription(label));
  /**
   * One line under a heading that names several things ("Possible lesions" => "Fracture") is one of them; a line that
   * lists them itself ("Dipylidium caninum and Taenia pisiformis") is the set. An aspect ("Pharmacodynamics") is one.
   */
  // (A sentence under it, "Feed at night and hide by day", says something of the whole; an item names one member.)
  const MAX_ITEM_WORDS = 4;
  const isItem = (line) => words(String(line || '').replace(/\([^)]*\)/g, ' ')).length <= MAX_ITEM_WORDS && !/,|;|\band\b|\bor\b/.test(String(line || ''));
  const partOfSet = (label, line, ctx) => plural(label) && !subjects().isGenericHeading(label, ctx) && isItem(line);

  /** The slide a card comes from, when the scope prints the card's topic as the title of more than one slide. */
  function slideNote(card, scope) {
    const page = card.pageNumber || card.page;
    const topic = String(card.topic || card.subject || '').replace(/\s*\([^)]*\)\s*$/, '');
    if (!page || !topic || !scope.titlePages) return '';
    return scope.titlePages(topic).length > 1 ? ` on slide ${page}` : '';
  }

  /** The heading part of a front ("Clinical signs of pneumonia") and its label ("Bronchitis"). */
  function split(front) {
    const parts = String(front || '').replace(ARROW_PROMPT_RE, '').split(/\s+[—–]\s+/).map((p) => p.trim()).filter(Boolean);
    return { head: parts.length > 1 ? parts.slice(0, -1).join(' — ') : parts[0] || '', label: parts.length > 1 ? parts[parts.length - 1] : '' };
  }

  /** The prompt for a point fact that came from a labelled card ("Praziquantel — Adverse Effects"). */
  function pointPrompt(fact, card, scope) {
    if (!card) return '';
    // A table cell is asked with both of its headers named (table-questions.js), or not at all.
    if (card.table && card.table.column) return dep('tableQuestions', './table-questions.js').stemFor(card);
    const { head, label } = split(card.front);
    if (!label || words(label).length > MAX_LABEL_WORDS || /[.!?…]$/.test(label) || describes(label)) return '';
    const ctx = scope.ctx || {};
    // One line under "Possible lesions" is one lesion of several.
    if (partOfSet(label, fact.statement, ctx)) return '';
    // "Explain: Praziquantel — adverse effects": the label is an aspect of the subject and says what to explain.
    if (subjects().isGenericHeading(label, ctx)) return `Explain: ${fact.subject} — ${lower(label)}.`;
    // "Clinical signs of pneumonia — Bronchitis": the heading says what is listed, the label for which case. The
    // subject alone ("pneumonia — bronchitis") would ask what bronchitis is.
    const bare = head.replace(/\s*\([^)]*\)\s*$/, '');
    if (norm(bare) !== norm(fact.subject) && norm(bare).includes(norm(fact.subject)) && subjects().isGenericHeading(norm(bare).replace(norm(fact.subject), ' '), ctx)) {
      return `Under "${bare}", what is given for "${label}"?`;
    }
    return `Explain: ${fact.subject} — ${lower(label)}.`;
  }

  /**
   * A labelled card asked as the student sees it: its front names the subject and the label ("Lidocaine — Toxic
   * doses", "Rabies: Human exposure → ?"), the back is what to recall. Not when the front names no specific
   * subject ("Notes", a generic heading alone) or the back is a bare echo of the front.
   */
  function labelledPrompt(card, scope) {
    const front = String(card.front || '').trim();
    const back = String(card.back || '').trim();
    const ctx = scope.ctx || {};
    const parts = front.replace(ARROW_PROMPT_RE, '').split(/\s+[—–]\s+|:\s+/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length || !parts.some((p) => subjects().specificOf(p, ctx))) return '';
    const last = parts[parts.length - 1];
    if (subjects().isGenericHeading(last, ctx) && parts.length < 2) return '';
    if (norm(back) === norm(front) || norm(front).includes(norm(back))) return '';
    // "... — increased time in the GI" => "increased absorption": a sub-bullet cut in two, not a label and its point.
    if (parts.length > 1 && /^[a-z]/.test(last) && !ARROW_PROMPT_RE.test(front)) return '';
    if (ARROW_PROMPT_RE.test(front)) return `What follows? ${front}`;
    // "Anaerobes- These carry a worse prognosis ...": a label with a sentence glued on is no heading to recall under.
    if (parts.length > 1 && (words(last).length > MAX_LABEL_WORDS || describes(last))) return '';
    const items = back.split('\n').filter((l) => l.trim());
    if (items.length > MAX_LIST_ITEMS) return '';
    // "Streptococcus pneumonia Klebsiella spp": two names of a list read across its columns are no one label.
    if (shapes().fusedNames(last)) return '';
    const subject = front.replace(/\s*[.:]\s*$/, '');
    if (items.length >= MIN_LIST_ITEMS) return `Recall the ${items.length} points of "${subject}".`;
    // One line: only under a label that names one thing ("Recall: Transtracheal wash" could mean any line about it).
    if (parts.length < 2 || partOfSet(last, back, ctx)) return '';
    return `Recall: "${subject}".`;
  }

  /** A slide's own short list ("What are the key points of X?"), asked with its count. */
  function listPrompt(card, items, scope, topic) {
    if (items.length < MIN_LIST_ITEMS || items.length > MAX_LIST_ITEMS) return '';
    return `Name the ${items.length} key points about "${topic}"${slideNote(card, scope)}.`;
  }

  const api = { pointPrompt, labelledPrompt, listPrompt, slideNote, MAX_LABEL_WORDS };
  PDFStudy.recallLabels = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

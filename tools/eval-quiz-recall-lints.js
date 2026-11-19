/**
 * Lints for self-graded recall questions (type 'reveal') and for one fact asked twice in any form. Each is a heuristic
 * over the question text and returns null or { lint, detail }, like the other lint files; none reads src/.
 *
 *   recall_vague_prompt     a prompt that does not say what is asked: "Explain: X — label", "Recall: "X — Y"",
 *                           "Recall the 3 points of …", "Complete: "…"", "What follows? A → ?", "Name the key points
 *                           about X on slide 15", "In the row where A is "x", what is the B?"
 *   recall_count_mismatch   "(4 points)" / "(3 steps)" over an answer with another number of points
 *   recall_single_arrow     "What does A lead to?" over a single arrow with no causal verb: the slide's arrow there may
 *                           mean "is" ("Hematoma → bleeding between skull and dura"), not "leads to"
 *   recall_table_header     a table cell asked under a header that is abbreviated ("Maint.") or names the table's own
 *                           parts ("Column", "Row"): the student cannot tell what is asked
 *   fact_repeat_any_form    the same short answer, or a formula one question answers that another prints, asked twice
 *                           in one set or in the quiz and again in the test, whatever the two types
 *   review_same_form        a test "Review" question that asks a quiz fact in the form the quiz used (same answer, or
 *                           the same question with other letters)
 */
const found = (lint, detail) => ({ lint, detail });
const isReveal = (q) => q.type === 'reveal';
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const VAGUE_RE = /^(?:Explain:\s|Recall:\s|Recall the \d+ points of\b|Complete:\s|What follows\?)|\bkey points about\b|\bon slide \d+\b|^In the row where\b/;
function lintRecallVaguePrompt(q) {
  if (!isReveal(q)) return null;
  const m = String(q.question || '').match(VAGUE_RE);
  return m ? found('recall_vague_prompt', `"${m[0].trim()}" does not say what is asked`) : null;
}

/** Top-level points of a recalled list: "• " lines, or every line when none is bulleted. */
function pointsOf(answer) {
  const lines = String(answer || '').split('\n').filter((l) => l.trim());
  const bulleted = lines.filter((l) => /^•\s/.test(l));
  return bulleted.length ? bulleted.length : lines.length;
}
function lintRecallCountMismatch(q) {
  if (!isReveal(q)) return null;
  const text = String(q.question || '');
  const m = text.match(/\((\d+) (?:points|steps)\)/);
  if (!m) return null;
  const n = pointsOf(q.answer);
  return Number(m[1]) === n ? null : found('recall_count_mismatch', `says ${m[1]}, the answer has ${n}`);
}

const CAUSAL_RE = /\b(?:lead(?:s|ing)?\s+to|results?\s+in|causes?|caused\s+by|triggers?|allows?|induces?|produces?)\b/i;
function lintRecallSingleArrow(q) {
  if (!isReveal(q) || !/\blead to\?\s*$/.test(String(q.question || ''))) return null;
  const answer = String(q.answer || '');
  if (/→/.test(answer) || CAUSAL_RE.test(answer)) return null;
  const left = String(q.question).replace(/\blead to\?\s*$/, '');
  return CAUSAL_RE.test(left.replace(/^.*?what does\s+/i, '')) ? null : found('recall_single_arrow', 'one arrow and no causal verb asked as a consequence');
}

const TABLE_PART_RE = /^(?:table|column|row|field|record|cell|value|item|entry|name|term)s?$/i;
function lintRecallTableHeader(q) {
  if (!isReveal(q)) return null;
  const m = String(q.question || '').match(/^What is the (.+?) for the (.+?) "[^"]+"\?$/);
  if (!m) return null;
  const bad = [m[1], m[2]].find((h) => /\.$/.test(h.trim()) || TABLE_PART_RE.test(h.trim()));
  return bad ? found('recall_table_header', `header "${bad}" is abbreviated or names the table's own parts`) : null;
}

const CITATION_RE = /\s*\((?:p\.|pp\.|section)\s[^)]*\)\.?\s*$/i;
const MAX_SHORT_WORDS = 8;
/** A short answer's key ("Contrapositive" == "contrapositive"), or '' for a statement, a list or a True/False. */
function shortAnswer(q) {
  if (q.type === 'true_false') return '';
  const a = String(q.answer || '').replace(CITATION_RE, '').trim();
  if (!a || /\n/.test(a) || a.split(/\s+/).length > MAX_SHORT_WORDS) return '';
  return norm(a).replace(/(?:es|s)\b/g, '');
}
const formulaKey = (f) => String(f).replace(/\$/g, '').replace(/\\(?:left|right|,|;|!)/g, '').replace(/\\/g, '').replace(/[\s{}]/g, '').toLowerCase();
const formulas = (text) => (String(text || '').match(/\$[^$\n]+\$/g) || []).map(formulaKey).filter((k) => k.length >= 4);
/** Is `q` the fact `k` asks, in any form? -> a reason, or ''. */
function sameFactAnyForm(q, k) {
  const a = shortAnswer(q);
  if (a && a === shortAnswer(k)) return `same answer "${q.answer}"`;
  const shown = (x) => new Set(formulas(`${x.question} ${x.type === 'true_false' ? '' : x.answer}`));
  // (only a short answer is its formula: a definition that prints one among others answers no formula)
  const answered = (x) => (x.type === 'true_false' || String(x.answer || '').replace(CITATION_RE, '').split(/\s+/).length > MAX_SHORT_WORDS ? [] : formulas(x.answer));
  const inQ = shown(q);
  const inK = shown(k);
  if (answered(q).some((f) => inK.has(f)) || answered(k).some((f) => inQ.has(f))) return 'one answers a formula the other prints';
  return '';
}

function lintAnyFormRepeat(q, earlier = []) {
  for (const k of earlier) {
    const why = sameFactAnyForm(q, k);
    if (why) return found('fact_repeat_any_form', `${why} (as "${String(k.question).slice(0, 50)}")`);
  }
  return null;
}

const template = (q) => norm(String(q.question || '').replace(/\$[^$\n]+\$/g, ' F ').replace(/`[^`]+`/g, ' C '));
/**
 * Across the quiz and the test -> one finding or null per test question: a question that re-asks a quiz fact in any
 * form; a review question in the same form as the quiz asked it.
 */
function lintCrossSetRepeats(quiz, test) {
  return test.map((q) => {
    if (q.review) {
      // Its twin: the quiz question on the same source, or on the same answer; the same form is the same type, the
      // same short answer, or the same question with other letters.
      const twins = quiz.filter((k) => (k.source && k.source === q.source) || sameFactAnyForm(q, k));
      const twin = twins.find((k) => k.type === q.type || (shortAnswer(q) && shortAnswer(q) === shortAnswer(k)) || template(k) === template(q));
      return twin ? found('review_same_form', `asks quiz "${String(twin.question).slice(0, 50)}" in its own form`) : null;
    }
    const hit = lintAnyFormRepeat(q, quiz);
    return hit ? found('fact_repeat_any_form', `quiz: ${hit.detail}`) : null;
  });
}

const RECALL_LINTS = [lintRecallVaguePrompt, lintRecallCountMismatch, lintRecallSingleArrow, lintRecallTableHeader];
const RECALL_LINT_NAMES = ['recall_vague_prompt', 'recall_count_mismatch', 'recall_single_arrow', 'recall_table_header',
  'fact_repeat_any_form', 'review_same_form'];

module.exports = {
  RECALL_LINTS, RECALL_LINT_NAMES, lintRecallVaguePrompt, lintRecallCountMismatch, lintRecallSingleArrow, lintRecallTableHeader,
  lintAnyFormRepeat, lintCrossSetRepeats,
};

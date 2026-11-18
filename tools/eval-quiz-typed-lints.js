/**
 * Lints for typed-answer questions (type 'typed': the student types a short answer and the app checks it). Each is a
 * heuristic over one question and returns null or { lint, detail }, like the other lint files.
 *
 *   typed_answer_in_prompt   the answer (every content word of it, or the answer as a whole) is printed in its own
 *                            prompt, so it can be copied rather than recalled
 *   typed_answer_too_long    a term answer of more than four words, or a number answer that is not a number: too
 *                            long to type and check reliably
 *   typed_ambiguous_blank    the blank sits in a list ("A, ________ and C") or beside "or" naming no alternative, or
 *                            the prompt is hedged ("may", "often", "for example") or holds two blanks: more than one
 *                            answer could be right
 * The guessability solver (eval-quiz-solver.js) skips typed questions: with no options there is nothing to guess.
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });
const isTyped = (q) => q.type === 'typed';
const MAX_TERM_WORDS = 4;

/** The prompt as the student reads it: the quoted statement, or the whole question when nothing is quoted. */
function promptOf(q) {
  return T.stripMarkdown(String(q.question || ''));
}
const flat = (s) => ` ${T.stripMath(String(s || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

function lintTypedAnswerInPrompt(q) {
  if (!isTyped(q) || (q.form && q.form !== 'term')) return null;
  const prompt = promptOf(q).replace(T.BLANK_RE, ' ');
  if (flat(q.answer).trim() && flat(prompt).includes(flat(q.answer))) return found('typed_answer_in_prompt', `"${q.answer}" is printed in the prompt`);
  const own = T.contentWords(q.answer).map(T.crudeStem);
  const inPrompt = new Set(T.contentWords(prompt).map(T.crudeStem));
  return own.length && own.every((w) => inPrompt.has(w)) ? found('typed_answer_in_prompt', `every word of "${q.answer}" is in the prompt`) : null;
}

function lintTypedAnswerTooLong(q) {
  if (!isTyped(q)) return null;
  const answer = String(q.answer || '').trim();
  if (q.form === 'number') return /\d/.test(answer) ? null : found('typed_answer_too_long', `number answer "${answer}" holds no number`);
  if (q.form && q.form !== 'term') return null;
  const n = T.words(T.stripMath(answer)).length;
  return n > MAX_TERM_WORDS ? found('typed_answer_too_long', `${n} words: "${answer.slice(0, 60)}"`) : null;
}

const LIST_BLANK_RE = /,\s*_{4,}\s*(?:,|and\b|or\b)|_{4,}\s*,\s*[^,]{1,40},\s*(?:and|or)\b|\b(?:and|or)\s+_{4,}\s*[.,;]?\s*$/i;
const HEDGE_RE = /\b(?:may|might|could|often|usually|sometimes|typically|generally|some|e\.g\.|for example|for instance|such as|etc)\b/i;

function lintTypedAmbiguousBlank(q) {
  if (!isTyped(q)) return null;
  const prompt = promptOf(q);
  const blanks = (prompt.match(/_{4,}/g) || []).length;
  if (blanks > 1) return found('typed_ambiguous_blank', `${blanks} blanks`);
  if (blanks && LIST_BLANK_RE.test(T.stripMath(prompt))) return found('typed_ambiguous_blank', 'the blank is one item of a list');
  const hedge = T.stripMath(prompt).match(HEDGE_RE);
  return hedge ? found('typed_ambiguous_blank', `hedged prompt: "${hedge[0]}"`) : null;
}

const TYPED_LINTS = [lintTypedAnswerInPrompt, lintTypedAnswerTooLong, lintTypedAmbiguousBlank];
const TYPED_LINT_NAMES = ['typed_answer_in_prompt', 'typed_answer_too_long', 'typed_ambiguous_blank'];

module.exports = { TYPED_LINTS, TYPED_LINT_NAMES, lintTypedAnswerInPrompt, lintTypedAnswerTooLong, lintTypedAmbiguousBlank, isTyped };

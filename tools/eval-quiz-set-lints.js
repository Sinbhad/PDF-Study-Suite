/**
 * Set-level & cross-set repeat lints for tools/eval-quiz-lints.js:
 * duplicate facts, reused option sets, any-form repeats, review same-form checks, and quiz/test overlap.
 * Re-exports source True/False lints from eval-quiz-truth-lints.js for compatibility.
 */
const T = require('./eval-quiz-text.js');
const truthLints = require('./eval-quiz-truth-lints.js');
const { factIdentity } = require('./eval-quiz-content-lints.js');

const found = (lint, detail) => ({ lint, detail });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The fact a question tests, as a set of crude stems: the stem with its blank filled, plus a short answer. */
function factKey(q) {
  const body = T.stemBody(q);
  const answer = q.type === 'true_false' ? '' : String(q.answer || '');
  const text = T.BLANK_RE.test(body) ? body.replace(T.BLANK_RE, answer) : `${body} ${answer}`;
  const numbers = T.stripMath(text).match(/\b\d[\d.,]*\b/g) || [];
  return new Set([...T.contentWords(text).map(T.crudeStem), ...numbers]);
}

const DUPLICATE_JACCARD = 0.75;
const DUPLICATE_CONTAINMENT = 0.9;
const MIN_FACT_WORDS = 4;

function sameFact(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  if (small.size < MIN_FACT_WORDS) return false;
  let shared = 0;
  for (const w of small) if (large.has(w)) shared++;
  const jaccard = shared / (small.size + large.size - shared);
  return jaccard >= DUPLICATE_JACCARD || shared / small.size >= DUPLICATE_CONTAINMENT;
}

function lintDuplicateFact(q, earlier = []) {
  const mine = factKey(q);
  const twin = earlier.find((e) => sameFact(mine, factKey(e)));
  return twin ? found('duplicate_fact', `same fact as ${twin.id || 'an earlier question'}: "${T.stemBody(twin).slice(0, 70)}"`) : null;
}

const optionSetKey = (q) => T.choiceOptions(q).map((o) => o.toLowerCase().replace(/\s+/g, ' ').trim()).sort().join(' | ');

function lintReusedOptionSet(q, earlier = []) {
  if (T.choiceOptions(q).length < 3) return null;
  const key = optionSetKey(q);
  const twin = earlier.find((e) => T.choiceOptions(e).length >= 3 && optionSetKey(e) === key);
  return twin ? found('reused_option_set', `same options as ${twin.id || 'an earlier question'}: ${key}`) : null;
}

const CITATION_RE = /\s*\((?:p\.|pp\.|section)\s[^)]*\)\.?\s*$/i;
const MAX_SHORT_WORDS = 8;

function shortAnswer(q) {
  if (q.type === 'true_false') return '';
  const a = String(q.answer || '').replace(CITATION_RE, '').trim();
  if (!a || /\n/.test(a) || a.split(/\s+/).length > MAX_SHORT_WORDS) return '';
  return norm(a).replace(/(?:es|s)\b/g, '');
}
const formulaKey = (f) => String(f).replace(/\$/g, '').replace(/\\(?:left|right|,|;|!)/g, '').replace(/\\/g, '').replace(/[\s{}]/g, '').toLowerCase();
const formulas = (text) => (String(text || '').match(/\$[^$\n]+\$/g) || []).map(formulaKey).filter((k) => k.length >= 4);

function sameFactAnyForm(q, k) {
  const a = shortAnswer(q);
  if (a && a === shortAnswer(k)) return `same answer "${q.answer}"`;
  const shown = (x) => new Set(formulas(`${x.question} ${x.type === 'true_false' ? '' : x.answer}`));
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

function lintCrossSetRepeats(quiz, test) {
  return test.map((q) => {
    if (q.review) {
      const twins = quiz.filter((k) => (k.source && k.source === q.source) || sameFactAnyForm(q, k));
      const twin = twins.find((k) => k.type === q.type || (shortAnswer(q) && shortAnswer(q) === shortAnswer(k)) || template(k) === template(q));
      return twin ? found('review_same_form', `asks quiz "${String(twin.question).slice(0, 50)}" in its own form`) : null;
    }
    const hit = lintAnyFormRepeat(q, quiz);
    return hit ? found('fact_repeat_any_form', `quiz: ${hit.detail}`) : null;
  });
}

function lintQuizTestOverlap(quiz, test) {
  const seen = new Set(quiz.map(factIdentity));
  return test.map((q) => {
    const twin = seen.has(factIdentity(q)) ? q : lintDuplicateFact(q, quiz);
    if (!twin) return null;
    return { lint: 'quiz_test_overlap', detail: twin === q ? 'same source as a quiz question' : twin.detail.replace(/^same fact as/, 'same fact as quiz') };
  });
}

const REPEAT_LINTS = [lintDuplicateFact, lintReusedOptionSet];
const SET_LINT_NAMES = ['duplicate_fact', 'reused_option_set', 'fact_repeat_any_form', 'review_same_form', 'quiz_test_overlap'];

module.exports = {
  REPEAT_LINTS, SET_LINT_NAMES,
  lintDuplicateFact, lintReusedOptionSet, lintAnyFormRepeat, lintCrossSetRepeats, lintQuizTestOverlap,
  // Backward-compatible re-exports from truth-lints
  buildSourceIndex: truthLints.buildSourceIndex,
  lintTrueFalseCopied: truthLints.lintTrueFalseCopied,
  lintTrueFalseAntonymSwap: truthLints.lintTrueFalseAntonymSwap,
  lintTrueFalseDoubleAntonym: truthLints.lintTrueFalseDoubleAntonym,
};

/**
 * Option lints for tools/eval-quiz-lints.js: defects a student can see in the answer options alone.
 * Each takes one generated question and returns null or { lint, detail }. True/False and reveal-style
 * questions have no options to lint and always pass.
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });
const quote = (list) => list.map((o) => `"${o}"`).join(', ');

const MAX_PHRASE_WORDS = 6;
/** Short phrase options only: formulas and sentence-length options (definition matching) are not terms. */
const phraseOptions = (q) => T.choiceOptions(q).filter((o) => !T.isFormulaOption(o) && !/[.!?]$/.test(o.trim()) &&
  T.words(o).length >= 1 && T.words(o).length <= MAX_PHRASE_WORDS);

/** Why this option is not a noun phrase, or '' when it passes. */
function notNounPhraseReason(option) {
  const w = T.words(option);
  const first = w[0];
  const last = w[w.length - 1];
  if (T.AUXILIARIES.has(first) || T.FINITE_VERBS.has(first)) return 'starts with a verb';
  if (T.PREPOSITIONS.has(first) || T.CONJUNCTIONS.has(first)) return 'starts with a preposition or conjunction';
  if (T.CLAUSE_GERUNDS.has(first)) return 'starts with a gerund';
  if (/ing$/.test(first) && w.length > 1 && (T.DETERMINERS.has(w[1]) || T.PREPOSITIONS.has(w[1]))) return 'starts with a gerund';
  if (T.ADVERBS.has(first) || T.DISCOURSE.has(first) || (/ly$/.test(first) && first.length > 4 && !T.LY_NOT_ADVERB.has(first))) return 'starts with an adverb';
  if (w.length < 2) return '';
  if (T.AUXILIARIES.has(last) || T.FINITE_VERBS.has(last) || /(?:izes|ifies)$/.test(last)) return 'ends in a verb';
  if (T.PREPOSITIONS.has(last) || T.PARTICLES.has(last) || T.CONJUNCTIONS.has(last)) return 'ends in a preposition or particle';
  if (T.DETERMINERS.has(last)) return 'ends in a determiner';
  return '';
}

/**
 * option_not_noun_phrase: a short option starts with a verb form, clause gerund, adverb or preposition,
 * or ends in a verb, preposition/particle or determiner ("brings buyers", "price rises", "flow back").
 * A word-list heuristic, not a tagger: it only sees the first and last word, it only knows the verbs
 * in eval-quiz-text.js, and it lets noun-ambiguous verbs through ("chain backs", "complexes pump protons").
 */
function lintOptionNotNounPhrase(q) {
  const bad = phraseOptions(q).map((o) => [o, notNounPhraseReason(o)]).filter(([, why]) => why);
  return bad.length ? found('option_not_noun_phrase', bad.map(([o, why]) => `"${o}" ${why}`).join('; ')) : null;
}

/**
 * option_case_mix: some options start with a capital and some do not, so the odd ones stand out (or the
 * one matching the blank's position gives the answer away). Acronym-like first words are neutral.
 */
function lintOptionCaseMix(q) {
  const cases = T.choiceOptions(q).map((o) => [o, T.leadingCase(o)]).filter(([, c]) => c);
  const upper = cases.filter(([, c]) => c === 'upper').map(([o]) => o);
  const lower = cases.filter(([, c]) => c === 'lower').map(([o]) => o);
  if (!upper.length || !lower.length) return null;
  return found('option_case_mix', `capitalised ${quote(upper)} vs lower-case ${quote(lower)}`);
}

// "that" is left out: before a blank it is nearly always a conjunction ("an arrangement that ____").
const SINGULAR_BEFORE = new Set(['a', 'an', 'this', 'each', 'every']);
const PLURAL_BEFORE = new Set(['these', 'those', 'many', 'several', 'both', 'few', 'two', 'three', 'four']);
const SINGULAR_AFTER = new Set(['is', 'was', 'has', 'does']);
const PLURAL_AFTER = new Set(['are', 'were', 'have', 'do']);

/** 'singular' | 'plural' | null: what the words around the blank demand of whatever fills it. */
function demandedNumber(q) {
  if (q.type !== 'cloze') return null;
  const body = T.stripMath(T.stemBody(q));
  const m = body.match(/(?:([A-Za-z]+)\s+)?_{4,}(?:\s+([A-Za-z]+))?/);
  if (!m) return null;
  const before = (m[1] || '').toLowerCase();
  const after = (m[2] || '').toLowerCase();
  if (SINGULAR_BEFORE.has(before) || SINGULAR_AFTER.has(after)) return 'singular';
  if (PLURAL_BEFORE.has(before) || PLURAL_AFTER.has(after)) return 'plural';
  return null;
}

/**
 * option_number_mix: the stem demands a singular or a plural ("a ________", "________ are") and the
 * options are a mix, so the ones of the wrong number can be struck without knowing the subject.
 */
function lintOptionNumberMix(q) {
  const need = demandedNumber(q);
  if (!need) return null;
  const opts = phraseOptions(q);
  const wrong = opts.filter((o) => T.looksPlural(o) !== (need === 'plural'));
  if (!wrong.length || wrong.length === opts.length) return null;
  return found('option_number_mix', `stem demands ${need}; does not fit: ${quote(wrong)}`);
}

/** The article right before the blank ("a"/"an"), or null. */
function articleBeforeBlank(q) {
  const m = q.type === 'cloze' && T.stemBody(q).match(/\b(an?)\s+_{4,}/i);
  return m ? m[1].toLowerCase() : null;
}

/** option_article_mismatch: "a"/"an" before the blank agrees with only some of the options. */
function lintOptionArticleMismatch(q) {
  const article = articleBeforeBlank(q);
  if (!article) return null;
  const wrong = T.choiceOptions(q).filter((o) => T.articleFits(article, o) === false);
  return wrong.length ? found('option_article_mismatch', `"${article} ____" does not fit: ${quote(wrong)}`) : null;
}

const LENGTH_RATIO = 1.5;
const LENGTH_MARGIN = 10;

/** The option that is much longer than every other one (1.5x and 10+ characters), or null. */
function lengthOutlier(q) {
  const opts = T.choiceOptions(q);
  if (opts.length < 3) return null;
  const byLength = [...opts].sort((a, b) => b.length - a.length);
  const [longest, second] = byLength;
  return longest.length >= second.length * LENGTH_RATIO && longest.length - second.length >= LENGTH_MARGIN ? longest : null;
}

/** answer_length_tell: one option is much longer than the rest; test-wise students pick (or strike) it. */
function lintAnswerLengthTell(q) {
  const longest = lengthOutlier(q);
  if (!longest) return null;
  const role = longest === q.answer ? 'the answer' : 'a distractor';
  return found('answer_length_tell', `${role} "${longest.slice(0, 60)}" is ${longest.length} characters, far longer than the rest`);
}

/**
 * malformed_math: an option starts with "-$" (a list dash glued to a formula), has an odd number of "$",
 * or the set mixes options that contain math with options that are plain prose.
 */
function lintMalformedMath(q) {
  const opts = T.choiceOptions(q);
  const dashed = opts.filter((o) => /^\s*-\s*\$/.test(o));
  if (dashed.length) return found('malformed_math', `option starts with "-$": ${quote(dashed)}`);
  const unbalanced = opts.filter((o) => (o.replace(/\\\$/g, '').match(/\$/g) || []).length % 2 === 1);
  if (unbalanced.length) return found('malformed_math', `unbalanced "$": ${quote(unbalanced)}`);
  const withMath = opts.filter(T.hasMath);
  if (withMath.length && withMath.length < opts.length) {
    return found('malformed_math', `formula and prose mixed: ${quote(opts.filter((o) => !T.hasMath(o)))} beside ${quote(withMath)}`);
  }
  return null;
}

module.exports = {
  lintOptionNotNounPhrase, lintOptionCaseMix, lintOptionNumberMix, lintOptionArticleMismatch, lintAnswerLengthTell,
  lintMalformedMath, articleBeforeBlank, lengthOutlier,
};

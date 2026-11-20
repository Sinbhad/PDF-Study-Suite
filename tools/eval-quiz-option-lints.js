/**
 * Option lints for tools/eval-quiz-lints.js: defects visible in the answer options
 * (grammar/case/number/article/length tells, math formatting, identifier/class/kind/head-sibling/numeric-near issues).
 * Pure heuristics; true/false and reveal questions have no choice options and pass.
 */
const T = require('./eval-quiz-text.js');
const kinds = require('../src/nlp/quiz-kinds.js');

const found = (lint, detail) => ({ lint, detail });
const quote = (list) => list.map((o) => `"${o}"`).join(', ');

const MAX_PHRASE_WORDS = 6;
const phraseOptions = (q) => T.choiceOptions(q).filter((o) => !T.isFormulaOption(o) && !/[.!?]$/.test(o.trim()) &&
  T.words(o).length >= 1 && T.words(o).length <= MAX_PHRASE_WORDS);

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

function lintOptionNotNounPhrase(q) {
  const bad = phraseOptions(q).map((o) => [o, notNounPhraseReason(o)]).filter(([, why]) => why);
  return bad.length ? found('option_not_noun_phrase', bad.map(([o, why]) => `"${o}" ${why}`).join('; ')) : null;
}

function lintOptionCaseMix(q) {
  const cases = T.choiceOptions(q).map((o) => [o, T.leadingCase(o)]).filter(([, c]) => c);
  const upper = cases.filter(([, c]) => c === 'upper').map(([o]) => o);
  const lower = cases.filter(([, c]) => c === 'lower').map(([o]) => o);
  if (!upper.length || !lower.length) return null;
  return found('option_case_mix', `capitalised ${quote(upper)} vs lower-case ${quote(lower)}`);
}

const SINGULAR_BEFORE = new Set(['a', 'an', 'this', 'each', 'every']);
const PLURAL_BEFORE = new Set(['these', 'those', 'many', 'several', 'both', 'few', 'two', 'three', 'four']);
const SINGULAR_AFTER = new Set(['is', 'was', 'has', 'does']);
const PLURAL_AFTER = new Set(['are', 'were', 'have', 'do']);

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

function lintOptionNumberMix(q) {
  const need = demandedNumber(q);
  if (!need) return null;
  const opts = phraseOptions(q);
  const wrong = opts.filter((o) => T.looksPlural(o) !== (need === 'plural'));
  if (!wrong.length || wrong.length === opts.length) return null;
  return found('option_number_mix', `stem demands ${need}; does not fit: ${quote(wrong)}`);
}

function articleBeforeBlank(q) {
  const m = q.type === 'cloze' && T.stemBody(q).match(/\b(an?)\s+_{4,}/i);
  return m ? m[1].toLowerCase() : null;
}

function lintOptionArticleMismatch(q) {
  const article = articleBeforeBlank(q);
  if (!article) return null;
  const wrong = T.choiceOptions(q).filter((o) => T.articleFits(article, o) === false);
  return wrong.length ? found('option_article_mismatch', `"${article} ____" does not fit: ${quote(wrong)}`) : null;
}

const LENGTH_RATIO = 1.5;
const LENGTH_MARGIN = 10;

function lengthOutlier(q) {
  const opts = T.choiceOptions(q);
  if (opts.length < 3) return null;
  const byLength = [...opts].sort((a, b) => b.length - a.length);
  const [longest, second] = byLength;
  return longest.length >= second.length * LENGTH_RATIO && longest.length - second.length >= LENGTH_MARGIN ? longest : null;
}

function lintAnswerLengthTell(q) {
  const longest = lengthOutlier(q);
  if (!longest) return null;
  const role = longest === q.answer ? 'the answer' : 'a distractor';
  return found('answer_length_tell', `${role} "${longest.slice(0, 60)}" is ${longest.length} characters, far longer than the rest`);
}

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

/** identifier_option: option looks like a camelCase program identifier. */
function lintIdentifierOption(q) {
  const id = T.choiceOptions(q).find((o) => /^\S*[a-z]{2,}[A-Z]\S*$/.test(String(o).trim()));
  return id ? found('identifier_option', `"${id}"`) : null;
}

const listItems = (v) => String(v).split(/[,;/]|\band\b/i).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);

/** class_beside_members: table option is a lone plural class beside a list of members. */
function lintClassBesideMembers(q) {
  if (!/^What is the .+ for "/.test(String(q.question || ''))) return null;
  const opts = T.choiceOptions(q);
  const lists = opts.filter((o) => listItems(o).length >= 2);
  const members = new Set(lists.flatMap(listItems));
  const lone = opts.find((o) => listItems(o).length === 1 && /[^s]s$/i.test(o.trim()) && !members.has(o.trim().toLowerCase()));
  return lone && lists.length && (lone === q.answer || lists.includes(q.answer))
    ? found('class_beside_members', `"${lone}" beside "${lists[0]}"`) : null;
}

/** option_kind_of_answer: wrong option is a kind of the answer (or vice versa) in the scope. */
function lintOptionKindOfAnswer(q, ctx) {
  const idx = ctx && ctx.kinds ? ctx : (typeof ctx === 'string' ? buildOptionIndex(ctx) : null);
  if (!idx || !idx.kinds || q.type === 'true_false') return null;
  const answer = String(q.answer || '');
  if (!answer || answer.split(/\s+/).length > 5) return null;
  const twin = T.choiceOptions(q).find((o) => o !== answer && o.split(/\s+/).length <= 5 && idx.kinds.related(answer, o));
  return twin ? found('option_kind_of_answer', `"${twin}" and "${answer}" are kinds of one another in the scope`) : null;
}

const NAMING_RE = /\b(?:called|known\s+as|termed|named|refers?\s+to|(?:is|are)\s+defined|denoted)\b/i;
const head = (t) => (String(t).toLowerCase().replace(/\$[^$]*\$/g, ' ').match(/[a-z]+/g) || ['']).pop().replace(/(?:es|s)$/, '');
const firstWord = (t) => (String(t).toLowerCase().match(/[a-z]+/g) || [''])[0];
const isChoice = (q) => q.type !== 'true_false' && q.type !== 'reveal' && Array.isArray(q.options) && q.options.length >= 2;

/** head_sibling_option: cloze option shares the answer's head noun in a non-naming sentence. */
function lintHeadSiblingOption(q) {
  if (q.type !== 'cloze' || NAMING_RE.test(T.stemBody(q))) return null;
  const twin = T.choiceOptions(q).find((o) => o !== q.answer && head(o) === head(q.answer));
  return twin ? found('head_sibling_option', `"${twin}" beside "${q.answer}"`) : null;
}

/** option_count: choice question without exactly four options. */
function lintOptionCount(q) {
  if (!isChoice(q)) return null;
  return q.options.length === 4 ? null : found('option_count', `${q.options.length} options`);
}

const CATEGORY_RE = /\b([a-z]{3,})\s+(?:called|known\s+as|termed|named)\s+(?:a\(n\)\s+|an?\s+|the\s+)?_{4,}/i;
const MAX_TERM_WORDS = 5;

/** option_kind_tell: option head nouns or category noun single out the answer. */
function lintOptionKindTell(q) {
  if (!isChoice(q) || q.options.some((o) => String(o).split(/\s+/).length > MAX_TERM_WORDS || T.isFormulaOption(o))) return null;
  const answer = head(q.answer);
  const wrong = q.options.filter((o) => o !== q.answer).map(head);
  const shared = wrong.filter((h) => wrong.filter((x) => x === h).length >= 2);
  if (wrong.length >= 3 && !wrong.includes(answer) && shared.length === wrong.length) {
    return found('option_kind_tell', `every wrong option shares a head noun ("${shared[0]}"), the answer's is its own`);
  }
  const category = (T.stemBody(q).match(CATEGORY_RE) || [])[1];
  const heads = q.options.map(head);
  if (category && heads.filter((h) => h === head(category)).length === 1) return found('option_kind_tell', `only one option is a ${category}`);
  const firsts = q.options.map(firstWord);
  if (category && new Set(firsts).size === 1 && new Set(heads).size === heads.length) {
    return found('option_kind_tell', `options share "${firsts[0]}" but name different kinds; the stem asks for a ${category}`);
  }
  return null;
}

const ADJECTIVE_SLOT_RE = /\b(?:is|are|was|were|be)\s+(?:not\s+)?_{4,}\s+(?:to|than|with|from|of)\b/i;

/** adjective_slot: copula + blank + preposition offered multi-word phrases. */
function lintAdjectiveSlot(q) {
  if (!isChoice(q) || !ADJECTIVE_SLOT_RE.test(T.stemBody(q))) return null;
  const phrases = q.options.filter((o) => String(o).trim().split(/\s+/).length >= 2);
  return phrases.length ? found('adjective_slot', `"is ____ to" offered ${phrases.map((p) => `"${p}"`).join(', ')}`) : null;
}

const QTY_RE = /^(~|>|<|≥|≤)?\s?(\d+(?:\.\d+)?)(?:\s?[-–]\s?(\d+(?:\.\d+)?))?\s?([A-Za-z%/°]+)$/;
const unitKey = (u) => {
  const low = String(u || '').toLowerCase();
  const map = [[/^(?:h|hrs?|hours?)$/, 'hour'], [/^days?$/, 'day'], [/^(?:wks?|weeks?)$/, 'week'], [/^months?$/, 'month'], [/^(?:yrs?|years?)$/, 'year']];
  const hit = map.find(([re]) => re.test(low));
  return hit ? hit[1] : low;
};

/** numeric_option_near: numeric options overlap, differ in unit, or are within rounding tolerance. */
function lintNumericOptionNear(q) {
  if (!isChoice(q)) return null;
  const parse = (o) => {
    const m = String(o).trim().match(QTY_RE);
    return m ? { lo: Number(m[2]), hi: m[3] ? Number(m[3]) : Number(m[2]), unit: unitKey(m[4]) } : null;
  };
  const a = parse(q.answer);
  if (!a) return null;
  for (const o of q.options.filter((x) => x !== q.answer)) {
    const b = parse(o);
    if (!b) continue;
    if (b.unit !== a.unit) return found('numeric_option_near', `"${o}" is in another unit`);
    if (b.lo <= a.hi && a.lo <= b.hi) return found('numeric_option_near', `"${o}" overlaps "${q.answer}"`);
    const gap = b.lo > a.hi ? b.lo - a.hi : a.lo - b.hi;
    const near = a.unit === '%' ? gap < 10 : gap / Math.max(a.hi, b.hi) < 0.25;
    if (near) return found('numeric_option_near', `"${o}" is within rounding of "${q.answer}"`);
  }
  return null;
}

function buildOptionIndex(scopeText) {
  if (scopeText && scopeText.kinds) return scopeText;
  const sentences = String(scopeText || '').split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  return { kinds: kinds.index(sentences) };
}

const CORE_OPTION_LINTS = [
  lintOptionNotNounPhrase, lintOptionCaseMix, lintOptionNumberMix,
  lintOptionArticleMismatch, lintAnswerLengthTell, lintMalformedMath,
];
const ALL_OPTION_LINTS = [
  ...CORE_OPTION_LINTS,
  lintIdentifierOption, lintClassBesideMembers, lintOptionKindOfAnswer,
  lintHeadSiblingOption, lintOptionCount, lintOptionKindTell, lintAdjectiveSlot, lintNumericOptionNear,
];
const OPTION_LINT_NAMES = [
  'option_not_noun_phrase', 'option_case_mix', 'option_number_mix',
  'option_article_mismatch', 'answer_length_tell', 'malformed_math',
  'identifier_option', 'class_beside_members', 'option_kind_of_answer',
  'head_sibling_option', 'option_count', 'option_kind_tell', 'adjective_slot', 'numeric_option_near',
];

module.exports = {
  CORE_OPTION_LINTS, ALL_OPTION_LINTS, OPTION_LINT_NAMES, buildOptionIndex,
  lintOptionNotNounPhrase, lintOptionCaseMix, lintOptionNumberMix, lintOptionArticleMismatch, lintAnswerLengthTell,
  lintMalformedMath, articleBeforeBlank, lengthOutlier,
  lintIdentifierOption, lintClassBesideMembers, lintOptionKindOfAnswer,
  lintHeadSiblingOption, lintOptionCount, lintOptionKindTell, lintAdjectiveSlot, lintNumericOptionNear,
};

/**
 * Quiz-question quality lints. Each lint is a pure function of one generated question (plus the scope
 * text or the earlier questions of the same set where it needs them) and returns null when the question
 * is clean or { lint, detail } naming the defect.
 *
 * This file holds the lints that read the stem; the others live beside it and are re-exported here:
 *   eval-quiz-option-lints.js   the answer options (shape, consistency, math)
 *   eval-quiz-set-lints.js      True/False tells against the source text, and repeats within one set
 *   eval-quiz-content-lints.js  what a question tests: attribution stems, generic or filler subjects,
 *                               options true of the same subject, garbled tokens, dangling definitions
 *   eval-quiz-review-lints.js   the defects of the second blind review: extraction debris, worked-example talk,
 *                               swaps that name their owner, open completions, kinds offered against each other
 *
 * All of it is heuristic: closed word lists and suffix rules from eval-quiz-text.js, no parser. The lints
 * are meant to move in the right direction when generation improves, not to be right on every question.
 */
const T = require('./eval-quiz-text.js');
const optionLints = require('./eval-quiz-option-lints.js');
const setLints = require('./eval-quiz-set-lints.js');
const contentLints = require('./eval-quiz-content-lints.js');
const reviewLints = require('./eval-quiz-review-lints.js');
const thirdLints = require('./eval-quiz-third-lints.js');

const found = (lint, detail) => ({ lint, detail });

/** Stem tokens in order: words, the blank, and one MATH token per formula (a formula can be an antecedent). */
function stemTokens(body) {
  const text = T.stripMath(T.stripMarkdown(body), ' MATH ');
  return (text.match(/_{4,}|MATH|[A-Za-z][A-Za-z'’-]*/g) || []).map((t) => (T.BLANK_RE.test(t) || t === 'MATH' ? t : t.toLowerCase()));
}

/** Could this token be (part of) a noun phrase? Crude: a content-sized word that is not a known non-noun. */
const nounLike = (tok) => Boolean(tok) && (T.BLANK_RE.test(tok) || tok === 'MATH' ||
  (tok.length >= 3 && !T.NOT_NOUN.has(tok) && !(/ly$/.test(tok) && !T.LY_NOT_ADVERB.has(tok))));

const DEICTIC_RE = new RegExp([
  '\\b(?:as|see|shown|given|listed|described|mentioned|discussed|noted|defined|stated|the)\\s+(?:above|below)\\b',
  '\\bthe\\s+following\\b', '\\bas\\s+shown\\b', '\\bas\\s+follows\\b', '\\bshown\\s+in\\b',
].join('|'), 'i');
const PREP_BEFORE_THAT = new Set(['in', 'of', 'at', 'for', 'by', 'from', 'with', 'on', 'to', 'during', 'after', 'before', 'under']);

/**
 * unresolved_reference: the stem points at something the student cannot see.
 *   - "above", "below", "the following", "as shown" pointing outside the stem
 *   - this/these/those/such + noun anywhere ("this process"); "that" + noun only at the start of the stem
 *     or after a preposition, because "that" is usually a conjunction
 *   - bare this/these/those as the subject of a verb ("this produces lactate")
 *   - a bare it/they/them/its/their (or bare this/these/those) with no noun phrase earlier in the stem
 * Known weak spots: an expletive "it" outside the two patterns skipped below, and a pronoun whose real
 * antecedent is missing while some unrelated noun happens to precede it (not flagged).
 */
function lintUnresolvedReference(q) {
  const body = T.stemBody(q);
  const deictic = T.stripMath(body).match(DEICTIC_RE);
  if (deictic) return found('unresolved_reference', `points outside the stem: "${deictic[0]}"`);
  const toks = stemTokens(body);
  const nounBefore = (i) => toks.slice(0, i).some(nounLike);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i];
    const next = toks[i + 1];
    if (w === 'such' && next !== 'as' && next !== 'that') {
      const noun = next === 'a' || next === 'an' ? toks[i + 2] : next;
      if (nounLike(noun)) return found('unresolved_reference', `demonstrative: "such ${noun}"`);
    }
    if (w === 'this' || w === 'these' || w === 'those') {
      if (nounLike(next)) return found('unresolved_reference', `demonstrative: "${w} ${next}"`);
      // "this produces", "these are": a pronoun for the previous sentence, whatever nouns precede it here
      if (T.FINITE_VERBS.has(next) || T.AUXILIARIES.has(next)) return found('unresolved_reference', `bare "${w}" as the subject of "${next}"`);
      if (!nounBefore(i)) return found('unresolved_reference', `bare "${w}" with no earlier noun phrase`);
    }
    if (w === 'that' && nounLike(next) && (i === 0 || PREP_BEFORE_THAT.has(toks[i - 1]))) {
      return found('unresolved_reference', `demonstrative: "that ${next}"`);
    }
    if (w === 'it' || w === 'they' || w === 'them' || w === 'its' || w === 'their') {
      const expletive = w === 'it' && (next === 'follows' ||
        ((next === 'is' || next === 'was') && (toks[i + 3] === 'to' || toks[i + 3] === 'that')));
      if (!expletive && !nounBefore(i)) return found('unresolved_reference', `"${w}" with no earlier noun phrase`);
    }
  }
  return null;
}

/**
 * cloze_leading_blank: the blank opens the statement and is followed by a discourse word ("________
 * however ...") or a bare verb ("________ occur when ..."), so the stem reads as a broken sentence.
 * "________ is defined as ..." is fine and not flagged.
 */
function lintClozeLeadingBlank(q) {
  if (q.type !== 'cloze') return null;
  const toks = stemTokens(T.stemBody(q));
  if (!toks.length || !T.BLANK_RE.test(toks[0])) return null;
  const next = toks[1];
  if (T.DISCOURSE.has(next)) return found('cloze_leading_blank', `blank then discourse word "${next}"`);
  if (T.BARE_VERBS.has(next)) return found('cloze_leading_blank', `blank then bare verb "${next}"`);
  return null;
}

const MIN_CONTENT_WORDS = 6;

/** thin_stem: fewer than 6 content words (formulas count one each) are left once the blank is cut. */
function lintThinStem(q) {
  if (q.type !== 'cloze') return null;
  const body = T.stemBody(q).replace(T.BLANK_RE, ' ');
  const n = T.contentWords(body).length + T.mathCount(body);
  return n < MIN_CONTENT_WORDS ? found('thin_stem', `${n} content words after blanking`) : null;
}

/**
 * answer_leak: a content word of the answer (crudely stemmed) also appears in the stem. Words shared by
 * every other option are ignored, since they do not separate the answer from the distractors.
 * A question without options (a self-graded "define X" or "list the steps" prompt) is not linted: there
 * is no distractor to tell the answer from, and a definition of X naturally contains X.
 */
function lintAnswerLeak(q) {
  if (q.type === 'true_false' || !q.answer || T.isFormulaOption(q.answer)) return null;
  if (T.choiceOptions(q).length < 2) return null;
  const stems = (s) => T.contentWords(s).map(T.crudeStem);
  const inStem = new Set(stems(T.stemBody(q).replace(T.BLANK_RE, ' ')));
  const others = T.choiceOptions(q).filter((o) => o !== q.answer).map((o) => new Set(stems(o)));
  const leaked = [...new Set(stems(q.answer))].filter((w) => inStem.has(w) &&
    !(others.length && others.every((o) => o.has(w))));
  return leaked.length ? found('answer_leak', `stem contains "${leaked.join('", "')}" from the answer "${String(q.answer).slice(0, 60)}"`) : null;
}

const MAX_STEM_CHARS = 300;
const BULLET_RE = /[•▪◦‣■□●○◆►▸·]|(?:^|\n)\s*[-*–]\s+\S/;
const NOTE_SEPARATOR_RE = /\s(?:-|=|->|→)\s/g;

/**
 * whole_block_stem: the stem is a whole slide or paragraph rather than one statement. Over 300
 * characters (LaTeX source counts, so a formula-heavy theorem can trip this), a bullet glyph, or two or
 * more note separators (" - ", " = ", " -> ") outside math, which is what run-together note lines look like.
 */
function lintWholeBlockStem(q) {
  const body = T.stemBody(q);
  if (body.length > MAX_STEM_CHARS) return found('whole_block_stem', `${body.length} characters`);
  if (BULLET_RE.test(body)) return found('whole_block_stem', 'contains a bullet glyph');
  const seps = (T.stripMath(body).match(NOTE_SEPARATOR_RE) || []).length;
  return seps >= 2 ? found('whole_block_stem', `${seps} note separators run together`) : null;
}

const STEM_LINTS = [lintUnresolvedReference, lintClozeLeadingBlank, lintThinStem, lintAnswerLeak, lintWholeBlockStem];
const OPTION_LINTS = [optionLints.lintOptionNotNounPhrase, optionLints.lintOptionCaseMix, optionLints.lintOptionNumberMix,
  optionLints.lintOptionArticleMismatch, optionLints.lintAnswerLengthTell, optionLints.lintMalformedMath];
const SOURCE_LINTS = [setLints.lintTrueFalseCopied, setLints.lintTrueFalseAntonymSwap, setLints.lintTrueFalseDoubleAntonym];
const REPEAT_LINTS = [setLints.lintDuplicateFact, setLints.lintReusedOptionSet];

/** Every lint name, in report order. */
const LINT_NAMES = ['unresolved_reference', 'cloze_leading_blank', 'thin_stem', 'option_not_noun_phrase', 'option_case_mix',
  'option_number_mix', 'option_article_mismatch', 'answer_length_tell', 'answer_leak', 'tf_copied_true', 'tf_antonym_swap',
  'tf_double_antonym', 'malformed_math', 'duplicate_fact', 'reused_option_set', 'whole_block_stem',
  ...contentLints.CONTENT_LINT_NAMES, ...reviewLints.REVIEW_LINT_NAMES, ...thirdLints.THIRD_LINT_NAMES, 'quiz_test_overlap'];

/**
 * All findings for one question. `source` is the scope text (or a prebuilt index); `earlier` the questions
 * before it; `content` the content-lint index of the scope (built from `source` when it is the text).
 */
function lintQuestion(q, source, earlier = [], content = null, review = null) {
  const ctx = content || contentLints.buildContentIndex(typeof source === 'string' ? source : '');
  const rctx = review || reviewLints.buildReviewIndex(typeof source === 'string' ? source : '');
  const tctx = rctx.third || thirdLints.buildThirdIndex(typeof source === 'string' ? source : '');
  return [
    ...STEM_LINTS.map((lint) => lint(q)),
    ...OPTION_LINTS.map((lint) => lint(q)),
    ...SOURCE_LINTS.map((lint) => lint(q, source, earlier)),
    ...REPEAT_LINTS.map((lint) => lint(q, earlier)),
    ...contentLints.CONTENT_LINTS.map((lint) => lint(q, ctx)),
    ...reviewLints.REVIEW_LINTS.map((lint) => lint(q, rctx)),
    ...thirdLints.THIRD_LINTS.map((lint) => lint(q, tctx)),
  ].filter(Boolean);
}

/**
 * Lints one question set (a quiz, or a practice test) -> one findings array per question. Repeats are
 * looked for inside the set only; a practice-test question that re-asks a quiz fact is found by
 * lintQuizTestOverlap, which tools/eval-quiz.js runs across the two sets.
 */
function lintSet(questions, scopeText) {
  const source = setLints.buildSourceIndex(scopeText);
  const content = contentLints.buildContentIndex(scopeText);
  const review = { ...reviewLints.buildReviewIndex(scopeText), third: thirdLints.buildThirdIndex(scopeText) };
  return questions.map((q, i) => lintQuestion(q, source, questions.slice(0, i), content, review));
}

/**
 * quiz_test_overlap: a practice-test question that tests a fact the quiz of the same scope already asked
 * (same source sentence, or stem + answer overlap as in duplicate_fact). -> one finding or null per test question.
 */
function lintQuizTestOverlap(quiz, test) {
  const seen = new Set(quiz.map(contentLints.factIdentity));
  return test.map((q) => {
    const twin = seen.has(contentLints.factIdentity(q)) ? q : setLints.lintDuplicateFact(q, quiz);
    if (!twin) return null;
    return { lint: 'quiz_test_overlap', detail: twin === q ? 'same source as a quiz question' : twin.detail.replace(/^same fact as/, 'same fact as quiz') };
  });
}

module.exports = {
  lintQuizTestOverlap, ...contentLints, ...reviewLints, ...thirdLints,
  lintUnresolvedReference, lintClozeLeadingBlank, lintThinStem, lintAnswerLeak, lintWholeBlockStem,
  ...optionLints, ...setLints, LINT_NAMES, lintQuestion, lintSet,
};

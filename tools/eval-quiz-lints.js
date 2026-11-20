/**
 * Quiz-question quality lint aggregator. Each lint is a pure function of one generated question
 * (plus scope index or earlier questions where needed) returning null or { lint, detail }.
 *
 * Organized into cohesive domain modules:
 *   eval-quiz-stem-lints.js     stems (references, blanks, thin/long stems, leaks, debris, table/arrow/fused stems)
 *   eval-quiz-option-lints.js   answer options (shape, consistency, math, kinds, numeric proximity)
 *   eval-quiz-truth-lints.js    True/False tells, swap validity, non-claims, trace keys
 *   eval-quiz-content-lints.js  subject & content quality (attribution, generic subject, bad definitions, filler)
 *   eval-quiz-typed-lints.js    typed-answer prompts & length/ambiguity checks
 *   eval-quiz-recall-lints.js   self-graded recall prompts, completions, counts & headers
 *   eval-quiz-set-lints.js      within-set & cross-set repeats and quiz/test overlap
 */
const stemLints = require('./eval-quiz-stem-lints.js');
const optionLints = require('./eval-quiz-option-lints.js');
const truthLints = require('./eval-quiz-truth-lints.js');
const contentLints = require('./eval-quiz-content-lints.js');
const typedLints = require('./eval-quiz-typed-lints.js');
const recallLints = require('./eval-quiz-recall-lints.js');
const setLints = require('./eval-quiz-set-lints.js');

const REVIEW_LINTS = [
  stemLints.lintStemDebris, stemLints.lintExampleTalk,
  truthLints.lintSwapNamesOwner, truthLints.lintSwapNumberMismatch,
  recallLints.lintOpenCompletion, recallLints.lintDefineNotDefinition,
  stemLints.lintPseudoTerm, stemLints.lintBlankCutsCompound,
  optionLints.lintIdentifierOption, optionLints.lintClassBesideMembers, optionLints.lintOptionKindOfAnswer,
];
const REVIEW_LINT_NAMES = [
  'stem_debris', 'example_talk', 'swap_names_owner', 'swap_number_mismatch', 'open_completion',
  'define_not_definition', 'pseudo_term', 'blank_cuts_compound', 'identifier_option', 'class_beside_members',
  'option_kind_of_answer',
];

const THIRD_LINTS = [
  stemLints.lintArrowResidue, truthLints.lintTfNotAClaim, stemLints.lintCatchAllPrompt,
  recallLints.lintCompletionFragment, stemLints.lintTopicWordBlank, optionLints.lintHeadSiblingOption,
];
const THIRD_LINT_NAMES = [
  'arrow_residue', 'tf_not_a_claim', 'catch_all_prompt',
  'completion_fragment', 'topic_word_blank', 'head_sibling_option',
];

const FOURTH_LINTS = [
  optionLints.lintOptionCount, optionLints.lintOptionKindTell, optionLints.lintAdjectiveSlot,
  stemLints.lintTableStemUnnamed, recallLints.lintOpenStemPrompt, recallLints.lintFillerItem,
  truthLints.lintInheritedFalse,
];
const FOURTH_LINT_NAMES = [
  'option_count', 'option_kind_tell', 'adjective_slot', 'table_stem_unnamed',
  'open_stem_prompt', 'filler_item', 'inherited_false',
];

const FIFTH_LINTS = [
  recallLints.lintDescriptorLabel, recallLints.lintIncompleteSet, recallLints.lintOpenIsStem,
  recallLints.lintAttributeDefinition, recallLints.lintTruncatedKindTerm, stemLints.lintFusedNames,
  recallLints.lintYesNoReveal, stemLints.lintOperatorRow, optionLints.lintNumericOptionNear,
  truthLints.lintTraceKey,
];
const FIFTH_LINT_NAMES = [
  'descriptor_label', 'incomplete_set', 'open_is_stem', 'attribute_definition',
  'truncated_kind_term', 'fused_names', 'yes_no_reveal', 'operator_row',
  'numeric_option_near', 'trace_key',
];

function buildReviewIndex(scopeText) {
  return { ...optionLints.buildOptionIndex(scopeText), ...stemLints.buildStemIndex(scopeText) };
}
function buildThirdIndex(scopeText) {
  return { sentences: stemLints.buildStemIndex(scopeText).sentences };
}
function buildFourthIndex(scopeText) {
  return { blocks: truthLints.buildTruthIndex(scopeText).blocks };
}

/** Every lint name, preserving report order. */
const LINT_NAMES = [
  'unresolved_reference', 'cloze_leading_blank', 'thin_stem', 'option_not_noun_phrase', 'option_case_mix',
  'option_number_mix', 'option_article_mismatch', 'answer_length_tell', 'answer_leak', 'tf_copied_true', 'tf_antonym_swap',
  'tf_double_antonym', 'malformed_math', 'duplicate_fact', 'reused_option_set', 'whole_block_stem',
  ...contentLints.CONTENT_LINT_NAMES, ...REVIEW_LINT_NAMES, ...THIRD_LINT_NAMES,
  ...FOURTH_LINT_NAMES, ...typedLints.TYPED_LINT_NAMES, ...FIFTH_LINT_NAMES,
  'recall_vague_prompt', 'recall_count_mismatch', 'recall_single_arrow', 'recall_table_header',
  'fact_repeat_any_form', 'review_same_form',
  'quiz_test_overlap',
];

function buildDomainCtx(source, content, review) {
  const raw = typeof source === 'string' ? source : '';
  const cCtx = content || contentLints.buildContentIndex(raw);
  const rCtx = review || buildReviewIndex(raw);
  const sCtx = { words: rCtx.words || stemLints.buildStemIndex(raw).words, sentences: (rCtx.third && rCtx.third.sentences) || rCtx.sentences || stemLints.buildStemIndex(raw).sentences };
  const tCtx = rCtx.fourth || truthLints.buildTruthIndex(raw);
  return { cCtx, rCtx, sCtx, tCtx };
}

function lintQuestion(q, source, earlier = [], content = null, review = null) {
  const { cCtx, rCtx, sCtx, tCtx } = buildDomainCtx(source, content, review);
  const srcIdx = typeof source === 'string' ? truthLints.buildSourceIndex(source) : source;
  return [
    ...stemLints.CORE_STEM_LINTS.map((fn) => fn(q)),
    ...optionLints.CORE_OPTION_LINTS.map((fn) => fn(q)),
    ...truthLints.SOURCE_LINTS.map((fn) => fn(q, srcIdx, earlier)),
    ...setLints.REPEAT_LINTS.map((fn) => fn(q, earlier)),
    ...contentLints.CONTENT_LINTS.map((fn) => fn(q, cCtx)),
    stemLints.lintStemDebris(q, sCtx),
    stemLints.lintExampleTalk(q),
    truthLints.lintSwapNamesOwner(q),
    truthLints.lintSwapNumberMismatch(q),
    recallLints.lintOpenCompletion(q),
    recallLints.lintDefineNotDefinition(q),
    stemLints.lintPseudoTerm(q),
    stemLints.lintBlankCutsCompound(q),
    optionLints.lintIdentifierOption(q),
    optionLints.lintClassBesideMembers(q),
    optionLints.lintOptionKindOfAnswer(q, rCtx),
    stemLints.lintArrowResidue(q),
    truthLints.lintTfNotAClaim(q),
    stemLints.lintCatchAllPrompt(q),
    recallLints.lintCompletionFragment(q),
    stemLints.lintTopicWordBlank(q, sCtx),
    optionLints.lintHeadSiblingOption(q),
    optionLints.lintOptionCount(q),
    optionLints.lintOptionKindTell(q),
    optionLints.lintAdjectiveSlot(q),
    stemLints.lintTableStemUnnamed(q),
    recallLints.lintOpenStemPrompt(q),
    recallLints.lintFillerItem(q),
    truthLints.lintInheritedFalse(q, tCtx),
    ...typedLints.TYPED_LINTS.map((fn) => fn(q)),
    recallLints.lintDescriptorLabel(q),
    recallLints.lintIncompleteSet(q),
    recallLints.lintOpenIsStem(q),
    recallLints.lintAttributeDefinition(q),
    recallLints.lintTruncatedKindTerm(q),
    stemLints.lintFusedNames(q),
    recallLints.lintYesNoReveal(q),
    stemLints.lintOperatorRow(q),
    optionLints.lintNumericOptionNear(q),
    truthLints.lintTraceKey(q),
    recallLints.lintRecallVaguePrompt(q),
    recallLints.lintRecallCountMismatch(q),
    recallLints.lintRecallSingleArrow(q),
    recallLints.lintRecallTableHeader(q),
    setLints.lintAnyFormRepeat(q, earlier),
  ].filter(Boolean);
}

function lintSet(questions, scopeText) {
  const source = truthLints.buildSourceIndex(scopeText);
  const content = contentLints.buildContentIndex(scopeText);
  const review = {
    ...buildReviewIndex(scopeText),
    third: buildThirdIndex(scopeText),
    fourth: buildFourthIndex(scopeText),
  };
  return questions.map((q, i) => lintQuestion(q, source, questions.slice(0, i), content, review));
}

module.exports = {
  ...stemLints,
  ...optionLints,
  ...truthLints,
  ...contentLints,
  ...typedLints,
  ...recallLints,
  ...setLints,
  REVIEW_LINTS, REVIEW_LINT_NAMES, buildReviewIndex,
  THIRD_LINTS, THIRD_LINT_NAMES, buildThirdIndex,
  FOURTH_LINTS, FOURTH_LINT_NAMES, buildFourthIndex,
  FIFTH_LINTS, FIFTH_LINT_NAMES,
  LINT_NAMES, lintQuestion, lintSet,
};

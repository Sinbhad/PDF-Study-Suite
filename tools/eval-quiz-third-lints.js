/**
 * Lints for the defects the third blind review (2026-11-18) found in generated questions. Each is a heuristic over
 * the question (and the scope text where it says so) and returns null or { lint, detail }, like the other lint files.
 *
 *   arrow_residue        a card's "A → ?" prompt left in a stem or an option ("No human exposure → ?: DFA or PCR")
 *   tf_not_a_claim       a True/False statement that is a heading ("Proximal and Distal Blocks"), an evaluative
 *                        fragment with no subject ("Great for abscesses, ..."), a bare comparative ("Less volume
 *                        needed") or a short gerund heading ("Screening to identify carriers")
 *   catch_all_prompt     a recall or table question asked about a catch-all column ("Serology — Notes")
 *   completion_fragment  a "Complete:" answer that is one noun after an article ("a condition"), that runs into a
 *                        second sentence ("values. The == operator ..."), or that only repeats the prompt's words
 *   topic_word_blank     a blank whose answer is the scope's topic word, printed in most of its sentences (scope text)
 *   head_sibling_option  a cloze option on the answer's head word ("integrated circuits" beside "digital circuits")
 *                        in a sentence that does not name its blank: it may complete the sentence as well
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });
const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
const STOP = new Set('the a an of in on at by for to and or is are be with from that this as its it can may'.split(' '));
const content = (s) => (String(s || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:es|s)$/, ''));

function lintArrowResidue(q) {
  const text = [q.question, ...T.choiceOptions(q), q.answer].join('\n');
  return /→\s*\?\s*:/.test(text) || (q.type !== 'reveal' && /→\s*\?/.test(text)) ? found('arrow_residue', '"→ ?" left in the question') : null;
}

const HEADING_VERB_RE = /\b(?:is|are|was|were|has|have|can|cannot|may|must|should|will|does|do|causes?|leads?|results?)\b/i;
const EVALUATIVE_RE = /^(?:great|good|better|best|ideal|useful|excellent|poor|bad|worse|worst|helpful|preferred|nice)\s+(?:for|at|in|to|with|when|if)\b/i;
const COMPARATIVE_RE = /^(?:less|more|fewer|greater|lower|higher|better|worse|smaller|larger|shorter|longer)\b/i;

function lintTfNotAClaim(q) {
  if (q.type !== 'true_false') return null;
  const s = T.stemBody(q).replace(/[."]+$/, '').trim();
  const long = s.replace(/\$[^$]*\$/g, ' ').match(/[A-Za-z][A-Za-z'’-]{3,}/g) || [];
  if (long.length >= 2 && long.every((w) => /^[A-Z]/.test(w)) && !HEADING_VERB_RE.test(s)) return found('tf_not_a_claim', 'a heading');
  if (EVALUATIVE_RE.test(s)) return found('tf_not_a_claim', 'an evaluative fragment with no subject');
  if (COMPARATIVE_RE.test(s) && !/\bthan\b/i.test(s)) return found('tf_not_a_claim', 'a comparison with nothing to compare to');
  if (/^[A-Z][a-z]+ing\b/.test(s) && words(s).length <= 6 && !HEADING_VERB_RE.test(s)) return found('tf_not_a_claim', 'a gerund heading');
  return null;
}

const CATCH_ALL_RE = /\s[—–-]\s(?:notes?|comments?|remarks?|other|misc(?:ellaneous)?|details)\b|\bthe\s+(?:notes?|comments?|remarks?)\s+for\s+"/i;
function lintCatchAllPrompt(q) {
  return CATCH_ALL_RE.test(String(q.question || '')) ? found('catch_all_prompt', 'asked about a catch-all column') : null;
}

function lintCompletionFragment(q) {
  if (q.type !== 'reveal' || !/^Complete:/.test(String(q.question || ''))) return null;
  const answer = String(q.answer || '').trim();
  if (/^(?:a|an|the|some|one)\s+[\w-]+\.?$/i.test(answer)) return found('completion_fragment', `"${answer}" is one noun`);
  if (/[a-z0-9)][.!?]\s+[A-Z$]/.test(answer)) return found('completion_fragment', 'the answer runs into a second sentence');
  const prompt = new Set(content(q.question));
  const said = content(answer);
  if (said.length >= 2 && said.filter((w) => prompt.has(w)).length / said.length >= 0.6) return found('completion_fragment', 'the answer repeats the prompt');
  return null;
}

/** ctx.sentences: the scope's sentences (buildThirdIndex). */
function lintTopicWordBlank(q, ctx) {
  if (q.type !== 'cloze' || !ctx || ctx.sentences.length < 40) return null;
  const answer = String(q.answer || '').toLowerCase().trim();
  const one = answer.length <= 4 ? answer : /(?:ch|sh|ss|x)es$/.test(answer) ? answer.slice(0, -2) : answer.replace(/(?<!s)s$/, '');
  const re = new RegExp(`(?<![a-z])${one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?![a-z])`, 'i');
  const share = ctx.sentences.filter((s) => re.test(s)).length / ctx.sentences.length;
  return share >= 0.4 ? found('topic_word_blank', `"${q.answer}" is in ${Math.round(share * 100)}% of the sentences`) : null;
}

const NAMING_RE = /\b(?:called|known\s+as|termed|named|refers?\s+to|(?:is|are)\s+defined|denoted)\b/i;
const head = (t) => (String(t).toLowerCase().match(/[a-z]+/g) || ['']).pop().replace(/(?:es|s)$/, '');
function lintHeadSiblingOption(q) {
  if (q.type !== 'cloze' || NAMING_RE.test(T.stemBody(q))) return null;
  const twin = T.choiceOptions(q).find((o) => o !== q.answer && head(o) === head(q.answer));
  return twin ? found('head_sibling_option', `"${twin}" beside "${q.answer}"`) : null;
}

function buildThirdIndex(scopeText) {
  return { sentences: String(scopeText || '').split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 20) };
}

const THIRD_LINTS = [lintArrowResidue, lintTfNotAClaim, lintCatchAllPrompt, lintCompletionFragment, lintTopicWordBlank, lintHeadSiblingOption];
const THIRD_LINT_NAMES = ['arrow_residue', 'tf_not_a_claim', 'catch_all_prompt', 'completion_fragment', 'topic_word_blank', 'head_sibling_option'];

module.exports = {
  THIRD_LINTS, THIRD_LINT_NAMES, buildThirdIndex,
  lintArrowResidue, lintTfNotAClaim, lintCatchAllPrompt, lintCompletionFragment, lintTopicWordBlank, lintHeadSiblingOption,
};

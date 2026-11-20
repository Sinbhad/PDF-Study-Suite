/**
 * Self-graded recall lints (type 'reveal') for tools/eval-quiz-lints.js.
 * Consolidates all reveal/recall checks (vague prompts, open completions, bad definitions, incomplete sets,
 * filler list items, count mismatches, yes/no reveals, single arrows, abbreviated table headers).
 * Re-exports lintAnyFormRepeat and lintCrossSetRepeats from eval-quiz-set-lints.js for compatibility.
 */
const setLints = require('./eval-quiz-set-lints.js');

const found = (lint, detail) => ({ lint, detail });
const isReveal = (q) => q.type === 'reveal';

const STOP = new Set('the a an of in on at by for to and or is are be with from that this as its it can may'.split(' '));
const content = (s) => (String(s || '').toLowerCase().match(/[a-z][a-z-]{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(?:es|s)$/, ''));

const QUANTIFIED_RE = /^(?:some|most|many|several|few|certain|other|various|lots|all|any)\b/i;
function lintOpenCompletion(q) {
  const m = String(q.question || '').match(/^Complete: "(.*)"$/s);
  if (!isReveal(q) || !m) return null;
  const answer = String(q.answer || '').trim();
  if (answer.split(/\s+/).length < 2) return found('open_completion', `one-word answer "${answer}"`);
  if (QUANTIFIED_RE.test(m[1])) return found('open_completion', 'quantified subject');
  if (/\byou\b/i.test(m[1])) return found('open_completion', 'talks to the reader');
  return null;
}

const ADVICE_RE = /^(?:do\s+not|don['’]t|never|always|be\s+sure|make\s+sure|remember|note|avoid|beware)\b/i;
function lintDefineNotDefinition(q) {
  if (!isReveal(q) || !/^Define "/.test(String(q.question || ''))) return null;
  const answer = String(q.answer || '').trim();
  if (answer.split(/\s+/).length < 4) return found('define_not_definition', `bare name "${answer}"`);
  return ADVICE_RE.test(answer) ? found('define_not_definition', 'advice, not a meaning') : null;
}

function lintCompletionFragment(q) {
  if (!isReveal(q) || !/^Complete:/.test(String(q.question || ''))) return null;
  const answer = String(q.answer || '').trim();
  if (/^(?:a|an|the|some|one)\s+[\w-]+\.?$/i.test(answer)) return found('completion_fragment', `"${answer}" is one noun`);
  if (/[a-z0-9)][.!?]\s+[A-Z$]/.test(answer)) return found('completion_fragment', 'the answer runs into a second sentence');
  const prompt = new Set(content(q.question));
  const said = content(answer);
  if (said.length >= 2 && said.filter((w) => prompt.has(w)).length / said.length >= 0.6) return found('completion_fragment', 'the answer repeats the prompt');
  return null;
}

const OPEN_STEM_RE = /\s(?:can(?:not)?|may|might|could|will|has|have)\s*…"?\s*$/i;
function lintOpenStemPrompt(q) {
  if (!isReveal(q)) return null;
  return OPEN_STEM_RE.test(String(q.question || '').trim()) ? found('open_stem_prompt', 'a sentence stem with an open verb') : null;
}

const FILLER_LINE_RE = /^(?:[•▪◦-]\s*)?(?:etc\.?|and\s+so\s+on|\.{3}|…)$/i;
function lintFillerItem(q) {
  if (!isReveal(q)) return null;
  const lines = String(q.answer || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.some((l) => FILLER_LINE_RE.test(l)) ? found('filler_item', '"Etc." counted as a point') : null;
}

const DESCRIPTION_RE = /^(?:an?\s+\S|[a-z]+(?:ed|en)\s+(?:by|with|from|via|through)\s)/i;
const ADJECTIVE_RE = /(?:ic|al|ive|ous|ful|less|able|ible|ary|ory|ant|ent)$/;
function describes(label) {
  const t = String(label || '').trim();
  if (DESCRIPTION_RE.test(t)) return true;
  const all = t.toLowerCase().split(/\s+/);
  const words = all.filter((w) => !/^(?:and|or|but|as|well|not|very|also|both)$/.test(w));
  return words.length >= 2 && words.length < all.length && words.every((w) => ADJECTIVE_RE.test(w.replace(/[^a-z-]/g, '')));
}
const LABEL_PROMPT_RE = /^(?:Explain:\s+.+?\s+—\s+(.+?)\.|Recall(?: the \d+ points of)?:?\s+"[^"]*?—\s+([^"]+)")\s*$/;

function lintDescriptorLabel(q) {
  if (!isReveal(q)) return null;
  const m = String(q.question || '').match(LABEL_PROMPT_RE);
  const label = m && (m[1] || m[2]);
  return label && describes(label) ? found('descriptor_label', `label "${label}" describes the subject`) : null;
}

const PLURAL_RE = /[a-z]{2,}[^su\W]s$|[a-z]ies$/i;
function lintIncompleteSet(q) {
  if (!isReveal(q)) return null;
  const answer = String(q.answer || '').trim();
  const lines = answer.split('\n').filter((l) => l.trim());
  if (lines.length !== 1) return null;
  const single = String(q.question || '').match(/^Recall:\s+"([^"]+)"/);
  if (!single) return null;
  const parts = single[1].split(/\s+—\s+/);
  if (parts.length < 2) return found('incomplete_set', `"${single[1]}" names no label: which of its lines is meant?`);
  const label = parts[parts.length - 1].replace(/\([^)]*\)/g, ' ').trim();
  const item = answer.replace(/^[^:]{2,40}:\s+/, '').replace(/\([^)]*\)/g, ' ').trim();
  const short = item.split(/\s+/).length <= 4 && !/,|;|\band\b|\bor\b/.test(item);
  return PLURAL_RE.test(label.split(/\s+/).pop()) && short ? found('incomplete_set', `"${label}" names several things, the answer one`) : null;
}

const OPEN_IS_RE = /^Complete:\s+"[^",]{3,80}?\s+(?:is|are)\s*…"\s*$/;
function lintOpenIsStem(q) {
  if (!isReveal(q) || !OPEN_IS_RE.test(String(q.question || '').trim())) return null;
  return /^(?:a|an|the|one)\s/i.test(String(q.answer || '').trim()) ? null : found('open_is_stem', 'an is/are stem with no defining noun phrase');
}

const DEFINE_RE = /^Define\s+"([^"]+)"\.?$/;
function lintAttributeDefinition(q) {
  const m = isReveal(q) && String(q.question || '').trim().match(DEFINE_RE);
  if (!m) return null;
  return /^(?:very\s+|quite\s+|highly\s+)?[A-Za-z-]+,\s|^(?:very|quite|highly|extremely)\s/i.test(String(q.answer || '').trim())
    ? found('attribute_definition', `"${m[1]}" answered by attributes`) : null;
}

function lintTruncatedKindTerm(q) {
  const m = isReveal(q) && String(q.question || '').trim().match(DEFINE_RE);
  return m && /\b(?:type|class|grade|stage|phase|degree|group|level)$/i.test(m[1]) ? found('truncated_kind_term', `"${m[1]}" lost its number`) : null;
}

const YES_NO_Q_RE = /^(?:can|is|are|do|does|did|was|were|will|would|should|could|has|have)\b[^?]*\?\s*$/i;
const YES_NO_A_RE = /^(?:yes|no|not|never|always|only|none|usually|rarely)\b/i;
function lintYesNoReveal(q) {
  if (!isReveal(q) || !YES_NO_Q_RE.test(String(q.question || '').trim())) return null;
  return YES_NO_A_RE.test(String(q.answer || '').trim()) ? null : found('yes_no_reveal', 'a yes/no question answered by another point');
}

const VAGUE_RE = /^(?:Explain:\s|Recall:\s|Recall the \d+ points of\b|Complete:\s|What follows\?)|\bkey points about\b|\bon slide \d+\b|^In the row where\b/;
function lintRecallVaguePrompt(q) {
  if (!isReveal(q)) return null;
  const m = String(q.question || '').match(VAGUE_RE);
  return m ? found('recall_vague_prompt', `"${m[0].trim()}" does not say what is asked`) : null;
}

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

const RECALL_LINTS = [
  lintOpenCompletion, lintDefineNotDefinition, lintCompletionFragment, lintOpenStemPrompt, lintFillerItem,
  lintDescriptorLabel, lintIncompleteSet, lintOpenIsStem, lintAttributeDefinition, lintTruncatedKindTerm, lintYesNoReveal,
  lintRecallVaguePrompt, lintRecallCountMismatch, lintRecallSingleArrow, lintRecallTableHeader,
];
const RECALL_LINT_NAMES = [
  'open_completion', 'define_not_definition', 'completion_fragment', 'open_stem_prompt', 'filler_item',
  'descriptor_label', 'incomplete_set', 'open_is_stem', 'attribute_definition', 'truncated_kind_term', 'yes_no_reveal',
  'recall_vague_prompt', 'recall_count_mismatch', 'recall_single_arrow', 'recall_table_header',
];

module.exports = {
  RECALL_LINTS, RECALL_LINT_NAMES,
  lintOpenCompletion, lintDefineNotDefinition, lintCompletionFragment, lintOpenStemPrompt, lintFillerItem,
  lintDescriptorLabel, lintIncompleteSet, lintOpenIsStem, lintAttributeDefinition, lintTruncatedKindTerm, lintYesNoReveal,
  lintRecallVaguePrompt, lintRecallCountMismatch, lintRecallSingleArrow, lintRecallTableHeader,
  lintAnyFormRepeat: setLints.lintAnyFormRepeat,
  lintCrossSetRepeats: setLints.lintCrossSetRepeats,
};

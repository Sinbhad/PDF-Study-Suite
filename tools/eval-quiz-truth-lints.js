/**
 * Truth-value & correctness-key lints for tools/eval-quiz-lints.js:
 * True/False source tells, swap-owner/number/inheritance errors, non-claim T/F stems, and traced array keys.
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });

/** Sentences of one line; a split that lands inside a $...$ span is undone. */
function splitSentences(line) {
  const parts = line.split(/(?<=[.!?])\s+(?=[A-Z$"(])/);
  const out = [];
  for (const part of parts) {
    const open = out.length && (out[out.length - 1].match(/\$/g) || []).length % 2 === 1;
    if (open) out[out.length - 1] += ` ${part}`;
    else out.push(part);
  }
  return out;
}

/** Source sentences of the scope text as token lists + joined keys. */
function buildSourceIndex(scopeText) {
  if (scopeText && scopeText.sentences && scopeText.keys) return scopeText;
  const text = String(scopeText || '');
  const lines = text.split(/\n+/).map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean);
  const candidates = [...lines, ...lines.flatMap(splitSentences), ...splitSentences(lines.join(' '))];
  const seen = new Set();
  const sentences = [];
  for (const c of candidates) {
    const tokens = T.allTokens(c);
    const key = tokens.join(' ');
    if (tokens.length < 3 || seen.has(key)) continue;
    seen.add(key);
    sentences.push(tokens);
  }
  return { sentences, keys: seen };
}

const statementTokens = (q) => T.allTokens(T.stemBody(q));
const isTF = (q, answer) => q.type === 'true_false' && (!answer || q.answer === answer);
const isSwap = (q, answer) => isTF(q, answer) && q.construction === 'sibling_swap';

function lintTrueFalseCopied(q, source, earlier = []) {
  if (!isTF(q, 'True')) return null;
  if (isSwap(q, 'True') && earlier.some((e) => isSwap(e, 'False'))) return null;
  const tokens = statementTokens(q);
  return buildSourceIndex(source).keys.has(tokens.join(' '))
    ? found('tf_copied_true', `identical to a source sentence (${tokens.length} words)`)
    : null;
}

function lintTrueFalseAntonymSwap(q, source) {
  if (!isTF(q, 'False')) return null;
  const tokens = statementTokens(q);
  for (const sent of buildSourceIndex(source).sentences) {
    if (sent.length !== tokens.length) continue;
    const diff = [];
    for (let i = 0; i < sent.length && diff.length < 2; i++) if (sent[i] !== tokens[i]) diff.push(i);
    if (diff.length !== 1) continue;
    const [was, now] = [sent[diff[0]], tokens[diff[0]]];
    if (T.isAntonymPair(was, now)) return found('tf_antonym_swap', `source says "${was}", statement says "${now}"`);
  }
  return null;
}

function lintTrueFalseDoubleAntonym(q) {
  if (!isTF(q)) return null;
  const counts = new Map();
  for (const w of T.words(T.stemBody(q))) if (T.ANTONYM_WORDS.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  const twice = [...counts].filter(([, n]) => n >= 2).map(([w]) => w);
  return twice.length ? found('tf_double_antonym', `"${twice.join('", "')}" appears twice`) : null;
}

const SWAP_STEM_RE = /^True or False: the following is true of "([^"]+)"\./;
const OWNER_RE = /This is true of "([^"]+)", not of/;
const OPENER_RE = /^([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\s+(?:is|are|was|were|has|have|can|cannot|does|do)\b/;

function lintSwapNamesOwner(q) {
  if (q.type !== 'true_false' || q.answer !== 'False') return null;
  const asked = (String(q.question).match(SWAP_STEM_RE) || [])[1];
  const owner = (String(q.explanation || '').match(OWNER_RE) || [])[1];
  if (!asked) return null;
  const statement = T.stemBody(q);
  const said = new Set(T.contentWords(statement).map(T.crudeStem));
  const askedWords = new Set(T.contentWords(asked).map(T.crudeStem));
  if (owner) {
    const named = T.contentWords(owner).map(T.crudeStem).filter((w) => !askedWords.has(w) && said.has(w));
    if (named.length) return found('swap_names_owner', `names "${owner}" ("${named[0]}")`);
  }
  const opener = statement.match(OPENER_RE);
  if (opener && /^[A-Z][a-z]{5,}$/.test(opener[1]) && !askedWords.has(T.crudeStem(opener[1].toLowerCase()))) {
    return found('swap_names_owner', `opens on another name "${opener[1]}"`);
  }
  return null;
}

function lintSwapNumberMismatch(q) {
  if (q.type !== 'true_false') return null;
  const asked = (String(q.question).match(SWAP_STEM_RE) || [])[1];
  const verb = (T.stemBody(q).match(/^(Is|Are|Was|Were|Has|Have)\b/) || [])[1];
  if (!asked || !verb) return null;
  const pluralVerb = /^(?:Are|Were|Have)$/.test(verb);
  return T.looksPlural(asked.replace(/\$[^$]*\$/g, 'x')) !== pluralVerb ? found('swap_number_mismatch', `"${asked}" with "${verb} ..."`) : null;
}

const words = (s) => String(s || '').split(/\s+/).filter(Boolean);
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

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function lintInheritedFalse(q, ctx) {
  const blocks = ctx && (ctx.blocks || (ctx.fourth && ctx.fourth.blocks))
    ? (ctx.blocks || ctx.fourth.blocks)
    : (typeof ctx === 'string' ? buildTruthIndex(ctx).blocks : null);
  if (q.type !== 'true_false' || q.answer !== 'False' || !blocks) return null;
  const asked = (String(q.question || '').match(/"([^"]+)"/) || [])[1];
  const owner = (String(q.explanation || '').match(/true of "([^"]+)", not of/) || [])[1];
  if (!asked || !owner || owner.length < 3) return null;
  const askedRe = new RegExp(escapeRe(asked), 'i');
  const perRe = new RegExp(`\\b(?:per|same\\s+as|similar\\s+to|like|as\\s+for)\\s+${escapeRe(owner)}`, 'i');
  const block = blocks.find((b) => askedRe.test(b) && perRe.test(b));
  return block ? found('inherited_false', `"${asked}" is said to work per "${owner}"`) : null;
}

const isChoice = (q) => q.type !== 'true_false' && q.type !== 'reveal' && Array.isArray(q.options) && q.options.length >= 2;

/** Recomputes a traced array question's key from its stem (sum, largest, linear search position). */
function lintTraceKey(q) {
  const stem = String(q.question || '');
  const arr = stem.match(/\{\s*(-?\d+(?:\s*,\s*-?\d+)+)\s*\}/);
  if (!isChoice(q) || !arr) return null;
  const v = arr[1].split(',').map((x) => Number(x.trim()));
  let want = null;
  if (/\bsum\b[^?]*\btotal\b/i.test(stem)) want = v.reduce((s, x) => s + x, 0);
  else if (/\blargest\b/i.test(stem)) want = Math.max(...v);
  else if (/linear search[^?]*searchedValue\s*=\s*(-?\d+)/i.test(stem)) {
    const target = Number(stem.match(/searchedValue\s*=\s*(-?\d+)/i)[1]);
    const at = v.indexOf(target);
    want = at < 0 ? v.length : at;
  }
  if (want === null) return null;
  return String(want) === String(q.answer).trim() ? null : found('trace_key', `the array gives ${want}, the key says ${q.answer}`);
}

function buildTruthIndex(scopeText) {
  if (scopeText && scopeText.source && scopeText.blocks) return scopeText;
  const text = String(scopeText || '');
  return {
    source: buildSourceIndex(text),
    blocks: text.split(/\n\s*\n/).filter((b) => b.trim()),
  };
}

const SOURCE_LINTS = [lintTrueFalseCopied, lintTrueFalseAntonymSwap, lintTrueFalseDoubleAntonym];
const TRUTH_LINTS = [lintSwapNamesOwner, lintSwapNumberMismatch, lintTfNotAClaim, lintTraceKey];
const TRUTH_LINT_NAMES = [
  'tf_copied_true', 'tf_antonym_swap', 'tf_double_antonym',
  'swap_names_owner', 'swap_number_mismatch', 'tf_not_a_claim', 'inherited_false', 'trace_key',
];

module.exports = {
  SOURCE_LINTS, TRUTH_LINTS, TRUTH_LINT_NAMES, buildSourceIndex, buildTruthIndex,
  lintTrueFalseCopied, lintTrueFalseAntonymSwap, lintTrueFalseDoubleAntonym,
  lintSwapNamesOwner, lintSwapNumberMismatch, lintTfNotAClaim, lintInheritedFalse, lintTraceKey,
};

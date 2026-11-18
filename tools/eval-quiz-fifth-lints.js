/**
 * Lints for the defects the fifth blind review found. Each is a heuristic over one question and returns null or
 * { lint, detail }, like the other lint files; none reads src/.
 *
 *   descriptor_label      a recall prompt whose label describes the subject instead of naming a heading ("Explain: X —
 *                         a gram-positive coccus", "— caused by a herpesvirus", "— diagnostic as well as therapeutic"):
 *                         the line shown under it is another fact, not its answer
 *   incomplete_set        a recall whose label names several things ("Possible lesions") answered by one short item,
 *                         or a "Recall: "X"" with no label at all answered by one line
 *   open_is_stem          "Complete: "Surrogate keys are …"": an is/are stem any property of the subject completes
 *   attribute_definition  "Define X" answered by a run of attributes ("Large, marked size variation", "very thin")
 *   truncated_kind_term   "Define "Hansen's type"": a numbered kind cut before its number
 *   fused_names           two Latin binomials run together ("Streptococcus equi Staphylococcus spp."): a list read
 *                         across its columns
 *   yes_no_reveal         a yes/no lecture question revealed with an answer that says neither
 *   operator_row          a question about one row of an operator table (`where Java is ">"`): it only names a symbol
 *   numeric_option_near   a choice of values with an option overlapping the answer's range, of another unit, or
 *                         within a quarter of it (a matter of rounding, not another fact)
 *   trace_key             a traced array question (sum, largest, linear search) whose key is not what the array gives
 */
const found = (lint, detail) => ({ lint, detail });
const isReveal = (q) => q.type === 'reveal';
const isChoice = (q) => q.type !== 'true_false' && q.type !== 'reveal' && Array.isArray(q.options) && q.options.length >= 2;

// A description, not a heading: an indefinite article, a participle with its agent, adjectives alone.
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

const BINOMIAL_RE = /\b[A-Z][a-z]{3,}\s+(?:spp?\.?|[a-z]{3,}(?:us|is|a|ae|i|um|es|ii|ens|ensis|ica|ans|alis|ides))(?=[\s.,;:"]|$)/g;
function fused(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const hits = [...t.matchAll(BINOMIAL_RE)];
  for (let i = 1; i < hits.length; i++) {
    const between = t.slice(hits[i - 1].index + hits[i - 1][0].length, hits[i].index);
    if (!/[,;:()/&"|•]|\b(?:and|or|vs|versus|than|with|to|in|of)\b/i.test(between) && between.trim().split(/\s+/).filter(Boolean).length <= 1) return `${hits[i - 1][0]} ${hits[i][0]}`;
  }
  return '';
}
function lintFusedNames(q) {
  const texts = [q.question, ...String(q.answer || '').split('\n'), ...(q.options || [])];
  const hit = texts.map(fused).find(Boolean);
  return hit ? found('fused_names', `"${hit}" runs two names together`) : null;
}

const YES_NO_Q_RE = /^(?:can|is|are|do|does|did|was|were|will|would|should|could|has|have)\b[^?]*\?\s*$/i;
const YES_NO_A_RE = /^(?:yes|no|not|never|always|only|none|usually|rarely)\b/i;
function lintYesNoReveal(q) {
  if (!isReveal(q) || !YES_NO_Q_RE.test(String(q.question || '').trim())) return null;
  return YES_NO_A_RE.test(String(q.answer || '').trim()) ? null : found('yes_no_reveal', 'a yes/no question answered by another point');
}

function lintOperatorRow(q) {
  const m = String(q.question || '').match(/In the row where .+? is "([^"]+)"/);
  return m && !/[A-Za-z0-9]/.test(m[1]) ? found('operator_row', `row "${m[1]}" is a bare symbol`) : null;
}

const QTY_RE = /^(~|>|<|≥|≤)?\s?(\d+(?:\.\d+)?)(?:\s?[-–]\s?(\d+(?:\.\d+)?))?\s?([A-Za-z%/°]+)$/;
const unitKey = (u) => {
  const low = String(u || '').toLowerCase();
  const map = [[/^(?:h|hrs?|hours?)$/, 'hour'], [/^days?$/, 'day'], [/^(?:wks?|weeks?)$/, 'week'], [/^months?$/, 'month'], [/^(?:yrs?|years?)$/, 'year']];
  const hit = map.find(([re]) => re.test(low));
  return hit ? hit[1] : low;
};
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

const FIFTH_LINTS = [lintDescriptorLabel, lintIncompleteSet, lintOpenIsStem, lintAttributeDefinition, lintTruncatedKindTerm,
  lintFusedNames, lintYesNoReveal, lintOperatorRow, lintNumericOptionNear, lintTraceKey];
const FIFTH_LINT_NAMES = ['descriptor_label', 'incomplete_set', 'open_is_stem', 'attribute_definition', 'truncated_kind_term',
  'fused_names', 'yes_no_reveal', 'operator_row', 'numeric_option_near', 'trace_key'];

module.exports = {
  FIFTH_LINTS, FIFTH_LINT_NAMES, lintDescriptorLabel, lintIncompleteSet, lintOpenIsStem, lintAttributeDefinition,
  lintTruncatedKindTerm, lintFusedNames, lintYesNoReveal, lintOperatorRow, lintNumericOptionNear, lintTraceKey,
};

/**
 * Lints for the defects the fourth blind review found. Each is a heuristic over one question (and the scope text
 * where it says so) and returns null or { lint, detail }, like the other lint files.
 *
 *   option_count         a choice question without exactly four options (with three, one implausible option leaves
 *                        a coin toss)
 *   option_kind_tell     the options' head nouns single out the answer: every wrong option shares its head with
 *                        another wrong option while the answer's head is its own ("clock skew / clock gating / clock
 *                        generator" in a stem that calls the blank a device), or a naming stem's category noun
 *                        ("a timing device called a(n) ____") is the head of exactly one option
 *   adjective_slot       a blank between a bare copula and a preposition ("is ________ to") offered phrases of two or
 *                        more words: only an adjective reads there
 *   table_stem_unnamed   a table question that does not name the column of its row value ("What is the serovar for
 *                        "dogs"?" leaves open whether dogs are the maintenance or the incidental host)
 *   open_stem_prompt     a self-graded prompt that is a sentence stem ending in a modal or "has" ("A bit can …"):
 *                        anything could follow
 *   filler_item          a recalled list that counts "Etc." or "..." as one of its points
 *   inherited_false      a False that sets another subject's statement under X while the scope says X behaves "per"
 *                        / "same as" / "like" that subject (scope text, slide by slide)
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });
const head = (t) => (String(t).toLowerCase().replace(/\$[^$]*\$/g, ' ').match(/[a-z]+/g) || ['']).pop().replace(/(?:es|s)$/, '');
const first = (t) => (String(t).toLowerCase().match(/[a-z]+/g) || [''])[0];
const isChoice = (q) => q.type !== 'true_false' && q.type !== 'reveal' && Array.isArray(q.options) && q.options.length >= 2;

function lintOptionCount(q) {
  if (!isChoice(q)) return null;
  return q.options.length === 4 ? null : found('option_count', `${q.options.length} options`);
}

const CATEGORY_RE = /\b([a-z]{3,})\s+(?:called|known\s+as|termed|named)\s+(?:a\(n\)\s+|an?\s+|the\s+)?_{4,}/i;
const MAX_TERM_WORDS = 5;

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
  // "clock skew / clock gating / clock generator": one modifier, three kinds of thing; the stem's category decides.
  const firsts = q.options.map(first);
  if (category && new Set(firsts).size === 1 && new Set(heads).size === heads.length) {
    return found('option_kind_tell', `options share "${firsts[0]}" but name different kinds; the stem asks for a ${category}`);
  }
  return null;
}

const ADJECTIVE_SLOT_RE = /\b(?:is|are|was|were|be)\s+(?:not\s+)?_{4,}\s+(?:to|than|with|from|of)\b/i;
function lintAdjectiveSlot(q) {
  if (!isChoice(q) || !ADJECTIVE_SLOT_RE.test(T.stemBody(q))) return null;
  const phrases = q.options.filter((o) => String(o).trim().split(/\s+/).length >= 2);
  return phrases.length ? found('adjective_slot', `"is ____ to" offered ${phrases.map((p) => `"${p}"`).join(', ')}`) : null;
}

function lintTableStemUnnamed(q) {
  if (!/\bTable\b/.test(String(q.badge || ''))) return null;
  return /\bwhere\b.+\bis\s+"[^"]+",\s+what\s+is\s+the\b/i.test(String(q.question || '')) ? null
    : found('table_stem_unnamed', 'the stem does not name the column of its row value');
}

const OPEN_STEM_RE = /\s(?:can(?:not)?|may|might|could|will|has|have)\s*…"?\s*$/i;
function lintOpenStemPrompt(q) {
  if (q.type !== 'reveal') return null;
  return OPEN_STEM_RE.test(String(q.question || '').trim()) ? found('open_stem_prompt', 'a sentence stem with an open verb') : null;
}

const FILLER_LINE_RE = /^(?:[•▪◦-]\s*)?(?:etc\.?|and\s+so\s+on|\.{3}|…)$/i;
function lintFillerItem(q) {
  if (q.type !== 'reveal') return null;
  const lines = String(q.answer || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length >= 2 && lines.some((l) => FILLER_LINE_RE.test(l)) ? found('filler_item', '"Etc." counted as a point') : null;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** ctx.blocks: the scope text split into slides (or paragraphs). */
function lintInheritedFalse(q, ctx) {
  if (q.type !== 'true_false' || q.answer !== 'False' || !ctx) return null;
  const asked = (String(q.question || '').match(/"([^"]+)"/) || [])[1];
  const owner = (String(q.explanation || '').match(/true of "([^"]+)", not of/) || [])[1];
  if (!asked || !owner || owner.length < 3) return null;
  const askedRe = new RegExp(escapeRe(asked), 'i');
  const perRe = new RegExp(`\\b(?:per|same\\s+as|similar\\s+to|like|as\\s+for)\\s+${escapeRe(owner)}`, 'i');
  const block = ctx.blocks.find((b) => askedRe.test(b) && perRe.test(b));
  return block ? found('inherited_false', `"${asked}" is said to work per "${owner}"`) : null;
}

function buildFourthIndex(scopeText) {
  return { blocks: String(scopeText || '').split(/\n\s*\n/).filter((b) => b.trim()) };
}

const FOURTH_LINTS = [lintOptionCount, lintOptionKindTell, lintAdjectiveSlot, lintTableStemUnnamed, lintOpenStemPrompt, lintFillerItem, lintInheritedFalse];
const FOURTH_LINT_NAMES = ['option_count', 'option_kind_tell', 'adjective_slot', 'table_stem_unnamed', 'open_stem_prompt', 'filler_item', 'inherited_false'];

module.exports = {
  FOURTH_LINTS, FOURTH_LINT_NAMES, buildFourthIndex,
  lintOptionCount, lintOptionKindTell, lintAdjectiveSlot, lintTableStemUnnamed, lintOpenStemPrompt, lintFillerItem, lintInheritedFalse,
};

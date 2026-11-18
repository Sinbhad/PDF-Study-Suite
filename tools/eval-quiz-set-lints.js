/**
 * Lints for tools/eval-quiz-lints.js that need more than the question itself:
 *   - True/False tells, judged against the sentences of the scope text the question was generated from
 *   - repeats, judged against the earlier questions of the same quiz or practice test
 * Each returns null or { lint, detail }, like the single-question lints.
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

/**
 * Source sentences of the scope text as token lists: every line, every sentence of a line, and every
 * sentence of the text with line breaks joined (extracted PDF text wraps mid-sentence). Passing an index
 * that was already built returns it unchanged, so a set of questions shares one.
 */
function buildSourceIndex(scopeText) {
  if (scopeText && scopeText.sentences) return scopeText;
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

/** A True/False the engine built by keeping (True) or swapping in (False) a sibling's term or definition. */
const isSwap = (q, answer) => isTF(q, answer) && q.construction === 'sibling_swap';

/**
 * tf_copied_true: a True statement that is word for word a sentence of the source. Recognising the
 * sentence is enough to answer it, and "always True when it sounds like the book" becomes the strategy.
 *
 * Not flagged: a sibling-swap True that follows a sibling-swap False in the same set. There the False
 * statements are source sentences too (attributed to the wrong term), so sounding like the book no
 * longer tells True from False. A swap True with no swap False before it is still flagged.
 */
function lintTrueFalseCopied(q, source, earlier = []) {
  if (!isTF(q, 'True')) return null;
  if (isSwap(q, 'True') && earlier.some((e) => isSwap(e, 'False'))) return null;
  const tokens = statementTokens(q);
  return buildSourceIndex(source).keys.has(tokens.join(' '))
    ? found('tf_copied_true', `identical to a source sentence (${tokens.length} words)`)
    : null;
}

/**
 * tf_antonym_swap: a False statement that differs from a source sentence by exactly one word, and that
 * word is the other half of an antonym pair ("increases" -> "decreases"). Spotting the pair word answers it.
 */
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

/**
 * tf_double_antonym: the statement contains the same antonym-pair word twice ("decreases ... decreases").
 * Swapping only the first of two "increases" leaves a sentence that reads as visibly doctored.
 */
function lintTrueFalseDoubleAntonym(q) {
  if (!isTF(q)) return null;
  const counts = new Map();
  for (const w of T.words(T.stemBody(q))) if (T.ANTONYM_WORDS.has(w)) counts.set(w, (counts.get(w) || 0) + 1);
  const twice = [...counts].filter(([, n]) => n >= 2).map(([w]) => w);
  return twice.length ? found('tf_double_antonym', `"${twice.join('", "')}" appears twice`) : null;
}

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

/**
 * duplicate_fact: an earlier question of the same set already tests this fact (content-word overlap of
 * stem + answer: Jaccard 0.75, or one fact 90% contained in the other). Only the later question is
 * flagged. Two true statements that share most of their vocabulary are a known false positive.
 */
function lintDuplicateFact(q, earlier = []) {
  const mine = factKey(q);
  const twin = earlier.find((e) => sameFact(mine, factKey(e)));
  return twin ? found('duplicate_fact', `same fact as ${twin.id || 'an earlier question'}: "${T.stemBody(twin).slice(0, 70)}"`) : null;
}

const optionSetKey = (q) => T.choiceOptions(q).map((o) => o.toLowerCase().replace(/\s+/g, ' ').trim()).sort().join(' | ');

/**
 * reused_option_set: the same options, in any order, were already offered by an earlier question of the
 * set, so each answer rules itself out for the next one. Only the later question is flagged.
 */
function lintReusedOptionSet(q, earlier = []) {
  if (T.choiceOptions(q).length < 3) return null;
  const key = optionSetKey(q);
  const twin = earlier.find((e) => T.choiceOptions(e).length >= 3 && optionSetKey(e) === key);
  return twin ? found('reused_option_set', `same options as ${twin.id || 'an earlier question'}: ${key}`) : null;
}

module.exports = {
  buildSourceIndex, lintTrueFalseCopied, lintTrueFalseAntonymSwap, lintTrueFalseDoubleAntonym, lintDuplicateFact,
  lintReusedOptionSet,
};

/**
 * Stem lints for tools/eval-quiz-lints.js: defects visible in the question stem itself
 * (missing antecedents, thin or overlong stems, answer leaks, extraction debris, vague table/operator stems).
 * Pure heuristics over one question (plus scope word/sentence index where needed); never imports src/.
 */
const T = require('./eval-quiz-text.js');

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

/** unresolved_reference: the stem points outside itself or uses an antecedent-less pronoun. */
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

/** cloze_leading_blank: blank opens the statement and is followed by a discourse word or bare verb. */
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

/** thin_stem: fewer than 6 content words left once the blank is cut. */
function lintThinStem(q) {
  if (q.type !== 'cloze') return null;
  const body = T.stemBody(q).replace(T.BLANK_RE, ' ');
  const n = T.contentWords(body).length + T.mathCount(body);
  return n < MIN_CONTENT_WORDS ? found('thin_stem', `${n} content words after blanking`) : null;
}

/** answer_leak: a content word of the answer also appears in the stem (unless every option shares it). */
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

/** whole_block_stem: stem over 300 chars, contains a bullet glyph, or runs together multiple note separators. */
function lintWholeBlockStem(q) {
  const body = T.stemBody(q);
  if (body.length > MAX_STEM_CHARS) return found('whole_block_stem', `${body.length} characters`);
  if (BULLET_RE.test(body)) return found('whole_block_stem', 'contains a bullet glyph');
  const seps = (T.stripMath(body).replace(/`[^`]*`/g, ' ').match(NOTE_SEPARATOR_RE) || []).length;
  return seps >= 2 ? found('whole_block_stem', `${seps} note separators run together`) : null;
}

const DEBRIS = [
  [/^(?:[A-Z]{2,}[,:]?\s+)+(?:AND\s+|OR\s+)?[A-Z]{2,}\s+[A-Z][a-z]/, 'run-in heading'],
  [/(?:^|\s)([A-Z0-9][^\s,:;]*[/A-Z0-9][^\s,:;]*)\s+\1(?=[\s,:;.]|$)/, 'cell printed twice'],
  [/[a-z,]\s+You\s+[a-z]/, 'cells glued'],
  [/\b[a-z]{2,}\s+(?:tion|tions|sion|sions|ment|ments|ities)\b|^(?:Tion|Sion|Ment|Ness)\b/, 'word split at a break'],
];
const PROSE_PAIR_RE = /\b(?:is|in|it|the|and|of|if|then|for|are)\s+(?:is|in|it|the|and|of|if|then|for|are)\b/;
const SPLIT_RE = /\b([a-z]{2,})-\s+([a-z]{2,})\b/g;
const MATH_FUNCTION_RE = /^(?:sin|cos|tan|sec|csc|cot|log|ln|exp|max|min|mod|gcd|lcm|lim|det|deg|dim|ker|sup|inf|arg|sgn)$/i;
function proseInMath(part) {
  const body = part.replace(/\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf|mathtt|textbf|textit)\s*\{[^}]*\}/g, ' ');
  if (PROSE_PAIR_RE.test(body) || /(?:^|[^\\A-Za-z])(?:is|are|the|and|then|where)(?![A-Za-z])/.test(body)) return true;
  return (body.match(/(?:^|[^\\A-Za-z])[A-Za-z]{3,}/g) || []).map((w) => w.replace(/^[^A-Za-z]/, '')).some((w) => !MATH_FUNCTION_RE.test(w));
}
const ENDING_RE = /^[a-z]{0,3}(?:tion|sion|ment|ness|ing|ity|itie|ally|ence|ance|able|ible|ure|ous|ive|ated|ating|ized|ised|ency|ical|ular|ology)s?$/;

/** stem_debris: line-break hyphen, run-in uppercase heading, duplicated cell, glued cells, or prose read as math. */
function lintStemDebris(q, ctx) {
  const words = ctx && ctx.words ? ctx.words : (typeof ctx === 'string' ? buildStemIndex(ctx).words : null);
  const body = T.stemBody(q);
  const hit = DEBRIS.find(([re]) => re.test(body));
  if (hit) return found('stem_debris', hit[1]);
  if (body.split('$').some((part, i) => i % 2 === 1 && proseInMath(part))) return found('stem_debris', 'prose read as math');
  for (const [all, a, b] of body.matchAll(SPLIT_RE)) {
    if ((words && words.has(a + b)) || (b.length <= 7 && ENDING_RE.test(b))) return found('stem_debris', `line-break hyphen "${all}"`);
  }
  return null;
}

const EXAMPLE_TALK_RE =
  /\b(?:if|suppose)\s+we\b|\bwe\s+(?:would|could|might)\b|\b(?:in|from)\s+(?:the|this|that|our)\s+(?:(?:earlier|previous|last|above|first|second|next)\s+)?example\b|\b[A-Za-z_]\w*\[[^\]\s]{1,8}\]/i;

/** example_talk: stem narrates a worked example rather than stating a self-contained fact. */
function lintExampleTalk(q) {
  const m = T.stemBody(q).replace(/`[^`]*`/g, ' ').match(EXAMPLE_TALK_RE);
  return m ? found('example_talk', `"${m[0]}"`) : null;
}

const PSEUDO_TERM_RE =
  /^(?:most\s+)?(?:common|typical|usual|frequent|main|major|important|serious|good|bad|best|worst|simple|other)\s+(?:errors?|mistakes?|problems?|issues?|cases?|ways?|reasons?|things?|examples?|ideas?|points?|parts?|steps?)$/i;

/** pseudo_term: blank or swapped-in term is an evaluative phrase such as "common error". */
function lintPseudoTerm(q) {
  if (q.type === 'cloze' && PSEUDO_TERM_RE.test(String(q.answer || '').trim())) return found('pseudo_term', `blank "${q.answer}"`);
  if (q.type === 'true_false' && /called an? (?:most\s+)?(?:common|typical|serious|major|main)\s+\w+\.?"?$/i.test(T.stemBody(q))) {
    return found('pseudo_term', 'swapped in an evaluative phrase');
  }
  return null;
}

/** blank_cuts_compound: cloze blank joined to a word by a dash. */
function lintBlankCutsCompound(q) {
  if (q.type !== 'cloze') return null;
  return /_{4,}[–—-]\w|\w[–—-]_{4,}/.test(T.stemBody(q)) ? found('blank_cuts_compound', 'blank joined by a dash') : null;
}

/** arrow_residue: card "A -> ?" prompt left in a stem or option. */
function lintArrowResidue(q) {
  const text = [q.question, ...T.choiceOptions(q), q.answer].join('\n');
  return /→\s*\?\s*:/.test(text) || (q.type !== 'reveal' && /→\s*\?/.test(text)) ? found('arrow_residue', '"→ ?" left in the question') : null;
}

const CATCH_ALL_RE = /\s[—–-]\s(?:notes?|comments?|remarks?|other|misc(?:ellaneous)?|details)\b|\bthe\s+(?:notes?|comments?|remarks?)\s+for\s+"/i;

/** catch_all_prompt: recall or table question asked about a Notes/Comments/Remarks column. */
function lintCatchAllPrompt(q) {
  return CATCH_ALL_RE.test(String(q.question || '')) ? found('catch_all_prompt', 'asked about a catch-all column') : null;
}

/** topic_word_blank: blank answer appears in >=40% of the scope's sentences. */
function lintTopicWordBlank(q, ctx) {
  const sentences = ctx && (ctx.sentences || (ctx.third && ctx.third.sentences))
    ? (ctx.sentences || ctx.third.sentences)
    : (typeof ctx === 'string' ? buildStemIndex(ctx).sentences : null);
  if (q.type !== 'cloze' || !sentences || sentences.length < 40) return null;
  const answer = String(q.answer || '').toLowerCase().trim();
  const one = answer.length <= 4 ? answer : /(?:ch|sh|ss|x)es$/.test(answer) ? answer.slice(0, -2) : answer.replace(/(?<!s)s$/, '');
  const re = new RegExp(`(?<![a-z])${one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?(?![a-z])`, 'i');
  const share = sentences.filter((s) => re.test(s)).length / sentences.length;
  return share >= 0.4 ? found('topic_word_blank', `"${q.answer}" is in ${Math.round(share * 100)}% of the sentences`) : null;
}

/** table_stem_unnamed: table question does not name the column of its row value. */
function lintTableStemUnnamed(q) {
  if (!/\bTable\b/.test(String(q.badge || ''))) return null;
  return /\bwhere\b.+\bis\s+"[^"]+",\s+what\s+is\s+the\b/i.test(String(q.question || '')) ? null
    : found('table_stem_unnamed', 'the stem does not name the column of its row value');
}

const BINOMIAL_RE = /\b[A-Z][a-z]{3,}\s+(?:spp?\.?|[a-z]{3,}(?:us|is|a|ae|i|um|es|ii|ens|ensis|ica|ans|alis|ides))(?=[\s.,;:"]|$)/g;
function fused(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const hits = [...t.matchAll(BINOMIAL_RE)];
  for (let i = 1; i < hits.length; i++) {
    const between = t.slice(hits[i - 1].index + hits[i - 1][0].length, hits[i].index);
    if (!/[,;:()/&"|•]|\b(?:and|or|vs|versus|than|with|to|in|of)\b/i.test(between) && between.trim().split(/\s+/).filter(Boolean).length <= 1) {
      return `${hits[i - 1][0]} ${hits[i][0]}`;
    }
  }
  return '';
}

/** fused_names: two Latin binomials run together across columns. */
function lintFusedNames(q) {
  const texts = [q.question, ...String(q.answer || '').split('\n'), ...(q.options || [])];
  const hit = texts.map(fused).find(Boolean);
  return hit ? found('fused_names', `"${hit}" runs two names together`) : null;
}

/** operator_row: table question row key is a bare symbol without letters or digits. */
function lintOperatorRow(q) {
  const m = String(q.question || '').match(/In the row where .+? is "([^"]+)"/);
  return m && !/[A-Za-z0-9]/.test(m[1]) ? found('operator_row', `row "${m[1]}" is a bare symbol`) : null;
}

function buildStemIndex(scopeText) {
  if (scopeText && scopeText.words && scopeText.sentences) return scopeText;
  const text = String(scopeText || '');
  return {
    words: new Set(text.toLowerCase().match(/[a-z]+/g) || []),
    sentences: text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 20),
  };
}

const CORE_STEM_LINTS = [lintUnresolvedReference, lintClozeLeadingBlank, lintThinStem, lintAnswerLeak, lintWholeBlockStem];
const ALL_STEM_LINTS = [
  ...CORE_STEM_LINTS,
  lintStemDebris, lintExampleTalk, lintPseudoTerm, lintBlankCutsCompound,
  lintArrowResidue, lintCatchAllPrompt, lintTopicWordBlank, lintTableStemUnnamed,
  lintFusedNames, lintOperatorRow,
];
const STEM_LINT_NAMES = [
  'unresolved_reference', 'cloze_leading_blank', 'thin_stem', 'answer_leak', 'whole_block_stem',
  'stem_debris', 'example_talk', 'pseudo_term', 'blank_cuts_compound',
  'arrow_residue', 'catch_all_prompt', 'topic_word_blank', 'table_stem_unnamed',
  'fused_names', 'operator_row',
];

module.exports = {
  CORE_STEM_LINTS, ALL_STEM_LINTS, STEM_LINT_NAMES, buildStemIndex,
  lintUnresolvedReference, lintClozeLeadingBlank, lintThinStem, lintAnswerLeak, lintWholeBlockStem,
  lintStemDebris, lintExampleTalk, lintPseudoTerm, lintBlankCutsCompound,
  lintArrowResidue, lintCatchAllPrompt, lintTopicWordBlank, lintTableStemUnnamed,
  lintFusedNames, lintOperatorRow,
};

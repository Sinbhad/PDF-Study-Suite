/**
 * Word lists and text helpers shared by the quiz-quality lints (tools/eval-quiz-lints.js and siblings)
 * and the guessability solver (tools/eval-quiz-solver.js).
 *
 * Deliberately independent of src/nlp: the lints must not move when the engine's own tokenizer, stopword
 * list or antonym table changes, otherwise a fix to the engine could silently re-score the baseline.
 * Everything here is a closed word list or a crude suffix rule, not a parser; see tests/corpus/README.md
 * for the false positives that follow from that.
 */

const set = (s) => new Set(s.trim().split(/\s+/));

const DETERMINERS = set('a an the this that these those each every some any no its their his her our your my');
const PREPOSITIONS = set(`of in on at by for from with to into onto over under between among through during
  before after about against across along around behind beyond per via within without toward towards upon
  than as minus plus versus vs`);
const PARTICLES = set('back up down out off away');
const CONJUNCTIONS = set('and or but nor so yet if when while whereas because although though unless until since whether');
const PRONOUNS = set('it they them he she him we us you i who whom whose which what itself themselves himself herself there here');
const AUXILIARIES = set(`is are was were be been being am has have had having do does did can could will would
  shall should may might must cannot`);
// Sentence openers that only make sense after an earlier sentence.
const DISCOURSE = set(`however therefore thus hence moreover furthermore consequently instead then also
  otherwise nevertheless nonetheless similarly likewise finally meanwhile additionally conversely accordingly`);
const ADVERBS = set('not very only often usually always never almost nearly just still already again too quite rather');
// Words in -ly that are not adverbs, so an option may start with them.
const LY_NOT_ADVERB = set('family assembly supply anomaly monopoly butterfly reply ally july early only likely daily friendly italy');

/**
 * Verbs that are rarely nouns, base forms. Used for "option starts or ends with a verb" and for the bare
 * verb after a leading blank. Noun-ambiguous verbs (flow, form, use, cause, state, share, increase, ...)
 * are left out on purpose: at the edge of a short option they are far more often the head noun.
 */
const VERB_BASES = `bring deliver tend spend rise occur become make give take get keep contain include require
  produce provide allow create mean depend consist refer describe define explain determine involve remain
  exist happen appear seem enter convert combine attach regenerate continue consume receive prevent reduce
  raise lose repel attract learn identify translate send carry follow write know think say go come see find
  begin try put let grow decide suffer improve behave arrive expire exit perform assign maximize yield`.trim().split(/\s+/);
const thirdPerson = (v) => (/(?:s|x|z|ch|sh)$/.test(v) ? `${v}es` : /[^aeiou]y$/.test(v) ? `${v.slice(0, -1)}ies` : `${v}s`);
const BARE_VERBS = new Set(VERB_BASES);
const FINITE_VERBS = new Set([...VERB_BASES, ...VERB_BASES.map(thirdPerson)]);
// Gerunds that introduce a clause ("using a queue") rather than name a thing ("operating system").
const CLAUSE_GERUNDS = set(`using being having making including causing allowing resulting leading giving taking
  becoming containing producing occurring depending following involving requiring keeping bringing`);

/** Words that cannot be the antecedent of a pronoun or the noun after a demonstrative. */
const NOT_NOUN = new Set([...DETERMINERS, ...PREPOSITIONS, ...PARTICLES, ...CONJUNCTIONS, ...PRONOUNS, ...AUXILIARIES,
  ...DISCOURSE, ...ADVERBS, ...FINITE_VERBS]);
/** Function words: everything that is not content when counting or comparing content words. */
const FUNCTION_WORDS = new Set([...DETERMINERS, ...PREPOSITIONS, ...PARTICLES, ...CONJUNCTIONS, ...PRONOUNS,
  ...AUXILIARIES, ...DISCOURSE, ...ADVERBS, 'such', 'other', 'more', 'most', 'less', 'also', 'both', 'one', 'two']);

/** A superset of the engine's own table, so tells are still measured after the engine's list changes. */
const ANTONYM_PAIRS = [
  ['increases', 'decreases'], ['increase', 'decrease'], ['increasing', 'decreasing'], ['increased', 'decreased'],
  ['higher', 'lower'], ['highest', 'lowest'], ['high', 'low'], ['faster', 'slower'], ['fast', 'slow'],
  ['positive', 'negative'], ['maximum', 'minimum'], ['internal', 'external'], ['synchronous', 'asynchronous'],
  ['symmetric', 'asymmetric'], ['direct', 'inverse'], ['directly', 'inversely'], ['volatile', 'non-volatile'],
  ['parallel', 'serial'], ['static', 'dynamic'], ['primary', 'secondary'], ['endothermic', 'exothermic'],
  ['aerobic', 'anaerobic'], ['continuous', 'discontinuous'], ['converges', 'diverges'], ['bounded', 'unbounded'],
  ['greater', 'smaller'], ['larger', 'smaller'], ['largest', 'smallest'], ['always', 'never'], ['rises', 'falls'],
  ['stronger', 'weaker'], ['longer', 'shorter'],
  ['elastic', 'inelastic'], ['explicit', 'implicit'], ['reversible', 'irreversible'],
];
const ANTONYM_WORDS = new Set(ANTONYM_PAIRS.flat());
const isAntonymPair = (a, b) => ANTONYM_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const BLANK_RE = /_{4,}/;
const MATH_RE = /\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g;

/** Drops bold markers; a run of underscores is a cloze blank, not markup, and is kept. */
const stripMarkdown = (s) => String(s || '').replace(/\*\*|(?<!_)__(?!_)/g, '');
/** Math spans replaced by `fill` (default: removed), so LaTeX commands are never read as words. */
const stripMath = (s, fill = ' ') => String(s || '').replace(MATH_RE, fill);
const mathCount = (s) => (String(s || '').match(MATH_RE) || []).length;
const hasMath = (s) => /\$/.test(String(s || ''));
/** An option that is a formula (possibly with a unit word after it), not a phrase with a symbol in it. */
const isFormulaOption = (s) => hasMath(s) && stripMath(s).replace(/[^A-Za-z]+/g, ' ').trim().split(/\s+/).filter(Boolean).length <= 1;

/** Lowercase word tokens outside math: letters with inner hyphens or apostrophes. */
const words = (s) => stripMath(stripMarkdown(s)).toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g) || [];
const contentWords = (s) => words(s).filter((w) => w.length >= 3 && !FUNCTION_WORDS.has(w));
/** Every alphanumeric token, math included: the form used to compare a statement with its source sentence. */
const allTokens = (s) => stripMarkdown(s).toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || [];

/** Crude suffix stripper: enough to equate "membranes"/"membrane" and "encoded"/"encoding", nothing more. */
function crudeStem(word) {
  let w = String(word).toLowerCase().replace(/[’']s$/, '');
  if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
  else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w)) w = w.slice(0, -1);
  return w.length > 4 ? w.replace(/e$/, '') : w;
}

/**
 * The part of a question the student actually reads as content: the quoted statement after the template
 * line ('Complete the statement:\n"..."'), or the question without its "Which formula correctly states the"
 * lead-in. Template words ("the following statement", "theorem", "term") are never linted.
 */
function stemBody(q) {
  const text = String((q && q.question) || '');
  const quoted = text.match(/\n"([\s\S]*)"\s*$/);
  if (quoted) return quoted[1];
  const nl = text.indexOf('\n');
  if (nl >= 0) return text.slice(nl + 1);
  return text.replace(/^Which\s+(?:statement|formula|expression)\s+(?:correctly\s+)?(?:defines|states|describes|gives)\s+/i, '');
}

const isTrueFalse = (q) => q.type === 'true_false' && (q.options || []).join('|') === 'True|False';
/** Options a student chooses between; empty for True/False, Yes/No and reveal-style questions. */
const choiceOptions = (q) => (q.type === 'true_false' ? [] : (q.options || []).map(String));

/** 'upper' | 'lower' | null (formula, digit-led, or acronym-like first word such as "ATP", "IPv4"). */
function leadingCase(option) {
  if (isFormulaOption(option)) return null;
  const first = (stripMath(stripMarkdown(option)).trim().match(/^[^\s]+/) || [''])[0].replace(/^[^A-Za-z0-9]+/, '');
  if (!/^[A-Za-z]/.test(first) || /[A-Z0-9]/.test(first.slice(1))) return null;
  return /^[A-Z]/.test(first) ? 'upper' : 'lower';
}

/** Does "a"/"an" agree with the first sound of the option? null when it cannot be told (formula, acronym). */
function articleFits(article, option) {
  if (isFormulaOption(option)) return null;
  const first = (words(option)[0] || '');
  const raw = (stripMath(stripMarkdown(option)).trim().match(/^[A-Za-z]+/) || [''])[0];
  if (!first || (raw.length > 1 && raw === raw.toUpperCase())) return null;
  const vowelSound = /^(?:hour|honest|honor|heir)/.test(first) || (/^[aeiou]/.test(first) && !/^(?:uni|use|usu|eu|one|once)/.test(first));
  return (article.toLowerCase() === 'an') === vowelSound;
}

/** Plural by form: ends in -s but not -ss/-us/-is/-ics. Crude; "series" and "analysis" are the known misses. */
const looksPlural = (option) => {
  const last = words(option).pop() || '';
  return last.length > 3 && /s$/.test(last) && !/(?:ss|us|is|ics)$/.test(last);
};

module.exports = {
  DETERMINERS, PREPOSITIONS, PARTICLES, CONJUNCTIONS, AUXILIARIES, DISCOURSE, ADVERBS, LY_NOT_ADVERB, BARE_VERBS,
  FINITE_VERBS, CLAUSE_GERUNDS, NOT_NOUN, FUNCTION_WORDS, ANTONYM_PAIRS, ANTONYM_WORDS, isAntonymPair,
  BLANK_RE, MATH_RE, stripMarkdown, stripMath, mathCount, hasMath, isFormulaOption, words, contentWords, allTokens,
  crudeStem, stemBody, isTrueFalse, choiceOptions, leadingCase, articleFits, looksPlural,
};

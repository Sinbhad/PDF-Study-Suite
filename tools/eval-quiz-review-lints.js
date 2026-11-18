/**
 * Lints for the defects the second blind review (2026-11-18) found in generated questions. Like the other lint
 * files, each is a heuristic over the question (and the scope text where it says so) and returns null or
 * { lint, detail }.
 *
 *   stem_debris          extraction left-overs in the stem: a kept line-break hyphen ("tab char- acters"), a run-in
 *                        heading in capitals ("CONVERSE, ... AND INVERSE We can"), a cell printed twice ("DK/NF
 *                        DK/NF"), prose read as math ("$it is in 1NF$"), table cells glued ("Error You cannot")
 *   example_talk         the stem narrates a worked example ("if we assign ...", "we would", "In the earlier
 *                        example", "values[i]") instead of stating a fact
 *   swap_names_owner     a False "true of X" statement that names the subject it really belongs to (its explanation
 *                        says whose it is), or that opens on another name ("Fenbendazole is ..." under clorsulon)
 *   swap_number_mismatch a False whose bare predicate ("Are circuits ...") disagrees in number with the subject
 *   open_completion      a self-graded "Complete:" that pins no single answer: a one-word answer ("found"), a
 *                        quantified subject ("Some editors ..."), or a prompt that talks to the reader ("You")
 *   define_not_definition a self-graded "Define X" whose answer is a bare name (under four words) or advice
 *   pseudo_term          a blank or a swapped-in term that is an evaluative phrase ("common error")
 *   blank_cuts_compound  a blank joined to a word by a dash ("the ________–slave flip-flop")
 *   identifier_option    an option that is a program identifier ("StudentIDs")
 *   class_beside_members a table option that is a lone plural class ("Carnivores") beside a list of members
 *                        ("Dogs, Cats"): either may be true
 *   option_kind_of_answer a wrong option the scope calls a kind of the answer, or the answer a kind of it
 *                        ("The most basic storage elements are latches"): it may be right as well (scope text)
 */
const T = require('./eval-quiz-text.js');
const kinds = require('../src/nlp/quiz-kinds.js');

const found = (lint, detail) => ({ lint, detail });

const DEBRIS = [
  [/^(?:[A-Z]{2,}[,:]?\s+)+(?:AND\s+|OR\s+)?[A-Z]{2,}\s+[A-Z][a-z]/, 'run-in heading'],
  [/(?:^|\s)([A-Z0-9][^\s,:;]*[/A-Z0-9][^\s,:;]*)\s+\1(?=[\s,:;.]|$)/, 'cell printed twice'],
  [/[a-z,]\s+You\s+[a-z]/, 'cells glued'],
  [/\b[a-z]{2,}\s+(?:tion|tions|sion|sions|ment|ments|ities)\b|^(?:Tion|Sion|Ment|Ness)\b/, 'word split at a break'],
];
const PROSE_PAIR_RE = /\b(?:is|in|it|the|and|of|if|then|for|are)\s+(?:is|in|it|the|and|of|if|then|for|are)\b/;
const SPLIT_RE = /\b([a-z]{2,})-\s+([a-z]{2,})\b/g;
const MATH_FUNCTION_RE = /^(?:sin|cos|tan|sec|csc|cot|log|ln|exp|max|min|mod|gcd|lcm|lim|det|deg|dim|ker|sup|inf|arg|sgn)$/i;
/** A $...$ span that holds running words ("it is in 1NF", "Sis a", "q(orp"), not a formula. */
function proseInMath(part) {
  const body = part.replace(/\\(?:text|mathrm|operatorname|mathbf|mathit|mathsf|mathtt|textbf|textit)\s*\{[^}]*\}/g, ' ');
  if (PROSE_PAIR_RE.test(body) || /(?:^|[^\\A-Za-z])(?:is|are|the|and|then|where)(?![A-Za-z])/.test(body)) return true;
  return (body.match(/(?:^|[^\\A-Za-z])[A-Za-z]{3,}/g) || []).map((w) => w.replace(/^[^A-Za-z]/, '')).some((w) => !MATH_FUNCTION_RE.test(w));
}
const ENDING_RE = /^[a-z]{0,3}(?:tion|sion|ment|ness|ing|ity|itie|ally|ence|ance|able|ible|ure|ous|ive|ated|ating|ized|ised|ency|ical|ular|ology)s?$/;

/** ctx.words: the words the scope prints, lower case (a split word is recognised by its joined form). */
function lintStemDebris(q, ctx) {
  const body = T.stemBody(q);
  const hit = DEBRIS.find(([re]) => re.test(body));
  if (hit) return found('stem_debris', hit[1]);
  if (body.split('$').some((part, i) => i % 2 === 1 && proseInMath(part))) return found('stem_debris', 'prose read as math');
  for (const [all, a, b] of body.matchAll(SPLIT_RE)) {
    if ((ctx && ctx.words && ctx.words.has(a + b)) || (b.length <= 7 && ENDING_RE.test(b))) return found('stem_debris', `line-break hyphen "${all}"`);
  }
  return null;
}

const EXAMPLE_TALK_RE =
  /\b(?:if|suppose)\s+we\b|\bwe\s+(?:would|could|might)\b|\b(?:in|from)\s+(?:the|this|that|our)\s+(?:(?:earlier|previous|last|above|first|second|next)\s+)?example\b|\b[A-Za-z_]\w*\[[^\]\s]{1,8}\]/i;

function lintExampleTalk(q) {
  // (An array element set as code, `values[2]`, is the question's own notation, not a worked example's name.)
  const m = T.stemBody(q).replace(/`[^`]*`/g, ' ').match(EXAMPLE_TALK_RE);
  return m ? found('example_talk', `"${m[0]}"`) : null;
}

const SWAP_STEM_RE = /^True or False: the following is true of "([^"]+)"\./;
const OWNER_RE = /This is true of "([^"]+)", not of/;
const OPENER_RE = /^([A-Z][\w.-]*(?:\s+[A-Z][\w.-]*){0,2})\s+(?:is|are|was|were|has|have|can|cannot|does|do)\b/;

/** A False "true of X" whose statement names its real owner, or opens on a name X's question never uses. */
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

const QUANTIFIED_RE = /^(?:some|most|many|several|few|certain|other|various|lots|all|any)\b/i;

function lintOpenCompletion(q) {
  const m = String(q.question || '').match(/^Complete: "(.*)"$/s);
  if (q.type !== 'reveal' || !m) return null;
  const answer = String(q.answer || '').trim();
  if (answer.split(/\s+/).length < 2) return found('open_completion', `one-word answer "${answer}"`);
  if (QUANTIFIED_RE.test(m[1])) return found('open_completion', 'quantified subject');
  if (/\byou\b/i.test(m[1])) return found('open_completion', 'talks to the reader');
  return null;
}

const ADVICE_RE = /^(?:do\s+not|don['’]t|never|always|be\s+sure|make\s+sure|remember|note|avoid|beware)\b/i;

function lintDefineNotDefinition(q) {
  if (q.type !== 'reveal' || !/^Define "/.test(String(q.question || ''))) return null;
  const answer = String(q.answer || '').trim();
  if (answer.split(/\s+/).length < 4) return found('define_not_definition', `bare name "${answer}"`);
  return ADVICE_RE.test(answer) ? found('define_not_definition', 'advice, not a meaning') : null;
}

const PSEUDO_TERM_RE =
  /^(?:most\s+)?(?:common|typical|usual|frequent|main|major|important|serious|good|bad|best|worst|simple|other)\s+(?:errors?|mistakes?|problems?|issues?|cases?|ways?|reasons?|things?|examples?|ideas?|points?|parts?|steps?)$/i;

function lintPseudoTerm(q) {
  if (q.type === 'cloze' && PSEUDO_TERM_RE.test(String(q.answer || '').trim())) return found('pseudo_term', `blank "${q.answer}"`);
  if (q.type === 'true_false' && /called an? (?:most\s+)?(?:common|typical|serious|major|main)\s+\w+\.?"?$/i.test(T.stemBody(q))) {
    return found('pseudo_term', 'swapped in an evaluative phrase');
  }
  return null;
}

function lintBlankCutsCompound(q) {
  if (q.type !== 'cloze') return null;
  return /_{4,}[–—-]\w|\w[–—-]_{4,}/.test(T.stemBody(q)) ? found('blank_cuts_compound', 'blank joined by a dash') : null;
}

function lintIdentifierOption(q) {
  const id = T.choiceOptions(q).find((o) => /^\S*[a-z]{2,}[A-Z]\S*$/.test(String(o).trim()));
  return id ? found('identifier_option', `"${id}"`) : null;
}

const items = (v) => String(v).split(/[,;/]|\band\b/i).map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 3);

function lintClassBesideMembers(q) {
  if (!/^What is the .+ for "/.test(String(q.question || ''))) return null;
  const opts = T.choiceOptions(q);
  const lists = opts.filter((o) => items(o).length >= 2);
  const members = new Set(lists.flatMap(items));
  const lone = opts.find((o) => items(o).length === 1 && /[^s]s$/i.test(o.trim()) && !members.has(o.trim().toLowerCase()));
  return lone && lists.length && (lone === q.answer || lists.includes(q.answer))
    ? found('class_beside_members', `"${lone}" beside "${lists[0]}"`) : null;
}

/** ctx.kinds: quiz-kinds index of the scope's sentences (buildReviewIndex). */
function lintOptionKindOfAnswer(q, ctx) {
  if (!ctx || !ctx.kinds || q.type === 'true_false') return null;
  const answer = String(q.answer || '');
  if (!answer || answer.split(/\s+/).length > 5) return null;
  const twin = T.choiceOptions(q).find((o) => o !== answer && o.split(/\s+/).length <= 5 && ctx.kinds.related(answer, o));
  return twin ? found('option_kind_of_answer', `"${twin}" and "${answer}" are kinds of one another in the scope`) : null;
}

function buildReviewIndex(scopeText) {
  const sentences = String(scopeText || '').split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());
  return { kinds: kinds.index(sentences), words: new Set(String(scopeText || '').toLowerCase().match(/[a-z]+/g) || []) };
}

const REVIEW_LINTS = [lintStemDebris, lintExampleTalk, lintSwapNamesOwner, lintSwapNumberMismatch, lintOpenCompletion,
  lintDefineNotDefinition, lintPseudoTerm, lintBlankCutsCompound, lintIdentifierOption, lintClassBesideMembers, lintOptionKindOfAnswer];
const REVIEW_LINT_NAMES = ['stem_debris', 'example_talk', 'swap_names_owner', 'swap_number_mismatch', 'open_completion',
  'define_not_definition', 'pseudo_term', 'blank_cuts_compound', 'identifier_option', 'class_beside_members', 'option_kind_of_answer'];

module.exports = {
  REVIEW_LINTS, REVIEW_LINT_NAMES, buildReviewIndex,
  lintStemDebris, lintExampleTalk, lintSwapNamesOwner, lintSwapNumberMismatch, lintOpenCompletion, lintDefineNotDefinition,
  lintPseudoTerm, lintBlankCutsCompound, lintIdentifierOption, lintClassBesideMembers, lintOptionKindOfAnswer,
};

/**
 * Content lints for tools/eval-quiz-lints.js: defects a strict teaching assistant sees in what a question
 * tests, rather than in how its options are shaped. Written after an independent review of 255 questions
 * from 12 real documents found that most bad questions passed every shape lint:
 *
 *   attribution_stem        the stem asks where a line sat ("the lecture", "this slide", "which topic is
 *                           this point about") instead of asking something about a subject
 *   generic_subject         the subject the stem names is an organising heading ("Pharmacokinetics",
 *                           "Overview", "Diagnosis"), or a heading the scope repeats under several entities
 *   options_same_subject    a distractor comes from the same slide/paragraph as the answer, or names the
 *                           stem's own subject: it is probably true as well
 *   tf_false_true_of_subject  a False statement whose predicate the scope also lists under the same subject
 *   bad_definition          a definition whose text contains its own term, or opens with / leans on an
 *                           unresolved reference ("this condition", "here, 10", "of this type")
 *   garbled_token           the stem or answer holds a token that is not word-shaped and that the rest of
 *                           the scope never uses: recognition or table debris ("Don'heed^(to)")
 *   filler_subject          case signalment ("8y/o M/N Pug"), or a person or place as the answer or subject
 *                           in a scope that is not about history (biography sidebars, example sentences)
 *
 * Every lint is a word-list or overlap heuristic, independent of src/nlp, like the other lint files.
 * `ctx` is the scope index from buildContentIndex(scopeText); a lint built without one still runs on the
 * question alone where it can.
 */
const T = require('./eval-quiz-text.js');

const found = (lint, detail) => ({ lint, detail });

// The question may not ask about where a line was printed.
const ATTRIBUTION_RE = /\b(?:th(?:e|is)\s+lecture(?:r)?|th(?:e|is)\s+slide|lecture\s+point|topic\s+(?:of|is)\s+this|which\s+topic\b|which\s+slide\b|this\s+point\s+(?:is\s+)?about)\b/i;

// Headings that organise material under a subject and name no subject of their own. Closed list, general
// across subjects (pharmacology, medicine, computing, maths); a scope-specific repeat is caught separately.
const GENERIC_HEADINGS = new Set(['mechanism of action', 'take home message', 'physical exam', 'key points',
  'important points', 'the most helpful diagnostic', 'what to know', 'learning objectives', 'case study']);
const GENERIC_WORDS = new Set(`overview introduction summary background review recap outline objectives pharmacokinetics
  pharmacodynamics absorption distribution metabolism elimination excretion indications contraindications toxicity
  dosage administration mechanism diagnosis diagnostics treatment therapy management prognosis prevention control
  pathology pathogenesis pathophysiology etiology aetiology epidemiology transmission signs symptoms history
  signalment lesions definition definitions examples properties applications advantages disadvantages pros cons
  notes conclusion conclusions discussion results methods characteristics features types classification
  structure functions uses usage basics concepts effects findings exam dose doses route routes`.split(/\s+/).filter(Boolean));
// Words that may join generic words into one generic heading ("Adverse effects", "Clinical signs and treatment").
const GENERIC_GLUE = new Set('and of the a an in for clinical adverse side physical differential key important general main common other'.split(' '));
const REPEATED_HEADING_MIN = 2; // a short line printed under this many different titles organises them

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Is this heading made only of generic heading words (and glue)? */
function isGenericHeading(text) {
  const n = norm(text);
  if (!n) return false;
  if (GENERIC_HEADINGS.has(n)) return true;
  const w = n.split(' ');
  return w.some((x) => GENERIC_WORDS.has(x)) && w.every((x) => GENERIC_WORDS.has(x) || GENERIC_GLUE.has(x));
}

/** The subject a question names: its own `subject` field, else the first quoted phrase of the stem's first line. */
function subjectOf(q) {
  if (q && q.subject) return String(q.subject);
  const first = String((q && q.question) || '').split('\n')[0];
  const m = first.match(/"([^"]{2,80})"/) || first.match(/“([^”]{2,80})”/);
  return m ? m[1] : '';
}

/** The statement a True/False or "which defines" question shows: the quoted part after the template line. */
function statementOf(q) {
  const m = String((q && q.question) || '').match(/\n"([\s\S]*)"\s*$/);
  return m ? m[1] : '';
}

/**
 * Index of the scope text for the content lints: blocks (a slide, or a paragraph of a book), each with its
 * first line as title and its lines as token sets; how often each short line is printed; how often each
 * word occurs; and whether the scope reads as history (many years).
 */
function buildContentIndex(scopeText) {
  if (scopeText && scopeText.isContentIndex) return scopeText;
  const text = String(scopeText || '');
  const blocks = text.split(/\n\s*\n/).map((b) => b.split('\n').map((l) => l.replace(/^\s*[-*•]\s+/, '').trim()).filter(Boolean))
    .filter((lines) => lines.length).map((lines) => ({ title: lines[0], lines, tokens: lines.map((l) => new Set(T.contentWords(l).map(T.crudeStem))) }));
  // A short line printed under several different titles is a heading that organises each of them; a title
  // repeated on consecutive slides ("Rabies", "Rabies (cont.)") is one subject, not a generic heading.
  const underTitles = new Map();
  for (const b of blocks) {
    for (const l of b.lines.slice(1)) {
      if (l.split(/\s+/).length > 6) continue;
      if (!underTitles.has(norm(l))) underTitles.set(norm(l), new Set());
      underTitles.get(norm(l)).add(norm(b.title));
    }
  }
  const wordCounts = new Map();
  for (const w of text.match(/\S+/g) || []) wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
  const words = (text.match(/\S+/g) || []).length;
  const years = (text.match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) || []).length;
  return { isContentIndex: true, text, blocks, underTitles, wordCounts, isHistory: years >= HISTORY_MIN_YEARS && years / words >= HISTORY_YEARS_PER_WORD };
}
const HISTORY_YEARS_PER_WORD = 1 / 150; // a history text dates an event every few sentences
const HISTORY_MIN_YEARS = 5; // a sidebar or two with dates does not make a scope a history text

/** attribution_stem: the stem asks which slide, topic or lecture a line belongs to. */
function lintAttributionStem(q) {
  const first = String(q.question || '').split('\n')[0];
  const m = first.match(ATTRIBUTION_RE);
  return m ? found('attribution_stem', `asks about "${m[0]}"`) : null;
}

/** generic_subject: the named subject is an organising heading, or a short line the scope prints under several titles. */
function lintGenericSubject(q, ctx) {
  const subject = subjectOf(q);
  if (!subject) return null;
  if (isGenericHeading(subject)) return found('generic_subject', `"${subject}" is a generic heading`);
  const titles = ctx && ctx.underTitles ? ctx.underTitles.get(norm(subject)) : null;
  const n = titles ? titles.size : 0;
  return n >= REPEATED_HEADING_MIN ? found('generic_subject', `"${subject}" is a heading printed under ${n} different titles`) : null;
}

const OVERLAP_MATCH = 0.8; // share of an option's content words that must sit on one source line

/** Indexes of the blocks holding a line that carries most of this text's content words. */
function blocksHolding(text, ctx) {
  const words = [...new Set(T.contentWords(text).map(T.crudeStem))];
  if (words.length < 2 || !ctx) return [];
  const out = [];
  ctx.blocks.forEach((b, i) => {
    const joined = new Set(b.tokens.flatMap((t) => [...t]));
    const lineHit = b.tokens.some((t) => words.filter((w) => t.has(w)).length / words.length >= OVERLAP_MATCH);
    const blockHit = words.filter((w) => joined.has(w)).length / words.length >= 1;
    if (lineHit || (blockHit && words.length >= 3)) out.push(i);
  });
  return out;
}

const MAX_SLIDE_LINES = 30; // longer blocks are book text, where the first line is not a title
const MAX_TITLE_WORDS = 12; // a longer first line is a paragraph, not a title
const isSlideSized = (b) => b.lines.length <= MAX_SLIDE_LINES && b.title.split(/\s+/).length <= MAX_TITLE_WORDS;
// Clauses of a line: a subject named in one clause says nothing about the statement in the next one
// ("proactive interference occurs when ..., whereas retroactive interference occurs when ...").
const clauses = (line) => line.split(/(?<=[.!?;])\s+|,\s+(?:whereas|while|but|and\s+(?:the|a|an))\s+/i);

const mentions = (text, subject) => {
  const s = norm(subject);
  return s.length >= 3 && ` ${norm(text)} `.includes(` ${s} `);
};

/**
 * options_same_subject: a statement option that sits on the same slide or paragraph as the answer (so it
 * is about the same subject and likely true too), or that names the stem's own subject.
 */
function lintOptionsSameSubject(q, ctx) {
  const options = T.choiceOptions(q);
  if (options.length < 3 || !q.answer) return null;
  const subject = subjectOf(q);
  const statementLike = (o) => T.words(o).length >= 4;
  if (!statementLike(String(q.answer))) return null;
  const others = options.filter((o) => o !== q.answer && statementLike(o));
  const named = subject ? others.filter((o) => mentions(o, subject)) : [];
  if (named.length) return found('options_same_subject', `distractor names the subject "${subject}": "${named[0].slice(0, 60)}"`);
  const home = new Set(blocksHolding(q.answer, ctx));
  if (!home.size) return null;
  // Only a slide-sized block that is about the subject counts: a glossary slide or a book page defines a
  // different term on every line, and a distractor from it is about another subject.
  const aboutSubject = [...home].filter((i) => isSlideSized(ctx.blocks[i]) && subject && mentions(ctx.blocks[i].title, subject));
  if (!aboutSubject.length) return null;
  const titles = new Set(aboutSubject.map((i) => norm(ctx.blocks[i].title)));
  const shared = others.filter((o) => blocksHolding(o, ctx).some((i) => titles.has(norm(ctx.blocks[i].title))));
  return shared.length ? found('options_same_subject', `distractor from the answer's own slide or paragraph: "${shared[0].slice(0, 60)}"`) : null;
}

/** tf_false_true_of_subject: a False statement the scope also prints under the subject the stem names. */
function lintFalseTrueOfSubject(q, ctx) {
  if (q.type !== 'true_false' || q.answer !== 'False' || !ctx) return null;
  // A False made by changing one detail of the subject's own line is printed under that subject by design.
  if (q.construction === 'altered') return null;
  const subject = subjectOf(q);
  const statement = statementOf(q);
  if (!subject || !statement) return null;
  const hits = blocksHolding(statement, ctx).filter((i) => {
    const b = ctx.blocks[i];
    const onLine = b.lines.flatMap(clauses).some((c) => mentions(c, subject) &&
      blocksHolding(statement, { blocks: [{ ...b, tokens: [new Set(T.contentWords(c).map(T.crudeStem))] }] }).length);
    return (isSlideSized(b) && mentions(b.title, subject)) || onLine;
  });
  return hits.length ? found('tf_false_true_of_subject', `the scope lists it under "${subject}" ("${ctx.blocks[hits[0]].title.slice(0, 50)}")`) : null;
}

// A definition that leans on something outside itself.
const DANGLING_DEFINITION_RE = /^(?:this|that|these|those|such|it|they|here)\b|\b(?:this|that|such)\s+(?:condition|case|type|kind|fact|situation|process|property|form|one)\b|\bof\s+this\s+(?:type|kind)\b|\bhere,\s/i;
const DEFINITION_STEM_RE = /\bdefine[sd]?\b|\bwhat\s+is\s+meant\s+by\b|\bdefined\s+as\b/i;

/** bad_definition: a definition (answer or shown statement) that contains its own term or dangles. */
function lintBadDefinition(q) {
  const first = String(q.question || '').split('\n')[0];
  if (!DEFINITION_STEM_RE.test(first)) return null;
  const subject = subjectOf(q);
  const definition = q.type === 'true_false' || /defined as follows/i.test(first) ? statementOf(q) : String(q.answer || '');
  if (!definition) return null;
  const term = q.type === 'multiple_choice' && /defined as follows/i.test(first) ? String(q.answer || '') : subject;
  // A self-graded "Define X" reveals its answer after the student has answered: naming X there gives nothing away.
  if (term && q.type !== 'reveal' && mentions(definition, term)) return found('bad_definition', `the definition contains its own term "${term}"`);
  const m = definition.match(DANGLING_DEFINITION_RE);
  return m ? found('bad_definition', `the definition leans on "${m[0]}"`) : null;
}

// Word-shaped: a word, a hyphenated or apostrophised word, an acronym, a number, a unit, a formula token.
const WORD_SHAPED_RE = /^(?:[A-Za-z]+(?:[-'’][A-Za-z]+)*|[A-Z0-9]{1,6}s?|\d+(?:[.,]\d+)*%?|[A-Za-z]\d{0,2}|\d+[a-z]{1,3}|[A-Za-z]+_\{?[A-Za-z0-9]+\}?)$/;
const EDGE_PUNCT_RE = /^[("“'‘[{]+|[)"”'’\]}.,;:!?]+$/g;

/** garbled_token: a token of the stem or answer that is not word-shaped and that the scope prints only there. */
function lintGarbledToken(q, ctx) {
  const text = T.stripMath(`${T.stemBody(q)} ${q.type === 'true_false' ? '' : q.answer || ''}`);
  // A cloze's neutral article and trademark signs are the engine's and the publisher's, not debris.
  const plain = text.replace(/\b[Aa]\(n\)/g, 'a').replace(/[®™©…]/g, ' ').replace(/[—–]/g, ' ');
  for (const raw of plain.match(/\S+/g) || []) {
    const tok = raw.replace(EDGE_PUNCT_RE, '').replace(EDGE_PUNCT_RE, '').replace(/-$/, '');
    if (!tok || tok.length < 3 || /_{3,}/.test(tok) || WORD_SHAPED_RE.test(tok) || !/[A-Za-z]/.test(tok)) continue;
    if (/^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+$/.test(tok)) continue; // "and/or", "input-output", "T-cell", "0-to-1"
    const uses = ctx && ctx.wordCounts ? [...ctx.wordCounts].filter(([w]) => w.includes(tok)).reduce((n, [, c]) => n + c, 0) : 0;
    if (uses <= 1) return found('garbled_token', `"${tok}" is not word-shaped and occurs nowhere else in the scope`);
  }
  return null;
}

// Case signalment: age, sex/neuter status, breed shorthand.
const SIGNALMENT_RE = /\b\d+\s*(?:y\/?o|yo|yrs?|years?[- ]old|mo|months?[- ]old|wks?[- ]old)\b|\b(?:M\/?N|F\/?S|M\/?I|F\/?I|MN|FS|MC|DSH|DLH|DMH)\b|\bpresent(?:ed|s)\s+(?:with|for)\b/;
const BIOGRAPHY_RE = /\(\s*1[0-9]{3}\s*[–-]\s*(?:1[0-9]{3}|20[0-9]{2})\s*\)|\b(?:was|were)\s+born\b|\bdied\s+in\b|\btutored\b|\bhis\s+(?:father|mother|wife|death|life|students?)\b/i;
const PLACE_CUE_RE = /\b(?:capital|city|country|state|province|river|island)\s+of\b/i;
const PROPER_NAME_RE = /^(?:[A-Z][a-z]+\.?)(?:\s+(?:[A-Z]\.|[A-Z][a-z]+|of|de|von|van|the)){0,3}$/;

/** The scope sentences that mention a name. */
const sentencesWith = (ctx, name) => (ctx ? ctx.text.split(/(?<=[.!?])\s+|\n/).filter((s) => s.includes(name)) : []);

/** filler_subject: signalment in the stem or answer, or a person/place answer outside a history scope. */
function lintFillerSubject(q, ctx) {
  const text = `${String(q.question || '')} ${q.type === 'true_false' ? '' : q.answer || ''}`;
  const sig = text.match(SIGNALMENT_RE);
  if (sig) return found('filler_subject', `case signalment "${sig[0]}"`);
  if (!ctx || ctx.isHistory) return null;
  const names = [subjectOf(q), q.type === 'true_false' ? '' : String(q.answer || '')].map((s) => s.trim()).filter((s) => PROPER_NAME_RE.test(s));
  for (const name of names) {
    const around = sentencesWith(ctx, name);
    if (around.some((s) => BIOGRAPHY_RE.test(s))) return found('filler_subject', `"${name}" is a person from a biography`);
    if (around.some((s) => PLACE_CUE_RE.test(s))) return found('filler_subject', `"${name}" is a place from an example`);
  }
  return null;
}

const CONTENT_LINTS = [lintAttributionStem, lintGenericSubject, lintOptionsSameSubject, lintFalseTrueOfSubject, lintBadDefinition,
  lintGarbledToken, lintFillerSubject];
const CONTENT_LINT_NAMES = ['attribution_stem', 'generic_subject', 'options_same_subject', 'tf_false_true_of_subject', 'bad_definition',
  'garbled_token', 'filler_subject'];

/** The fact a question tests, for quiz/test overlap: its source when it has one, else stem body + answer. */
function factIdentity(q) {
  if (q.source) return `s:${norm(q.source)}`;
  const body = T.stemBody(q);
  const answer = q.type === 'true_false' ? '' : String(q.answer || '');
  return `t:${norm(T.BLANK_RE.test(body) ? body.replace(T.BLANK_RE, answer) : `${body} ${answer}`)}`;
}

module.exports = {
  CONTENT_LINTS, CONTENT_LINT_NAMES, buildContentIndex, isGenericHeading, subjectOf, statementOf, factIdentity,
  lintAttributionStem, lintGenericSubject, lintOptionsSameSubject, lintFalseTrueOfSubject, lintBadDefinition,
  lintGarbledToken, lintFillerSubject,
};

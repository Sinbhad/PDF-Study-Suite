/**
 * Guessability solver for tools/eval-quiz.js: answers questions without reading the subject, from surface
 * tells only. If it beats chance by a wide margin, the questions can be passed by test-taking tricks.
 *
 *   True/False       "False" when the statement contains a word from an antonym pair, otherwise "True"
 *   multiple choice  the one option that fits a grammar tell, tried in this order:
 *                      1. the only option that agrees with "a"/"an" before the blank
 *                      2. the only option whose capitalisation fits the blank's position (capital at the
 *                         start of the statement, lower case inside it)
 *                      3. the option much longer than the rest
 *                    with no tell it does not guess, and is credited with chance (1 / number of options)
 */
const T = require('./eval-quiz-text.js');
const { articleBeforeBlank, lengthOutlier } = require('./eval-quiz-option-lints.js');

const only = (list) => (list.length === 1 ? list[0] : null);

function articleTell(q, options) {
  const article = articleBeforeBlank(q);
  if (!article) return null;
  const fits = options.filter((o) => T.articleFits(article, o) === true);
  const unknown = options.filter((o) => T.articleFits(article, o) === null);
  return unknown.length ? null : only(fits);
}

function caseTell(q, options) {
  if (q.type !== 'cloze') return null;
  const body = T.stemBody(q);
  const at = body.search(T.BLANK_RE);
  if (at < 0) return null;
  const wanted = at === 0 || /[.!?]\s+$/.test(body.slice(0, at)) ? 'upper' : 'lower';
  const cases = options.map(T.leadingCase);
  if (cases.some((c) => c === null)) return null;
  return only(options.filter((_, i) => cases[i] === wanted));
}

/** -> { pick, tell } when a tell singles out one option, else null. */
function guess(q) {
  if (T.isTrueFalse(q)) {
    const hit = T.words(T.stemBody(q)).find((w) => T.ANTONYM_WORDS.has(w));
    return { pick: hit ? 'False' : 'True', tell: hit ? `antonym word "${hit}"` : 'no antonym word' };
  }
  const options = (q.options || []).map(String);
  if (options.length < 2) return null;
  const tells = [['article', articleTell(q, options)], ['capitalisation', caseTell(q, options)], ['longest', lengthOutlier(q)]];
  const hit = tells.find(([, pick]) => pick);
  return hit ? { pick: hit[1], tell: hit[0] } : null;
}

/**
 * Scores the solver over a list of questions. Questions without options (self-graded reveals, and typed answers the
 * app checks) are left out: there is nothing to pick from, so nothing to guess.
 * -> { n, expected, chance, tells }: `expected` is the number the solver gets right (a question without a
 * tell counts 1/options), `chance` what blind guessing gets, `tells` how many questions had a tell.
 */
function score(questions) {
  const out = { n: 0, expected: 0, chance: 0, tells: 0 };
  for (const q of questions) {
    const count = (q.options || []).length;
    if (count < 2) continue;
    out.n++;
    out.chance += 1 / count;
    const g = guess(q);
    if (!g) {
      out.expected += 1 / count;
      continue;
    }
    out.tells++;
    if (g.pick === String(q.answer)) out.expected++;
  }
  return out;
}

module.exports = { guess, score };

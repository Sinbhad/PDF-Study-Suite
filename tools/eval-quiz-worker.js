/**
 * Worker subprocess helper for parallel corpus evaluation (used by tools/eval-quiz.js --jobs=N).
 * Evaluates assigned manifest entries and returns results via IPC.
 */
const { loadPipeline, buildEntry } = require('./eval-quiz-corpus.js');
const { lintSet, lintQuizTestOverlap, lintCrossSetRepeats, LINT_NAMES } = require('./eval-quiz-lints.js');
const { crudeStem, stripMath, stripMarkdown, stemBody } = require('./eval-quiz-text.js');
const solver = require('./eval-quiz-solver.js');
const { pct, round3 } = require('./eval-quiz-report.js');

const MAX_TERM_WORDS = 8;
const isTyped = (q) => q.type === 'typed';
const isSelfGraded = (q) => q.type === 'reveal' || (!isTyped(q) && (!Array.isArray(q.options) || q.options.length < 2));
const termStems = (s) => (stripMath(stripMarkdown(s)).toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => w.length > 1 || /\d/.test(w)).map(crudeStem);

function goldCoverage(goldTerms, flashcards, questions) {
  const gold = goldTerms || [];
  const surfaces = [...flashcards.map((c) => c.front), ...questions.map((q) => q.answer)]
    .map(termStems).filter((t) => t.length && t.length <= MAX_TERM_WORDS).map((t) => ` ${t.join(' ')} `);
  const missing = gold.filter((term) => !surfaces.some((s) => s.includes(` ${termStems(term).join(' ')} `)));
  return { hit: gold.length - missing.length, total: gold.length, pct: pct(gold.length - missing.length, gold.length), missing };
}

async function measureOne(P, entry, manifest, opts = {}) {
  const built = await buildEntry(P, entry, manifest, opts);
  const sets = [['quiz', built.quiz], ['test', built.test]];
  const questions = [...built.quiz, ...built.test];
  const lints = {};
  const offenders = [];
  let defective = 0;
  const overlap = lintQuizTestOverlap(built.quiz, built.test);
  const anyForm = lintCrossSetRepeats(built.quiz, built.test);
  const review = built.test.filter((q) => q.review);
  for (const [setName, list] of sets) {
    lintSet(list, built.scopeText).forEach((own, i) => {
      const crossing = setName === 'test' ? [overlap[i] && !list[i].review ? overlap[i] : null, anyForm[i]].filter(Boolean) : [];
      const findings = [...own, ...crossing];
      if (findings.length) defective++;
      for (const f of findings) {
        lints[f.lint] = (lints[f.lint] || 0) + 1;
        offenders.push({ doc: entry.id, set: setName, id: list[i].id, lint: f.lint, detail: f.detail, question: list[i] });
      }
    });
  }
  const words = (built.scopeText.match(/\S+/g) || []).length;
  const guessed = solver.score(questions);
  const record = {
    id: entry.id, kind: entry.kind, words,
    requested: built.requested, generated: questions.length, quiz: built.quiz.length, test: built.test.length,
    defective, defectPct: pct(defective, questions.length),
    overlap: { count: overlap.filter((o, i) => o && !built.test[i].review).length, of: built.test.length, review: review.length },
    recall: { quiz: built.quiz.filter(isSelfGraded).length, test: built.test.filter(isSelfGraded).length },
    typed: { quiz: built.quiz.filter(isTyped).length, test: built.test.filter(isTyped).length },
    lints: Object.fromEntries(LINT_NAMES.filter((name) => lints[name]).map((name) => [name, lints[name]])),
    flashcards: built.flashcards.length,
    per1000: words ? Math.round((questions.length / words) * 10000) / 10 : 0,
    gold: goldCoverage(entry.goldTerms, built.flashcards, questions),
    guess: {
      n: guessed.n, expected: round3(guessed.expected), byChance: round3(guessed.chance),
      accuracy: pct(guessed.expected, guessed.n), chance: pct(guessed.chance, guessed.n), tells: guessed.tells,
    },
  };
  return { record, offenders };
}

if (require.main === module) {
  const log = console.log;
  console.log = (...args) => {
    if (!/^Warning: /.test(String(args[0]))) log(...args);
  };
  console.warn = () => {};
  const P = loadPipeline();
  process.on('message', async (msg) => {
    try {
      if (msg && msg.type === 'run') {
        const res = await measureOne(P, msg.entry, msg.manifest, msg.opts || {});
        process.send({ type: 'done', idx: msg.idx, res });
      } else if (msg && msg.type === 'quit') {
        process.exit(0);
      }
    } catch (err) {
      process.send({ type: 'error', idx: msg && msg.idx, error: String((err && err.stack) || err) });
    }
  });
}

module.exports = { measureOne, goldCoverage, isTyped, isSelfGraded, stemBody };

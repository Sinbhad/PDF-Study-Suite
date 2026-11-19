/**
 * Question-quality eval: generates the quiz, practice test and flashcards for every document of a corpus
 * exactly as the app does, runs the lints of tools/eval-quiz-lints.js over every question, and prints a
 * defect score per document, so a change to generation can be judged against a saved baseline.
 *
 * Usage: node tools/eval-quiz.js [--corpus=tests/corpus/manifest.json] [--out=file.json] [--baseline=file.json]
 *                                [--only=id] [--show=lint|all]
 *   --corpus    manifest listing the documents (PDFs with a page range and mode, or raw .txt passages)
 *   --out       write the report (per-document records + total) as JSON; this is what a baseline is
 *   --baseline  print deltas against a saved report; exit 1 if the total defect % rose by more than 2 points
 *   --only      run only the documents whose id contains this text (the regression gate is then skipped)
 *   --show      print the offending questions for one lint, or for every lint with --show=all
 *
 * Per document: questions generated vs requested, questions with at least one defect, defects by lint,
 * flashcards, questions per 1,000 words, gold-term coverage, and how well a subject-blind solver does.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadPipeline, readManifest, buildEntry } = require('./eval-quiz-corpus.js');
const { lintSet, lintQuizTestOverlap, lintCrossSetRepeats, LINT_NAMES } = require('./eval-quiz-lints.js');
const { crudeStem, stripMath, stripMarkdown, stemBody } = require('./eval-quiz-text.js');
const solver = require('./eval-quiz-solver.js');
const { pct, round3, totalOf, recordLines, compare } = require('./eval-quiz-report.js');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [key, ...rest] = a.slice(2).split('=');
  return [key, rest.join('=') || true];
}));
const CORPUS = path.resolve(ROOT, typeof flags.corpus === 'string' ? flags.corpus : 'tests/corpus/manifest.json');

const MAX_TERM_WORDS = 8;
// A typed question has no options but is checked by the app: it is counted apart, never as self-graded.
const isTyped = (q) => q.type === 'typed';
const isSelfGraded = (q) => q.type === 'reveal' || (!isTyped(q) && (!Array.isArray(q.options) || q.options.length < 2));
/** A term as crude stems; one-letter fragments ("Dijkstra's" -> dijkstra, s) are dropped. */
const termStems = (s) => (stripMath(stripMarkdown(s)).toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => w.length > 1 || /\d/.test(w)).map(crudeStem);

/**
 * Gold-term coverage: the share of the entry's goldTerms that appear, as a run of whole words, in a
 * flashcard front or a question answer. Fronts and answers longer than 8 words are ignored: a whole
 * definition that merely mentions the term is not a card for it.
 */
function goldCoverage(goldTerms, flashcards, questions) {
  const gold = goldTerms || [];
  const surfaces = [...flashcards.map((c) => c.front), ...questions.map((q) => q.answer)]
    .map(termStems).filter((t) => t.length && t.length <= MAX_TERM_WORDS).map((t) => ` ${t.join(' ')} `);
  const missing = gold.filter((term) => !surfaces.some((s) => s.includes(` ${termStems(term).join(' ')} `)));
  return { hit: gold.length - missing.length, total: gold.length, pct: pct(gold.length - missing.length, gold.length), missing };
}

/** Runs one corpus entry -> { record, offenders } (offenders: one row per finding, for --show). */
async function measure(P, entry, manifest) {
  const built = await buildEntry(P, entry, manifest);
  const sets = [['quiz', built.quiz], ['test', built.test]];
  const questions = [...built.quiz, ...built.test];
  const lints = {};
  const offenders = [];
  let defective = 0;
  // A practice-test question that re-asks a quiz fact is a defect of the test: the student sees it twice.
  // A review question (the test came back to a quiz fact in another form, and says so) is counted apart.
  const overlap = lintQuizTestOverlap(built.quiz, built.test);
  // The same fact in any form (the same short answer, a formula one answers and the other prints), and a review
  // question asked in the quiz's own form.
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
    // Self-graded recall questions, per set: what no choice form could ask honestly.
    recall: { quiz: built.quiz.filter(isSelfGraded).length, test: built.test.filter(isSelfGraded).length },
    // Typed questions (an answer the student types, checked by the app), per set.
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

function printOffenders(offenders, which) {
  const rows = offenders.filter((o) => which === 'all' || which === true || o.lint === which);
  console.log(`\nOFFENDERS (${which === true ? 'all' : which}): ${rows.length}`);
  for (const o of rows) {
    const q = o.question;
    console.log(`[${o.doc} ${o.set} ${o.id}] ${o.lint}: ${o.detail}`);
    console.log(`    stem: ${stemBody(q).replace(/\s+/g, ' ').slice(0, 240)}`);
    if ((q.options || []).length) console.log(`    options: ${q.options.join(' | ').slice(0, 240)}   answer: ${String(q.answer).slice(0, 80)}`);
  }
}

(async () => {
  // PDF.js reports its missing standard-font data through console.log("Warning: ..."); keep the report clean
  const log = console.log;
  console.log = (...args) => {
    if (!/^Warning: /.test(String(args[0]))) log(...args);
  };
  console.warn = () => {};
  const manifest = readManifest(CORPUS);
  const baseline = typeof flags.baseline === 'string' ? JSON.parse(fs.readFileSync(path.resolve(flags.baseline), 'utf8')) : null;
  const entries = manifest.entries.filter((e) => typeof flags.only !== 'string' || e.id.includes(flags.only));
  if (!entries.length) throw new Error(`no corpus entry matches --only=${flags.only}`);
  const P = loadPipeline();
  const baseDocs = new Map(((baseline && baseline.documents) || []).map((d) => [d.id, d]));
  const records = [];
  const offenders = [];
  for (const entry of entries) {
    const res = await measure(P, entry, manifest);
    records.push(res.record);
    offenders.push(...res.offenders);
    console.log(recordLines(res.record, baseDocs.get(entry.id)).join('\n'));
    console.log('');
  }
  const partial = entries.length !== manifest.entries.length;
  const report = { corpus: path.relative(ROOT, CORPUS).replace(/\\/g, '/'), documents: records, total: totalOf(records) };
  console.log(recordLines(report.total, !partial && baseline ? baseline.total : undefined).join('\n'));
  if (flags.show) printOffenders(offenders, flags.show);
  if (typeof flags.out === 'string') fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify(report, null, 1)}\n`);
  let failed = false;
  if (baseline) {
    const verdict = compare(report, baseline, partial);
    console.log(`\n${verdict.lines.join('\n')}`);
    failed = verdict.failed;
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});

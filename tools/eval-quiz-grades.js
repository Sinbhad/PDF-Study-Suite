/**
 * Human-graded regression check: given a file of questions a person graded GOOD / OK / BAD, reports how many
 * of the BAD ones (and of the others) the current build still generates for the same documents.
 *
 * Usage: node tools/eval-quiz-grades.js --grades=<grades.json> [--corpus=<manifest.json>] [--show]
 *   --grades  JSON array of { doc, kind: 'quiz' | 'test', grade: 'GOOD' | 'OK' | 'BAD', reason?, stem, answer }
 *             `doc` is the id of an entry in the corpus manifest; `stem` is the question text as generated
 *   --corpus  the manifest the documents come from (default tests/corpus/manifest.json)
 *   --show    list every BAD question that is still generated
 *
 * A graded question counts as generated again when a quiz or practice-test question of the same document
 * has the same normalised stem and answer (case, spacing and punctuation ignored). Grades of real,
 * copyrighted documents stay outside the repository; tests/corpus/grades-example.json is a synthetic example.
 * Exit codes: 0 ok, 2 the tool itself failed.
 */
const fs = require('fs');
const path = require('path');
const { ROOT, loadPipeline, readManifest, buildEntry } = require('./eval-quiz-corpus.js');

const GRADES = ['GOOD', 'OK', 'BAD'];

/** Stem + answer with case, spacing and punctuation folded away: the identity of a graded question. */
const normalise = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const questionKey = (stem, answer) => `${normalise(stem)}\u0001${normalise(Array.isArray(answer) ? answer.join(' ') : answer)}`;

/**
 * Pure part, for tests: grades of one document against the questions generated for it now.
 * -> { byGrade: { GOOD: { graded, still }, ... }, stillBad: [grade entries] }
 */
function compareGrades(grades, questions) {
  const now = new Set(questions.map((q) => questionKey(q.question, q.answer)));
  const byGrade = Object.fromEntries(GRADES.map((g) => [g, { graded: 0, still: 0 }]));
  const stillBad = [];
  for (const g of grades) {
    const row = byGrade[g.grade];
    if (!row) continue;
    row.graded++;
    if (!now.has(questionKey(g.stem, g.answer))) continue;
    row.still++;
    if (g.grade === 'BAD') stillBad.push(g);
  }
  return { byGrade, stillBad };
}

function addInto(total, part) {
  for (const g of GRADES) {
    total[g].graded += part[g].graded;
    total[g].still += part[g].still;
  }
}

const line = (label, byGrade) => `${label.padEnd(28)} ${GRADES.map((g) => `${g} ${byGrade[g].still}/${byGrade[g].graded}`).join('   ')}`;

async function main() {
  const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [key, ...rest] = a.slice(2).split('=');
    return [key, rest.join('=') || true];
  }));
  if (typeof flags.grades !== 'string') throw new Error('--grades=<file> is required');
  const grades = JSON.parse(fs.readFileSync(path.resolve(flags.grades), 'utf8')).filter((g) => g.kind === 'quiz' || g.kind === 'test');
  const manifest = readManifest(path.resolve(ROOT, typeof flags.corpus === 'string' ? flags.corpus : 'tests/corpus/manifest.json'));
  const docs = [...new Set(grades.map((g) => g.doc))];
  const missing = docs.filter((d) => !manifest.entries.some((e) => e.id === d));
  if (missing.length) throw new Error(`graded documents not in the manifest: ${missing.join(', ')}`);

  // PDF.js reports missing font data through console.log("Warning: ..."); keep the report clean.
  const log = console.log;
  console.log = (...args) => {
    if (!/^Warning: /.test(String(args[0]))) log(...args);
  };
  console.warn = () => {};
  const P = loadPipeline();
  const total = Object.fromEntries(GRADES.map((g) => [g, { graded: 0, still: 0 }]));
  const stillBad = [];
  log('Graded questions the current build still generates (still / graded):');
  for (const doc of docs) {
    const entry = manifest.entries.find((e) => e.id === doc);
    const built = await buildEntry(P, entry, manifest);
    const res = compareGrades(grades.filter((g) => g.doc === doc), [...built.quiz, ...built.test]);
    addInto(total, res.byGrade);
    stillBad.push(...res.stillBad);
    log(line(doc, res.byGrade));
  }
  log(line('TOTAL', total));
  if (flags.show) {
    log(`\nBAD questions still generated: ${stillBad.length}`);
    for (const g of stillBad) log(`[${g.doc} ${g.kind} ${g.index || ''}] ${g.reason || ''}\n    ${String(g.stem).replace(/\s+/g, ' ').slice(0, 200)}\n    answer: ${String(g.answer).slice(0, 100)}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

module.exports = { compareGrades, questionKey };

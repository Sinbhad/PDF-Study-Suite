/**
 * Report side of tools/eval-quiz.js: turns per-document score records into the printed lines, adds the
 * deltas against a saved baseline, and decides whether the run regressed.
 *
 * A record (one per document, plus the total) is plain JSON:
 *   { id, kind, words, requested, generated, quiz, test, defective, defectPct, lints: { name: count },
 *     overlap: { count, of, review } (practice-test questions that re-ask a quiz fact without saying so, of all test
 *              questions; review: those flagged as review, asked in another form),
 *     recall: { quiz, test } (self-graded questions in each set),
 *     flashcards, per1000, gold: { hit, total, pct, missing },
 *     guess: { n, expected, byChance, accuracy, chance, tells } }
 * guess.expected / guess.byChance are question counts (solver vs blind guessing); accuracy / chance the same in %.
 */

/** The total defect % may rise by this many points over the baseline before the run fails. */
const MAX_DEFECT_RISE = 2;

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const round3 = (n) => Math.round(n * 1000) / 1000;
const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

/** Folds document records into the total record (sums, then the same ratios as a document). */
function totalOf(records) {
  const sum = (pick) => records.reduce((n, r) => n + pick(r), 0);
  const lints = {};
  for (const r of records) for (const [name, n] of Object.entries(r.lints)) lints[name] = (lints[name] || 0) + n;
  const generated = sum((r) => r.generated);
  const defective = sum((r) => r.defective);
  const words = sum((r) => r.words);
  const goldHit = sum((r) => r.gold.hit);
  const goldTotal = sum((r) => r.gold.total);
  const guessN = sum((r) => r.guess.n);
  return {
    id: 'TOTAL', documents: records.length, words,
    requested: sum((r) => r.requested), generated, quiz: sum((r) => r.quiz), test: sum((r) => r.test),
    defective, defectPct: pct(defective, generated), lints,
    overlap: {
      count: sum((r) => (r.overlap ? r.overlap.count : 0)),
      of: sum((r) => (r.overlap ? r.overlap.of : 0)),
      review: sum((r) => (r.overlap && r.overlap.review) || 0),
    },
    recall: { quiz: sum((r) => (r.recall ? r.recall.quiz : 0)), test: sum((r) => (r.recall ? r.recall.test : 0)) },
    flashcards: sum((r) => r.flashcards), per1000: words ? Math.round((generated / words) * 10000) / 10 : 0,
    gold: { hit: goldHit, total: goldTotal, pct: pct(goldHit, goldTotal) },
    guess: {
      n: guessN,
      expected: round3(sum((r) => r.guess.expected)),
      byChance: round3(sum((r) => r.guess.byChance)),
      accuracy: pct(sum((r) => r.guess.expected), guessN),
      chance: pct(sum((r) => r.guess.byChance), guessN),
      tells: sum((r) => r.guess.tells),
    },
  };
}

const lintLine = (lints) => Object.entries(lints).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([name, n]) => `${name} ${n}`).join(', ') || 'none';

/** Lines for one record; `base` is the same document in the baseline (or undefined). */
function recordLines(r, base) {
  // Delta against the baseline value, "(=)" when unchanged, nothing when there is no baseline for it
  const d = (now, was, digits) => {
    if (!base || !Number.isFinite(was)) return '';
    return now === was ? ' (=)' : ` (${signed(now - was, digits)})`;
  };
  const head = r.id === 'TOTAL' ? `TOTAL (${r.documents} documents, ${r.words} words)` : `${r.id} (${r.kind}, ${r.words} words)`;
  const lines = [
    head,
    `  questions   ${r.generated} of ${r.requested} requested${d(r.generated, base && base.generated, 0)}` +
      ` (quiz ${r.quiz}, test ${r.test}), ${r.per1000} per 1,000 words`,
    `  defective   ${r.defective} of ${r.generated} (${r.defectPct}%)${d(r.defectPct, base && base.defectPct)}`,
    `  lints       ${lintLine(r.lints)}`,
    ...(r.overlap ? [`  test overlap ${r.overlap.count} of ${r.overlap.of} test questions re-ask a quiz fact` +
      (r.overlap.review ? ` (+${r.overlap.review} flagged review, in another form)` : '')] : []),
    ...(r.recall ? [`  recall      ${r.recall.quiz} of ${r.quiz} quiz, ${r.recall.test} of ${r.test} test questions are self-graded`] : []),
    `  flashcards  ${r.flashcards}${d(r.flashcards, base && base.flashcards, 0)}`,
    `  gold terms  ${r.gold.hit} of ${r.gold.total} (${r.gold.pct}%)${d(r.gold.pct, base && base.gold && base.gold.pct)}`,
    `  guessable   solver ${r.guess.accuracy}% vs chance ${r.guess.chance}%${d(r.guess.accuracy, base && base.guess && base.guess.accuracy)}` +
      ` (${r.guess.n} questions, a tell or a True/False guess on ${r.guess.tells})`,
  ];
  if (r.gold.missing && r.gold.missing.length) lines.push(`  missing     ${r.gold.missing.join(', ')}`);
  return lines;
}

/** Per-lint change against the baseline total, e.g. "answer_leak -3, thin_stem +1"; '' when nothing moved. */
function lintDeltas(total, baseTotal) {
  const names = new Set([...Object.keys(total.lints), ...Object.keys(baseTotal.lints || {})]);
  return [...names].sort().map((name) => [name, (total.lints[name] || 0) - ((baseTotal.lints || {})[name] || 0)])
    .filter(([, delta]) => delta !== 0).map(([name, delta]) => `${name} ${signed(delta, 0)}`).join(', ');
}

/**
 * Compares a run with a baseline report. -> { lines, failed }. The run fails when the total defect %
 * rose by more than MAX_DEFECT_RISE points; a partial run (--only) is reported but never fails.
 */
function compare(report, baseline, partial) {
  if (partial) {
    return { lines: ['baseline    partial run (--only): per-document deltas only, total not compared, regression gate skipped'], failed: false };
  }
  const rise = report.total.defectPct - baseline.total.defectPct;
  const lines = [`baseline    total defect % ${baseline.total.defectPct} -> ${report.total.defectPct} (${signed(rise)} points)`];
  const moved = lintDeltas(report.total, baseline.total);
  if (moved) lines.push(`            lints: ${moved}`);
  const failed = rise > MAX_DEFECT_RISE;
  if (failed) lines.push(`FAIL        total defect % rose by more than ${MAX_DEFECT_RISE} points`);
  return { lines, failed };
}

module.exports = { MAX_DEFECT_RISE, pct, round3, totalOf, recordLines, compare };

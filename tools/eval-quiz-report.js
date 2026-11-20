/**
 * Report side of tools/eval-quiz.js: turns per-document score records into printed lines, adds deltas
 * against a saved baseline, and decides whether the run regressed under either the legacy single-metric
 * compare() or the multi-metric Pareto gate comparePareto().
 */

/** Legacy single-metric ceiling kept for existing unit fixture compatibility. */
const MAX_DEFECT_RISE = 2;

const DEFAULT_PARETO_BUDGETS = {
  maxDefectRise: 1.0,
  maxYieldDropPct: 5.0,
  minDocYieldRatio: 0.80,
  maxGoldDropOverall: 2.0,
  maxGoldDropDoc: 5.0,
  maxRecallRise: 3.0,
  maxGuessExcessRise: 3.0,
};

const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const round3 = (n) => Math.round(n * 1000) / 1000;
const signed = (n, digits = 1) => `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;

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
    typed: { quiz: sum((r) => (r.typed ? r.typed.quiz : 0)), test: sum((r) => (r.typed ? r.typed.test : 0)) },
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

function recordLines(r, base) {
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
    ...(r.recall ? [`  recall      ${r.recall.quiz} of ${r.quiz} quiz, ${r.recall.test} of ${r.test} test questions are self-graded` +
      ` (${pct(r.recall.quiz + r.recall.test, r.generated)}% of all)`] : []),
    ...(r.typed ? [`  typed       ${r.typed.quiz} of ${r.quiz} quiz, ${r.typed.test} of ${r.test} test questions are typed and checked`] : []),
    `  flashcards  ${r.flashcards}${d(r.flashcards, base && base.flashcards, 0)}`,
    `  gold terms  ${r.gold.hit} of ${r.gold.total} (${r.gold.pct}%)${d(r.gold.pct, base && base.gold && base.gold.pct)}`,
    `  guessable   solver ${r.guess.accuracy}% vs chance ${r.guess.chance}%${d(r.guess.accuracy, base && base.guess && base.guess.accuracy)}` +
      ` (${r.guess.n} questions, a tell or a True/False guess on ${r.guess.tells})`,
  ];
  if (r.gold.missing && r.gold.missing.length) lines.push(`  missing     ${r.gold.missing.join(', ')}`);
  return lines;
}

function lintDeltas(total, baseTotal) {
  const names = new Set([...Object.keys(total.lints), ...Object.keys(baseTotal.lints || {})]);
  return [...names].sort().map((name) => [name, (total.lints[name] || 0) - ((baseTotal.lints || {})[name] || 0)])
    .filter(([, delta]) => delta !== 0).map(([name, delta]) => `${name} ${signed(delta, 0)}`).join(', ');
}

/** Legacy compare() kept intact for tests/eval_quiz_lint_fixtures.js. */
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

function recallShare(rec) {
  if (!rec || !rec.recall || !rec.generated) return 0;
  return pct((rec.recall.quiz || 0) + (rec.recall.test || 0), rec.generated);
}

/**
 * Multi-metric Pareto gate used by tools/check-all.py and `eval-quiz.js --pareto`.
 * -> { lines, reasons, failed }
 */
function comparePareto(report, baseline, partial, opts = {}) {
  if (partial) {
    return {
      lines: ['pareto      partial run (--only): regression gate skipped'],
      reasons: [],
      failed: false,
    };
  }
  const b = { ...DEFAULT_PARETO_BUDGETS, ...(opts.budgets || {}) };
  const waiveYield = new Set(opts.waiveYield || []);
  const reasons = [];
  const nowT = report.total;
  const baseT = baseline.total;

  const defectRise = Math.round((nowT.defectPct - baseT.defectPct) * 10) / 10;
  if (defectRise > b.maxDefectRise) {
    reasons.push(`defectPct rose ${signed(defectRise)} pts (${baseT.defectPct}% -> ${nowT.defectPct}%, max +${b.maxDefectRise})`);
  }

  if (baseT.generated > 0) {
    const yieldDropPct = Math.round(((baseT.generated - nowT.generated) / baseT.generated) * 1000) / 10;
    if (yieldDropPct > b.maxYieldDropPct) {
      reasons.push(`question yield dropped ${yieldDropPct}% (${baseT.generated} -> ${nowT.generated}, max -${b.maxYieldDropPct}%)`);
    }
  }

  const nowDocs = new Map((report.documents || []).map((d) => [d.id, d]));
  for (const baseDoc of baseline.documents || []) {
    const nowDoc = nowDocs.get(baseDoc.id);
    if (!nowDoc) continue;
    if (!waiveYield.has(baseDoc.id) && baseDoc.generated > 0) {
      const floor = Math.floor(baseDoc.generated * b.minDocYieldRatio);
      if (nowDoc.generated < floor) {
        reasons.push(`${baseDoc.id} yield dropped below floor (${nowDoc.generated} < ${floor}, baseline ${baseDoc.generated})`);
      }
    }
    if (baseDoc.gold && baseDoc.gold.total > 0 && nowDoc.gold && nowDoc.gold.total > 0) {
      const docGoldDrop = Math.round((baseDoc.gold.pct - nowDoc.gold.pct) * 10) / 10;
      if (docGoldDrop > b.maxGoldDropDoc) {
        reasons.push(`${baseDoc.id} gold.pct dropped ${docGoldDrop} pts (${baseDoc.gold.pct}% -> ${nowDoc.gold.pct}%, max -${b.maxGoldDropDoc})`);
      }
    }
  }

  if (baseT.gold && baseT.gold.total > 0 && nowT.gold && nowT.gold.total > 0) {
    const goldDrop = Math.round((baseT.gold.pct - nowT.gold.pct) * 10) / 10;
    if (goldDrop > b.maxGoldDropOverall) {
      reasons.push(`gold.pct dropped ${goldDrop} pts overall (${baseT.gold.pct}% -> ${nowT.gold.pct}%, max -${b.maxGoldDropOverall})`);
    }
  }

  if (baseT.recall && nowT.recall) {
    const nowR = recallShare(nowT);
    const baseR = recallShare(baseT);
    const recallRise = Math.round((nowR - baseR) * 10) / 10;
    if (recallRise > b.maxRecallRise) {
      reasons.push(`self-graded recall share rose ${signed(recallRise)} pts (${baseR}% -> ${nowR}%, max +${b.maxRecallRise})`);
    }
  }

  if (baseT.guess && nowT.guess) {
    const nowEx = (nowT.guess.accuracy || 0) - (nowT.guess.chance || 0);
    const baseEx = (baseT.guess.accuracy || 0) - (baseT.guess.chance || 0);
    const exRise = Math.round((nowEx - baseEx) * 10) / 10;
    if (exRise > b.maxGuessExcessRise) {
      reasons.push(`solver accuracy-over-chance rose ${signed(exRise)} pts (${signed(baseEx)} -> ${signed(nowEx)}, max +${b.maxGuessExcessRise})`);
    }
  }

  const lines = [
    `pareto      defectPct ${baseT.defectPct} -> ${nowT.defectPct} (${signed(defectRise)}), yield ${baseT.generated} -> ${nowT.generated}, gold ${baseT.gold ? baseT.gold.pct : 0}% -> ${nowT.gold ? nowT.gold.pct : 0}%, recall ${recallShare(baseT)}% -> ${recallShare(nowT)}%`,
  ];
  const moved = lintDeltas(nowT, baseT);
  if (moved) lines.push(`            lints: ${moved}`);
  for (const r of reasons) lines.push(`FAIL        ${r}`);
  return { lines, reasons, failed: reasons.length > 0 };
}

module.exports = { MAX_DEFECT_RISE, DEFAULT_PARETO_BUDGETS, pct, round3, totalOf, recordLines, compare, comparePareto };

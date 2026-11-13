/**
 * Scores one evaluated page against its reference transcript, for all recognised pieces and for the kept
 * pieces only (confidence >= LOW, i.e. the ones the app does not flag). Pure functions (Node-testable).
 */
const { score, piecesOf, alignLines, normalise } = require('./eval-metrics.js');

const LOW = 0.6;
const CATEGORIES = ['Neat', 'Average', 'Messy', 'Digital', 'Printed', 'Synthetic']; // Printed: scanned print (tools/make-scan-fixtures.py)

/** Category from the file-name prefix ("neat-03-....jpg" -> "Neat"); synthetic pages are never "real". */
function categoryOf(file) {
  const m = /^([a-z]+)-/i.exec(String(file));
  const name = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Other';
  return CATEGORIES.includes(name) ? name : 'Other';
}
const isSynthetic = (file) => categoryOf(file) === 'Synthetic';

/** Scores of one variant (a list of pieces) against the reference lines. */
function scoreVariant(refLines, pieces) {
  const page = score(refLines.join(' '), pieces.map((p) => p.text).join(' '));
  const al = alignLines(refLines, pieces, 3);
  const matched = al.lines.filter((l) => l.matched);
  const refChars = al.lines.reduce((n, l) => n + l.refChars, 0);
  const covered = matched.reduce((n, l) => n + l.refChars, 0);
  return {
    page,
    lines: al.lines,
    extras: al.extras.map((p) => ({ text: p.text, confidence: p.confidence })),
    missed: al.missed,
    extraCount: al.extras.length,
    matchedEdits: matched.reduce((n, l) => n + l.charEdits, 0),
    matchedChars: covered,
    refChars,
    coverage: refChars ? covered / refChars : 0,
  };
}

/**
 * @param {object} rec per-image JSON written by eval-handwriting.js
 * @param {?string[]} refLines reference lines, or null when the page has no transcript
 */
function scorePage(rec, refLines) {
  const regions = rec.result && Array.isArray(rec.result.lines) ? rec.result.lines.flatMap((l) => l.regions || []) : [];
  const out = {
    file: rec.file,
    category: categoryOf(rec.file),
    synthetic: isSynthetic(rec.file),
    error: rec.error || (rec.result && rec.result.skippedReason) || null,
    seconds: Number(rec.seconds) || 0,
    pieces: regions.length,
    low: regions.filter((r) => !(Number(r.confidence) >= LOW)).length,
    scored: Array.isArray(refLines),
  };
  if (!out.scored) return out;
  const all = piecesOf(rec.result);
  out.refLines = refLines.map(normalise);
  out.all = scoreVariant(refLines, all);
  out.kept = scoreVariant(refLines, all.filter((p) => p.confidence >= LOW));
  return out;
}

const sum = (list, f) => list.reduce((n, x) => n + (f(x) || 0), 0);
const div = (a, b) => (b > 0 ? a / b : null);

/** Micro-averaged figures for a group of scored pages (sum of edits / sum of reference length). */
function aggregate(pages) {
  const scored = pages.filter((p) => p.scored);
  const variant = (key) => ({
    cer: div(sum(scored, (p) => p[key].page.charEdits), sum(scored, (p) => p[key].page.refChars)),
    wer: div(sum(scored, (p) => p[key].page.wordEdits), sum(scored, (p) => p[key].page.refWords)),
    looseCer: div(sum(scored, (p) => p[key].page.looseEdits), sum(scored, (p) => p[key].page.looseChars)),
    lineCer: div(sum(scored, (p) => p[key].matchedEdits), sum(scored, (p) => p[key].matchedChars)),
    coverage: div(sum(scored, (p) => p[key].matchedChars), sum(scored, (p) => p[key].refChars)),
    missed: sum(scored, (p) => p[key].missed),
    extra: sum(scored, (p) => p[key].extraCount),
  });
  const pieces = sum(pages, (p) => p.pieces);
  const seconds = sum(pages, (p) => p.seconds);
  return {
    pages: pages.length,
    scoredPages: scored.length,
    refLines: sum(scored, (p) => p.refLines.length),
    errors: pages.filter((p) => p.error).length,
    all: scored.length ? variant('all') : null,
    kept: scored.length ? variant('kept') : null,
    piecesPerPage: div(pieces, pages.length),
    lowShare: div(sum(pages, (p) => p.low), pieces),
    secondsPerPage: div(seconds, pages.length),
    secondsPerPiece: div(seconds, pieces),
  };
}

/** Per category, then Real (every non-synthetic page) and Synthetic as separate groups. Never mixed. */
function groupSummary(pages) {
  const byCategory = {};
  for (const c of [...CATEGORIES, 'Other']) {
    const list = pages.filter((p) => p.category === c);
    if (list.length) byCategory[c] = aggregate(list);
  }
  return {
    byCategory,
    real: aggregate(pages.filter((p) => !p.synthetic)),
    synthetic: aggregate(pages.filter((p) => p.synthetic)),
  };
}

const BUCKETS = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.0001]];

/** Matched lines bucketed by a confidence value: count and mean line CER per bucket. */
function calibration(lines, valueOf) {
  return BUCKETS.map(([lo, hi]) => {
    const inBucket = lines.filter((l) => { const v = valueOf(l); return typeof v === 'number' && v >= lo && v < hi; });
    return { range: `${lo.toFixed(1)}-${Math.min(1, hi).toFixed(1)}`, count: inBucket.length, meanCer: inBucket.length ? sum(inBucket, (l) => l.cer) / inBucket.length : null };
  });
}

/** Calibration tables over the real pages (all-pieces alignment); stats tables only when regions carry stats. */
function calibrationTables(pages) {
  const lines = pages.filter((p) => p.scored && !p.synthetic).flatMap((p) => p.all.lines.filter((l) => l.matched));
  const out = { confidence: calibration(lines, (l) => l.confidence) };
  if (lines.some((l) => l.stats && typeof l.stats.mean === 'number')) out.statsMean = calibration(lines, (l) => l.stats && l.stats.mean);
  if (lines.some((l) => l.stats && typeof l.stats.min === 'number')) out.statsMin = calibration(lines, (l) => l.stats && l.stats.min);
  return out;
}

/** The n worst reference lines over all scored pages (all pieces): highest CER, longer lines first on ties. */
function worstLines(pages, n) {
  const all = pages.filter((p) => p.scored).flatMap((p) => p.all.lines.map((l) => Object.assign({ file: p.file }, l)));
  return all.filter((l) => l.refChars > 0).sort((a, b) => b.cer - a.cer || b.refChars - a.refChars).slice(0, n);
}

module.exports = { LOW, CATEGORIES, categoryOf, isSynthetic, scoreVariant, scorePage, aggregate, groupSummary, calibration, calibrationTables, worstLines };

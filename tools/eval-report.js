/**
 * Reads the per-image JSON files of an evaluation run, scores them against TRANSCRIPTS.json and writes
 * summary.json (everything, including per-line records) and summary.md (compact tables).
 */
const fs = require('fs');
const path = require('path');
const { scorePage, groupSummary, calibrationTables, worstLines, LOW } = require('./eval-score.js');

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '-');
const num = (v, d = 1) => (typeof v === 'number' ? v.toFixed(d) : '-');
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');
const clip = (s) => (s.length > 90 ? `${s.slice(0, 87)}...` : s); // summary.json keeps the full text
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n');

/** Transcripts as { file: [lines] }, or null when the folder has none. */
function loadTranscripts(dir) {
  const f = path.join(dir, 'TRANSCRIPTS.json');
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) if (v && Array.isArray(v.lines)) out[k] = v.lines;
  return out;
}

/** Score every `<image>.json` in outDir (summary files are skipped). */
function scoreFolder(outDir, transcripts) {
  const files = fs.readdirSync(outDir).filter((f) => /\.(jpe?g|png)\.json$/i.test(f)).sort();
  return files.map((f) => {
    const rec = JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'));
    const name = rec.file || f.replace(/\.json$/i, '');
    return scorePage(Object.assign({ file: name }, rec), transcripts && transcripts[name] ? transcripts[name] : null);
  });
}

function buildSummary(pages) {
  return {
    lowConfidence: LOW,
    groups: groupSummary(pages),
    calibration: calibrationTables(pages),
    worst: worstLines(pages, 15),
    pages,
  };
}

const GROUP_HEAD = ['Group', 'Pages', 'CER', 'WER', 'CER (loose)', 'Kept CER', 'Kept WER', 'Kept coverage', 'Line CER', 'Missed', 'Extra', 'Pieces/page', 'Low', 's/page', 's/piece'];
function groupRow(name, g) {
  const a = g.all || {}; const k = g.kept || {};
  return [name, g.pages, pct(a.cer), pct(a.wer), pct(a.looseCer), pct(k.cer), pct(k.wer), pct(k.coverage), pct(a.lineCer),
    a.missed == null ? '-' : a.missed, a.extra == null ? '-' : a.extra, num(g.piecesPerPage), pct(g.lowShare), num(g.secondsPerPage), num(g.secondsPerPiece, 2)];
}

/** The per-category table (also printed to the console at the end of a run). */
function categoryTable(summary) {
  const g = summary.groups;
  const rows = Object.entries(g.byCategory).map(([name, v]) => groupRow(name, v));
  if (g.real.pages) rows.push(groupRow('**Real**', g.real));
  if (g.synthetic.pages) rows.push(groupRow('**Synthetic**', g.synthetic));
  return table(GROUP_HEAD, rows);
}

function calibrationTable(title, rows) {
  return `**${title}**\n\n${table(['Confidence', 'Lines', 'Mean line CER'], rows.map((r) => [r.range, r.count, pct(r.meanCer)]))}`;
}

function markdown(summary) {
  const pageRows = summary.pages.map((p) => (p.scored
    ? [p.file, p.category, p.pieces, pct(p.pieces ? p.low / p.pieces : null), pct(p.all.page.cer), pct(p.all.page.wer), pct(p.kept.page.cer), pct(p.kept.coverage),
      `${p.all.missed}/${p.refLines.length}`, p.all.extraCount, num(p.seconds), p.error || '']
    : [p.file, p.category, p.pieces, pct(p.pieces ? p.low / p.pieces : null), '-', '-', '-', '-', '-', '-', num(p.seconds), p.error || 'no transcript']));
  const cal = summary.calibration;
  const parts = [
    '# Handwriting evaluation',
    `CER/WER are micro-averaged (sum of edits / sum of reference length), case-sensitive after normalisation. "Loose" ignores case and punctuation. "Kept" uses only pieces with confidence >= ${LOW}; kept coverage is the share of reference characters on lines matched by kept pieces. Real and synthetic pages are never mixed.`,
    '## By category', categoryTable(summary),
    '## Calibration (real pages, matched lines)', calibrationTable('Piece confidence', cal.confidence),
  ];
  if (cal.statsMean) parts.push(calibrationTable('stats.mean', cal.statsMean));
  if (cal.statsMin) parts.push(calibrationTable('stats.min', cal.statsMin));
  parts.push('## Per page', table(['File', 'Category', 'Pieces', 'Low', 'CER', 'WER', 'Kept CER', 'Kept coverage', 'Missed', 'Extra', 's', 'Note'], pageRows));
  parts.push('## 15 worst reference lines', table(['File', 'Line', 'CER', 'Reference', 'Recognised', 'Confidence'],
    summary.worst.map((l) => [l.file, l.index + 1, pct(l.cer), clip(l.ref), l.matched ? clip(l.got) : '(missed)', l.matched ? num(l.confidence, 2) : '-'])));
  return `${parts.join('\n\n')}\n`;
}

/** Score outDir against the transcripts in imageDir and write summary.json + summary.md; returns the summary. */
function writeReport(outDir, imageDir) {
  const transcripts = loadTranscripts(imageDir);
  if (!transcripts) return null;
  const summary = buildSummary(scoreFolder(outDir, transcripts));
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(outDir, 'summary.md'), markdown(summary));
  return summary;
}

module.exports = { loadTranscripts, scoreFolder, buildSummary, markdown, categoryTable, writeReport };

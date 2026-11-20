/**
 * Automated Summary Quality Harness for PDF Study Suite.
 * Evaluates summaries on public (tests/corpus/manifest.json) and local (tests/corpus/local/manifest.json)
 * corpora across 5 dimensions (0-100 composite score):
 *   1. structure (0-25): outline sections/topics/lead/page provenance (or sentences/terms for plain text)
 *   2. blocksAndTables (0-20): capture rate of non-example didactic blocks & tables
 *   3. goldCoverage (0-25): coverage of entry.goldTerms (or scope defined terms when goldTerms is empty)
 *   4. lengthScaling (0-10): summaryWords / scopeWords condensation ratio inside sane bounds
 *   5. cleanliness (0-20): penalizes math damage, boilerplate/URLs/meta terms, duplicates, cut fragments
 *
 * Usage:
 *   node tools/eval-summary.js [--corpus=tests/corpus/manifest.json] [--out=summary-baseline.json]
 *                              [--baseline=tests/corpus/summary-baseline.json] [--only=id]
 *                              [--show] [--jobs=N] [--no-cache] [--with-ocr]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { ROOT, loadPipeline, readManifest, buildEntry } = require('./eval-quiz-corpus.js');
const { crudeStem, stripMath, stripMarkdown } = require('./eval-quiz-text.js');

const MAX_SCORE_DROP = 2.0;

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const i = a.indexOf('=');
  return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const CORPUS = path.resolve(ROOT, typeof flags.corpus === 'string' ? flags.corpus : 'tests/corpus/manifest.json');
const defaultJobs = Math.min(4, Math.max(1, (os.cpus().length || 2) - 1));
const JOBS = Math.max(1, Number(flags.jobs) || defaultJobs);

const round1 = (n) => Math.round(n * 10) / 10;
const pct = (a, b) => (b ? round1((a / b) * 100) : 0);
const stems = (s) => (stripMath(stripMarkdown(s)).toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => w.length > 1 || /\d/.test(w)).map(crudeStem);

function collectStrings(summary) {
  const texts = [];
  const items = [];
  if (!summary) return { texts, items };
  const push = (s, asItem = false) => {
    if (typeof s !== 'string' || !s.trim()) return;
    texts.push(s);
    if (asItem) items.push(s);
  };
  for (const s of summary.sentences || []) push(s, true);
  for (const s of summary.overviewSentences || []) push(s, true);
  for (const t of summary.keyTerms || []) push(t);
  for (const d of summary.definitions || []) { push(d.term); push(d.definition, true); }
  for (const f of summary.keyFormulas || []) { push(f.title); push(f.body); }
  const o = summary.outline;
  if (o) {
    push(o.lead);
    for (const c of o.covers || []) { push(c.text); (c.answers || []).forEach((a) => push(a)); }
    for (const t of o.terms || []) push(t.term);
    for (const sec of o.sections || []) {
      push(sec.title);
      for (const b of sec.blocks || []) { push(b.title); push(b.body, true); }
      for (const d of sec.definitions || []) { push(d.term); push(d.text, true); }
      for (const f of sec.formulas || []) { push(f.title); push(f.body); }
      for (const t of sec.tables || []) { (t.rows || []).forEach((r) => push(r.join(' '))); }
      for (const st of sec.statements || []) push(st.text, true);
      for (const tp of sec.topics || []) {
        push(tp.title);
        for (const sl of tp.slides || []) {
          push(sl.title);
          const addB = (b) => {
            if (typeof b === 'string') { push(b, true); return; }
            if (!b) return;
            push(b.text, true);
            (b.children || []).forEach(addB);
            (b.more || []).forEach(addB);
          };
          (sl.bullets || []).forEach(addB);
          (sl.more || []).forEach(addB);
          if (sl.table && sl.table.rows) sl.table.rows.forEach((r) => push(r.join(' ')));
          (sl.qa || []).forEach((q) => { push(q.question); push(q.answer); });
        }
      }
    }
  }
  return { texts, items };
}

const NON_CONTENT_BLOCK_RE = /\b(?:example|exercise|solution|problem|explore|exploration|tip|note|margin|bio)\b/i;
const BOILERPLATE_RE = /https?:\/\/|www\.|copyright\s*©|all\s+rights\s+reserved|\bISBN\b|\b(?:Figure|Table)\s+\d+\.\d+[:\s]+\S/i;
const META_TERM_RE = /^(?:course\s+objectives?|learning\s+objectives?|overview|outline|agenda|summary|review|introduction|references)$/i;
const CUT_END_RE = /\b(?:and|or|of|the|a|an|to|with|by|in|for|from|both)$/i;

/** Pure scorer over one document build result -> detailed metrics + 0..100 score. */
function scoreSummary(entry, built) {
  const summary = built.summary || {};
  const scopeText = built.scopeText || '';
  const scopeWords = (scopeText.match(/\S+/g) || []).length;
  const { texts, items } = collectStrings(summary);
  const fullSurface = texts.join('\n');
  const summaryWords = (fullSurface.match(/\S+/g) || []).length;

  // 1. Structure (0-25)
  let structure = 0;
  const o = summary.outline;
  if (o && o.kind === 'book') {
    const secs = o.sections || [];
    const paged = secs.filter((s) => Number.isFinite(s.page) && s.page > 0).length;
    const contentSecs = secs.filter((s) => (s.blocks || []).length + (s.definitions || []).length + (s.formulas || []).length + (s.tables || []).length + (s.statements || []).length > 0).length;
    if (o.lead) structure += 4;
    if (secs.length >= 1) structure += Math.min(11, 5 + secs.length * 1.5);
    if (secs.length) structure += Math.round(5 * (paged / secs.length));
    if (secs.length) structure += Math.round(5 * (contentSecs / secs.length));
  } else if (o && o.kind === 'deck') {
    const secs = o.sections || [];
    const slidesShown = secs.reduce((n, s) => n + (s.topics || []).reduce((m, t) => m + (t.slides || []).length, 0), 0);
    const paged = secs.reduce((n, s) => n + (s.topics || []).reduce((m, t) => m + (t.slides || []).filter((x) => Number.isFinite(x.page)).length, 0), 0);
    if (o.lead) structure += 4;
    if (secs.length >= 1) structure += Math.min(11, 5 + secs.length * 1.5);
    if (slidesShown) structure += Math.round(5 * (paged / slidesShown));
    if ((summary.keyTerms || []).length >= 3 || (summary.definitions || []).length >= 1) structure += 5;
  } else {
    const sents = summary.sentences || summary.overviewSentences || [];
    if (sents.length >= 3) structure += 12;
    else if (sents.length >= 1) structure += 6;
    if ((summary.keyTerms || []).length >= 5) structure += 7;
    if ((summary.definitions || []).length >= 2) structure += 6;
  }
  structure = Math.min(25, Math.round(structure));

  // 2. Blocks & Tables (0-20)
  let expectedBT = 0;
  let capturedBT = 0;
  if (built.mode === 'slide_deck' && Array.isArray(built.slides)) {
    const slideTables = built.slides.reduce((n, s) => n + ((s.tables && s.tables.length) || (s.table ? 1 : 0)), 0);
    expectedBT = slideTables;
    if (o && Array.isArray(o.sections)) {
      capturedBT = o.sections.reduce((n, s) => n + (s.topics || []).reduce((m, t) => m + (t.slides || []).filter((sl) => sl.table).length, 0), 0);
    }
  } else if (built.scopeObj) {
    const rawBlocks = (built.scopeObj.didacticBlocks || []).filter((b) => b && !NON_CONTENT_BLOCK_RE.test(String(b.category || '')));
    const rawTables = built.scopeObj.tables || [];
    expectedBT = rawBlocks.length + rawTables.length;
    if (o && Array.isArray(o.sections)) {
      const gotB = o.sections.reduce((n, s) => n + (s.blocks || []).length, 0);
      const gotT = o.sections.reduce((n, s) => n + (s.tables || []).length, 0);
      capturedBT = Math.min(expectedBT, gotB + gotT);
    }
  }
  const blocksAndTables = expectedBT === 0 ? 20 : Math.min(20, Math.round(20 * (capturedBT / expectedBT)));

  // 3. Gold coverage (0-25)
  const goldTerms = entry.goldTerms || [];
  const surfaceStemmed = ` ${stems(fullSurface).join(' ')} `;
  const missing = goldTerms.filter((term) => !surfaceStemmed.includes(` ${stems(term).join(' ')} `));
  const goldHit = goldTerms.length - missing.length;
  const goldPct = pct(goldHit, goldTerms.length);
  let goldCoverage = 0;
  if (goldTerms.length > 0) {
    goldCoverage = Math.round(25 * (goldHit / goldTerms.length));
  } else {
    // When goldTerms are unlabelled, check term/definition coverage vs flashcards
    const cards = built.flashcards || [];
    const defHits = cards.filter((c) => c.front && stems(c.front).length && surfaceStemmed.includes(` ${stems(c.front).join(' ')} `)).length;
    goldCoverage = cards.length ? Math.round(25 * Math.min(1, defHits / Math.max(1, Math.min(cards.length, 15)))) : 15;
  }

  // 4. Length scaling (0-10)
  const ratio = scopeWords ? round1((summaryWords / scopeWords) * 100) : 0; // percent
  let lengthScaling = 0;
  if (summaryWords >= 30) {
    const maxPct = scopeWords < 600 ? 85 : 70;
    if (ratio >= 5 && ratio <= maxPct) lengthScaling = 10;
    else if (ratio > maxPct && ratio <= 95) lengthScaling = 6;
    else if (ratio >= 2 && ratio < 5) lengthScaling = 6;
    else lengthScaling = 2;
  }

  // 5. Cleanliness (0-20)
  let mathDamage = 0;
  let boilerplate = 0;
  let cutFragments = 0;
  for (const t of texts) {
    if (t.includes('¿') || t.includes('[unreadable symbol]')) mathDamage++;
    if ((t.replace(/\\\$/g, '').match(/\$/g) || []).length % 2 === 1) mathDamage++;
    if (BOILERPLATE_RE.test(t)) boilerplate++;
  }
  for (const term of summary.keyTerms || []) {
    if (META_TERM_RE.test(String(term).trim())) boilerplate++;
  }
  for (const it of items) {
    const clean = stripMarkdown(it).trim();
    if (CUT_END_RE.test(clean) || /^[a-z]/.test(clean)) cutFragments++;
  }
  // Near-duplicate check across summary statements/bullets
  let dupes = 0;
  const seenSets = [];
  for (const it of items) {
    const ws = new Set(stems(it));
    if (ws.size < 4) continue;
    const isDup = seenSets.some((prev) => {
      let sh = 0;
      for (const w of ws) if (prev.has(w)) sh++;
      return sh / (ws.size + prev.size - sh) >= 0.8;
    });
    if (isDup) dupes++;
    else seenSets.push(ws);
  }
  const duplicatePct = pct(dupes, items.length);
  const penalty = Math.min(20, mathDamage * 3 + boilerplate * 2 + cutFragments * 1.5 + Math.round(duplicatePct / 5));
  const cleanliness = Math.max(0, 20 - Math.round(penalty));

  const score = structure + blocksAndTables + goldCoverage + lengthScaling + cleanliness;
  return {
    id: entry.id,
    kind: entry.kind,
    mode: built.mode,
    scopeWords,
    summaryWords,
    ratioPct: ratio,
    sections: o && Array.isArray(o.sections) ? o.sections.length : 0,
    blocksAndTables: { captured: capturedBT, expected: expectedBT },
    gold: { hit: goldHit, total: goldTerms.length, pct: goldPct, missing },
    cleanlinessIssues: { mathDamage, boilerplate, cutFragments, dupes, duplicatePct },
    subscores: { structure, blocksAndTables, goldCoverage, lengthScaling, cleanliness },
    score,
  };
}

function totalOf(records) {
  const n = Math.max(1, records.length);
  const sum = (f) => records.reduce((a, r) => a + f(r), 0);
  const goldHit = sum((r) => r.gold.hit);
  const goldTotal = sum((r) => r.gold.total);
  return {
    id: 'TOTAL',
    documents: records.length,
    scopeWords: sum((r) => r.scopeWords),
    summaryWords: sum((r) => r.summaryWords),
    gold: { hit: goldHit, total: goldTotal, pct: pct(goldHit, goldTotal) },
    issues: {
      mathDamage: sum((r) => r.cleanlinessIssues.mathDamage),
      boilerplate: sum((r) => r.cleanlinessIssues.boilerplate),
      cutFragments: sum((r) => r.cleanlinessIssues.cutFragments),
      dupes: sum((r) => r.cleanlinessIssues.dupes),
    },
    score: round1(sum((r) => r.score) / n),
  };
}

function compareSummary(report, baseline, partial) {
  if (partial) {
    return { lines: ['baseline    partial run (--only): summary gate skipped'], failed: false };
  }
  const diff = round1(report.total.score - baseline.total.score);
  const sign = diff > 0 ? `+${diff}` : `${diff}`;
  const failed = diff < -MAX_SCORE_DROP;
  const lines = [
    `baseline    summary score ${baseline.total.score} -> ${report.total.score} (${sign} pts), gold ${baseline.total.gold.pct}% -> ${report.total.gold.pct}%`,
  ];
  if (failed) lines.push(`FAIL        summary score dropped by more than ${MAX_SCORE_DROP} points`);
  return { lines, failed };
}

function formatRecord(r, base) {
  const d = base ? ` (${r.score - base.score >= 0 ? '+' : ''}${round1(r.score - base.score)})` : '';
  return [
    `${r.id} (${r.mode}, ${r.scopeWords}w -> ${r.summaryWords}w = ${r.ratioPct}%)`,
    `  score       ${r.score}/100${d}  [struct ${r.subscores.structure}/25, blocks/tbl ${r.subscores.blocksAndTables}/20, gold ${r.subscores.goldCoverage}/25, scale ${r.subscores.lengthScaling}/10, clean ${r.subscores.cleanliness}/20]`,
    `  cleanliness math=${r.cleanlinessIssues.mathDamage}, boiler=${r.cleanlinessIssues.boilerplate}, frags=${r.cleanlinessIssues.cutFragments}, dupes=${r.cleanlinessIssues.dupes}`,
    ...(r.gold.total ? [`  gold terms  ${r.gold.hit}/${r.gold.total} (${r.gold.pct}%)${r.gold.missing.length ? `  missing: ${r.gold.missing.slice(0, 8).join(', ')}` : ''}`] : []),
  ].join('\n');
}

async function runParallel(entries, manifest, jobs, opts) {
  const results = new Array(entries.length);
  let cursor = 0;
  async function spawnWorker() {
    const child = fork(__filename, ['--worker'], { cwd: ROOT, silent: true });
    child.stderr.on('data', (d) => process.stderr.write(d));
    try {
      while (cursor < entries.length) {
        const idx = cursor++;
        const entry = entries[idx];
        results[idx] = await new Promise((resolve, reject) => {
          const onMsg = (m) => {
            if (!m || m.idx !== idx) return;
            cleanup();
            if (m.type === 'done') resolve(m.res);
            else reject(new Error(m.error || `worker failed on ${entry.id}`));
          };
          const onExit = (code) => {
            cleanup();
            reject(new Error(`summary worker exited (${code}) on ${entry.id}`));
          };
          const cleanup = () => {
            child.off('message', onMsg);
            child.off('exit', onExit);
          };
          child.on('message', onMsg);
          child.on('exit', onExit);
          child.send({ type: 'run', idx, entry, manifest, opts });
        });
      }
    } finally {
      try { child.send({ type: 'quit' }); } catch (_e) { /* closed */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, entries.length) }, spawnWorker));
  return results;
}

if (require.main === module) {
  const log = console.log;
  console.log = (...a) => {
    if (!/^Warning: /.test(String(a[0]))) log(...a);
  };
  console.warn = () => {};

  if (process.argv.includes('--worker')) {
    const P = loadPipeline();
    process.on('message', async (msg) => {
      try {
        if (msg && msg.type === 'run') {
          const built = await buildEntry(P, msg.entry, msg.manifest, msg.opts || {});
          process.send({ type: 'done', idx: msg.idx, res: scoreSummary(msg.entry, built) });
        } else if (msg && msg.type === 'quit') {
          process.exit(0);
        }
      } catch (err) {
        process.send({ type: 'error', idx: msg && msg.idx, error: String((err && err.stack) || err) });
      }
    });
  } else {
    (async () => {
      const manifest = readManifest(CORPUS);
      const baseline = typeof flags.baseline === 'string' ? JSON.parse(fs.readFileSync(path.resolve(flags.baseline), 'utf8')) : null;
      const entries = manifest.entries.filter((e) => typeof flags.only !== 'string' || e.id.includes(flags.only));
      if (!entries.length) throw new Error(`no corpus entry matches --only=${flags.only}`);
      const opts = {
        noCache: Boolean(flags['no-cache']),
        withOcr: Boolean(flags['with-ocr']),
        ocrCache: typeof flags['ocr-cache'] === 'string' ? flags['ocr-cache'] : undefined,
      };
      let records;
      if (JOBS <= 1 || entries.length <= 1) {
        const P = loadPipeline();
        records = [];
        for (const entry of entries) records.push(scoreSummary(entry, await buildEntry(P, entry, manifest, opts)));
      } else {
        records = await runParallel(entries, manifest, JOBS, opts);
      }

      const baseDocs = new Map(((baseline && baseline.documents) || []).map((d) => [d.id, d]));
      for (const r of records) log(`${formatRecord(r, baseDocs.get(r.id))}\n`);

      const partial = entries.length !== manifest.entries.length;
      const report = { corpus: path.relative(ROOT, CORPUS).replace(/\\/g, '/'), documents: records, total: totalOf(records) };
      log(`TOTAL (${report.total.documents} docs): score ${report.total.score}/100, gold ${report.total.gold.hit}/${report.total.gold.total} (${report.total.gold.pct}%), issues math=${report.total.issues.mathDamage} boiler=${report.total.issues.boilerplate} frags=${report.total.issues.cutFragments} dupes=${report.total.issues.dupes}`);

      if (typeof flags.out === 'string') fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify(report, null, 1)}\n`);
      let failed = false;
      if (baseline) {
        const v = compareSummary(report, baseline, partial);
        log(`\n${v.lines.join('\n')}`);
        failed = v.failed;
      }
      process.exit(failed ? 1 : 0);
    })().catch((err) => {
      console.error(err);
      process.exit(2);
    });
  }
}

module.exports = { MAX_SCORE_DROP, scoreSummary, totalOf, compareSummary, collectStrings };

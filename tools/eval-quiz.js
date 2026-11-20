/**
 * Question-quality eval: generates the quiz, practice test and flashcards for every document of a corpus
 * exactly as the app does, runs the lints of tools/eval-quiz-lints.js over every question, and prints a
 * defect score per document.
 *
 * Usage: node tools/eval-quiz.js [--corpus=tests/corpus/manifest.json] [--out=file.json] [--baseline=file.json]
 *                                [--only=id] [--show=lint|all] [--jobs=N] [--no-cache]
 *                                [--with-ocr] [--ocr-cache=dir] [--pareto] [--waive-yield=id1,id2]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const { ROOT, loadPipeline, readManifest } = require('./eval-quiz-corpus.js');
const { stemBody } = require('./eval-quiz-text.js');
const { totalOf, recordLines, compare, comparePareto } = require('./eval-quiz-report.js');
const { measureOne } = require('./eval-quiz-worker.js');

const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [key, ...rest] = a.slice(2).split('=');
  return [key, rest.join('=') || true];
}));
const CORPUS = path.resolve(ROOT, typeof flags.corpus === 'string' ? flags.corpus : 'tests/corpus/manifest.json');
const defaultJobs = Math.min(4, Math.max(1, (os.cpus().length || 2) - 1));
const JOBS = Math.max(1, Number(flags.jobs) || defaultJobs);
const corpusOpts = {
  noCache: Boolean(flags['no-cache']),
  withOcr: Boolean(flags['with-ocr']),
  ocrCache: typeof flags['ocr-cache'] === 'string' ? flags['ocr-cache'] : undefined,
  ocrPopulate: Boolean(flags['ocr-populate']),
};

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

async function runParallel(entries, manifest, jobs, opts) {
  const workerFile = path.join(__dirname, 'eval-quiz-worker.js');
  const results = new Array(entries.length);
  let cursor = 0;

  async function spawnWorker() {
    const child = fork(workerFile, [], { cwd: ROOT, silent: true });
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
            reject(new Error(`worker exited (${code}) on ${entry.id}`));
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

(async () => {
  const log = console.log;
  console.log = (...args) => {
    if (!/^Warning: /.test(String(args[0]))) log(...args);
  };
  console.warn = () => {};
  const manifest = readManifest(CORPUS);
  const baseline = typeof flags.baseline === 'string' ? JSON.parse(fs.readFileSync(path.resolve(flags.baseline), 'utf8')) : null;
  const entries = manifest.entries.filter((e) => typeof flags.only !== 'string' || e.id.includes(flags.only));
  if (!entries.length) throw new Error(`no corpus entry matches --only=${flags.only}`);

  let measured;
  if (JOBS <= 1 || entries.length <= 1) {
    const P = loadPipeline();
    measured = [];
    for (const entry of entries) measured.push(await measureOne(P, entry, manifest, corpusOpts));
  } else {
    measured = await runParallel(entries, manifest, JOBS, corpusOpts);
  }

  const baseDocs = new Map(((baseline && baseline.documents) || []).map((d) => [d.id, d]));
  const records = [];
  const offenders = [];
  for (const res of measured) {
    records.push(res.record);
    offenders.push(...res.offenders);
    console.log(recordLines(res.record, baseDocs.get(res.record.id)).join('\n'));
    console.log('');
  }

  const partial = entries.length !== manifest.entries.length;
  const report = { corpus: path.relative(ROOT, CORPUS).replace(/\\/g, '/'), documents: records, total: totalOf(records) };
  console.log(recordLines(report.total, !partial && baseline ? baseline.total : undefined).join('\n'));
  if (flags.show) printOffenders(offenders, flags.show);
  if (typeof flags.out === 'string') fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify(report, null, 1)}\n`);

  let failed = false;
  if (baseline) {
    const waive = typeof flags['waive-yield'] === 'string'
      ? flags['waive-yield'].split(',').map((s) => s.trim()).filter(Boolean)
      : [];
    const verdict = flags.pareto
      ? comparePareto(report, baseline, partial, { waiveYield: waive })
      : compare(report, baseline, partial);
    console.log(`\n${verdict.lines.join('\n')}`);
    failed = verdict.failed;
  }
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(2);
});

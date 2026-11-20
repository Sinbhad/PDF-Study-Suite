/**
 * Eval & Contract Tooling Fixtures (node tests/eval_tooling_fixtures.js).
 * Unit checks for the evaluation gates and static contract checks:
 *   1. eval-quiz-report.js comparePareto() (rejects defect rise >1pt, yield drop >5%, per-doc floor,
 *      gold drop >2pt overall / >5pt per doc, recall share rise >3pt, guess excess rise >3pt).
 *   2. eval-summary.js pure scoring and regression threshold.
 *   3. check-contracts.js + sync-manifest.js static contract verification on valid and broken virtual manifests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const report = require('../tools/eval-quiz-report.js');
const evalSum = require('../tools/eval-summary.js');
const contracts = require('../tools/check-contracts.js');
const sync = require('../tools/sync-manifest.js');

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    return;
  }
  failed++;
  console.log(`FAIL [eval-tooling] ${name}${detail ? ` (${detail})` : ''}`);
}

function baseQuizReport() {
  return {
    documents: [
      { id: 'doc-a', generated: 20, gold: { hit: 8, total: 10, pct: 80 } },
      { id: 'doc-b', generated: 10, gold: { hit: 8, total: 10, pct: 80 } },
    ],
    total: {
      generated: 100,
      defectPct: 4.0,
      lints: {},
      gold: { hit: 80, total: 100, pct: 80 },
      recall: { quiz: 10, test: 15 }, // 25%
      guess: { n: 50, accuracy: 35, chance: 35 }, // excess 0
    },
  };
}

function testPareto() {
  const base = baseQuizReport();
  const clone = () => JSON.parse(JSON.stringify(base));

  check('pareto: identical report passes', !report.comparePareto(clone(), base, false).failed);

  let r = clone();
  r.total.defectPct = 5.1;
  check('pareto: rejects defectPct rise > 1.0 pt', report.comparePareto(r, base, false).failed);

  r = clone();
  r.total.generated = 94;
  check('pareto: rejects overall yield drop > 5%', report.comparePareto(r, base, false).failed);

  r = clone();
  r.documents[0].generated = 15; // floor is floor(20 * 0.8) = 16
  check('pareto: rejects single-doc yield below floor', report.comparePareto(r, base, false).failed);
  check('pareto: waiver allows intentional single-doc yield change', !report.comparePareto(r, base, false, { waiveYield: ['doc-a'] }).failed);

  r = clone();
  r.total.gold.pct = 77.9;
  check('pareto: rejects gold.pct drop > 2.0 pts overall', report.comparePareto(r, base, false).failed);

  r = clone();
  r.documents[1].gold.pct = 74.9;
  check('pareto: rejects single-doc gold.pct drop > 5.0 pts', report.comparePareto(r, base, false).failed);

  r = clone();
  r.total.recall = { quiz: 14, test: 15 }; // 29% (+4 pts)
  check('pareto: rejects self-graded recall share rise > 3.0 pts', report.comparePareto(r, base, false).failed);

  r = clone();
  r.total.guess.accuracy = 38.5; // +3.5 pts excess
  check('pareto: rejects guessability excess rise > 3.0 pts', report.comparePareto(r, base, false).failed);
}

function testEvalSummary() {
  const entry = { id: 'demo', kind: 'text', goldTerms: ['osmosis', 'diffusion', 'membrane'] };
  const cleanBuilt = {
    mode: 'book',
    scopeText: 'Water crosses a membrane by osmosis and solutes move by diffusion across gradients. '.repeat(8),
    scopeObj: { didacticBlocks: [{ category: 'Definition', title: 'Osmosis', body: 'Net movement of water.' }], tables: [] },
    flashcards: [{ front: 'Osmosis', back: 'Water movement across membrane' }],
    summary: {
      sentences: ['Osmosis moves water across a selectively permeable membrane.', 'Diffusion balances solute concentration.'],
      keyTerms: ['Osmosis', 'Diffusion', 'Membrane'],
      definitions: [{ term: 'Osmosis', definition: 'Water movement across a membrane.' }],
      outline: {
        kind: 'book',
        lead: 'Key points from page 1.',
        sections: [{
          title: '1.1 Transport',
          page: 1,
          blocks: [{ category: 'Definition', title: 'Osmosis', body: 'Water movement across a membrane.' }],
          definitions: [{ term: 'Osmosis', text: 'Water movement across a membrane.', page: 1 }],
          formulas: [],
          tables: [],
          statements: [{ text: 'Diffusion moves solutes down a concentration gradient.', page: 1 }],
        }],
      },
    },
  };
  const cleanScore = evalSum.scoreSummary(entry, cleanBuilt);
  check('eval-summary: clean summary scores >= 80', cleanScore.score >= 80 && cleanScore.cleanlinessIssues.mathDamage === 0, JSON.stringify(cleanScore));

  const damagedBuilt = {
    mode: 'book',
    scopeText: cleanBuilt.scopeText,
    summary: {
      sentences: ['¿broken $unbalanced math and', '¿broken $unbalanced math and'],
      keyTerms: ['Course objectives'],
      definitions: [],
    },
  };
  const badScore = evalSum.scoreSummary(entry, damagedBuilt);
  check('eval-summary: damaged summary penalized strongly', badScore.score < cleanScore.score - 40 && badScore.cleanlinessIssues.mathDamage > 0, JSON.stringify(badScore));

  check('eval-summary: baseline drop > 2.0 fails',
    evalSum.compareSummary({ total: { score: 77.9, gold: { pct: 70 } } }, { total: { score: 80.0, gold: { pct: 70 } } }, false).failed);
}

function testContractsAndSync() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-check-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'src/nlp'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'src/nlp/foo.js'), '(function(r){ r.PDFStudy = r.PDFStudy || {}; r.PDFStudy.foo = {}; })(globalThis);');
    fs.writeFileSync(path.join(tmp, 'src/nlp/orphan.js'), '(function(r){ r.PDFStudy = r.PDFStudy || {}; r.PDFStudy.orphan = {}; })(globalThis);');

    const ns = new Map([['src/nlp/foo.js', 'PDFStudy.foo']]);
    const okErrs = contracts.checkStaticConfig({
      rootDir: tmp,
      htmlScripts: ['src/nlp/foo.js'],
      manifest: { expectedScriptCount: 1, namespaces: ns, nonModuleScripts: [], workerAssets: [] },
      srcFiles: ['src/nlp/foo.js'],
    });
    check('contracts: clean config produces 0 errors', okErrs.length === 0, JSON.stringify(okErrs));

    const badErrs = contracts.checkStaticConfig({
      rootDir: tmp,
      htmlScripts: ['src/nlp/foo.js', 'src/nlp/foo.js'],
      manifest: { expectedScriptCount: 1, namespaces: new Map([['src/nlp/foo.js', 'PDFStudy.missing']]), nonModuleScripts: [], workerAssets: [] },
      srcFiles: ['src/nlp/foo.js', 'src/nlp/orphan.js'],
    });
    check('contracts: catches duplicate, count mismatch, orphan, and missing namespace',
      badErrs.some((e) => /Duplicate/.test(e)) &&
      badErrs.some((e) => /EXPECTED_SCRIPT_COUNT/.test(e)) &&
      badErrs.some((e) => /Orphan/.test(e)) &&
      badErrs.some((e) => /PDFStudy\.missing/.test(e)),
      JSON.stringify(badErrs));

    check('sync: detects PDFStudy namespace export', sync.detectNamespace(path.join(tmp, 'src/nlp/foo.js')) === 'PDFStudy.foo');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

testPareto();
testEvalSummary();
testContractsAndSync();

if (!failed) console.log('[OK] eval tooling: Pareto gate, summary scorer, static contract checks');
console.log(`eval_tooling_fixtures: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

/**
 * Static module-graph & runtime IR contract checker for PDF Study Suite.
 *
 * Checks:
 *   1. index.html <-> tests/verify_manifest.py exact parity (counts, duplicates, namespaces, existence).
 *   2. Zero orphan .js files under src/ (every src/**\/*.js is loaded by index.html or WORKER_ASSETS).
 *   3. Every module's declared PDFStudy.<namespace> exists in its source and has no accidental overwrite.
 *   4. Browser-like VM load-order test: executes every <script src> in index.html order with no require()
 *      and verifies zero top-level ReferenceError/TypeError and all EXPECTED_NAMESPACES populated.
 *   5. Runtime IR schema validation (unless --static-only) across sample textbook + slide deck + OCR + docState.
 *
 * Usage: node tools/check-contracts.js [--static-only] [--quiet]
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadPipeline, buildEntry, ROOT } = require('./eval-quiz-corpus.js');

function stripPyComments(s) {
  return s.replace(/#.*$/gm, '');
}

function parsePyStrings(block) {
  return [...block.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
}

function parseVerifyManifest(manifestPath) {
  const src = fs.readFileSync(manifestPath, 'utf8');
  const countMatch = src.match(/EXPECTED_SCRIPT_COUNT\s*=\s*(\d+)/);
  const expectedScriptCount = countMatch ? Number(countMatch[1]) : null;

  const nsMatch = src.match(/EXPECTED_NAMESPACES\b[^=]*=\s*\{([\s\S]*?)\n\}/);
  const namespaces = new Map();
  if (nsMatch) {
    const clean = stripPyComments(nsMatch[1]);
    for (const m of clean.matchAll(/["']([^"']+)["']\s*:\s*["']([^"']+)["']/g)) {
      namespaces.set(m[1], m[2]);
    }
  }

  const nonModMatch = src.match(/NON_MODULE_SCRIPTS\b[^=]*=\s*\(([\s\S]*?)\n\)/);
  const nonModuleScripts = nonModMatch ? parsePyStrings(stripPyComments(nonModMatch[1])) : [];

  const workerMatch = src.match(/WORKER_ASSETS\b[^=]*=\s*\(([\s\S]*?)\n\)/);
  const workerAssets = workerMatch ? parsePyStrings(stripPyComments(workerMatch[1])).map((s) => s.replace(/^\//, '')) : [];

  return { expectedScriptCount, namespaces, nonModuleScripts, workerAssets };
}

function parseIndexScripts(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1].split('?')[0]);
}

function walkJsFiles(dir, baseDir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkJsFiles(full, baseDir));
    else if (ent.isFile() && ent.name.endsWith('.js')) {
      out.push(path.relative(baseDir, full).replace(/\\/g, '/'));
    }
  }
  return out.sort();
}

/**
 * Pure static checker (testable with synthetic inputs).
 * @param {{rootDir:string, htmlScripts:string[], manifest:{expectedScriptCount:number, namespaces:Map<string,string>, nonModuleScripts:string[], workerAssets:string[]}, srcFiles:string[]}} cfg
 */
function checkStaticConfig(cfg) {
  const errors = [];
  const { rootDir, htmlScripts, manifest, srcFiles } = cfg;

  const seenScripts = new Set();
  for (const s of htmlScripts) {
    if (seenScripts.has(s)) errors.push(`Duplicate <script src> in index.html: ${s}`);
    seenScripts.add(s);
    if (!fs.existsSync(path.join(rootDir, s))) errors.push(`Missing script referenced in index.html: ${s}`);
  }

  if (manifest.expectedScriptCount !== htmlScripts.length) {
    errors.push(`EXPECTED_SCRIPT_COUNT is ${manifest.expectedScriptCount}, index.html has ${htmlScripts.length}`);
  }

  const expectedSet = new Set([...manifest.namespaces.keys(), ...manifest.nonModuleScripts]);
  for (const s of expectedSet) {
    if (!seenScripts.has(s)) errors.push(`Manifest lists ${s}, but index.html does not load it`);
  }
  for (const s of htmlScripts) {
    if (!expectedSet.has(s)) errors.push(`index.html loads ${s}, but tests/verify_manifest.py does not list it`);
  }

  const workerSet = new Set(manifest.workerAssets);
  for (const w of workerSet) {
    if (!fs.existsSync(path.join(rootDir, w))) errors.push(`Missing WORKER_ASSETS file: ${w}`);
  }
  for (const f of srcFiles) {
    if (!seenScripts.has(f) && !workerSet.has(f)) {
      errors.push(`Orphan module in src/ (neither in index.html nor WORKER_ASSETS): ${f}`);
    }
  }

  const nsOwners = new Map();
  for (const [scr, ns] of manifest.namespaces.entries()) {
    const full = path.join(rootDir, scr);
    if (!fs.existsSync(full)) continue;
    const code = fs.readFileSync(full, 'utf8');
    if (!code.includes(ns)) errors.push(`Module ${scr} does not export expected namespace ${ns}`);
    if (nsOwners.has(ns)) {
      errors.push(`Duplicate namespace ${ns} claimed by both ${nsOwners.get(ns)} and ${scr}`);
    }
    nsOwners.set(ns, scr);
  }

  return errors;
}

/** Executes index.html module scripts in exact load order inside a browser-like VM sandbox (no require). */
function checkBrowserLoadOrder(rootDir, htmlScripts, namespaces) {
  const errors = [];
  const noop = () => {};
  const stubEl = () => ({
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    setAttribute: noop,
    removeAttribute: noop,
    hasAttribute: () => false,
    getAttribute: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    focus: noop,
    appendChild: noop,
    innerHTML: '',
    textContent: '',
  });
  const ctxObj = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Promise,
    URL,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Int32Array,
    Float32Array,
    ArrayBuffer,
    Math,
    JSON,
    Map,
    Set,
    WeakMap,
    Date,
    RegExp,
    Error,
    performance: { now: () => Date.now() },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { hardwareConcurrency: 4 },
    location: { href: 'http://127.0.0.1:8765/index.html', protocol: 'http:' },
    document: {
      readyState: 'loading',
      documentElement: stubEl(),
      head: stubEl(),
      body: stubEl(),
      baseURI: 'http://127.0.0.1:8765/index.html',
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => stubEl(),
      addEventListener: noop,
    },
    pdfjsLib: { OPS: {}, GlobalWorkerOptions: {} },
    addEventListener: noop,
    removeEventListener: noop,
  };
  ctxObj.window = ctxObj;
  ctxObj.self = ctxObj;
  ctxObj.globalThis = ctxObj;
  const context = vm.createContext(ctxObj);

  for (const scr of htmlScripts) {
    if (scr.startsWith('vendor/')) continue;
    const code = fs.readFileSync(path.join(rootDir, scr), 'utf8');
    try {
      vm.runInContext(code, context, { filename: scr });
    } catch (err) {
      errors.push(`Browser VM load failed at ${scr}: ${(err && err.message) || err}`);
      return errors;
    }
  }

  for (const [scr, ns] of namespaces.entries()) {
    const parts = ns.split('.');
    let cur = context;
    for (const p of parts) cur = cur && cur[p];
    if (!cur) errors.push(`After loading ${scr}, ${ns} is undefined in browser sandbox`);
  }
  return errors;
}

function assert(cond, msg, errors) {
  if (!cond) errors.push(msg);
}

async function checkRuntimeContracts() {
  const errors = [];
  const P = loadPipeline();
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/corpus/manifest.json'), 'utf8'));
  const sampleEntries = manifest.entries.filter((e) => e.id === 'sample-textbook' || e.id === 'sample-slides');
  assert(sampleEntries.length === 2, 'Missing sample-textbook or sample-slides in tests/corpus/manifest.json', errors);

  for (const entry of sampleEntries) {
    const built = await buildEntry(P, entry, manifest, { noCache: false });
    assert(typeof built.scopeText === 'string' && built.scopeText.length > 0, `${entry.id}: scopeText non-empty`, errors);
    assert(built.summary && typeof built.summary === 'object', `${entry.id}: summary object present`, errors);
    assert(Array.isArray(built.summary.keyTerms), `${entry.id}: summary.keyTerms must be array`, errors);
    assert(Array.isArray(built.summary.definitions), `${entry.id}: summary.definitions must be array`, errors);
    assert(built.summary.outline && (built.summary.outline.kind === 'book' || built.summary.outline.kind === 'deck'),
      `${entry.id}: summary.outline.kind must be book|deck`, errors);
    assert(Array.isArray(built.summary.outline.sections) && built.summary.outline.sections.length > 0,
      `${entry.id}: summary.outline.sections must be non-empty`, errors);

    if (built.mode === 'slide_deck') {
      assert(Array.isArray(built.slides) && built.slides.length > 0, `${entry.id}: slides non-empty`, errors);
      for (const s of built.slides) {
        assert(Number.isFinite(s.slideNumber) && s.slideNumber >= 1, `${entry.id}: slide.slideNumber invalid`, errors);
        assert(typeof s.title === 'string', `${entry.id}: slide.title missing`, errors);
        assert(Array.isArray(s.bullets) && Array.isArray(s.nestedBullets), `${entry.id}: slide bullets arrays missing`, errors);
      }
    } else {
      assert(built.scopeObj && typeof built.scopeObj.text === 'string', `${entry.id}: scopeObj.text missing`, errors);
      assert(Array.isArray(built.scopeObj.didacticBlocks), `${entry.id}: scopeObj.didacticBlocks missing`, errors);
      assert(Array.isArray(built.scopeObj.tables) && Array.isArray(built.scopeObj.lines), `${entry.id}: scopeObj tables/lines missing`, errors);
    }

    assert(Array.isArray(built.flashcards) && built.flashcards.length > 0, `${entry.id}: flashcards non-empty`, errors);
    for (const c of built.flashcards) {
      assert(typeof c.id === 'string' && typeof c.front === 'string' && typeof c.back === 'string',
        `${entry.id}: flashcard missing id/front/back`, errors);
      assert(typeof c.category === 'string' && typeof c.kind === 'string',
        `${entry.id}: flashcard missing category/kind`, errors);
    }

    const validTypes = new Set(['multiple_choice', 'cloze', 'true_false', 'typed', 'reveal']);
    const qs = [...built.quiz, ...built.test];
    assert(qs.length > 0, `${entry.id}: generated questions non-empty`, errors);
    for (const q of qs) {
      assert(typeof q.id === 'string' && validTypes.has(q.type), `${entry.id}: invalid question type ${q.type}`, errors);
      assert(typeof q.question === 'string' && q.question.length > 0, `${entry.id}: question text empty`, errors);
      assert(q.answer !== undefined && q.answer !== null && String(q.answer).length > 0, `${entry.id}: question answer empty`, errors);
      assert(typeof q.factKey === 'string' && q.factKey.length > 0, `${entry.id}: question missing factKey`, errors);
      if (q.type === 'multiple_choice' || q.type === 'cloze' || q.type === 'true_false') {
        assert(Array.isArray(q.options) && q.options.includes(q.answer), `${entry.id}: ${q.id} options missing answer`, errors);
      }
    }
  }

  // Validate ocrLines + docState IR contracts on synthetic inputs
  const page = { pageNumber: 1, width: 600, height: 800, lines: [], ink: { needsRecognition: true } };
  const ocrRes = {
    pageNumber: 1, scale: 1, width: 600, height: 800,
    lines: [{ index: 0, box: { x: 20, y: 40, w: 400, h: 24 }, regions: [{ id: 'p1-l0-r0', kind: 'text', box: { x: 20, y: 40, w: 400, h: 24 }, text: 'Sample OCR line with enough words.', confidence: 0.92, source: 'model' }] }],
  };
  P.ocrLines.applyToPage(page, ocrRes);
  assert(page.lines.length === 1 && page.ink.recognised === true, 'ocrLines IR contract failed', errors);

  const docState = require(path.join(ROOT, 'src/nlp/doc-state.js'));
  const ds = docState.upgrade({});
  assert(ds.v === docState.VERSION && ds.cards && ds.flags && Array.isArray(ds.userCards) && Array.isArray(ds.attempts),
    'docState.upgrade IR contract failed', errors);

  return errors;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const staticOnly = args.has('--static-only');
  const quiet = args.has('--quiet');

  const log = console.log;
  console.log = (...a) => {
    if (!/^Warning: /.test(String(a[0]))) log(...a);
  };
  console.warn = () => {};

  const htmlScripts = parseIndexScripts(path.join(ROOT, 'index.html'));
  const manifest = parseVerifyManifest(path.join(ROOT, 'tests/verify_manifest.py'));
  const srcFiles = walkJsFiles(path.join(ROOT, 'src'), ROOT);

  const staticErrors = checkStaticConfig({ rootDir: ROOT, htmlScripts, manifest, srcFiles });
  const vmErrors = staticErrors.length ? [] : checkBrowserLoadOrder(ROOT, htmlScripts, manifest.namespaces);
  const runtimeErrors = (!staticOnly && !staticErrors.length && !vmErrors.length) ? await checkRuntimeContracts() : [];

  const allErrors = [...staticErrors, ...vmErrors, ...runtimeErrors];
  if (!quiet || allErrors.length) {
    if (allErrors.length) {
      for (const e of allErrors) console.error(`CONTRACT FAIL: ${e}`);
    } else {
      log(`[OK] contracts verified (${htmlScripts.length} scripts, ${manifest.namespaces.size} namespaces, ${srcFiles.length} src files, browser VM load order${staticOnly ? '' : ', runtime IR schemas'})`);
    }
  }
  process.exit(allErrors.length ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(2);
  });
}

module.exports = { parseVerifyManifest, parseIndexScripts, checkStaticConfig, checkBrowserLoadOrder };

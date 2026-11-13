/**
 * Handwriting flow fixtures (Node): cancel/partial/too-many in the worker core, client dispose semantics,
 * pipeline skip/retry/partial, engine util + model engine (fake Transformers module), review notice and items,
 * and "typed documents are left alone". Run: node tests/handwriting_flow_fixtures.js
 */
const path = require('path');
const S = require('./hw_synth.js');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowsPage = (rows = 4, scale = 1) => {
  const img = S.bitmap(600, 400);
  for (let i = 0; i < rows; i++) S.wordRow(img, 50, 30 + i * 80, 24, 4);
  return { ...img, scale };
};
const inkPage = (n) => ({ pageNumber: n, width: 600, height: 400, lines: [], wordCount: 0, ink: { needsRecognition: true } });
const docOf = (pages) => ({ numPages: pages.length, pages, pageCache: new Map(pages.map((p) => [p.pageNumber, p])) });
const flat = (result) => result.lines.flatMap((l) => l.regions);
const kindStub = (kind) => ({ classifyRegion: () => kind });
/** Page-prep stand-in: n one-region lines, crops are a flat gray patch carrying the region index. */
const prepStub = (n) => ({
  plan: () => ({ bin: { data: new Uint8Array(1), w: 1, h: 1 }, medH: 2, inverted: false,
    lines: Array.from({ length: n }, (_, i) => ({ index: i, box: { x: 0, y: i * 3, w: 10, h: 2 }, regions: [{ box: { x: 0, y: i * 3, w: 10, h: 2 } }] })) }),
  cropFor: (p, g, w, h, box) => ({ data: new Uint8Array(20).fill(200), w: 10, h: 2, y: box.y }),
});

async function coreTests() {
  const posted = [];
  const base = S.mockEngine();
  let h = null;
  const eng = { ...base, recognise: async (c, k) => { const r = await base.recognise(c, k); if (base.calls.length === 2) h.handle({ type: 'cancel', jobId: 1 }); return r; } };
  h = S.core.createHandler({ engine: eng, raster: S.raster, segmenter: S.segmenter, post: (m) => posted.push(m) });
  const pg = rowsPage(4);
  await h.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: pg.gray, width: pg.width, height: pg.height, scale: 1 });
  const types = posted.map((m) => m.type);
  const last = posted[posted.length - 1];
  check('core: cancel after 2 of 4 -> ends with cancelled, no page-done', types[types.length - 1] === 'cancelled' && !types.includes('page-done'), types.join(','));
  const regs = last.result ? flat(last.result) : [];
  check('core: cancelled message carries result.partial === true', !!last.result && last.result.partial === true, JSON.stringify(last));
  check('core: 4 regions, 2 read keep text', regs.length === 4 && regs.slice(0, 2).every((r) => r.text && r.source === 'model'), JSON.stringify(regs.map((r) => r.text)));
  check('core: unread regions are text "", confidence 0, manual', regs.length === 4 && regs.slice(2).every((r) => r.text === '' && r.confidence === 0 && r.source === 'manual'));

  const out2 = [];
  const e2 = S.mockEngine();
  const h2 = S.core.createHandler({ engine: e2, raster: S.raster, segmenter: kindStub('text'), prep: prepStub(S.core.MAX_REGIONS + 1), post: (m) => out2.push(m) });
  await h2.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: rowsPage(1).gray, width: 600, height: 400, scale: 1 });
  const withResult = out2.find((m) => m.result);
  check('core: > MAX_REGIONS never calls engine.recognise', e2.calls.length === 0, String(e2.calls.length));
  check('core: > MAX_REGIONS result has skippedReason too-many-regions, all manual',
    !!withResult && withResult.result.skippedReason === 'too-many-regions' && flat(withResult.result).length === 121 && flat(withResult.result).every((r) => r.source === 'manual'),
    `message types: ${out2.map((m) => m.type).join(',')} (no message carries a result)`);

  const out3 = [];
  const h3 = S.core.createHandler({ engine: { name: 'k', load: async () => ({ available: true }), recognise: async () => ({ text: 'x y', confidence: 0.9, kind: 'text' }) }, raster: S.raster, segmenter: kindStub('math'), prep: prepStub(1), post: (m) => out3.push(m) });
  await h3.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: rowsPage(1).gray, width: 600, height: 400, scale: 1 });
  const done = out3.find((m) => m.type === 'page-done');
  check('core: engine kind text overrides segmenter math', !!done && flat(done.result)[0].kind === 'text', JSON.stringify(out3.map((m) => m.type)));

  // MAX_REGIONS is inclusive: exactly MAX_REGIONS regions are still read
  const e4 = S.mockEngine();
  const out4 = [];
  const h4 = S.core.createHandler({ engine: e4, raster: S.raster, segmenter: kindStub('text'), prep: prepStub(S.core.MAX_REGIONS), post: (m) => out4.push(m) });
  await h4.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: rowsPage(1).gray, width: 600, height: 400, scale: 1 });
  const d4 = out4.find((m) => m.type === 'page-done');
  check('core: exactly MAX_REGIONS regions are all recognised', e4.calls.length === S.core.MAX_REGIONS && !!d4 && !d4.result.skippedReason, String(e4.calls.length));

  // engine stats (min/mean token probabilities) ride along on the region; absent stats add no key
  const stats = { min: 0.12, mean: 0.7, tokens: 9 };
  let n5 = 0;
  const e5 = { name: 's', load: async () => ({ available: true }), recognise: async () => (n5++ === 0 ? { text: 'a', confidence: 0.8, stats } : { text: 'b', confidence: 0.8 }) };
  const out5 = [];
  const h5 = S.core.createHandler({ engine: e5, raster: S.raster, segmenter: kindStub('text'), prep: prepStub(2), post: (m) => out5.push(m) });
  await h5.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: rowsPage(1).gray, width: 600, height: 400, scale: 1 });
  const r5 = flat(out5.find((m) => m.type === 'page-done').result);
  check('core: engine stats passed through onto the region', JSON.stringify(r5[0].stats) === JSON.stringify(stats) && !('stats' in r5[1]), JSON.stringify(r5));

  // the worker core reads exactly what hwPagePrep plans, with the crops cropFor makes
  const seen = [];
  const e6 = { name: 'c', load: async () => ({ available: true }), recognise: async (c) => { seen.push(c.y); return { text: 't', confidence: 0.9 }; } };
  const h6 = S.core.createHandler({ engine: e6, raster: S.raster, segmenter: kindStub('text'), prep: prepStub(3), post: () => {} });
  await h6.handle({ type: 'page', jobId: 1, pageNumber: 1, gray: rowsPage(1).gray, width: 600, height: 400, scale: 1 });
  check('core: crops come from prep.cropFor in plan order', JSON.stringify(seen) === '[0,3,6]', JSON.stringify(seen));
}

async function clientTests() {
  const never = { created: 0 };
  const hang = () => { never.created++; return { onmessage: null, postMessage() {}, terminate() { never.term = (never.term || 0) + 1; } }; };
  const c1 = src('hw', 'hw-client.js').create({ workerFactory: hang });
  const p = c1.init();
  await sleep(10);
  c1.dispose();
  const info = await Promise.race([p, sleep(1000).then(() => 'timeout')]);
  check('client: dispose during pending init settles available === false', info && info.available === false, JSON.stringify(info));

  const stats = S.newStats();
  const hung = { name: 'h', load: async () => ({ available: true }), recognise: () => new Promise(() => {}) };
  const c2 = src('hw', 'hw-client.js').create({ workerFactory: S.fakeWorkerFactory(hung, stats) });
  const pg = rowsPage(2);
  const pending = c2.recognisePage({ pageNumber: 1, gray: pg.gray, width: 600, height: 400, scale: 1 }).then(() => null, (e) => e);
  await sleep(30);
  c2.dispose();
  const err = await Promise.race([pending, sleep(1000).then(() => 'timeout')]);
  check('client: dispose during recognisePage rejects AbortError', err && err.name === 'AbortError', String(err));
  const again = await c2.init();
  check('client: init works after dispose with a fresh worker', again.available === true && stats.created === 2, `created ${stats.created}`);
  c2.dispose();

  const base = S.mockEngine();
  let c3 = null;
  const eng = { ...base, recognise: async (c, k) => { const r = await base.recognise(c, k); if (base.calls.length === 2) c3.cancel(); return r; } };
  c3 = src('hw', 'hw-client.js').create({ workerFactory: S.fakeWorkerFactory(eng, S.newStats()) });
  const g = rowsPage(4);
  const e3 = await c3.recognisePage({ pageNumber: 1, gray: g.gray, width: 600, height: 400, scale: 1 }).then(() => null, (e) => e);
  check('client: cancelled page rejects AbortError carrying err.partial', !!e3 && e3.name === 'AbortError' && !!e3.partial && flat(e3.partial).filter((r) => r.text).length === 2, String(e3 && e3.name));
  c3.dispose();
}

async function pipelineTests() {
  const pipe = src('hw', 'hw-pipeline.js');
  const hangFactory = () => ({ onmessage: null, postMessage() {}, terminate() {} });
  const doc = docOf([inkPage(1), inkPage(2)]);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 30);
  const t0 = Date.now();
  const r1 = await pipe.ensureRecognised(doc, 1, 2, { client: src('hw', 'hw-client.js').create({ workerFactory: hangFactory }), signal: ac.signal, renderPage: async () => rowsPage() });
  check('pipeline: abort during init -> cancelled promptly', r1.cancelled === true && Date.now() - t0 < 2000, `${Date.now() - t0} ms ${JSON.stringify(r1)}`);
  check('pipeline: abort marks unread pages ink.skipped', doc.pageCache.get(1).ink.skipped === true && doc.pageCache.get(2).ink.skipped === true && r1.skipped === 2, JSON.stringify(r1));

  const stats = S.newStats();
  let renders = 0;
  const client = src('hw', 'hw-client.js').create({ workerFactory: S.fakeWorkerFactory(S.mockEngine(), stats) });
  const renderPage = async () => { renders++; return rowsPage(3); };
  const r2 = await pipe.ensureRecognised(doc, 1, 2, { client, renderPage });
  check('pipeline: next call without retrySkipped does no work', r2.pages === 0 && renders === 0 && stats.created === 0 && r2.skipped === 2, JSON.stringify(r2));
  const r3 = await pipe.ensureRecognised(doc, 1, 2, { client, renderPage, retrySkipped: true });
  check('pipeline: retrySkipped reads the pages, clears skipped', r3.pages === 2 && r3.skipped === 0 && !doc.pageCache.get(1).ink.skipped && !doc.pageCache.get(2).ink.skipped, JSON.stringify(r3));
  client.dispose();

  const doc2 = docOf([inkPage(1), inkPage(2)]);
  const base = S.mockEngine();
  const ac2 = new AbortController();
  const eng = { ...base, recognise: async (c, k) => { const r = await base.recognise(c, k); if (base.calls.length === 2) ac2.abort(); return r; } };
  const client2 = src('hw', 'hw-client.js').create({ workerFactory: S.fakeWorkerFactory(eng, S.newStats()) });
  const r4 = await pipe.ensureRecognised(doc2, 1, 2, { client: client2, signal: ac2.signal, renderPage: async () => rowsPage(4) });
  const p1 = doc2.pageCache.get(1);
  check('pipeline: cancel mid-page applies the partial page', r4.cancelled === true && p1.ink.recognised === true && p1.lines.length === 2, `${JSON.stringify(r4)} lines ${p1.lines.length}`);
  check('pipeline: unread page skipped, stats.skipped === 1', doc2.pageCache.get(2).ink.skipped === true && r4.skipped === 1 && !p1.ink.skipped, JSON.stringify(r4));
  client2.dispose();
}

async function engineTests() {
  const util = src('hw', 'engine-util.js');
  const model = src('hw', 'engine-model.js');
  check('util: heuristicConfidence empty is 0', util.heuristicConfidence('') === 0);
  check('util: normal sentence > 0.6', util.heuristicConfidence('The derivative is a limit.') > 0.6);
  check('util: repeated letters < 0.6', util.heuristicConfidence('aaaaaaaaaaaa') < 0.6);

  const scope = { fetch: (u) => Promise.resolve(`real:${u}`), location: { href: 'http://localhost/app/x', origin: 'http://localhost' } };
  model.guardFetch(scope);
  const blocked = await scope.fetch('https://cdn.jsdelivr.net/x').then(() => false, () => true);
  const okRes = await scope.fetch('http://localhost/app/vendor/a.js').catch(() => null);
  check('guardFetch rejects cross-origin, passes same-origin', blocked && okRes === 'real:http://localhost/app/vendor/a.js', String(okRes));

  // The real library and model are exercised in a real browser by tools/smoke-handwriting.js (verify_suite step 6).
  // Here: only the type-it-in fallback, i.e. what happens when the model files are not installed.
  let imports = 0;
  const absent = model.create({ baseUrl: 'http://localhost/app/', fetchFn: async () => ({ ok: false }), importModule: async () => { imports++; throw new Error('must not be imported'); } });
  const a = await absent.load();
  check('model: files absent -> available false, library never imported', a.available === false && imports === 0, JSON.stringify(a));
  const crop = { data: new Uint8Array(40 * 20).fill(200), w: 40, h: 20 };
  const r = await absent.recognise(crop, 'text').then((x) => x, () => 'rejected');
  check('model: not loaded -> text "", confidence 0, no rejection', r !== 'rejected' && r.text === '' && r.confidence === 0, JSON.stringify(r));
}

function reviewTests() {
  const rv = src('ui', 'hw-review.js');
  check('notice: null and zero stats -> empty', rv.noticeHtml(null) === '' && rv.noticeHtml({ pages: 0, low: 0, skipped: 0, cancelled: false, engine: null }) === '');
  const h = rv.noticeHtml({ pages: 3, low: 2, skipped: 0, cancelled: false, engine: { available: true } });
  check('notice: counts and data-hw-review button, no script', /3 pages/.test(h) && /2 pieces/.test(h) && h.includes('data-hw-review') && !/<script/i.test(h), h);
  check('notice: no model -> "type it in"', /type it in/i.test(rv.noticeHtml({ pages: 2, low: 0, skipped: 0, engine: { available: false } })));
  check('notice: skipped > 0 -> resume button', rv.noticeHtml({ pages: 1, low: 0, skipped: 2, engine: { available: true } }).includes('id="hwResumeBtn"'));
  const mk = (n, confs) => ({ pageNumber: n, ink: { recognised: true, result: { scale: 1, lines: confs.map((c, i) => ({ index: i, regions: [{ id: `p${n}-l${i}-r0`, kind: 'text', text: 't', confidence: c, box: { x: 0, y: 0, w: 1, h: 1 } }] })) } } });
  const doc = docOf([mk(1, [0.9, 0.2]), mk(2, [0.1, 0.95]), mk(5, [0.0])]);
  const ids = rv.reviewItems(doc, 1, 3).map((i) => i.regionId);
  check('reviewItems: low first, then page/line order, out-of-range excluded', JSON.stringify(ids) === JSON.stringify(['p1-l1-r0', 'p2-l0-r0', 'p1-l0-r0', 'p2-l1-r0']), JSON.stringify(ids));
}

async function typedDocTests() {
  for (const f of ['pdf/ink-detect.js', 'pdf/ocr-lines.js', 'hw/hw-client.js', 'hw/hw-pipeline.js', 'ui/study-pipeline.js']) src(...f.split('/'));
  const P = globalThis.PDFStudy;
  const orig = P.hwPipeline.ensureRecognised;
  let calls = 0;
  P.hwPipeline.ensureRecognised = async () => { calls++; return { pages: 0, regions: 0, low: 0, skipped: 0, cancelled: false, engine: null }; };
  const text = (n) => ({ pageNumber: n, width: 600, height: 800, lines: [{ text: 'Some typed sentence here.', wordCount: 4 }], wordCount: 4, ink: { needsRecognition: false } });
  const run = async (pages, opts) => {
    calls = 0;
    const st = { parsedPdf: docOf(pages), selectedScope: { title: 't' }, activeMode: 'book', quizCount: 5, quizSeed: 0, generated: {} };
    try { await P.studyPipeline.buildMaterials(st, 1, pages.length, () => {}, opts || {}); } catch (_e) { /* later stages need the full app; only the recognition gate matters */ }
    return calls;
  };
  try {
    const typed = Array.from({ length: 10 }, (_, i) => text(i + 1)).concat([inkPage(11)]);
    check('typed doc: 1 figure page in 11 -> recognition not called', (await run(typed)) === 0);
    check('mostly-ink doc: 2 of 3 pages need recognition -> called', (await run([text(1), inkPage(2), inkPage(3)])) === 1);
    check('live flag: handwriting false -> recognition not called on ink pages', (await run([inkPage(1), inkPage(2)], { handwriting: false })) === 0);
  } finally { P.hwPipeline.ensureRecognised = orig; }
}

(async () => {
  const t0 = Date.now();
  for (const [name, fn] of [['core', coreTests], ['client', clientTests], ['pipeline', pipelineTests], ['engine', engineTests], ['review', reviewTests], ['typed', typedDocTests]]) {
    try { await fn(); } catch (e) { failed++; console.log(`FAIL ${name} suite threw: ${e && e.stack}`); }
  }
  console.log(`info: ${Date.now() - t0} ms`);
  console.log(`handwriting_flow_fixtures: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

/**
 * When pages are parsed (Node, no PDF.js): src/pdf/page-scheduler.js and src/pdf/parsed-page-cache.js.
 * Pages come back in the order asked for, a page asked for twice while it is parsed is parsed once, a
 * remembered page is not parsed at all, a remembered page is a private copy, a parse error reaches the caller,
 * and without a store or a fingerprint nothing is cached. In Node there are no helper workers: pages are
 * parsed one at a time in page order, exactly as before.
 * Run: node tests/page_schedule_fixtures.js
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));

let failed = 0;
let passed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ''}`);
}

const store = src('ui', 'doc-store.js');
src('nlp', 'study-keys.js');
const cache = src('pdf', 'parsed-page-cache.js');
const scheduler = src('pdf', 'page-scheduler.js');
const P = globalThis.PDFStudy;
store.configure({ memoryOnly: true });

const tick = () => new Promise((r) => setTimeout(r, 1));
const fakeDoc = (print, numPages) => ({ numPages, fingerprints: [print, null] });
/** A parser that records the order it was called in and takes a little while per page. */
function parser(log) {
  return async (doc, n) => {
    log.push(n);
    await tick();
    if (n === 13) throw new Error('page 13 cannot be parsed');
    return { pageNumber: n, lines: [{ text: `line on page ${n}` }], wordCount: 4, ink: { reason: 'typed' } };
  };
}

async function main() {
  // Without a store: one at a time, in page order, nothing remembered
  const realStore = P.docStore;
  P.docStore = null;
  let log = [];
  const doc = fakeDoc('print-a', 20);
  scheduler.attach(doc, scheduler.begin(new ArrayBuffer(8)));
  const pages = await Promise.all(scheduler.schedule(doc, [3, 1, 2], parser(log)));
  check('pages come back in the order asked for', pages.map((p) => p.pageNumber).join() === '3,1,2');
  check('Node: parsed one at a time in the order asked for', log.join() === '3,1,2', log.join());

  // The same page asked for twice while it is parsed: parsed once, both get the same page
  log = [];
  const first = scheduler.schedule(doc, [4, 5], parser(log));
  const second = scheduler.schedule(doc, [5, 6], parser(log));
  const [a5, b5] = await Promise.all([first[1], second[0]]);
  await Promise.all(second);
  check('a page in flight is not parsed twice', log.filter((n) => n === 5).length === 1 && a5 === b5, log.join());

  // A failure reaches the caller; the pages after it are still parsed
  log = [];
  const withError = scheduler.schedule(doc, [12, 13, 14], parser(log));
  const outcome = await Promise.all(withError.map((p) => p.then(() => 'ok', (e) => e.message)));
  check('a parse error rejects that page only', outcome.join('|') === 'ok|page 13 cannot be parsed|ok', outcome.join('|'));
  P.docStore = realStore;

  // With a store, a fingerprint and a parser version: parsed pages are remembered for the next opening
  cache.useVersion('v1');
  log = [];
  const docB = fakeDoc('print-b', 20);
  scheduler.attach(docB, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(docB, [1, 2, 3], parser(log)));
  await tick();
  const again = fakeDoc('print-b', 20); // the same file opened again
  scheduler.attach(again, scheduler.begin(new ArrayBuffer(8)));
  log = [];
  const back = await Promise.all(scheduler.schedule(again, [1, 2, 3, 4], parser(log)));
  check('reopened: remembered pages are not parsed again', log.join() === '4', log.join());
  check('reopened: the remembered pages are the pages', back.map((p) => p.lines[0].text).join('|') === 'line on page 1|line on page 2|line on page 3|line on page 4');
  back[0].lines.push({ text: 'added later, as reading a picture does' });
  const third = fakeDoc('print-b', 20);
  scheduler.attach(third, scheduler.begin(new ArrayBuffer(8)));
  const fresh = await scheduler.schedule(third, [1], parser([]))[0];
  check('a remembered page is a private copy: later changes are not remembered', fresh.lines.length === 1);

  // A new parser version, another file with the same fingerprint, or no fingerprint: nothing is found
  cache.useVersion('v2');
  log = [];
  const docC = fakeDoc('print-b', 20);
  scheduler.attach(docC, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(docC, [1], parser(log)));
  check('a new parser version parses afresh', log.join() === '1');
  cache.useVersion('v1');
  log = [];
  const sameId = fakeDoc('print-b', 21); // same fingerprint, another page count: another file
  scheduler.attach(sameId, scheduler.begin(new ArrayBuffer(8)));
  await Promise.all(scheduler.schedule(sameId, [1], parser(log)));
  check('another file with the same fingerprint is not served these pages', log.join() === '1');
  check('no fingerprint: no cache', (await cache.forDocument({ numPages: 3, fingerprints: [null] }, 8)) === null);
  check('too many pages to keep: no cache', (await cache.forDocument(fakeDoc('print-big', cache.MAX_PAGES + 1), 8)) === null);
  cache.useVersion(null);
  check('parser version unknown: no cache', (await cache.forDocument(fakeDoc('print-b', 20), 8)) === null);

  check('Node: nextTask resolves at once', (await Promise.race([scheduler.nextTask().then(() => true), tick().then(() => false)])) === true);

  console.log(`page_schedule_fixtures: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

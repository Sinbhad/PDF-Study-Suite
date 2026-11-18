/**
 * When and where pages are parsed, for pdf-loader.js. What a page holds is decided by parseSinglePage alone;
 * this file only decides how often and how fast it runs:
 *   - a page parsed before (this session, or in an earlier one: parsed-page-cache.js) is not parsed again;
 *   - a page asked for twice while it is being parsed is parsed once;
 *   - in a browser, a long run of pages is spread over extra PDF.js workers (each one a second copy of the
 *     document), because the time goes into PDF.js decoding the pages' pictures, one page at a time per worker;
 *   - between pages the page gets a turn, so clicks and the loading bar are not held up.
 * The loader still puts pages into its cache in page order, so everything downstream sees the same pages in
 * the same order as before. Parsing a page does not depend on what the same document parsed before it
 * (checked page by page on real decks), so a page parsed by a helper worker is the page the main one gives.
 *   begin(arrayBuffer)                     call before PDF.js takes the bytes; returns a token for attach
 *   attach(pdfDoc, token)                  the document to schedule for (ends the helpers of the last one)
 *   schedule(pdfDoc, numbers, parseOne)    -> one promise per page number, in the same order
 *   nextTask()                             resolves on the next turn of the event loop (browser), at once in Node
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const mod = (key, file) => PDFStudy[key] || (typeof require === 'function' ? require(file) : null);
  const pageCache = () => mod('parsedPageCache', './parsed-page-cache.js');

  // Spread over helpers only when this many pages still have to be parsed in one go
  const MIN_PARALLEL = 6;
  const MAX_HELPERS = 3;
  // A helper holds a full copy of the file; above this size only the one worker is used
  const MAX_HELPER_BYTES = 80 * 1024 * 1024;
  // ... and all helpers together hold no more than this many bytes of copies
  const HELPER_BYTES_BUDGET = 160 * 1024 * 1024;
  // Helpers left idle this long are closed (their copy of the file is freed)
  const HELPER_IDLE_MS = 30000;

  const isBrowser = typeof document !== 'undefined' && typeof Worker !== 'undefined';
  const states = new WeakMap();
  let current = null; // the attached document's state

  /** Resolves on the next task, so the page can paint and handle input between two parsed pages. */
  function nextTask() {
    if (!isBrowser) return Promise.resolve();
    if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0));
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }

  function helperCount() {
    const nav = root.navigator || {};
    const cores = Number(nav.hardwareConcurrency) || 2;
    const memory = Number(nav.deviceMemory) || 8;
    if (memory < 4) return 0;
    // the page itself and the document's own worker keep a core each
    return Math.max(0, Math.min(MAX_HELPERS, cores - 2));
  }

  function begin(arrayBuffer) {
    const bytes = arrayBuffer && arrayBuffer.byteLength ? arrayBuffer.byteLength : 0;
    const usable = isBrowser && helperCount() > 0 && bytes > 0 && bytes <= MAX_HELPER_BYTES && root.pdfjsLib;
    // PDF.js hands the bytes to its worker and they are gone from here, so helpers need their own copy
    return { byteLength: bytes, spare: usable ? arrayBuffer.slice(0) : null };
  }

  function closeHelpers(state) {
    if (!state) return;
    clearTimeout(state.idleTimer);
    const helpers = state.helpers;
    state.helpers = [];
    for (const h of helpers) {
      h.doc.then((doc) => doc && doc.destroy()).catch(() => {});
    }
  }

  function attach(pdfDoc, token) {
    if (current && current.pdfDoc !== pdfDoc) {
      closeHelpers(current);
      current.spare = null;
    }
    const t = token || {};
    const cacheModule = pageCache();
    const state = {
      pdfDoc,
      spare: t.spare || null,
      helpers: [],
      idleTimer: null,
      inflight: new Map(),
      cache: cacheModule ? cacheModule.forDocument(pdfDoc, t.byteLength).catch(() => null) : Promise.resolve(null),
    };
    states.set(pdfDoc, state);
    current = state;
    return state;
  }

  function stateOf(pdfDoc) {
    return states.get(pdfDoc) || attach(pdfDoc, null);
  }

  /** A helper: the same file opened again in a worker of its own. Resolves to null when it cannot open. */
  function openHelper(state) {
    const lib = root.pdfjsLib;
    const doc = lib.getDocument({ data: state.spare.slice(0), fontExtraProperties: true }).promise.catch(() => null);
    return { doc, busy: false, dead: false };
  }

  /** Lanes that parse at the same time: the document itself, then helpers when the run is long enough. */
  function lanesFor(state, toParse) {
    const lanes = [{ doc: Promise.resolve(state.pdfDoc), busy: false, dead: false, main: true }];
    if (!state.spare || toParse < MIN_PARALLEL) return lanes;
    const affordable = Math.floor(HELPER_BYTES_BUDGET / Math.max(1, state.spare.byteLength));
    const want = Math.min(helperCount(), affordable, Math.ceil(toParse / MIN_PARALLEL) - 1);
    while (state.helpers.length < want) state.helpers.push(openHelper(state));
    clearTimeout(state.idleTimer);
    return lanes.concat(state.helpers.filter((h) => !h.dead).slice(0, want));
  }

  function idleLater(state) {
    clearTimeout(state.idleTimer);
    if (!state.helpers.length) return;
    state.idleTimer = setTimeout(() => {
      if (!state.inflight.size) closeHelpers(state);
    }, HELPER_IDLE_MS);
  }

  /**
   * Runs the queue of page numbers over the lanes. A helper that fails hands its page back to the queue and
   * is not used again; a page that fails on the document itself fails as it did before this file existed.
   */
  function runQueue(state, queue, parseOne, settle) {
    const lanes = lanesFor(state, queue.length);
    const pump = () => {
      for (const lane of lanes) {
        if (lane.busy || lane.dead || !queue.length) continue;
        const n = queue.shift();
        lane.busy = true;
        lane.doc
          .then((doc) => {
            if (!doc) throw new Error('helper could not open the document');
            return parseOne(doc, n);
          })
          .then((page) => {
            lane.busy = false;
            settle(n, null, page);
          }, (err) => {
            lane.busy = false;
            if (lane.main) settle(n, err, null);
            else {
              lane.dead = true;
              queue.unshift(n);
            }
          })
          .then(() => {
            if (queue.length) pump();
            else if (lanes.every((l) => !l.busy)) idleLater(state);
          });
      }
    };
    pump();
  }

  /**
   * One promise per page number (same order). Pages come from the cache when it has them; the rest are
   * parsed with parseOne(pdfDoc, pageNumber) and remembered.
   */
  function schedule(pdfDoc, numbers, parseOne) {
    const state = stateOf(pdfDoc);
    const fresh = [];
    const settlers = new Map();
    const promises = numbers.map((n) => {
      if (state.inflight.has(n)) return state.inflight.get(n);
      const p = new Promise((resolve, reject) => settlers.set(n, { resolve, reject }));
      state.inflight.set(n, p);
      fresh.push(n);
      return p;
    });
    if (!fresh.length) return promises;

    const settle = (n, err, page) => {
      const s = settlers.get(n);
      state.inflight.delete(n);
      if (err) s.reject(err);
      else s.resolve(page);
    };
    (async () => {
      const cache = await state.cache;
      const found = cache ? await Promise.all(fresh.map((n) => cache.get(n))) : fresh.map(() => null);
      const queue = [];
      fresh.forEach((n, i) => {
        if (found[i]) settle(n, null, found[i]);
        else queue.push(n);
      });
      if (!queue.length) return;
      const remember = (n, err, page) => {
        if (!err && cache) cache.put(page);
        settle(n, err, page);
      };
      runQueue(state, queue, parseOne, remember);
    })().catch((err) => {
      for (const n of fresh) if (state.inflight.has(n)) settle(n, err, null);
    });
    // The caller awaits these in order and stops at the first failure, as the loader always has: a later
    // page that fails too must not be reported as an unhandled rejection
    promises.forEach((p) => p.catch(() => {}));
    return promises;
  }

  PDFStudy.pageScheduler = { begin, attach, schedule, nextTask, MIN_PARALLEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.pageScheduler;
})(typeof window !== 'undefined' ? window : globalThis);

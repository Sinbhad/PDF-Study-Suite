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

  const copyBytes = (buf) => {
    if (ArrayBuffer.isView(buf)) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return buf.slice(0);
  };

  function begin(arrayBuffer) {
    const bytes = arrayBuffer && arrayBuffer.byteLength ? arrayBuffer.byteLength : 0;
    const canSlice = arrayBuffer && (typeof arrayBuffer.slice === 'function' || ArrayBuffer.isView(arrayBuffer));
    const usable = canSlice && bytes > 0 && bytes <= MAX_HELPER_BYTES && root.pdfjsLib && typeof root.pdfjsLib.getDocument === 'function';
    // PDF.js transfers or detaches raw bytes when opening, so parse-only lanes need their own copy
    return { byteLength: bytes, spare: usable ? copyBytes(arrayBuffer) : null };
  }

  function closeHelpers(state) {
    if (!state) return;
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
    const docs = state.helpers.slice();
    state.helpers = [];
    if (state.fastDoc) {
      docs.push(state.fastDoc);
      state.fastDoc = null;
    }
    for (const h of docs) {
      h.doc.then((doc) => doc && typeof doc.destroy === 'function' && doc.destroy()).catch(() => {});
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
      fastDoc: null,
      fastFailed: false,
      helpers: [],
      queue: [],
      idleTimer: null,
      inflight: new Map(),
      cache: cacheModule ? cacheModule.forDocument(pdfDoc, t.byteLength).catch(() => null) : Promise.resolve(null),
    };
    if (pdfDoc && typeof pdfDoc.destroy === 'function' && !pdfDoc.__schedulerDestroyHooked) {
      const origDestroy = pdfDoc.destroy.bind(pdfDoc);
      pdfDoc.__schedulerDestroyHooked = true;
      pdfDoc.destroy = () => {
        closeHelpers(state);
        state.spare = null;
        return origDestroy();
      };
    }
    states.set(pdfDoc, state);
    current = state;
    return state;
  }

  function stateOf(pdfDoc) {
    return states.get(pdfDoc) || attach(pdfDoc, null);
  }

  /** Opens a parse-only copy of the document with image decoding disabled (maxImageSize: 1). */
  function openParseDoc(state, fast) {
    const lib = root.pdfjsLib;
    const doc = Promise.resolve()
      .then(() => {
        const task = lib.getDocument({ data: copyBytes(state.spare), fontExtraProperties: true, maxImageSize: 1, verbosity: 0 });
        return task && task.promise ? task.promise : task;
      })
      .catch(() => null);
    return { doc, busy: false, dead: false, fast: Boolean(fast) };
  }

  /** Lanes that parse at the same time: parse-only fast lane (plus browser helpers), or main doc fallback. */
  function lanesFor(state, toParse) {
    const canFast = Boolean(state.spare && !state.fastFailed && root.pdfjsLib && typeof root.pdfjsLib.getDocument === 'function');
    if (!canFast) return [{ doc: Promise.resolve(state.pdfDoc), busy: false, dead: false, main: true }];
    if (!state.fastDoc || state.fastDoc.dead) state.fastDoc = openParseDoc(state, true);
    const lanes = [state.fastDoc];
    if (isBrowser && helperCount() > 0 && toParse >= MIN_PARALLEL) {
      const affordable = Math.max(0, Math.floor(HELPER_BYTES_BUDGET / Math.max(1, state.spare.byteLength)) - 1);
      const want = Math.max(0, Math.min(helperCount(), affordable, Math.ceil(toParse / MIN_PARALLEL) - 1));
      while (state.helpers.length < want) state.helpers.push(openParseDoc(state, false));
      lanes.push(...state.helpers.filter((h) => !h.dead).slice(0, want));
    }
    clearTimeout(state.idleTimer);
    return lanes;
  }

  function idleLater(state) {
    clearTimeout(state.idleTimer);
    if (!state.helpers.length && !state.fastDoc) return;
    state.idleTimer = setTimeout(() => {
      if (!state.inflight.size) closeHelpers(state);
    }, HELPER_IDLE_MS);
    if (state.idleTimer && state.idleTimer.unref) state.idleTimer.unref();
  }

  /**
   * Runs the document's queued pages over its active lanes. A failed helper or fast lane falls back to
   * state.pdfDoc cleanly; a page that fails on state.pdfDoc itself fails as it did before.
   */
  function pumpState(state) {
    if (!state.queue.length) return;
    const lanes = lanesFor(state, state.queue.length);
    const ensureMain = () => {
      if (!lanes.some((l) => l.main && !l.dead)) {
        lanes.push({ doc: Promise.resolve(state.pdfDoc), busy: false, dead: false, main: true });
      }
    };
    const pump = () => {
      for (const lane of lanes) {
        if (lane.busy || lane.dead || !state.queue.length) continue;
        const item = state.queue.shift();
        lane.busy = true;
        lane.doc
          .then((doc) => {
            if (!doc) {
              const err = new Error('helper could not open the document');
              err.__openFailed = true;
              throw err;
            }
            return item.parseOne(doc, item.n);
          })
          .then((page) => {
            lane.busy = false;
            item.settle(item.n, null, page);
          }, (err) => {
            lane.busy = false;
            if (lane.main) {
              item.settle(item.n, err, null);
              return;
            }
            if (err && err.__openFailed) {
              lane.dead = true;
              if (lane.fast) state.fastFailed = true;
              state.queue.unshift(item);
              if (lanes.every((l) => l.dead)) ensureMain();
              return;
            }
            if (!lane.fast) {
              lane.dead = true;
              state.queue.unshift(item);
              if (lanes.every((l) => l.dead)) ensureMain();
              return;
            }
            // Fast lane opened cleanly, so retry just this page on state.pdfDoc while keeping fast lane alive
            Promise.resolve(item.parseOne(state.pdfDoc, item.n)).then(
              (page) => item.settle(item.n, null, page),
              (mainErr) => item.settle(item.n, mainErr, null)
            );
          })
          .then(() => {
            if (state.queue.length) pump();
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
      const queued = [];
      fresh.forEach((n, i) => {
        if (found[i]) settle(n, null, found[i]);
        else queued.push(n);
      });
      if (!queued.length) return;
      const remember = (n, err, page) => {
        if (!err && cache) cache.put(page);
        settle(n, err, page);
      };
      for (const n of queued) state.queue.push({ n, parseOne, settle: remember });
      pumpState(state);
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

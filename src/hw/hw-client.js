/**
 * Main-thread wrapper around the recognition worker. The worker is created on the first init(),
 * never at script load. If it cannot start, init() resolves { available: false } and
 * recognisePage() rejects with a clear Error.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const abortError = () => {
    const e = new Error('Recognition cancelled');
    e.name = 'AbortError';
    return e;
  };

  /**
   * @param {{workerFactory?:function():Worker, onModelProgress?:function}} [opts]
   * @returns {{init:function, initCanvas:function, recognisePage:function, readTile:function, cancel:function, dispose:function, onModelProgress:?function}}
   */
  function create(opts) {
    const factory = (opts && opts.workerFactory) || (() => new Worker('src/hw/hw-worker.js'));
    let worker = null;
    let handshakes = {}; // reply type -> promise of the engine info ('ready': line reader, 'canvas-ready': tile reader)
    let waiting = {}; // reply type -> resolver of a handshake still pending
    let broken = '';
    let nextJob = 1;
    let current = null; // { jobId, resolve, reject, onProgress }
    const api = { onModelProgress: (opts && opts.onModelProgress) || null };
    const none = (reason) => ({ name: 'none', available: false, reason });

    function fail(reason) {
      broken = reason;
      if (current) {
        const j = current;
        current = null;
        j.reject(new Error(reason));
      }
    }

    /** Settle every pending handshake with `info`. */
    function settle(info) {
      const pending = Object.values(waiting);
      waiting = {};
      pending.forEach((resolve) => resolve(info));
      return pending.length > 0;
    }

    function onMessage(msg) {
      if (!msg) return;
      if (msg.type === 'ready' || msg.type === 'canvas-ready') {
        const resolve = waiting[msg.type];
        delete waiting[msg.type];
        return resolve && resolve(msg.engine);
      }
      if (msg.type === 'model-progress') return api.onModelProgress && api.onModelProgress(msg);
      if (!current || msg.jobId !== current.jobId) return;
      const j = current;
      if (msg.type === 'progress') {
        if (j.onProgress) j.onProgress({ pageNumber: msg.pageNumber, done: msg.done, total: msg.total });
        return;
      }
      current = null;
      if (msg.type === 'page-done') j.resolve(msg.result);
      else if (msg.type === 'tile-done') j.resolve({ lines: msg.lines || [], engine: msg.engine || null });
      else if (msg.type === 'cancelled') {
        const e = abortError();
        if (msg.result) e.partial = msg.result;
        j.reject(e);
      }
      else if (msg.type === 'error') j.reject(new Error(msg.message || 'Recognition failed'));
    }

    /** Create the worker once. Returns '' or the reason it could not start. */
    function start() {
      if (worker) return broken;
      let w = null;
      try {
        w = worker = factory();
      } catch (err) {
        const reason = `Could not start the recognition worker: ${(err && err.message) || err}`;
        fail(reason);
        return reason;
      }
      w.onmessage = (e) => { if (w === worker) onMessage(e.data); };
      w.onerror = (e) => {
        if (w !== worker) return;
        const reason = `Recognition worker error: ${(e && e.message) || 'failed to run'}`;
        fail(reason);
        if (!settle(none(reason))) dispose(); // after a good start: the next init() starts a fresh worker
      };
      return '';
    }

    /** Ask the worker to load one engine (once) and resolve with its info. */
    function handshake(type, reply) {
      if (!handshakes[reply]) {
        handshakes[reply] = new Promise((resolve) => {
          const reason = start();
          if (reason) return resolve(none(reason));
          waiting[reply] = resolve;
          worker.postMessage({ type });
        });
      }
      return handshakes[reply];
    }

    /** Start the worker and the line reader; resolves with the engine info from `ready`. */
    const init = () => handshake('init', 'ready');
    /** Start the worker and only the tile reader used for canvas pages (`canvas-ready`). */
    const initCanvas = () => handshake('init-canvas', 'canvas-ready');

    function job(info, type, payload, transfer, onProgress) {
      if (info && info.reason === 'cancelled') throw abortError();
      if (broken || !worker) throw new Error(broken || 'Recognition worker is not available');
      if (current) throw new Error('A page is already being recognised');
      const jobId = nextJob++;
      return new Promise((resolve, reject) => {
        current = { jobId, resolve, reject, onProgress };
        worker.postMessage(Object.assign({ type, jobId }, payload), transfer);
      });
    }

    /**
     * Recognise one page. `gray.buffer` is transferred (the array is unusable afterwards).
     * @returns {Promise<object>} the page result; rejects with name 'AbortError' when cancelled
     */
    async function recognisePage(payload, onProgress) {
      const info = await init();
      const { pageNumber, gray, width, height, scale } = payload;
      return job(info, 'page', { pageNumber, gray, width, height, scale }, [gray.buffer], onProgress);
    }

    /**
     * Read one enlarged tile of a canvas page. `rgba.buffer` is transferred. `lineHeight` is the expected
     * height of a text line in tile pixels.
     * @returns {Promise<{lines:object[], engine:?object}>} line boxes in tile pixels; 'AbortError' when cancelled
     */
    async function readTile(payload) {
      const info = await initCanvas();
      const { pageNumber, rgba, width, height, lineHeight } = payload;
      return job(info, 'tile', { pageNumber, rgba, width, height, lineHeight }, [rgba.buffer]);
    }

    /** Ask the worker to stop the running job (honoured between regions). */
    function cancel() {
      if (current && worker) worker.postMessage({ type: 'cancel', jobId: current.jobId });
    }

    /** Terminate the worker, settle anything pending; a later init() starts a fresh one. */
    function dispose() {
      const w = worker;
      const j = current;
      worker = null;
      current = null;
      handshakes = {};
      broken = '';
      if (w && w.terminate) w.terminate();
      settle(none('cancelled'));
      if (j) j.reject(abortError());
    }

    return Object.assign(api, { init, initCanvas, recognisePage, readTile, cancel, dispose });
  }

  PDFStudy.hwClient = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwClient;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

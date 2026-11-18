/**
 * How many WebAssembly threads the recognisers may use. Threads need shared memory, which a browser grants
 * only to a cross-origin isolated page: one served with `Cross-Origin-Opener-Policy: same-origin` and
 * `Cross-Origin-Embedder-Policy: require-corp`. app.py sends both; a static host that cannot (GitHub Pages)
 * leaves the page unisolated, and the recognisers then run on one thread as before.
 *   count(scope) -> 1, or the number of logical cores up to MAX_THREADS
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** More threads than this stopped paying off for models this small, and each one holds memory. */
  const MAX_THREADS = 4;

  /** @param {object} [scope] the worker or window global (defaults to this one) */
  function count(scope) {
    const s = scope || root;
    if (!s || s.crossOriginIsolated !== true) return 1;
    const cores = s.navigator && Number(s.navigator.hardwareConcurrency);
    return cores > 1 ? Math.min(MAX_THREADS, Math.floor(cores)) : 1;
  }

  PDFStudy.hwWasmThreads = { count, MAX_THREADS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwWasmThreads;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

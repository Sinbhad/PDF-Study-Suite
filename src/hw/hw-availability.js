/**
 * Decides whether reading scanned and handwritten pages is offered: it is when the PP-OCR page reader's files
 * are installed beside the app (vendor/hw/, fetched by tools/fetch-handwriting-model.py; they are not part of
 * the repository). Sets, for the rest of the app:
 *   PDFStudy.ENABLE_HANDWRITING            false until the check has passed, then true
 *   PDFStudy.hwAvailability.ready          Promise of the finished check (resolves to hwAvailability itself)
 *   PDFStudy.hwAvailability.available      same value as the flag
 *   PDFStudy.hwAvailability.reason         why not, in plain words ('' when available)
 *   PDFStudy.hwAvailability.settled(ms)    Promise: the check has finished, or `ms` have passed
 * The check is one HEAD request per file to the app's own origin, stopping at the first that is missing; nothing
 * is downloaded. Outside a browser (Node tests, tools/run-pdf.js) nothing is requested and the flag stays false.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** The files the reader cannot work without (the same list engine-ppocr.js checks before loading). */
  const FILES = [
    'vendor/hw/ort.wasm.min.mjs',
    'vendor/hw/ort-wasm-simd-threaded.jsep.mjs',
    'vendor/hw/ort-wasm-simd-threaded.jsep.wasm',
    'vendor/hw/models/ppocr-v5/det.onnx',
    'vendor/hw/models/ppocr-v5/rec.onnx',
    'vendor/hw/models/ppocr-v5/vocab.json',
  ];
  const NOT_INSTALLED = 'The page reader is not installed (run tools/fetch-handwriting-model.py --ppocr-only)';
  const NO_BROWSER = 'Reading scanned pages needs a browser';

  /**
   * @param {function(string, object):Promise<{ok:boolean}>} fetchFn
   * @param {string} baseUrl the app's folder, ending with '/'
   * @returns {Promise<{available:boolean, reason:string}>} never rejects
   */
  async function check(fetchFn, baseUrl) {
    for (const file of FILES) {
      let found = false;
      try {
        const res = await fetchFn(new URL(file, baseUrl).href, { method: 'HEAD' });
        found = !!(res && res.ok);
      } catch (_err) {
        found = false; // offline, blocked, or opened straight from disk
      }
      if (!found) return { available: false, reason: `${NOT_INSTALLED}: ${file} is missing` };
    }
    return { available: true, reason: '' };
  }

  /** The app's folder in a browser page, or '' anywhere else. */
  function pageBase() {
    const doc = root.document;
    const canAsk = doc && typeof root.fetch === 'function' && typeof root.Worker === 'function';
    return canAsk ? String(doc.baseURI || (root.location && root.location.href) || '') : '';
  }

  const state = { ready: null, available: false, reason: NO_BROWSER, check, FILES };
  PDFStudy.ENABLE_HANDWRITING = false;
  PDFStudy.hwAvailability = state;

  const base = pageBase();
  const pending = base ? check((url, init) => root.fetch(url, init), base) : Promise.resolve({ available: false, reason: NO_BROWSER });
  state.ready = pending.then((result) => {
    state.available = result.available;
    state.reason = result.reason;
    PDFStudy.ENABLE_HANDWRITING = result.available;
    return state;
  });

  /**
   * Resolves once the check has finished, or after `ms` when it is slow (a file opened in the first moments
   * of the page must not hang on it). Callers that read ENABLE_HANDWRITING right after loading await this.
   */
  state.settled = (ms) => Promise.race([state.ready, new Promise((resolve) => setTimeout(resolve, ms))]).then(() => state);

  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwAvailability;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

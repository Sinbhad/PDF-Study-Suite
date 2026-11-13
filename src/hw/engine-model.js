/**
 * Handwriting model engine: Transformers.js 3.8.1 + Xenova/trocr-small-handwritten on WASM (one thread), all from
 * vendor/hw/ on the app's own origin. Full-precision encoder + 8-bit decoder (measured clearly more accurate
 * than all 8-bit, somewhat slower on one thread); an older install with only the 8-bit encoder still loads, all 8-bit. Each crop is stretched to
 * the model's 384x384 input here (engine-util.js prepareCrop), so the library does not resize again.
 * Checked against the real files in a real browser with tools/smoke-handwriting.js (docs/HANDWRITING.md
 * sections 8-9). When the files are absent, or anything fails while loading, load() reports
 * { available: false, reason } and the app falls back to typing the text in.
 * Worker usage: importScripts('engine-util.js', 'engine-model.js'). Loads in Node without touching worker globals.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const NOT_INSTALLED = 'Handwriting model files are not installed (run tools/fetch-handwriting-model.py)';
  const BUNDLE = 'vendor/hw/transformers.min.mjs';
  const MODEL_ID = 'trocr-small-handwritten';
  const MODEL_DIR = `vendor/hw/models/${MODEL_ID}/`;
  const PROBES = [BUNDLE, MODEL_DIR + 'config.json', MODEL_DIR + 'onnx/decoder_model_merged_quantized.onnx'];
  /** Encoder files in order of preference, with the dtype that makes the library load that file. */
  const ENCODERS = [['onnx/encoder_model.onnx', 'fp32'], ['onnx/encoder_model_quantized.onnx', 'q8']];
  /** Token cap per line: a full-width handwritten line is usually 20-50 tokens and rarely passes 64. */
  const MAX_NEW_TOKENS = 96;

  const util = () => PDFStudy.hwEngineUtil || require('./engine-util.js');
  const msgOf = (e) => String((e && e.message) || e);

  /** App root (ends with '/'): the worker lives at <root>/src/hw/hw-worker.js. '' when there is no location. */
  function defaultBaseUrl() {
    try {
      return new URL('../../', root.location.href).href;
    } catch (_e) {
      return '';
    }
  }

  /**
   * Network guard: wrap scope.fetch so any request to another origin rejects, even if the library falls back
   * to a CDN default. data: and blob: URLs stay local to the device and pass. Installed once, worker only.
   */
  function guardFetch(scope) {
    if (!scope || typeof scope.fetch !== 'function' || !scope.location || scope.__hwFetchGuard) return;
    const real = scope.fetch.bind(scope);
    scope.fetch = function (input, init) {
      try {
        const raw = typeof input === 'string' ? input : (input && input.url) || String(input);
        const u = new URL(raw, scope.location.href);
        const local = u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === scope.location.origin;
        if (!local) return Promise.reject(new TypeError('Blocked cross-origin request: ' + u.origin));
      } catch (e) {
        return Promise.reject(new TypeError('Blocked unparsable request: ' + msgOf(e)));
      }
      return real(input, init);
    };
    scope.__hwFetchGuard = true;
  }

  /** Softmax max-probability of the first row of a logits Tensor-like ({data, dims}); null if unreadable. */
  function maxSoftmax(logits) {
    const data = logits && logits.data;
    if (!data || !data.length) return null;
    const dims = logits.dims;
    const vocab = Array.isArray(dims) && dims.length ? dims[dims.length - 1] : data.length;
    const n = Math.min(vocab > 0 ? vocab : data.length, data.length);
    let max = -Infinity;
    for (let i = 0; i < n; i++) if (data[i] > max) max = data[i];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.exp(data[i] - max);
    return sum > 0 && isFinite(sum) ? 1 / sum : null;
  }

  /** Recording "logits processor": passes logits through unchanged, stores max p per step in `probs`. */
  function makeRecorder(probs) {
    const fn = function (_inputIds, logits) {
      try {
        const p = maxSoftmax(logits);
        if (p != null) probs.push(p);
      } catch (_e) {
        // recording is best effort
      }
      return logits;
    };
    return fn;
  }

  function create(opts) {
    const o = opts || {};
    const importModule = o.importModule || ((url) => import(url));
    const baseUrl = o.baseUrl != null ? o.baseUrl : defaultBaseUrl();
    const fetchFn = o.fetchFn || ((u, init) => root.fetch(u, init));
    let loading = null;
    let T = null;
    let pipe = null;

    async function exists(rel) {
      try {
        const res = await fetchFn(new URL(rel, baseUrl).href, { method: 'HEAD' });
        return !!(res && res.ok);
      } catch (_e) {
        return false;
      }
    }

    /** dtype for the encoder file that is installed, or null when a required file is missing. */
    async function probe() {
      for (const rel of PROBES) if (!(await exists(rel))) return null;
      for (const [file, dtype] of ENCODERS) if (await exists(MODEL_DIR + file)) return dtype;
      return null;
    }

    function configureEnv(env) {
      const root0 = new URL(baseUrl);
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.localModelPath = new URL('vendor/hw/models/', root0).pathname;
      env.useBrowserCache = false;
      env.backends = env.backends || {};
      env.backends.onnx = env.backends.onnx || {};
      const wasm = (env.backends.onnx.wasm = env.backends.onnx.wasm || {});
      wasm.wasmPaths = new URL('vendor/hw/', root0).href;
      wasm.numThreads = 1;
      wasm.proxy = false;
    }

    async function doLoad(onProgress) {
      try {
        guardFetch(root);
        const encoder = baseUrl ? await probe() : null;
        if (!encoder) return { available: false, reason: NOT_INSTALLED };
        T = await importModule(new URL(BUNDLE, baseUrl).href);
        if (!T || typeof T.pipeline !== 'function' || !T.env) throw new Error('Unexpected Transformers.js module shape');
        configureEnv(T.env);
        pipe = await T.pipeline('image-to-text', MODEL_ID, {
          device: 'wasm',
          dtype: { encoder_model: encoder, decoder_model_merged: 'q8' },
          progress_callback: (d) => {
            if (d && typeof d.loaded === 'number' && typeof d.total === 'number' && typeof onProgress === 'function') {
              try {
                onProgress({ loaded: d.loaded, total: d.total, file: d.file || d.name || '' });
              } catch (_e) {
                // never let a listener break loading
              }
            }
          },
        });
        return { available: true, reason: '', encoder };
      } catch (err) {
        pipe = null;
        return { available: false, reason: msgOf(err) };
      }
    }

    /** Run the pipeline with the recording processor; returns the text and one probability per token. */
    async function generate(image) {
      const probs = [];
      const out = await pipe(image, { max_new_tokens: MAX_NEW_TOKENS, logits_processor: [makeRecorder(probs)] });
      const first = Array.isArray(out) ? out[0] : out;
      // The model was trained on transcripts with a space before punctuation ("at c ."): close it up
      const text = String((first && first.generated_text) || '').trim().replace(/\s+([,.;:!?])/g, '$1');
      return { text, probs };
    }

    return {
      name: 'trocr-small-handwritten',
      /** @returns {Promise<{available:boolean, reason:string}>} idempotent, never rejects */
      load(onProgress) {
        if (!loading) loading = doLoad(onProgress);
        return loading;
      },
      /**
       * stats: geometric-mean (mean) and weakest (min) token probability and the token count, for calibration.
       * @returns {Promise<{text:string, confidence:number, kind:string, stats:{min:number, mean:number, tokens:number}}>}
       * never rejects
       */
      async recognise(crop, kind) {
        const asKind = 'text'; // no math model: math regions are read as text and flagged
        const none = { text: '', confidence: 0, kind: asKind, stats: { min: 0, mean: 0, tokens: 0 } };
        try {
          const u = util();
          const p = pipe && T && T.RawImage ? u.prepareCrop(crop) : null;
          if (!p) return none;
          const image = new T.RawImage(u.grayToRgb(p.data, p.w, p.h), p.w, p.h, 3);
          const { text, probs } = await generate(image);
          const c = u.lineConfidence(probs, text);
          // A math-looking region stays flagged unless what was read is plainly ordinary words
          const conf = kind === 'math' && !u.proseLike(text) ? Math.min(c.confidence, 0.3) : c.confidence;
          return { text, confidence: text ? conf : 0, kind: asKind, stats: { min: c.min, mean: c.mean, tokens: c.tokens } };
        } catch (_err) {
          return none;
        }
      },
    };
  }

  PDFStudy.hwModelEngine = Object.assign(create(), { create, guardFetch, maxSoftmax, MAX_NEW_TOKENS });
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwModelEngine;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

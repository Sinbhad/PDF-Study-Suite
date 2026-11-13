/**
 * Second handwriting/print engine: PP-OCRv5 mobile (text detection + English recognition, ONNX) run with
 * onnxruntime-web on WASM (one thread), all from vendor/hw/ on the app's own origin. It reads whole tiles of a page
 * (detect the text lines, then read each) and single line crops from page-prep. Fast (milliseconds per line) and
 * very accurate on typeset print; also reads neat handwriting in coloured inks.
 * When the files are absent, or anything fails while loading, load() reports { available: false, reason }.
 * Worker usage: importScripts('ppocr-prep.js', 'ppocr-boxes.js', 'ppocr-ctc.js', 'engine-ppocr.js').
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const NOT_INSTALLED = 'PP-OCR model files are not installed (run tools/fetch-handwriting-model.py)';
  const LOADER = 'vendor/hw/ort.wasm.min.mjs';
  const WASM_MJS = 'vendor/hw/ort-wasm-simd-threaded.jsep.mjs';
  const WASM_BIN = 'vendor/hw/ort-wasm-simd-threaded.jsep.wasm';
  const DIR = 'vendor/hw/models/ppocr-v5/';
  const PROBES = [LOADER, WASM_MJS, WASM_BIN, DIR + 'det.onnx', DIR + 'rec.onnx', DIR + 'vocab.json'];
  /** Detection runs on a copy scaled so text lines are about this tall (the size the detector handles best). */
  const DET_LINE = 24;
  /** Largest detection window side; bigger images are read in overlapping windows. */
  const DET_CAP = 1600;
  const DET_OVERLAP = 128;

  const need = (name, file) => PDFStudy[name] || require(file);
  const prep = () => need('hwPpocrPrep', './ppocr-prep.js');
  const boxes = () => need('hwPpocrBoxes', './ppocr-boxes.js');
  const ctc = () => need('hwPpocrCtc', './ppocr-ctc.js');
  const raster = () => need('hwRaster', './raster.js');
  const msgOf = (e) => String((e && e.message) || e);

  function defaultBaseUrl() {
    try {
      return new URL('../../', root.location.href).href;
    } catch (_e) {
      return '';
    }
  }

  function create(opts) {
    const o = opts || {};
    const importModule = o.importModule || ((url) => import(url));
    const baseUrl = o.baseUrl != null ? o.baseUrl : defaultBaseUrl();
    const fetchFn = o.fetchFn || ((u, init) => root.fetch(u, init));
    let loading = null;
    let ort = null;
    let det = null;
    let rec = null;
    let vocab = null;
    const url = (rel) => new URL(rel, baseUrl).href;

    async function exists(rel) {
      try {
        const res = await fetchFn(url(rel), { method: 'HEAD' });
        return !!(res && res.ok);
      } catch (_e) {
        return false;
      }
    }

    async function bytes(rel) {
      const res = await fetchFn(url(rel));
      if (!res || !res.ok) throw new Error('Could not read ' + rel);
      return new Uint8Array(await res.arrayBuffer());
    }

    async function doLoad(onProgress) {
      try {
        const guard = PDFStudy.hwModelEngine && PDFStudy.hwModelEngine.guardFetch;
        if (guard) guard(root);
        if (!baseUrl) return { available: false, reason: NOT_INSTALLED };
        for (const rel of PROBES) if (!(await exists(rel))) return { available: false, reason: NOT_INSTALLED };
        const tell = (loaded, file) => {
          try {
            if (typeof onProgress === 'function') onProgress({ loaded, total: 3, file });
          } catch (_e) {
            // never let a listener break loading
          }
        };
        ort = await importModule(url(LOADER));
        if (!ort || !ort.InferenceSession || !ort.Tensor || !ort.env) throw new Error('Unexpected onnxruntime-web module shape');
        ort.env.logLevel = 'error';
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.proxy = false;
        ort.env.wasm.wasmPaths = { mjs: url(WASM_MJS), wasm: url(WASM_BIN) };
        const res = await fetchFn(url(DIR + 'vocab.json'));
        vocab = res && res.ok ? await res.json() : null;
        if (!Array.isArray(vocab) || vocab.length < 3) throw new Error('PP-OCR vocabulary is unreadable');
        tell(1, 'vocab.json');
        const so = { executionProviders: ['wasm'], logSeverityLevel: 3 };
        det = await ort.InferenceSession.create(await bytes(DIR + 'det.onnx'), so);
        tell(2, 'det.onnx');
        rec = await ort.InferenceSession.create(await bytes(DIR + 'rec.onnx'), so);
        tell(3, 'rec.onnx');
        return { available: true, reason: '' };
      } catch (err) {
        det = rec = null;
        return { available: false, reason: msgOf(err) };
      }
    }

    /** Probability map of one detection window (image already at detection scale). */
    async function detectWindow(img) {
      const t = prep().detTensor(img);
      const out = await det.run({ [det.inputNames[0]]: new ort.Tensor('float32', t.data, [1, 3, t.H, t.W]) });
      const map = out[det.outputNames[0]].data;
      const prob = new Float32Array(img.w * img.h);
      for (let y = 0; y < img.h; y++) prob.set(map.subarray(y * t.W, y * t.W + img.w), y * img.w);
      return boxes().dbBoxes(prob, img.w, img.h);
    }

    /** Line boxes of a detection-scale image, in its pixels; large images go through overlapping windows. */
    async function detect(img) {
      const B = boxes();
      const found = [];
      for (const win of B.grid(img.w, img.h, DET_CAP, DET_OVERLAP)) {
        const sub = win.w === img.w && win.h === img.h ? img : prep().cropImage(img, { x0: win.x, y0: win.y, x1: win.x + win.w, y1: win.y + win.h });
        found.push(...B.owned(await detectWindow(sub), win));
      }
      return B.order(B.mergeLines(found));
    }

    /** Read one line image ({data,w,h,ch}). */
    async function readLine(img) {
      const t = prep().recTensor(img);
      if (!t) return { text: '', probs: [] };
      const out = await rec.run({ [rec.inputNames[0]]: new ort.Tensor('float32', t.data, [1, 3, prep().REC_H, t.W]) });
      const y = out[rec.outputNames[0]];
      const [, T, C] = y.dims;
      const d = ctc().decode(y.data, T, C, vocab);
      // spaces at either end are not part of the line
      let a = 0;
      let b = d.chars.length;
      while (a < b && !d.chars[a].trim()) a++;
      while (b > a && !d.chars[b - 1].trim()) b--;
      return { text: d.chars.slice(a, b).join(''), probs: d.probs.slice(a, b) };
    }

    function scored(r, tile) {
      const c = ctc().lineConfidence(r.probs, r.text, tile);
      return { text: r.text, confidence: c.confidence, stats: { mean: c.mean, min: c.min, chars: c.chars } };
    }

    /**
     * Detect and read every text line of an RGBA tile. lineHeight: expected median line height in tile pixels.
     * @returns {Promise<{lines:{box:{x,y,w,h}, text:string, confidence:number, stats:object}[], cancelled?:boolean, timing?:object}>}
     */
    async function readTile(tile, opts) {
      const o2 = opts || {};
      if (!det || !rec) return { lines: [] };
      const P = prep();
      const { width: w, height: h } = tile;
      const raw = tile.rgba instanceof ArrayBuffer ? new Uint8ClampedArray(tile.rgba) : tile.rgba;
      const clean = P.neutralise(raw, w, h);
      const lh = o2.lineHeight > 0 ? o2.lineHeight : 40;
      const f = Math.max(0.05, Math.min(2, DET_LINE / lh));
      const t0 = Date.now();
      const found = await detect(P.resize(clean, Math.max(8, w * f), Math.max(8, h * f)));
      const t1 = Date.now();
      const lines = [];
      // lines are read from the full-resolution tile as darkest-channel gray (pale purple, pink and orange pens
      // read as surely as black; measured better than colour), each cut clear of its neighbours' overlapping rows
      const gray = { data: raster().inkGray(clean.data, w, h), w, h, ch: 1 };
      for (const b of boxes().clipNeighbours(found)) {
        if (typeof o2.shouldStop === 'function' && o2.shouldStop()) return { lines, cancelled: true };
        const box = { x0: Math.max(0, b.x0 / f), y0: Math.max(0, b.y0 / f), x1: Math.min(w, b.x1 / f), y1: Math.min(h, b.y1 / f) };
        const crop = P.cropImage(gray, box);
        if (crop.w < 8 || crop.h < 8) continue;
        const r = scored(await readLine(crop), true);
        if (!r.text) continue;
        const x = Math.floor(box.x0);
        const y = Math.floor(box.y0);
        lines.push({ box: { x, y, w: Math.ceil(box.x1) - x, h: Math.ceil(box.y1) - y }, text: r.text, confidence: r.confidence, stats: r.stats });
      }
      return { lines, timing: { det: t1 - t0, rec: Date.now() - t1 } };
    }

    return {
      name: 'ppocr-v5',
      /** @returns {Promise<{available:boolean, reason:string}>} idempotent, never rejects */
      load(onProgress) {
        if (!loading) loading = doLoad(onProgress);
        return loading;
      },
      readTile,
      /**
       * Read one soft-gray line crop from page-prep (same contract as hwModelEngine.recognise).
       * @returns {Promise<{text:string, confidence:number, kind:string, stats:{mean:number, min:number, chars:number}}>} never rejects
       */
      async recognise(crop, _kind) {
        const none = { text: '', confidence: 0, kind: 'text', stats: { mean: 0, min: 0, chars: 0 } };
        try {
          if (!rec || !crop || !crop.data || crop.w < 2 || crop.h < 2 || crop.data.length < crop.w * crop.h) return none;
          const r = scored(await readLine(prep().fromGray(crop)));
          return r.text ? { text: r.text, confidence: r.confidence, kind: 'text', stats: r.stats } : none;
        } catch (_err) {
          return none;
        }
      },
    };
  }

  PDFStudy.hwPpocrEngine = Object.assign(create(), { create, DET_LINE, DET_CAP });
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwPpocrEngine;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

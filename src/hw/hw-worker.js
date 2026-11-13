/**
 * Classic Web Worker shell for handwriting recognition. All logic lives in the importScripts modules.
 * Paths are relative to this file. If the model engine cannot load (its files under vendor/hw/ are not
 * installed, or the browser is too old) the null engine takes over: regions come back empty to type in.
 * The PP-OCR engine (printed pages, tiles, second opinions) loads on first use; without it those paths fall back.
 */
importScripts('raster.js', 'page-flatten.js', 'rule-strip.js', 'clean.js', 'segmenter.js', 'line-split.js', 'islands.js', 'slant-split.js', 'columns.js', 'print-detect.js', 'page-prep.js', 'null-engine.js', 'hw-worker-core.js');

(function () {
  const PDFStudy = self.PDFStudy;
  try {
    importScripts('engine-util.js', 'engine-model.js');
  } catch (_err) {
    // very old browser (no dynamic import()): the type-it-in engine below still works
  }
  try {
    importScripts('ppocr-prep.js', 'ppocr-boxes.js', 'ppocr-ctc.js', 'engine-ppocr.js');
  } catch (_err) {
    // no PP-OCR engine: printed pages and tiles fall back to the handwriting model or typing in
  }
  const model = PDFStudy.hwModelEngine;
  const nul = PDFStudy.hwNullEngine;
  // Model engine first; when it reports available:false at init, switch to the null engine
  // (core then marks every region source 'manual'). The reason string is kept for the UI.
  let engine = model || nul;
  const switching = {
    get name() { return engine.name; },
    load(onProgress) {
      if (!model) return nul.load();
      return model.load(onProgress).then((r) => {
        if (r && r.available) return r;
        engine = nul;
        return { available: false, reason: (r && r.reason) || nul.name };
      });
    },
    recognise: (crop, kind) => engine.recognise(crop, kind),
  };
  const core = PDFStudy.hwWorkerCore.createHandler({
    engine: switching,
    post: (m) => self.postMessage(m),
    raster: PDFStudy.hwRaster,
    segmenter: PDFStudy.hwSegmenter,
    canvasEngine: PDFStudy.hwPpocrEngine || null,
  });
  self.onmessage = (e) => { core.handle(e.data); };
})();

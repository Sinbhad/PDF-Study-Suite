# Handwriting recognition: research and decisions

Written 2026-11-12. Read pages only; nothing was downloaded or run. Every fact has a
URL. "Not published" means no primary source gives the number; "ESTIMATE" marks my reasoning, never a measurement.
"Not verified" means I could not read the primary page (reason given).

**As built:** this document is the research record. Where the code differs, the code wins: the runtime bundle is stored as
`vendor/hw/transformers.min.mjs` (it is an ES module); the fetch script also saves the licence files and the model
card; recognition runs on one thread and `app.py` sends no COOP/COEP headers; math-looking pieces are read with the
text model and always flagged; small JSON files are verified by git blob SHA-1.
Section 8 records what was checked with the real model; it settles R3 and R4 and replaces the confidence
proposal in 5.7. Sections 9 to 11 record what changed after measuring on real lines (model files, crop
preparation, confidence, line finding, print and columns); where they differ from earlier sections, they win.
Section 12 adds a second recogniser (PP-OCRv5) and the reading of canvas pages.

## 1. How GoodNotes exports

Note: `support.goodnotes.com` answered HTTP 403 to every direct fetch. The GoodNotes facts below come from a
search-engine summary of those official pages (URLs listed), plus one page I could read on GoodNotes' own feedback
forum. Re-read the official pages before shipping user-facing text.

| Fact | Source |
| ---- | ------ |
| Three export formats: the GoodNotes document file (opens only in GoodNotes), PDF, and Image | https://support.goodnotes.com/hc/en-us/articles/7353742824975-Export-documents-or-pages (summary) |
| Export dialog: filename, page range, file quality (Best / Medium / Lowest), PDF Data Format (Flattened or Editable); options Include Annotation, Include Sticky Notes, Include Page Background, Export Images as Zip File | same page (summary); https://support.goodnotes.com/hc/en-us/articles/360000629576-No-annotations-or-backgrounds-show-up-when-I-export-a-document-as-PDF (summary) |
| Editable PDF: images, text boxes, handwriting, highlighting are separate objects that other PDF editors can select/move; outlines and links kept; **handwriting is not searchable** | https://support.goodnotes.com/hc/en-us/articles/8537070839183-Choose-Between-Editable-and-Flattened-PDF-Export (summary) |
| Flattened PDF: smaller, widest viewer support; handwriting is searchable **only if** "Enable Handwriting Recognition" is ticked at export; outlines/links dropped | same page (summary) |
| GoodNotes does not add OCR to an imported image-only PDF | same (summary) |
| Vector vs raster: iPad (Apple) PDF export is vector; Windows/Android PDF export is rasterised. Whether flattened ink stays vector is an unanswered user question | https://feedback.goodnotes.com/forums/950440-customer-suggestions-for-goodnotes-android-windo/suggestions/50894471-export-to-pdf-using-vector-format |

Not documented in anything I could read: page size of exports (follows the notebook page; assume nothing),
paper-template/background rendering (appears as a page background layer that can be switched off with Include Page
Background), how typed text boxes are stored in a flattened PDF, and PNG/JPG pixel dimensions.

What the app must assume (all consistent with `ink-detect`):
- Handwriting may arrive as vector path operators (iPad) or as raster images (Windows/Android/flattened). We render
  every page to pixels, so both work; `inkDetect` already counts path and image ops.
- A flattened PDF exported with "Enable Handwriting Recognition" may carry a hidden text layer. Then pages report
  `has-text` and are never sent to our recogniser. That is fine and cheaper, but the text is GoodNotes' guess and its
  quality is not published. An editable PDF has no text layer for ink, so it reaches our recogniser.
- Paper rules, grids and dotted templates are drawn as paths or an image and will look like ink to `inkDetect` and to
  binarisation. The segmenter must tolerate long thin horizontal/vertical lines (remove them before line-splitting).
  Advise users in the UI: export with Include Page Background off when possible (option name from the source above).
- Typed text boxes in a flattened PDF are probably real text (not verified); in that case the page has text.

## 2. Recognisers that can run in a browser offline

Sizes are bytes from the Hugging Face file API at the commit named in section 6 (`/api/models/<repo>?blobs=true`).

| Option | Licence code / weights | Size on disk (ONNX) | Published accuracy | Input | Runtime needs |
| ------ | ---------------------- | ------------------- | ------------------ | ----- | ------------- |
| **TrOCR-small-handwritten** (62M params, IAM fine-tune) via `Xenova/trocr-small-handwritten` ONNX | Code (unilm repo): MIT https://raw.githubusercontent.com/microsoft/unilm/master/LICENSE. Weights: `microsoft/trocr-small-handwritten` card/API states **no licence** https://huggingface.co/api/models/microsoft/trocr-small-handwritten ; the Xenova ONNX conversion is tagged MIT https://huggingface.co/Xenova/trocr-small-handwritten (see risk R1) | fp32: encoder 87,496,990 + decoder_merged 159,046,668. **q8: encoder 23,082,942 + decoder_merged 40,527,613 = 63,610,555**. fp16: 43,954,313 + 79,946,304 | IAM cased CER **4.22** (62M) https://github.com/microsoft/unilm/tree/master/trocr ; no number published for the q8 ONNX | Single text line; image resized to 384x384, mean/std 0.5 (preprocessor_config.json) | WASM or WebGPU through ONNX Runtime Web |
| TrOCR-base-handwritten via `Xenova/trocr-base-handwritten` | as above (repo has no licence field https://huggingface.co/api/models/Xenova/trocr-base-handwritten) | q8: encoder 88,082,928 + decoder_merged 249,597,124 = 337,680,052; fp32 344,487,712 + 990,095,138 | IAM cased CER **3.42** (334M) same unilm URL | Line | same; about 5x the download for 0.8 CER points, rejected |
| **Tesseract.js 7.0.0** (Apache-2.0 code; traineddata Apache-2.0) | Apache-2.0 https://registry.npmjs.org/tesseract.js/latest ; https://github.com/tesseract-ocr/tessdata_fast | package 1,411,341 bytes unpacked (registry); core + traineddata sizes not read | The FAQ says handwriting is **not supported**: "No combination of options will significantly improve performance with handwritten text" https://github.com/naptha/tesseract.js/blob/master/docs/faq.md | Page or line | WASM; downloads traineddata by default (needs local langPath, not documented in the FAQ) |
| **pix2text-mfr** (formula image to LaTeX, TrOCR architecture) | MIT code and weights https://huggingface.co/breezedeus/pix2text-mfr | **fp32 only**: encoder_model.onnx 87,496,990 + decoder_model.onnx 30,114,937 (no quantised, no merged decoder, files at repo root not `onnx/`) | CER only in a chart image, no numbers; test set 485 images; no handwriting-specific figure; card shows handwritten examples | Pure formula image only; needs a formula detector for mixed images | Not directly loadable by Transformers.js layout; needs re-export (see R5) |
| **pix2text-mfr-1.5** | MIT https://huggingface.co/breezedeus/pix2text-mfr-1.5 | encoder 87,510,770 + decoder 32,026,253, fp32 only | Chart only, not published as numbers; handwriting not claimed | same | same |
| LaTeX-OCR (pix2tex) | Code MIT; **weights licence not stated** https://github.com/lukas-blecher/LaTeX-OCR | not stated; no ONNX mention | BLEU 0.88, edit distance 0.10, token accuracy 0.60 on an unnamed test set; handwriting listed as "kinda done" | Formula image | Not browser-ready. Dropped |
| Texify | Code **GPL-3.0** (copyleft), weights CC BY-SA 4.0 (share-alike) https://github.com/VikParuchuri/texify | not read | no handwriting claim; repo archived/deprecated | Formula | Dropped: copyleft, deprecated |
| Models trained on Google MathWriting | Dataset is **CC BY-NC-SA 4.0** (non-commercial) and the repo publishes no weights https://github.com/google-research/google-research/tree/master/mathwriting ; paper https://arxiv.org/abs/2404.10690 (230k human + 400k synthetic samples, online ink first) | n/a | paper baselines (CTC Transformer, PaLI) have no numbers on the abstract page | Ink strokes (online) | Dropped: no weights, NC data |
| CROHME-trained models | No official weights found in the sources I read | n/a | n/a | n/a | Not found, not used |

Paper licence trap: the TrOCR arXiv page shows CC BY-NC-SA for the *article* https://arxiv.org/abs/2109.10282 ;
that is the paper text, not the model weights, but it is a reason to resolve R1.

Runtimes:

| Runtime | Licence | Notes |
| ------- | ------- | ----- |
| `@huggingface/transformers` | Apache-2.0 https://registry.npmjs.org/@huggingface/transformers/3.8.1 | Latest is 4.3.2, `next` is 4.4.0-next.0 https://registry.npmjs.org/-/package/@huggingface/transformers/dist-tags . 3.8.1 is the last 3.x tag (2025-12-02) https://github.com/huggingface/transformers.js/tags |
| `onnxruntime-web` | MIT https://registry.npmjs.org/onnxruntime-web/1.22.0-dev.20250409-89f8206ba4 | Dependency of Transformers.js 3.8.1, pinned exactly |
| Provider binaries | | `ort-wasm-simd-threaded.wasm` (SIMD + threads; default), `ort-wasm-simd-threaded.jsep.wasm` (WebGPU/WebNN) https://onnxruntime.ai/docs/tutorials/web/deploy.html |

## 3. Speed

No primary source publishes TrOCR-small latency in a browser, per line or per page: **not published**.
ESTIMATES (mine, unmeasured; to be replaced by a measurement with the real files):
- The encoder sees 384x384 / 16x16 = 576 patches (patch size from the model card
  https://huggingface.co/microsoft/trocr-small-handwritten ; 384 from preprocessor_config.json). I assume about 15
  GFLOPs for the small DeiT encoder at that size, plus a small decoder run once per generated token (a line is about
  10 to 30 tokens, greedy, KV cache via the merged decoder).
- Laptop, WASM, q8: about 1 to 3 s per line single-threaded, roughly 0.5 to 1.5 s with 4 threads. A 30-line page is
  therefore about 30 to 90 s single-threaded.
- Phone, WASM, q8: about 3 to 10 s per line (ESTIMATE), a page can take minutes. Progress and Cancel are mandatory
  (already in the design). Model load from local disk (63.6 MB for q8; 128 MB for the stack chosen in section 9)
  is a one-off.
- Threads: ONNX Runtime uses multi-threading "Only when the browser supports WebAssembly multi-threading and
  `crossOriginIsolated` mode is enabled", default `numThreads` 0 = auto
  https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html . Cross-origin isolation needs
  `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (or `credentialless`)
  https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated . Our app is served by `app.py`, which
  can send those two headers (`app.py`); GitHub Pages cannot set custom headers (stated in the project brief, not
  verified here). Without isolation the library runs single-threaded; nothing breaks.
  With COEP `require-corp` every sub-resource must be same-origin or opt in: we are all same-origin, fine.
- WebGPU: opt-in with `device: 'webgpu'`; "WebGPU support is around 85%" (March 2026) and still experimental outside
  Chromium https://huggingface.co/docs/transformers.js/en/guides/webgpu . The proxy worker cannot be used with the
  WebGPU provider (ORT env flags page above). Default to WASM; WebGPU is an optional speed-up needing the `.jsep`
  binary and the fp32/fp16 files (q8 is the WASM default, https://huggingface.co/docs/transformers.js/en/index).

## 4. Recommended stack

- **Text recogniser:** TrOCR-small-handwritten, Xenova ONNX conversion, revision `02bea33c...` (section 6), dtype
  `{ encoder_model: 'fp32', decoder_model_merged: 'q8' }` (encoder 87.5 MB + merged decoder 40.5 MB, about 128 MB).
  This was `q8` throughout (encoder 23.1 MB) until it was measured on real lines (section 9); an install that only
  has the 8-bit encoder still loads, all 8-bit.
- **Runtime:** `@huggingface/transformers` **3.8.1** (not 4.3.2) with its pinned `onnxruntime-web`
  1.22.0-dev.20250409-89f8206ba4, WASM provider, in a dedicated Web Worker.
- **Optional math recogniser:** `breezedeus/pix2text-mfr` (MIT), but **not shippable as-is**: fp32 only (117.6 MB)
  and in the wrong file layout. Ship the app with the math engine disabled (math regions fall back to the review
  panel). A later task may re-export it with Optimum (the Transformers.js docs recommend Optimum
  https://huggingface.co/docs/transformers.js/en/custom_usage ). Handwritten-math accuracy is not published.

Hypothesis check:
- **Confirmed:** Transformers.js `image-to-text` + TrOCR-small-handwritten is the documented example
  (`pipeline('image-to-text', 'Xenova/trocr-small-handwritten')`)
  https://huggingface.co/docs/transformers.js/en/api/pipelines . Quantised ONNX files exist.
- **Overturned (version):** "v3" is no longer the latest; `latest` is 4.3.2. I still pin 3.8.1 because I could
  verify its build outputs file by file (ESM only, which files, section 5). For 4.3.2 I could not confirm the list of
  files in `dist` (build script not readable), and it depends on an `onnxruntime-web` dev build whose wasm is the
  `.asyncify` variant (https://github.com/huggingface/transformers.js/blob/4.3.2/packages/transformers/src/backends/onnx.js).
  Re-evaluate 4.x later.
- **Overturned (confidence):** the hypothesis implied a score is available. In 3.8.1 it is not (section 5.7).
- **Limits:** line-level model (we segment lines ourselves); trained on IAM (English, cursive/print, a fixed
  database of writers) https://huggingface.co/microsoft/trocr-small-handwritten ; 62M-param small model has the
  worst published CER of the three sizes (4.22 vs 2.89 for large); no accuracy figure exists for the q8 file; math
  is a separate, weaker problem; the 384x384 resize squashes a wide line. That squash turned out to be what the
  model expects: padding the crop made it much worse (section 9).

## 5. Integration notes for implementation

### 5.1 Package, pin and bundle format
- Package `@huggingface/transformers` **3.8.1**, tarball `https://registry.npmjs.org/@huggingface/transformers/-/transformers-3.8.1.tgz`,
  379 files, 48,306,100 bytes unpacked, depends on `onnxruntime-web` 1.22.0-dev.20250409-89f8206ba4
  https://registry.npmjs.org/@huggingface/transformers/3.8.1 .
- Build outputs (webpack config at 3.8.1): `transformers.js` / `transformers.min.js` (bundled, ONNX Runtime Web
  **inside** the bundle), `transformers.web.js` (ort is an **external** import, do not use), node builds. All browser
  builds are ES modules (`type: "module"`, `outputModule`). A post-build step deletes `dist/ort.bundle.min.mjs` and
  copies `ort-wasm-simd-threaded.jsep.mjs` from onnxruntime-web into `dist`
  https://raw.githubusercontent.com/huggingface/transformers.js/3.8.1/webpack.config.js .
- Files to serve (put under `vendor/hw/`): `transformers.min.js` (take the non-min `transformers.js` if the min is
  absent), `ort-wasm-simd-threaded.jsep.mjs` (both from the transformers tarball `package/dist/`), and
  `ort-wasm-simd-threaded.jsep.wasm` from the **onnxruntime-web** tarball `package/dist/` (same build; ORT warns a
  mismatched bundle/wasm pair fails to initialise, https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html ).
  The default wasmPaths in 3.8.1 is `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${env.version}/dist/`
  (https://github.com/huggingface/transformers.js/blob/3.8.1/src/backends/onnx.js), which implies the wasm is also in the
  transformers `dist/`; the registry does not list tarball members, so the fetch script must look inside the
  tarball and fail if a name is missing (R3). Whether `.wasm` is in the transformers tarball: **not verified**.

### 5.2 Loading in a classic Web Worker
- The bundle is an ES module, so `importScripts('transformers.min.js')` cannot load it ("classic scripts" only)
  https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/importScripts .
- Use dynamic `import()` inside the classic worker: allowed in dedicated and shared workers, rejected in service
  workers https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import . So the worker shell
  keeps `importScripts` for our own IIFE modules and does
  `const T = await import(new URL('../../vendor/hw/transformers.min.js', self.location.href).href);`
  (path example; resolve relative to the worker URL). Alternative: `new Worker(url, { type: 'module' })`, but then
  `importScripts` of our modules breaks; do not mix.
- The `import()` failing (404) must map to `{ available: false, reason }`, never a throw.

### 5.3 Settings to force local files, no network
```js
const { env, pipeline } = T;
env.allowRemoteModels = false;   // same as local_files_only=true
env.allowLocalModels = true;     // default is FALSE in browsers
env.localModelPath = '/vendor/hw/models/';   // trailing slash
env.useBrowserCache = false;     // optional: avoid a second copy in Cache API
env.backends.onnx.wasm.wasmPaths = '/vendor/hw/';  // dir holding the .jsep.mjs/.wasm
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
env.backends.onnx.wasm.proxy = false;   // already the 3.8.1 default; we are already in a worker
```
Docs: `allowRemoteModels`, `allowLocalModels` (default false in browser), `localModelPath` (default `/models/`),
`useBrowserCache`, `useWasmCache` https://huggingface.co/docs/transformers.js/en/api/env and the v3 text of
`wasmPaths` https://huggingface.co/docs/transformers.js/en/custom_usage . `numThreads` 0 = auto, 1 = single:
https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html . Those two pages are the v4 docs; the
setting names exist in 3.8.1 source (`wasmPaths`, `proxy` seen in onnx.js) but `allowLocalModels` / `localModelPath`
in 3.8.1 itself was not re-read (R4). Also relevant: any path left unset falls back to the jsDelivr CDN, which would
break the no-network promise, so set `wasmPaths` **before** the first `pipeline()` call.

### 5.4 Directory layout the library expects
`pipeline('image-to-text', 'trocr-small-handwritten', opts)` resolves to
`<localModelPath>/<model id>/<file>` (custom-usage doc above; the model id may contain a slash). Use:
```
vendor/hw/models/trocr-small-handwritten/
  config.json  generation_config.json  preprocessor_config.json
  tokenizer.json  tokenizer_config.json  special_tokens_map.json
  onnx/encoder_model.onnx                     (encoder_model_quantized.onnx on older installs)
  onnx/decoder_model_merged_quantized.onnx
```
Files exist at the pinned commit (section 6). Encoder-decoder models use two sessions, `encoder_model` and
`decoder_model_merged` (3.8.1 `models.js` excerpts; the exact `VisionEncoderDecoderModel` registration line was
beyond the readable part, R4). `sentencepiece.bpe.model` (1.36 MB) is in the repo, but the tokenizer is built from
`tokenizer.json` + `tokenizer_config.json` (`XLMRobertaTokenizer` class); skip the sentencepiece file (not verified
that nothing requests it; if a 404 appears add it).

### 5.5 Selecting the model files per session
`dtype: 'q8'` selects the 8-bit variants; q8 is the WASM default
https://huggingface.co/docs/transformers.js/en/guides/dtypes . The `quantized: true` option is the pre-v3 equivalent
(same page). Per-session override: `dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' }`, keyed by the
session file name. Read in the 3.8.1 bundle: the dtype object is looked up by file name, `fp32` adds no suffix and
`q8` adds `_quantized`, so this loads `onnx/encoder_model.onnx` and `onnx/decoder_model_merged_quantized.onnx`.
Quantisation can hurt encoder-decoder models ("extremely sensitive", same page); on this model the 8-bit encoder
cost about 3 CER points on real lines (section 9), so the app uses the full-precision encoder. The engine checks
which encoder file is installed (HEAD request) and falls back to all-`q8` when only `encoder_model_quantized.onnx`
is there.

### 5.6 Passing a raw pixel buffer
`new RawImage(data, width, height, channels)` takes `Uint8ClampedArray | Uint8Array`, channels 1/2/3/4
https://huggingface.co/docs/transformers.js/en/api/utils/image . `ImageToTextPipeline` accepts `RawImage`
(`ImageInput` type, pipelines doc above). Recommended: build a 3-channel buffer from the gray crop (replicate gray,
`new RawImage(rgb, w, h, 3)`) or `new RawImage(gray, w, h, 1).rgb()`. Preprocessing is `resize 384x384, rescale 1/255,
mean/std 0.5` (preprocessor_config.json at the pinned commit: `size` 384x384, `resample` 3 = bicubic), so a wide
line is squashed, which is how the model was trained. Do **not** pad to a squarer aspect (section 9). The engine
does the stretch itself (`prepareCrop` in `src/hw/engine-util.js`: a white margin of 4% of the crop height, then area
averaging on a shrinking axis and bicubic on an enlarging one, in plain JS so Node and every browser give the same
pixels) and hands over a 384x384 image. Read in the 3.8.1 bundle: `RawImage.resize` returns the image unchanged
when the size already matches (in a browser it would otherwise draw through a canvas, ignoring `resample`), and
rescale and normalise still run. Use dark ink on a white background, gray rather than hard black/white.
`const out = await pipe(rawImage, { max_new_tokens: 96 }); out[0].generated_text`.
Decoding defaults to greedy (`num_beams` 1, `do_sample` false)
https://github.com/huggingface/transformers.js/blob/3.8.1/src/generation/configuration_utils.js . The pipeline
signature is `pipe(images, options)` with `options` = generation parameters (pipelines doc above).

### 5.7 Confidence
- In 3.8.1 `generate()` returns only `sequences` (plus `past_key_values`, attentions) when
  `return_dict_in_generate` is set; `output_scores` exists in the config but `scores` is a commented TODO
  https://raw.githubusercontent.com/huggingface/transformers.js/3.8.1/src/models.js . **No per-token score is exposed**
  by the pipeline: `ImageToTextSingle` has only `generated_text` (pipelines doc). 4.x behaviour: not verified.
- Proxy A (recommended): pass a custom logits processor in the generation options (`logits_processor` is documented,
  `LogitsProcessor(input_ids, logits)` with `bigint[][]` and a `Tensor`
  https://huggingface.co/docs/transformers.js/en/api/generation/logits_process ). A recording processor reads the
  softmax of the logits at each step, stores `max p` (greedy chooses the argmax), and returns the logits unchanged.
  Line confidence = e.g. the geometric mean of token probabilities, clamped to [0,1]. Whether the pipeline accepts a
  plain array or needs a `LogitsProcessorList`, and the exact `logits.data` layout, are not verified (R4).
  The result is an uncalibrated heuristic; map it so that `LOW_CONFIDENCE = 0.6` flags a useful share of lines.
- Proxy B (fallback, no library support needed): text heuristics: empty output, fewer than 2 characters,
  character-class noise, a long run of one character, length wildly off the crop width. Combine with A with `min`.

## 6. Files to fetch (for `tools/fetch-handwriting-model.py`)

Hugging Face: `https://huggingface.co/<repo>/resolve/<sha>/<path>`. Repo `Xenova/trocr-small-handwritten`, commit
`02bea33ca09a70e2e2d91140a7e6e1a729606a5b` (head on 2026-10-28; sizes and LFS hashes from
https://huggingface.co/api/models/Xenova/trocr-small-handwritten?blobs=true ). Destination:
`vendor/hw/models/trocr-small-handwritten/<path>`. Licence of the weights: see R1 (save `README.md` beside them).

| File | URL path under the repo | Bytes | sha256 |
| ---- | ----------------------- | ----- | ------ |
| onnx/encoder_model.onnx | `.../resolve/02bea33ca09a70e2e2d91140a7e6e1a729606a5b/onnx/encoder_model.onnx` | 87,496,990 | `f6a2c3ac23a426c85f8557f2763bf39cce7eeacf3004563762e023050ddc1fd9` |
| onnx/decoder_model_merged_quantized.onnx | `.../onnx/decoder_model_merged_quantized.onnx` | 40,527,613 | `51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08` |
| config.json | `.../config.json` | 4,515 | not published (not an LFS file; only the git blob id exists) |
| generation_config.json | `.../generation_config.json` | 185 | not published |
| preprocessor_config.json | `.../preprocessor_config.json` | 465 | not published |
| tokenizer.json | `.../tokenizer.json` | 4,494,727 | not published (not LFS) |
| tokenizer_config.json | `.../tokenizer_config.json` | 471 | not published |
| special_tokens_map.json | `.../special_tokens_map.json` | 279 | not published |
| README.md (licence evidence) | `.../README.md` | 1,505 | not published |

Model files fetched by default: 132,526,750 bytes (the two ONNX files are 128,024,603). Not fetched any more:
`onnx/encoder_model_quantized.onnx` 23,082,942 sha256 `2f29edbd925f8a49c9c7d1349895f960cf09d2efdc76fe23f957048d476e0d03`
(the engine still uses it if it is the only encoder installed). Not used: `onnx/decoder_model_merged.onnx`
159,046,668 sha256 `49fc7f6f988514911b8a8ba11c6443bcf0e541f585c7c8c3093df5e737d3960e`.

For files with no published sha256, the script should (a) pin the commit sha in the URL (an immutable git
revision), (b) check the byte size above, and (c) carry a sha256 that the owner computes once on first review and
commits into the script. The script must not trust a hash it computed itself on the same run.

npm (checksums from the registry JSON; `dist.integrity` is `sha512-<base64>`):

| File | URL | Bytes | Checksum |
| ---- | --- | ----- | -------- |
| transformers-3.8.1.tgz | `https://registry.npmjs.org/@huggingface/transformers/-/transformers-3.8.1.tgz` | not published (unpacked 48,306,100) | shasum `317da003865322396796173223eeaaf0f9723f0a`; integrity `sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA==` |
| onnxruntime-web-1.22.0-dev.20250409-89f8206ba4.tgz | `https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0-dev.20250409-89f8206ba4.tgz` | not published (unpacked 93,349,344, 496 files) | shasum `d1e3a04e03dfee392b41d420ef547b6a0351b06b`; integrity `sha512-0uS76OPgH0hWCPrFKlL8kYVV7ckM7t/36HfbgoFw6Nd0CZVVbQC4PkrR8mBX8LtNUFZO25IQBqV2Hx2ho3FlbQ==` |

Sources of the npm data: https://registry.npmjs.org/@huggingface/transformers/3.8.1 and
https://registry.npmjs.org/onnxruntime-web/1.22.0-dev.20250409-89f8206ba4 . Both tarballs are large (tens of MB);
the script extracts only the three named dist members (5.1) with Python `tarfile`, rejecting any member path that
is absolute or contains `..`, and fails closed if one is absent. Sizes of the extracted `.mjs` / `.wasm` /
`transformers.min.js` members: **not published** (ESTIMATE: wasm in the tens of MB, from the unpacked package sizes
only; do not hard-code, record after the owner's first run).

## 7. Open risks and what was not verified

- **R1 Weights licence is unclear.** `microsoft/trocr-small-handwritten` carries no licence field; the unilm *code*
  is MIT; the Xenova conversion says MIT. The IAM database terms were not checked. The owner should confirm before
  redistributing anything; the fetch script downloads for the owner only and never bundles weights in the repo.
- **R2 GoodNotes pages unreadable** (HTTP 403). Section 1 rests on search summaries of the official pages and one
  forum page. Whether iPad flattened ink is vector, and what handwriting-recognition text layers look like, are
  open. The app does not depend on either.
- **R3 (settled, see section 8)** Exact dist file list of the npm tarballs is not published by the registry**; sizes/hashes of members unknown;
  where `ort-wasm-simd-threaded.jsep.wasm` lives (transformers `dist/` vs onnxruntime-web `dist/`) not verified.
- **R4 (settled, see section 8)** 3.8.1 API details not re-read: `allowLocalModels`/`localModelPath` defaults (read in v4 docs), the
  `VisionEncoderDecoderModel` session registration, `q8` -> `_quantized` suffix mapping, and whether the pipeline
  accepts `logits_processor` as an array. Verify with a manual run of the owner's first fetch before the engine
  adapter relies on them; the engine must return `available: false` on any failure.
- **R5 Math is not shippable yet.** The only MIT formula models found are fp32 and not in Transformers.js layout;
  no handwritten-math CER is published; MathWriting data is NC; GPL/CC-BY-SA texify and unstated-weights pix2tex are
  excluded. Math regions stay manual via the review panel for now.
- **R6 Accuracy is unmeasured here:** IAM CER 4.22 is for the fp32 research model on IAM lines; class-notes
  handwriting, rule-lined paper, mixed ink colours, text on tilt, and q8 quantisation will all be worse. Plan for
  the review panel being used a lot.
- **R7 Speed:** measured on one laptop (section 8), still an estimate for phones. Phone use may be impractically slow for long notebooks.
- **R8 Threads:** `app.py` must send COOP/COEP for multi-threading; this was not tested and GitHub Pages cannot
  (unverified claim from the project brief). Single thread is the safe default.
- **R9 Version drift:** 4.x is current; 3.8.1 pins an `onnxruntime-web` dev build. Both are pinned by checksum.
- Not read: Safari/iOS behaviour of WASM threads and `import()` in workers; memory use of a 128 MB model on phones;
  the TrOCR paper body (only the abstract page and the unilm README table were read).

## 8. Verified with the real files (2026-11-12)

The owner installed the runtime and model under `vendor/hw/` (sizes and hashes match section 6 and the plan). The
lead then ran the real app in headless Edge 157 on a Windows laptop with `tools/smoke-handwriting.js`: real PDF.js
render, real Web Worker, real model, one thread. Nothing below comes from a web page; it is what was observed.

| Open point | Result |
| ---------- | ------ |
| R3: files needed | `transformers.min.mjs` (888,173 bytes), `ort-wasm-simd-threaded.jsep.mjs` (44,484) and `ort-wasm-simd-threaded.jsep.wasm` (21,596,019) are enough. Which tarball the `.wasm` came from was not observed (the fetch script was not run). |
| R4: `env.allowLocalModels`, `env.localModelPath` | Both exist in the 3.8.1 bundle; an absolute path (`/vendor/hw/models/`) works. |
| R4: `wasmPaths`, `numThreads`, `proxy` | Work as set. The bundle defaults `wasmPaths` to a jsDelivr URL when it is unset, so the engine sets it before use and the worker blocks other origins. |
| R4: `dtype: 'q8'` | Loads `onnx/encoder_model_quantized.onnx` and `onnx/decoder_model_merged_quantized.onnx` (only those are on disk). |
| R4: tokenizer | Works from the JSON files; `sentencepiece.bpe.model` is not requested. |
| R4: `RawImage` | A 3-channel `RawImage` built from the gray crop is accepted. |
| R4: `logits_processor` | An array holding a plain function is accepted and is called once per generated token with a tensor `{ data, dims }`. |
| Classic worker + dynamic `import()` | Works in Edge 157 (Chromium). Not tried in Firefox or Safari. |
| Node | The browser bundle does not run the model in Node (`env.backends.onnx.wasm` is undefined there), so the real-model test has to run in a browser. |

Measured on the synthetic page (five lines drawn in the Ink Free font, 44 px body text at 150 dpi; tidier than real
handwriting, so real notes will do worse):

- Text: 4 of 5 lines exact, character error rate 0.5%. The one error: `continuous at c` was read as `continuous at 0`.
  The model also writes a space before punctuation (`Definition :`); the engine closes it up.
- Confidence: the weakest token probability of a line separated right from wrong here: 0.86 to 0.96 for the four
  correct lines, 0.36 for the wrong one (the mean hid it: all five were 0.98 or more). The engine therefore reports
  the weakest token probability. One page is far too little to call this calibrated.
- That same wrong line was also judged "math-looking" by the segmenter (probably the colon), which caps it at 0.3.
  So lines with a colon may be flagged more often than they deserve.
- Speed: about 1.2 s per line once the model is loaded; 7.5 s for the first page of five lines including PDF load
  and model load. Laptop with 16 logical cores, one WASM thread. Phone speed is still an estimate.
- Network: the page made no request to any other origin. Requests made inside the worker were not recorded by the
  test; the worker's own guard rejects other origins.
- The rule-based study pipeline built 3 summary sentences and 2 quiz questions from this page, and no flashcards.
  The title line was joined to the first sentence in the summary.

## 9. Changes after measuring on real lines (2026-11-12)

Measured on 59 hand-cut line images (37 real, 22 synthetic): each line was cut out by hand, so these numbers are
about the recogniser alone, not the line finder. Character error rates (CER) below are on the 37 real lines.

- **Full-precision encoder, 8-bit decoder.** All-`q8` gave 18.7% CER; the fp32 encoder with the q8 decoder gave
  15.8% to 16.2%. The download grows from about 64 MB to about 128 MB of ONNX files. In that test it was also faster
  (128 vs 177 ms per line), but that run used several threads for the fp32 encoder; in the app (one WASM thread,
  headless Edge, synthetic page) it was slower: about 1.6 s per line against about 1.3 s for all-`q8`. One thread
  stays the default (R8).
- **Straight 384x384 stretch instead of aspect padding.** Padding the height so a line was at most 4:1 raised CER
  from 18.7% to 45.5%; padding to a square gave about 100%. The original TrOCR preprocessing stretches the line crop
  straight to 384x384 with smooth resampling, and that is what the engine now does (5.6). Hard black/white input
  cost 2 to 3 CER points against soft gray, so crops stay gray.
- **Confidence is now a blend.** A line whose geometric-mean token probability was under 0.6 had a mean CER of 28%;
  at 0.6 or above, 9%. The engine reports `mean^2 * min^0.1` (`lineConfidence` in `src/hw/engine-util.js`), fitted
  on 263 transcribed real lines from the 20-page test (`docs/HANDWRITING-RESULTS.md`): the mean separates right
  from wrong far better than the weakest token, so the weakest token only nudges the score. Text that looks like a
  decoding loop ("0 0 0 0", "a b c d e f", one word over and over) is capped at 0.1 but kept for the review panel.
  The engine also returns the mean, the weakest probability and the token count so the blend can be re-fitted.
- **Math cap only for text that is not prose.** The layout check calls a region math when it sees a bar with ink
  above and below; underlines and t-bars in ordinary handwriting trigger it (50 of 263 real lines). Such a region
  is capped at 0.3 only when its recognised text does not read as ordinary words (`proseLike`).
- **Unchecked low-confidence pieces no longer feed the study material.** They stay in the review panel; once
  corrected or ticked "Looks right" they count as trusted and go into summaries, flashcards and quizzes.
- **Token cap 96** (was 64): a full-width handwritten line is usually 20 to 50 tokens, rarely more than 64.

On the synthetic smoke page (section 8) the new set read 5 of 5 lines exactly (before: 4 of 5, `at c` read as
`at 0`); the same page with only the 8-bit encoder installed also read 5 of 5, so the stretch made that difference.

## 10. Page clean-up and line finding as built (2026-11-12)

`src/hw/page-prep.js` is the single entry point: `plan(gray, w, h)` returns the final reading-order list of line
boxes and `cropFor(...)` the soft-gray crop for one box. The worker and `tools/eval-handwriting.js` both call it,
so the evaluation always shows what the app really cuts.

- `page-flatten.js`: inverts dark pages, divides out the paper brightness, whitens the background.
- `clean.js`, `rule-strip.js`: threshold for box finding only; remove borders, dark edges, gutters, rules, specks.
- `line-split.js`: recursive cuts on empty rows and wide column gaps, valley cuts for blocks taller than about 1.5
  line pitches.
- `slant-split.js`: a sloped cut, found strip by strip, for two lines with no empty row between them.
- `islands.js`: splits far-apart ink islands (labels on a diagram) and drops drawn circles.
- Crops are gray with the neighbouring lines' ink painted white; the binary image is never sent to the model.

Measured results on 20 English pages, before and after, are in `docs/HANDWRITING-RESULTS.md`.

## 11. Print, columns and tables (2026-11-12)

A page with no selectable text is not always handwriting: it can be a scanned book page, or a handwritten letter
on printed letterhead. Three additions to the page plan deal with that. Measured results are in
`docs/TEXT-EXTRACTION-RESULTS.md`.

- `print-detect.js` tells typeset print from handwriting by shape alone: print is separate letters on a
  ruler-straight baseline that reach one of two heights; handwriting has wide joined strokes, a wandering baseline
  and uneven tops. When most boxes on a page are print the plan is marked `printed`: everything is read and the
  worker allows up to 320 pieces instead of 120 (a dense book page is 60 lines cut in two). Otherwise a run of
  print-like lines at the very top or bottom of the page that includes small print is a letterhead or footer and
  is not read (`plan.letterhead`, `result.letterhead`). A lone print-like title is kept, so a neatly hand-printed
  heading is never dropped. Pages drawn with a handwriting font can count as print; that only lifts the limit.
- `columns.js` sets the reading order. A tall empty band with at least four wide lines on each side is a column
  gutter: the left column is read first, then the right. Titles and full-width paragraphs that cross the gutter
  are read in their own place. Narrow pieces side by side (table cells, a term and its meaning, labels on a
  drawing) stay one line read across. Before this, lines at the same height in two columns were joined into one.
- `rule-strip.js` now follows a rule along its staircase. On a scan turned by a fraction of a degree a ruled line
  is a stack of runs, and only the long ones passed the length test, so table borders left short dashes that
  were read as stray letters. A thin run of 24 px or more lying against an erased run is erased too.
- Short plain lines are no longer treated as math. A piece the layout check calls math-looking was capped at 0.3
  unless its text had three longer words, which held back headings such as "Solving a problem". A line of one
  to three pieces now counts as prose when every piece is an ordinary word ("x", "dx", "2c", "sin x" still fail).
- A bullet dot is read by the model as "#"; a leading "#" before a word is shown as a bullet.

## 12. Canvas pages and a second recogniser (2026-11-13)

A tablet "infinite canvas" or mind-map export is one page with hundreds of short lines in separate islands.
The test document is one landscape page (792 x 612 pt, 66.7 MB, no text, no images, about 214,000 drawn
paths) with about 450 lines of small neat print in eight pen colours; a text line is about 2.9 pt tall. At the
usual 1650 px render that is 6 px per line, the page plan found over 120 pieces, the page was skipped
(`too-many-regions`) and nothing was read.

**Recogniser.** PP-OCRv5 mobile (Apache-2.0): a text detector (`det.onnx`, 4.8 MB) and an English line
recogniser (`rec.onnx`, 7.8 MB, rows 48 px tall of any width, CTC output over 438 characters), run with ONNX
Runtime Web directly (`ort.wasm.min.mjs`, the same build as the wasm file already installed) in the same worker,
one thread. `tools/fetch-handwriting-model.py` installs them (pins in `tools/hw_model_pins.py`; the character
list is `tools/ppocr-v5-vocab.json`). The file name of the two models inside their repositories could not be
checked offline; the SHA-256 decides. Nothing here was downloaded while writing this: the files were already
in `vendor/hw/`.

**How a page is read now** (`src/hw/hw-pipeline.js`):

1. The page is rendered once at 1650 px in colour and surveyed (`canvas-plan.js`): the ink-weighted median
   height of the letter shapes gives the line height; ink islands come from a coarse grid. Small writing
   (lines of 12 px or less, at least 150 shapes, a nearly white page) makes it a canvas page. The 44 sample
   photos and scans measure 25 px or more; the test document measures 6.
2. A canvas page is cut into tiles: every island with a margin, cut further at empty bands when one render
   would pass 4096 px a side or 12 megapixels, and neighbours joined while the joined tile still fits (each
   render replays the whole page, so fewer tiles is faster). Each tile is drawn straight from the PDF enlarged
   so that a line is about 40 px tall (`canvas-read.js`) and sent to the worker.
3. The worker (`engine-ppocr.js`) whitens pale yellow highlighter, finds the lines with the detector on a
   copy scaled to 24 px lines, joins boxes that share a baseline (a black term and its coloured definition
   are one line; two lists side by side are not joined), and reads each line from the full-size tile as a
   darkest-channel gray, so pale purple, orange and pink ink are as dark as black.
4. The lines of all tiles go back into page coordinates and into reading order (`canvas-order.js`): lines
   right under one another form a block, blocks close together form a topic cluster, clusters are read one
   after the other. `src/pdf/ocr-canvas.js` and `ocr-canvas-scope.js` turn blocks into titled topics for the
   summary, flashcards, quiz and practice test; "term - definition" lines become cards.
5. Any other page goes to the line reader as before. A page it gives up on (too many pieces) is read in
   tiles instead of being skipped, when the tile reader is installed. A drawn page (no images) is grayed by
   its darkest channel, a photo or scan by brightness as before.

**Which recogniser reads a line** (`hw-worker-core.js`): tiles and pages the plan calls printed are read by
PP-OCR; handwriting is read by TrOCR, and a TrOCR line under 0.6 is replaced by the PP-OCR read of the same
crop only when that read is sure (mean character probability 0.88 or more). Measured on the samples with a
transcript, line crops cut the same way for both: PP-OCR is better on print and on tidy tablet print, TrOCR
on joined-up handwriting. With only one of the two installed, that one reads everything.

**Confidence.** The same blend as for TrOCR (section 9); one or two characters are capped at 0.5. Lines from
canvas tiles use the blend to the power 0.75: on 24 hand-checked lines of the test document the lines the
plain blend held back had 14% character errors and the lines it kept 11%, so it was holding back nearly half
the page for nothing.

**Measured on the test document** (headless Edge, one thread, `node tools/eval-canvas.js <file.pdf>`):

| | Before | After |
| - | - | - |
| Lines read | 0 (page skipped) | 428 (12,067 characters) in 15 clusters, 53 blocks |
| Kept for study (confidence 0.6 or more) | 0 | 327 lines (9,147 characters); 101 left for review |
| Confidence | - | 5%: 0.44, 25%: 0.60, median 0.69, 75%: 0.77, 95%: 0.90 |
| Character errors, 24 hand-checked lines | - | 12% (ignoring case and punctuation) |
| Time | - | about 90 s (two runs: 89 and 91): open the PDF 9, overview 5, five tile renders 10, reading the tiles 64 |
| Flashcards / quiz / practice test | 0 / 0 / 0 | 115 / 10 / 20 (test in six sections by topic) |

The 24 lines were checked by eye against one enlarged tile; that is a small sample of one handwriting.
Reading the tiles is the slow part: one WebAssembly thread takes about 0.15 s per line.

**Measured on the sample pages** (`tools/eval-handwriting.js`, same pages and transcripts as before):

| Pages | Measure | Before | After |
| - | - | - | - |
| 17 real handwritten pages | Character errors / word errors | 40.0% / 69.4% | 39.5% / 68.8% |
| | Share of the text kept for study | 17.4% | 20.0% |
| | Pages that got worse | - | none (12 second-opinion reads taken) |
| 1 tablet-ink page | Character errors | 107.5% | 96.2% |
| 3 tidy synthetic pages | Character errors / word errors | 0.8% / 5.7% | 0.9% / 2.9% |
| 3 clean printed pages | Character errors | 1.7%, 1.7%, 4.2% | 0.4%, 1.2%, 0.0% |
| 1 textbook page with figures | Character errors / word errors | 50.4% / 72.0% | 48.9% / 78.3% |
| 5 printed pages | Seconds per page | 88 | 8 |

Two things got worse and are left as they are. One synthetic page drawn in a tidy handwriting font counts as
print and is now read by PP-OCR, which fixed two misspelt words but dropped the list numbers "3." and "4."
(1.4% to 1.7% character errors on that page). On the textbook page PP-OCR makes a few more slips in the small
body text, and it reads the small print inside the figures with confidence where TrOCR produced junk that was
held back; that print is not in the transcript, so the error rate of the kept pieces of the printed set rose
from 7.8% to 20.5% while its overall character errors fell from 24.4% to 22.9%.

Known limits: the review panel still cuts its previews from the 1650 px render, so a canvas line is shown
very small there; the blocks come from line positions only, so two topics written close together can end up
in one block; PP-OCR drops a list number standing apart at the start of a printed line now and then.

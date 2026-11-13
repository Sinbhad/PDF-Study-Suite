"""Pinned downloads for tools/fetch-handwriting-model.py: every URL, size and checksum lives here.

Tarball members are (member, dest name under vendor/hw/, required, sha256 of the extracted file or None).
The tarball's own sha512 integrity is the gate; it is checked before the tarball is opened.
"""

HF = ("https://huggingface.co/Xenova/trocr-small-handwritten/resolve/"
      "02bea33ca09a70e2e2d91140a7e6e1a729606a5b/")
MODEL_SUBDIR = "models/trocr-small-handwritten"

# (name, url, sha512 integrity, max tarball size in MB, [members])
TARBALLS = [
    ("@huggingface/transformers 3.8.1",
     "https://registry.npmjs.org/@huggingface/transformers/-/transformers-3.8.1.tgz",
     "sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA==",
     200,
     [("package/dist/transformers.min.js", "transformers.min.mjs", True, None),
      ("package/dist/ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.mjs", True, None),
      ("package/dist/ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.wasm", False, None),
      ("package/LICENSE", "LICENSE-transformers.txt", True, None)]),
    # Same onnxruntime-web build as the .wasm above. Its small ESM loader runs the PP-OCR models directly.
    ("onnxruntime-web 1.22.0-dev.20250409-89f8206ba4",
     "https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0-dev.20250409-89f8206ba4.tgz",
     "sha512-0uS76OPgH0hWCPrFKlL8kYVV7ckM7t/36HfbgoFw6Nd0CZVVbQC4PkrR8mBX8LtNUFZO25IQBqV2Hx2ho3FlbQ==",
     400,
     [("package/dist/ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.wasm", True, None),
      ("package/dist/ort.wasm.min.mjs", "ort.wasm.min.mjs", True,
       "0cb5ac5be2c414d5b9e361f857108630c6d6e24a5ab9be3cf5f761de55289e94"),
      ("package/LICENSE", "LICENSE-onnxruntime.txt", True, None)]),
]
MAX_MEMBER_MB = 150

# TrOCR files under HF: (path, size, kind, checksum); kind "sha256" for the LFS ONNX files, "blob" = git blob SHA-1
MODEL_FILES = [
    ("onnx/encoder_model.onnx", 87496990, "sha256",
     "f6a2c3ac23a426c85f8557f2763bf39cce7eeacf3004563762e023050ddc1fd9"),
    ("onnx/decoder_model_merged_quantized.onnx", 40527613, "sha256",
     "51076aa396ab5939c4668db9de901ad51765094b4c05c4c8c1f8ae2012ba1e08"),
    ("config.json", 4515, "blob", "a7817100c3840b680166143285b038b5bae02331"),
    ("generation_config.json", 185, "blob", "18e475bcdda9a14641d2afdf17cc4567aabc9fa4"),
    ("preprocessor_config.json", 465, "blob", "83af4d3da32150c64f279aa4cbed3a6166b77302"),
    ("tokenizer.json", 4494727, "blob", "b32c87bef9bf22a5b1c1fb902a76098d13909dc6"),
    ("tokenizer_config.json", 471, "blob", "22dd4ff74bd92b564b2af510e9d35ce7976ce3a4"),
    ("special_tokens_map.json", 279, "blob", "68171d1ff68b731a33d119708476692c094a466b"),
    ("README.md", 1505, "blob", "0219ca299628c3d97121de1ad362adeb8ea45c2b"),
]

# PP-OCRv5 mobile (Apache-2.0), PaddlePaddle's ONNX exports at pinned revisions: (url, dest under vendor/hw/, size,
# sha256). The file name inside those repositories was not recorded when the models were first installed, only the
# repository, revision and sha256; "inference.onnx" is the name the PaddlePaddle ONNX repositories use. The sha256 is
# the gate either way: a different file is deleted, never installed.
PPOCR_DIR = "models/ppocr-v5"
PPOCR_FILES = [
    ("https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/"
     "e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx", PPOCR_DIR + "/det.onnx", 4826518,
     "a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d"),
    ("https://huggingface.co/PaddlePaddle/en_PP-OCRv5_mobile_rec_onnx/resolve/"
     "3fafbc3b5dcf93dd72add9f48368be8a3a2cd33b/inference.onnx", PPOCR_DIR + "/rec.onnx", 7848423,
     "b5f833dfc5d0eb71da397b4efa06ebeee9b431b690a47d6af40d77d8eabc557f"),
]
# The recogniser's character list (index 0 is the CTC blank, the last entry a space), kept in the repository
# because it is derived from the model's dictionary and has no download of its own: (tools/ file, dest, sha256).
PPOCR_VOCAB = ("ppocr-v5-vocab.json", PPOCR_DIR + "/vocab.json",
               "82e63fa192c3f702a3c850149c0e18bcb0d4a69d1020cacdb9535a807308cad1")

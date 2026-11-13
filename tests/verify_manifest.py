"""
Manifests and Node.js resolver for tests/verify_suite.py (extracted via Strangler Fig).
Holds the expected script count, PDFStudy module namespace map, Node fixture suites,
and HTTP server asset endpoints.
"""
import os
import shutil

EXPECTED_SCRIPT_COUNT = 83

EXPECTED_NAMESPACES: dict[str, str] = {
    # PDF extraction, 2D formula reconstruction & textbook/slide structure (22)
    "src/pdf/slide-lines.js": "PDFStudy.slideLines",
    "src/pdf/slide-reveal.js": "PDFStudy.slideReveal",
    "src/pdf/scope-lines.js": "PDFStudy.scopeLines",
    "src/pdf/figure-filter.js": "PDFStudy.figureFilter",
    "src/pdf/math-glyphs.js": "PDFStudy.mathGlyphs",
    "src/pdf/math-tex.js": "PDFStudy.mathTex",
    "src/pdf/font-decoder.js": "PDFStudy.fontDecoder",
    "src/pdf/page-rules.js": "PDFStudy.pageRules",
    "src/pdf/math-line.js": "PDFStudy.mathLine",
    "src/pdf/formula-builder.js": "PDFStudy.formulaBuilder",
    "src/pdf/column-layout.js": "PDFStudy.columnLayout",
    "src/pdf/span-format.js": "PDFStudy.spanFormat",
    "src/pdf/line-builder.js": "PDFStudy.lineBuilder",
    "src/pdf/page-kind.js": "PDFStudy.pageKind",
    "src/pdf/pdf-loader.js": "PDFStudy.pdfLoader",
    "src/pdf/classifier.js": "PDFStudy.classifier",
    "src/pdf/slide-extractor.js": "PDFStudy.slideExtractor",
    "src/pdf/block-headings.js": "PDFStudy.blockHeadings",
    "src/pdf/didactic-blocks.js": "PDFStudy.didacticBlocks",
    "src/pdf/text-cleaner.js": "PDFStudy.textCleaner",
    "src/pdf/scope-builder.js": "PDFStudy.scopeBuilder",
    "src/pdf/book-hierarchy.js": "PDFStudy.bookHierarchy",
    # Handwriting: ink-only page detection, recognised text -> page lines, on-device recognition pipeline, canvas pages (12)
    "src/pdf/ink-detect.js": "PDFStudy.inkDetect",
    "src/pdf/ocr-canvas.js": "PDFStudy.ocrCanvas",
    "src/pdf/ocr-canvas-scope.js": "PDFStudy.ocrCanvasScope",
    "src/pdf/ocr-lines.js": "PDFStudy.ocrLines",
    "src/hw/raster.js": "PDFStudy.hwRaster",
    "src/hw/segmenter.js": "PDFStudy.hwSegmenter",
    "src/hw/null-engine.js": "PDFStudy.hwNullEngine",
    "src/hw/hw-client.js": "PDFStudy.hwClient",
    "src/hw/canvas-plan.js": "PDFStudy.hwCanvasPlan",
    "src/hw/canvas-order.js": "PDFStudy.hwCanvasOrder",
    "src/hw/canvas-read.js": "PDFStudy.hwCanvasRead",
    "src/hw/hw-pipeline.js": "PDFStudy.hwPipeline",
    # Math-safe NLP, STEM garbage gate, flashcards, quiz & practice test engines (18)
    "src/nlp/math-text.js": "PDFStudy.mathText",
    "src/nlp/stem-noise.js": "PDFStudy.stemNoise",
    "src/nlp/noise-filter.js": "PDFStudy.noiseFilter",
    "src/nlp/tokenizer.js": "PDFStudy.tokenizer",
    "src/nlp/bold-terms.js": "PDFStudy.boldTerms",
    "src/nlp/keywords.js": "PDFStudy.keywords",
    "src/nlp/graph-rank.js": "PDFStudy.graphRank",
    "src/nlp/summarizer.js": "PDFStudy.summarizer",
    "src/nlp/stem-cards.js": "PDFStudy.stemCards",
    "src/nlp/slide-cards.js": "PDFStudy.slideCards",
    "src/nlp/flashcard-engine.js": "PDFStudy.flashcardEngine",
    "src/nlp/phrase-shape.js": "PDFStudy.phraseShape",
    "src/nlp/quiz-gate.js": "PDFStudy.quizGate",
    "src/nlp/quiz-options.js": "PDFStudy.quizOptions",
    "src/nlp/stem-distractors.js": "PDFStudy.stemDistractors",
    "src/nlp/stem-questions.js": "PDFStudy.stemQuestions",
    "src/nlp/quiz-engine.js": "PDFStudy.quizEngine",
    "src/nlp/test-engine.js": "PDFStudy.testEngine",
    # Study-content layer: definitions, slide model, section quizzes, key terms (5)
    "src/nlp/definition-miner.js": "PDFStudy.definitionMiner",
    "src/nlp/key-terms.js": "PDFStudy.keyTerms",
    "src/nlp/slide-model.js": "PDFStudy.slideModel",
    "src/nlp/slide-quiz.js": "PDFStudy.slideQuiz",
    "src/nlp/block-quiz.js": "PDFStudy.blockQuiz",
    # UI theme, rich text/math renderer, study views, practice test mode, shell & controls
    "src/ui/storage.js": "PDFStudy.storage",
    "src/ui/math-renderer.js": "PDFStudy.mathRenderer",
    "src/ui/theme.js": "PDFStudy.theme",
    "src/ui/rich-text.js": "PDFStudy.richText",
    "src/ui/rich-blocks.js": "PDFStudy.richBlocks",
    "src/ui/study-views.js": "PDFStudy.studyViews",
    "src/ui/summary-view.js": "PDFStudy.summaryView",
    "src/ui/flashcard-faces.js": "PDFStudy.flashcardFaces",
    "src/ui/flashcard-view.js": "PDFStudy.flashcardView",
    "src/ui/quiz-card.js": "PDFStudy.quizCard",
    "src/ui/test-report.js": "PDFStudy.testReport",
    "src/ui/test-view.js": "PDFStudy.testView",
    "src/ui/quiz-view.js": "PDFStudy.quizView",
    "src/ui/demo-data.js": "PDFStudy.demoData",
    "src/ui/sidebar-tree.js": "PDFStudy.sidebarTree",
    "src/ui/reader-controls.js": "PDFStudy.readerControls",
    "src/ui/hw-crops.js": "PDFStudy.hwCrops",
    "src/ui/hw-review.js": "PDFStudy.hwReview",
    "src/ui/study-pipeline.js": "PDFStudy.studyPipeline",
    "src/ui/main.js": "PDFStudy.main",
    "src/ui/events.js": "PDFStudy.events",
    "src/ui/keys.js": "PDFStudy.keys",
    "src/ui/loading.js": "PDFStudy.loading",
    "src/ui/tabs.js": "PDFStudy.tabs",
    "src/ui/shell.js": "PDFStudy.shell",
}

NODE_FIXTURES: tuple[str, ...] = (
    "quality_fixtures.js",
    "option_fixtures.js",
    "layout_fixtures.js",
    "flashcard_fixtures.js",
    "math_fixtures.js",
    "extraction_fixtures.js",
    "structure_fixtures.js",
    "stem_fixtures.js",
    "ui_render_fixtures.js",
    "math_font_fixtures.js",
    "handwriting_fixtures.js",
    "handwriting_flow_fixtures.js",
    "handwriting_photo_fixtures.js",
    "handwriting_prep_fixtures.js",
    "handwriting_print_fixtures.js",
    "handwriting_eval_fixtures.js",
    "handwriting_engine_fixtures.js",
    "handwriting_tiles_fixtures.js",
    "handwriting_canvas_fixtures.js",
    "handwriting_ppocr_fixtures.js",
)

STYLESHEET_PATHS: tuple[str, ...] = (
    "/styles/tokens.css",
    "/styles/base.css",
    "/styles/controls.css",
    "/styles/shell.css",
    "/styles/study.css",
    "/styles/math.css",
    "/styles/practice.css",
    "/styles/handwriting.css",
)

# Self-hosted math font (STIX Two, SIL OFL 1.1), committed with its licence
FONT_ASSETS: tuple[str, ...] = (
    "/vendor/fonts/stix-two/STIXTwoMath-Regular.woff2",
    "/vendor/fonts/stix-two/STIXTwoText-Italic.woff2",
    "/vendor/fonts/stix-two/STIXTwoText-Bold.woff2",
    "/vendor/fonts/stix-two/OFL.txt",
)

# Loaded by the recognition Web Worker (importScripts), never by index.html
WORKER_ASSETS: tuple[str, ...] = (
    "/src/hw/hw-worker.js",
    "/src/hw/hw-worker-core.js",
    "/src/hw/page-flatten.js",
    "/src/hw/rule-strip.js",
    "/src/hw/clean.js",
    "/src/hw/line-split.js",
    "/src/hw/islands.js",
    "/src/hw/slant-split.js",
    "/src/hw/columns.js",
    "/src/hw/print-detect.js",
    "/src/hw/page-prep.js",
    "/src/hw/engine-util.js",
    "/src/hw/engine-model.js",
    "/src/hw/ppocr-prep.js",
    "/src/hw/ppocr-boxes.js",
    "/src/hw/ppocr-ctc.js",
    "/src/hw/engine-ppocr.js",
)

HTTP_ENDPOINTS: tuple[str, ...] = (
    "/index.html",
    *STYLESHEET_PATHS,
    "/vendor/pdf.min.js",
    "/vendor/pdf.worker.min.js",
    *(f"/{scr}" for scr in EXPECTED_NAMESPACES),
    *WORKER_ASSETS,
    *FONT_ASSETS,
    "/tests/quality.html",
    *(f"/tests/{fx}" for fx in NODE_FIXTURES),
)


def find_node() -> str | None:
    found = shutil.which("node")
    if found:
        return found
    local_app = os.environ.get("LOCALAPPDATA", "")
    user_prof = os.environ.get("USERPROFILE", "")
    candidates = [
        os.path.join(local_app, "Programs", "cursor", "resources", "app", "resources", "helpers", "node.exe"),
        os.path.join(user_prof, "node", "node-v22.11.0-win-x64", "node.exe"),
        r"C:\Program Files\nodejs\node.exe",
    ]
    return next((p for p in candidates if p and os.path.exists(p)), None)

"""
Manifests and Node.js resolver for tests/verify_suite.py (extracted via Strangler Fig).
Holds the expected script count, PDFStudy module namespace map, Node fixture suites,
and HTTP server asset endpoints.
"""
import os
import shutil

EXPECTED_SCRIPT_COUNT = 69

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
    "structure_fixtures.js",
    "stem_fixtures.js",
    "ui_render_fixtures.js",
)

STYLESHEET_PATHS: tuple[str, ...] = (
    "/styles/tokens.css",
    "/styles/base.css",
    "/styles/controls.css",
    "/styles/shell.css",
    "/styles/study.css",
    "/styles/math.css",
    "/styles/practice.css",
)

HTTP_ENDPOINTS: tuple[str, ...] = (
    "/index.html",
    *STYLESHEET_PATHS,
    "/vendor/pdf.min.js",
    "/vendor/pdf.worker.min.js",
    *(f"/{scr}" for scr in EXPECTED_NAMESPACES),
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

# ARCHITECTURE-CONTRACTS.md — Verified Module & IR Contracts

Field-by-field data contracts across `src/pdf/`, `src/hw/`, `src/nlp/`, and `src/ui/`, verified against the live module implementations.

---

## 1. Enforcement & Static Checks

- **Load order & exports (`index.html` + `tests/verify_manifest.py` + `tools/sync-manifest.js`):** Every script in `index.html` runs in topological dependency order and exposes `window.PDFStudy.<module>` plus CommonJS `module.exports`. `tests/verify_suite.py` verifies `EXPECTED_SCRIPT_COUNT` (currently `245`) and `EXPECTED_NAMESPACES` without duplicates.
- **Static & runtime enforcement (`tools/check-contracts.js`):** Enforces (all unless `--static-only` skips #5):
  1. `index.html` <-> `tests/verify_manifest.py` exact parity (counts, duplicates, namespaces, existence on disk).
  2. Non-orphan modules (every `.js` file under `src/` is either loaded by `index.html` or listed in `WORKER_ASSETS` in `tests/verify_manifest.py`).
  3. Namespace export completeness (`PDFStudy.<key>` exists in module source with no accidental duplicate claim).
  4. Browser-like VM load-order test (`checkBrowserLoadOrder`, executing every `<script src>` in `index.html` order with no `require()`, verifying zero top-level `ReferenceError`/`TypeError` and all `EXPECTED_NAMESPACES` populated).
  5. Runtime IR schema validation across `sample-textbook`, `sample-slides`, `ocrLines`, and `docState.upgrade` (`parsedPdf`, `slideDeck`, `scopeObj`, `summary`, `flashcard`, `question`, `practiceTest`, `ocrResult`, `docState`).

---

## 2. PDF Loading, Lines & Ink Detection (`src/pdf/`)

### `parsedPdf` (`src/pdf/pdf-loader.js`, `ink-summary.js`)

```json
{
  "pdfDoc": "<PDFDocumentProxy>",
  "numPages": 120,
  "pages": ["<pageObj> (all pages if <=35; 12 evenly spaced samples if >35)"],
  "pageCache": "Map<pageNumber, pageObj>",
  "outline": [{ "level": 1, "title": "string", "startPage": 1, "children": [] }],
  "isLazy": true,
  "pageLabels": "printed page label map | null (printed-pages.js)",
  "inkSurvey": "Map<pageNumber, 'typed'|'needsReading'|'empty'> (optional lazy operator pass)",
  "inkSummary": "getter -> { pages, known, typed, needsReading, mixed, empty, decorative }"
}
```

### `pageObj` (`src/pdf/pdf-loader.js`)

```json
{
  "pageNumber": 1,
  "width": 612,
  "height": 792,
  "aspectRatio": 0.7727,
  "lines": ["<lineObj>"],
  "wordCount": 340,
  "annotations": ["<annotationLine>"],
  "kind": "'content' | 'front' | 'exercises' | ... (page-kind.js)",
  "ink": "<inkDetect>"
}
```

### `lineObj` (`src/pdf/line-builder.js`, `ocr-lines.js`)

Viewport coordinates in PDF points (`scale = 1.0`, top-left origin):

```json
{
  "text": "plain line text",
  "formattedText": "**bold** and $TeX$ formatted text",
  "cleanText": "text with leading BULLET_RE stripped",
  "x0": 72.0,
  "textX0": 84.0,
  "x1": 540.0,
  "topY": 110.5,
  "bottomY": 122.5,
  "fontSize": 11.0,
  "isBold": false,
  "hasBullet": false,
  "hasMath": false,
  "isCode": false,
  "wordCount": 9,
  "pageWidth": 612,
  "pageHeight": 792,
  "column": 0,
  "isMargin": false,
  "kind": "'caption' | 'folio' | 'url' | 'objective' | 'biography' | 'code' (optional, line-kinds.js)",
  "segments": [{ "text": "cell", "x0": 72, "x1": 140, "fontSize": 10 }],
  "ocr": {
    "lineIndex": 0,
    "confidence": 0.91,
    "low": false,
    "regionIds": ["p1-l0-r0"],
    "cluster": 0,
    "group": 0,
    "title": false
  }
}
```
- `segments` is present only when a row has `>= 2` runs separated by `> CELL_GAP * bodySize`.
- `ocr` is present only on lines produced/merged by `ocr-lines.js`; `cluster`/`group`/`title` appear when `result.layout === 'canvas'`.

### `annotationLine` (`src/pdf/pdf-loader.js`)

Invisible render-mode-3 notes-app handwriting layer, kept separate from `pageObj.lines` (`isAnnotation: true`):

```json
{
  "text": "string",
  "pageNumber": 1,
  "x0": 72.0,
  "x1": 210.0,
  "topY": 140.0,
  "bottomY": 152.0,
  "fontSize": 11.0,
  "isAnnotation": true
}
```

### `inkDetect` (`src/pdf/ink-detect.js`, `ocr-lines.js`, `ocr-edits.js`)

Attached at `pageObj.ink`:

```json
{
  "needsRecognition": true,
  "reason": "'has-text' | 'blank' | 'no-text' | 'mixed'",
  "mixed": "'annotation-ink' | 'image' | 'paths' (when reason === 'mixed')",
  "readBoxes": [{ "x": 0, "y": 0, "w": 400, "h": 300 }],
  "pathOps": 42,
  "imageOps": 1,
  "annotationStrokes": 0,
  "passedOver": false,
  "typedLines": ["<lineObj> snapshot saved on first OCR apply"],
  "raw": "<ocrResult>",
  "result": "<ocrResult noise-stripped & outside typed>",
  "pictureResult": "<ocrResult when judged picture>",
  "recognised": true,
  "picture": false,
  "held": false,
  "emptyRender": false,
  "skipped": false,
  "corrected": false,
  "remembered": false,
  "shown": false,
  "keepAsPicture": false,
  "checkSkipped": false,
  "typedIn": false
}
```
- Constants: `MIN_WORDS = 5`, `MIN_PATH_OPS = 20`, `MIN_IMAGE_OPS = 1`, `MIN_ANNOTATION_STROKES = 4`, `RANGE_SHARE = 0.2`, `RANGE_RUN = 3`.

---

## 3. Slide Deck & Scope Structures (`src/pdf/`)

### `slideDeck`, `slide`, `nestedBullet` (`src/pdf/slide-extractor.js`, `slide-lines.js`, `slide-reveal.js`)

```json
{
  "totalSlides": 18,
  "rawSlideCount": 24,
  "slides": ["<slide>"]
}
```

**`slide`:**
```json
{
  "slideNumber": 3,
  "endSlideNumber": 4,
  "pages": [3, 4],
  "kind": "'title' | 'section' | 'content' | 'question' | 'table'",
  "title": "Binary Search",
  "formattedTitle": "Binary Search",
  "bullets": ["Divides sorted array in half"],
  "nestedBullets": ["<nestedBullet>"],
  "rawText": "Binary Search. Divides sorted array in half",
  "annotations": ["<annotationLine>"],
  "definitions": [{ "term": "string", "definition": "string" }],
  "qa": { "question": "string", "answer": "string" },
  "table": { "rows": [["h1", "h2"]], "formattedRows": [["h1", "h2"]] },
  "tables": ["<table>"]
}
```

**`nestedBullet` (`slide-lines.js toNested`):**
```json
{
  "level": 0,
  "text": "plain text",
  "formattedText": "formatted text",
  "fontSize": 14,
  "isBold": false,
  "isCode": false,
  "firstSpanBold": "optional bold lead",
  "kind": "'caption' | 'label' (optional)",
  "bullet": true,
  "column": 0,
  "layoutColumn": 0
}
```
- `level` clamps to `0..2`. `column` (`0`/`1`) appears on side-by-side lists; `layoutColumn` appears otherwise.

### `scopeObj`, `didacticBlock`, `table` (`scope-builder.js`, `text-cleaner.js`, `scope-emitter.js`, `didactic-blocks.js`, `table-grid.js`)

**`scopeObj`:**
```json
{
  "text": "paragraphs joined by \\n\\n",
  "exerciseText": "end-of-section exercise lines joined by \\n",
  "didacticBlocks": ["<didacticBlock> (FACT_KINDS only: definition, theorem, key-concept)"],
  "blocks": ["<didacticBlock> (all tagged blocks incl. example, self-check, syntax, sidebar)"],
  "tables": ["<table>"],
  "lines": [
    {
      "text": "string",
      "pageNumber": 12,
      "kind": "'prose'|'heading'|'code'|'margin'|'table'|'caption'|'folio'|'url'|'objective'|'biography'|'example'|'self-check'|'syntax'",
      "blockId": "blk-1 | null",
      "paragraph": 1,
      "inText": true
    }
  ],
  "pageCount": 10,
  "startPage": 12,
  "endPage": 21,
  "canvas": { "slides": [], "topics": [{ "name": "string", "slides": [] }], "share": 0.0 }
}
```
- Synchronous `extractScopeText` caps at `30` pages (`startPage + 29`); async `extractScopeTextAsync` caps at `25` pages (`startPage + 24`).

**`didacticBlock` (`didactic-blocks.js`):**
```json
{
  "category": "Theorem | Definition | Corollary | Lemma | Law | Rule | Algorithm | Formula | Summary | Guideline | ...",
  "kind": "'definition' | 'theorem' | 'key-concept' | 'example' | 'self-check' | 'syntax' | 'sidebar'",
  "id": "blk-1",
  "title": "Squeeze Theorem",
  "body": "cleaned body text (\\n separates list items/paragraphs)",
  "formulas": ["inner TeX strings"],
  "pageNumber": 14,
  "clip": { "page": 14, "top": 120.5, "bottom": 210.0, "left": 72.0, "right": 510.0 },
  "bbox": { "page": 14, "top": 120.5, "bottom": 210.0, "left": 72.0, "right": 510.0 }
}
```
- `bbox` is `null` if no valid geometry was captured (`clip` omitted).

**`table` (`table-grid.js publicTable`):**
```json
{
  "kind": "table",
  "header": ["Col A", "Col B"],
  "rows": [["r1c1", "r1c2"]],
  "pageNumber": 15,
  "text": "Col A | Col B\nr1c1 | r1c2"
}
```

---

## 4. Summaries, Flashcards & Assessments (`src/nlp/`)

### `summary` (`summarizer.js`, `book-outline.js`, `deck-outline.js`)

**Book Summary (`summarizeText`):**
```json
{
  "sentences": ["lead overview strings"],
  "keyTerms": ["term string"],
  "didacticBlocks": ["<didacticBlock>"],
  "keyFormulas": [{ "category": "Formula", "title": "string", "body": "string", "formula": "optional", "page": 14 }],
  "definitions": [{ "term": "string", "definition": "string", "page": 14 }],
  "outline": {
    "kind": "book",
    "lead": "Key points from pages ..., in the book's own words.",
    "sections": [
      {
        "title": "1.1 Limits",
        "page": 12,
        "blocks": [{ "category": "Definition", "label": "Definition 1", "title": "Limit", "body": "...", "page": 12, "flag": "'symbols'|'text'|''", "terms": [], "blockId": "blk-1" }],
        "definitions": [{ "term": "string", "text": "string", "page": 12 }],
        "formulas": [{ "title": "string", "body": "string", "page": 12, "kind": "optional 'code'" }],
        "tables": [{ "title": "string", "rows": [["..."]], "more": 0, "page": 12 }],
        "statements": [{ "text": "string", "page": 12 }]
      }
    ],
    "terms": [{ "term": "string", "page": 12, "ref": "s0-b0" }]
  }
}
```

**Deck Summary (`summarizeSlides` + `studyPipeline.slideMaterials`):**
```json
{
  "sentences": ["alias of overviewSentences added by studyPipeline"],
  "overviewSentences": ["lead points spread across the deck"],
  "keyTerms": ["term string"],
  "keyFormulas": [],
  "definitions": [{ "term": "string", "definition": "string", "page": 3 }],
  "slideBreakdown": [{ "slideNumber": 3, "title": "string", "kind": "content", "takeaways": [], "qa": [], "table": {} }],
  "didacticBlocks": [],
  "byTopic": true,
  "outline": {
    "kind": "deck",
    "lead": "Outline of slides 1–24: each topic with its points, worded as on the slides.",
    "covers": [{ "text": "objective", "page": 2, "answers": ["optional"] }],
    "sections": [
      {
        "title": "Section title",
        "page": 3,
        "topics": [
          {
            "title": "Topic title",
            "page": 3,
            "slides": [
              {
                "page": 4,
                "slide": 3,
                "title": "Slide title",
                "bullets": [{ "text": "string", "children": ["text or { text, children }"], "more": [], "ref": "optional" }],
                "more": [],
                "held": 0,
                "table": { "rows": [["..."]], "more": 0 },
                "qa": [{ "question": "string", "answer": "string" }]
              }
            ]
          }
        ]
      }
    ],
    "terms": [{ "term": "string", "page": 3, "ref": "s0-t0-..." }]
  }
}
```
- `summary-damage.js` strips/replaces any unresolved `¿` damage glyphs before returning.

### `flashcard` (`flashcard-engine.js`, `slide-cards.js`, `card-fields.js`)

```json
{
  "id": "fc-1",
  "front": "Term or prompt",
  "back": "Definition, theorem, formula, or bullets",
  "category": "Definition | Theorem | Formula | Algorithm | Rule | Key Term | Key Statement | Question | Worked Example | Slide Term | Slide Overview | ...",
  "kind": "'definition' | 'theorem' | 'formula' | 'algorithm' | 'qa' | 'concept' | 'overview'",
  "context": "Section Title (p. 14) | Slide 3: Title",
  "pageNumber": 14,
  "page": 14,
  "topic": "Topic or section name",
  "subject": "Entity the fact is about",
  "sourceKind": "'definition' | 'label' | 'list' | 'table' | 'note' | 'qa' | 'formula' | 'key-concept' | 'self-check'",
  "rule": { "kind": "optional worked rule spec" },
  "teaches": { "kind": "optional attached worked rule" },
  "quote": "optional source snippet for rule cards",
  "table": { "key": "...", "header": [], "row": [], "column": "...", "columnIndex": 1, "entity": "...", "subject": "..." }
}
```

### `question` (`quiz-engine.js`, `fact-questions.js`, `cloze-questions.js`, `typed-questions.js`, `typed-shape.js`, `recall-questions.js`)

Common fields across all 5 question `type` values:
```json
{
  "id": "q-1 (or t-1 in practiceTest)",
  "type": "'multiple_choice' | 'cloze' | 'true_false' | 'typed' | 'reveal'",
  "badge": "Definition | Multiple Choice • ... | Fill in the Blank | True / False | Type the Answer | Recall",
  "question": "stem text",
  "options": ["array of 4 strings (MC/cloze), ['True','False'] (TF), or [] (typed/reveal)"],
  "answer": "exact answer string",
  "answerIndex": 0,
  "explanation": "Source / explanation string",
  "skill": "'definition' | 'theorem' | 'formula' | 'complexity' | 'worked' | 'recall'",
  "category": "optional category",
  "subject": "optional entity",
  "source": "canonical source text for flagging & deduplication",
  "factKey": "fact identity key",
  "page": 14,
  "pageNumber": 14
}
```
- **Type-specific fields:**
  - `multiple_choice`: 4 options (`options.length === 4`); `pointOptions?: boolean`.
  - `cloze`: `options.length === 4`, blank `________` in `question`.
  - `true_false`: `options: ['True', 'False']`, `answer: 'True' | 'False'`, `construction: 'sibling_swap' | 'altered'`.
  - `typed` (`typed-shape.js` + `typed-check.js`): `options: []`, `form: 'term' | 'number' | 'bits' | 'truth' | 'expression'`, `accept: string[]`, `others: string[]`, `shown: string[]`, `symbols?: { not?: string[] }`, `checks?: { near: string[], looseHead: boolean }`. Checked via `typedCheck.check(q, typed)` -> `{ correct, verdict, message }`.
  - `reveal` (`recall-questions.js`): `options: []`, `selfGraded: true`, `recallGroup?: string`.

### `practiceTest` (`test-engine.js`)

```json
{
  "title": "Practice Test",
  "sections": [
    {
      "name": "Section Name (or 'Review')",
      "questions": ["<question> + { skill, section, pageNumber, review?: true }"]
    }
  ],
  "questions": ["flattened questions numbered t-1..t-N"],
  "total": 20,
  "skills": { "definition": 10, "theorem": 4, "recall": 6 }
}
```

---

## 5. OCR Pipeline & Persistence Contracts (`src/hw/`, `src/nlp/doc-state.js`)

### `ocrResult` & `READER_VERSION` (`hw-pipeline.js`, `hw-worker-core.js`, `canvas-read.js`)

- `PDFStudy.hwPipeline.READER_VERSION` = `'ppocr-v5.2026-11-18'` (`src/hw/hw-pipeline.js:24`). Cache entries in `src/ui/ocr-cache.js` are keyed by `${pageNumber}:${READER_VERSION}` so bumping `READER_VERSION` invalidates stale OCR results automatically.

```json
{
  "pageNumber": 1,
  "scale": 2.69,
  "width": 1650,
  "height": 2135,
  "layout": "'canvas' (omitted on line-reader pages)",
  "engine": "ppocr-v5",
  "printed": false,
  "angle": 0,
  "tiles": 6,
  "clusters": 2,
  "groups": 5,
  "partial": false,
  "skippedReason": "'too-many-regions' (optional)",
  "noise": 0,
  "timing": { "render": 45, "survey": 12, "orient": 30, "read": 980, "worker": 1020, "plans": 1, "probes": 2, "pieces": 18, "tiny": 0 },
  "lines": [
    {
      "index": 0,
      "box": { "x": 100, "y": 140, "w": 620, "h": 42 },
      "cluster": 0,
      "group": 0,
      "regions": [
        {
          "id": "p1-l0-r0",
          "kind": "'text' | 'math' | 'picture'",
          "box": { "x": 100, "y": 140, "w": 620, "h": 42 },
          "size": { "w": 618, "h": 38 },
          "text": "recognised text",
          "confidence": 0.94,
          "source": "'model' | 'manual' | 'user'",
          "stats": { "mean": 0.96, "min": 0.88, "engine": "ppocr" },
          "edited": false,
          "added": false,
          "removed": { "text": "...", "confidence": 0.4, "source": "model" },
          "kept": { "text": "...", "confidence": 0.3, "source": "model", "kind": "text" }
        }
      ]
    }
  ]
}
```
- `LOW_CONFIDENCE = 0.6` (`ocr-lines.js`, `ocr-merge.js`, `hw-worker-core.js`), `PAGE_HOLD_LOW_SHARE = 0.35` (`ocr-merge.js`).

### `docState` (`src/nlp/doc-state.js`, `VERSION = 1`)

Persisted per `docId` (`pdf-<fingerprint>` or `doc-<fnv1a64>` from `study-keys.js`) in IndexedDB (`pdf-study-suite` store `docs`, with in-memory fallback in `doc-store.js`):

```json
{
  "v": 1,
  "cards": {
    "c0123456789abcdef": {
      "known": true,
      "hidden": false,
      "deleted": false,
      "front": "student-edited front",
      "back": "student-edited back",
      "meta": {},
      "scope": "scopeId",
      "sched": { "due": 1732000000000, "interval": 4, "ease": 2.5 }
    }
  },
  "userCards": [
    { "id": "u-...", "front": "string", "back": "string", "scope": "scopeId | null", "created": 1732000000000 }
  ],
  "flags": {
    "s0123456789abcdef": { "at": 1732000000000, "text": "normalised source", "questionKey": "q..." }
  },
  "attempts": [
    {
      "kind": "'quiz' | 'test'",
      "scopeId": "ch-1-sec-1",
      "at": 1732000000000,
      "score": 8,
      "total": 10,
      "retry": false,
      "rows": [{ "key": "q...", "right": true }],
      "missed": ["<plainQuestion> (kept on newest attempt per kind+scopeId only)"]
    }
  ],
  "overrides": [
    { "questionKey": "q...", "source": "string", "answer": "string", "typed": "string", "at": 1732000000000 }
  ],
  "view": { "tab": "summary", "scope": "ch-1-sec-1", "mode": "book" }
}
```
- Caps in `doc-state.js`: `ATTEMPTS_PER_SCOPE = 3`, `ATTEMPTS_TOTAL = 60`, `OVERRIDES_KEPT = 100`, `MIN_SOURCE_MATCH = 25`.

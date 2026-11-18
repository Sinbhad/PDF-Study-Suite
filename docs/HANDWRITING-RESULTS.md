# Handwriting recogniser on 20 English pages: results (2026-11-12)

**Short version.** Tidy handwriting exported from a notes app is now read almost perfectly (0.8% of characters
wrong on three synthetic GoodNotes-style pages). Real pen-on-paper pages improved a lot but are still far from
usable on their own: about 40% of characters wrong on average, ranging from 13% on Lincoln's neat copy of the
Gettysburg Address to over 60% on loose or sloping hands. The line finder now gets almost every line; what is
left is mostly the small recognition model misreading clean crops. Lines the reader is unsure about are held
back from summaries, flashcards and quizzes until you check them.

**Later the same day:** letterheads, columns and table rules were added; the same 20 pages went from 40.5% to
40.0% of characters wrong. Those numbers, and scanned printed pages, are in `docs/TEXT-EXTRACTION-RESULTS.md`.

## What was run

- **Images:** the 20 pages in `vendor/hw/test-samples-en/` (git-ignored; sources and licences in its
  `SOURCES.md`): 17 real, flat, English pages from Wikimedia Commons and NASA (6 neat, 5 average, 5 messy, 1
  light-on-dark tablet annotation) and 3 synthetic PNG pages in a GoodNotes style. Real and synthetic scores are
  never mixed.
- **Ground truth:** `TRANSCRIPTS.json`, 311 lines typed out by hand (278 real, 33 synthetic).
- **Tool:** `node tools/eval-handwriting.js vendor/hw/test-samples-en --out=<folder>`. Each image is wrapped
  unchanged in a one-page PDF with no text layer and goes through the real app in headless Edge: PDF.js render,
  the Web Worker, the installed model (fp32 encoder, 8-bit decoder), one thread. `--crops=name,name` also saves
  the exact crops the model was given.
- **Scores:** CER = character edits / reference characters, WER the same on words, summed over the pages of a
  group. Case and punctuation count. Text is compared page by page in reading order, so a missed line, an extra
  line or lines in the wrong order all cost errors. A rate can pass 100% when the reader writes more than is there.
- **Before** = the code on `main` before this work. **After** = this branch.

## Before and after

| Group | Pages | CER before | CER after | WER before | WER after |
| ----- | ----- | ---------- | --------- | ---------- | --------- |
| Neat | 6 | 78.4% | **27.2%** | 106.1% | **55.6%** |
| Average | 5 | 90.1% | **50.3%** | 97.5% | **83.3%** |
| Messy | 5 | 102.9% | **47.9%** | 124.4% | **73.2%** |
| Digital (light ink on a dark picture) | 1 | 97.7% | 107.5% | 100.0% | 144.0% |
| **All real pages** | 17 | 88.2% | **40.5%** | 108.2% | **69.9%** |
| **Synthetic pages** | 3 | 9.2% | **0.8%** | 17.8% | **5.7%** |

| | Before | After |
| --- | --- | --- |
| Real reference lines not found at all (of 278) | 115 | 8 |
| Extra pieces that match no real line | 71 | 8 |
| Real pieces flagged low confidence | 97.0% | 84.1% |
| Real text that passes the confidence check | 3.9% | 18.2% |
| Synthetic pieces flagged low confidence | 25.8% | 0% |
| Synthetic text that passes the confidence check | 71.3% | 100% |
| Seconds per piece (one thread, one laptop) | about 1.2 | about 1.7 to 2.0 |

Per page, after: Gettysburg p1 13.4%, Gettysburg p2 14.7%, letter to Santa 19.6%, ballpoint thank-you letter 22.1%,
Hopper letter 24.5%, Truman draft 25.7%, St Jude letter 25.8%, 1880s lecture notes 30.8%, recipe card 41.3%, the two
Coates poems 42.4% and 43.7%, church letter 46.9% (its printed letterhead is read but is not in the transcript, so it
counts as error), Dickinson "Wild Nights" 47.9%, Dickinson "Liquor" 61.4%, knitting notes 69.0%, Whitman draft 75.8%,
tablet annotations 107.5%. Synthetic: 1.4%, 0.3%, 0.6%.

## Does the confidence check protect the study material?

Pieces under 0.6 confidence stay in the review panel and are left out of summaries, flashcards and quizzes until
corrected or ticked "Looks right". On the 270 real lines that could be matched to a reference line:

| Confidence | Lines | Mean line CER |
| ---------- | ----- | ------------- |
| 0.0 to 0.2 | 72 | 70.4% |
| 0.2 to 0.4 | 99 | 47.2% |
| 0.4 to 0.6 | 57 | 24.5% |
| 0.6 to 0.8 (kept) | 33 | 19.6% |
| 0.8 to 1.0 (kept) | 9 | 6.2% |

- The 42 real lines that pass have 13.1% of their characters wrong between them; the 228 held back have 41.3%.
  So the check removes the worst text, but what passes on real cursive is still not clean: 4 of the 42 kept lines
  were 30% or more wrong, including fluent inventions such as "to the imposition that all new awareness" for
  "to the proposition that all men are cre-". Check anything that matters against the page.
- On the synthetic pages every line passes and 0.8% of characters are wrong.
- The score is `mean^2 * min^0.1` of the token probabilities, fitted on these same real lines, so the table is
  optimistic: it has not been tested on pages it was not tuned on.

## What changed

- **Model input.** Line crops are stretched straight to 384x384 with smooth resampling, as the model was trained;
  the old code padded the height to a 4:1 shape, which more than doubled errors on hand-cut lines (18.7% to
  45.5%). Crops are soft gray, not black-and-white.
- **Model files.** Full-precision encoder with the 8-bit decoder (about 128 MB instead of 64 MB; 15.8 to 16.2%
  against 18.7% CER on hand-cut real lines). About a third slower per line in the browser on one thread.
- **Clean-up.** One path for every page: dark pages are inverted, the paper's brightness is divided out so the
  background is white, and borders, dark scan edges, binding shadows, ruled lines and specks are removed before
  any box is cut.
- **Line finding.** Whole lines instead of word fragments; blocks taller than about 1.5 line heights are cut
  again at the valleys of the ink profile, along a sloped cut when the lines slope; ink belonging to the
  neighbouring lines is painted out of each crop; far-apart labels on a diagram become separate pieces; tiny,
  sparse or stray boxes are dropped before the model sees them.
- **Decoding and confidence.** Up to 96 tokens per line; looping output ("0 0 0 0", "a b c d e f") is capped at
  0.1; confidence re-fitted as above; a piece the layout check calls math is only capped when its text does not
  read as ordinary words (that cap was wrongly holding back 50 of 263 real lines).

## What is still wrong

1. **The model is the limit on real cursive.** The two Gettysburg pages score 13 to 15%, the same as the model
   scored on hand-cut lines from those pages (about 16%), so the pipeline adds nothing there and cannot do better
   without a stronger model. On the knitting notes every line is now found, and the text is still 69% wrong.
   Clean single-line crops are misread ("Fallen cold and dead." came back as "Mullen sold amid").
2. **Sloping, ragged drafts** (Whitman): a few lines are still cut into pieces in the wrong order, and words
   written between the lines are attached to the line below.
3. **Annotations on a picture** (the tablet page): short capital-letter labels scattered over a photo. Some labels
   are still paired, the compass graphic is read as text, and the model reads block capitals badly. This kind of
   page is not what the app is for.
4. **Small things:** a faint page number is dropped (Gettysburg p2); one margin squiggle is read as a line
   (Dickinson); printed letterheads are read as if handwritten.
5. **Math** is still not recognised; math-looking pieces stay flagged.

## Not verified

- Photos taken at an angle, non-English pages and math pages were not re-run; the earlier 24-image set had no
  transcripts and all of it failed before this work.
- Only Edge on one Windows laptop was used. Timings were taken while other programs were running.
- The confidence fit and the segmentation constants were tuned on these 20 pages. There is no held-out set.
- Three synthetic pages are few, and they are drawn with fonts, which is tidier than real tablet handwriting.

## PP-OCR on its own, and what tilt does (2026-11-18)

Measured with only the PP-OCRv5 files installed (no TrOCR, no Transformers.js): `det.onnx`, `rec.onnx`, the
onnxruntime-web loader and wasm, about 34 MB. Headless Edge, one thread, `tools/eval-handwriting.js`. Every
page here is drawn from a handwriting-style **font** (Ink Free, Segoe Print, Segoe Script, MV Boli, Comic
Sans), so these numbers show what layout and image conditions do. They say nothing about how well a real
hand is read. PaddleOCR's own documentation gives the mobile recogniser about 49% accuracy on handwritten
English (58% for the server model), so real notes will read far worse than this.

Two reading paths were compared on the same pages: the line reader (hand-built line finding, then PP-OCR on
each crop) and the tile reader (PP-OCR's own detector, forced on for every page).

| Page (font pages, note-style text) | Line reader, characters wrong | Tile reader, characters wrong |
| --- | --- | --- |
| Print style, plain paper | 0.3% | 0.8% |
| Print style, ruled paper with margin line | 2.1% | 2.1% |
| Joined-up style, plain paper | 0.0% | 0.0% |
| Small dense writing, 26 lines | 0.4% | 0.0% |
| Coloured ink on dotted paper | 1.3% | 3.7% |
| Two columns | 36.4% (columns read across) | 0.0% |
| Math lines (`f'(x) = 2x + 3`, `lim x->0 sin(x)/x = 1`) | 2.0%, 2 of 8 lines flagged low | 0.5%, 2 of 8 flagged low |
| Uneven writing (each word shifted and turned), print style | 7.3% | 13.6% |
| Uneven writing, joined-up style | 8.2% | 8.8% |
| Simulated phone photo (3.2 degree turn, shadow, blur, grain) | 49.6%, 7 of 8 lines flagged low | no lines found; fell back to the line reader |

About 0.3 s per line, 2 to 7 s per page.

The phone-photo failure was taken apart, one condition at a time, on the ruled print-style page:

| Condition | Line reader | Tile reader |
| --- | --- | --- |
| Clean | 0.8% | 0.4% |
| Blur only | 0.8% | 0.4% |
| Shadow only | 0.8% | 0.8% |
| Turned 1 degree | 0.4% | 51.5% |
| Turned 2 degrees | 16.0% | 58.0% |
| Turned 3.2 degrees | 61.5% | 52.3% |
| Turned 6 degrees | 42.0% | 64.5% |

What this shows:

1. **Nothing straightens a turned page.** Blur and shadow cost nothing; a turn of 2 degrees or more wrecks
   the read on both paths, and the tile reader fails at 1 degree. The line crops themselves come out clean and
   legible (checked by eye on the crop previews); the sloping line inside a tall crop is what the recogniser
   cannot read. Any hand-held photo is turned more than this. Estimating the page angle and rotating before
   reading is the first fix to make.
2. **PP-OCR alone runs the whole flow.** TrOCR and Transformers.js are not needed for the app to read a page.
3. **Bug:** with only PP-OCR installed the page is read, but the notice says "No handwriting model is
   installed" and the smoke test reports `modelLoaded: false`, because the engine status shown is the
   line-reader engine's (TrOCR), not the one that did the reading.
4. **Bug:** `tools/hw_model_pins.py` expects `package/LICENSE` in the onnxruntime-web tarball; that file is
   not there, so the fetch script reports a failure for that package even though the runtime files install.
5. The line reader still reads two columns across. The tile reader orders them correctly.
6. Neither path is better everywhere: the tile reader wins on columns and dense pages, the line reader on
   uneven writing and slight turns.

Not measured: any real handwriting, real tablet exports, real phone photos, TrOCR on these pages.

## Straightening, turning and PP-OCR as the reader (2026-11-18)

Same set-up as the section above: only the PP-OCRv5 files installed, headless Edge, `tools/eval-handwriting.js`,
the same font-drawn pages (regenerated with the same scripts). They are still not real handwriting.

What changed in the code:

- **The page angle is measured and the page is turned level before it is read** (`src/hw/skew-angle.js`,
  `page-turn.js`, `upright.js`). The angle comes from a shrunk, flattened copy of the page: its darkness is summed
  along lines at each trial angle within 15 degrees and the angle with the sharpest steps between written lines
  and gaps wins (about 25 to 40 ms a page). On the test pages it was within 0.1 degree. Both reading paths use
  it; boxes in results stay in the pixels of the page as given (the upright rectangle around the sloping line),
  and a piece of a turned page also carries `size`, its own width and height.
- **Upside-down and sideways pages** are found by reading: the three widest lines are read first; when they
  read well (mean confidence 0.6 or more) the page is upright and those reads are reused, so an ordinary page
  costs nothing extra. Only when they read badly are the same crops read turned over, and, if the page also has
  lines running up it, a quarter turn is tried. Another orientation is taken only when it reads clearly better.
- **Two columns**: a column needs three lines now (was four), and the longest line of a column may reach into
  the gap without being taken for a line that crosses it.
- **PP-OCR alone is a complete install.** The status the app shows is the engine that read the page
  (`ppocr-v5`); the handwriting model not being there is no longer reported as "no model installed".
- `index.html` no longer switches the feature off: `src/hw/hw-availability.js` checks for the reader's files
  (HEAD requests, same origin) and switches it on only where they are installed.
- `app.py` sends COOP and COEP, so the local page is cross-origin isolated and the recognisers may use up to
  four WebAssembly threads (`src/hw/wasm-threads.js`). `NO_ISOLATION=1` leaves the headers out.

Characters wrong, before and after, on the path the pipeline chooses (the line reader for all of these):

| Page | Before | After |
| --- | --- | --- |
| Print style, plain paper | 0.3% | 0.3% |
| Print style, ruled paper with margin line | 2.1% | 2.1% |
| Joined-up style, plain paper | 0.0% | 0.0% |
| Small dense writing, 26 lines | 0.4% | 0.4% |
| Coloured ink on dotted paper | 1.3% | 1.3% |
| Two columns | 36.4% (read across) | 0.0% |
| Simulated phone photo (3.2 degree turn, shadow, blur, grain) | 49.6% | 1.5% (text 0.8%; one stray mark at the sheet edge is read as "7", flagged low) |
| Math lines | 2.0% | 2.0% |
| Uneven writing, print style | 7.3% | 7.3% |
| Uneven writing, joined-up style | 8.2% | 8.2% |

| Ruled print-style page | Before | After |
| --- | --- | --- |
| Clean | 0.8% | 0.8% |
| Turned 1 degree | 0.4% | 0.8% |
| Turned 2 degrees | 16.0% | 0.8% |
| Turned 3.2 degrees | 61.5% | 0.8% |
| Turned 6 degrees | 42.0% | 0.8% |
| Blur only | 0.8% | 0.8% |
| Shadow only | 0.8% | 0.8% |
| Turned 3.2 degrees with a dark surround | 54.6% | 0.8% |

All 18 pages together: 172 pieces with 32 under 0.6 before, 173 pieces with 4 under 0.6 after.

Measured outside the browser (the same worker code and models run in Node on the same images; a development
check, not the app):

- Tile reader with the angle passed in: clean 1.1%, turned 1 / 2 / 3.2 / 6 degrees 0.8% / 3.1% / 1.9% / 2.3%
  (before: 51% to 65%). On the two pages with a shadow or a dark surround the tile survey finds no tiles (the
  dark part counts as ink), as before; those pages are read by the line reader.
- Whole-page turns, line reader: the plain print page, the two-column page and the dense page read the same
  turned by 90, 180 and 270 degrees as upright (0.0% to 0.3%), and 0.0% to 0.9% at 87 and 176 degrees; the phone photo
  turned 90 and 180 degrees reads 1.9% and 1.5%; the uneven pages turned 180 degrees read as upright.

**Confidence and the study text.** Lines by the confidence the reader gave them, all 18 pages:

| Confidence | Before: lines, characters wrong | After: lines, characters wrong |
| --- | --- | --- |
| under 0.6 | 30, 53.1% | 3, 27.3% |
| 0.6 to 0.8 | 6, 3.1% | 3, 3.4% |
| 0.8 to 0.9 | 35, 0.8% | 41, 1.5% |
| 0.9 and over | 98, 2.9% | 125, 1.3% |

After the change the pages with any line under 0.6 are: math 2 of 8 lines (3.3% wrong, both held down by the
math cap, not by the reader), uneven print 1 of 10 (47% wrong), phone photo 1 of 9 pieces (the stray mark).
Every other page has none. On these pages the 0.6 cut keeps everything that was read well and nothing that was
badly wrong; three low lines are far too few to move the cut, and font pages say nothing about where it should
sit for real handwriting.

**Speed.** One page of 26 lines, read five times in one browser session, best warm run of each session. The
laptop was running other work throughout and got busier as the runs went on, so read these as a range:

| Configuration | Seconds for the page, one session each | Seconds per line |
| --- | --- | --- |
| Code before this change, one thread | 7.2, 9.5 | 0.28 to 0.36 |
| After, one thread (`NO_ISOLATION=1`) | 11.8, 7.5, 9.6, 16.2 | 0.29 to 0.62 |
| After, four threads | 4.4, 7.6, 9.4, 11.4 | 0.17 to 0.44 |

Taken in the order they were run, the one-thread and four-thread sessions pair up as 11.8 / 4.4, 7.5 / 7.6,
9.6 / 9.4 and 16.2 / 11.4 s: faster with threads in two pairs, the same in two. The gain from threads is
therefore not established; it needs a quiet machine. Recognition is about 95% of a page's time (measured in
Node: angle 0.06 s, page plan 0.3 s, crops 0.08 s, recognition 13 s for the 26 lines on a busy machine), so
that is where threads could help. Straightening a crooked page adds about half a second (the phone photo:
1.9 s before, 2.6 s after). `crossOriginIsolated` was `true`
with the headers and `false` with `NO_ISOLATION=1`; PDF.js, its worker and the math fonts loaded in both, and
the page made no request to another origin.

What is still not handled:

- A page on its side or upside down is put right only by the line reader. The tile reader gets the measured
  slope (within 15 degrees) and nothing more; canvas pages are drawn exports and are read as given.
- A page whose lines slope by more than 15 degrees and less than a quarter turn is not straightened.
- Keystone (a photo taken at a slant, lines fanning out), curled pages and lines that each slope differently
  are not corrected: one angle is applied to the whole page.
- The angle needs lines to measure. A page with two or three short lines, or mostly drawings, is left as it is.
- On a turned page `box` is the rectangle around the sloping line, so it is taller than the line and can take
  in parts of the lines above and below. `src/pdf/ocr-lines.js` sizes text from `box.h` and the review panel
  cuts its preview from `box`; neither uses `size` or `result.angle` yet.
- The dark surround of a photographed sheet can leave a stray mark at the sheet edge that is read as a
  character (low confidence, so it stays out of the study text).
- `tests/verify_suite.py` step 6 runs the browser smoke test only when the TrOCR files are installed.
- The header of `docs/HANDWRITING.md` still says recognition runs on one thread and that `app.py` sends no
  COOP/COEP headers.
- The fetch script was not run. That `package/dist/ort-wasm-simd-threaded.jsep.mjs` and `package/package.json`
  are in the onnxruntime-web tarball is expected but was not checked against the tarball.

Not measured: any real handwriting, real phone photos, real scans, TrOCR on any of this, the threaded TrOCR path.

## Picture slides: noise, reading after the typed text, remembering, speed (2026-11-18, second pass)

Set-up: only the PP-OCRv5 files installed, headless Edge driven by `tools/eval-canvas.js`, `app.py` with its
COOP/COEP headers (four WebAssembly threads), one laptop that was running other work throughout. Three real
lecture decks were used. They are not in the repository and nothing of their text is reproduced here:

| Deck | Slides | Slides sent to the reader |
| --- | --- | --- |
| A | 51 | 24 |
| B | 85 | 23 |
| C | 45 | 7 |

"Before" is commit 05bf0cf (the four merged branches), run from a copy of that commit.

What changed in the code:

- **Picture noise is discarded before anything is counted or listed** (`src/pdf/ocr-noise.js`). A piece the
  reader produced is dropped when (1) it has fewer than 3 letters and digits, which includes a piece read as
  nothing, or (2) no two letters or digits stand together (a row of isolated symbols), or (3) its confidence is
  under 0.6 and it has neither 2 real words nor 5 letters and digits. What the student typed or confirmed,
  pieces waiting to be typed in, and maths read as something are never dropped. The reader's own result is
  kept whole on the page (`ink.raw`); the stripped copy is what review, counts and study text use.
- **A page of unsure lines is held, a page of fragments is a picture** (`src/pdf/ocr-merge.js`). With at most one
  confident word, a page is held for review when 3 or more unsure line-like pieces remain after the noise
  rule, and is a picture (nothing added, nothing listed) when fewer do. A page that was nothing but noise is a
  picture, not an empty page.
- **Typed text first** (`src/ui/study-pipeline.js`, `study-reading.js`, `background-read.js`, `build-run.js`). When
  a selection has typed text and picture pages, the typed text is built and shown, then the pictures are read
  with a strip above the study pane ("Reading 7 of 24 picture pages…", Stop). Study material is rebuilt every
  8 pages and at the end. The Summary and empty tabs are redrawn in place with scroll and focus kept;
  flashcards, a quiz and a practice test in progress are left alone and the strip offers "Show new material".
  A selection with no typed text is read in the foreground as before.
- **Read pages are remembered** (`src/ui/ocr-cache.js`): the reader's result per page, in the per-document store,
  under the page number and `hwPipeline.READER_VERSION`. Corrections change that result in place and are
  saved with it, so they come back instead of the model's text.
- **A reading that is cut short leaves its page unread.** The lines already read are shown, but the page is
  read again in full later (Stop then "Read the rest", or a newer run), and its unread pieces are never
  listed. A run that was only replaced by a newer one no longer marks its remaining pages as stopped.
- **Speed**: boxes narrower than 1.2 times their height are not sent to the recogniser on PP-OCR pages; a
  slide that also has typed text is known to be upright and is not probed; one probe line read at 0.85 or
  more with real words settles the orientation; probe lines that read as nothing are not read again turned
  over; probes are chosen by shape (longest for their height) instead of by width.
- Text size on a straightened page comes from the line's own height (`region.size.h`), not from the upright
  rectangle around it.
- `main.js` waits (up to 1.5 s) for the availability check before the first build.

**Pieces listed for review.** Counts the app reports (`appState.handwriting`):

| Deck | Before: pieces kept / under 0.6 | After: pieces kept / under 0.6 |
| --- | --- | --- |
| A | 204 / 153 | 60 / 9 |
| B | 169 / 98 | 76 / 5 |
| C | 49 / 40 | 14 / 5 |

On deck A the reader returned 468 pieces over the 24 slides; 389 were under 0.6, and 358 of those had fewer
than 3 letters and digits.

**Time to first study material, and to everything read.** Seconds from the file being parsed to the first
material on screen, and to the last picture page built in. Before, nothing was shown until everything was
read, so the two are the same. Runs are listed in the order they were made; the laptop got busier during
the session, so compare runs made back to back.

| Deck | Before: first = all | After: first material | After: all read |
| --- | --- | --- | --- |
| A | 165.0, 168.7, 175.1 | 7.9, 11.0 | 133.0, 146.1 |
| B | 197.6 | 36.3 | 153.2 |
| C | 35.3, 55.4, 39.9 | 0.8 to 3.5 | 28.8, 46.2, 50.7, 40.2 |

The last "before" and the last "after" of deck A were run back to back (175.1 and 146.1), as were the last
two of each for deck C (55.4 / 50.7 and 39.9 / 40.2). Deck C, with 7 slides to read, shows no difference that
can be told from the noise. The wait for the first material is almost all parsing of the typed pages by the
loader, which this work did not touch: 7.2 of 7.9 s on deck A, 33.8 of 36.3 s on deck B.

Seconds per slide read (time after the first material, divided by the slides read; for "before" the first-
material time of the paired run is taken off): deck A 6.7 to 6.8 before, 5.2 to 5.6 after; deck B 7.0 before,
5.1 after; deck C 4.9 to 7.4 before, 4.0 to 6.8 after.

**Where the time goes on deck A** (summed over the 24 slides; "before" is 05bf0cf with timers added, the
168.7 s run; "after" is the 133.0 s run):

| Step | Before | After |
| --- | --- | --- |
| Drawing the page at 1650 px (main thread) | 10.7 s | 12.3 s |
| Survey, graying and angle (main thread) | 15.1 s | 14.6 s |
| Page plans and the orientation check (worker) | 59.9 s, 33 plans, 149 probe reads | 36.1 s, 26 plans, 63 probe reads |
| Reading the pieces (worker) | 72.3 s, 468 read | 60.8 s, 368 read, 100 too small to read |

One page is drawn once: the same bitmap serves the survey, the angle and the reader. Measured separately on
12 of the slides: drawing 0.59 s, survey 0.28 s, angle 0.22 s, graying 0.03 s a slide. A page plan costs 0.7 to
0.9 s on these slides and a piece about 0.16 s to read. Deck B after: 27 plans, 82 probe reads, 203 pieces
read, 44 not read. Deck C after: 8 plans, 17 probe reads, 78 read, 3 not read.

Tried on the numbers and not built: stopping a page early when its most line-shaped pieces read as noise
would save 26 reads at most on deck A, because most picture slides hold a few real words. Raising the
box-shape limit from 1.2 to 1.5 would leave 29 more boxes unread over the three decks with no kept piece
lost; at 2.0 two kept pieces on deck B are lost.

**Opening a read document again** (the same file opened a second time in the same tab, IndexedDB store):

| Deck | Seconds to all material | Of which parsing typed pages | Reader started | Pages remembered |
| --- | --- | --- | --- | --- |
| A | 9.1 | 8.6 | no | 24 of 24 |
| B | 60.1 | 57.6 | no | 23 of 23 |
| C | 3.3 | 2.7 | no | 7 of 7 |

The counts and the generated material were the same as after the first reading. Parsing deck B took longer
the second time in the same tab (57.6 s against 33.8 s); a fresh tab was not measured. The memory-only store
(private window) is covered by Node fixtures only.

**Accuracy on the font-drawn pages** (`tools/eval-handwriting.js`, the same pages as the section above;
characters wrong, all pieces):

| Page | Before | After |
| --- | --- | --- |
| Print style, plain paper | 0.3% | 0.3% |
| Print style, ruled paper | 2.1% | 2.1% |
| Joined-up style | 0.0% | 0.0% |
| Small dense writing | 0.4% | 0.4% |
| Coloured ink on dotted paper | 1.3% | 1.3% |
| Two columns | 0.0% | 0.0% |
| Simulated phone photo | 1.5% | 0.8% (the stray mark is now discarded) |
| Math lines | 2.0% | 2.0% |
| Uneven writing, print style | 7.3% | 7.3% |
| Uneven writing, joined-up style | 8.2% | 8.2% |
| Ruled page: clean, turned 1 / 2 / 3.2 / 6 degrees, blur, shadow, dark surround | 0.8% each | 0.8% each |

A first version of the noise rule (unsure pieces kept only with 2 words or 6 letters) dropped the two unsure
formula lines of the math page and took it to 17.5%; the rule now keeps an unsure piece with 5 letters and
digits. On deck A only 2 of the 389 unsure pieces reach 5 without being a line.

**The strip in the browser** (headless Edge, deck A, 1280 and 375 px wide): no horizontal overflow at either
width; with a quiz question answered, the quiz markup, its position and the focused button were unchanged
after an in-between rebuild; Stop ended the reading within a second and the notice offered "Read the rest";
"Show new material" moved the focus to the active tab; reading the rest ended with the same counts as an
uninterrupted run (24 pages, 60 pieces, 9 under 0.6); no console errors.

What is still not handled:

- The notice and the review panel are worded in `src/ui/hw-review.js`, which this pass did not edit: the
  notice still says "from handwriting" and counts "pieces".
- A slide read takes about 5 s. Most of it is the reader's work on photographs: a plan of the page, and
  reading every box that could be text. Running PP-OCR's own text detector on picture slides, instead of the
  page plan made for handwriting, was not tried.
- Parsing the typed pages dominates the wait for the first material and the whole reopen time; it is the
  loader's cost and was not looked into.
- Flashcards and a quiz are never redrawn by a background update, even untouched ones: the view cannot tell
  whether the student has started.
- The remembered results are invalidated by hand: `READER_VERSION` in `src/hw/hw-pipeline.js` must be changed
  whenever the models, the page preparation or the reading rules in `src/hw/` change.
- The box-shape limit (1.2) and the hold limit (3 unsure lines) are judgements checked on three decks and the
  font-drawn pages, not fitted to data.
- `tools/smoke-handwriting.js` cannot start Edge from Git Bash on this machine; it now reports that as "could
  not run" (exit code 2) and `tests/verify_suite.py` step 6 says it was skipped. From PowerShell it runs.

Not measured: real handwriting, a held page of real handwriting, the hosted page, a private window in a real
browser, a phone, one-thread speed on these decks. The fetch script was not run.

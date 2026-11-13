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

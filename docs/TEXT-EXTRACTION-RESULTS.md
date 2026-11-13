# Text extraction on every kind of page: results (2026-11-12)

**Short version.** Three kinds of page were measured before and after this round of work, each with its own
tool and its own fixtures, all offline.

| Source | Measure | Before | After |
| ------ | ------- | ------ | ----- |
| Digital textbook, 54 pages plus the sample PDFs | defects in exercise text | 290 | 32 |
| Digital textbook, same pages | defects in the text that feeds summaries | 24 | 4 |
| Scanned print, 4 scored pages | characters wrong | 38.0% | 24.4% |
| Scanned print, the three clean pages | characters wrong, per page | 1.7%, 59.9%, 9.0% | 1.7%, 1.7%, 4.2% |
| Handwriting, 17 real pages | characters wrong | 40.5% | 40.0% |
| Handwriting, 17 real pages | pieces read that match no line | 8 | 3 |

Clean printed pages are now read well, including two columns and a ruled table. Handwriting barely moved:
the recognition model is still the limit there (`docs/HANDWRITING-RESULTS.md`).

## 1. Digital PDFs (selectable text)

- **Tool:** `node tools/eval-text.js`. It runs 23 page ranges of a calculus textbook (54 pages: prose, worked
  examples, exercise sets, review pages, chapter openers, table pages, appendix, index; the book is found through
  `LARSON_PATH` in `app.py` and is not part of the repository) and every page of the sample PDFs through the real
  pipeline, and counts defects in the output. `--show=<counter>` lists the offending lines.
- **Before** = commit 60bf493 measured with the same tool. Counts are lines with the defect.

| | Lines | Running heads | Graph labels | Broken hyphens | Out of order | Sub-parts | Math | Glued words | Merged cells |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Summary text, before | 1551 | 0 | 2 | 4 | 0 | 0 | 8 | 6 | 4 |
| Summary text, after | 1547 | 0 | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Exercise text, before | 1778 | 0 | 246 | 1 | 17 | 5 | 20 | 1 | 0 |
| Exercise text, after | 1508 | 0 | 20 | 0 | 1 | 5 | 6 | 0 | 0 |

"Merged cells" is counted in the raw page lines. On 40 further pages that no rule was tuned on
(`--pages=205-209,246-247,296-299,476-479,553-555,584-589,625-627,664-669,726-728,744-747,762-764`) graph labels
in exercise text fell from 513 to 34, order breaks from 27 to 2, math defects from 24 to 17 and merged table
cells from 15 to 0.

What changed:

- Axis ticks and lone variables from graphs are removed from exercise sets too; numbered items and "(b)"
  sub-items are protected.
- Numbered exercise grids (33 | 34 above 35 | 36) are read item by item; two separate lists side by side stay
  columns.
- The "x → −3" under a limit is no longer taken as the index of a root on the row below.
- Prose inside a formula is set apart: "f(x)atx" becomes "$f(x)$ at $x$".
- Missing spaces come back ("theTangent", "strokes.This") and number cells in a table row stay apart.
- Words hyphenated at a line break are joined in margin notes and exercise text as well.

Still wrong: exercise text is built and tested but nothing in the app shows it yet; a price such as "$12.80" in
prose still opens a math span; tables are left out of summaries on purpose, and a table with a ruled header can
come out as a fraction; a real compound broken at a line end loses its hyphen ("second-degree" becomes
"seconddegree"); five "(a) … (a) …" rows remain merged. One textbook is a small sample: layouts of other
publishers were not measured.

## 2. Scanned printed pages (no text layer)

A page with no selectable text goes to the handwriting reader, whatever is on it. That model was trained on
handwriting but reads clean print well; what failed before was the layout around it.

- **Images:** `python tools/make-scan-fixtures.py <folder>` draws three printed pages with known text (single
  column with running head; two columns under a title; a handout with bullets, numbered steps and a ruled table),
  turned a fraction of a degree, blurred and grained like a flatbed scan. Two real textbook pages rendered to
  images were added by hand (a preface page with screenshots, scored against its own text layer; a math page,
  not scored). They are copyrighted and stay in the git-ignored `vendor/hw/` folder.
- **Tool:** `node tools/eval-handwriting.js <folder> --out=<results>`, the same as for handwriting.

| Page | Characters wrong before | after | Words wrong before | after | Kept text wrong before | after |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Single column | 1.7% | 1.7% | 5.8% | 5.8% | 6.3% | 4.6% |
| Two columns | 59.9% | **1.7%** | 77.5% | **6.6%** | 59.9% | **1.7%** |
| Bullets, steps, table | 9.0% | **4.2%** | 22.2% | **16.0%** | 23.2% | **6.3%** |
| Real preface page with screenshots | 50.4% | 50.4% | 72.0% | 72.0% | 12.4% | 12.6% |
| **All four** | 38.0% | **24.4%** | 53.3% | **35.8%** | 22.8% | **7.8%** |

"Kept text" is what passes the confidence check and reaches summaries, flashcards and quizzes. Pieces flagged
low: 47% before, 43% after. About 1.6 seconds per piece on one laptop; a dense book page is 100 or more pieces,
so close to three minutes a page. The table page was run again after the last rule fix; the other pages were
run just before it, and their boxes do not change with it.

What changed (`docs/HANDWRITING.md`, section 11): columns are read left then right instead of joined across
(the whole gain on the two-column page); table borders on a slightly turned scan are erased completely, so cells
are no longer read with stray letters; short headings such as "Solving a problem" are not held back as
math-looking; bullets read as "#" are shown as bullets; a printed page may hold up to 320 pieces before it is
skipped as clutter (the limit for handwriting stays 120).

Still wrong:

- **Pages with pictures.** On the real preface page the body text is read well, but the text inside two
  screenshots and the 5-point copyright lines come back as 41 junk pieces, and a pale heading is not found.
  Most of the junk is flagged low (kept text is 12.6% wrong), but the page needs checking.
- **Printed math is not read.** On the real math page display equations come back as nonsense and are flagged.
  Margin figures and their labels are mixed into the lines beside them: a margin column is only split off when
  it holds four or more full lines of text.
- **Capital letters and full stops** are sometimes dropped ("quantity symbol unit"), and long unusual words are
  misread ("Mitochonda", "rhosomes").
- It is slow, and there is no dictionary or spelling repair.
- Three drawn pages and two real ones are a small sample. Photographed pages, coloured backgrounds and other
  typefaces were not measured.

## 3. Handwritten pages

Same 20 pages, tool and scoring as `docs/HANDWRITING-RESULTS.md`; "before" is that document's "after".

| | Before | After |
| --- | --- | --- |
| Real pages, characters wrong | 40.5% | 40.0% |
| Real pages, words wrong | 69.9% | 69.4% |
| Pieces that match no real line (17 pages) | 8 | 3 |
| Real lines not found (of 278) | 8 | 8 |
| Church letter with printed letterhead | 46.9% | 38.0% |
| St Jude letter | 25.8% | 21.9% |
| Recipe card | 41.3% | 41.9% |
| 1880s lecture notes | 30.8% | 31.1% |
| Synthetic pages, characters wrong | 0.8% | 0.8% |

- **Letterhead.** The printed name, address and phone line on the church letter are no longer read (three
  pieces), and one printed line on the St Jude letter. The other 15 real pages lost nothing.
- **Short lines.** "do this." on the Gettysburg page now passes the confidence check instead of being capped
  as math-looking. Only five of 293 matched lines were capped this way, so the effect on handwriting is small.
- **Small losses.** The recipe card and the lecture notes are 0.6 and 0.3 points worse; the likely cause is the
  stricter rule removal taking a few stroke pixels on ruled paper (not confirmed). Real text passing the
  confidence check went from 18.2% to 17.4% of the reference.
- The printed time stamp on the tablet page is still read: in the browser its box did not pass the print test.
- Everything listed under "What is still wrong" in `docs/HANDWRITING-RESULTS.md` still holds. Sloping drafts,
  cursive and handwritten math were not improved.

## Not verified

- One browser (Edge) on one Windows laptop. Timings were taken while other programs were running.
- The print and column rules were tuned on these pages; there is no held-out set for scans.
- No photographs of printed pages, no non-English text.

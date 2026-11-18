# Question-quality corpus

`tools/eval-quiz.js` generates the quiz, practice test and flashcards for every document in
`manifest.json` the way the app does, lints every question, and prints a defect score per document.
`baseline.json` is a saved run; later runs are compared against it. `baseline-before.json` is the run of
the generator as it was before the question rewrite (antonym-swap True/False, keyphrase cloze), scored with
the lints as they are now, kept so the size of that change stays measurable. `baseline-before-subjects.json`
is the run of the generator before subject-aware questions (lecture-point attribution stems, sibling-swap
True/False, a practice test that re-asked the quiz), scored with the content lints added at the same time.

The shape lints alone once passed 251 of 255 questions from twelve real documents that an independent
reviewer graded 55 GOOD / 116 OK / 84 BAD. The content lints and the quiz/test overlap check below exist
because of that review; `tools/eval-quiz-grades.js` replays such a human grading against the current build.

The eight passages in `text/` are **authored stand-ins**: written for this eval to imitate real student
material (dense prose with pronouns, math, bold terms, hand-typed notes). They are not excerpts from
real books or lecture notes. Real PDFs can be added as entries at any time.

## Run

```
node tools/eval-quiz.js                                        # score every document
node tools/eval-quiz.js --baseline=tests/corpus/baseline.json  # deltas; exit 1 if total defect % rose > 2 points
node tools/eval-quiz.js --out=tests/corpus/baseline.json       # save a new baseline (after a deliberate change)
node tools/eval-quiz.js --only=notes --show=whole_block_stem   # one document group, offending questions for one lint
node tools/eval-quiz.js --show=all                             # every offending question
node tests/eval_quiz_lint_fixtures.js                          # unit checks for the lints themselves
node tools/eval-quiz-grades.js --grades=tests/corpus/grades-example.json --show
                                                               # human-graded questions the build still asks
```

`eval-quiz-grades.js` takes a JSON array of `{ doc, kind: 'quiz' | 'test', grade: 'GOOD' | 'OK' | 'BAD',
reason, stem, answer }` (`doc` is a manifest entry id, `stem` the question text as generated) and reports,
per grade, how many of the graded questions the current build still generates (same stem and answer, case
and punctuation ignored). `--show` lists every BAD question that is still generated. Grades of real,
copyrighted documents are kept outside the repository (with a local manifest, `--corpus=...`);
`grades-example.json` is a synthetic example over the stand-in corpus.

Exit codes: 0 ok, 1 regression against the baseline, 2 the tool itself failed.

## What is printed

| Line | Meaning |
| --- | --- |
| questions | generated vs requested (quiz of 10 plus practice test of 20), and questions per 1,000 words of scope text |
| defective | questions with at least one lint finding; the quiz and the test are both counted, as the app shows both |
| test overlap | practice-test questions that re-ask a quiz fact without saying so; "+N flagged review" counts those the test marks `review: true` (it came back to a quiz fact, in another question type, after its other facts ran out) — those are not defects |
| recall | self-graded questions (type `reveal`: recall, a lecture question to reveal, steps to list) in the quiz and in the test; the engine keeps them within a third of a set that also holds choice questions |
| lints | number of questions each lint flagged |
| flashcards | cards generated |
| gold terms | share of the entry's `goldTerms` that appear as a flashcard front or a question answer (whole words, crude stemming; fronts and answers over 8 words are ignored) |
| guessable | accuracy of a solver that never reads the subject, against blind guessing |
| missing | gold terms with no card and no question |

The solver answers True/False with "False" when the statement contains an antonym-pair word and "True"
otherwise. For multiple choice it picks the only option that fits `a`/`an` before the blank, else the only
option whose capitalisation fits the blank's position, else an option much longer than the rest; with no
tell it does not guess and is credited with chance.

## Lints

All lints are word-list and suffix heuristics (`tools/eval-quiz-text.js`), not a parser. They are for
measuring a direction, not for judging a single question.

| Lint | Flags |
| --- | --- |
| `unresolved_reference` | `this/these/those/such` + noun, `that` + noun at the start or after a preposition, bare `this/these/those` as a subject, `it/they/them/its/their` with no earlier noun phrase in the stem, `above/below/the following/as shown` |
| `cloze_leading_blank` | the blank opens the statement and a discourse word or bare verb follows |
| `thin_stem` | fewer than 6 content words left after blanking (a formula counts as one) |
| `option_not_noun_phrase` | a short option starts with a verb, clause gerund, adverb or preposition, or ends in a verb, preposition/particle or determiner |
| `option_case_mix` | options mix leading capitals and lower case |
| `option_number_mix` | the stem demands singular or plural and only some options comply |
| `option_article_mismatch` | `a`/`an` before the blank fits only some options |
| `answer_length_tell` | one option is 1.5x and 10+ characters longer than every other |
| `answer_leak` | a content word of the answer also appears in the stem (words shared by all options are ignored; a self-graded question without options is not linted, since a definition of X naturally contains X) |
| `tf_copied_true` | a True statement identical to a source sentence, unless it is a sibling-swap True (`construction: 'sibling_swap'`) that follows a sibling-swap False in the same set |
| `tf_antonym_swap` | a False statement one antonym-pair word away from a source sentence |
| `tf_double_antonym` | the statement contains the same antonym-pair word twice |
| `malformed_math` | an option starting with `-$`, an odd number of `$`, or formula options beside prose options |
| `duplicate_fact` | an earlier question of the same set tests the same fact (stem + answer overlap) |
| `reused_option_set` | an earlier question of the same set offered the same options |
| `whole_block_stem` | stem over 300 characters, a bullet glyph, or two or more run-together note separators (` - `, ` = `, ` -> `) |
| `attribution_stem` | the stem asks where a line sat: "the lecture", "this slide", "lecture point", "which topic is this point about" |
| `generic_subject` | the subject the stem names (its `subject` field, else the first quoted phrase) is an organising heading ("Pharmacokinetics", "Overview", "Diagnosis", "Types of ...") or a short line the scope prints under two or more different titles |
| `options_same_subject` | a statement distractor names the stem's subject, or sits on a slide-sized block titled with the subject: it is probably true as well |
| `tf_false_true_of_subject` | a False statement that the scope prints under the same subject (a slide titled with it, or a clause that names it) |
| `bad_definition` | a definition (answer, or shown statement) that contains its own term, or leans on "this condition", "here,", "of this type" |
| `garbled_token` | a token of the stem or answer that is not word-shaped and that the scope prints only there (recognition or table debris) |
| `filler_subject` | case signalment ("8y/o M/N"), or a person or place named in a biography or example sentence, in a scope that is not a history text |
| `quiz_test_overlap` | a practice-test question whose fact the quiz of the same scope already asks (same `factKey` or source, or the `duplicate_fact` overlap); reported per document as "test overlap" |

Repeats are looked for inside the quiz and inside the test separately; repeats across the two are
`quiz_test_overlap`. The practice test refuses every fact its quiz asks, so a scope with few facts gets a
shorter test rather than the quiz again; only when its own facts run out does it add a "Review" section
that asks quiz facts in another question type, each flagged `review: true` (counted apart, not as overlap). A test True/False that borrows a statement the quiz showed, to ask
whether it belongs to another subject, is a different fact by its `factKey`, but `quiz_test_overlap` still
counts it when the words match: the lint stays stricter than the engine.

Known false positives and blind spots:

- The content lints judge a subject by its words and the scope's layout, not by knowledge: "Cats: Dipylidium" offered against a drug whose slides say "all tapeworms in dogs and cats" is true of it too, and no lint sees that. A human-graded sample (`eval-quiz-grades.js`) is the check for that.
- `generic_subject` only knows a closed list of headings and headings repeated under several titles; a one-off organising title ("Vascular events") passes.
- `garbled_token` only sees tokens that are not word-shaped; a recognised word printed once ("purplezy") passes.

- `option_case_mix` flags a proper noun beside common nouns ("Louis XVI" vs "royal family"); that is still a tell, but not a generation bug.
- `unresolved_reference` flags "those present during learning" (resolved in the same sentence), and misses a pronoun whose antecedent is absent when any other noun precedes it ("George Miller estimated that it holds ...").
- `option_not_noun_phrase` reads only the first and last word and knows a fixed verb list: it misses "chain backs" and "complexes pump protons", and flags adjective phrases such as "orthogonally diagonalizable".
- `thin_stem` flags short but answerable definitions ("The geometric multiplicity is the dimension of its ____").
- `tf_copied_true` cannot tell a sound sibling-swap True from a copied one by its text, so it relies on the `construction` field the engine sets; a True/False from any other builder is still flagged when it copies the source.
- `option_not_noun_phrase` flags a term that opens with an adverb even when the book itself uses it as a noun phrase ("partially filled array").
- `whole_block_stem` flags a lecturer's own question that lists its candidates as bullets.
- `whole_block_stem` counts LaTeX source, so a long formula-heavy theorem can pass 300 characters.
- `looksPlural` is by suffix: "series" and "analysis" are misread.

## Add a document

Add an entry to `manifest.json` (paths are relative to the repository root), then save a new baseline.

```json
{ "id": "bio-ch7", "kind": "pdf", "path": "tests/corpus/pdf/biology-ch7.pdf", "pages": [3, 9], "mode": "book",
  "goldTerms": ["glycolysis", "Krebs cycle"] }
```

```json
{ "id": "my-notes", "kind": "text", "title": "Week 4 notes", "path": "tests/corpus/text/my-notes.txt",
  "goldTerms": ["ionic bond"] }
```

- `kind: "pdf"` runs the full pipeline as `tools/run-pdf.js` does; `mode` is `book`, `slides`, or omitted to use the classifier; `pages` defaults to the whole file. The scope text the lints read is the textbook scope text, or a deck's slide titles, bullets and table text (a table header is printed on the slide, so `garbled_token` does not count its words as debris).
- `kind: "text"` feeds the passage straight to the quiz, test and flashcard engines in textbook mode, with no didactic blocks or sections (a `.txt` has no page layout).
- `goldTerms` is optional: the terms a teacher would expect a card or a question for.
- Set `"authored": true` on text you wrote yourself. Only add PDFs you are allowed to commit.

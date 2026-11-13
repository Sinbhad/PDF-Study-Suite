# Math font: STIX Two

Decision: **STIX Two Math** (symbols, operators, script and blackboard letters) with **STIX Two Text Italic / Bold**
(true italic variables and `\mathbf`), self-hosted, wired through `--font-math` and `--font-math-italic` in
`styles/math.css`.

## Why

A math font has only an upright face; `font-style: italic` on it would be a synthesised slant. Variables therefore use
a real italic text face from the same family (designed to match the math font), while operators, digits, functions
and `\mathcal` stay upright in the math font.

| Candidate | Licence | Official WOFF2 | Notes for this app |
|---|---|---|---|
| STIX Two Math (+ Text) | SIL OFL 1.1 | Yes, in repo at tag v2.13 (`fonts/static_otf_woff2/`); math 552 KB, italic 147 KB, bold 146 KB | Times-like but with sturdier strokes and a larger x-height, so it holds up at 15-18px and at 0.72em scripts; full Greek, script (U+1D49C), blackboard bold, very wide symbol coverage; true italic and bold companions exist |
| Libertinus Math | SIL OFL 1.1 | Releases are zip/OTF; no WOFF2 in repo | Elegant but lighter and calligraphic; thin hairlines suffer at small sizes in dark theme |
| Latin Modern Math | GUST Font Licence (OFL-like) | OTF only from GUST | The TeX look, but thin strokes and small x-height read poorly on screens at 15px; ~700 KB |
| Fira Math | SIL OFL 1.1 | OTF in repo | Sans math; sits well beside the UI sans but its italic variables and Greek are less textbook-like, and coverage of calligraphic forms is thinner |
| New Computer Modern Math | GUST Font Licence / OFL variants | OTF on CTAN | Latin Modern with more weights and coverage; same screen-thinness issue, larger files |

Caveat: this comparison is by design knowledge and the official pages, not rendered side by side in the app (no font
files were downloaded, by rule). STIX Two was chosen for screen legibility, the in-repo official WOFF2 files, the
OFL licence and the matching italic. If the owner prefers another look after fetching, only the `@font-face` and
fetch table change.

## Wiring

- `@font-face` families `"PDF Study Math"` (Math Regular), `"PDF Study Math Text"` (Italic 400, Bold 700), each with
  `local()` first, then `url("../vendor/fonts/stix-two/...woff2")`, `font-display: swap`.
- `--font-math`: "PDF Study Math", "STIX Two Math", "Cambria Math", "Latin Modern Math", "Noto Sans Math",
  "STIX Two Text", Cambria, "Times New Roman", Times, serif.
- `--font-math-italic`: "PDF Study Math Text", "STIX Two Text", Cambria, "Times New Roman", Times, serif.
- A missing file gives a quiet 404 and the next family; layout does not depend on the font (no fixed widths).
- `.math-cal`: the renderer maps `\mathcal{A}` capitals to Mathematical Script code points (with the Letterlike
  exceptions ℬ ℰ ℱ ℋ ℐ ℒ ℳ ℛ); the CSS uses `var(--font-math)`. No script or cursive font anywhere.

## Fetching and checksums

`python tools/fetch-math-font.py [--dry-run]` downloads from `raw.githubusercontent.com` at pinned commit
`37308d44583ef882dc8b544aaa2e80ac8c406ebf` (tag v2.13) and verifies each file against the **git blob SHA-1 and size**
that GitHub's contents API publishes for that tag (not SHA-256; that is all the official source provides). It also
fetches `OFL.txt`, overwriting the committed copy byte-exact. On mismatch it deletes the partial file and exits 1. The
`--trust-on-first-use` flag exists for any future table row without a published checksum.

The values in the script were read through a summarising fetch of the API, so run
`gh api repos/stipub/stixfonts/contents/fonts/static_otf_woff2?ref=v2.13` once to confirm them; a wrong value
makes the script fail closed rather than install anything.

## Sources

- Repo and releases: https://github.com/stipub/stixfonts (tag v2.13, commit above)
- Licence at tag: https://raw.githubusercontent.com/stipub/stixfonts/v2.13/OFL.txt
- Contents API: https://api.github.com/repos/stipub/stixfonts/contents/fonts/static_otf_woff2?ref=v2.13
- SIL OFL 1.1 and FAQ: https://openfontlicense.org/ and https://scripts.sil.org/OFL
- Alternatives: https://github.com/alerque/libertinus, https://www.gust.org.pl/projects/e-foundry/lm-math,
  https://github.com/firamath/firamath, https://ctan.org/pkg/newcomputermodern

Note: the committed `OFL.txt` is the byte-exact official file (git blob `96aa460dcb14080b868f0d389867ddfbd54e785f`
at the pinned commit); the fetch script re-downloads and re-verifies it. The three `.woff2` files are committed
beside it. Rendering was checked from browser screenshots in the light and dark themes and at 390px wide.

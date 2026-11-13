# STIX Two (math font)

Self-hosted math font for `--font-math` in `styles/math.css`. Licence: SIL Open Font License 1.1 (`OFL.txt`).

Version: STIX Fonts v2.13 (commit `37308d44583ef882dc8b544aaa2e80ac8c406ebf`).
Source: https://github.com/stipub/stixfonts (directory `fonts/static_otf_woff2/`).

Files that belong in this folder (the CSS expects exactly these names):

- `STIXTwoMath-Regular.woff2` (math symbols, operators, script and blackboard letters)
- `STIXTwoText-Italic.woff2` (true italic for variables)
- `STIXTwoText-Bold.woff2` (for `\mathbf`)
- `OFL.txt` (licence, byte-exact copy of the official file)

All four are committed and match the checksums pinned in `tools/fetch-math-font.py`, which can re-download and
verify them (`--dry-run` to preview). If the files are ever missing the app falls back to system math fonts.

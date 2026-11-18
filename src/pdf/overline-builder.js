/**
 * Overline Builder for formula-builder.js (100% offline, deterministic).
 * Complement / negation bars (Boolean X̄, logical p̄, a mean x̄) are drawn as short vector rules just above
 * a glyph, not as text, so without this step "its complement X̄" reads "its complement X".
 * A rule left over after fractions and radicals took theirs becomes \overline{...} over the spans it covers
 * when nothing sits above it (a numerator would make it a fraction bar) and it spans the glyphs it covers.
 * Plain text gets the prime form (X̄ -> X'), the usual typed spelling of a complement.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const ML = () => PDFStudy.mathLine || (typeof require === 'function' ? require('./math-line.js') : null);

  const BAR_LOW = 0.6; // x font size: smallest rule height above the covered baseline (just over x-height)
  const BAR_HIGH = 1.05; // x font size: largest (just over cap height plus a hairline gap)
  const EDGE = 1.5; // pt: covered glyphs lie within the rule's ends, up to this slack
  const MIN_COVER = 0.6; // the rule spans at least this share of the covered glyphs' width
  const MAX_OVERHANG = 0.6; // x font size: a complement bar ends close to its glyphs (axis and box lines run on)
  const MAX_CHARS = 20; // longer "covered" runs are table rules, not a complement (X̄₁ + X̄₂ + ⋯ + X̄ₙ is 13)
  const VARIABLE_RE = /^[A-Za-z0-9'′()+·⋅⋯…\s]*[A-Za-z][A-Za-z0-9'′()+·⋅⋯…\s]*$/; // a bar complements variables
  const OPERAND_RE = /^[A-Za-z0-9'′()+·⋅⋯…\s]+$/; // one covered span: a variable, a constant or an operator
  const NESTED_RISE = 0.45; // x font size: a second bar (double complement X̿) sits this much higher at most
  const NUMERATOR_SHARE = 0.6; // a numerator lies mostly over the rule
  const ROW_GAP = 0.9; // x font size: a span this close on the same baseline continues the row

  /** Share of span s's width that lies over rule r. */
  function overlapShare(s, r) {
    const w = Math.max(0.1, s.x1 - s.x0);
    return Math.max(0, Math.min(s.x1, r.x1) - Math.max(s.x0, r.x0)) / w;
  }

  /**
   * True when span s is one piece of a longer row: the run of spans on its baseline, each within ROW_GAP of
   * the next, reaches past the rule's ends. A numerator or denominator stands alone over or under its bar;
   * a barred variable in "X + X̄ = 1" or in prose has the rest of its row beside it.
   */
  function onLongerRow(s, spans, r) {
    const fs = s.fontSize || 10;
    // Measured with the smaller size, so a tall delimiter beside a numerator never reaches the axis row
    const row = spans.filter((o) => Math.abs(o.baselineY - s.baselineY) < Math.min(fs, o.fontSize || fs) * 0.3);
    const run = new Set([s]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const o of row) {
        if (run.has(o)) continue;
        if ([...run].some((m) => o.x0 < m.x1 + fs * ROW_GAP && o.x1 > m.x0 - fs * ROW_GAP)) {
          run.add(o);
          grew = true;
        }
      }
    }
    return [...run].some((o) => o.x1 <= r.x0 + 0.5 || o.x0 >= r.x1 - 0.5);
  }

  const isBarred = (s) => typeof s.tex === 'string' && s.tex.startsWith('\\overline{');
  /** What the prime applies to: one variable or an already-primed one as is, anything longer in parentheses. */
  function primeOperand(plain) {
    if (/^[A-Za-z0-9](?:_\w+_?)?'*$/.test(plain)) return plain;
    if (/^\(.*\)$/.test(plain)) {
      let depth = 0;
      const closesAtEnd = [...plain].every((ch, i) => {
        depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
        return depth > 0 || i === plain.length - 1;
      });
      if (closesAtEnd) return plain;
    }
    return `(${plain})`;
  }

  const SPLIT_SLACK = 0.35; // x one glyph's width: a bar end this close to a glyph boundary falls on it

  /**
   * A bar over part of one text item ("XY" with a bar over the Y only, as in XY + XȲ) needs that item cut
   * at the bar's ends. Glyph boundaries are estimated from the item's width shared evenly among its letters
   * (variables in one italic face are close in width); a bar end that falls mid-glyph cuts nothing.
   */
  function splitUnderRule(spans, r, atBarHeight) {
    let out = spans;
    for (const s of spans) {
      const t = s.tex ? '' : (s.text || '').trim();
      if (!/^[A-Za-z0-9]{2,}$/.test(t) || !atBarHeight(s)) continue;
      if (s.x1 <= r.x0 || s.x0 >= r.x1 || (s.x0 >= r.x0 - EDGE && s.x1 <= r.x1 + EDGE)) continue;
      const w = (s.x1 - s.x0) / t.length;
      const k0 = Math.max(0, Math.round((r.x0 - s.x0) / w));
      const k1 = Math.min(t.length, Math.round((r.x1 - s.x0) / w));
      if (k1 <= k0) continue;
      const fits = (k, x) => (k === 0 && x <= s.x0) || (k === t.length && x >= s.x1) || Math.abs(x - (s.x0 + k * w)) <= w * SPLIT_SLACK;
      if (!fits(k0, r.x0) || !fits(k1, r.x1)) continue;
      const piece = (a, b) => ({ ...s, text: t.slice(a, b), x0: s.x0 + a * w, x1: s.x0 + b * w });
      const parts = [[0, k0], [k0, k1], [k1, t.length]].filter(([a, b]) => b > a).map(([a, b]) => piece(a, b));
      out = out.filter((o) => o !== s).concat(parts);
    }
    return out;
  }

  function overlines(spans, rules, used) {
    let out = spans;
    // Lowest rules first, so the inner bar of a double complement is placed before the outer one
    for (const r of rules.slice().sort((a, b) => b.y - a.y)) {
      if (used.has(r)) continue;
      const atBarHeight = (s) => s.baselineY - r.y >= s.fontSize * BAR_LOW &&
        s.baselineY - r.y <= s.fontSize * (BAR_HIGH + (isBarred(s) ? NESTED_RISE : 0));
      out = splitUnderRule(out, r, atBarHeight);
      const core = out.filter((s) => (!s.tex || isBarred(s)) && s.x0 >= r.x0 - EDGE && s.x1 <= r.x1 + EDGE && atBarHeight(s));
      // Subscripts of barred variables (X̄₁ + X̄₂) sit lower and smaller than the letters but under the same bar
      const coreFs = core.length ? Math.max(...core.map((s) => s.fontSize)) : 0;
      const coreBase = core.length ? Math.max(...core.map((s) => s.baselineY)) : 0;
      const scripts = out.filter((s) => !s.tex && !core.includes(s) && s.x0 >= r.x0 - EDGE && s.x1 <= r.x1 + EDGE &&
        s.fontSize <= coreFs * 0.85 && Math.abs(s.baselineY - coreBase) <= coreFs * 0.6 && /^[0-9a-z]{1,2}$/.test((s.text || '').trim()));
      const covered = core.concat(scripts);
      // Operator spans ("+", "⋅") may sit under the bar between variables, but the run must hold a variable
      if (!covered.length || !covered.every((s) => isBarred(s) || OPERAND_RE.test((s.text || '').trim()))) continue;
      const run = covered.map((s) => (isBarred(s) ? 'X' : (s.text || '').trim())).join(' ');
      if (/[a-z]{3,}/.test(run)) continue; // a word under a rule is a heading or a table entry, not a variable
      if (!VARIABLE_RE.test(run) && !/^[01]$/.test(run)) continue; // a lone 0 or 1: a complemented constant
      // An outer bar sits above the inner one (a double bar is two strokes about 1pt apart), never level with it
      if (covered.some((s) => isBarred(s) && r.y > s.barY - 0.5)) continue;
      const span = Math.max(...covered.map((s) => s.x1)) - Math.min(...covered.map((s) => s.x0));
      if ((r.x1 - r.x0) - span > Math.max(...covered.map((s) => s.fontSize)) * MAX_OVERHANG) continue;
      const fs = Math.max(...covered.map((s) => s.fontSize));
      // A numerator sits over the rule's own extent; the previous line of prose or a table row above runs
      // well past it, so it never makes the rule a fraction bar.
      const above = out.some((s) => !covered.includes(s) && s.x1 > r.x0 && s.x0 < r.x1 && r.y - s.baselineY > 0 &&
        r.y - s.baselineY <= fs * 1.35 && overlapShare(s, r) >= NUMERATOR_SHARE && !onLongerRow(s, out, r));
      if (above) continue;
      const x0 = Math.min(...covered.map((s) => s.x0));
      const x1 = Math.max(...covered.map((s) => s.x1));
      const chars = covered.reduce((n, s) => n + (s.plain || s.text || '').trim().length, 0);
      if (!chars || chars > MAX_CHARS || r.x1 - r.x0 < (x1 - x0) * MIN_COVER) continue;
      const ordered = covered.slice().sort((a, b) => a.x0 - b.x0);
      const inner = ML().spansToTex(ordered);
      const plainInner = ML().spansToPlain(ordered).trim();
      used.add(r);
      const base = core[0];
      const made = {
        ...base, tex: `\\overline{${inner}}`, plain: `${primeOperand(plainInner)}'`, barY: r.y,
        isMath: true, x0, x1, topY: Math.min(r.y, ...covered.map((s) => s.topY)), bottomY: Math.max(...covered.map((s) => s.bottomY)),
        baselineY: coreBase, fontSize: fs,
      };
      made.text = made.plain;
      const gone = new Set(covered);
      out = out.filter((s) => !gone.has(s)).concat([made]);
    }
    return markLostBars(out, rules, used);
  }

  const LOST_MARK = '¿'; // summary-statements.mathDamage reads it as notation known to be damaged
  const MAX_BAR_W = 60; // pt: a complement bar spans a few glyphs; longer rules are table and box lines

  /**
   * A short rule just above letters that no step above could place (it starts or ends mid-glyph, or covers
   * prose) is still a complement bar: the letters under it are marked as damaged rather than printed bare,
   * since "Q = 1 and Q = 0" without its bar teaches something false. Table rules drawn cell by cell are
   * collinear with a neighbouring segment and are left alone.
   */
  function markLostBars(spans, rules, used) {
    for (const r of rules) {
      if (used.has(r) || r.x1 - r.x0 > MAX_BAR_W) continue;
      if (rules.some((q) => q !== r && Math.abs(q.y - r.y) < 0.8 && (Math.abs(q.x0 - r.x1) < 1.5 || Math.abs(q.x1 - r.x0) < 1.5))) continue;
      const under = spans.filter((s) => !s.tex && /[A-Za-z]/.test(s.text || '') && s.x1 > r.x0 + 1 && s.x0 < r.x1 - 1 &&
        s.baselineY - r.y >= s.fontSize * BAR_LOW && s.baselineY - r.y <= s.fontSize * BAR_HIGH);
      // Prose words under a rule are an underline or strike in a figure, not a complement
      if (!under.length || under.some((s) => /[a-z]{3,}/.test(s.text || ''))) continue;
      const nothingAbove = !spans.some((s) => !under.includes(s) && s.x1 > r.x0 && s.x0 < r.x1 && r.y - s.baselineY > 0 &&
        r.y - s.baselineY <= under[0].fontSize * 1.35 && overlapShare(s, r) >= NUMERATOR_SHARE && !onLongerRow(s, spans, r));
      if (!nothingAbove) continue;
      for (const s of under) if (!String(s.text).includes(LOST_MARK)) s.text = `${s.text}${LOST_MARK}`;
    }
    return spans;
  }

  PDFStudy.overlineBuilder = { overlines, onLongerRow };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.overlineBuilder;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Defect counters for tools/eval-text.js: pure functions over the cleaned text the pipeline produces
 * (scope text and exercise text, one visual line per row, `$...$` / `$$...$$` TeX math). Each counter
 * returns how many lines (or tokens) show one kind of extraction defect; lower is better.
 */
const MATH_RE = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;
const proseOf = (line) => line.replace(MATH_RE, ' ').replace(/\*\*/g, '');
const mathOf = (line) => (line.match(MATH_RE) || []).map((m) => m.replace(/^\$+|\$+$/g, ''));
const plainOf = (line) => line.replace(/\*\*/g, '').trim();

const HEADER_RES = [
  /^\d{1,4}\s+(?:Chapter|Section|Unit|Part)\s+[\dA-Z]+\b/i, // "66 Chapter 1 Limits ..."
  /^(?:\d+|[A-Z])\.\d+\s+[A-Z].*\s\d{1,4}$/, // "1.3 Evaluating Limits Analytically 67"
  /^(?:Chapter|Section|Unit)\s+\S+.*\s\d{1,4}$/i,
  /^Page\s+\d+(?:\s+of\s+\d+)?$/i,
  /\bcopyright\b|\ball rights reserved\b|\bmay not be (?:copied|scanned)/i,
];
/** Running heads with their page number and copyright lines that survived (bare numbers count as figure debris). */
function headerLines(lines) {
  return lines.filter((l) => HEADER_RES.some((re) => re.test(plainOf(l))));
}

const RELATION_RE = /[=<>≤≥≠≈]|\\(?:le|ge|ne|to|approx|in|leq|geq|neq|lim|int|sum|Rightarrow|rightarrow)(?![A-Za-z])/;
/** Figure-label debris: bare number rows, lone variables, tick runs and duplicated tiny labels. */
function figureLines(lines) {
  return lines.filter((l, i) => {
    const p = plainOf(l);
    if (/^[\d\s.,+\-−–()]+$/.test(p) && /\d/.test(p)) return true; // tick values / bare numbers
    if (proseOf(p).trim() === '' && p.includes('$')) {
      const inner = mathOf(p).join(' ').trim();
      if (!RELATION_RE.test(inner) && (/^[A-Za-z]('|_\{?\w\}?)?$/.test(inner) || /\\quad/.test(inner) && !/[A-Za-z]{2}/.test(inner.replace(/\\[a-z]+/g, '')))) return true;
    }
    if (/^[A-Za-z]$/.test(p)) return true; // lone axis letter
    return p.length <= 6 && i > 0 && plainOf(lines[i - 1]) === p; // the same tiny label twice in a row
  });
}

/** Words left broken by an end-of-line hyphen, or rejoined with a stray "- " in the middle. */
function hyphenBreaks(lines) {
  const out = [];
  lines.forEach((l, i) => {
    const prose = proseOf(l);
    if (/[a-z]{2}[-‐‑]$/.test(l.trim()) && i + 1 < lines.length && /^[a-z]{2}/.test(lines[i + 1].trim())) out.push(l);
    else if (/\b[a-z]{3,}[-‐‑]\s(?!(?:and|or|to|through|by)\b)[a-z]{3,}/.test(prose)) out.push(l);
  });
  return out;
}

/** Numbered items ("12. ...") whose number goes backwards (a column or grid read in the wrong order). */
function orderBreaks(lines) {
  const out = [];
  let prev = 0;
  for (const l of lines) {
    const m = plainOf(l).match(/^\$*(\d{1,3})\.\s*\S/);
    if (!m) continue;
    const n = Number(m[1]);
    if (prev && n < prev && n !== 1) out.push(`${prev} -> ${l}`);
    prev = n;
  }
  return out;
}

/** Sub-items "(a)" directly after another "(a)": parts of two exercises interleaved row by row. */
function subPartClashes(lines) {
  const label = (l) => (plainOf(l).replace(/^\$+/, '').match(/^\(([a-h])\)/) || [])[1];
  return lines.filter((l, i) => i > 0 && label(l) && label(l) === label(lines[i - 1]));
}

const MATH_WORDS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'lim', 'exp', 'max', 'min', 'sinh', 'cosh', 'tanh',
  'coth', 'sech', 'csch', 'arcsin', 'arccos', 'arctan', 'arccot', 'arcsec', 'arccsc', 'det', 'mod', 'gcd', 'deg', 'sgn', 'abs']);
/** Equations damaged in extraction: empty limit targets, unbalanced `$`, prose words glued inside math. */
function mathDefects(lines) {
  return lines.filter((l) => {
    if ((l.replace(/\\\$/g, '').match(/\$/g) || []).length % 2) return true;
    return mathOf(l).some((m) => {
      if (/\\to\s*\}/.test(m) || /\\sqrt\[[^\]]*\\to/.test(m)) return true;
      const bare = m.replace(/\\(?:text|begin|end)\{[^}]*\}/g, ' ').replace(/\\[A-Za-z]+/g, ' ');
      // Skipped: function names, point labels ("PAO") and a variable times a differential ("xdx", "udu")
      const words = (bare.match(/[A-Za-z]{3,}/g) || []).filter((w) => !MATH_WORDS.has(w.toLowerCase()) &&
        w !== w.toUpperCase() && !/^[a-z]?d[a-z]$/.test(w));
      return words.length > 0 || /(?:\\text\{[^}]*\}\s*){2,}/.test(m);
    });
  });
}

const CAMEL_OK = /^(?:Mc|Mac|iP|eB|De|La|Le|Du)/;
/** Prose words glued together ("strokes.This", "aTrigonometric") or letter-spaced ("T h e o r e m"). */
function gluedTokens(lines) {
  const out = [];
  for (const l of lines) {
    const prose = proseOf(l);
    for (const m of prose.match(/\b[a-z]{2,}[.,;:!?][A-Z][a-z]+/g) || []) if (!/\.(?:com|org|net|edu)\b/i.test(m)) out.push(m);
    for (const m of prose.match(/\b[a-z]+[A-Z][a-z]{2,}\b/g) || []) if (!CAMEL_OK.test(m)) out.push(m);
    for (const m of prose.match(/(?:^|\s)(?:[A-Za-z] ){3,}[A-Za-z](?=\s|$)/g) || []) out.push(m.trim());
  }
  return out;
}

/** Table rows whose numeric cells ran together ("1.994991.99950" holds two cells, "0.99500.9983" too). */
function tableDefects(lines) {
  return lines.filter((l) => /\d\.\d{3,}\.\d/.test(l));
}

const COUNTERS = {
  header: headerLines, figure: figureLines, hyphen: hyphenBreaks, order: orderBreaks,
  subpart: subPartClashes, math: mathDefects, glued: gluedTokens, table: tableDefects,
};

/** Runs every counter over one text block; returns { counts, examples }. */
function countDefects(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const counts = { lines: lines.length };
  const examples = {};
  for (const [name, fn] of Object.entries(COUNTERS)) {
    const hits = fn(lines);
    counts[name] = hits.length;
    examples[name] = hits;
  }
  return { counts, examples };
}

module.exports = { countDefects, COUNTERS, headerLines, figureLines, hyphenBreaks, orderBreaks, subPartClashes, mathDefects, gluedTokens, tableDefects };

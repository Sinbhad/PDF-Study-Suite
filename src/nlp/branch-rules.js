/**
 * Branch Rules: the decisions a programming section prints as code, read so a question can run them on a value:
 *   chain   if (richter >= 8.0) { description = "..."; } else if (richter >= 7.0) { ... } ... else { ... }
 *           at least MIN_BRANCHES tests of one variable with one operator, each assigning a string literal to the same
 *           variable, and a final else
 *   choice  if (floor > 13) { actualFloor = floor - 1; } else { actualFloor = floor; }
 *           one test of a variable against a whole number, each branch assigning integer arithmetic of that variable
 * Only code that parses completely is read; a sequence written another way (no final else, independent ifs, tests in
 * another variable) is left alone. Pure and DOM-free.
 *   read({ text, lines, startPage }) -> [{ form, variable, op, tests, assigns, values, fallback, page, number, name, code }]
 *   cards(rules) -> [card]   card.rule: { kind: 'branch', ... }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_BRANCHES = 3;
  const NUMBERED_RE = /^(\d+(?:\.\d+)*)\s+(.{3,60})$/;
  const TEST = '\\(\\s*([A-Za-z_]\\w*)\\s*(>=|<=|>|<)\\s*(\\d+(?:\\.\\d+)?)\\s*\\)';
  const STRING_ASSIGN = '\\{\\s*([A-Za-z_]\\w*)\\s*=\\s*"([^"]*)"\\s*;\\s*\\}';
  const FIRST_RE = new RegExp(`^if\\s*${TEST}\\s*${STRING_ASSIGN}`);
  const NEXT_RE = new RegExp(`^\\s*else\\s+if\\s*${TEST}\\s*${STRING_ASSIGN}`);
  const LAST_RE = /^\s*else\s*\{\s*([A-Za-z_]\w*)\s*=\s*"([^"]*)"\s*;\s*\}/;
  const CHOICE_RE = /if\s*\(\s*([A-Za-z_]\w*)\s*(>=|<=|>|<|==|!=)\s*(\d+)\s*\)\s*\{\s*([A-Za-z_]\w*)\s*=\s*([^;{}"]+);\s*\}\s*else\s*\{\s*\4\s*=\s*([^;{}"]+);\s*\}/;

  /** A listing's code on one line: comments, callout marks and listing line numbers dropped. */
  const fold = (rows) => rows.filter((l) => !/^```/.test(String(l).trim()))
    .map((l) => String(l).replace(/\/\/.*$/, '').replace(/[❶-❿➀-➉]/g, '')).join(' ').replace(/\s+/g, ' ').trim();

  /** The if / else if / else chain that starts at `at`, or null. */
  function chainAt(code, at) {
    let rest = code.slice(at);
    const first = rest.match(FIRST_RE);
    if (!first) return null;
    const [, variable, op] = first;
    const tests = [Number(first[3])];
    const literals = [first[3]]; // the tests as printed ("7.0", not 7)
    const target = first[4];
    const values = [first[5]];
    rest = rest.slice(first[0].length);
    for (let m = rest.match(NEXT_RE); m; m = rest.match(NEXT_RE)) {
      if (m[1] !== variable || m[2] !== op || m[4] !== target) return null;
      tests.push(Number(m[3]));
      literals.push(m[3]);
      values.push(m[5]);
      rest = rest.slice(m[0].length);
    }
    const last = rest.match(LAST_RE);
    if (!last || last[1] !== target || tests.length < MIN_BRANCHES) return null;
    return { form: 'chain', variable, op, tests, literals, target, values, fallback: last[2], code: code.slice(at, code.length - rest.length + last[0].length) };
  }

  /** "if (floor > 13) { actualFloor = floor - 1; } else { actualFloor = floor; }": both sides computable. */
  function choiceIn(code) {
    const m = code.match(CHOICE_RE);
    if (!m) return null;
    const [, variable, op, limit, target, yes, no] = m;
    const ce = dep('codeExpr', './code-expr.js');
    const works = (expr) => ce.arithmetic(String(expr).replace(new RegExp(`\\b${variable}\\b`, 'g'), '7')) !== null && new RegExp(`^[\\d\\s()+\\-*/]*(?:\\b${variable}\\b[\\d\\s()+\\-*/]*)*$`).test(expr.trim());
    if (!works(yes) || !works(no) || yes.trim() === no.trim()) return null;
    return { form: 'choice', variable, op, limit: Number(limit), target, yes: yes.trim(), no: no.trim(), code: m[0] };
  }

  function read({ text, lines, startPage } = {}) {
    const sections = dep('bookSections', './book-sections.js').split(String(text || ''), { lines, startPage });
    const out = [];
    const seen = new Set();
    for (const s of sections) {
      const code = s.paragraphs.filter((p) => p.kind === 'code' && !(p.lines || []).some((l) => /^\s*\d{1,3}\s/.test(l)));
      if (!code.length) continue;
      const m = String(s.title || '').replace(/\*\*|__/g, '').trim().match(NUMBERED_RE);
      const where = { number: m ? m[1] : '', name: m ? m[2].trim() : String(s.title || '').trim() };
      // A chain printed across a page or a margin note: the section's listings read as one.
      const flat = fold(code.flatMap((p) => p.lines || []));
      for (let at = flat.indexOf('if'); at >= 0; at = flat.indexOf('if', at + 2)) {
        // ("else if (...)" inside a chain is its tail, not a chain of its own.)
        if (/(?:else|\w)\s*$/.test(flat.slice(0, at))) continue;
        const chain = chainAt(flat, at);
        if (!chain || seen.has(chain.code)) continue;
        seen.add(chain.code);
        const p = code.find((c) => fold(c.lines || []).includes(`if (${chain.variable}`)) || code[0];
        out.push({ ...chain, ...where, page: p.page || s.page || null });
      }
      for (const p of code) {
        const choice = choiceIn(fold(p.lines || []));
        if (!choice || seen.has(choice.code) || out.some((r) => r.form === 'choice' && r.target === choice.target)) continue;
        seen.add(choice.code);
        out.push({ ...choice, ...where, page: p.page || s.page || null });
      }
    }
    return out;
  }

  const ruleOf = (r) => ({ kind: 'branch', ...r });
  const sectionNote = (r) => `${r.number ? `section ${r.number}, ` : ''}p. ${r.page}`;

  function cards(rules) {
    return (rules || []).map((r) => (r.form === 'chain' ? {
      front: `In an if / else if / else sequence such as \`if (${r.variable} ${r.op} ${r.literals[0]}) ... else if (${r.variable} ${r.op} ${r.literals[1]}) ... else ...\`, which branch runs?`,
      back: `The first branch whose test succeeds; no later test is tried. When no test succeeds, the final else runs (${sectionNote(r)}).`,
      // The code it quotes is what a section of the scope prints (test-engine.js keeps a section's own cards).
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Multiple alternatives', page: r.page, quote: r.code, rule: ruleOf(r),
    } : {
      front: `When does \`${r.code}\` take its else branch, and what does each branch assign?`,
      back: `When ${r.variable} ${r.op} ${r.limit} is false; then ${r.target} = ${r.no}. Otherwise ${r.target} = ${r.yes} (${sectionNote(r)}).`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'if statement', page: r.page, quote: r.code, rule: ruleOf(r),
    }));
  }

  const api = { read, cards, chainAt, choiceIn };
  PDFStudy.branchRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

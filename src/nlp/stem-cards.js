/**
 * STEM Flashcard Extractors: named theorems/rules/laws, core formulas (derivatives, integrals,
 * identities), algorithm complexities and recurrences. Every card keeps formulas verbatim ($...$ TeX).
 * Output: [{ front, back, category: 'Theorem'|'Formula'|'Algorithm'|'Definition', kind }]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sn = () => dep('stemNoise', './stem-noise.js');

  const KIND = {
    Theorem: 'theorem', Rule: 'theorem', Law: 'theorem', Corollary: 'theorem', Lemma: 'theorem', Principle: 'theorem',
    Formula: 'formula', Identity: 'formula', Recurrence: 'formula', Summary: 'formula',
    Algorithm: 'algorithm', Definition: 'definition', Guideline: 'definition',
  };
  /** Card kind ('theorem'|'formula'|'definition'|'algorithm') for a category; Key Terms are definitions. */
  const kindOf = (category) => KIND[category] || 'definition';

  const NAMED = "(?:[A-Z][\\w'’\\-]*|of|the|for|and|by|in|on)";
  const NAME_SUFFIX = '(?:Theorem|Rule|Law|Formula|Identity|Identities|Principle|Lemma|Corollary|Test|Property|Method|Recurrence|Inequality|Criterion|Algorithm|Search|Sort)';
  const NAMED_RE = new RegExp(`((?:The\\s+)?[A-Z][\\w'’\\-]*(?:\\s+${NAMED}){0,6}?\\s+${NAME_SUFFIX})`);
  const ALGO_MOD = "(?!Algorithms?\\b|Sorting\\s+Algorithms\\b)[A-Z][\\w'’\\-]*";
  const ALGO_NAME = `((?:${ALGO_MOD}\\s+){0,2}[A-Za-z][\\w'’\\-]*\\s+(?:[Ss]earch|[Ss]ort|[Aa]lgorithm|[Tt]raversal|[Tt]ree|[Hh]eap|[Hh]ashing|[Mm]ultiplication)|[Qq]uicksort|[Hh]eapsort|[Mm]ergesort|DFS|BFS)`;
  const COMPLEXITY = '(\\$?\\s*(?:O|Θ|Ω|\\\\Theta|\\\\Omega)\\s*\\([^)]*(?:\\([^)]*\\)[^)]*)*\\)\\s*\\$?)';

  const RULES = [
    // "Quotient Rule: $\frac{d}{dx}[...] = ...$" / "Integration by Parts Formula — $\int u\,dv = uv - \int v\,du$"
    {
      category: 'Formula',
      re: new RegExp(`^(?:\\*\\*)?(${NAMED_RE.source.slice(1, -1)}|(?:Derivative|Integral|Antiderivative|Limit)\\s+of\\s+[^:—–]{1,30}?)(?:\\*\\*)?\\s*(?::|—|–)\\s*(.+)$`),
      build: (m) => (mt().hasMath(m[2]) && mt().plain(m[2]).length <= 220 ? [clean(m[1]), m[2]] : null),
    },
    // "The derivative of $\tan x$ is $\sec^{2} x$."
    {
      category: 'Formula',
      re: /^(?:The\s+)?(derivative|antiderivative|integral|indefinite integral|limit|Laplace transform|inverse)\s+of\s+(\$[^$]+\$|[^\s,]+(?:\s*\([^)]*\))?)\s+(?:is|equals|=)\s+(.+?)\.?$/i,
      build: (m) => (mt().hasMath(m[3]) || mt().hasMath(m[2]) ? [`${cap(m[1])} of ${m[2]}`, m[3]] : null),
    },
    // "The Mean Value Theorem states that if f is continuous on [a, b] ..., then ..."
    {
      category: 'Theorem',
      re: new RegExp(`^${NAMED_RE.source}\\s+(?:states|says|asserts|guarantees|tells\\s+us)\\s+that\\s+(.{20,320})$`),
      build: (m) => [clean(m[1]), cap(m[2])],
    },
    // "Merge sort runs in $O(n \log n)$ time" / "The running time of binary search is O(log n)"
    {
      category: 'Algorithm',
      re: new RegExp(`^(?:The\\s+)?${ALGO_NAME}\\s+(?:runs|executes|takes|operates|works)\\s+in\\s+(?:worst-case\\s+|expected\\s+|average\\s+)?${COMPLEXITY}\\s*(time|space)?`),
      build: (m) => [`Time complexity of ${clean(m[1])}`, `${m[2].trim()} ${m[3] || 'time'}`.trim()],
    },
    {
      category: 'Algorithm',
      re: new RegExp(`^(?:The\\s+)?(?:worst-case\\s+|average-case\\s+|expected\\s+)?(running\\s+time|time\\s+complexity|space\\s+complexity)\\s+of\\s+${ALGO_NAME}\\s+is\\s+${COMPLEXITY}`, 'i'),
      build: (m) => [`${cap(m[1].replace(/running/i, 'Time').replace(/\s+time$/i, ' complexity').replace(/time complexity/i, 'Time complexity'))} of ${clean(m[2])}`, m[3].trim()],
    },
    // "The recurrence for merge sort is $T(n) = 2T(n/2) + O(n)$"
    {
      category: 'Formula',
      re: /^(?:The\s+)?recurrence\s+(?:relation\s+)?(?:for|of|describing)\s+(?:the\s+)?(.{3,40}?)\s+is\s+(\$?T\s*\(n\)\s*=.+?)\.?$/i,
      build: (m) => [`Recurrence for ${m[1].trim()}`, m[2]],
    },
    // Symbolic differentiation line: "$\frac{d}{dx}[\tan x] = \sec^{2} x$" or "$$...$$" or "d/dx [sin x] = cos x"
    {
      category: 'Formula',
      re: /^\${0,2}\s*(?:\\frac\{d\}\{d[A-Za-z]\}|d\/d[A-Za-z])\s*(?:\\left)?\[\s*([^\]]+?)\s*(?:\\right)?\]\s*=\s*([^$]+?)\s*\.?\s*\${0,2}\.?$/,
      build: (m) => {
        const lhs = m[1].trim(), rhs = m[2].trim();
        if (/(?:\\frac\{d\}\{d|d\/d[A-Za-z]|\\text\{|\\q?quad)/.test(rhs)) return null;
        if (/^[FfGgHh]\s*\(\s*[A-Za-z]\s*\)$|[2-9]\s*[a-zA-Z]|[+-]\s*[2-9]/.test(lhs)) return null;
        return [`Derivative of $${lhs}$`, mt().fence(rhs)];
      },
    },
    // Slide / lecture "Def: An algorithm is a finite sequence..."
    {
      category: 'Definition',
      re: /^(?:Def(?:inition)?)\s*:\s*(?:An?\s+|The\s+)?([A-Za-z][\w\s\-]{2,36}?)\s+(?:is|are|denotes|means)\s+(.{15,260}?)\.?$/,
      build: (m) => [cap(clean(m[1])), cap(m[2].trim()) + '.'],
    },
    // Asymptotic definition: "We say that f(x) is O(g(x)) if there are constants C and k such that ..."
    {
      category: 'Definition',
      re: /\bWe\s+say\s+that\s+(\$?f\s*\([^)]+\)\$?)\s+is\s+(\$?(O|Ω|Θ|\\Omega|\\Theta)\s*\(g\s*\([^)]+\)\)\$?)\s+if\s+(.{15,240})/i,
      build: (m) => {
        const sym = m[3].replace('\\', '');
        const label = sym === 'O' ? 'Big-O Notation' : /Omega|Ω/.test(sym) ? 'Big-Omega Notation' : 'Big-Theta Notation';
        return [label, `${m[1]} is ${m[2]} if ${m[4].trim().replace(/\.?$/, '.')}`];
      },
    },
  ];

  function clean(s) {
    return String(s || '').replace(/\*\*/g, '').replace(/^(?:The|A|An)\s+/i, '').replace(/\s+/g, ' ').trim();
  }
  function cap(s) {
    const t = String(s || '').trim();
    return t ? t[0].toUpperCase() + t.slice(1) : t;
  }

  /** Front must name something real: no labels, no exercise prompts, no dangling openers. */
  function goodFront(front) {
    const f = clean(front);
    if (f.length < 3 || f.split(/\s+/).length > 10) return false;
    if (sn().isLabelTerm(f) || sn().isDangling(f)) return false;
    return !/\b(?:a|an|the|of|on|in|to|and|or|for|with|at|by|is|are|that|which|who|whose|where|when)$/i.test(f);
  }

  /** Split side-by-side table formulas ("$$\frac{d}{dx}[\tan x] = ... \quad \frac{d}{dx}[\cot x] = ...$$"). */
  function splitQuadLine(line) {
    const inner = line.replace(/^\${1,2}|\${1,2}\.?$/g, '').trim();
    const parts = inner.split(/\s*\\q?quad\s*(?=\\frac\{d\}\{d|d\/d[A-Za-z]|\\int\b|\\lim\b)/);
    return parts.length > 1 ? parts.map((p) => `$${p.replace(/[.,;]+$/, '').trim()}$`) : [line];
  }

  /** Scan section text (lines + sentences) for STEM theorem/formula/algorithm statements. */
  function extractStemCards(text, splitSentences) {
    const out = [];
    const seen = new Set();
    const lines = String(text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean).flatMap(splitQuadLine);
    const sentences = splitSentences ? splitSentences(text) : [];
    const pool = [...lines, ...sentences];
    for (let i = 0; i < pool.length; i++) {
      const item = pool[i].replace(/^\*\*([^*]+)\*\*/, '$1');
      if (sn().isStemNoise(item) || (i >= lines.length && sn().isDangling(item))) continue;
      for (const rule of RULES) {
        const m = item.match(rule.re);
        const built = m && rule.build(m);
        if (!built) continue;
        const [front, back] = built;
        const b = String(back || '').trim().replace(/[,;:]$/, '');
        if (!goodFront(front) || !b || !mt().isBalanced(b) || sn().isFragment(b)) continue;
        const key = clean(front).toLowerCase();
        if (seen.has(key)) break;
        seen.add(key);
        out.push({ front: clean(front), back: b, category: rule.category, kind: kindOf(rule.category) });
        break;
      }
    }
    // Display formula ($$...$$) on its own line, named by the preceding short label line ("Chain Rule").
    for (let i = 1; i < lines.length; i++) {
      if (!/^\$\$[\s\S]+\$\$$/.test(lines[i])) continue;
      const label = clean(lines[i - 1].replace(/[:.]$/, ''));
      if (!new RegExp(`${NAME_SUFFIX}s?$`).test(label) || !goodFront(label) || seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ front: label, back: lines[i], category: 'Formula', kind: 'formula' });
    }
    return out;
  }

  /** Didactic block -> card body: prose body (minus trailing figure/appendix/layout notes) + attached formulas. */
  function didacticBack(blk) {
    const body = String(blk.body || '')
      .replace(/\s*\(?\b[Ss]ee\s+(?:Figures?|Fig\.|Tables?|Examples?)\s+[\d.a-z()]+\)?\.?/g, '')
      .replace(/\s*A\s+proof\s+of\s+this\s+theorem\s+is\s+given\s+in\s+Appendix\s+[A-Z0-9]+\.?/gi, '')
      .replace(/\s*When\s+applying\s+the\s+[^.]*\b(?:shown|indicated)\s+below\b[\s\S]*$/i, '')
      .trim();
    // An extraction cut mid-sentence ("... is also called the" / "... of $x.$ This") loses its unfinished tail.
    const cut = body.match(/^([\s\S]*(?:[.!?]|[.!?]\$|\$\$))\s+((?:[^.!?$]|\$[^$]*\$)*)$/);
    const stub = cut && !/[.!?]\$\$?$|\$\$$/.test(cut[2]) && !/(?:^|\s)\d{1,2}\.$/.test(cut[1]) && // not a complete "... $L.$" or a list item
      (sn().isFragment(`X ${cut[2]}`) || cut[2].split(/\s+/).length <= 3);
    const whole = stub ? cut[1] : body;
    const extra = (blk.formulas || []).map((f) => mt().fence(`${f}`).replace(/^\$(?!\$)([\s\S]*)\$$/, '$$$$$1$$$$'));
    const missing = extra.filter((f) => !whole.includes(mt().plain(f).slice(0, 12)));
    // "1. Scalar multiple: ... 2. Sum or difference: ..." -> one enumerated item per line
    const listed = /(?:^|\s)1\.\s+[A-Z(]/.test(whole) && /\s2\.\s+[A-Z(]/.test(whole) ? whole.replace(/[ \t]+(?=\d{1,2}\.\s+[A-Z(])/g, '\n') : whole;
    return [listed, ...missing].filter(Boolean).join('\n');
  }

  const api = { extractStemCards, didacticBack, kindOf, goodFront };
  PDFStudy.stemCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

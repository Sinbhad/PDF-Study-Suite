/**
 * Built-in Offline Demo Fixtures: CS Algorithms slide deck + Calculus textbook chapters.
 * Lines carry TeX math in `$...$` / `$$...$$` (ratified contract #9/#10/#13) so the full
 * extract -> study -> render pipeline can be tried before uploading a PDF.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const words = (s) => s.split(/\s+/).length;
  const plain = (s) => s.replace(/\*\*/g, '');

  /** One extracted line in the pdf-loader shape. */
  function line(text, y, o = {}) {
    const size = o.size || 11;
    return {
      text: plain(text), formattedText: o.bold ? `**${plain(text)}**` : text, cleanText: plain(text),
      x0: o.x || 72, textX0: o.tx || o.x || 72, x1: o.x1 || 540, topY: y, bottomY: y + size + 3,
      fontSize: size, isBold: !!o.bold, hasBullet: !!o.bullet, wordCount: words(text),
    };
  }

  const SLIDES = [
    ['Asymptotic Analysis', [
      'Big-O: $f(n) = O(g(n))$ if there exist constants $c > 0$ and $n_0$ such that $f(n) \\le c\\,g(n)$ for all $n \\ge n_0$.',
      'Big-Omega: $f(n) = \\Omega(g(n))$ gives an asymptotic lower bound on running time.',
      'Big-Theta: $f(n) = \\Theta(g(n))$ holds when $f$ is both $O(g(n))$ and $\\Omega(g(n))$.',
      'Common growth order: $1 < \\log n < n < n \\log n < n^{2} < 2^{n}$.',
    ]],
    ['Divide and Conquer', [
      'Merge Sort: Splits the array in half, sorts each half recursively and merges in linear time.',
      'Recurrence: $T(n) = 2T(n/2) + O(n)$ solves to $T(n) = O(n \\log n)$.',
      'Master Theorem: For $T(n) = aT(n/b) + f(n)$, compare $f(n)$ with $n^{\\log_b a}$.',
    ]],
    ['Binary Search', [
      'Binary Search: Finds a key in a sorted array by halving the search interval each step.',
      'Running time: $T(n) = T(n/2) + O(1)$, so the search takes $O(\\log n)$ comparisons.',
      'Invariant: if the key is present, it lies in $A[lo..hi]$ with $lo \\le hi$.',
    ]],
    ['Graph Algorithms', [
      'Breadth-First Search: Visits vertices in order of distance from the source in $O(V + E)$ time.',
      "Dijkstra's Algorithm: Computes single-source shortest paths with non-negative weights in $O((V + E)\\log V)$.",
      'Edge relaxation: if $d[u] + w(u, v) < d[v]$ then set $d[v] = d[u] + w(u, v)$.',
    ]],
  ];

  function createDemoSlidesPdf() {
    const pages = SLIDES.map(([title, bullets], idx) => ({
      pageNumber: idx + 1, width: 960, height: 540, aspectRatio: 1.78, wordCount: 55,
      lines: [
        line(title, 55, { x: 60, x1: 720, size: 26, bold: true }),
        ...bullets.map((b, i) => ({ ...line(b, 140 + i * 65, { x: 85, tx: 100, x1: 880, size: 18, bullet: true }), text: `• ${b}`, formattedText: `• ${b}` })),
      ],
    }));
    return { pdfDoc: null, numPages: pages.length, pages, outline: [] };
  }

  const BOOK = [
    {
      ch: 'CHAPTER 1: Limits and Their Properties',
      sec: '1.1 Finding Limits Graphically and Numerically',
      paras: [
        '**Limit** refers to the value $L$ that $f(x)$ approaches as $x$ approaches $c$, written $\\lim_{x \\to c} f(x) = L$.',
        'Definition of Limit',
        'Let $f$ be a function defined on an open interval containing $c$ and let $L$ be a real number. The statement $\\lim_{x \\to c} f(x) = L$ means that for each $\\varepsilon > 0$ there exists a $\\delta > 0$ such that if $0 < |x - c| < \\delta$, then $|f(x) - L| < \\varepsilon$.',
        'A **one-sided limit** is the value a function approaches as $x$ approaches $c$ from only the left or only the right.',
      ],
    },
    {
      sec: '1.3 Evaluating Limits Analytically',
      paras: [
        'THEOREM 1.9 The Squeeze Theorem',
        'If $h(x) \\le f(x) \\le g(x)$ for all $x$ in an open interval containing $c$, except possibly at $c$ itself, and if $\\lim_{x \\to c} h(x) = L = \\lim_{x \\to c} g(x)$, then $\\lim_{x \\to c} f(x)$ exists and is equal to $L$.',
        'THEOREM 1.10 Special Trigonometric Limits',
        '$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1 \\quad \\text{and} \\quad \\lim_{x \\to 0} \\frac{1 - \\cos x}{x} = 0$$',
        'When direct substitution produces the indeterminate form $\\frac{0}{0}$, the limit can often be found by factoring or rationalizing.',
      ],
    },
    {
      ch: 'CHAPTER 2: Differentiation',
      sec: '2.1 The Derivative and the Tangent Line Problem',
      paras: [
        'Definition of the Derivative of a Function',
        'The derivative of $f$ at $x$ is given by $$f\'(x) = \\lim_{\\Delta x \\to 0} \\frac{f(x + \\Delta x) - f(x)}{\\Delta x}$$ provided the limit exists. For all $x$ for which this limit exists, $f\'$ is a function of $x$.',
        'A **differentiable function** is a function whose derivative exists at every point of its domain.',
        'If a function is differentiable at $x = c$, then it is continuous at $x = c$, but continuity does not imply differentiability.',
      ],
    },
    {
      sec: '2.3 Product and Quotient Rules',
      paras: [
        'THEOREM 2.7 The Product Rule',
        'The product of two differentiable functions $f$ and $g$ is itself differentiable, and $$\\frac{d}{dx}[f(x)g(x)] = f(x)g\'(x) + g(x)f\'(x).$$',
        'THEOREM 2.8 The Quotient Rule',
        'The quotient $f/g$ of two differentiable functions is differentiable for all $x$ with $g(x) \\ne 0$, and $$\\frac{d}{dx}\\left[\\frac{f(x)}{g(x)}\\right] = \\frac{g(x)f\'(x) - f(x)g\'(x)}{[g(x)]^{2}}.$$',
      ],
    },
  ];

  function createDemoBookPdf() {
    const pages = BOOK.map((p, idx) => {
      const lines = [];
      let y = 75;
      if (p.ch) { lines.push(line(p.ch, y, { x1: 520, size: 20, bold: true })); y += 40; }
      lines.push(line(p.sec, y, { x1: 480, size: 14.5, bold: true }));
      y += 30;
      for (const para of p.paras) {
        const head = /^(?:THEOREM \d|Definition of)/.test(para);
        lines.push(line(para, y, head ? { bold: true, x: 85, x1: 527 } : { x: p.paras.some((q) => /^THEOREM|^Definition/.test(q)) ? 85 : 72 }));
        y += head ? 22 : 34;
      }
      return { pageNumber: idx + 1, width: 612, height: 792, aspectRatio: 0.77, wordCount: 280, lines };
    });
    const sec = (title, startPage) => ({ level: 2, title, startPage, children: [] });
    return {
      pdfDoc: null, numPages: pages.length, pages,
      outline: [
        { level: 1, title: 'Chapter 1: Limits and Their Properties', startPage: 1,
          children: [sec('1.1 Finding Limits Graphically and Numerically', 1), sec('1.3 Evaluating Limits Analytically', 2)] },
        { level: 1, title: 'Chapter 2: Differentiation', startPage: 3,
          children: [sec('2.1 The Derivative and the Tangent Line Problem', 3), sec('2.3 Product and Quotient Rules', 4)] },
      ],
    };
  }

  PDFStudy.demoData = { createDemoSlidesPdf, createDemoBookPdf };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.demoData;
  }
})(typeof window !== 'undefined' ? window : globalThis);

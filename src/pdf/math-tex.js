/**
 * Unicode -> TeX conversion for reconstructed math (the `$...$` contract shared with nlp-study / ui-render).
 * texOf(text, { italic }) turns one decoded span into TeX tokens; join() concatenates tokens with the
 * spacing TeX needs ("\sin x", never "\sinx").
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SYM = {
    '−': '-', '–': '-', '×': '\\times', '÷': '\\div', '⋅': '\\cdot', '·': '\\cdot', '±': '\\pm', '∓': '\\mp',
    '≤': '\\le', '≥': '\\ge', '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '∝': '\\propto',
    '→': '\\to', '←': '\\leftarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
    '↔': '\\leftrightarrow', '↦': '\\mapsto', '∞': '\\infty', '∂': '\\partial', '∇': '\\nabla', '∈': '\\in',
    '∊': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊆': '\\subseteq', '⊃': '\\supset', '⊇': '\\supseteq',
    '∪': '\\cup', '∩': '\\cap', '∀': '\\forall', '∃': '\\exists', '∅': '\\emptyset', '¬': '\\neg', '∧': '\\wedge',
    '∨': '\\vee', '∫': '\\int', '∑': '\\sum', '∏': '\\prod', '√': '\\sqrt', '′': "'", '″': "''", '‴': "'''",
    '⟨': '\\langle', '⟩': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil',
    '‖': '\\|', '°': '^{\\circ}', '∘': '\\circ', '…': '\\ldots', '⋯': '\\cdots', '∴': '\\therefore', 'ℵ': '\\aleph',
    'ℓ': '\\ell', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}',
    '△': '\\triangle', '∠': '\\angle', '⊥': '\\perp', '⊕': '\\oplus', '⊗': '\\otimes', '⟦': '[\\![', '⟧': ']\\!]',
    '{': '\\{', '}': '\\}', '⎧': '\\{', '⎨': '', '⎩': '', '⎪': '', '⎫': '\\}', '⎬': '', '⎭': '',
    '%': '\\%', '#': '\\#', '&': '\\&', '\u2032': "'",
  };
  const GREEK = {
    α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'varepsilon', ϵ: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
    ϑ: 'vartheta', ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'o', π: 'pi', ρ: 'rho',
    σ: 'sigma', ς: 'varsigma', τ: 'tau', υ: 'upsilon', φ: 'phi', ϕ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
    Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Υ: 'Upsilon', Φ: 'Phi',
    Ψ: 'Psi', Ω: 'Omega', Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P',
    Τ: 'T', Χ: 'X',
  };
  for (const [g, n] of Object.entries(GREEK)) SYM[g] = n.length > 1 ? `\\${n}` : n;

  const FUNCS = ['arcsin', 'arccos', 'arctan', 'arcsec', 'arccsc', 'arccot', 'sinh', 'cosh', 'tanh', 'sech', 'csch', 'coth',
    'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'lim', 'log', 'ln', 'exp', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'deg', 'arg', 'dim', 'ker', 'Pr'];
  const FUNC_RE = new RegExp(`^(${FUNCS.join('|')})$`);
  const OPERATOR_RE = /[=<>≤≥≠≈≡→⇒⇔∈∉⊂⊆∪∩∀∃∫∑∏√∞∂∇±×÷⋅′″+−\-^_\\|‖/]/;

  /** Converts one decoded text run to TeX. italic runs are math variables; upright words may be functions. */
  function texOf(text, opts = {}) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (FUNC_RE.test(t)) return `\\${t === 'Pr' ? 'Pr' : t}`;
    if (/^(?:Θ|Ω|O)$/.test(t)) return SYM[t] || t;
    let out = '';
    // Upright words inside a formula stay readable as one \text{...} run: "Change in y" -> \text{Change in}\,y
    const prose = !opts.italic && t.split(' ').some((w) => /^[A-Za-z]{3,}[.,;:]?$/.test(w) && !FUNC_RE.test(w.replace(/[.,;:]$/, '')));
    let run = [];
    const flush = (more) => {
      if (run.length) out += `\\text{${run.join(' ')}}${more ? '\\,' : ''}`;
      run = [];
    };
    for (const word of t.split(' ')) {
      const m = prose ? word.match(/^([A-Za-z]{2,})([.,;:]?)$/) : null;
      if (m && !FUNC_RE.test(m[1])) {
        run.push(m[1]);
        if (m[2]) {
          flush(false);
          out += `${m[2]} `;
        }
        continue;
      }
      flush(/^[A-Za-z0-9(\\]/.test(word));
      if (FUNC_RE.test(word)) out += `\\${word} `;
      else for (const ch of word) out += SYM[ch] !== undefined ? spaced(SYM[ch]) : ch;
      out += ' ';
    }
    flush(/\b(?:in|of|at|as|to|for|by|on|and|or)$/.test(run.join(' '))); // "Change in" + a variable span
    return out.replace(/\s+/g, ' ').trim();
  }

  // Commands need a delimiter before a following letter ("\le x"); relations read better spaced
  function spaced(tex) {
    if (/^\\(?:le|ge|ne|approx|equiv|to|Rightarrow|Leftrightarrow|in|notin|subset|subseteq|cup|cap|pm|times|cdot|sim|leftarrow|mapsto)$/.test(tex)) return ` ${tex} `;
    return /^\\[A-Za-z]+$/.test(tex) ? `${tex} ` : tex;
  }

  const REL_RE = /^(?:[=<>+]|-|\\(?:le|ge|ne|approx|equiv|to|Rightarrow|Leftarrow|Leftrightarrow|in|notin|subset|subseteq|pm|times|cdot|sim|mapsto|leftarrow))$/;

  /** Joins TeX tokens, keeping a space after control words and around relations / binary operators. */
  function join(tokens) {
    let out = '';
    let last = '';
    for (const tok of tokens) {
      const t = String(tok || '').trim();
      if (!t) continue;
      const unary = t === '-' && (!out || REL_RE.test(last) || /[([{,]$/.test(out.trim()));
      const binary = REL_RE.test(t) && !unary;
      if (binary) out += ` ${t} `;
      else if (out && /\\[A-Za-z]+$/.test(out) && /^[A-Za-z0-9]/.test(t)) out += ` ${t}`;
      else out += t;
      last = t;
    }
    return out.replace(/\s+/g, ' ').replace(/([({[]) /g, '$1').replace(/ ([)}\],.])/g, '$1').trim();
  }

  /** True when a decoded text clearly belongs to a formula (operators, Greek, primes, scripts). */
  function looksMath(text) {
    return OPERATOR_RE.test(text) || /[α-ωΑ-Ω]/.test(text);
  }

  PDFStudy.mathTex = { texOf, join, looksMath, FUNC_RE, SYM };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.mathTex;
  }
})(typeof window !== 'undefined' ? window : globalThis);

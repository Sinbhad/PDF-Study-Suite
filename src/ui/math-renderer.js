/**
 * Zero-dependency TeX-subset -> HTML renderer for textbook math (stacked fractions, radicals with
 * vinculum, limits, big operators, scripts, cases/matrices, Greek and operators). Every character
 * emitted is HTML-escaped, so `x < y` or `T<Comparable>` can never become a broken HTML tag.
 * API: PDFStudy.mathRenderer.renderMath(tex, displayMode) -> HTML string (never throws).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const SYM = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
    sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
    Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω', infty: '∞', partial: '∂',
    nabla: '∇', ldots: '…', cdots: '⋯', dots: '…', ell: 'ℓ', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋',
    lceil: '⌈', rceil: '⌉', emptyset: '∅', lbrace: '{', rbrace: '}', '{': '{', '}': '}', '|': '‖', '%': '%', '$': '$',
    '#': '#', '&': '&', prime: '′', circ: '∘', deg: '°', neg: '¬', angle: '∠', triangle: '△', hbar: 'ℏ' };
  const OPS = { to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
    iff: '⇔', implies: '⇒', mapsto: '↦', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
    equiv: '≡', sim: '∼', cong: '≅', propto: '∝', pm: '±', mp: '∓', cdot: '·', times: '×', div: '÷', in: '∈',
    notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖',
    forall: '∀', exists: '∃', land: '∧', lor: '∨', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗', ll: '≪', gg: '≫', mid: '∣', perp: '⊥' };
  const FN = new Set(('sin cos tan sec csc cot arcsin arccos arctan arcsec arccsc arccot sinh cosh tanh ' +
    'sech csch coth ln log lg exp det gcd lcm deg dim ker arg mod Pr erf sgn rank tr Var Cov').split(' '));
  const WORDS = new Set('if for and or all where with when then else otherwise even odd such that true false null nil'.split(' '));
  const LIMOP = new Set(['lim', 'max', 'min', 'sup', 'inf', 'liminf', 'limsup', 'argmax', 'argmin']);
  const BIGOP = { sum: '∑', prod: '∏', coprod: '∐', bigcup: '⋃', bigcap: '⋂', int: '∫', iint: '∬', iiint: '∭', oint: '∮' };
  const SPACE = { ',': ' ', ':': ' ', ';': ' ', ' ': ' ', quad: '  ', qquad: '    ', '!': '' };
  const BB = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ' };
  const USUP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁺': '+', '⁻': '−', 'ⁿ': 'n' };
  const USUB = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '₊': '+', '₋': '−', 'ₙ': 'n', 'ᵢ': 'i', 'ⱼ': 'j', 'ₖ': 'k' };
  const OP_CHARS = '=+−-<>≤≥≠≈→←⇒⇔±×÷·∈∉⊂⊆∪∩≡∼';
  const op = (ch) => `<span class="math-op">${esc(ch === '-' ? '−' : ch)}</span>`;
  const frac = (n, d, cls = '') => `<span class="math-frac${cls}"><span class="math-num">${n}</span><span class="math-den">${d}</span></span>`;

  function parenGroup(s, idx) {
    let d = 0;
    for (let j = idx; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') { j++; continue; }
      if (c === '(' || c === '{' || c === '[') d++;
      else if (c === '}' || c === ']') { if (--d <= 0) return null; }
      else if (c === ')') { if (--d === 0) return s.slice(idx + 1, j); }
      else if (d === 1 && (c === ',' || c === ';')) return null; // keep intervals/tuples flat
    }
    return null;
  }

  function Parser(src, display) { this.s = src; this.i = 0; this.display = display; }
  Parser.prototype.peek = function () { return this.s[this.i]; };
  Parser.prototype.ws = function () { while (/\s/.test(this.s[this.i] || '')) this.i++; };
  Parser.prototype.readCmd = function () {
    const m = /^[A-Za-z]+/.exec(this.s.slice(++this.i));
    const name = m ? m[0] : this.s[this.i] || '';
    this.i += name.length || 1;
    return name;
  };
  Parser.prototype.rawGroup = function (open, close) {
    this.ws();
    if (this.s[this.i] !== open) return null;
    const start = this.i + 1;
    for (let depth = 0; this.i < this.s.length; this.i++) {
      const c = this.s[this.i];
      if (c === '\\') { this.i++; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) { this.i++; return this.s.slice(start, this.i - 1); }
    }
    return this.s.slice(start);
  };
  Parser.prototype.sub = function (tex) { return new Parser(tex || '', this.display).parseAll(); };
  Parser.prototype.arg = function () {
    this.ws();
    return this.peek() === undefined ? '' : this.peek() === '{' ? this.sub(this.rawGroup('{', '}')) : this.atom() || '';
  };
  Parser.prototype.scripts = function () {
    let sup = null; let sub = null;
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '^' && sup === null) { this.i++; sup = this.arg(); }
      else if (c === '_' && sub === null) { this.i++; sub = this.arg(); }
      else if (c === "'" && sup === null) { let n = 0; while (this.peek() === "'") { this.i++; n++; } sup = '′'.repeat(n); }
      else if (USUP[c] && sup === null) { let u = ''; while (USUP[this.peek()]) u += USUP[this.s[this.i++]]; sup = esc(u); }
      else if (USUB[c] && sub === null) { let u = ''; while (USUB[this.peek()]) u += USUB[this.s[this.i++]]; sub = esc(u); }
      else break;
    }
    return { sup, sub };
  };
  Parser.prototype.attach = function (base, sc) {
    if (sc.sup === null && sc.sub === null) return base;
    if (sc.sup !== null && sc.sub !== null) return `${base}<span class="math-supsub"><span class="math-sup">${sc.sup}</span><span class="math-sub">${sc.sub}</span></span>`;
    return sc.sup !== null ? `${base}<sup class="math-sup">${sc.sup}</sup>` : `${base}<sub class="math-sub">${sc.sub}</sub>`;
  };
  Parser.prototype.bigop = function (symHtml, cls, stack) {
    const sc = this.scripts();
    this.tookScripts = true; this.noFrac = true;
    if (!stack || (sc.sup === null && sc.sub === null)) return this.attach(`<span class="${cls}">${symHtml}</span>`, sc);
    return `<span class="math-limits">${sc.sup !== null ? `<span class="math-over">${sc.sup}</span>` : ''}<span class="${cls}">${symHtml}</span>${sc.sub !== null ? `<span class="math-under">${sc.sub}</span>` : ''}</span>`;
  };
  Parser.prototype.env = function (name) {
    const endTag = `\\end{${name}}`;
    const stop = this.s.indexOf(endTag, this.i);
    const body = this.s.slice(this.i, stop < 0 ? this.s.length : stop);
    this.i = stop < 0 ? this.s.length : stop + endTag.length;
    const rows = body.split(/\\\\/).map((r) => r.trim()).filter(Boolean);
    const cells = rows.map((r) => `<span class="math-row">${r.split('&').map((c) => `<span class="math-cell">${this.sub(c.trim())}</span>`).join('')}</span>`).join('');
    const fences = { cases: ['{', ''], pmatrix: ['(', ')'], bmatrix: ['[', ']'], vmatrix: ['|', '|'], Bmatrix: ['{', '}'] };
    const [l, r] = fences[name] || ['', ''];
    const f = (ch) => (ch ? `<span class="math-fence">${esc(ch)}</span>` : '');
    return `<span class="math-env math-${esc(name)}">${f(l)}<span class="math-grid${name === 'cases' ? ' math-cases-grid' : ''}">${cells}</span>${f(r)}</span>`;
  };
  Parser.prototype.command = function () {
    const name = this.readCmd();
    if (name === 'displaystyle' || name === 'textstyle') { this.display = name === 'displaystyle'; return ''; }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') return frac(this.arg(), this.arg());
    if (name === 'binom') return `<span class="math-fence">(</span>${frac(this.arg(), this.arg(), ' math-binom')}<span class="math-fence">)</span>`;
    if (name === 'sqrt') {
      const idx = this.rawGroup('[', ']');
      const index = idx !== null ? `<sup class="math-root-index">${this.sub(idx)}</sup>` : '';
      return `<span class="math-sqrt">${index}<span class="math-radical">√</span><span class="math-radicand">${this.arg()}</span></span>`;
    }
    if (name === 'left' || name === 'right' || /^(?:big|Big|bigg|Bigg)[lr]?$/.test(name)) {
      this.ws();
      let d = this.s[this.i] === '\\' ? this.readCmd() : this.s[this.i++];
      d = d === '.' ? '' : SYM[d] || OPS[d] || d;
      this.noFrac = true;
      return d ? `<span class="math-fence">${esc(d)}</span>` : '';
    }
    if (name === 'begin') return this.env(this.rawGroup('{', '}') || '');
    if (/^(?:text|textrm|mathrm|operatorname|textnormal|mbox)$/.test(name)) return `<span class="math-text">${esc(this.rawGroup('{', '}') || '')}</span>`;
    if (name === 'mathbf' || name === 'boldsymbol' || name === 'textbf') return `<b class="math-bold">${this.arg()}</b>`;
    if (name === 'mathit' || name === 'textit') return `<i class="math-var">${this.arg()}</i>`;
    if (name === 'mathbb') { const g = this.rawGroup('{', '}') || ''; return `<span class="math-ord">${esc(BB[g] || g)}</span>`; }
    if (name === 'mathcal') return `<span class="math-cal">${this.arg()}</span>`;
    if (name === 'texttt' || name === 'mathtt') return `<code class="inline-code">${esc(this.rawGroup('{', '}') || '')}</code>`;
    if (name === 'overline' || name === 'bar') return `<span class="math-overline">${this.arg()}</span>`;
    if (name === 'vec' || name === 'hat' || name === 'dot') {
      const acc = { vec: '→', hat: '^', dot: '˙' }[name];
      return `<span class="math-accent" data-accent="${acc}">${this.arg()}</span>`;
    }
    if (LIMOP.has(name)) return this.bigop(esc(name), 'math-fn math-limop', this.display);
    if (BIGOP[name]) return this.bigop(BIGOP[name], `math-bigop${/int$/.test(name) ? ' math-int' : ''}`, this.display && !/int$/.test(name));
    if (FN.has(name)) { this.noFrac = true; return `<span class="math-fn">${esc(name)}</span>`; }
    if (SPACE[name] !== undefined) { this.noFrac = true; return SPACE[name] ? `<span class="math-space">${SPACE[name]}</span>` : ''; }
    if (OPS[name]) { this.noFrac = true; return op(OPS[name]); }
    if (SYM[name]) return /^[a-z]+$/.test(name) && name.length > 1 && /[α-ω]/.test(SYM[name]) ? `<i class="math-var">${SYM[name]}</i>` : `<span class="math-ord">${esc(SYM[name])}</span>`;
    if (name === '\\') { this.noFrac = true; return '<br>'; }
    return `<span class="math-text">${esc(name)}</span>`;
  };
  Parser.prototype.atom = function () {
    const c = this.peek();
    if (c === '\\') return this.command();
    if (c === '{') return this.sub(this.rawGroup('{', '}'));
    if (c === '(') {
      const inner = parenGroup(this.s, this.i);
      if (inner !== null) {
        this.i += inner.length + 2;
        const h = this.sub(inner);
        this.lastInner = h;
        return `<span class="math-ord">(</span>${h}<span class="math-ord">)</span>`;
      }
    }
    const rest = this.s.slice(this.i);
    let m = /^[A-Za-z]+/.exec(rest);
    if (m) {
      const w = m[0];
      if (FN.has(w)) { this.i += w.length; this.noFrac = true; return `<span class="math-fn">${w}</span>`; }
      if (LIMOP.has(w)) { this.i += w.length; return this.bigop(w, 'math-fn math-limop', this.display); }
      if (WORDS.has(w)) { this.i += w.length; this.noFrac = true; return `<span class="math-text">${esc(w)}</span>`; }
      this.i += 1;
      this.lastVar = w[0];
      return `<i class="math-var">${esc(w[0])}</i>`;
    }
    m = /^\d+(?:\.\d+)?/.exec(rest);
    if (m) { this.i += m[0].length; return `<span class="math-digit">${m[0]}</span>`; }
    this.i += 1;
    if (c === '∑' || c === '∏') return this.bigop(c, 'math-bigop', this.display);
    if (c === '∫') return this.bigop('∫', 'math-bigop math-int', false);
    if (c === '√') return `<span class="math-sqrt"><span class="math-radical">√</span><span class="math-radicand">${this.arg()}</span></span>`;
    if (/[α-ω]/.test(c)) return `<i class="math-var">${c}</i>`;
    this.noFrac = true;
    if (OP_CHARS.includes(c)) return op(c);
    if (c === ',' || c === ';') return `<span class="math-punct">${c}</span>`;
    if (c === '~') return '<span class="math-space"> </span>';
    if (c === '&' || /\s/.test(c)) return '';
    return `<span class="math-ord">${esc(c)}</span>`;
  };
  Parser.prototype.nextUnit = function () {
    this.ws();
    const c = this.peek();
    if (c === undefined || c === '}') { if (c === '}') this.i++; return null; }
    this.tookScripts = false; this.noFrac = false; this.lastInner = null; this.lastVar = null;
    const base = c === '^' || c === '_' || c === "'" || USUP[c] || USUB[c] ? '' : this.atom();
    const { lastInner: inner, lastVar: v, noFrac, tookScripts } = this;
    const sc = tookScripts ? { sup: null, sub: null } : this.scripts();
    const html = tookScripts ? base : this.attach(base, sc);
    return { html, inner: sc.sup === null && sc.sub === null ? inner : null, v, ok: !noFrac && !!html };
  };
  Parser.prototype.parseAll = function () {
    const toks = [];
    for (let guard = 0; this.i < this.s.length && guard < 5000; guard++) {
      this.ws();
      if (this.i >= this.s.length) break;
      const before = this.i;
      if (this.peek() === '/' && toks.length && toks[toks.length - 1].ok) {
        this.i++;
        let top = toks.pop();
        if (toks.length && ((top.v && toks[toks.length - 1].v === 'd') || (top.inner !== null && toks[toks.length - 1].v))) {
          top = { html: toks.pop().html + top.html, inner: null, ok: true };
        }
        let bot = this.nextUnit();
        if (bot && ((bot.v === 'd' && /^[A-Za-z]/.test(this.s.slice(this.i))) || (bot.v && this.peek() === '('))) {
          const next = this.nextUnit();
          if (next) bot = { html: bot.html + next.html, inner: null, ok: true };
        }
        toks.push(bot && bot.ok ? { html: frac(top.inner || top.html, bot.inner || bot.html), inner: null, ok: true }
          : { html: `${top.html}<span class="math-ord">/</span>${bot ? bot.html : ''}`, inner: null, ok: false });
        continue;
      }
      const u = this.nextUnit();
      if (u && u.html) toks.push(u);
      if (this.i === before) this.i++;
    }
    return toks.map((t) => t.html).join('');
  };

  function renderMath(tex, displayMode) {
    try {
      const html = new Parser(String(tex || '').trim(), !!displayMode).parseAll();
      const tag = displayMode ? 'div' : 'span';
      return `<${tag} class="math ${displayMode ? 'math-display' : 'math-inline'}" role="math" aria-label="${esc(tex)}">${html}</${tag}>`;
    } catch (_e) {
      return `<span class="math math-inline math-error">${esc(tex)}</span>`;
    }
  }

  PDFStudy.mathRenderer = { renderMath, escapeHtml: esc, SYM, OPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.mathRenderer;
})(typeof window !== 'undefined' ? window : globalThis);

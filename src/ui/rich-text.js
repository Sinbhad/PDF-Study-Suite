/**
 * Rich text for study views: splits text into code / display math / inline math / prose, then
 * renders each with mathRenderer (TeX) or as escaped prose with light STEM touch-ups.
 *
 * Ratified contract (#9/#10/#13): inline math `$...$` (or `\(...\)`), display `$$...$$` (or `\[...\]`),
 * inline code in backticks, fenced ```code``` blocks. Bare TeX macros (`\frac{a}{b}`, `\lim_{x \to c}`),
 * `x^{2}`, `a_{n}`, `dy/dx` and Big-O in plain prose are auto-detected as inline math too.
 * Prose is HTML-escaped before anything else touches it, so `x < y` and `ArrayList<Integer>` survive.
 * API: PDFStudy.richText.render(text, { lines }) -> HTML;  .plain(text) -> readable plain text.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const MR = () => PDFStudy.mathRenderer || (typeof require === 'function' ? require('./math-renderer.js') : null);
  const esc = (s) => MR().escapeHtml(s);

  const KEYWORDS = new Set(('for while if then else elif return do end function procedure algorithm to downto ' +
    'repeat until def let var const in and or not true false null nil class new break continue each foreach ' +
    'begin input output print yield public private static void int boolean import from try catch throw').split(' '));

  // Segment tokenizer: fenced code, inline code, $$..$$, \[..\], $..$, \(..\)
  const SEG_RE = /```(\w*)\n?([\s\S]*?)```|`([^`\n]+)`|\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;

  function splitSegments(text) {
    const out = [];
    const s = String(text == null ? '' : text);
    let last = 0;
    let m;
    SEG_RE.lastIndex = 0;
    while ((m = SEG_RE.exec(s))) {
      if (m.index > last) out.push({ type: 'text', value: s.slice(last, m.index) });
      if (m[2] !== undefined) out.push({ type: 'code', lang: m[1] || '', value: m[2] });
      else if (m[3] !== undefined) out.push({ type: 'icode', value: m[3] });
      else if (m[4] !== undefined || m[5] !== undefined) out.push({ type: 'display', value: m[4] || m[5] });
      else out.push({ type: 'inline', value: m[6] !== undefined ? m[6] : m[7] });
      last = SEG_RE.lastIndex;
    }
    if (last < s.length) out.push({ type: 'text', value: s.slice(last) });
    return out;
  }

  /** Pseudocode / code block: escape, then highlight keywords, comments and line numbers. */
  function renderCode(code) {
    const lines = String(code).replace(/\t/g, '    ').replace(/\s+$/, '').split('\n');
    const body = lines.map((ln) => {
      const cut = ln.search(/\/\/|▷|(?:^|\s)#\s/);
      const codePart = cut >= 0 ? ln.slice(0, cut) : ln;
      const comment = cut >= 0 ? `<span class="code-comment">${esc(ln.slice(cut))}</span>` : '';
      const hl = esc(codePart).replace(/\b([A-Za-z_]+)\b/g, (w) =>
        KEYWORDS.has(w.toLowerCase()) ? `<span class="code-kw">${w}</span>` : w);
      return `<span class="code-line">${hl}${comment}</span>`;
    }).join('\n');
    return `<pre class="code-block"><code>${body}</code></pre>`;
  }

  // Bare TeX or function equation (`f(x) = ...`, `T(n) = 2T(n/2) + O(n)`) in prose
  const BARE_START = /\\(?:frac|dfrac|tfrac|sqrt|lim|sum|prod|int|oint|log|ln|sin|cos|tan|sec|csc|cot|exp|max|min|Theta|Omega|Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|infty|to|le|ge|leq|geq|ne|neq|approx|pm|cdot|times|in|notin|subset|subseteq|cup|cap|forall|exists|partial|nabla|left|begin|mathbb|binom|Rightarrow|Leftrightarrow|ldots|cdots)(?![A-Za-z])|\b[fghFGHPT]'*\([A-Za-z0-9_+\-*/^,\s]{1,24}\)\s*=/;

  function bareRunEnd(s, i) {
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '{' || c === '(' || c === '[') depth++;
      else if (c === '}' || c === ')' || c === ']') { if (depth === 0) break; depth--; }
      else if (depth === 0) {
        if (/[.!?;,]/.test(c) && (j + 1 >= s.length || /\s/.test(s[j + 1]))) break;
        // stop at a prose word (2+ letters, not a function name or a differential like dx)
        if (/\s/.test(c)) {
          const w = /^\s+([A-Za-z]{2,})/.exec(s.slice(j));
          if (w && !/^(?:sin|cos|tan|log|ln|lim|max|min|sec|csc|cot|exp|d[a-z])$/.test(w[1])) break;
        }
      }
    }
    if (s.slice(i, j).includes('\\end{')) return j;
    const endEnv = s.indexOf('\\end{', i);
    if (s.slice(i, i + 7) === '\\begin{' && endEnv > 0) return s.indexOf('}', endEnv) + 1;
    return j;
  }

  /** Escaped prose with STEM touch-ups (bare TeX, scripts, dy/dx, Big-O, minus signs). */
  function renderProse(text) {
    const s = String(text);
    let html = '';
    let i = 0;
    while (i < s.length) {
      const rest = s.slice(i);
      const m = BARE_START.exec(rest);
      if (!m) { html += touchUp(rest); break; }
      html += touchUp(rest.slice(0, m.index));
      const start = i + m.index;
      const end = Math.max(start + m[0].length, bareRunEnd(s, start));
      html += MR().renderMath(s.slice(start, end).trim(), false);
      if (/\s$/.test(s.slice(start, end))) html += ' ';
      i = end;
    }
    return html;
  }

  function touchUp(text) {
    if (!text) return '';
    const mr = MR();
    let out = '';
    // Inline STEM fragments: `f'(x)` / `T(n/2)`, `dy/dx`, Big-O/Θ/Ω, `x^2`, `R^(-1)`, `a_n`, `R_12`
    const FRAG = /\b([fghFGHPT]'*\([A-Za-z0-9_+\-*/^,\s]{1,24}\))|\b(d[a-zA-Z]?)\/(d[a-zA-Z])\b|\b([OΘΩo]|Theta|Omega)\((n[^()]{0,24}|[^()]{0,24}n)\)|([A-Za-z0-9)\]])\^(\{[^{}]{1,30}\}|\([-−+]?[A-Za-z0-9]{1,6}\)|[-−]?[A-Za-z0-9]+)|(\b[A-Za-z]|[\])])_(\{[^{}]{1,20}\}|\d{1,3}|[A-Za-z])(?![A-Za-z0-9_])/g;
    let last = 0;
    let m;
    while ((m = FRAG.exec(text))) {
      out += esc(text.slice(last, m.index));
      if (m[1]) out += mr.renderMath(m[1].replace(/\blog\b/g, '\\log'), false);
      else if (m[2]) out += mr.renderMath(`\\frac{${m[2]}}{${m[3]}}`, false);
      else if (m[4]) out += mr.renderMath(`${m[4].length > 1 ? `\\${m[4]}` : m[4]}(${m[5].replace(/\blog\b/g, '\\log')})`, false);
      else if (m[6]) out += mr.renderMath(`${m[6]}^{${m[7].replace(/^[({]|[)}]$/g, '').replace('−', '-')}}`, false);
      else out += mr.renderMath(`${m[8]}_{${m[9].replace(/^\{|\}$/g, '')}}`, false);
      last = FRAG.lastIndex;
    }
    return out + esc(text.slice(last));
  }

  function renderInlineRun(run, lines) {
    const markers = run.reduce((n, g) => n + (g.type === 'text' ? g.value.split('**').length - 1 : 0), 0);
    let pairs = Math.floor(markers / 2);
    let open = false;
    return run.map((seg) => {
      if (seg.type === 'icode') return `<code class="inline-code">${esc(seg.value)}</code>`;
      if (seg.type === 'inline') return MR().renderMath(seg.value, false);
      const parts = seg.value.split('**');
      return parts.map((p, k) => {
        const body = lines ? renderProse(p).replace(/\n/g, '<br>') : renderProse(p);
        if (k === parts.length - 1) return body;
        if (!open && pairs > 0) { open = true; return `${body}<strong>`; }
        if (open) { open = false; pairs--; return `${body}</strong>`; }
        return body; // strip any unmatched residual **
      }).join('');
    }).join('');
  }

  function render(text, opts = {}) {
    const segs = splitSegments(text);
    const out = [];
    let run = [];
    const flush = () => { if (run.length) { out.push(renderInlineRun(run, !!opts.lines)); run = []; } };
    for (const seg of segs) {
      if (seg.type === 'code' || seg.type === 'display') {
        flush();
        out.push(seg.type === 'code' ? renderCode(seg.value) : MR().renderMath(seg.value, true));
      } else {
        run.push(seg);
      }
    }
    flush();
    return out.join('');
  }

  /** Plain-text approximation (aria labels, Anki export, markdown): strips delimiters, maps macros. */
  function plain(text) {
    const mr = MR();
    return String(text == null ? '' : text)
      .replace(/```\w*\n?|`|\*\*/g, '')
      .replace(/\$\$?|\\[[\]()]/g, '')
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
      .replace(/\\([A-Za-z]+)/g, (w, n) => mr.OPS[n] || mr.SYM[n] || n)
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const hasMath = (text) => /\$|\\[A-Za-z]|`|\^\{|_\{/.test(String(text || ''));

  PDFStudy.richText = { render, plain, hasMath, splitSegments, renderCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.richText;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Math-aware line formatter: turns one baseline row of spans into
 *   { text, formattedText, isBold, hasMath, isCode }
 * text: plain Unicode (x^2, (a)/(b)); formattedText: prose with **bold** terms plus TeX math in `$...$`,
 * or a whole-line display formula as `$$...$$` (contract ratified on the swarm board, #9 / #10 / #13).
 * Superscripts / subscripts come from font scale + baseline shift; 2D fractions, radicals, cases and
 * operator bounds arrive pre-built as synthetic spans ({ tex, plain }) from formula-builder.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const T = () => PDFStudy.mathTex || (typeof require === 'function' ? require('./math-tex.js') : null);

  const STRONG_MATH_RE = /[=<>≤≥≠≈≡→⇒⇔∈∉⊂⊆∪∩∀∃∫∑∏√∞∂∇±×÷⋅′″α-ωΑ-Ω‖⌊⌋⌈⌉⟨⟩]/;
  const TALL_DELIM_RE = /^[|‖()[\]{}∫∑∏√⎧⎨⎩⎪⎫⎬⎭]+$/;
  const PROSE_WORD_RE = /[A-Za-z]{3,}/g;

  /** Base font size of a span group: upper non-delimiter tier so multi-char exponents (x^{10}, 2^{k+1}) never outvote x. */
  function baseSize(spans) {
    const plain = spans.filter((s) => !s.tex && s.fontSize > 0);
    if (!plain.length) return Math.max(10, ...spans.map((s) => s.fontSize || 10));
    const nonDelim = plain.filter((s) => !TALL_DELIM_RE.test((s.text || '').trim()));
    const pool = nonDelim.length ? nonDelim : plain;
    const top = Math.max(...pool.map((s) => s.fontSize));
    const counts = new Map();
    for (const s of pool) {
      if (s.fontSize < top * 0.84) continue;
      const k = Math.round(s.fontSize * 2) / 2;
      counts.set(k, (counts.get(k) || 0) + Math.max(1, (s.text || '').trim().length));
    }
    let best = top;
    let n = -1;
    for (const [k, c] of counts) if (c > n || (c === n && k > best)) [best, n] = [k, c];
    return best;
  }

  /** 'sup' | 'sub' | 'base' for each span relative to the row's base size and baseline. */
  function roles(spans) {
    const base = baseSize(spans);
    const regular = spans.filter((s) => (s.tex || s.fontSize > base * 0.82) && (!TALL_DELIM_RE.test((s.text || '').trim()) || s.fontSize <= base * 1.25));
    const ys = (regular.length ? regular : spans).map((s) => s.baselineY).sort((a, b) => a - b);
    const baseY = ys[Math.floor(ys.length / 2)];
    return spans.map((s) => {
      // A shrunken comma / period is an authoring slip, never a real sub- or superscript
      if (s.tex || s.fontSize > base * 0.82 || /^[\s.,;:!?]+$/.test(s.text || '')) return 'base';
      if (s.baselineY < baseY - base * 0.12) return 'sup';
      if (s.baselineY > baseY + base * 0.08) return 'sub';
      return 'base';
    });
  }

  /** Splits trailing base tokens ("... in 10" + "-11", ", a" + "2") so scripts attach to their base. */
  function detachScriptBases(spans) {
    const role = roles(spans);
    const out = [];
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i];
      const next = spans[i + 1];
      if (!s.tex && role[i] === 'base' && next && role[i + 1] !== 'base' && next.x0 - s.x1 < s.fontSize * 0.4) {
        const m = (s.text || '').match(/^(.+?[\s,;:(=<>+\-−])([A-Za-z0-9]+)\s*$/);
        if (m) {
          const ratio = m[1].length / s.text.length;
          const midX = s.x0 + (s.x1 - s.x0) * ratio;
          out.push({ ...s, text: m[1], x1: midX });
          out.push({ ...s, text: m[2], x0: midX, __scriptBase: true });
          continue;
        }
      }
      out.push(s);
    }
    return out;
  }

  function isProse(s) {
    if (s.tex || s.__scriptBase) return false;
    const text = (s.text || '').trim();
    const isFn = (w) => T().FUNC_RE.test(w);
    if (s.isItalic || s.isMath) {
      const real = (text.match(PROSE_WORD_RE) || []).filter((w) => !isFn(w) && !(s.isMath && w.length <= 3));
      return real.length > 0 && !/^[A-Za-z]{1,2}[.,;:)]?$/.test(text);
    }
    const words = text.match(/[A-Za-z]+/g) || [];
    return words.some((w) => !isFn(w) && !/^(?:d[a-z]|[A-Za-z])$/.test(w)) || /^(?:a|A|I)$/.test(text);
  }

  /** Builds TeX for a group of spans (a math run, a numerator, a bound). */
  function spansToTex(spans) {
    const sorted = [...spans].sort((a, b) => a.x0 - b.x0);
    const role = roles(sorted);
    const tokens = [];
    let script = null;
    const flush = () => {
      if (!script) return;
      tokens.push(`${tokens.length ? '' : '{}'}${script.role === 'sup' ? '^' : '_'}{${T().join(script.parts)}}`);
      script = null;
    };
    sorted.forEach((s, i) => {
      const tex = s.tex || T().texOf(s.text, { italic: s.isItalic });
      if (role[i] === 'base') {
        flush();
        const prev = sorted[i - 1];
        if (prev && tokens.length && s.x0 - prev.x1 > s.fontSize * 1.5) tokens.push('\\quad');
        tokens.push(tex);
      } else if (/^[).,:;]+$/.test(tex) && (!script || !script.parts.some((p) => p.includes('(')))) {
        flush();
        tokens.push(tex);
      } else {
        if (script && script.role !== role[i]) flush();
        if (!script) script = { role: role[i], parts: [] };
        script.parts.push(tex);
      }
    });
    flush();
    return T().join(tokens).replace(/\s*([_^])\{/g, '$1{');
  }

  function spansToPlain(spans) {
    const sorted = [...spans].sort((a, b) => a.x0 - b.x0);
    const role = roles(sorted);
    return sorted
      .map((s, i) => {
        const t = (s.plain || s.text || '').trim();
        if (role[i] === 'sup') return t.length > 1 ? `^(${t})` : `^${t}`;
        if (role[i] === 'sub') return t.length > 1 ? `_(${t})` : `_${t}`;
        return (i && sorted[i - 1].x1 < s.x0 - s.fontSize * 0.15 ? ' ' : '') + t;
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function runIsMath(run, runRoles) {
    return run.some((s, i) => s.tex || runRoles[i] !== 'base' || STRONG_MATH_RE.test(s.text) ||
      (s.isItalic && /[A-Za-z]/.test(s.text)) || (s.isMath && /[+\-−/|]/.test(s.text)) ||
      /^[A-Za-z]\s*\([A-Za-z0-9,\s+\-]+\)$/.test((s.text || '').trim()));
  }

  function wrapBold(raw) {
    const m = raw.match(/^(\s*[("'“]*)(.*?)([)"'”.,;:!?]*\s*)$/);
    if (!m) return raw;
    const core = m[2].trim();
    return /[A-Za-z]{2}/.test(core) ? `${m[1]}**${core}**${m[3]}` : raw;
  }

  function formatLine(rawSpans) {
    const sf = PDFStudy.spanFormat;
    if (sf && sf.isCodeLine && sf.isCodeLine(rawSpans)) {
      const text = rawSpans.map((s, i) => (i && s.x0 - rawSpans[i - 1].x1 > s.fontSize * 0.1 ? ' ' : '') + s.text).join('').replace(/\s+/g, ' ').trim();
      return { text, formattedText: text ? `\`${text.replace(/`/g, "'")}\`` : '', isBold: false, hasMath: false, isCode: true };
    }
    const spans = detachScriptBases(rawSpans);
    const role = roles(spans);
    const pieces = [];
    spans.forEach((s, i) => {
      const scripted = role[i + 1] && role[i + 1] !== 'base' && spans[i + 1].x0 - s.x1 < s.fontSize * 0.4 &&
        (s.__scriptBase || /^[A-Za-z0-9()]+$/.test((s.text || '').trim()));
      const prose = !s.tex && role[i] === 'base' && !scripted && isProse(s);
      const last = pieces[pieces.length - 1];
      if (!prose && last && last.math) {
        last.spans.push(s);
        last.roles.push(role[i]);
      } else pieces.push({ math: !prose, spans: [s], roles: [role[i]] });
    });
    const out = [];
    for (const p of pieces) {
      if (p.math && runIsMath(p.spans, p.roles)) {
        out.push({ first: p.spans[0], last: p.spans[p.spans.length - 1], text: spansToPlain(p.spans), fmt: `$${spansToTex(p.spans)}$`, bold: false, math: true });
      } else {
        for (const s of p.spans) out.push({ first: s, last: s, text: s.plain || s.text, fmt: null, bold: Boolean(s.isBold), math: false });
      }
    }
    let fullText = '';
    let fmtText = '';
    const runs = [];
    out.forEach((o, i) => {
      const prev = out[i - 1];
      const sp = prev && o.first.x0 - prev.last.x1 > o.first.fontSize * 0.1 && !fullText.endsWith(' ') && !/^\s/.test(o.text) ? ' ' : '';
      fullText += sp + o.text;
      const piece = { text: sp + (o.fmt || o.text), bold: o.bold && !o.math, math: o.math };
      const last = runs[runs.length - 1];
      if (last && !last.math && !piece.math && last.bold === piece.bold) last.text += piece.text;
      else runs.push(piece);
      fmtText += piece.text;
    });
    const trimmed = fullText.replace(/\s+/g, ' ').trim();
    const charCount = spans.reduce((acc, s) => acc + (s.text || '').trim().length, 0);
    const boldChars = spans.reduce((acc, s) => acc + (s.isBold ? (s.text || '').trim().length : 0), 0);
    const heavyChars = spans.reduce((acc, s) => acc + (s.isBold || s.isLarge ? (s.text || '').trim().length : 0), 0);
    const isBold = charCount > 0 && heavyChars >= charCount * 0.5;
    const hasMath = out.some((o) => o.math);

    let formattedText = fmtText.replace(/\s+/g, ' ').trim();
    if (!hasMath && trimmed.length <= 85 && boldChars >= charCount * 0.85 && charCount > 0) {
      formattedText = `**${trimmed}**`;
    } else if (out.some((o) => o.bold)) {
      formattedText = runs.map((r) => (r.bold && r.text.trim().length <= 60 ? wrapBold(r.text) : r.text)).join('').replace(/\s+/g, ' ').trim();
    }
    if (hasMath && out.every((o) => o.math || /^[\s.,;:()]*$/.test(o.text)) && out.filter((o) => o.math).length === 1) {
      const m = formattedText.match(/^([^$]*)\$([^$]+)\$([^$]*)$/);
      if (m && /[=<>≤≥≠≈→]|\\(?:frac|int|sum|lim|le|ge|ne|to|approx|begin\{cases\})/.test(m[2])) {
        formattedText = `$$${(m[1] + m[2] + m[3]).replace(/\s+/g, ' ').trim()}$$`;
      }
    }
    return { text: trimmed, formattedText, isBold, hasMath };
  }

  PDFStudy.mathLine = { formatLine, spansToTex, spansToPlain, roles, baseSize, wrapBold, isProse };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.mathLine;
  }
})(typeof window !== 'undefined' ? window : globalThis);

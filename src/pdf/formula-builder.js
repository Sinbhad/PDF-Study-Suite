/**
 * 2D Formula Builder: collapses radicals, stacked fractions, piecewise cases, and ∑/∏/∫/lim bounds
 * into synthetic spans before lines are built so multi-level textbook math never interleaves.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const ML = () => PDFStudy.mathLine || (typeof require === 'function' ? require('./math-line.js') : null);
  const cx = (s) => (s.x0 + s.x1) / 2;
  const wrapPlain = (t) => (/^[\w.′'^]+$/.test(t) ? t : `(${t})`);
  const TALL_DELIM_RE = /^[|‖()[\]]+$/;
  const ALL_DELIM_RE = /^[|‖()[\]{}∫∑∏√⎧⎨⎩⎪⎫⎬⎭]+$/;

  function synth(members, tex, plain, baselineY, fontSize) {
    return { tex, plain, text: plain, isMath: true, fontSize, baselineY, isBold: false, isItalic: false, isLarge: false,
      x0: Math.min(...members.map((s) => s.x0)), x1: Math.max(...members.map((s) => s.x1)),
      topY: Math.min(...members.map((s) => s.topY)), bottomY: Math.max(...members.map((s) => s.bottomY)) };
  }

  const replace = (spans, members, created) => { const gone = new Set(members); return spans.filter((s) => !gone.has(s)).concat(created); };

  function bodyOf(spans) {
    const counts = new Map();
    const pool = spans.filter((s) => !s.tex && s.fontSize >= 8 && !ALL_DELIM_RE.test((s.text || '').trim()));
    for (const s of pool.length ? pool : spans) {
      const k = Math.round(s.fontSize * 2) / 2;
      counts.set(k, (counts.get(k) || 0) + Math.max(1, (s.text || '').trim().length));
    }
    let best = 10;
    let bestN = -1;
    for (const [sz, n] of counts) if (n > bestN || (n === bestN && sz > best)) [best, bestN] = [sz, n];
    return best;
  }

  function chain(seed, pool, fs) {
    const out = [...seed];
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of pool) {
        if (out.includes(s)) continue;
        if (out.some((o) => Math.abs(o.baselineY - s.baselineY) < fs * 0.2 && s.x0 < o.x1 + fs * 0.3 && s.x1 > o.x0 - fs * 0.3)) {
          out.push(s);
          grew = true;
        }
      }
    }
    return out;
  }

  function radicals(spans, rules, used) {
    spans = spans.flatMap((s) => {
      const t = !s.tex && (s.text || '').trim();
      if (!t || t === '√' || !t.endsWith('√')) return [s];
      const cut = Math.max(s.x0 + 1, s.x1 - s.fontSize * 0.8);
      return [{ ...s, text: t.slice(0, -1), x1: cut }, { ...s, text: '√', x0: cut }];
    });
    // "x → −3" printed under a lim on the row above is that limit's bound, never the index of a radical below it
    const lims = spans.filter((s) => !s.tex && (s.text || '').trim() === 'lim');
    const underLim = (s) => lims.some((l) => cx(s) > l.x0 - l.fontSize * 0.5 && cx(s) < l.x1 + l.fontSize * 0.5 &&
      s.baselineY > l.baselineY && s.baselineY - l.baselineY < l.fontSize * 1.6);
    for (const rad of spans.filter((s) => !s.tex && s.text.trim() === '√')) {
      const fs = rad.fontSize;
      // Vinculum starts at the right edge of √ (rad.x1), never at rad.x0 (which would be an enclosing fraction bar)
      const cands = rules
        .filter((q) => !used.has(q) && q.x0 >= rad.x1 - 3 && q.x0 <= rad.x1 + 3 && q.y >= rad.topY - fs * 0.7 && q.y <= rad.baselineY - fs * 0.25)
        .sort((a, b) => Math.abs(a.x0 - rad.x1) - Math.abs(b.x0 - rad.x1));
      const r = cands[0];
      if (!r) continue;
      const body = spans.filter((s) => s !== rad && cx(s) > r.x0 && cx(s) < r.x1 + 0.5 && s.baselineY > r.y && s.baselineY - r.y <= Math.max(fs * 1.6, 13));
      if (!body.length) continue;
      const idx = spans.filter((s) => s !== rad && !body.includes(s) && !underLim(s) && s.fontSize < Math.max(fs, 10) * 0.8 &&
        s.x1 <= rad.x0 + (rad.x1 - rad.x0) * 0.7 && s.x0 >= rad.x0 - fs && s.baselineY < rad.baselineY - fs * 0.15 && s.baselineY > rad.topY - fs);
      used.add(r);
      const inner = ML().spansToTex(body);
      const n = idx.length ? ML().spansToTex(idx) : '';
      const base = Math.max(...body.map((s) => s.baselineY));
      const made = synth([rad, ...body, ...idx], n ? `\\sqrt[${n}]{${inner}}` : `\\sqrt{${inner}}`,
        `${n ? `${n}√` : '√'}${wrapPlain(ML().spansToPlain(body))}`, base, Math.max(...body.map((s) => s.fontSize)));
      spans = replace(spans, [rad, ...body, ...idx], [made]);
    }
    return spans;
  }

  function reseatDelims(group, body) {
    const reg = group.filter((s) => !TALL_DELIM_RE.test((s.text || '').trim()) || s.fontSize <= body * 1.2);
    if (!reg.length) return group;
    const refY = reg[0].baselineY;
    return group.map((s) => (TALL_DELIM_RE.test((s.text || '').trim()) && s.fontSize > body * 1.2 ? { ...s, baselineY: refY, fontSize: body } : s));
  }

  function fractions(spans, rules, used) {
    const body = bodyOf(spans);
    const order = rules.filter((r) => !used.has(r)).sort((a, b) => a.x1 - a.x0 - (b.x1 - b.x0));
    for (const r of order) {
      const inside = (s) => !(s.x0 >= r.x1 - 1 && /^[.,;:]$/.test((s.text || '').trim())) &&
        cx(s) > r.x0 - 1.5 && cx(s) < r.x1 + 1.5 && s.x0 >= r.x0 - body * 0.45 && s.x1 <= r.x1 + body * 0.45;
      const isTall = (s) => !s.tex && TALL_DELIM_RE.test((s.text || '').trim()) && s.fontSize >= body * 1.2;
      const midY = (s) => (s.topY + s.bottomY) / 2;
      const num = spans.filter((s) => inside(s) && (isTall(s)
        ? midY(s) < r.y - 0.5 && r.y - midY(s) <= body * 1.35 && s.bottomY <= r.y + 3
        : r.y - s.baselineY > 0.5 && r.y - s.baselineY <= body * 1.35));
      const den = spans.filter((s) => inside(s) && !num.includes(s) && (isTall(s)
        ? midY(s) > r.y + 0.5 && midY(s) - r.y <= body * 1.65 && s.topY >= r.y - 3
        : s.baselineY - r.y > body * 0.25 && s.baselineY - r.y <= body * 1.95));
      if (!num.length || !den.length) continue;
      const chars = (g) => g.reduce((a, s) => a + (s.plain || s.text).trim().length, 0);
      if (chars(num) > 160 || chars(den) > 160) continue;
      const contentW = Math.max(...num.map((s) => s.x1)) - Math.min(...num.map((s) => s.x0));
      const denW = Math.max(...den.map((s) => s.x1)) - Math.min(...den.map((s) => s.x0));
      if (r.x1 - r.x0 > Math.max(contentW, denW) * 1.25 + body * 1.5) continue;
      const axis = spans.find((s) => !num.includes(s) && !den.includes(s) && s.baselineY >= r.y - body * 0.1 && s.baselineY <= r.y + body * 0.75 &&
        (s.x1 <= r.x0 + 1 || s.x0 >= r.x1 - 1) && Math.min(Math.abs(s.x1 - r.x0), Math.abs(s.x0 - r.x1)) < body * 6);
      used.add(r);
      const nClean = reseatDelims(num, body);
      const dClean = reseatDelims(den, body);
      const tex = `\\frac{${ML().spansToTex(nClean)}}{${ML().spansToTex(dClean)}}`;
      const plain = `${wrapPlain(ML().spansToPlain(nClean))}/${wrapPlain(ML().spansToPlain(dClean))}`;
      const made = synth(num.concat(den), tex, plain, axis ? axis.baselineY : r.y + body * 0.3, body);
      made.x0 = Math.min(made.x0, r.x0);
      made.x1 = Math.max(made.x1, r.x1);
      spans = replace(spans, num.concat(den), [made]);
    }
    return spans;
  }

  /** Merges CMEX brace pieces (⎧⎨⎩⎪) and collapses piecewise { rows into \begin{cases}...\end{cases}. */
  function piecewiseCases(spans) {
    const body = bodyOf(spans);
    const pieces = spans.filter((s) => !s.tex && /^[⎧⎨⎩⎪]$/.test(s.text.trim())).sort((a, b) => a.x0 - b.x0 || a.topY - b.topY);
    const visited = new Set();
    for (const p of pieces) {
      if (visited.has(p)) continue;
      const stack = pieces.filter((q) => !visited.has(q) && Math.abs(q.x0 - p.x0) <= 2.5 && q.topY <= p.bottomY + body * 5);
      stack.forEach((q) => visited.add(q));
      if (stack.length >= 2) {
        const topY = Math.min(...stack.map((q) => q.topY));
        const botY = Math.max(...stack.map((q) => q.bottomY));
        const br = { ...p, text: '{', topY, bottomY: botY, baselineY: (topY + botY) / 2, fontSize: botY - topY, isMath: true };
        spans = replace(spans, stack, [br]);
      }
    }
    const braces = spans.filter((s) => !s.tex && s.text.trim() === '{' && s.bottomY - s.topY >= body * 1.5);
    for (const br of braces) {
      const rhs = spans.filter((s) => s !== br && s.x0 >= br.x0 + 1 && s.x0 <= br.x1 + body * 18 &&
        s.baselineY >= br.topY - body * 0.45 && s.baselineY <= br.bottomY + body * 0.85);
      const rows = [];
      for (const s of [...rhs].sort((a, b) => a.baselineY - b.baselineY || a.x0 - b.x0)) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(s.baselineY - last.y) <= body * 0.45) last.spans.push(s);
        else rows.push({ y: s.baselineY, spans: [s] });
      }
      if (rows.length < 2) continue;
      const texRows = rows.map((row) => {
        const rs = row.spans.sort((a, b) => a.x0 - b.x0);
        let splitIdx = -1;
        for (let i = 1; i < rs.length; i++) if (rs[i].x0 - rs[i - 1].x1 > body * 1.0) { splitIdx = i; break; }
        return splitIdx > 0
          ? `${ML().spansToTex(rs.slice(0, splitIdx))} & ${ML().spansToTex(rs.slice(splitIdx))}`
          : ML().spansToTex(rs);
      });
      const plainRows = rows.map((row) => ML().spansToPlain(row.spans));
      const lhs = spans.find((s) => s !== br && !rhs.includes(s) && s.x1 <= br.x0 + 3 && br.x0 - s.x1 < body * 3.5 &&
        s.baselineY >= br.topY - body * 0.2 && s.baselineY <= br.bottomY + body * 0.5);
      const refY = lhs ? lhs.baselineY : (rows[0].y + rows[rows.length - 1].y) / 2;
      const made = synth([br, ...rhs], `\\begin{cases} ${texRows.join(' \\\\ ')} \\end{cases}`, `{ ${plainRows.join('; ')} }`, refY, body);
      spans = replace(spans, [br, ...rhs], [made]);
    }
    return spans;
  }

  function bigOperators(spans) {
    const body = bodyOf(spans);
    spans = spans.flatMap((s) => {
      const m = !s.tex && !s.isItalic && (s.text || '').match(/^(.*\s)(lim)\s*$/);
      if (!m) return [s];
      const cut = Math.max(s.x0 + 1, s.x1 - s.fontSize * 1.4);
      return [{ ...s, text: m[1], x1: cut }, { ...s, text: 'lim', x0: cut }];
    });
    const ops = spans.filter((s) => !s.tex && (/^[∑∏∫]$/.test(s.text.trim()) || (s.text.trim() === 'lim' && !s.isItalic)))
      .sort((a, b) => (a.text.trim() === 'lim') - (b.text.trim() === 'lim') || a.baselineY - b.baselineY);
    const meta = new Map(ops.map((op) => {
      const sym = op.text.trim(), isLim = sym === 'lim', big = op.fontSize >= body * 1.25, b = isLim || !big ? op.fontSize : body;
      const next = spans.filter((s) => s !== op && s.x0 >= op.x1 - 1 && s.x0 - op.x1 < b * 4 && s.fontSize > b * 0.85 &&
        Math.abs(s.baselineY - op.baselineY) < Math.max(op.fontSize * 0.6, b * 0.8)).sort((p, q) => p.x0 - q.x0)[0];
      return [op, { sym, isLim, big, b, refY: isLim || !big ? op.baselineY : next ? next.baselineY : op.baselineY,
        lo: op.x0 - b * 0.4, hi: op.x1 + (sym === '∫' ? b * 0.9 : b * 0.4) }];
    }));
    const flat = (g) => {
      const y0 = g[0].baselineY, f0 = Math.min(...g.map((x) => x.fontSize));
      return g.map((x) => (Math.abs(x.baselineY - y0) <= 1.8 && x.fontSize <= f0 * 1.3 ? { ...x, baselineY: y0, fontSize: f0 } : x));
    };
    for (const op of ops) {
      const { sym, isLim, big, b, refY, lo, hi } = meta.get(op);
      if (!isLim && !big && sym !== '∫') continue;
      const mine = (s) => ![...meta.values()].some((q) => q.refY !== refY && cx(s) > q.lo - q.b * 0.3 && cx(s) < q.hi + q.b * 0.3 &&
        Math.abs(s.baselineY - q.refY) + 0.5 < Math.abs(s.baselineY - refY));
      const small = spans.filter((s) => s !== op && !s.tex && s.fontSize <= b * 0.82 && cx(s) > lo && cx(s) < hi && mine(s));
      const top = Math.max(op.topY - b * (sym === '∫' ? (big ? 0.3 : 0.8) : 0.35), refY - b * 1.85);
      const under = small.filter((s) => s.baselineY > refY + b * 0.15 && s.baselineY < Math.min(op.bottomY + b * 1.0, refY + b * 1.6));
      const over = isLim ? [] : small.filter((s) => s.baselineY < refY - b * 0.45 && s.baselineY > top);
      const pool = spans.filter((s) => s !== op && !s.tex && s.fontSize <= b * 0.82 && mine(s));
      const lower = under.length ? chain(under, pool, b) : [];
      const upper = over.length ? chain(over, pool.filter((s) => !lower.includes(s)), b) : [];
      if (!lower.length && !upper.length) continue;
      const cmd = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int', lim: '\\lim' }[sym];
      const lt = lower.length ? `_{${ML().spansToTex(flat(lower))}}` : '';
      const ut = upper.length ? `^{${ML().spansToTex(flat(upper))}}` : '';
      const plainB = [lower, upper].filter((g) => g.length).map((g) => ML().spansToPlain(flat(g))).join(', ');
      const made = synth([op, ...lower, ...upper], `${cmd}${lt}${ut}`, `${sym === 'lim' ? 'lim' : sym}[${plainB}]`, refY, b);
      made.x1 = Math.max(op.x1, ...lower.concat(upper).filter((s) => s.x0 < op.x1).map((s) => s.x1), op.x1);
      spans = replace(spans, [op, ...lower, ...upper], [made]);
    }
    return spans;
  }

  function seatTallGlyphs(spans) {
    const body = bodyOf(spans);
    for (const s of spans) {
      if (s.tex || s.fontSize < body * 1.35 || !ALL_DELIM_RE.test((s.text || '').trim())) continue;
      const near = spans.filter((o) => o !== s && o.fontSize <= body * 1.1 && o.fontSize > body * 0.85 && o.baselineY <= s.bottomY + 2 &&
        o.baselineY >= s.topY && Math.min(Math.abs(o.x0 - s.x1), Math.abs(s.x0 - o.x1)) < body * 3);
      if (near.length) {
        near.sort((a, b) => Math.abs(a.baselineY - s.baselineY) - Math.abs(b.baselineY - s.baselineY));
        s.baselineY = near[0].baselineY;
        s.fontSize = body;
      }
    }
    return spans;
  }

  function collapse(spans, rules = []) {
    if (!spans || spans.length < 2) return spans || [];
    const used = new Set();
    let out = radicals(spans.slice(), rules, used);
    out = fractions(out, rules, used);
    out = piecewiseCases(out);
    out = bigOperators(out);
    return seatTallGlyphs(out);
  }

  PDFStudy.formulaBuilder = { collapse, fractions, radicals, piecewiseCases, bigOperators };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.formulaBuilder;
  }
})(typeof window !== 'undefined' ? window : globalThis);

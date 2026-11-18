/**
 * Math run boundaries for math-line.js: where a formula inside a row of prose starts and ends, so a line
 * never comes out half prose and half formula ("conditional statement p $\to q$", "$|x$|", "A $\to C.$").
 *   splitOperands(spans)   a lone variable at the end of a prose span right before an operator ("... statement p"
 *                          + "→") or at the start of one right after it ("q is true") becomes its own span, so it
 *                          joins the formula instead of the prose
 *   balance(pieces)        a formula that opens "(" or "|" takes the closer from the prose right after it; one
 *                          that closes takes the opener from the prose right before it
 *   operatorOnly(spans)    the plain text of a run that is nothing but an operator ("==", "→", ">") set between
 *                          words, or null: such a run is shown as text, not as a one-symbol formula
 *   outerPunct(tex)        { tex, tail }: sentence punctuation at the end of a formula moved after it
 * DOM-free.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // A span that starts with a relation or connective: the formula continues across it
  const OPERATOR_START_RE = /^\s*(?:[=<>≤≥≠≈≡→←⇒⇔↔∈∉⊂⊆⊃⊇∪∩∧∨⊕×÷+−¬]|\\(?:to|le|ge|ne|in|wedge|vee|oplus|leftrightarrow|Rightarrow)\b)/;
  // Nothing but operator symbols (and spaces)
  const OPERATOR_ONLY_RE = /^\s*[=<>≤≥≠≈≡→←⇒⇔↔∧∨⊕!+−-]{1,3}\s*$/;

  /** Cuts a span's text at `at`, sharing its width in proportion to the characters on each side. */
  function cut(s, at) {
    const text = String(s.text || '');
    const w = (s.x1 - s.x0) / Math.max(1, text.length);
    const left = { ...s, text: text.slice(0, at), x1: s.x0 + at * w };
    const right = { ...s, text: text.slice(at), x0: s.x0 + at * w };
    if (s.plain !== undefined) { left.plain = left.text; right.plain = right.text; }
    return [left, right];
  }

  const isOperator = (s) => Boolean(s) && !s.tex && OPERATOR_START_RE.test(String(s.text || ''));
  // A variable is an italic letter, or a capital letter standing alone ("IF A → B"), never the article "a"
  const variable = (letter, s) => /^[A-Za-z]$/.test(letter) && (s.isItalic || /^[A-Z]$/.test(letter)) && letter !== 'I';

  function splitOperands(spans) {
    let out = spans.slice();
    for (let pass = 0; pass < 2; pass++) {
      const next = [];
      out.forEach((s, i) => {
        const text = String(s.text || '');
        // A letter on its own beside an operator ("A" + "→" at the start of a line) is an operand, never the article
        if (!s.tex && variable(text.trim(), s) && (isOperator(out[i + 1]) || isOperator(out[i - 1]))) s = { ...s, __operand: true };
        if (s.tex || s.isMath || text.trim().length < 3) { next.push(s); return; }
        let parts = [s];
        // "... statement p" + "→": the trailing p belongs to the formula
        const tail = text.match(/\s([A-Za-z])\s*$/);
        if (tail && isOperator(out[i + 1]) && variable(tail[1], s)) {
          parts = cut(s, tail.index + 1);
          parts[1].__operand = true;
        }
        // "→" + "q is true": the leading q belongs to the formula
        const first = parts[0];
        // ... and so does a number right after it: "$Q =$" + "1 and" -> "$Q = 1$ and"
        const head = String(first.text).match(/^\s*([A-Za-z]|\d+(?:\.\d+)?)(?=[\s,;:)]|\.(?:\s|$))/);
        const operand = head && (/^\d/.test(head[1]) || variable(head[1], first));
        if (!first.__operand && operand && isOperator(out[i - 1]) && String(first.text).trim().length > head[1].length) {
          const pair = cut(first, head[0].length);
          pair[0].__operand = true;
          parts = pair.concat(parts.slice(1));
        }
        next.push(...parts.filter((p) => String(p.text).trim()));
      });
      out = next;
    }
    return out;
  }

  const textOf = (piece) => piece.spans.map((s) => s.plain || s.text || '').join('');
  const count = (t, ch) => t.split(ch).length - 1;

  /** Moves the first character of a prose piece's first span into the math piece before it, or the reverse. */
  function moveChar(from, to, atStart) {
    const list = from.spans;
    const s = atStart ? list[0] : list[list.length - 1];
    const text = String(s.text || '');
    const [left, right] = atStart ? cut(s, text.search(/\S/) + 1) : cut(s, text.search(/\S\s*$/));
    const moved = atStart ? left : right;
    const kept = atStart ? right : left;
    if (atStart) {
      list.splice(0, 1, ...(String(kept.text).trim() ? [kept] : []));
      to.spans.push(moved);
      to.roles.push('base');
    } else {
      list.splice(list.length - 1, 1, ...(String(kept.text).trim() ? [kept] : []));
      to.spans.unshift(moved);
      to.roles.unshift('base');
    }
  }

  function balance(pieces) {
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      if (!p.math) continue;
      const after = pieces[i + 1];
      const before = pieces[i - 1];
      const t = textOf(p);
      const head = after && !after.math && after.spans.length ? String(after.spans[0].text || '').trimStart() : '';
      if ((count(t, '(') > count(t, ')') && head.startsWith(')')) || (count(t, '|') % 2 === 1 && head.startsWith('|'))) {
        moveChar(after, p, true);
      }
      const t2 = textOf(p);
      const tail = before && !before.math && before.spans.length ? String(before.spans[before.spans.length - 1].text || '').trimEnd() : '';
      if ((count(t2, ')') > count(t2, '(') && tail.endsWith('(')) || (count(t2, '|') % 2 === 1 && tail.endsWith('|'))) {
        moveChar(before, p, false);
        continue;
      }
      // "|" + "x" + "| (that is": the bars (or parentheses) on both sides enclose the formula
      const head2 = after && !after.math && after.spans.length ? String(after.spans[0].text || '').trimStart() : '';
      if ((tail.endsWith('|') && head2.startsWith('|')) || (tail.endsWith('(') && head2.startsWith(')'))) {
        moveChar(before, p, false);
        moveChar(after, p, true);
      }
    }
    return pieces.filter((p) => p.spans.length);
  }

  function operatorOnly(spans) {
    const text = spans.map((s) => (s.tex ? '' : s.plain || s.text || '')).join('').trim();
    if (spans.some((s) => s.tex) || !OPERATOR_ONLY_RE.test(text)) return null;
    return text;
  }

  function outerPunct(tex) {
    const m = String(tex).match(/^([\s\S]*?[^\s.,;:\\])\s*([.,;:]+)$/);
    // "1." or "\ldots." keep their dots; a one-character formula has nothing to move
    if (!m || /\d$/.test(m[1]) || m[1].length < 2) return { tex, tail: '' };
    return { tex: m[1], tail: m[2] };
  }

  const api = { splitOperands, balance, operatorOnly, outerPunct };
  PDFStudy.mathRuns = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

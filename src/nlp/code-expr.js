/**
 * Code Expr: evaluates the small relational expressions a programming textbook prints in C-family notation
 * ("3 == 5 - 2", "4 <= 4", "3 != 5 - 1"), with integer arithmetic as Java, C and C++ do it. Pure and DOM-free.
 *   evaluate(expr) -> true | false | 'error' | null
 *     'error'  a single "=" between two values: an assignment to a value, which does not compile
 *     null     anything else (decimals, names, strings, method calls): not this module's to judge
 *   RELATIONAL  the six relational operators, longest first
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const RELATIONAL = ['>=', '<=', '==', '!=', '>', '<'];
  const COMPARE = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, '>': (a, b) => a > b, '<': (a, b) => a < b };
  const ARITH_RE = /^[\d\s()+\-*/]+$/;

  /** Integer arithmetic with + - * / and brackets; / truncates toward zero. null when it is not that. */
  function arithmetic(src) {
    const s = String(src).replace(/[–−]/g, '-').trim();
    if (!s || !ARITH_RE.test(s) || /\d\s+\d/.test(s)) return null;
    const tokens = s.match(/\d+|[()+\-*/]/g);
    let at = 0;
    const peek = () => tokens[at];
    function factor() {
      const t = tokens[at++];
      if (t === '(') {
        const v = sum();
        if (tokens[at++] !== ')') throw new Error('bracket');
        return v;
      }
      if (t === '-') return -factor();
      if (!/^\d+$/.test(t || '')) throw new Error('operand');
      return Number(t);
    }
    function product() {
      let v = factor();
      while (peek() === '*' || peek() === '/') {
        const op = tokens[at++];
        const r = factor();
        if (op === '/' && r === 0) throw new Error('division by zero');
        v = op === '*' ? v * r : Math.trunc(v / r);
      }
      return v;
    }
    function sum() {
      let v = product();
      while (peek() === '+' || peek() === '-') v = tokens[at++] === '+' ? v + product() : v - product();
      return v;
    }
    try {
      const v = sum();
      return at === tokens.length ? v : null;
    } catch (_e) {
      return null;
    }
  }

  function evaluate(expr) {
    const s = String(expr || '').replace(/[`$]/g, '').replace(/\s+/g, ' ').trim();
    const op = RELATIONAL.find((o) => s.split(o).length === 2);
    if (op) {
      // "a >= b" must not also read as "a > (= b)": the longest operator that splits the expression once wins
      const [l, r] = s.split(op);
      if (/[<>=!]/.test(l) || /[<>=!]/.test(r)) return null;
      const a = arithmetic(l);
      const b = arithmetic(r);
      return a === null || b === null ? null : COMPARE[op](a, b);
    }
    const parts = s.split('=');
    if (parts.length === 2 && !/[<>!]/.test(s) && arithmetic(parts[0]) !== null && arithmetic(parts[1]) !== null) return 'error';
    return null;
  }

  const api = { evaluate, arithmetic, RELATIONAL };
  PDFStudy.codeExpr = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

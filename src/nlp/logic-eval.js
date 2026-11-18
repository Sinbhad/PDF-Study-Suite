/**
 * Logic Eval: reads and evaluates the propositional and Boolean expressions a textbook section prints, so a
 * question built from them is keyed by computation, never by a guess from prose. Pure and DOM-free.
 *   parse(src, { style })     -> AST | null (null when any part of the notation cannot be read)
 *     style 'prop'  propositions: T / F are constants, operands sit between operators (p ∧ q, ¬p, p → q)
 *     style 'bool'  Boolean algebra: 0 / 1 are constants, every letter is a variable, juxtaposition is AND
 *                   (XY), complement is an overline (\overline{X}) or a prime (X′)
 *     Both read ¬ ~ \neg, ∧ & ⋅ · \wedge \cdot, ∨ | + \vee, ⊕ ^ \oplus, → \to, ↔ \leftrightarrow, ( ) and { }.
 *   AST: { op: 'var', name } | { op: 'const', value } | { op: 'not', a } | { op: 'and'|'or'|'xor'|'imp'|'iff', a, b }
 *   variables(ast)            -> sorted variable names
 *   evaluate(ast, env)        -> boolean (env: { name: boolean })
 *   rows(vars)                -> every assignment, the true-first order books print (TT, TF, FT, FF)
 *   column(ast, vars)         -> boolean[] over rows(vars)
 *   equivalent(a, b)          -> do two ASTs agree on every assignment of their variables
 *   substitute(ast, map)      -> the AST with variables renamed or replaced (map: { name: AST | name })
 *   render(ast, style)        -> TeX without dollars, written the way the style prints it
 *   operators(ast)            -> Set of the binary and unary operators the AST uses
 *   normalise(src)            -> the source with dollars dropped and TeX commands as their symbols (¬ ∧ ∨ ⊕ → ↔ ⋅)
 *   sameTree(a, b)            -> the same expression tree (the same grouping), not merely the same truth table
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // TeX commands and Unicode symbols -> one canonical symbol each
  const TEX = [
    [/\\(?:neg|lnot|sim)(?![A-Za-z])/g, '¬'], [/\\(?:wedge|land)(?![A-Za-z])/g, '∧'], [/\\(?:vee|lor)(?![A-Za-z])/g, '∨'],
    [/\\oplus(?![A-Za-z])/g, '⊕'], [/\\(?:leftrightarrow|Leftrightarrow|iff|longleftrightarrow)(?![A-Za-z])/g, '↔'],
    [/\\(?:to|rightarrow|Rightarrow|implies|longrightarrow)(?![A-Za-z])/g, '→'], [/\\(?:cdot|bullet)(?![A-Za-z])/g, '⋅'],
    [/\\(?:left|right|,|;|:|!|quad|qquad)(?![A-Za-z])/g, ' '], [/\\(?:mathrm|mathbf|text|mathit)\s*/g, ''],
  ];
  const SYMBOL = { '¬': 'not', '~': 'not', '∧': 'and', '&': 'and', '⋅': 'and', '·': 'and', '*': 'and', '∨': 'or', '|': 'or', '+': 'or', '⊕': 'xor', '^': 'xor', '→': 'imp', '↔': 'iff', '⇒': 'imp', '⇔': 'iff' };
  const PRIME_RE = /^[′'’]/;
  const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
  // Binding strength, loosest first: ↔, →, ∨ / ⊕, ∧, then ¬ and the postfix complement.
  const LEVEL = { iff: 1, imp: 2, or: 3, xor: 3, and: 4 };

  function normalise(src) {
    let s = String(src == null ? '' : src).replace(/\$/g, ' ');
    for (const [re, to] of TEX) s = s.replace(re, to);
    return s.replace(/\\bar(?![A-Za-z])/g, '\\overline').trim();
  }

  /** Tokens: { t: 'var', name } | { t: 'const', value } | { t: 'op', op } | { t: 'over' } | { t: '(' } | { t: ')' } | { t: 'prime' } */
  function tokenize(s, style) {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (s.startsWith('\\overline', i)) { out.push({ t: 'over' }); i += 9; continue; }
      if (c === '\\') return null; // any other command: notation this reader does not know
      if (c === '(' || c === '{' || c === '[') { out.push({ t: '(' }); i++; continue; }
      if (c === ')' || c === '}' || c === ']') { out.push({ t: ')' }); i++; continue; }
      if (PRIME_RE.test(c)) { out.push({ t: 'prime' }); i++; continue; }
      if (SYMBOL[c]) { out.push({ t: 'op', op: SYMBOL[c] }); i++; continue; }
      if (c === '0' || c === '1') { out.push({ t: 'const', value: c === '1' }); i++; continue; }
      if (/[A-Za-z]/.test(c)) {
        if (style === 'prop' && (c === 'T' || c === 'F') && !/[A-Za-z_]/.test(s[i + 1] || '')) {
          out.push({ t: 'const', value: c === 'T' });
          i++;
          continue;
        }
        // A word ("and", "XOR") is prose, not an operand: in 'prop' style two letters in a row are refused.
        if (style === 'prop' && /[A-Za-z]/.test(s[i + 1] || '')) return null;
        let name = c;
        i++;
        const sub = s.slice(i).match(/^_\{?(\d{1,2})\}?/) || s.slice(i).match(new RegExp(`^([${SUBSCRIPT_DIGITS}]{1,2})`));
        if (sub) {
          name += `_${[...sub[1]].map((d) => (SUBSCRIPT_DIGITS.includes(d) ? SUBSCRIPT_DIGITS.indexOf(d) : d)).join('')}`;
          i += sub[0].length;
        }
        out.push({ t: 'var', name });
        continue;
      }
      return null;
    }
    return out;
  }

  function parse(src, opts = {}) {
    const style = opts.style === 'prop' ? 'prop' : 'bool';
    const tokens = tokenize(normalise(src), style);
    if (!tokens || !tokens.length) return null;
    let at = 0;
    const peek = () => tokens[at];
    const startsOperand = (tok) => Boolean(tok) && (tok.t === 'var' || tok.t === 'const' || tok.t === '(' || tok.t === 'over' || (tok.t === 'op' && tok.op === 'not'));

    function binary(level) {
      if (level > LEVEL.and) return unary();
      let left = binary(level + 1);
      if (!left) return null;
      for (;;) {
        const tok = peek();
        const juxtaposed = level === LEVEL.and && style === 'bool' && startsOperand(tok) && !(tok.t === 'op');
        if (!juxtaposed && !(tok && tok.t === 'op' && tok.op !== 'not' && LEVEL[tok.op] === level)) return left;
        const op = juxtaposed ? 'and' : tok.op;
        if (!juxtaposed) at++;
        // → groups to the right (p → q → r is p → (q → r)); the others to the left
        const right = op === 'imp' ? binary(level) : binary(level + 1);
        if (!right) return null;
        left = { op, a: left, b: right };
        if (op === 'imp') return left;
      }
    }

    function unary() {
      const tok = peek();
      if (!tok) return null;
      let node;
      if (tok.t === 'op' && tok.op === 'not') {
        at++;
        const a = unary();
        return a ? { op: 'not', a } : null;
      }
      if (tok.t === 'over') {
        at++;
        if (!peek() || peek().t !== '(') return null;
        at++;
        const a = binary(LEVEL.iff);
        if (!a || !peek() || peek().t !== ')') return null;
        at++;
        // "\overline{X}_{1}": the subscript belongs to the complemented variable
        node = { op: 'not', a };
      } else if (tok.t === '(') {
        at++;
        node = binary(LEVEL.iff);
        if (!node || !peek() || peek().t !== ')') return null;
        at++;
      } else if (tok.t === 'var') {
        at++;
        node = { op: 'var', name: tok.name };
      } else if (tok.t === 'const') {
        at++;
        node = { op: 'const', value: tok.value };
      } else {
        return null;
      }
      while (peek() && peek().t === 'prime') {
        at++;
        node = { op: 'not', a: node };
      }
      return node;
    }

    const ast = binary(LEVEL.iff);
    return ast && at === tokens.length ? ast : null;
  }

  function variables(ast) {
    const names = new Set();
    const walk = (n) => {
      if (!n) return;
      if (n.op === 'var') names.add(n.name);
      walk(n.a);
      walk(n.b);
    };
    walk(ast);
    return [...names].sort();
  }

  function operators(ast) {
    const ops = new Set();
    const walk = (n) => {
      if (!n || n.op === 'var' || n.op === 'const') return;
      ops.add(n.op);
      walk(n.a);
      walk(n.b);
    };
    walk(ast);
    return ops;
  }

  function evaluate(ast, env) {
    switch (ast.op) {
      case 'var': return Boolean(env[ast.name]);
      case 'const': return ast.value;
      case 'not': return !evaluate(ast.a, env);
      case 'and': return evaluate(ast.a, env) && evaluate(ast.b, env);
      case 'or': return evaluate(ast.a, env) || evaluate(ast.b, env);
      case 'xor': return evaluate(ast.a, env) !== evaluate(ast.b, env);
      case 'imp': return !evaluate(ast.a, env) || evaluate(ast.b, env);
      case 'iff': return evaluate(ast.a, env) === evaluate(ast.b, env);
      default: throw new Error(`unknown operator ${ast.op}`);
    }
  }

  /** Every assignment of `vars`, the first variable changing slowest, true before false (TT, TF, FT, FF). */
  function rows(vars) {
    const out = [];
    const n = vars.length;
    for (let k = 0; k < 2 ** n; k++) {
      const env = {};
      vars.forEach((v, i) => { env[v] = ((k >> (n - 1 - i)) & 1) === 0; });
      out.push(env);
    }
    return out;
  }

  const column = (ast, vars) => rows(vars || variables(ast)).map((env) => evaluate(ast, env));

  function equivalent(a, b) {
    const vars = [...new Set([...variables(a), ...variables(b)])].sort();
    return rows(vars).every((env) => evaluate(a, env) === evaluate(b, env));
  }

  function substitute(ast, map) {
    if (!ast) return ast;
    if (ast.op === 'var') {
      const to = map[ast.name];
      if (to == null) return ast;
      return typeof to === 'string' ? { op: 'var', name: to } : to;
    }
    if (ast.op === 'const') return ast;
    return { op: ast.op, a: substitute(ast.a, map), ...(ast.b ? { b: substitute(ast.b, map) } : {}) };
  }

  const PROP_TEX = { and: '\\wedge', or: '\\vee', xor: '\\oplus', imp: '\\to', iff: '\\leftrightarrow' };
  const BOOL_TEX = { or: '+', xor: '\\oplus', imp: '\\to', iff: '\\leftrightarrow' };
  const varTex = (name) => name.replace(/_(\d+)$/, '_{$1}');
  const isAtom = (n) => n.op === 'var' || n.op === 'const';

  function render(ast, style = 'bool') {
    const prop = style === 'prop';
    const constTex = (v) => (prop ? (v ? '\\mathbf{T}' : '\\mathbf{F}') : v ? '1' : '0');
    const wrap = (child, parentLevel, right, parentOp) => {
      const s = go(child);
      const lvl = LEVEL[child.op];
      if (!lvl) return s;
      // A looser operator inside a tighter one, or the same non-associative operator on the right, needs brackets.
      // Propositions are printed the way logic books print them: every compound operand of another
      // operator in brackets, (p ∨ ¬q) → (p ∧ q), unless it repeats an associative ∧ or ∨.
      const sameAssociative = child.op === parentOp && (child.op === 'and' || child.op === 'or');
      if (prop) return sameAssociative ? s : `(${s})`;
      const needs = lvl < parentLevel || (lvl === parentLevel && (right || child.op === 'imp' || child.op === 'iff'));
      return needs ? `(${s})` : s;
    };
    function go(n) {
      if (n.op === 'var') return varTex(n.name);
      if (n.op === 'const') return constTex(n.value);
      if (n.op === 'not') {
        if (!prop) return `\\overline{${go(n.a)}}`;
        return isAtom(n.a) || n.a.op === 'not' ? `\\neg ${go(n.a)}` : `\\neg(${go(n.a)})`;
      }
      const lvl = LEVEL[n.op];
      const left = wrap(n.a, lvl, false, n.op);
      const right = wrap(n.b, lvl, true, n.op);
      if (prop) return `${left} ${PROP_TEX[n.op]} ${right}`;
      if (n.op === 'and') {
        // XY for letters and complements, X \cdot 1 beside a constant, as books print it
        const plainJoin = n.a.op !== 'const' && n.b.op !== 'const';
        return plainJoin ? `${left}${right}` : `${left} \\cdot ${right}`;
      }
      return `${left} ${BOOL_TEX[n.op]} ${right}`;
    }
    return go(ast);
  }

  /** Same expression tree (not merely the same truth table): p ∨ (q ∧ r) and (p ∨ q) ∧ r differ. */
  const sameTree = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const api = { parse, variables, operators, evaluate, rows, column, equivalent, substitute, render, normalise, sameTree };
  PDFStudy.logicEval = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

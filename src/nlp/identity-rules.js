/**
 * Identity Rules: the laws and identities a textbook section states as displayed equations, each checked by
 * computation before anything is built from it. Pure and DOM-free.
 *   read({ text, lines, startPage }) -> { identities: [item], derived: [item] }
 *     item: { number, name, lhs, rhs (ASTs), lhsTex, rhsTex (the book's own TeX), statement, page, list }
 *     identities  a numbered list of single equations ("1. X + 0 = X", "14. X(Y + Z) = XY + XZ") and the
 *                 displayed results the text names ("... are referred to as DeMorgan's theorem")
 *     derived     a numbered list of derivations ("1. X + XY = X ⋅ 1 + XY = ... = X"): first and last side
 * The displays come from book-formulas.js over book-sections.js paragraphs. An equation is kept only when both
 * sides parse (logic-eval.js) and agree on every assignment: a damaged bar or a lost operator makes the two
 * sides differ, and that equation is dropped rather than taught wrong. A name is given to an identity only when
 * the text names it by number ("Identities 10 and 11, the commutative laws", "the second distributive law,
 * given by identity 15") or prints it as a named result.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  const ITEM_RE = /^\s*(\d{1,2})\s*\.\s*(.+)$/;
  const DAMAGED_RE = /¿|\\cdots|\\ldots|…/;
  const PROP_SYMBOL_RE = /[∧∨→↔¬]|\\(?:wedge|vee|to|leftrightarrow|neg|land|lor)\b/;
  const RESULT_WORD = '(?:laws?|theorems?|rules?|propert(?:y|ies))';
  // How a book refers to an item of its numbered list: "identity 14", "rules 3 and 4", "law 2", "equation 5"
  const ITEM_WORD = '(?:identit(?:y|ies)|rules?|laws?|propert(?:y|ies)|postulates?|equations?)';
  // "Identities 10 and 11, the commutative laws, state ...", "identity 9, the involution law"
  const NUMBERS_THEN_NAME_RE = new RegExp(`\\b${ITEM_WORD}\\s+(\\d{1,2}(?:\\s*(?:,|and)\\s*\\d{1,2})*),\\s+(?:the\\s+)?((?:[A-Za-z’'-]+\\s+){0,2}${RESULT_WORD})\\b`, 'gi');
  // "the first distributive law, identity 14", "The second distributive law, given by identity 15"
  const NAME_THEN_NUMBER_RE = new RegExp(`\\b(?:the\\s+)?((?:first|second|third)\\s+)?([A-Za-z’'-]+\\s+${RESULT_WORD}),\\s+(?:given\\s+by\\s+|is\\s+)?${ITEM_WORD}\\s+(\\d{1,2})\\b`, 'gi');
  const LIST_TITLE_RE = /\b(?:identities|numbered\s+results|code)\b/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const singular = (name) => plain(name).replace(/\blaws\b/i, 'law').replace(/\btheorems\b/i, 'theorem').replace(/\brules\b/i, 'rule').replace(/\bproperties\b/i, 'property');
  const cap = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  /** "$X + 0 = X$" -> sides as TeX (dollars dropped), or null. */
  const sidesOf = (eq) => plain(eq).replace(/^\$+|\$+\.?$/g, '').replace(/\$/g, '').split('=').map((s) => s.trim());

  /** Parse and check one equation: every side must agree with the first. -> { lhs, rhs, lhsTex, rhsTex, chain } | null */
  function checked(eq) {
    if (DAMAGED_RE.test(eq)) return null;
    const sides = sidesOf(eq);
    if (sides.length < 2 || sides.some((s) => !s)) return null;
    const style = PROP_SYMBOL_RE.test(eq) ? 'prop' : 'bool';
    const asts = sides.map((s) => le().parse(s, { style }));
    if (asts.some((a) => !a)) return null;
    if (!asts.every((a) => le().equivalent(asts[0], a))) return null;
    return { lhs: asts[0], rhs: asts[asts.length - 1], lhsTex: sides[0], rhsTex: sides[sides.length - 1], chain: sides.length > 2, style };
  }

  /** Same equation however it is spaced or written (X ⋅ Y vs XY): compared by the expressions it parses to. */
  const sameEquation = (a, b) => le().render(a.lhs) === le().render(b.lhs) && le().render(a.rhs) === le().render(b.rhs);

  /** Number -> name, from the sentences that name identities by number. */
  function namesByNumber(text) {
    const names = new Map();
    const flat = plain(text).replace(/\$/g, '');
    for (const m of flat.matchAll(NUMBERS_THEN_NAME_RE)) {
      const numbers = m[1].match(/\d{1,2}/g);
      for (const n of numbers) if (!names.has(n)) names.set(n, singular(m[2]).toLowerCase());
    }
    for (const m of flat.matchAll(NAME_THEN_NUMBER_RE)) {
      if (!names.has(m[3])) names.set(m[3], `${(m[1] || '').toLowerCase()}${singular(m[2]).toLowerCase()}`.trim());
    }
    return names;
  }

  function read({ text, lines, startPage } = {}) {
    const sections = dep('bookSections', './book-sections.js').split(String(text || ''), { lines, startPage });
    const bf = dep('bookFormulas', './book-formulas.js');
    const formulas = sections.flatMap((s) => bf.pick(s.paragraphs));
    // "Identity 14" names an item only when the section has one numbered list of identities: with two lists the
    // number could point into either.
    const numberedLists = formulas.filter((f) => String(f.body).split('\n').some((l) => ITEM_RE.test(l) && !/=.*=/.test(l)));
    const names = numberedLists.length === 1 ? namesByNumber(text) : new Map();
    const identities = [];
    const derived = [];
    const named = [];
    for (const f of formulas) {
      const items = String(f.body).split('\n').map((l) => l.match(ITEM_RE)).filter(Boolean);
      if (items.length) {
        for (const [, number, eq] of items) {
          const c = checked(eq);
          if (!c) continue;
          const item = { number: Number(number), name: '', ...c, page: f.page || null, list: plain(f.title) };
          if (c.chain) derived.push(item);
          else identities.push({ ...item, name: names.get(number) || '' });
        }
        continue;
      }
      if (LIST_TITLE_RE.test(f.title)) continue;
      // "DeMorgan's theorem: $A$ and $B$": a named result of one or more equations
      for (const eq of String(f.body).split(/\$\s+and\s+\$/).map((e) => `$${e.replace(/^\$|\$$/g, '')}$`)) {
        const c = checked(eq);
        if (c && !c.chain) named.push({ number: null, name: plain(f.title).replace(/^(?:the|a)\s+/i, ''), ...c, page: f.page || null, list: plain(f.title) });
      }
    }
    // A named result that is also a numbered identity names that identity; otherwise it stands as its own.
    for (const n of named) {
      const twin = identities.find((i) => sameEquation(i, n));
      if (twin) {
        if (!twin.name) twin.name = n.name;
      } else if (!identities.some((i) => i.number === null && sameEquation(i, n))) {
        identities.push(n);
      }
    }
    const statement = (i) => `$${i.lhsTex} = ${i.rhsTex}$`;
    return {
      identities: identities.map((i) => ({ ...i, name: i.name ? cap(i.name) : '', statement: statement(i) })),
      derived: derived.map((i) => ({ ...i, statement: statement(i) })),
    };
  }

  const api = { read, namesByNumber, checked };
  PDFStudy.identityRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

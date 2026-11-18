/**
 * Rule Cards: flashcards for the checkable rules a textbook section teaches (section-rules.js), each carrying
 * a `rule` payload (plain data, TeX strings only) that worked-questions.js turns into questions whose key is
 * computed. Pure and DOM-free.
 *   fromRules(rules) -> [card]   card: { front, back, category, kind, sourceKind, subject, page, quote, rule }
 *     operator  one card per operator, asked at the row that sets it apart ("$p$ true, $q$ false: $p \to q$ is?")
 *     form      "What is the contrapositive of $p \to q$?" for each related conditional the section names
 *     precedence  each "X means Y rather than Z" example the section prints, as "how is X grouped?"
 *     bitwise   the section's bit-string operations, with the sentence or table that defines them
 *     relational  the section's table of relational operators, and an expression its table marks as an error
 *     set       the subset, proper-subset and power-set definitions (attached to the definition box's own card
 *               when there is one: flashcard-engine.js)
 *     count     the 2^n rule for the rows of a truth table or the size of a power set
 *     identity  a named law as name -> statement and statement -> name; an unnamed identity as "Simplify ..."
 *     derived   a derivation of the section as "Simplify <first side>" -> last side, with the book's steps
 *   quote: text the scope prints for the card (a section test keeps a card whose quote its text holds).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const le = () => dep('logicEval', './logic-eval.js');

  const OP_WORDS = { and: 'conjunction', or: 'disjunction', xor: 'exclusive or', imp: 'conditional', iff: 'biconditional', not: 'negation' };
  const MAX_UNNAMED_IDENTITIES = 12;

  // "Commutative law" reads "the commutative law" in a sentence; "DeMorgan’s theorem" stays as it is
  const inSentence = (name) => (/^[A-Z][a-z]*(?:\s|$)/.test(name) && !/’s|'s/.test(name.split(/\s+/)[0]) ? `the ${name[0].toLowerCase()}${name.slice(1)}` : name);
  const tidy = (s) => String(s || '').replace(/\$([A-Za-z]{1,5}[,.]?)\$/g, '$1').replace(/\s+/g, ' ').trim();
  const pageNote = (page) => (page ? ` (p. ${page})` : '');
  const truthWord = (v, style) => (style === 'bool' ? (v ? '1' : '0') : v ? 'true' : 'false');

  /** The row of an operator's table that sets it apart: its only true or only false row, else the first mixed one. */
  function telling(ast, vars) {
    const col = le().column(ast, vars);
    const trues = col.filter(Boolean).length;
    const lonely = trues === 1 ? true : trues === col.length - 1 ? false : null;
    const index = lonely === null ? col.findIndex((v, i) => i > 0 && v !== col[0]) : col.indexOf(lonely);
    return { env: le().rows(vars)[index], value: col[index], unique: lonely !== null };
  }

  function operatorCards(operators) {
    const out = [];
    for (const o of operators && operators.ops ? operators.ops.values() : []) {
      const ast = le().parse(o.tex, { style: o.style });
      if (!ast) continue;
      const vars = le().variables(ast);
      const { env, value, unique } = telling(ast, vars);
      const style = o.style;
      const given = vars.map((v) => (style === 'bool' ? `$${v} = ${env[v] ? 1 : 0}$` : `$${v}$ ${truthWord(env[v], style)}`)).join(', ');
      const name = o.name || OP_WORDS[o.op];
      const only = vars.map((v) => `${v} = ${style === 'bool' ? (env[v] ? 1 : 0) : env[v] ? 'T' : 'F'}`).join(', ');
      const why = o.statement ? ` ${tidy(o.statement)}` : unique ? ` $${o.tex}$ is ${truthWord(value, style)} only when ${only}.` : '';
      out.push({
        front: `${given}: what is $${o.tex}$?`,
        back: `${style === 'bool' ? value ? '1' : '0' : value ? 'True' : 'False'}.${why}`,
        category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: name.charAt(0).toUpperCase() + name.slice(1),
        page: o.definitionPage || o.page || null, quote: o.statement || '',
        rule: { kind: 'operator', op: o.op, tex: o.tex, name, style, statement: tidy(o.statement), page: o.definitionPage || o.page || null, tablePage: o.page || null },
      });
    }
    return out;
  }

  function bitwiseCard(b) {
    if (!b) return [];
    const words = b.ops.map((o) => o.word);
    const list = `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
    // A table of operators gives their symbols; a sentence gives what they do
    const fromTable = b.ops.every((o) => o.fromTable);
    return [{
      front: fromTable ? `Which symbols denote bitwise ${list}?` : `What are the bitwise ${list} of two bit strings of the same length?`,
      back: tidy(b.statement),
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Bitwise operations', page: b.page || null, quote: b.statement,
      rule: { kind: 'bitwise', ops: b.ops.map((o) => ({ op: o.op, word: o.word, symbol: o.symbol })), statement: tidy(b.statement), page: b.page || null },
    }];
  }

  /** The section's relational operators in one card, and the expression its table shows to be an error. */
  function relationalCards(r) {
    if (!r) return [];
    const rule = { kind: 'relational', ops: r.ops, page: r.page || null, assignmentError: r.assignmentError || null };
    const out = [{
      front: `What do the relational operators ${r.ops.map((o) => o.op).join(' ')} test?`,
      back: `${r.ops.map((o) => `${o.op}: ${o.meaning.charAt(0).toLowerCase()}${o.meaning.slice(1)}`).join('; ')}${pageNote(r.page)}`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Relational operators', page: r.page || null, quote: '', rule,
    }];
    const e = r.assignmentError;
    if (e) {
      out.push({
        front: `What happens when you write \`${e.expr}\`?`,
        back: `It is an error${e.note ? `: ${tidy(e.note)}` : ''}${pageNote(e.page)}`,
        category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Relational operators', page: e.page || null, quote: '', rule,
      });
    }
    return out;
  }

  /** "What is the contrapositive of p → q?" for each form the section names; every card carries all forms. */
  function formCards(forms) {
    const all = (forms || []).map((f) => ({ name: f.name, formTex: f.formTex }));
    return (forms || []).map((f) => ({
      front: `What is the ${f.name} of $${f.baseTex}$?`,
      back: `$${f.formTex}$${pageNote(f.page)}`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: f.name.charAt(0).toUpperCase() + f.name.slice(1), page: f.page || null, quote: '',
      rule: { kind: 'form', name: f.name, baseTex: f.baseTex, formTex: f.formTex, all, page: f.page || null },
    }));
  }

  /** One card per grouping example the section prints ("p ∨ q ∧ r means p ∨ (q ∧ r)"). */
  function precedenceCards(p) {
    if (!p) return [];
    const rule = { kind: 'precedence', ops: p.ops, pairs: p.pairs, examples: p.examples.map((e) => ({ text: e.text, grouped: e.grouped, ops: e.ops, page: e.page })), page: p.examples[0].page || null };
    return p.examples.map((e) => ({
      front: `By the precedence rules, how is $${e.text}$ grouped?`,
      back: `$${e.grouped}$, not $${e.rather}$${pageNote(e.page)}`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Operator precedence', page: e.page || null, quote: '', rule,
    }));
  }

  /**
   * The set relations the section defines. A definition box usually already makes a card for the same sentence:
   * the flashcard engine then puts the rule on that card (as `teaches`) instead of adding this one.
   */
  function setCards(sets) {
    const FRONTS = { subset: 'When is a set A a subset of a set B?', proper: 'What is a proper subset?', powerset: 'What is the power set of a set S?' };
    return Object.entries(sets || {}).filter(([, v]) => v).map(([which, v]) => ({
      front: FRONTS[which], back: tidy(v.statement), category: 'Definition', kind: 'concept', sourceKind: 'key-concept',
      subject: which === 'powerset' ? 'Power set' : which === 'proper' ? 'Proper subset' : 'Subset', page: v.page || null, quote: v.statement,
      rule: { kind: 'set', which, statement: tidy(v.statement), page: v.page || null },
    }));
  }

  function countCards(counts) {
    return (counts || []).map((c) => ({
      front: c.what === 'rows' ? 'How many rows does a truth table with $n$ variables have?' : 'How many elements does the power set of a set with $n$ elements have?',
      back: `$2^{n}$. ${tidy(c.statement)}`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: c.what === 'rows' ? 'Truth table' : 'Power set', page: c.page || null, quote: c.statement,
      rule: { kind: 'count', what: c.what, statement: tidy(c.statement), page: c.page || null },
    }));
  }

  /** Is this equation only its own variables reordered (X + Y = Y + X)? Nothing is worked out by applying it. */
  function reordering(i) {
    const sig = (tex) => tex.replace(/[\s()]/g, '').split('').sort().join('');
    return sig(i.lhsTex.replace(/\\cdot|⋅/g, '')) === sig(i.rhsTex.replace(/\\cdot|⋅/g, ''));
  }

  function identityCards(identities, derived) {
    const out = [];
    const payload = (i, kind) => ({ kind, number: i.number, name: i.name, lhsTex: i.lhsTex, rhsTex: i.rhsTex, style: i.style, page: i.page || null, list: i.list });
    const ref = (i) => (i.number ? `identity ${i.number}` : i.name);
    // Named laws: one card per name, all its equations on the back, and one card back from each equation.
    const byName = new Map();
    for (const i of identities || []) if (i.name) byName.set(i.name, [...(byName.get(i.name) || []), i]);
    for (const [name, list] of byName) {
      const numbers = list.map((i) => i.number).filter(Boolean);
      const label = numbers.length ? ` (identit${numbers.length > 1 ? 'ies' : 'y'} ${numbers.join(' and ')})` : '';
      out.push({
        front: `State ${inSentence(name)}.`,
        back: `${list.map((i) => i.statement).join(' and ')}${label}${pageNote(list[0].page)}`,
        category: 'Law', kind: 'concept', sourceKind: 'key-concept', subject: name, page: list[0].page || null, quote: '',
        rule: payload(list[0], 'identity'),
      });
      for (const i of list) {
        out.push({
          front: `Which law is ${i.statement}?`,
          back: `${name}${i.number ? ` (identity ${i.number})` : ''}${pageNote(i.page)}`,
          category: 'Law', kind: 'concept', sourceKind: 'key-concept', subject: name, page: i.page || null, quote: '',
          rule: payload(i, 'identity'),
        });
      }
    }
    // Unnamed identities: what the left side simplifies to (reorderings say nothing to simplify)
    for (const i of (identities || []).filter((x) => !x.name && !reordering(x)).slice(0, MAX_UNNAMED_IDENTITIES)) {
      out.push({
        front: `Simplify $${i.lhsTex}$.`,
        back: `$${i.rhsTex}$ (${ref(i)}${i.list ? `, ${i.list.toLowerCase()}` : ''})${pageNote(i.page)}`,
        category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: `Identity ${i.number}`, page: i.page || null, quote: '',
        rule: payload(i, 'identity'),
      });
    }
    for (const d of derived || []) {
      out.push({
        front: `Simplify $${d.lhsTex}$.`,
        back: `$${d.rhsTex}$${pageNote(d.page)}`,
        category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: `Simplification ${d.number}`, page: d.page || null, quote: '',
        rule: payload(d, 'derived'),
      });
    }
    return out;
  }

  function fromRules(rules) {
    if (!rules) return [];
    return [
      ...operatorCards(rules.operators),
      ...formCards(rules.forms),
      ...precedenceCards(rules.precedence),
      ...bitwiseCard(rules.bitwise),
      ...relationalCards(rules.relational),
      ...setCards(rules.sets),
      ...countCards(rules.counts),
      ...identityCards(rules.identities, rules.derived),
    ];
  }

  const api = { fromRules, telling, reordering, inSentence };
  PDFStudy.ruleCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

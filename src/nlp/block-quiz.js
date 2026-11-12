/**
 * Textbook Section Quiz from didactic blocks (theorems, definitions, guidelines) of the selected scope:
 *   - formula completion   "$\lim_{x \to c}[f(x)g(x)]$ = ________"  options = sibling right-hand sides
 *   - which result         "Which result states that $$...$$?"      options = sibling theorem titles
 *   - which statement      theorem / definition body -> its title
 *   - which property       numbered item formula -> its label ("Quotient", "Power", ...)
 *   - true / false         an item formula kept (True) or given a sibling's right-hand side (False)
 *   - guideline steps      'reveal' (show answer + self-grade)
 * Formulas are only ever cut at a top-level "=" and options are formulas vs formulas, titles vs titles.
 * build(blocks, { seedOffset, maxQuestions }) -> [{ type, badge, question, options, answer, explanation, skill, page }]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);

  const fkey = (s) => String(s || '').replace(/\\[,;!: ]|\s+|[.$]+$|^\$+/g, '');
  const uniq = (arr, k = fkey) => arr.filter((v, i) => arr.findIndex((w) => k(w) === k(v)) === i);
  const tex = (s) => `$${String(s).trim()}$`;

  /** Split "lhs = rhs" at the first "=" outside braces; null when there is none or a side is empty. */
  function splitEq(formula) {
    const f = String(formula || '').trim().replace(/^\${1,2}|\${1,2}$/g, '').replace(/[.;]\s*$/, '').trim();
    let depth = 0;
    for (let i = 0; i < f.length; i++) {
      const ch = f[i];
      if (ch === '{' || ch === '(' || ch === '[') depth++;
      else if (ch === '}' || ch === ')' || ch === ']') depth--;
      else if (ch === '=' && depth === 0) {
        const lhs = f.slice(0, i).trim();
        const tail = splitEq(f.slice(i + 1)); // "a = b = c" asks for the final form c
        const rhs = tail ? tail.rhs : f.slice(i + 1).trim();
        return lhs.length >= 3 && rhs && rhs.length <= 70 && !/\\text\{|\\q?quad/.test(rhs) ? { lhs, rhs, formula: f } : null;
      }
    }
    return null;
  }

  /** Block -> { title, name, noun, body, page, items[{ label, lhs, rhs, formula }], steps[], single }. */
  function parseBlock(blk) {
    const title = String(blk.title || '').replace(/\*\*/g, '').trim();
    const sc = dep('stemCards', './stem-cards.js');
    const body = sc ? sc.didacticBack(blk) : String(blk.body || '');
    const noun = /^Theorem|^Corollary|^Lemma/i.test(blk.category || '') ? 'theorem' : /^Definition/i.test(blk.category || '') ? 'definition'
      : /^Guideline|^Algorithm|^Summary/i.test(blk.category || '') ? 'procedure' : 'result';
    const name = title.replace(/^.*?\s[—–]\s/, '').replace(/^(?:The|A|An)\s+/i, '');
    const items = [];
    const add = (label, formula) => {
      const eq = splitEq(formula);
      if (eq && !items.some((it) => fkey(it.formula) === fkey(eq.formula))) items.push({ label, ...eq });
    };
    // "1. Scalar multiple: $...$  2. Sum or difference: $...$"
    for (const m of body.matchAll(/(?:^|\s)\d+\.\s*([A-Z][A-Za-z ,'-]{2,40}?):\s*\$([^$]+)\$/g)) add(m[1].trim(), m[2]);
    const displays = [...body.matchAll(/\$\$([\s\S]+?)\$\$/g)].map((m) => m[1]);
    const source = displays.length ? displays : (blk.formulas || []).map(String);
    let numbered = 0;
    for (const d of source) {
      for (const part of d.split(/\\q?quad\s*/)) {
        const n = part.trim().match(/^(\d+|[a-h])[.)]\s*(.+)$/);
        if (n) numbered++;
        add('', n ? n[2] : part);
      }
    }
    const steps = noun === 'procedure' ? body.split(/(?:^|\s)(?=\d+\.\s+[A-Z])/).map((s) => s.trim()).filter((s) => /^\d+\.\s/.test(s)) : [];
    const single = source.length === 1 && !numbered && splitEq(source[0]) ? source[0].trim().replace(/[.;]\s*$/, '') : '';
    return { title, name, noun, body, category: blk.category || 'Concept', page: blk.pageNumber || null, items, steps, single };
  }

  function mcq(badge, question, answer, distractors, extra, seed, k) {
    const ds = uniq(distractors, k).filter((d) => d && (k || fkey)(d) !== (k || fkey)(answer)).slice(0, 3);
    if (ds.length < 2) return null;
    return { type: 'multiple_choice', badge, question, options: shuffle([answer, ...ds], question, seed), answer, ...extra };
  }

  function build(blocks, options = {}) {
    const { seedOffset: seed = 0, maxQuestions = 10 } = options;
    const parsed = (blocks || []).filter((b) => b && b.title).map(parseBlock);
    if (!parsed.length) return [];
    const lower = (s) => String(s).toLowerCase().trim();
    const fams = { formula: [], which: [], statement: [], tf: [], label: [], steps: [] };
    const allItems = parsed.flatMap((b) => b.items.map((it) => ({ ...it, block: b })));
    const titled = parsed.filter((b) => b.noun !== 'procedure');

    parsed.forEach((b, bi) => {
      const meta = (skill) => ({ skill, page: b.page, pageNumber: b.page, block: b.title });
      const where = b.page ? `${b.title} (p. ${b.page})` : b.title;
      // Sibling titles: same kind first (theorem vs theorem), nearest in the section first.
      const sibTitles = shuffle(titled.filter((o) => o !== b), b.title, seed)
        .sort((x, y) => (x.noun !== b.noun) - (y.noun !== b.noun) || Math.abs(parsed.indexOf(x) - bi) - Math.abs(parsed.indexOf(y) - bi)).map((o) => o.title);

      b.items.forEach((it, ii) => {
        const own = b.items.filter((o) => o !== it).map((o) => o.rhs);
        const others = shuffle(allItems.filter((o) => o.block !== b), it.formula, seed).map((o) => o.rhs);
        const rhsPool = [...shuffle(own, it.formula, seed), ...others].filter((r) => !fkey(it.lhs).includes(fkey(r)) || fkey(r).length <= 2);
        const tag = it.label ? `${b.name} — ${it.label}` : b.name;
        const fq = mcq('Formula', `Complete the formula (${tag}):\n${tex(it.lhs)} = ________`, tex(it.rhs), rhsPool.map(tex),
          { ...meta('formula'), explanation: `${where}: ${tex(it.formula)}` }, seed);
        if (fq) fams.formula.push(fq);
        if (own.length && fkey(own[0]) !== fkey(it.rhs)) {
          const isTrue = (bi + ii + seed) % 2 === 0;
          const wrong = shuffle(own, `${it.formula}tf`, seed)[0];
          fams.tf.push({
            type: 'true_false', badge: 'True / False', options: ['True', 'False'], answer: isTrue ? 'True' : 'False', ...meta('formula'),
            question: `True or False (${tag}):\n${tex(`${it.lhs} = ${isTrue ? it.rhs : wrong}`)}`,
            explanation: `${isTrue ? 'True' : 'False'} — ${where}: ${tex(it.formula)}`,
          });
        }
        const labels = b.items.filter((o) => o.label && o !== it).map((o) => o.label);
        if (it.label && labels.length >= 2) {
          const lq = mcq(`Which Property • ${b.name}`, `In "${b.name}", which property is this?\n${tex(it.formula)}`, it.label,
            shuffle(labels, it.formula, seed), { ...meta('theorem'), explanation: `${where} — ${it.label}: ${tex(it.formula)}` }, seed, lower);
          if (lq) fams.label.push(lq);
        }
      });

      if (b.noun !== 'procedure' && b.single) {
        const wq = mcq('Which Result', `Which ${b.noun === 'result' ? 'result' : b.noun} gives this formula?\n$$${b.single}$$`, b.title, sibTitles,
          { ...meta('theorem'), explanation: `${where}: ${b.body}` }, seed, lower);
        if (wq) fams.which.push(wq);
      }
      const plainName = lower(b.name).replace(/[^a-z0-9 ]/g, '');
      if (b.noun !== 'procedure' && b.body.length >= 30 && b.body.length <= 520 && !lower(b.body).includes(plainName)) {
        const sq = mcq(`Multiple Choice • ${b.category}`, `Which ${b.noun === 'result' ? 'named result' : b.noun} states the following?\n"${b.body}"`,
          b.title, sibTitles, { ...meta(b.noun === 'definition' ? 'definition' : 'theorem'), explanation: `${where}: ${b.body}` }, seed, lower);
        if (sq) fams.statement.push(sq);
      }
      if (b.steps.length >= 2) {
        fams.steps.push({
          type: 'reveal', badge: 'Recall the Steps', question: `List the steps of "${b.name}".`, options: [], answer: b.steps.join('\n'),
          ...meta('definition'), explanation: where,
        });
      }
    });

    // Round-robin over families; a block contributes one question per pass so nine theorems are all touched.
    const order = ['formula', 'statement', 'which', 'tf', 'label', 'formula', 'steps'];
    for (const k of Object.keys(fams)) if (seed > 0) fams[k] = shuffle(fams[k], k, seed);
    const out = [];
    const perBlock = new Map();
    for (let cap = 1; cap <= (parsed.length < 4 ? 1 : 12) && out.length < maxQuestions; cap++) { // few blocks: titles give the options away
      for (let i = 0, idle = 0; out.length < maxQuestions && idle < order.length; i++) {
        const list = fams[order[i % order.length]];
        const at = list.findIndex((q) => (perBlock.get(q.block) || 0) < cap);
        if (at === -1) { idle++; continue; }
        const [q] = list.splice(at, 1);
        perBlock.set(q.block, (perBlock.get(q.block) || 0) + 1);
        idle = 0;
        out.push(q);
      }
    }
    return out.map(({ block, ...q }) => q);
  }

  const api = { build, parseBlock, splitEq };
  PDFStudy.blockQuiz = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

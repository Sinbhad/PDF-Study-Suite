/**
 * Worked Arrays: the section's own array algorithms (array-rules.js) run on a short literal array, the key computed
 * by running the algorithm here and every wrong option computed from a named slip (an element left out, the order
 * not kept, the wrong slot, a swap without its temporary variable). Pure and DOM-free.
 *   build(cards, { seed, variant, question }) -> [question]   (question: worked-questions.js's finisher)
 *   run(algorithm, values, arg) -> the algorithm's result, for fixtures and explanations
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  /** The shared hash, mixed once more: strings that differ only in their last character must not give neighbours. */
  const hash = (s) => {
    let x = dep('workedQuestions', './worked-questions.js').hash(s);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };

  const LENGTH = 5;
  const MIN_VALUE = 2;
  const SPAN = 18; // values 2..19: small enough to add in one's head
  const TRIES = 60;

  /** Five distinct small integers drawn from the salt, kept when `fits` accepts them. */
  function array(salt, fits) {
    for (let k = 0; k < TRIES; k++) {
      const h = hash(`${salt}|${k}`);
      const values = [];
      for (let i = 0; values.length < LENGTH && i < 40; i++) {
        const v = MIN_VALUE + (hash(`${h}|${i}`) % SPAN);
        if (!values.includes(v)) values.push(v);
      }
      if (values.length === LENGTH && (!fits || fits(values))) return values;
    }
    return null;
  }

  const list = (values) => values.join(', ');
  const literal = (values) => `{ ${list(values)} }`;

  /** The algorithms as the section's listings write them. */
  function run(algorithm, values, arg = {}) {
    const v = [...values];
    switch (algorithm) {
      case 'sum': return v.reduce((a, b) => a + b, 0);
      case 'max': {
        let largest = v[0];
        for (let i = 1; i < v.length; i++) if (v[i] > largest) largest = v[i];
        return largest;
      }
      case 'search': {
        let pos = 0;
        let found = false;
        while (pos < v.length && !found) {
          if (v[pos] === arg.target) found = true;
          else pos++;
        }
        return pos;
      }
      case 'remove-order': {
        for (let i = arg.pos + 1; i < v.length; i++) v[i - 1] = v[i];
        return v.slice(0, v.length - 1);
      }
      case 'remove-last': {
        v[arg.pos] = v[v.length - 1];
        return v.slice(0, v.length - 1);
      }
      case 'insert-order': {
        v.push(0);
        for (let i = v.length - 1; i > arg.pos; i--) v[i] = v[i - 1];
        v[arg.pos] = arg.value;
        return v;
      }
      case 'swap': {
        const temp = v[arg.i];
        v[arg.i] = v[arg.j];
        v[arg.j] = temp;
        return v;
      }
      default: return null;
    }
  }

  const where = (rule) => `section ${rule.number} (p. ${rule.page})`;

  /** One question per algorithm (two for the search: a value it finds, and one it does not). */
  function questionsFor(card, seed, variant, question) {
    const rule = card.rule;
    const salt = `${rule.algorithm}|${seed}|${variant}`;
    const ask = (key, stem, answer, wrong, explanation) => question({ kind: `array-${rule.algorithm}`, key, label: 'Trace', card, seed, stem, answer: String(answer), wrong: wrong.map(String), explanation });
    switch (rule.algorithm) {
      case 'sum': {
        const v = array(salt);
        if (!v) return [];
        const total = run('sum', v);
        // Slips: the first or the last element left out, or one in the middle skipped.
        return [ask(list(v), `The sum loop of ${where(rule)} runs on the array ${literal(v)}. What is the total afterwards?`,
          total, [total - v[v.length - 1], total - v[0], total - v[2]],
          `The loop adds every element to a total that starts at 0: ${v.join(' + ')} = ${total}. Rule: ${where(rule)}.`)];
      }
      case 'max': {
        // The largest element is neither the first nor the last, so starting or stopping wrong shows.
        const v = array(salt, (x) => {
          const m = Math.max(...x);
          const low = Math.min(...x);
          return x[0] !== m && x[x.length - 1] !== m && x[0] !== low && x[x.length - 1] !== low;
        });
        if (!v) return [];
        const largest = run('max', v);
        return [ask(list(v), `The loop of ${where(rule)} that finds the largest element runs on ${literal(v)}. What is \`largest\` afterwards?`,
          largest, [v[0], v[v.length - 1], Math.min(...v)],
          `largest starts as values[0] = ${v[0]}; each later element that is larger replaces it, ending at ${largest}. Rule: ${where(rule)}.`)];
      }
      case 'search': {
        const v = array(salt);
        if (!v) return [];
        const at = 1 + (hash(`${salt}|at`) % (v.length - 2)); // 1..3: neither end
        const target = v[at];
        const absent = Array.from({ length: SPAN + 4 }, (_, k) => MIN_VALUE + k).find((x) => !v.includes(x) && x > v[0]);
        const found = run('search', v, { target });
        const missing = run('search', v, { target: absent });
        const out = [ask(`${list(v)}|${target}`, `The linear search of ${where(rule)} looks for \`searchedValue = ${target}\` in ${literal(v)}. What is \`pos\` when the loop ends?`,
          found, [found + 1, found - 1, v.length],
          `pos counts up from 0 and stops at the first match: values[${found}] = ${target}, so pos is ${found} (indexes start at 0). Rule: ${where(rule)}.`)];
        if (absent !== undefined) {
          out.push(ask(`${list(v)}|${absent}`, `The linear search of ${where(rule)} looks for \`searchedValue = ${absent}\` in ${literal(v)}. What is \`pos\` when the loop ends?`,
            missing, [-1, v.length - 1, 0],
            `No element equals ${absent}, so pos counts past the last index and the loop stops at pos = values.length = ${missing}. Rule: ${where(rule)}.`));
        }
        return out;
      }
      case 'remove-order':
      case 'remove-last': {
        const v = array(salt);
        if (!v) return [];
        const pos = 1 + (hash(`${salt}|pos`) % 2); // 1 or 2: the slot is neither end
        const other = rule.algorithm === 'remove-order' ? 'remove-last' : 'remove-order';
        const right = run(rule.algorithm, v, { pos });
        const how = rule.algorithm === 'remove-order' ? 'keeping the order of the others' : 'without keeping the order';
        const wrong = [run(other, v, { pos }), run(rule.algorithm, v, { pos: pos + 1 }), run(rule.algorithm, v, { pos: pos - 1 })];
        const step = rule.algorithm === 'remove-order'
          ? `each element after position ${pos} moves down one slot`
          : `the last element (${v[v.length - 1]}) is copied into position ${pos}`;
        return [ask(`${list(v)}|${pos}`, `Removal ${how}, as in ${where(rule)}: \`values[${pos}]\` is taken out of ${literal(v)}, currentSize = ${v.length}. Which elements remain, in slot order?`,
          list(right), wrong.map(list),
          `Removing values[${pos}] = ${v[pos]}: ${step}, and currentSize becomes ${v.length - 1}, leaving ${list(right)}. Rule: ${where(rule)}.`)];
      }
      case 'insert-order': {
        const v = array(salt);
        if (!v) return [];
        const base = v.slice(0, v.length - 1);
        const value = v[v.length - 1];
        const pos = 1 + (hash(`${salt}|pos`) % 2);
        const right = run('insert-order', base, { pos, value });
        const overwrite = [...base];
        overwrite[pos] = value;
        const wrong = [run('insert-order', base, { pos: pos + 1, value }), run('insert-order', base, { pos: pos - 1, value }), overwrite];
        return [ask(`${list(base)}|${pos}|${value}`, `Insertion as in ${where(rule)}: ${value} goes in at index ${pos} of ${literal(base)} (currentSize = ${base.length}, room for ${base.length + 1}), shifting later elements up. What does the array hold now?`,
          list(right), wrong.map(list),
          `currentSize becomes ${base.length + 1}; the elements from the end down to position ${pos + 1} move up one slot, and values[${pos}] = ${value}: ${list(right)}. Rule: ${where(rule)}.`)];
      }
      case 'swap': {
        const v = array(salt);
        if (!v) return [];
        const i = 1;
        const j = 3;
        const right = run('swap', v, { i, j });
        // Slips: no temporary variable (both slots end with one value), or nothing moved.
        const lostI = [...v];
        lostI[i] = v[j];
        const lostJ = [...v];
        lostJ[j] = v[i];
        return [ask(`${list(v)}|${i}|${j}`, `The swap of ${where(rule)} exchanges \`values[${i}]\` and \`values[${j}]\` of ${literal(v)} using \`temp\`. What does the array hold afterwards?`,
          list(right), [lostI, lostJ, v].map(list),
          `temp = values[${i}] = ${v[i]}; values[${i}] = values[${j}] = ${v[j]}; values[${j}] = temp = ${v[i]}: ${list(right)}. Rule: ${where(rule)}.`)];
      }
      default: return [];
    }
  }

  function build(cards, opts = {}) {
    const { seed = 0, variant = 0, question } = opts;
    const out = [];
    for (const card of (cards || []).filter((c) => c && c.rule && c.rule.kind === 'array')) out.push(...questionsFor(card, seed, variant, question));
    return out.filter(Boolean);
  }

  const api = { build, run };
  PDFStudy.workedArrays = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

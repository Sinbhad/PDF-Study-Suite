/**
 * Array Rules: the standard array algorithms a programming section presents as code (sum, maximum, linear search,
 * removing and inserting an element, swapping two elements), recognised from the section's own listings, never
 * from its headings alone. Each becomes a rule card whose `rule` lets worked-arrays.js run the algorithm on a short
 * literal array and compute the key. Pure and DOM-free.
 *   read({ text, lines, startPage }) -> [{ algorithm, name, number, page, code }]
 *   cards(rules) -> [card]   card.rule: { kind: 'array', algorithm, name, number, page, code }
 * algorithm  'sum'           total = total + element over the array, from a total of 0
 *            'max'           largest = values[0]; for i from 1: if values[i] > largest, largest = values[i]
 *            'search'        while pos < length && !found: if values[pos] == target found, else pos++
 *            'remove-order'  for i from pos + 1: values[i - 1] = values[i]; then currentSize--
 *            'remove-last'   values[pos] = values[currentSize - 1]; currentSize--   (order not kept)
 *            'insert-order'  for i from currentSize - 1 down to pos + 1: values[i] = values[i - 1]; values[pos] = x
 *            'swap'          temp = values[i]; values[i] = values[j]; values[j] = temp
 * A listing is only read when its code says exactly that: a variant written another way is left alone.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const NUMBERED_RE = /^(\d+(?:\.\d+)+)\s+(.{3,60})$/;
  // The signatures, on a listing with its whitespace folded to single spaces.
  const SIGNATURES = [
    ['sum', /\b(?:double|int)\s+(\w+)\s*=\s*0\s*;.*\b(?:for|while)\s*\(.*\b\1\s*=\s*\1\s*\+\s*\w+(?:\[\w+\])?\s*;/],
    ['max', /\b(\w+)\s*=\s*(\w+)\[0\]\s*;\s*for\s*\(\s*int\s+(\w+)\s*=\s*1\s*;\s*\3\s*<\s*[\w.]+\s*;\s*\3\+\+\s*\)\s*\{?\s*if\s*\(\s*\2\[\3\]\s*>\s*\1\s*\)\s*\{?\s*\1\s*=\s*\2\[\3\]\s*;/],
    ['search', /\bwhile\s*\(\s*(\w+)\s*<\s*(\w+)\.length\s*&&\s*!\s*(\w+)\s*\)\s*\{?\s*if\s*\(\s*\2\[\1\]\s*==\s*(\w+)\s*\)\s*\{?\s*\3\s*=\s*true\s*;\s*\}?\s*else\s*\{?\s*\1\+\+\s*;/],
    ['remove-order', /\bfor\s*\(\s*int\s+(\w+)\s*=\s*(\w+)\s*\+\s*1\s*;\s*\1\s*<\s*(\w+)\s*;\s*\1\+\+\s*\)\s*\{?\s*(\w+)\[\1\s*-\s*1\]\s*=\s*\4\[\1\]\s*;\s*\}?\s*\3--/],
    ['remove-last', /\b(\w+)\[(\w+)\]\s*=\s*\1\[(\w+)\s*-\s*1\]\s*;\s*\3--/],
    ['insert-order', /\bfor\s*\(\s*int\s+(\w+)\s*=\s*(\w+)\s*-\s*1\s*;\s*\1\s*>\s*(\w+)\s*;\s*\1--\s*\)\s*\{?\s*(\w+)\[\1\]\s*=\s*\4\[\1\s*-\s*1\]\s*;\s*\}?\s*\4\[\3\]\s*=\s*\w+\s*;/],
  ];
  // A swap is printed one statement at a time beside a figure: the section's listings hold the first and last steps.
  const SWAP_FIRST_RE = /\b(?:double|int)\s+(\w+)\s*=\s*(\w+)\[(\w+)\]\s*;/;
  const FRONTS = {
    sum: 'How do you compute the sum of all elements in an array?',
    max: 'How do you find the largest element of an array?',
    search: 'How does a linear search locate a target value in an array?',
    'remove-order': 'How do you remove the element at pos from a partially filled array and keep the order?',
    'remove-last': 'How do you remove the element at pos from a partially filled array when the order does not matter?',
    'insert-order': 'How do you insert an element at pos in a partially filled array and keep the order?',
    swap: 'How do you swap two elements of an array?',
  };
  const BACKS = {
    sum: 'Initialize a running total to 0, then visit each element and add it to the total.',
    max: 'Start with the first element as the largest, then visit the remaining elements from index 1 and keep any element that is larger.',
    search: 'Inspect elements in sequence starting at index 0, stopping at the first match or when the end of the array is reached.',
    'remove-order': 'Move every element after pos down by one (values[i - 1] = values[i]), then decrease currentSize.',
    'remove-last': 'Overwrite it with the last element (values[pos] = values[currentSize - 1]), then decrease currentSize.',
    'insert-order': 'Increase currentSize, move the elements from the end down to pos + 1 up by one (values[i] = values[i - 1]), then store the new element at pos.',
    swap: 'Save one in a temporary variable: temp = values[i]; values[i] = values[j]; values[j] = temp.',
  };

  const fold = (rows) => rows.map((r) => String(r).replace(/\/\/.*$/, '').replace(/[❶-❿➀-➉]/g, '')).join(' ').replace(/\s+/g, ' ').trim();

  function read({ text, lines, startPage } = {}) {
    const sections = dep('bookSections', './book-sections.js').split(String(text || ''), { lines, startPage });
    // One rule per algorithm: the listing under the most specific heading ("7.3.2 Sum and Average Value" over the
    // same loop shown in passing under "7.2 The Enhanced for Loop").
    const found = new Map();
    const offer = (rule) => {
      const depth = (n) => n.split('.').length;
      const had = found.get(rule.algorithm);
      if (!had || depth(rule.number) > depth(had.number)) found.set(rule.algorithm, rule);
    };
    for (const s of sections) {
      const m = String(s.title || '').replace(/\*\*|__/g, '').trim().match(NUMBERED_RE);
      const code = s.paragraphs.filter((p) => p.kind === 'code');
      if (!m || !code.length) continue;
      for (const p of code) {
        const flat = fold((p.lines || []).filter((l) => !/^```/.test(l.trim())));
        const hit = SIGNATURES.find(([, re]) => re.test(flat));
        if (hit) offer({ algorithm: hit[0], name: m[2].trim(), number: m[1], page: p.page || s.page || null, code: flat });
      }
      // "double temp = values[i];" in one listing and "values[j] = temp;" in another: the section's swap.
      const all = fold(code.flatMap((p) => p.lines || []));
      const first = all.match(SWAP_FIRST_RE);
      if (first && /temp/i.test(first[1]) && new RegExp(`\\b${first[2]}\\[\\w+\\]\\s*=\\s*${first[1]}\\s*;`).test(all)) {
        offer({ algorithm: 'swap', name: m[2].trim(), number: m[1], page: code[0].page || s.page || null, code: first[0] });
      }
    }
    return [...found.values()];
  }

  function cards(rules) {
    return (rules || []).map((r) => ({
      front: FRONTS[r.algorithm],
      back: `${BACKS[r.algorithm]} (section ${r.number}, p. ${r.page})`,
      // The listing it quotes is what a section of the scope prints (test-engine.js keeps a section's own cards).
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: r.name, page: r.page, quote: r.code,
      rule: { kind: 'array', algorithm: r.algorithm, name: r.name, number: r.number, page: r.page },
    }));
  }

  const api = { read, cards, SIGNATURES };
  PDFStudy.arrayRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

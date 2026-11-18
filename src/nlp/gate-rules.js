/**
 * Gate Rules: the two-input logic gates a section defines in its own sentences, so a question can work out what each
 * outputs for given input bits:
 *   AND, OR   "The next equations define the logical AND operation", "The truth tables for the operations AND, OR ..."
 *   NAND, NOR "The NAND gate represents the complement of the AND operation" (only when AND itself is defined)
 *   XOR       "The XOR gate ... is similar to the OR gate, but excludes ... both X and Y equal to 1"
 *   XNOR      "The exclusive-NOR is the complement of the exclusive-OR" (only when XOR itself is defined)
 * At least MIN_GATES gates or nothing: one question offers four of them. Pure and DOM-free.
 *   read({ text, blocks, lines, startPage }) -> { gates: [{ gate, page, statement }] } | null
 *   cards(rule) -> [card]   card.rule: { kind: 'gates', gates }
 *   output(gate, x, y) -> 0 | 1
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  const MIN_GATES = 4;
  const OUTPUT = {
    AND: (x, y) => x & y, OR: (x, y) => x | y, NAND: (x, y) => 1 - (x & y), NOR: (x, y) => 1 - (x | y),
    XOR: (x, y) => x ^ y, XNOR: (x, y) => 1 - (x ^ y),
  };
  const BASE_RE = /\bdefine[sd]?\s+the\s+logical\s+(AND|OR)\s+operation\b/gi;
  const TABLES_RE = /\btruth\s+tables?\s+for\s+the\s+(?:three\s+)?(?:basic\s+)?(?:logical\s+)?operations?\s+(AND|OR)\s*,\s*(AND|OR)\b/i;
  const COMPLEMENT_RE = /\b(NAND|NOR|XNOR|exclusive-NOR)\b(?:\s+gate)?\s+(?:represents|is)\s+the\s+complement\s+of\s+the\s+(AND|OR|XOR|exclusive-OR)\b/gi;
  const XOR_RE = /\b(?:XOR|exclusive-OR)\b(?:\s+gate)?[^.]{0,80}\bsimilar\s+to\s+the\s+OR\b[^.]{0,80}\bboth\b/i;
  const canon = (w) => ({ 'EXCLUSIVE-OR': 'XOR', 'EXCLUSIVE-NOR': 'XNOR' }[w.toUpperCase()] || w.toUpperCase());
  // Soft hyphens and zero-width spaces a PDF puts inside "exclusive-OR".
  const clean = (s) => String(s || '').replace(/[­​]/g, '').replace(/\s+/g, ' ');

  function read({ text, blocks, lines } = {}) {
    const sr = dep('sectionRules', './section-rules.js');
    const pageOf = dep('cardFields', './card-fields.js').pageLocator(lines);
    const found = new Map();
    const add = (gate, s) => { if (!found.has(gate)) found.set(gate, { gate, page: s.page || null, statement: clean(s.text) }); };
    const list = sr.sentences(text, blocks, pageOf).map((s) => ({ ...s, text: clean(s.text) }));
    for (const s of list) {
      for (const m of s.text.matchAll(BASE_RE)) add(canon(m[1]), s);
      const t = s.text.match(TABLES_RE);
      if (t) { add(canon(t[1]), s); add(canon(t[2]), s); }
      if (XOR_RE.test(s.text)) add('XOR', s);
    }
    // A complement counts only once the gate it complements is defined.
    for (const s of list) {
      for (const m of s.text.matchAll(COMPLEMENT_RE)) if (found.has(canon(m[2]))) add(canon(m[1]), s);
    }
    const gates = [...found.values()];
    return gates.length >= MIN_GATES ? { gates } : null;
  }

  const output = (gate, x, y) => OUTPUT[gate](x, y);

  function cards(rule) {
    if (!rule) return [];
    const names = rule.gates.map((g) => g.gate);
    const row = names.map((g) => `${g} ${output(g, 1, 1)}`).join(', ');
    const page = rule.gates[0].page;
    return [{
      front: `With both inputs equal to 1, what do the gates ${names.join(', ')} output?`,
      back: `${row}${page ? ` (p. ${page})` : ''}`,
      category: 'Rule', kind: 'concept', sourceKind: 'key-concept', subject: 'Logic gates', page, quote: rule.gates[0].statement,
      rule: { kind: 'gates', gates: rule.gates },
    }];
  }

  const api = { read, cards, output };
  PDFStudy.gateRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

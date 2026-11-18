/**
 * Altered Statements: a False built from a fact's own statement by changing one thing it commits to, so the
 * student must know the fact itself rather than which slide or paragraph it sits on:
 *   number     one quantity with its unit, moved well outside what the statement says ("5-7 days" -> "15-21 days",
 *              "~25%" -> "~65%")
 *   direction  one word of a closed pair of opposites ("increased" -> "decreased", "lateral" -> "medial"), only when
 *              a line of the scope sets the two against each other about something the statement names
 * A statement is left alone when the change would be unclear or could still be true: more than one quantity,
 * a number that is a name or a code ("L1", "type III", a year), both words of a pair, or an altered wording the
 * scope itself prints.
 *   alter(statement, { text }) -> { statement, change: 'number' | 'direction', from, to } | null
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  // Opposites of general and scientific English: what the word commits to is reversed, nothing else changes.
  const OPPOSITES = [
    ['increase', 'decrease'], ['increased', 'decreased'], ['increases', 'decreases'], ['increasing', 'decreasing'],
    ['higher', 'lower'], ['highest', 'lowest'], ['larger', 'smaller'], ['largest', 'smallest'], ['greater', 'smaller'],
    ['before', 'after'], ['above', 'below'], ['inside', 'outside'], ['internal', 'external'],
    ['positive', 'negative'], ['aerobic', 'anaerobic'], ['acute', 'chronic'], ['early', 'late'],
    ['lateral', 'medial'], ['dorsal', 'ventral'], ['proximal', 'distal'], ['cranial', 'caudal'], ['anterior', 'posterior'],
    ['superior', 'inferior'], ['unilateral', 'bilateral'], ['intracellular', 'extracellular'], ['benign', 'malignant'],
    ['minimum', 'maximum'], ['faster', 'slower'], ['shorter', 'longer'], ['upper', 'lower'], ['left', 'right'],
    ['synchronous', 'asynchronous'], ['excitatory', 'inhibitory'], ['hypertonic', 'hypotonic'],
  ];
  const OPPOSITE = new Map(OPPOSITES.flatMap(([a, b]) => [[a, b], [b, a]]));

  const UNIT = '(?:days?|weeks?|months?|years?|hours?|hrs?|h|minutes?|mins?|seconds?|mg\\/kg|mg|mcg|g|kg|lbs?|ml|mL|L|cm|mm|%|times|fold|°C|°F)';
  const QUANTITY_RE = new RegExp(`(~|>|<|≥|≤)?\\s?(\\d+(?:\\.\\d+)?)(?:\\s?[-–]\\s?(\\d+(?:\\.\\d+)?))?\\s?(${UNIT})(?![A-Za-z])`, 'g');
  const MIN_PERCENT_SHIFT = 40;
  const SCALE = 3;

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

  /** A quantity moved well outside the stated value or range, or null when no clear move exists. */
  function moved(lo, hi, unit) {
    if (unit === '%') {
      const top = hi === null ? lo : hi;
      if (top + MIN_PERCENT_SHIFT <= 100 && lo <= 50) return [lo + MIN_PERCENT_SHIFT, hi === null ? null : hi + MIN_PERCENT_SHIFT];
      if (lo - MIN_PERCENT_SHIFT >= 0) return [lo - MIN_PERCENT_SHIFT, hi === null ? null : hi - MIN_PERCENT_SHIFT];
      return null;
    }
    if (lo <= 0) return null;
    return [lo * SCALE, hi === null ? null : hi * SCALE];
  }

  // "Pastures should be rested 4 weeks": a recommended minimum stays sound when the number grows, so it is not moved.
  const BOUND_RE = /\b(?:should|must|at\s+least|minimum|up\s+to|no\s+more\s+than|recommended|or\s+(?:more|longer|less))\b/i;

  function alterNumber(statement, text) {
    if (BOUND_RE.test(statement)) return null;
    const hits = [...statement.matchAll(QUANTITY_RE)];
    const digits = (statement.match(/\d+(?:\.\d+)?/g) || []).length;
    if (hits.length !== 1) return null;
    const m = hits[0];
    // Every number in the statement must belong to this one quantity: "L1, L2" or "type 2" are names.
    if (digits !== (m[3] ? 2 : 1)) return null;
    const lo = Number(m[2]);
    const hi = m[3] ? Number(m[3]) : null;
    const next = moved(lo, hi, m[4]);
    if (!next) return null;
    const dash = (m[0].match(/\d\s?([-–])\s?\d/) || [])[1] || '-';
    const space = new RegExp(`\\d\\s${m[4].replace(/[/%]/g, '\\$&')}$`).test(m[0]) ? ' ' : '';
    const to = `${(m[0].match(/^\s+/) || [''])[0]}${m[1] || ''}${fmt(next[0])}${m[3] ? dash + fmt(next[1]) : ''}${space}${m[4]}`;
    const altered = statement.slice(0, m.index) + to + statement.slice(m.index + m[0].length);
    if (norm(text).includes(norm(to))) return null; // the scope prints that value as well
    return { statement: altered, change: 'number', from: m[0].trim(), to: to.trim() };
  }

  /** Does a line of the scope print both words of the pair and another content word of the statement? */
  function contrasted(word, opposite, statement, text) {
    const has = (line, w) => new RegExp(`(?<![A-Za-z-])${w}(?![A-Za-z-])`, 'i').test(line);
    const others = (String(statement).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => w !== word.toLowerCase());
    return String(text || '').split(/\n|(?<=[.!?;])\s+/).some((line) => has(line, word) && has(line, opposite) &&
      others.some((w) => has(line, w.replace(/s$/, '')) || has(line, w)));
  }

  function alterDirection(statement, text) {
    const words = statement.match(/[A-Za-z-]+/g) || [];
    const found = words.filter((w) => OPPOSITE.has(w.toLowerCase()));
    // "None ... up to 5x the highest dose": inside a bound, the opposite word ("lowest") weakens the claim, and a
    // weaker claim is still true.
    if (found.length !== 1 || BOUND_RE.test(statement)) return null;
    const word = found[0];
    const opposite = OPPOSITE.get(word.toLowerCase());
    // The opposite already in the statement in either number ("gram negatives") would print it twice.
    const one = (w) => w.toLowerCase().replace(/s$/, '');
    if (words.some((w) => one(w) === one(opposite))) return null;
    // "upper respiratory" -> "lower respiratory": a disease of one tract may well touch the other. The swap is only a
    // clear False when the scope itself sets the two words against each other on one line ("Front: medial claw >
    // lateral; Hind: lateral > medial") about something the statement names too.
    if (!contrasted(word, opposite, statement, text)) return null;
    const to = /^[A-Z]/.test(word) ? opposite[0].toUpperCase() + opposite.slice(1) : opposite;
    const altered = statement.replace(new RegExp(`(?<![A-Za-z-])${word}(?![A-Za-z-])`), to);
    // The scope saying the altered phrase (the opposite with the word after it) would make it true somewhere.
    const after = (altered.slice(altered.indexOf(to) + to.length).match(/^\s+[A-Za-z]+/) || [''])[0];
    if (norm(text).includes(norm(`${to}${after}`))) return null;
    return { statement: altered, change: 'direction', from: word, to };
  }

  /** A False version of the statement, or null. opts.text: the scope's text (the altered value must not be in it). */
  function alter(statement, opts = {}) {
    const s = String(statement || '').trim();
    if (!s) return null;
    const text = opts.text || '';
    return alterNumber(s, text) || alterDirection(s, text);
  }

  /**
   * The one quantity a statement commits to, or null: { text, lo, hi, unit, index } for "Survives 4-6 weeks in water".
   * Null when it holds more than one, when another number in it is a name or a code, or when it states a bound.
   */
  function soleQuantity(statement) {
    const s = String(statement || '');
    if (BOUND_RE.test(s)) return null;
    const hits = [...s.matchAll(QUANTITY_RE)];
    const digits = (s.match(/\d+(?:\.\d+)?/g) || []).length;
    if (hits.length !== 1) return null;
    const m = hits[0];
    if (digits !== (m[3] ? 2 : 1)) return null;
    const lead = (m[0].match(/^\s+/) || [''])[0].length;
    return { text: m[0].trim(), lo: Number(m[2]), hi: m[3] ? Number(m[3]) : null, unit: m[4], index: m.index + lead, prefix: m[1] || '' };
  }

  /** Every quantity a text prints, as soleQuantity describes one. */
  function quantities(text) {
    return [...String(text || '').matchAll(QUANTITY_RE)].map((m) => ({ text: m[0].trim(), lo: Number(m[2]), hi: m[3] ? Number(m[3]) : null, unit: m[4], prefix: m[1] || '' }));
  }

  const api = { alter, soleQuantity, quantities };
  PDFStudy.alteredStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

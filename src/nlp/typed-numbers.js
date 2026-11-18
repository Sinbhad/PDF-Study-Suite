/**
 * Typed Numbers: a number answer of a typed question and what a student typed for it (DOM-free; typed-check.js asks).
 * A number matches numerically ("4-5", "4–5", "4 to 5" are one range; "eight", "ninety-five" and "2^6" are numbers);
 * the unit may be left out unless the prompt asks for it ("type the value with its unit") or it holds a number of its
 * own ("1 ml / 15 lb"); a unit that is given must be the answer's or convert to it exactly ("14 days" for "2 weeks",
 * "mg" for "g", "12 months" for "1 year"). Months and years never convert to weeks or days: their length varies. A
 * word after a count that the prompt counts ("64 rows" for "How many rows ...") is the thing counted, not a unit.
 *
 * parseNumber(text) -> { lo, hi, unit } | null      unitKey(text) -> 'mg/kg'      knownUnit(text) -> boolean
 * checkNumber(q, typed) -> { correct, verdict: 'right' | 'unit' | 'wrong', message }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const EDGE_PUNCT_RE = /^[\s"'“”‘’`.,;:!?()[\]{}]+|[\s"'“”‘’`.,;:!?()[\]{}]+$/g;
  const nfkc = (s) => {
    const t = String(s == null ? '' : s);
    return t.normalize ? t.normalize('NFKC') : t;
  };
  /** A unit word the alias table does not list, in the singular ("tablets" -> "tablet"). */
  const singular = (w) => (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w) ? w.slice(0, -1) : w);
  const result = (correct, verdict, message) => ({ correct, verdict, message });

  // Units written in several ways ("hours", "hrs", "h") compare as one.
  const UNIT_ALIASES = {
    h: ['h', 'hr', 'hrs', 'hour', 'hours'], min: ['min', 'mins', 'minute', 'minutes'], s: ['s', 'sec', 'secs', 'second', 'seconds'],
    d: ['d', 'day', 'days'], wk: ['wk', 'wks', 'week', 'weeks'], mo: ['mo', 'month', 'months'], yr: ['y', 'yr', 'yrs', 'year', 'years'],
    ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'cc'], l: ['l', 'liter', 'liters', 'litre', 'litres'],
    mg: ['mg', 'milligram', 'milligrams'], g: ['g', 'gram', 'grams'], kg: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'],
    lb: ['lb', 'lbs', 'pound', 'pounds'], '%': ['%', 'percent', 'pct'],
  };
  const UNIT_OF = new Map(Object.entries(UNIT_ALIASES).flatMap(([key, forms]) => forms.map((f) => [f, key])));
  const unitWord = (w) => UNIT_OF.get(w) || singular(w);

  /** "mg/kg" == "mg per kg"; "1 ml / 15 lb" keeps its inner number. */
  function unitKey(text) {
    const s = nfkc(text).toLowerCase().replace(/\bper\b/g, '/').replace(/[.\s]+/g, ' ').trim();
    if (!s) return '';
    return s.split('/').map((part) => (part.trim().match(/\d+(?:\.\d+)?|[a-z%µμ]+/g) || [])
      .map((tok) => (/^\d/.test(tok) ? String(Number(tok)) : unitWord(tok))).join('')).join('/');
  }

  /** Is every part of this unit one the checker knows ("mg/kg", "ml / 15 lb", "days"), so a number with it can be asked? */
  function knownUnit(text) {
    const key = unitKey(text);
    if (!key) return false;
    const known = new Set(Object.keys(UNIT_ALIASES));
    return key.split('/').every((part) => {
      const unit = part.replace(/^\d+(?:\.\d+)?/, '');
      return known.has(unit);
    });
  }

  const NUMBER_RE =/^(?:about|approx\.?|approximately|around|~|≈)?\s*(-?\d+(?:\.\d+)?)\s*(?:(?:-|to)\s*(-?\d+(?:\.\d+)?))?\s*(.*)$/;

  // Number words a student may type for digits: "eight weeks", "ninety-five percent", "one hundred and twenty".
  const UNITS_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS_WORDS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const SCALE_WORDS = { hundred: 100, thousand: 1000, million: 1e6 };
  const wordValue = (w) => (UNITS_WORDS.includes(w) ? UNITS_WORDS.indexOf(w) : TENS_WORDS.indexOf(w) > 1 ? TENS_WORDS.indexOf(w) * 10 : null);
  const NUMBER_WORD_RE = new RegExp(`\\b(?:${[...UNITS_WORDS, ...TENS_WORDS.filter(Boolean), ...Object.keys(SCALE_WORDS)].join('|')})(?:(?:[\\s-]+|\\s+and\\s+)(?:${[...UNITS_WORDS, ...TENS_WORDS.filter(Boolean), ...Object.keys(SCALE_WORDS)].join('|')}))*\\b`, 'g');

  /**
   * "ninety-five percent" -> "95 percent"; "a hundred" is left alone (the article is not a number). A run that is not
   * one number as written ("two and three", "five twenty") stays words, so it is never read as a sum.
   */
  function numberWordsToDigits(text) {
    return String(text).replace(NUMBER_WORD_RE, (run) => {
      const list = run.split(/[\s-]+/).filter(Boolean);
      let total = 0;
      let part = 0;
      let prev = '';
      for (const w of list) {
        const kind = w === 'and' ? 'and' : SCALE_WORDS[w] ? 'scale' : TENS_WORDS.includes(w) ? 'tens' : 'unit';
        const follows = { '': ['unit', 'tens', 'scale'], tens: ['unit', 'scale'], unit: ['scale'], scale: ['and', 'unit', 'tens'], and: ['unit', 'tens'] }[prev];
        if (!follows.includes(kind) || (prev === 'tens' && kind === 'unit' && wordValue(w) > 9)) return run;
        prev = kind;
        if (kind === 'and') continue;
        if (kind === 'scale') {
          part = (part || 1) * SCALE_WORDS[w];
          if (SCALE_WORDS[w] >= 1000) { total += part; part = 0; }
        } else part += wordValue(w);
      }
      return prev === 'and' ? run : String(total + part);
    });
  }

  // "2^6", "2**6" or "2⁶" for 64: a power that works out to a whole number.
  const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const POWER_RE = /^(\d+)\s*(?:\^|\*\*)\s*(\d+)\b/;
  function powersToDigits(text) {
    const s = String(text).replace(/(\d)([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_all, base, sup) => `${base}^${[...sup].map((c) => SUPERSCRIPT.indexOf(c)).join('')}`);
    return s.replace(POWER_RE, (all, base, exp) => {
      const v = Number(base) ** Number(exp);
      return Number.isSafeInteger(v) ? String(v) : all;
    });
  }

  /** "4–5 mg/kg" -> { lo: 4, hi: 5, unit: 'mg/kg' }; "8" -> { lo: 8, hi: 8, unit: '' }; not a number -> null. */
  function parseNumber(text) {
    const raw = powersToDigits(String(text == null ? '' : text).trim());
    const s = numberWordsToDigits(nfkc(raw).toLowerCase()).replace(/[–—]/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(EDGE_PUNCT_RE, '').trim();
    const m = s.match(NUMBER_RE);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return { lo, hi, unit: unitKey(m[3]) };
  }

  // Units of one dimension convert exactly: "14 days" is "2 weeks", "500 mg" is "0.5 g", "12 months" is "1 year".
  // Months and years never convert to weeks or days: their length varies.
  const SCALE = {
    s: ['time', 1], min: ['time', 60], h: ['time', 3600], d: ['time', 86400], wk: ['time', 604800],
    mo: ['calendar', 1], yr: ['calendar', 12],
    mg: ['mass', 0.001], g: ['mass', 1], kg: ['mass', 1000], ml: ['volume', 1], l: ['volume', 1000],
  };

  /** The factor that turns a value in unit `from` into unit `to`, or null when they do not convert ("mg/kg" -> "g/kg": 0.001). */
  function conversion(from, to) {
    const a = from.split('/');
    const b = to.split('/');
    if (a.length !== b.length) return null;
    let factor = 1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const x = SCALE[a[i]];
      const y = SCALE[b[i]];
      if (!x || !y || x[0] !== y[0]) return null;
      factor *= i === 0 ? x[1] / y[1] : y[1] / x[1];
    }
    return factor;
  }
  const same = (x, y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x), Math.abs(y));

  // The prompt asks for the unit ("type the value with its unit"): a bare number is not the whole answer then.
  const UNIT_ASKED_RE = /\bwith\s+(?:its|the|a)\s+units?\b/i;

  /**
   * A word after a count that the prompt itself counts ("64 rows" for "How many rows ...?"): the thing counted, not a
   * unit. A unit the checker knows is never one.
   */
  function countedNoun(unit, question) {
    if (!unit || /[/\d]/.test(unit) || Object.prototype.hasOwnProperty.call(UNIT_ALIASES, unit)) return false;
    const asked = (String(question || '').toLowerCase().match(/[a-z]+/g) || []).map(unitWord);
    return asked.includes(unit);
  }

  function checkNumber(q, typed) {
    const want = parseNumber(q.answer);
    const got = parseNumber(typed);
    if (!want || !got) return result(false, 'wrong', 'Not quite.');
    if (!want.unit && countedNoun(got.unit, q.question)) got.unit = '';
    const sameNumber = got.lo === want.lo && got.hi === want.hi;
    if (sameNumber && !got.unit && want.unit && (/\d/.test(want.unit) || UNIT_ASKED_RE.test(String(q.question || '')))) {
      return result(false, 'unit', 'The number is right, but this answer needs its unit.');
    }
    if (sameNumber && (!got.unit || got.unit === want.unit)) return result(true, 'right', 'Correct.');
    const factor = got.unit && want.unit ? conversion(got.unit, want.unit) : null;
    if (factor !== null && same(got.lo * factor, want.lo) && same(got.hi * factor, want.hi)) return result(true, 'right', `Correct (the material gives ${String(q.answer).trim()}).`);
    return result(false, sameNumber ? 'unit' : 'wrong', sameNumber ? 'The number is right, but the unit is not.' : 'Not quite.');
  }

  const api = { parseNumber, unitKey, knownUnit, checkNumber };
  PDFStudy.typedNumbers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

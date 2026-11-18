/**
 * Typed Numbers: a number answer of a typed question and what a student typed for it (DOM-free; typed-check.js asks).
 * A number matches numerically ("4-5", "4–5", "4 to 5" are one range); the unit may be left out, but a unit that is
 * given must be the answer's or convert to it exactly ("14 days" for "2 weeks", "mg" for "g"); a unit that holds a
 * number of its own ("1 ml / 15 lb") must be given. Months and years do not convert: their length varies.
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

  /** "4–5 mg/kg" -> { lo: 4, hi: 5, unit: 'mg/kg' }; "8" -> { lo: 8, hi: 8, unit: '' }; not a number -> null. */
  function parseNumber(text) {
    const s = nfkc(text).toLowerCase().replace(/[–—]/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1').replace(EDGE_PUNCT_RE, '').trim();
    const m = s.match(NUMBER_RE);
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return { lo, hi, unit: unitKey(m[3]) };
  }

  // Units of one dimension convert exactly: "14 days" is "2 weeks", "500 mg" is "0.5 g". (Months and years vary.)
  const SCALE = {
    s: ['time', 1], min: ['time', 60], h: ['time', 3600], d: ['time', 86400], wk: ['time', 604800],
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

  function checkNumber(q, typed) {
    const want = parseNumber(q.answer);
    const got = parseNumber(typed);
    if (!want || !got) return result(false, 'wrong', 'Not quite.');
    const sameNumber = got.lo === want.lo && got.hi === want.hi;
    if (sameNumber && !got.unit && /\d/.test(want.unit)) return result(false, 'unit', 'The number is right, but this answer needs its unit.');
    if (sameNumber && (!got.unit || got.unit === want.unit)) return result(true, 'right', 'Correct.');
    const factor = got.unit && want.unit ? conversion(got.unit, want.unit) : null;
    if (factor !== null && same(got.lo * factor, want.lo) && same(got.hi * factor, want.hi)) return result(true, 'right', `Correct (the material gives ${String(q.answer).trim()}).`);
    return result(false, sameNumber ? 'unit' : 'wrong', sameNumber ? 'The number is right, but the unit is not.' : 'Not quite.');
  }

  const api = { parseNumber, unitKey, knownUnit, checkNumber };
  PDFStudy.typedNumbers = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

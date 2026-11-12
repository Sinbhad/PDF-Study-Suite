/**
 * Math Font Glyph Decoder (100% Offline, Non-AI)
 * PDF.js guesses Unicode for embedded math fonts that lack a ToUnicode map, and for Linotype
 * Mathematical Pi (Larson / Cengage), PostScript Symbol and TeX CM* fonts the guesses are often wrong
 * (Larson: prime shows as "≤", Δ as "⋅", π as "→", |x| as "∑x∑", Greek letters as control chars).
 * decodeChar() repairs one character from its font family plus, when known, its real glyph name.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const GREEK_UPPER = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
  const GREEK_LOWER = 'αβγδεζηθικλμνξοπρστυφχψω';

  // Linotype Mathematical Pi glyph names ("H11032"); Greek runs alphabetically from H9001 / H9251.
  const PI_NAMES = {
    H11001: '+', H11002: '−', H11003: '×', H11004: '÷', H11005: '=', HS11005: '≠', H11006: '±', H11009: '∞',
    H11021: '<', H11022: '>', H11032: '′', H11033: '″', H11034: '°', H11080: '⋅', H11349: '≤', H11350: '≥',
    H11015: '/', H11341: '|', H11545: '+', H11546: '−', H11549: '=', H11557: '∞', H11625: '^',
    H20648: '‖', H20848: '∫', H20885: '∫', H20858: '∑', H20862: '/', H20864: '⟦', H20865: '⟧',
    H20849: '(', H20850: ')', H20898: '(', H20899: ')', H20851: '[', H20852: ']', H20900: '[', H20901: ']',
    H20871: '(', H20872: ')', H20877: '{', H20878: '}', H20902: '√', H20906: '√', H20903: ']',
    H17005: '△', H11028: '∠', H11938: 'ℝ', H5129: 'ℓ',
  };
  for (let i = 0; i < 24; i++) {
    PI_NAMES[`H${9001 + i}`] = GREEK_UPPER[i];
    PI_NAMES[`H${9251 + i}`] = GREEK_LOWER[i];
  }

  // Fallback when glyph names are unavailable: what PDF.js shows -> what Mathematical Pi draws
  const PI_FALLBACK = {
    One: { '≤': '′', '≥': '″', '≈': '°', '±': '⋅', '∞': '≤', '∘': '≥', '≠': '∞', '⋅': 'Δ', '←': 'α' },
    Three: { '∑': '|', '√': '/', '|': '√', '{': '(', '}': ')' },
    Four: { '∈': '+', '∉': '−', '⊂': '=' },
  };

  // Adobe Symbol / CMEX private-use pieces of tall delimiters and radicals
  const PUA = {
    0xf8e5: '', 0xf8e6: '', 0xf8e7: '', 0xf8eb: '(', 0xf8ec: '', 0xf8ed: '', 0xf8ee: '[', 0xf8ef: '', 0xf8f0: '',
    0xf8f1: '⎧', 0xf8f2: '⎨', 0xf8f3: '⎩', 0xf8f4: '⎪', 0xf8f5: '', 0xf8f6: ')', 0xf8f7: '', 0xf8f8: '', 0xf8f9: ']',
    0xf8fa: '', 0xf8fb: '', 0xf8fc: '⎫', 0xf8fd: '⎬', 0xf8fe: '⎭', 0xf8e8: '®', 0xf8e9: '©', 0xf8ea: '™',
  };

  // Standard / TeX glyph names PDF.js may leave unmapped in CM*, MT*, Euclid and Symbol subsets
  const NAMED = {
    minus: '−', plusminus: '±', multiply: '×', divide: '÷', periodcentered: '⋅', dotmath: '⋅', bullet: '•',
    lessequal: '≤', greaterequal: '≥', notequal: '≠', approxequal: '≈', equivalence: '≡', similar: '∼',
    arrowright: '→', arrowleft: '←', arrowdblright: '⇒', arrowdblleft: '⇐', arrowdblboth: '⇔', arrowboth: '↔',
    infinity: '∞', partialdiff: '∂', gradient: '∇', nabla: '∇', element: '∈', notelement: '∉', suchthat: '∋',
    propersubset: '⊂', reflexsubset: '⊆', propersuperset: '⊃', reflexsuperset: '⊇', union: '∪', intersection: '∩',
    universal: '∀', existential: '∃', emptyset: '∅', logicalnot: '¬', logicaland: '∧', logicalor: '∨',
    integral: '∫', integraltext: '∫', integraldisplay: '∫', summation: '∑', summationtext: '∑',
    summationdisplay: '∑', product: '∏', producttext: '∏', productdisplay: '∏', radical: '√', radicalbig: '√',
    radicalBig: '√', radicalbigg: '√', radicalBigg: '√', prime: '′', minute: '′', second: '″',
    angbracketleft: '⟨', angbracketright: '⟩', angleleft: '⟨', angleright: '⟩', floorleft: '⌊', floorright: '⌋',
    ceilingleft: '⌈', ceilingright: '⌉', bar: '|', bardbl: '‖', braceleft: '{', braceright: '}',
    parenleftbig: '(', parenrightbig: ')', parenleftBig: '(', parenrightBig: ')', parenleftbigg: '(',
    parenrightbigg: ')', bracketleftbig: '[', bracketrightbig: ']', braceleftbig: '{', bracerightbig: '}',
    braceleftBig: '{', bracerightBig: '}', braceleftbigg: '{', bracerightbigg: '}', bracelefttp: '{',
    therefore: '∴', aleph: 'ℵ', weierstrass: '℘', Rfractur: 'ℜ', Ifractur: 'ℑ', degree: '°', ellipsis: '…',
    circlemultiply: '⊗', circleplus: '⊕', perpendicular: '⊥', angle: '∠', mapsto: '↦', arrowup: '↑', arrowdown: '↓',
  };

  const LIGATURES = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };
  const MATH_FAMILY_RE = /mathematicalpi|symbol|^cm(?:sy|mi|ex|bsy|mib|r)|^ms(?:bm|am)|^mt(?:mi|sy|ex|extra)|euclid|stix|math/i;

  /** "LNKEAO+MathematicalPi-One" -> { base: 'MathematicalPi-One', pi: 'One', isMath: true } */
  function familyInfo(realName) {
    const base = String(realName || '').replace(/^[A-Z]{6}\+/, '');
    const pi = /MathematicalPi(?:LTStd)?-?(One|Two|Three|Four|Five|Six)/i.exec(base);
    return { base, pi: pi ? pi[1][0].toUpperCase() + pi[1].slice(1).toLowerCase() : null, isMath: MATH_FAMILY_RE.test(base) };
  }

  /** Repairs one character. glyph: real glyph name when the loader could resolve it (else null). */
  function decodeChar(ch, fam, glyph) {
    if (LIGATURES[ch]) return LIGATURES[ch];
    if (glyph) {
      const g = String(glyph);
      if (fam && fam.pi && PI_NAMES[g] !== undefined) return PI_NAMES[g];
      if (fam && fam.pi && /^HS?\d+$/.test(g)) return PI_NAMES[g.replace(/^HS/, 'H')] || (ch.charCodeAt(0) < 32 ? '' : ch);
      if (NAMED[g] !== undefined && (ch.charCodeAt(0) < 32 || /[\uE000-\uF8FF]/.test(ch) || fam.isMath)) return NAMED[g];
    } else if (fam && fam.pi && PI_FALLBACK[fam.pi] && PI_FALLBACK[fam.pi][ch]) {
      return PI_FALLBACK[fam.pi][ch];
    }
    const cp = ch.codePointAt(0);
    if (PUA[cp] !== undefined) return PUA[cp];
    if (cp >= 0xe000 && cp <= 0xf8ff) return '';
    if (cp < 32 || (cp >= 0x7f && cp <= 0x9f) || cp === 0xfffd) return ' ';
    return ch;
  }

  /** Decodes a whole PDF.js item string; glyphOf(ch, index) may return the glyph name for that char. */
  function decodeString(str, fam, glyphOf) {
    let out = '';
    let i = 0;
    for (const ch of String(str || '')) {
      out += decodeChar(ch, fam || { isMath: false }, glyphOf ? glyphOf(ch, i) : null);
      i++;
    }
    return out;
  }

  PDFStudy.mathGlyphs = { decodeChar, decodeString, familyInfo, PI_NAMES, NAMED, PUA, MATH_FAMILY_RE };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.mathGlyphs;
  }
})(typeof window !== 'undefined' ? window : globalThis);

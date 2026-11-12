/**
 * Phrase-Shape Rules for Quiz Answers & Distractors (extracted from quiz-gate.js; re-exported there).
 * Ensures every untrusted option reads as a standalone STEM noun phrase of comparable shape to the answer.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const VERB_TAIL = new Set(('refers remains means describes states occurs requires contains produces ' +
    'includes involves unwinds unwind binds bind decreases increases overcomes becomes represents consists ' +
    'depends converts catalyzes releases absorbs forms makes takes allows causes leads results exists acts ' +
    'serves plays provides controls regulates inhibits drives driven occur form make take lower higher ' +
    'faster slower greater smaller larger constant unchanged forward backward appear appears shows show ' +
    'called known used given defined is are was were be been has have had can will may must increase ' +
    'decrease release convert consider transfer deliver determine generate operate separate within ' +
    'throughout without between among across during upon toward towards via per except follows ' +
    'repeat away exhibits fails varies yields drops exist exists holds approaches equals satisfies ' +
    'applies gives perform performs choose choosing runs sorts merges halves computes explores splits ' +
    'maintains narrows converges diverges admits updates evaluates differentiates integrates running ' +
    'became came went saw knew thought took gave made found told asked seemed felt left kept began helped ' +
    'deals deal falls fall fell finds find underpins underpin comes come goes go gets get tells tell says say ' +
    'stems implies imply coincides coincide reduces reduce guarantees guarantee constructs construct stays stay ahead twice done').split(' '));
  const LEAD_BAD = new Set(('according although though because however whereas while when if thus therefore also ' +
    'so then another other others such each every more most very many several some any all both either neither ' +
    'increasing decreasing making using being having including following given almost always often ' +
    'usually only just even still nearly perform reach keep allow find give total undergo become provide ' +
    'produce contain require form assigns restores selects saves stores allows uses makes takes gives ' +
    'exhibits least move follows whether determine prove disprove obtain construct draw discuss sketch ' +
    'estimate approximate evaluate compute calculate solve show verify apply consider describe explain ' +
    'identify compare write complete rewrite simplify use find let one two three four five six seven ' +
    'eight nine ten first second third hundred thousand million few new general certain particular ' +
    'same different various important approach approaching choosing whose whom who which what whatever ' +
    'how why my your his her its our their take get got put set run see say go come know think look want ' +
    'need try ask work seem feel leave call begin help talk turn start do does did done made had ' +
    'along besides beside despite beyond within without across toward towards around behind beneath ' +
    'inside outside onto upon throughout unlike versus via since until unless whilst amid among amongst ' +
    'concerning regarding excluding considering next previous prior former latter word words underpins underpin ' +
    'pay collect develop represent measure exchanging public private static void return').split(' '));
  const MID_BAD = new Set(('is are was were be been being has have had ever never also very used without ' +
    'within yields drops gets got per prove disprove determine obtain construct sketch evaluate compute ' +
    'calculate solve verify explain describe discuss many much several whose whom became came went took gave made ' +
    'besides along though despite beyond unlike versus calculated implies imply stays stay guarantees guarantee constructs').split(' '));
  const AMBIG_S = new Set('forms states results controls acts plays leads means shows'.split(' '));
  const LY_NOUNS = new Set('family supply assembly anomaly monopoly reply ally jelly rally italy july poly'.split(' '));
  const ING_NOUNS = new Set(('programming scheduling ordering coloring matching spanning mapping encoding learning ' +
    'training testing hashing sorting searching branching bounding rounding sampling scaling clustering indexing ' +
    'paging routing processing computing modeling engineering warning meaning setting building ceiling ring string spring wing').split(' '));
  const GENERIC_TAIL = new Set('amount amounts number numbers part parts kind kinds type types way ways thing things'.split(' '));
  const GENERIC_SINGLE = new Set(('foundations foundation laws law introduction overview summary review ' +
    'principles principle basics fundamentals concepts concept mechanism mechanisms regulation process ' +
    'processes system systems theory chapter section unit part lesson module topics topic function functions ' +
    'value values variable variables constant constants problem problems method methods result results ' +
    'equation equations expression expressions statement statements condition conditions element elements').split(' '));
  const ADJ_END_RE = /(?:ly|ing|ed|al|ive|ous|ic|ful|less|able|ible)$/;
  const ADJ_NOUNS = new Set(('interval intervals signal animal capital material potential terminal mineral ' +
    'metal crystal journal arrival removal survival approval proposal tutorial principal integral radical ' +
    'logic topic arithmetic music clinic graphic derivative alternative objective incentive initiative ' +
    'perspective representative executive relative motive variable variables polynomial polynomials').split(' '));
  const NOUN_END_RE =
    /(?:tion|sion|ment|ness|ity|ism|ance|ence|ogy|sis|ase|ide|ate|ule|ure|ant|ent|ium|ion|er|or|ist|cy|gen|ome|yte|ein|ics|ide|ole|ane|ene|ose)s?$/;
  // Legitimate ordinal STEM concepts ("second derivative", "first law") allowed despite ordinal LEAD_BAD.
  const ORDINAL_STEM_RE =
    /^(?:first|second|third|fourth|nth)\s+(?:derivatives?|integrals?|laws?|orders?|differences?|moments?|fundamentals?|terms?|quadrants?|approximations?)\b/i;
  const IER_NOUNS = new Set('carrier barrier frontier fourier bezier glacier soldier cashier premier tier pier multiplier'.split(' '));
  const MORPH_SUFFIXES = ('tion sion ism ity ment ness ance ence ology graphy sis ase ide ical ic ous ive able ible ing ed').split(' ');
  const DIDACTIC_RE = /^(?:Theorem|Definition|Lemma|Corollary|Rule|Law|Algorithm|Guideline)s?\b|\b(?:Theorem|Rule|Law|Formula|Algorithm)$/i;

  const clean = (t) => String(t || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();

  function isNounPhrase(phrase, isGoodDistractor) {
    const p = clean(phrase);
    if (isGoodDistractor && !isGoodDistractor(p)) return false;
    if (/^[A-Z][A-Z0-9-]{1,7}$/.test(p)) return true;
    const lower = p.toLowerCase().split(' ');
    const last = lower[lower.length - 1];
    const leadBad = LEAD_BAD.has(lower[0]) && !ORDINAL_STEM_RE.test(p);
    if (leadBad || VERB_TAIL.has(last) || GENERIC_TAIL.has(last)) return false;
    if (/^[a-z]{2,}ier$/.test(last) && !IER_NOUNS.has(last)) return false; // "math easier", "much faster"
    if (lower.some((w) => MID_BAD.has(w) || (/ly$/.test(w) && !LY_NOUNS.has(w)))) return false;
    if (last.length >= 7 && /(?:izes|ises|yzes|ifies)$/.test(last)) return false;
    if (lower.length >= 3 && /ing$/.test(lower[1])) return false;
    if (lower.slice(1, -1).some((w) => VERB_TAIL.has(w) && /s$/.test(w) && !AMBIG_S.has(w))) return false;
    if (lower.length > 1 && /^[A-Z][a-z]/.test(p.split(' ').pop()) && /^[a-z]/.test(p)) return false;
    const isProper = /^(?:[A-Z][a-z]+\s+)+[A-Z][a-z]+$/.test(p);
    if (/ing$/.test(last) && !isProper && !ING_NOUNS.has(last)) return false;
    if (/ed$/.test(last) && !isProper) return false;
    if (!isProper && (/ed$/.test(lower[0]) || (/(?:al|ive|ous|able|ible|ic)$/.test(last) && !ADJ_NOUNS.has(last)))) {
      return false;
    }
    if (lower.length > 1 && /^(?:another|other|others|itself|themselves)$/.test(last)) return false;
    if (/[a-z]{4,}[A-Z][a-z]{3,}/.test(p)) return false;
    if (lower.length > 1 && p.split(' ').some((w) => /^[A-Z]{4,}$/.test(w))) return false;
    if (lower.length === 1) {
      if (GENERIC_SINGLE.has(last) || (ADJ_END_RE.test(last) && !ADJ_NOUNS.has(last))) return false;
      if (/^[A-Z]/.test(p)) return last.length >= 5;
      return last.length >= 7 && NOUN_END_RE.test(last);
    }
    return true;
  }

  function getShapeBucket(term) {
    const t = String(term || '').trim();
    if (/^(1[5-9]\d{2}|20\d{2})$/.test(t)) return 'YEAR';
    if (/^\d+(\.\d+)?\s*(%|ms|s|kg|m|Hz|V|W|J|mol|px|GB|MB)?$/i.test(t)) return 'NUMBER';
    if (/^[A-Z]{2,8}$/.test(t)) return 'ACRONYM';
    if (DIDACTIC_RE.test(t)) return 'DIDACTIC';
    return /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(t) ? 'PROPER' : 'TERM';
  }

  /** Didactic/theorem titles pair freely with each other and with multi-word STEM noun phrases. */
  function shapeFits(target, cand) {
    const t = clean(target);
    const c = clean(cand);
    const tw = t.split(' ').length;
    const cw = c.split(' ').length;
    if (getShapeBucket(t) === 'DIDACTIC') return getShapeBucket(c) === 'DIDACTIC' || (cw >= 2 && cw <= 8);
    if (/^[A-Z][A-Z0-9-]{1,7}$/.test(c)) return tw <= 2;
    return tw >= 2 ? cw >= 2 && Math.abs(tw - cw) <= 2 : cw <= 2;
  }

  function getMorphSuffix(word) {
    const w = (word || '').toLowerCase().trim();
    return MORPH_SUFFIXES.find((suf) => w.length > suf.length + 2 && w.endsWith(suf)) || '';
  }

  const api = { isNounPhrase, shapeFits, getShapeBucket, getMorphSuffix };
  PDFStudy.phraseShape = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Quiz Option Quality Fixtures (loaded by tests/quality_fixtures.js under Node, or by tests/quality.html).
 * Asserts that answers/distractors are on-topic concepts: no cross-phrase RAKE compounds, no truncated
 * words, no unit/measurement phrases, no verb-final fragments and no generic one-off single words.
 */
(function (root) {
  // Mirrors the bad Larson output: a truncated caption ("Velocity function diver"), units ("feet per
  // second"), heading/caption lines glued to the next line, and list items with an inline imperative.
  const CALC_SECTION = [
    '**1.3 Evaluating Limits Analytically**',
    'Direct substitution is the simplest strategy for evaluating the limit of a polynomial function.',
    'When direct substitution yields the indeterminate form, the rational function must be simplified first.',
    'The limit of a rational function exists when the denominator of the rational function is not zero.',
    'When the denominator approaches zero and the numerator does not, the quotient diverges and the limit does not exist.',
    'Velocity function diver',
    'A construction worker drops a full paint can from a height of 500 feet.',
    'The paint can falls at a velocity of 32 feet per second, and the velocity function gives the instantaneous rate.',
    'The Squeeze Theorem states that a function squeezed between two functions with the same limit has that limit as well.',
    'Water freezes at zero degrees Celsius',
    'Massachusetts Institute of Technology researchers measured temperatures near absolute zero.',
    'The polynomial function and the rational function are both continuous on their domains.',
    'Numerical approach Construct a table of values.',
    'Graphical approach Draw a graph by hand.',
    'The enzyme lactase catalyzes the hydrolysis of lactose, and the polynomial function linearizes nothing.',
  ].join('\n');

  const CROSS_PHRASE_RE =
    /reaction heat|celsius massachusetts|approach (?:construct|draw)|diver(?:\s|$)/i;
  const GENERIC_SINGLES = new Set(['portion', 'pressure', 'temperature', 'disorder', 'energy', 'system', 'heat']);

  function checkOptionQuality(S, check, bioSection) {
    const Q = S.quizOptions;
    const G = S.quizGate;
    const K = S.keywords;

    // RAKE: compounds respect line/clause boundaries, case runs and the 3-word cap.
    const bioPhrases = K.extractRakeKeyphrases(bioSection, 3, 60).map((r) => r.lower);
    check('RAKE splits "endothermic reaction | heat"', !bioPhrases.includes('endothermic reaction heat') &&
      bioPhrases.includes('endothermic reaction') && bioPhrases.includes('heat energy'), bioPhrases.join(', '));
    const calcPhrases = K.extractRakeKeyphrases(CALC_SECTION, 3, 80).map((r) => r.lower);
    const glued = calcPhrases.filter((p) => CROSS_PHRASE_RE.test(p) && p !== 'velocity function diver');
    check('RAKE respects line breaks and case runs', glued.length === 0, glued.join(' | '));
    check('RAKE caps compounds at 3 words', calcPhrases.concat(bioPhrases).every((p) => p.split(' ').length <= 3));

    // Option vetting primitives.
    const prof = Q.buildProfile(CALC_SECTION);
    check('truncated last token detected', Q.isTruncated('Velocity function diver', prof) &&
      !Q.isTruncated('rational function', prof) && !Q.isTruncated('Squeeze Theorem', prof));
    const units = ['feet per second', 'degrees Celsius', 'feet', 'miles per hour'];
    check('unit phrases detected', units.every((u) => Q.isUnitPhrase(u)) && !Q.isUnitPhrase('velocity function'),
      units.filter((u) => !Q.isUnitPhrase(u)).join(' | '));
    const verbish = ['worker drops', 'lactase catalyzes', 'golf ball varies', 'substitution yields', 'function linearizes'];
    const slipped = verbish.filter((v) => G.isNounPhrase(v) && !Q.isVerbTail(v, prof));
    check('verb-final fragments rejected', slipped.length === 0, slipped.join(' | '));
    const nouns = ['open interval', 'rational function', 'polynomial function', 'Squeeze Theorem', 'amino acids'];
    check('real noun phrases kept', nouns.every((n) => G.isNounPhrase(n)), nouns.filter((n) => !G.isNounPhrase(n)).join(' | '));

    // End-to-end: every option of every seed on both fixture sections.
    for (const [label, text] of [['bio', bioSection], ['calc', CALC_SECTION]]) {
      const words = new Set(text.toLowerCase().replace(/\*\*/g, '').match(/[a-z][a-z'-]*/g) || []);
      const count = (w) => (text.toLowerCase().match(new RegExp(`\\b${w}\\b`, 'g')) || []).length;
      const opts = [0, 1, 2].flatMap((seed) => S.quizEngine.generateQuiz(text, { maxQuestions: 10, seedOffset: seed })
        .filter((q) => q.type !== 'true_false').flatMap((q) => q.options));
      const truncated = opts.filter((o) => {
        const last = (o.toLowerCase().match(/[a-z][a-z'-]*/g) || []).pop();
        return last && (!words.has(last) || last === 'diver');
      });
      check(`[${label}] no truncated-word options`, truncated.length === 0, truncated.join(' | '));
      const unitOpts = opts.filter((o) => Q.isUnitPhrase(o) || /\b(?:feet|inches|seconds|per)\b/i.test(o));
      check(`[${label}] no unit/measurement options`, unitOpts.length === 0, unitOpts.join(' | '));
      const crossOpts = opts.filter((o) => CROSS_PHRASE_RE.test(o));
      check(`[${label}] no cross-phrase compound options`, crossOpts.length === 0, crossOpts.join(' | '));
      const generic = opts.filter((o) => /^[a-z]+$/.test(o) && (GENERIC_SINGLES.has(o) || count(o) < 2));
      check(`[${label}] no generic one-off single-word options`, generic.length === 0, generic.join(' | '));
      check(`[${label}] options still produced`, opts.length >= 4, `${opts.length} options`);
    }
  }

  const api = { checkOptionQuality, CALC_SECTION };
  root.OptionFixtures = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    if (require.main === module) {
      const report = require('./quality_fixtures.js').runQualityChecks();
      const optResults = report.results.filter((r) => /RAKE|truncated|unit|verb-final|noun phrases kept|^\[(?:bio|calc)\]/.test(r.name));
      optResults.forEach((r) => console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`));
      const ok = optResults.length > 0 && optResults.every((r) => r.ok);
      console.log(ok ? 'PASS' : 'FAIL');
      process.exit(ok ? 0 : 1);
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);

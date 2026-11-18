/**
 * Option-Set Normaliser: makes the options of one question look alike, so nothing but knowledge of the
 * subject separates the answer from the distractors. A set that cannot be made consistent is refused
 * (null) and the caller drops the question.
 *
 *   termSet         short terms: one grammatical number, one leading case (proper nouns and acronyms keep
 *                   theirs), comparable lengths, and no option that repeats a word of the stem unless
 *                   every option repeats it
 *   statementSet    whole statements: same math/prose kind, comparable lengths, sentence case, final period
 *   neutralArticle  "a ________" / "an ________" -> "a(n) ________", so the article names no option
 *   textForms       how the source text writes a term: inside a sentence, and in the other number
 *
 * Candidates are taken in the order given: the caller ranks them (same slide or section first).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const gate = () => dep('quizGate', './quiz-gate.js');
  const shape = () => dep('phraseShape', './phrase-shape.js');

  const LENGTH_RATIO = 1.5; // one option this much longer than every other one is a tell
  const LENGTH_MARGIN = 10;

  const words = (s) => String(s || '').toLowerCase().match(/[a-z][a-z'’-]*/g) || [];
  const lastWord = (s) => words(s).pop() || '';
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const upperFirst = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  /** Crude lemma: "membranes" == "membrane", "classes" == "class". Used to tell two terms apart. */
  function lemma(word) {
    const w = String(word || '').toLowerCase();
    if (w.length > 4 && /ies$/.test(w)) return `${w.slice(0, -3)}y`;
    if (w.length > 4 && /(?:ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  const termKey = (s) => words(s).map(lemma).join(' ');

  /**
   * Cruder still: also folds "bonding"/"bonded" into "bond". Used to spot a word of the answer that is
   * repeated in the stem, where an inflected form gives the answer away just as well.
   */
  function stem(word) {
    let w = lemma(String(word || '').replace(/[’']s$/, ''));
    if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    return w.length > 4 ? w.replace(/e$/, '') : w;
  }

  /** Plural by form. "series", "analysis", "physics" and "-us"/"-ss" words are singular. */
  function isPlural(term) {
    const last = lastWord(term);
    if (last.length <= 3 || !/s$/.test(last) || last === 'series') return false;
    return !/(?:ss|us|is|ics)$/.test(last);
  }

  /** First word carries its own capitals ("mRNA", "IPv4", "DNA", "n-ary"): its case is never changed. */
  function hasFixedCase(term) {
    const first = String(term || '').trim().split(/\s+/)[0] || '';
    return /[A-Z0-9]/.test(first.slice(1)) || /^[a-z]-/.test(first) || !/^[A-Za-z]/.test(first);
  }

  /**
   * How the source text writes a term. -> { running(term), inNumber(term, plural) }
   *   running   the term as written inside a sentence, or null when it must keep its capital. Without a
   *             dictionary "Bastille" and "Entropy" look the same at the start of a sentence, so a
   *             capitalised term is lowered only when the source writes it in lower case somewhere, or
   *             when it is a phrase in sentence case ("Waiting time") that only ever opens a sentence.
   *   inNumber  the term in the asked-for number, if the source uses that form ("latch" -> "latches").
   */
  function textForms(sourceText) {
    const text = String(sourceText || '').replace(/\*\*|__/g, '');
    const occurs = (form) => new RegExp(`(?:^|[^A-Za-z])${escapeRe(form)}(?![A-Za-z])`).test(text);
    const runningCache = new Map();

    function running(term) {
      const t = String(term || '').trim();
      if (!t || !/^[A-Z]/.test(t)) return t || null;
      if (!runningCache.has(t)) {
        const firstLowered = t[0].toLowerCase() + t.slice(1);
        let form = [firstLowered, t.toLowerCase()].find(occurs) || null;
        const sentenceCase = / /.test(t) && !/[A-Z]/.test(t.slice(1));
        if (!form && sentenceCase) {
          const midSentence = new RegExp(`[a-z,;]\\s+${escapeRe(t)}(?![A-Za-z])`).test(text);
          if (!midSentence) form = firstLowered;
        }
        runningCache.set(t, form);
      }
      return runningCache.get(t);
    }

    function inNumber(term, plural) {
      const t = String(term || '').trim();
      if (isPlural(t) === plural) return t;
      const last = t.split(' ').pop();
      const other = plural
        ? [`${last}s`, `${last}es`, last.replace(/y$/, 'ies')]
        : [last.replace(/ies$/, 'y'), last.replace(/es$/, ''), last.replace(/s$/, '')];
      const head = t.slice(0, t.length - last.length);
      const found = other.filter((form) => form !== last).map((form) => `${head}${form}`).find((form) => occurs(form) || occurs(form.toLowerCase()));
      return found && isPlural(found) === plural ? found : null;
    }

    return { running, inNumber };
  }

  /**
   * The slot a term fills in a sentence. An option set never mixes classes:
   *   'adjective'  "reflexive", "functionally dependent"
   *   'noun'       a phrase, a capitalised name, or a single word with a noun ending ("scheduler")
   *   'unvouched'  a single lower-case word the shape rules cannot place ("ready", "latch"); such
   *                words only face each other, so a state name never sits among noun phrases
   */
  function wordClass(term) {
    const t = String(term || '').trim();
    if (shape().isAdjectival(t)) return 'adjective';
    if (/\s/.test(t) || hasFixedCase(t)) return 'noun';
    // Judged in lower case, so "Ready" on a card front and "ready" in a sentence are one class.
    return gate().isNounPhrase(t[0].toLowerCase() + t.slice(1)) ? 'noun' : 'unvouched';
  }

  /** The option that is far longer than every other one, or null. */
  function lengthOutlier(options) {
    if (options.length < 3) return null;
    const sorted = [...options].sort((a, b) => b.length - a.length);
    const [longest, second] = sorted;
    return longest.length >= second.length * LENGTH_RATIO && longest.length - second.length >= LENGTH_MARGIN ? longest : null;
  }

  /** Takes candidates in order while the set stays free of a length outlier; null below `min` distractors. */
  function pickBalanced(answer, candidates, count, min) {
    const pool = [...candidates];
    let picked = pool.splice(0, count);
    for (let guard = 0; guard < 12; guard++) {
      const outlier = lengthOutlier([answer, ...picked]);
      if (!outlier) break;
      if (outlier !== answer) {
        picked = picked.filter((p) => p !== outlier);
        if (pool.length) picked.push(pool.shift());
        continue;
      }
      // The answer is the long one: swap the shortest distractor for the longest candidate left.
      const shortest = picked.reduce((a, b) => (a.length <= b.length ? a : b));
      const longer = pool.filter((p) => p.length > shortest.length).sort((a, b) => b.length - a.length)[0];
      if (!longer) return null;
      pool.splice(pool.indexOf(longer), 1);
      picked = [...picked.filter((p) => p !== shortest), longer];
    }
    if (lengthOutlier([answer, ...picked]) || picked.length < min) return null;
    return picked;
  }

  /**
   * ctx: { stem, position: 'start' | 'inside' | 'list', number: 'singular' | 'plural' | null,
   *        forms: textForms(sourceText), count = 3, min = 2 }
   * -> { answer, distractors } with every option in its final spelling, or null.
   */
  function termSet(answer, candidates, ctx = {}) {
    const { stem: stemText = '', position = 'list', number = null, forms = null, count = 3, min = 2 } = ctx;
    const target = String(answer || '').trim();
    if (!target) return null;
    const plural = number ? number === 'plural' : isPlural(target);
    if (isPlural(target) !== plural) return null;
    const inNumber = (term) => (forms ? forms.inNumber(term, plural) : isPlural(term) === plural ? term : null);
    const running = (term) => (forms ? forms.running(term) : null);

    // A word of the answer that the stem repeats is only harmless when every option repeats it.
    const stemWords = new Set(words(mt().mask(stemText).text).map(stem));
    const repeated = words(target).map(stem).filter((w) => w.length >= 3 && stemWords.has(w));
    const seen = new Set([termKey(target)]);
    const targetClass = wordClass(target);
    // "Squeeze Theorem", "Chain Rule": a named result reads differently in a sentence ("the ... states
    // that") than a plain term, so it is only ever offered beside other named results.
    const isNamedResult = (term) => gate().getShapeBucket(term) === 'DIDACTIC';
    const targetIsNamedResult = isNamedResult(target);
    const fitting = [];
    for (const raw of candidates) {
      const cand = inNumber(String(raw || '').trim());
      const key = cand ? termKey(cand) : '';
      if (!key || seen.has(key)) continue;
      if (key.includes(termKey(target)) || termKey(target).includes(key)) continue; // "limit" beside "one-sided limit"
      if (mt().hasMathToken(cand) !== mt().hasMathToken(target)) continue;
      if (!gate().shapeFits(target, cand) || wordClass(cand) !== targetClass) continue;
      if (isNamedResult(cand) !== targetIsNamedResult) continue;
      const candWords = words(cand).map(stem);
      if (repeated.some((w) => !candWords.includes(w))) continue;
      if (stemWords.has(stem(lastWord(cand))) && !repeated.includes(stem(lastWord(cand)))) continue; // its head word is in the stem
      seen.add(key);
      fitting.push(cand);
    }
    const picked = pickBalanced(target, fitting, count, min);
    if (!picked) return null;

    // One leading case for the set. A capitalised term the source never lowers keeps its capital, and
    // then every option is capitalised so that it does not stand out. Otherwise the blank's position
    // decides: sentence case at the start of a statement or in a list, running case inside one.
    // An acronym-led term ("ATP synthase") is left alone and decides nothing.
    const all = [target, ...picked];
    const keepsCapital = (o) => /^[A-Z]/.test(o) && !hasFixedCase(o) && !running(o);
    const capitalise = position !== 'inside' || all.some(keepsCapital);
    const recase = (o) => {
      if (hasFixedCase(o)) return o;
      return capitalise ? upperFirst(o) : running(o);
    };
    return { answer: recase(target), distractors: picked.map(recase) };
  }

  /** Sentence case and one final period, without touching a formula at either end. */
  function tidyStatement(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim().replace(/[;:,]+$/, '');
    const capped = upperFirst(s);
    return /[.!?]["')\]]?$|[.!?]\$$/.test(capped) ? capped : `${capped}.`;
  }

  /**
   * Statement options ("Which statement describes X?"): distractors of the same math/prose kind and of
   * comparable length. opts: { count = 3, min = 2 } -> { answer, distractors } or null.
   */
  function statementSet(answer, candidates, opts = {}) {
    const { count = 3, min = 2 } = opts;
    const target = tidyStatement(answer);
    const key = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const seen = new Set([key(target)]);
    const hasMath = mt().hasMathToken(target);
    const fitting = [];
    for (const raw of candidates) {
      const cand = tidyStatement(raw);
      const k = key(cand);
      if (!k || seen.has(k) || k.includes(key(target)) || key(target).includes(k)) continue;
      // Two distractors where one contains the other ("Spread by droplets" / "Spread by droplets: Targets
      // many organs") are one claim offered twice.
      if (fitting.some((f) => key(f).includes(k) || k.includes(key(f)))) continue;
      if (mt().hasMathToken(cand) !== hasMath || !mt().isBalanced(cand)) continue;
      if (cand.length < target.length * 0.5 || cand.length > target.length * 2) continue;
      seen.add(k);
      fitting.push(cand);
    }
    const picked = pickBalanced(target, fitting, count, min);
    return picked ? { answer: target, distractors: picked } : null;
  }

  /** "a ________" / "An ________" -> "a(n) ________" / "A(n) ________". */
  function neutralArticle(blanked) {
    return String(blanked || '').replace(/\b([Aa])n?(\s+_{4,})/g, '$1(n)$2');
  }

  const api = { termSet, statementSet, neutralArticle, textForms, isPlural, hasFixedCase, lengthOutlier, lemma, stem, termKey, tidyStatement };
  PDFStudy.optionSets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

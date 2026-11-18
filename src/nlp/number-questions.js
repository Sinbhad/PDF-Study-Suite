/**
 * Number Questions: a fact, or a line of a labelled card, that commits to one quantity ("Survives 4-6 weeks in water")
 * asked as a choice of values:
 *   Which value completes this statement about "Strangles"?
 *   "Survives ________ in water"                      4-6 weeks | 1-3 days ... (the same unit only) | 2 weeks | 9-18 weeks
 * The wrong values are other quantities the same scope prints, in the same unit and of the same order of magnitude,
 * none overlapping the answer's range, and none printed in another line about the asked subject that speaks of the
 * same thing (shares a word with the asked line: there it could be true as well). Fewer than three such values and
 * the fact is not asked this way.
 *   candidates(scope, { seed }) -> [question]
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const shuffle = (...a) => dep('stemDistractors', './stem-distractors.js').deterministicShuffle(...a);
  const altered = () => dep('alteredStatements', './altered-statements.js');
  const qf = () => dep('quizFacts', './quiz-facts.js');

  const MIN_DISTRACTORS = 3;
  const MAX_RATIO = 5; // a value more than five times larger or smaller than the answer is easy to rule out
  const MIN_PERCENT_GAP = 10; // percentages this close are a matter of rounding, not a different fact
  const MIN_SHARE_APART = 0.25;
  const BLANK = '________';
  // "weeks", "wk", "week" are one unit; a dose per kg is not a mass.
  const UNIT_KEYS = [
    [/^(?:s|secs?|seconds?)$/, 'second'], [/^(?:mins?|minutes?)$/, 'minute'], [/^(?:h|hrs?|hours?)$/, 'hour'],
    [/^days?$/, 'day'], [/^(?:wks?|weeks?)$/, 'week'], [/^months?$/, 'month'], [/^(?:yrs?|years?)$/, 'year'],
  ];

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
  const unitKey = (u) => {
    const low = String(u || '').toLowerCase();
    const hit = UNIT_KEYS.find(([re]) => re.test(low));
    return hit ? hit[1] : low;
  };
  const middle = (q) => (q.hi === null ? q.lo : (q.lo + q.hi) / 2);
  const top = (q) => (q.hi === null ? q.lo : q.hi);
  const overlapping = (a, b) => a.lo <= top(b) && b.lo <= top(a);

  /** May `b` stand as a wrong value beside the answer `a`? */
  function fair(a, b) {
    if (unitKey(a.unit) !== unitKey(b.unit) || overlapping(a, b) || norm(a.text) === norm(b.text)) return false;
    // One shape for every option: a range among single values, or the one "~", stands out as the key.
    if ((a.hi === null) !== (b.hi === null) || (a.prefix || '') !== (b.prefix || '')) return false;
    // The distance between the nearest ends of the two values: "48%" beside "50-90%" is too near to call wrong.
    const gap = b.lo > top(a) ? b.lo - top(a) : a.lo - top(b);
    if (unitKey(a.unit) === '%') return gap >= MIN_PERCENT_GAP;
    const ratio = middle(a) && middle(b) ? middle(a) / middle(b) : 0;
    // ("~6 weeks" beside "5 weeks" is a matter of how one rounds, not a different fact.)
    const apart = gap / Math.max(top(a), top(b)) >= MIN_SHARE_APART;
    return apart && ratio > 0 && ratio <= MAX_RATIO && ratio >= 1 / MAX_RATIO;
  }

  /**
   * The lines that may be asked: the scope's facts, and each line of a labelled card ("Horse-to-horse spread" over
   * "Survives 4-6 weeks in water"), with the subject or heading a stem names and the key a flag is stored under.
   */
  function lines(scope) {
    const out = [];
    for (const f of scope.facts || []) {
      if (f.kind === 'qa' || !f.subject) continue;
      out.push({ text: f.statement, about: `this statement about "${f.subject}"`, group: f.subjectKey, subject: f.subject,
        explanation: `${f.subject}${f.context ? ` (${f.context})` : ''}: ${f.statement}`, source: f.source || `${f.term}: ${f.statement}`,
        factKey: f.identity, category: f.category, page: f.page || null });
    }
    for (const c of scope.allCards || []) {
      if (!c || c.rule || c.table || !/^(?:label|list)$/.test(c.sourceKind || '')) continue;
      const back = String(c.back || '');
      const front = String(c.front || '').trim();
      const source = `${front}: ${back.replace(/\s*\n\s*/g, ' ')}`;
      for (const raw of back.split('\n')) {
        const text = raw.replace(/^•\s*/, '').trim();
        // A list card's front is its own question ("What are the key points of ...?"): the subject names the line.
        const about = /\?$/.test(front) ? `this line about "${c.subject || c.topic}"` : `this line under "${front}"`;
        if (text) out.push({ text, about, group: norm(c.subject || front), subject: c.subject || front,
          explanation: `${front}: ${text}`, source, factKey: `n|${norm(source)}`, category: c.category, page: c.pageNumber || c.page || null });
      }
    }
    return out;
  }

  function candidates(scope, opts = {}) {
    const seed = opts.seed || 0;
    const pool = altered().quantities(scope.text).filter((q) => (q.lo > 0 || q.unit === '%') && !(q.unit === '%' && q.hi === null && (q.lo === 100 || q.lo === 0)));
    const items = lines(scope);
    // What the scope says about each subject: a value printed in a line of it that speaks of the same thing
    // ("Survives 4-6 weeks in water" / "Survives 1-3 days on fencing") may be true of the asked line as well.
    const linesOf = new Map();
    for (const it of items) linesOf.set(it.group, [...(linesOf.get(it.group) || []), it.text]);
    const out = [];
    const asked = new Set();
    for (const it of items) {
      const q = altered().soleQuantity(it.text);
      // ("This is still not 100%, but ..." is a figure of speech, not a value to learn.)
      if (!q || asked.has(norm(it.text)) || (q.unit === '%' && (q.lo === 100 || q.lo === 0) && q.hi === null)) continue;
      asked.add(norm(it.text));
      const own = new Set(qf().contentStems(it.text.replace(q.text, ' ')));
      const said = norm((linesOf.get(it.group) || []).filter((s) => s !== it.text && qf().contentStems(s).some((w) => own.has(w))).join(' '));
      const values = [...new Map(pool.filter((p) => fair(q, p) && !said.includes(norm(p.text))).map((p) => [norm(p.text), p.text])).values()];
      if (values.length < MIN_DISTRACTORS) continue;
      const answer = q.text;
      const blanked = `${it.text.slice(0, q.index)}${BLANK}${it.text.slice(q.index + q.text.length)}`;
      const question = `Which value completes ${it.about}?\n"${blanked}"`;
      const wrong = shuffle(values, it.text, seed).slice(0, MIN_DISTRACTORS);
      out.push({
        type: 'multiple_choice', badge: 'Multiple Choice • Number', question,
        options: shuffle([answer, ...wrong], question, seed), answer, explanation: it.explanation,
        skill: 'definition', category: it.category, subject: it.subject, source: it.source,
        factKey: it.factKey, page: it.page, pageNumber: it.page,
      });
    }
    return out;
  }

  const api = { candidates, fair };
  PDFStudy.numberQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

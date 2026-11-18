/**
 * Typed Shape: what every typed question (typed-questions.js, typed-values.js) carries, and the names around its
 * answer, read from the scope's text (DOM-free).
 *   make(fields)           -> { type: 'typed', badge, question, answer, accept, form, others, shown, explanation, skill,
 *                             subject, source, factKey, page, pageNumber, symbols?, checks? }
 *                             accept: other names that are right (never one the prompt prints), each name of an
 *                             answer written "A/B" or "A or B" among them; others: the scope's other terms, which are
 *                             never right (typed-check.js); checks: what checksOf found
 *   checksOf(answer, text) -> { near: real words of the scope one letter from the answer's, looseHead: the answer's head
 *                             is one the scope uses for many things (genericHead) }
 *   aliasesOf(term, text)  -> other names the text gives the term: "Address register (AR)" -> ["AR"], "the empty set, or
 *                             null set," -> ["null set"]
 *   shownAfter(after)      -> names printed right after a blank ("________ (or antecedent or premise)"): the prompt shows
 *                             them, so they are not the answer
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MAX_ALIAS_WORDS = 5;
  const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const words = (s) => String(s || '').replace(/\$[^$]*\$/g, ' M ').split(/\s+/).filter(Boolean);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** "Address register (AR)" / "AR (address register)" / "the empty set, or null set," -> the other name(s). */
  function aliasesOf(term, text) {
    const t = escapeRe(String(term).trim());
    const body = String(text || '').replace(/\*\*|__/g, '');
    const out = new Set();
    const addOne = (a) => {
      if (!a || words(a).length > MAX_ALIAS_WORDS || /\d{2,}|[=<>$]/.test(a) || !/[A-Za-z]{2}/.test(a)) return;
      if (/^(?:see|e\.g\.|for|as|in|on|p\.|fig|page|table|example)\b/i.test(a)) return;
      if (norm(a) !== norm(term)) out.add(a);
    };
    // "(or antecedent or premise)" names two.
    const add = (raw) => String(raw || '').replace(/^(?:or|also|aka|also\s+called|also\s+known\s+as|i\.e\.)\s+/i, '')
      .split(/\s*,\s*|\s+or\s+/).map((s) => s.trim()).forEach(addOne);
    for (const m of body.matchAll(new RegExp(`(?<![A-Za-z])${t}s?\\s*\\(([^()]{2,40})\\)`, 'gi'))) add(m[1]);
    for (const m of body.matchAll(new RegExp(`(?<![A-Za-z])([A-Za-z][A-Za-z -]{1,40}?)\\s*\\(${t}s?\\)`, 'gi'))) {
      // "... the address register (AR)": the expansion is the capitalised or acronym-led run right before the bracket.
      const tail = m[1].trim().split(/\s+/).slice(-words(term).length - 2).join(' ');
      if (/^[A-Z0-9]{2,6}s?$/.test(String(term).trim())) {
        const initials = String(term).replace(/s$/, '').toLowerCase();
        const run = tail.split(/\s+/);
        for (let k = run.length - 1; k >= 0; k--) {
          const phrase = run.slice(k);
          if (phrase.map((w) => w[0].toLowerCase()).join('') === initials) add(phrase.join(' '));
        }
      }
    }
    for (const m of body.matchAll(new RegExp(`(?<![A-Za-z])${t}s?,\\s+(?:or|also\\s+called|also\\s+known\\s+as)\\s+(?:the\\s+|an?\\s+)?([A-Za-z][A-Za-z -]{1,40}?)\\s*[,.;]`, 'gi'))) add(m[1]);
    return [...out];
  }

  /** "A/B", "A or B" as the answer itself: the source gives both names, so each is right. */
  const alternativesOf = (answer) => {
    const parts = String(answer || '').split(/\s*\/\s*|\s+or\s+/i).map((s) => s.trim()).filter(Boolean);
    return parts.length > 1 ? parts : [];
  };

  /** The shared fields; `answer` is the term as the scope writes it, `others` the scope's other terms. */
  function make(fields) {
    const page = fields.page || null;
    // A name the prompt already prints is not taken as the answer (typed-check.js says so to the student).
    const shownKeys = new Set((fields.shown || []).map(norm));
    const form = fields.form || 'term';
    const accept = [...(fields.accept || []), ...(form === 'term' ? alternativesOf(fields.answer) : [])];
    const checks = fields.checks && (fields.checks.looseHead || (fields.checks.near || []).length) ? fields.checks : null;
    return {
      type: 'typed', badge: fields.badge || 'Type the Answer', form, options: [],
      question: fields.question, answer: fields.answer, accept: accept.filter((a, i) => !shownKeys.has(norm(a)) && accept.findIndex((b) => norm(b) === norm(a)) === i),
      others: (fields.others || []).filter((o) => norm(o) !== norm(fields.answer) && !accept.some((a) => norm(a) === norm(o))),
      shown: fields.shown || [], explanation: fields.explanation, skill: fields.skill || 'definition',
      subject: fields.subject || '', source: fields.source, factKey: fields.factKey, page, pageNumber: page,
      ...(fields.symbols ? { symbols: fields.symbols } : {}),
      ...(checks ? { checks } : {}),
    };
  }

  const terms = () => PDFStudy.typedTerms || (typeof require === 'function' ? require('./typed-terms.js') : null);
  const forms = () => PDFStudy.typedForms || (typeof require === 'function' ? require('./typed-forms.js') : null);
  const MIN_SLIP_WORD = 6;
  const GENERIC_HEAD_USES = 3;

  /**
   * The head noun of a term of two or more words when the scope uses it for other things too ("error" in a section
   * that speaks of compile errors, logic errors and bounds errors): '' when it does not. Such a head is a category a
   * student may name otherwise or leave out.
   */
  function genericHead(term, text) {
    const w = String(term || '').toLowerCase().split(/[\s-]+/).filter(Boolean);
    const head = w[w.length - 1] || '';
    if (w.length < 2 || !/^[a-z]{4,}$/.test(head)) return '';
    const own = w[w.length - 2];
    const headRe = /y$/.test(head) ? `${escapeRe(head.slice(0, -1))}(?:y|ies)` : `${escapeRe(head)}(?:s|es)?`;
    const re = new RegExp(`(?:([a-z]+)[\\s-]+)?(?<![a-z])${headRe}(?![a-z])`, 'gi');
    let uses = 0;
    for (const m of String(text || '').matchAll(re)) if (!m[1] || m[1].toLowerCase() !== own) uses++;
    return uses >= GENERIC_HEAD_USES ? head : '';
  }

  /** Real words of the scope one letter from a long word of the answer ("ration" beside "station"): never a slip. */
  function nearWords(answer, text) {
    const long = String(answer || '').toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= MIN_SLIP_WORD);
    if (!long.length) return [];
    const vocab = new Set(String(text || '').toLowerCase().match(/[a-z]{5,}/g) || []);
    const out = [];
    for (const v of vocab) {
      if (long.some((a) => !forms().meet(a, v) && terms().editDistance(a, v) === 1)) out.push(v);
    }
    return out;
  }

  /** What the checker needs beyond the answer: { near, looseHead } (typed-terms.js). */
  function checksOf(answer, text) {
    return { near: nearWords(answer, text), looseHead: Boolean(genericHead(answer, text)) };
  }

  /** Names a parenthesis right after the blank prints ("________ (or antecedent or premise)"): shown, so not the answer. */
  function shownAfter(after) {
    const m = String(after).match(/^\s*\((?:or|also|aka|i\.e\.)\s+([^()]{2,60})\)|^\s*,?\s+or\s+([a-z][a-z -]{2,40}?)(?=[,.;)]|\s+(?:and|is|are)\b|$)/i);
    const list = m ? (m[1] || m[2]) : '';
    return list ? list.split(/\s*(?:,|\bor\b)\s*/).map((s) => s.trim()).filter(Boolean) : [];
  }

  const api = { make, aliasesOf, shownAfter, genericHead, nearWords, checksOf };
  PDFStudy.typedShape = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

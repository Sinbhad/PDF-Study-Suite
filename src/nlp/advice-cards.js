/**
 * Advice Cards: a textbook's margin note that tells the reader what to do ("Use the expression array.length to
 * find the number of elements in an array.", "When separating elements, don't place a separator before the first
 * element.", "Do not use == to compare strings. Use the equals method instead.") as a card that asks for the
 * advice by its purpose or situation. key-statements.js splits statements at their verb; an instruction has no
 * subject to split at, so it is read by its shape here. Pure and DOM-free.
 *   cardsOfNote(text, fallback) -> [{ front, back, form }]: one card per piece of advice in a note; a sentence no
 *     form below fits is handed to fallback(sentence) (form 'completion')
 *   fromNote(text) -> { front, back, form } | null: the note's first card
 *     form 'situation'  "To / When / Before / After / If / With <situation>, <advice>." -> "<situation>, …" => advice
 *     form 'purpose'    "Use <tool> to <purpose>."                -> "To <purpose>, …" => "use <tool>"
 *     form 'condition'  "Use <tool> if / when <condition>."       -> "When should you use <tool>?" => "If <condition>"
 *     form 'avoid'      "Avoid <thing> by <means>."               -> "How do you avoid <thing>?" => "By <means>"
 *     form 'instead'    "Do not use <wrong> to <purpose>. Use <right> instead."
 *                                                                 -> "To <purpose>, …" => "use <right>, not <wrong>"
 *     form 'statement'  "A linear search inspects elements ..."  -> "A linear search inspects …" => the rest
 *   A sentence that follows the advice and continues it ("Instead, check whether they are close enough.") joins
 *   the answer. Anything else (a question, a sentence that leans on the page, one longer than MAX_WORDS) is null.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MAX_WORDS = 32;
  const MIN_PART_WORDS = 2;
  const SITUATION_RE = /^((?:To|When|Whenever|Before|After|If|With|Once|Unless)\s+[^,]{3,90}),\s+(.+)$/;
  const PURPOSE_RE = /^Use\s+(.{3,70}?)\s+to\s+([a-z].{3,90})$/;
  const CONDITION_RE = /^Use\s+(.{3,70}?)\s+(if|when|whenever)\s+(.{3,90})$/;
  // A gerund task clause after "when" ("when swapping two elements") names the goal, so ask for the tool.
  const GERUND_TASK_RE = /^(?!string\b|thing\b|ring\b|king\b|spring\b|wing\b|nothing\b|something\b|anything\b|everything\b)[a-z]{3,}ing\s+\S/i;
  const AVOID_RE = /^Avoid\s+(.{3,60}?)\s+by\s+(.{3,90})$/;
  const INSTEAD_RE = /^(?:Do\s+not|Don['’]t|Never)\s+use\s+(.{2,60}?)\s+to\s+(.{3,80}?)\.\s+(?:Instead,\s+)?(?:Use|use)\s+(.{2,60}?)(?:\s+instead)?\.?$/;
  // "Instead, check whether ...", "Otherwise, ...": a sentence that only continues the advice before it.
  const CONTINUES_RE = /^(?:Instead|Otherwise|Then)\b,?\s+/;
  // "A linear search inspects ...": an article, at most four words of subject, then a verb in -s.
  // (The subject is matched lazily: the verb is the first word in -s after it.)
  const STATEMENT_RE = /^((?:An?|The)\s+(?:[A-Za-z$=][\w$=-]*\s+){0,3}?[a-z][\w-]*)\s+((?!is\b|has\b|was\b|does\b)[a-z]{3,}s)\s+(.+)$/;
  const NOT_A_VERB_RE = /(?:ss|us|is|ics|ous)$/;
  // The note speaks about the page ("this paragraph", "read on") or the reader's feelings: nothing to recall.
  const LEANS_RE = /\b(?:this|that|these|those|above|below|following|preceding)\s+(?:paragraph|section|chapter|figure|table|example|page|code)\b|\bmight\s+have\s+trouble\b|\byou\s+might\b/i;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const words = (s) => plain(s).split(/\s+/).filter(Boolean);
  const strip = (s) => plain(s).replace(/[.!]+$/, '');
  const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
  const cap = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);

  /**
   * The note's sentences, short ones included ("Use a builder instead." completes the advice before it; a general
   * sentence splitter drops it as too short). A note is one to three sentences: a full stop before a capital ends one.
   */
  function sentencesOf(text) {
    return plain(text).split(/(?<=[a-z0-9)$”"'’][.!?])\s+(?=[A-Z$“"])/).map(plain).filter(Boolean);
  }

  function shaped(front, back, form) {
    if (words(front).length < MIN_PART_WORDS || words(back).length < MIN_PART_WORDS) return null;
    return { front, back: strip(back), form };
  }

  function fromSentence(s, next) {
    const t = strip(s);
    if (/\?$/.test(plain(s)) || LEANS_RE.test(t) || words(t).length > MAX_WORDS) return null;
    const tail = next && CONTINUES_RE.test(next) ? ` ${lower(strip(next))}` : '';
    let m = t.match(PURPOSE_RE);
    if (m) return shaped(`To ${m[2]}, …`, `use ${m[1]}${tail ? `;${tail}` : ''}`, 'purpose');
    m = t.match(CONDITION_RE);
    if (m) {
      if (/^when/i.test(m[2]) && GERUND_TASK_RE.test(m[3])) {
        return shaped(`What should you use ${m[2]} ${m[3]}?`, `Use ${m[1]}${tail ? `;${tail}` : ''}`, 'condition');
      }
      return shaped(`When should you use ${m[1]}?`, `${cap(m[2])} ${m[3]}`, 'condition');
    }
    m = t.match(AVOID_RE);
    if (m) return shaped(`How do you avoid ${m[1]}?`, `By ${m[2]}`, 'avoid');
    m = t.match(SITUATION_RE);
    // "To print five elements, you need four separators." / "When comparing ..., don't test for equality."
    if (m && !/\b(?:it|they|this|these)\b/i.test(m[1])) return shaped(`${m[1]}, …`, `${m[2]}${tail ? `;${tail}` : ''}`, 'situation');
    return null;
  }

  /** "An array collects a sequence of ...": a statement split after its verb, for notes key-statements.js cannot split. */
  function statement(s) {
    const t = strip(s);
    if (/\?$/.test(plain(s)) || LEANS_RE.test(t) || words(t).length > MAX_WORDS) return null;
    const m = t.match(STATEMENT_RE);
    return m && !NOT_A_VERB_RE.test(m[2]) && !/,/.test(m[1]) ? shaped(`${m[1]} ${m[2]} …`, m[3], 'statement') : null;
  }

  /** "Do not use X to Y. Use Z instead." is one piece of advice in two sentences. */
  function insteadPair(a, b) {
    const m = b ? `${strip(a)}. ${strip(b)}`.match(INSTEAD_RE) : null;
    return m ? shaped(`To ${m[2]}, …`, `use ${m[3]}, not ${m[1]}`, 'instead') : null;
  }

  /**
   * Every card a note gives, sentence by sentence: advice by its shape first; a sentence no advice shape fits
   * goes to `fallback(sentence)` (key-statements.js completion), which returns a card or null.
   */
  function cardsOfNote(text, fallback) {
    const list = sentencesOf(text);
    const out = [];
    for (let i = 0; i < list.length;) {
      const pair = insteadPair(list[i], list[i + 1]);
      if (pair) {
        out.push(pair);
        i += 2;
        continue;
      }
      const advice = fromSentence(list[i], list[i + 1]);
      if (advice) {
        out.push(advice);
        i += list[i + 1] && CONTINUES_RE.test(list[i + 1]) && (advice.form === 'situation' || advice.form === 'purpose') ? 2 : 1;
        continue;
      }
      // A sentence that only continues an advice nothing took ("Instead, ...") makes no card alone
      if (!CONTINUES_RE.test(list[i])) {
        const own = fallback ? fallback(list[i]) : null;
        const card = own ? { ...own, form: 'completion' } : statement(list[i]);
        if (card) out.push(card);
      }
      i++;
    }
    return out;
  }

  const fromNote = (text) => cardsOfNote(text, null)[0] || null;

  const api = { fromNote, cardsOfNote };
  PDFStudy.adviceCards = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

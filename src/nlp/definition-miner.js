/**
 * Definition Miner: finds the term a statement defines and the statement's head/tail split.
 *   "Def: A relation R on a set A is called reflexive if xRx for every x"  -> term "reflexive"
 *   "The domain of R is defined as {a | ...}"                              -> term "domain of R"
 *   "Def: An n-ary relation on these sets is a subset of ..."              -> term "n-ary relation"
 * mine(text, { strong }) -> [{ term, definition, sentence, head, tail, family }]
 *   definition = "Let ..." preamble + the defining sentence (never a clipped half sentence);
 *   head/tail  = sentence-completion split ("... is called reflexive if" | "xRx for every x"),
 *   family     = 'if' | 'as' | 'isa' so quiz options only mix tails of the same grammatical kind.
 * Math spans ($...$) are masked while matching, so a term or a split never lands inside a formula.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');

  const LEAD_RE = /^(?:Def(?:inition|n)?\.?\s*(?:\d+(?:\.\d+)*)?\s*[:.—–-]\s*)/i;
  const WORD = "[A-Za-z][A-Za-z'’-]*";
  const CALLED_RE = new RegExp(
    `\\b(?:is|are|be)\\s+(?:also\\s+|often\\s+|sometimes\\s+|then\\s+|usually\\s+)?(?:called|said\\s+to\\s+be|known\\s+as|referred\\s+to\\s+as|termed)\\s+` +
    `(?:an?\\s+|the\\s+|its\\s+)?(${WORD}(?:\\s+${WORD}){0,3}?)` +
    `(?=\\s+(?:if|when|whenever|provided|because|since|of|for|with|in|on|at|and|or|iff|that|which)\\b|\\s*[.,;:(]|\\s*$)`, 'g');
  const DEFINED_RE = new RegExp(
    `^(?:The\\s+|An?\\s+)?(${WORD}(?:\\s+${WORD}){0,3}?(?:\\s+of\\s+(?:\\S{1,14}|an?\\s+[a-z]+(?:\\s+[a-z]+)?))?)\\s+` +
    `(?:(?:is|are)\\s+[^.;]{0,90}?\\band\\s+)?((?:is|are|can\\s+be)\\s+(?:defined\\s+(?:as|to\\s+be|by)|given\\s+by))\\s+(\\S.*)$`);
  const ISA_STOP_RE = /^(?:is|are|on|from|of|in|to|with|that|which|defined|for|at|by|between|over)$/i;
  const COND_RE = /^\s+(if\s+and\s+only\s+if|if|when|whenever|provided\s+that|iff)\s+(\S.*)$/i;
  const BAD_TERM_RE = /^(?:it|this|that|these|those|they|them|such|here|there|one|so|not|what|which|following|above|below|same|example|examples)$/i;

  const stripLead = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim().replace(LEAD_RE, '');
  const cap = (s) => (s && !/^[a-z]-/.test(s) ? s[0].toUpperCase() + s.slice(1) : s); // "n-ary" stays lowercase
  const noDot = (s) => String(s || '').trim().replace(/[.;,:]+$/, '');

  /** Sentence split that never cuts inside a math span or after a single-letter variable list. */
  function sentences(text) {
    const { text: masked, spans } = mt().mask(String(text || ''));
    return masked
      .replace(/⟦M(\d+)⟧/g, (m, i) => (/[.!?]\$\$?$/.test(spans[+i] || '') ? `${m}‥` : m)) // "... form $0/0.$ An ..."
      .split(/(?<=[a-z0-9)\]}⟧][.!?]|‥)\s+(?=[A-Z⟦])/)
      .map((p) => mt().unmask(p.replace(/‥/g, ''), spans).trim())
      .filter(Boolean);
  }

  function goodTerm(term) {
    const t = String(term || '').trim();
    if (t.length < 3 || t.length > 48 || BAD_TERM_RE.test(t.split(/\s+/)[0])) return false;
    if (/⟦/.test(t) || /\b[a-z]+[A-Z]/.test(t)) return false; // masked math, "xRy"
    const words = t.split(/\s+/);
    if (words.every((w) => w.length <= 2)) return false;
    return !/^(?:a|an|the|of|to|and|or|if|is|are)$/i.test(words[words.length - 1]);
  }

  /** All definitional readings of one sentence (already stripped of "Def:" and bold markers). */
  function mineSentence(sentence, strong) {
    const { text: s, spans } = mt().mask(sentence);
    const un = (x) => mt().unmask(x, spans);
    const out = [];
    const push = (term, head, tail, family) => {
      if (!goodTerm(term)) return;
      // "The slope of the tangent line ... is also called the slope of ...": the subject already uses the word.
      if (!family || family === 'if') {
        const before = s.slice(0, s.search(/\b(?:called|known\s+as|said\s+to\s+be|referred\s+to\s+as|termed)\b/));
        if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(before)) return;
      }
      out.push({ term: un(term).trim(), sentence, head: head ? un(head).trim() : '', tail: tail ? noDot(un(tail)) : '', family });
    };
    const d = s.match(DEFINED_RE);
    if (d) push(d[1], s.slice(0, s.length - d[3].length), d[3], 'as');
    if (!out.length) {
      for (const m of s.matchAll(CALLED_RE)) {
        const end = m.index + m[0].length;
        const cond = s.slice(end).match(COND_RE);
        push(m[1], cond ? `${s.slice(0, end)} ${cond[1]}` : '', cond ? cond[2] : '', cond ? 'if' : '');
      }
    }
    if (!out.length && strong) {
      const a = s.match(/^(?:An?|The)\s+(.+)$/);
      const toks = a ? a[1].split(/\s+/) : [];
      const words = [];
      for (const w of toks) {
        if (ISA_STOP_RE.test(w) || /^[A-Z]$|^[^A-Za-z]/.test(w) || words.length >= 4) break;
        words.push(w);
      }
      const rest = a ? a[1].split(/\s+/).slice(words.length).join(' ') : '';
      const isa = rest.match(/^(.*?\b(?:is|are))\s+((?:an?|the|any|every)\s+\S.*)$/);
      if (words.length && isa && isa[1].length <= 60) {
        push(words.join(' ').toLowerCase() === words.join(' ') ? words.join(' ') : words.join(' ').toLowerCase(),
          s.slice(0, s.length - isa[2].length), isa[2], 'isa');
      }
    }
    return out;
  }

  /**
   * Mine one bullet / paragraph. `strong` (set automatically by a "Def:" lead-in) also accepts the plain
   * "A <term> ... is a ..." copula, which is far too loose for ordinary prose.
   */
  function mine(text, opts = {}) {
    const raw = String(text || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
    const strong = opts.strong || LEAD_RE.test(raw);
    const parts = sentences(stripLead(raw));
    const out = [];
    let preamble = [];
    for (const sent of parts) {
      if (/^(?:Let|Suppose|Assume|Given)\b/.test(sent) && !/\bcalled\b|\bdefined\s+as\b/.test(sent)) { preamble.push(sent); continue; }
      if (/\?\s*$/.test(sent)) { preamble = []; continue; }
      const found = mineSentence(sent, strong && out.length === 0);
      const lead = preamble.join(' ');
      for (const f of found) {
        const body = /[.!?]\$?\$?$|[}\])]$/.test(f.sentence) ? f.sentence : `${f.sentence}.`;
        out.push({ ...f, term: cap(f.term), definition: lead ? `${lead} ${body}` : body });
      }
      if (found.length) preamble = [];
    }
    return out;
  }

  /** Lemma key shared by cards, key terms and summary definitions ("Equivalence Classes" == "equivalence class"). */
  function termKey(term) {
    const bt = dep('boldTerms', './bold-terms.js');
    const t = String(term || '').replace(/^(?:the|an?)\s+/i, '');
    return bt ? bt.termKey(t) : t.toLowerCase();
  }

  /** Mine every sentence of running (book) text; only explicit "is called / is defined as" statements count. */
  function mineText(text, splitSentences) {
    const out = [];
    const seen = new Set();
    const sn = dep('stemNoise', './stem-noise.js');
    const noFig = (s) => s.replace(/,?\s*\(?(?:as\s+)?(?:shown|illustrated|indicated)\s+in\s+Fig(?:ure|\.)\s*[\d.]+(?:\([a-z]\))?\)?/gi, '');
    const all = (splitSentences ? splitSentences(text) : sentences(text)).flatMap((s) => sentences(s.replace(/\*\*|__/g, '')));
    all.forEach((sent, i) => {
      if (!/\bcalled\b|\bdefined\s+(?:as|to\s+be)\b|\bknown\s+as\b|\bsaid\s+to\s+be\b/.test(sent)) return;
      for (const d of mine(sent)) {
        const key = termKey(d.term);
        if (seen.has(key)) continue;
        seen.add(key);
        // "Such a line is called a secant line." needs the sentence it points back to.
        const prev = sn && sn.isDangling(sent) && i > 0 && all[i - 1].length <= 320 ? `${noFig(all[i - 1])} ` : '';
        out.push({ ...d, definition: `${prev}${noFig(d.definition)}` });
      }
    });
    return out;
  }

  const api = { mine, mineText, sentences, termKey, stripLead, goodTerm };
  PDFStudy.definitionMiner = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

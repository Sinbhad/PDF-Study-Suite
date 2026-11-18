/**
 * Summary statements: which sentences of a textbook section may stand alone in the Summary, how worth
 * remembering each one is, and how many the scope deserves. Domain-neutral: no subject word lists, only
 * structure (position in the paragraph, defined or emphasised terms, definitional cues, completeness).
 *   rejectReason(sentence)            -> null | 'dangling' | 'incomplete' | 'question' | 'objective' | 'code' |
 *                                        'callout' | 'glued' | 'identifier' | 'math' | 'garbled' | 'mangled' |
 *                                        'meta' | 'setup' | 'aside' | 'length'
 *   isMangled(text, { slide? })       -> true when extraction damaged the text (also used for slide lines)
 *   mathDamage(text)                  -> null | 'operator' | 'complement': notation known to be damaged
 *   score(sentence, ctx)              -> number (higher is better); ctx: { indexInParagraph, terms, headingWords }
 *   budget(proseWords)                -> total key statements for the scope
 *   allocate(sizes, total)            -> statements per section (each 0..MAX_PER_SECTION)
 * DOM-free; consumes stemNoise / noiseFilter / mathText when loaded.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);

  // Length scaling: one key statement per WORDS_PER_STATEMENT words of prose, never fewer than MIN or more than MAX.
  const WORDS_PER_STATEMENT = 250;
  const MIN_STATEMENTS = 3;
  const MAX_STATEMENTS = 25;
  // A heading contributes at most this many statements: the summary is a map, not a re-print.
  const MAX_PER_SECTION = 3;
  // A standalone statement is between these word counts; shorter is a label, longer is a paragraph.
  const MIN_WORDS = 6;
  const MAX_WORDS = 55;

  // Score weights (added to a base of 1).
  const W_FIRST_IN_PARAGRAPH = 1.0; // authors put the topic sentence first
  const W_SECOND_IN_PARAGRAPH = 0.3;
  const W_TERM = 0.8; // names a term the section defines or emphasises
  const W_CUE = 0.6; // a definitional or summarising cue
  const W_COMPLETE = 0.5; // a comfortable 10-40 word statement
  const W_HEADING_WORD = 0.25; // per word shared with the heading (capped at two)
  const P_META = 0.9; // talks about the book ("in this section we will")
  const P_EXAMPLE_ASIDE = 0.4; // carries "for example" / "for instance"
  const P_NUMERIC = 0.3; // mostly numbers: an incidental value

  const CUE_RE = /\b(?:is\s+defined\s+(?:as|to\s+be)|is\s+called|are\s+called|is\s+known\s+as|means\s+that|refers\s+to|is\s+said\s+to\s+be|in\s+general|therefore|note\s+that|consists?\s+of|if\s+and\s+only\s+if|is\s+equivalent\s+to|must|always|never|whenever|depends\s+on|the\s+(?:main|key|most\s+important|basic)\b)/i;
  const META_RE = /\b(?:in\s+this\s+(?:section|chapter|book|course|text)|our\s+(?:discussion|study|goal)|we\s+will\s+now|we\s+(?:begin|now\s+turn|turn\s+(?:now\s+)?to)|we\s+(?:will|shall)\s+(?:(?:now|first|then|next|also|briefly|soon)\s+)?(?:see|study|discuss|introduce|explain|show|learn|develop|begin|consider|describe|use|review|cover|look|examine|illustrate)|you\s+will\s+(?:learn|see)|as\s+we\s+(?:saw|said|have\s+seen)|later\s+in\s+(?:this|the)\s+(?:section|chapter|book)|you\s+(?:must|should|need\s+to)\s+(?:understand|know|learn|be\s+able)|it\s+is\s+(?:vital|important|essential|crucial)\s+(?:for\s+you\s+)?to\s+(?:understand|know|learn)|(?:read|see)\s+this\s+(?:paragraph|section|page|box)(?:\s+carefully)?)\b/i;
  // A dated aside: "In 1982, ... published a paper", "Codd defined ... in his 1970 paper".
  const DATED_RE = /\b(?:1[6-9]|20)\d\d\b/;
  const P_DATED = 0.6;
  // Names from a worked example's program or schema: "CookieCost", "NumberOfBoxes", "STUDENT_ADVISOR".
  const IDENTIFIER_RE = /\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[A-Za-z]+_[A-Za-z_]+\b/;
  // A figure or table title run into the sentence after it: "Sample EMPLOYEE Columns in ...".
  const GLUED_CAPTION_RE = /^[A-Z][a-z]+\s+[A-Z]{3,}\s+[A-Z][a-z]/;
  const OBJECTIVE_RE = /^(?:■|▪|•|■)|^(?:To\s+(?:understand|learn|know|be\s+able|describe|explain|identify|use|apply|define)|After\s+(?:reading|studying|completing)|Upon\s+completion|Students\s+will|You\s+(?:should|will)\s+be\s+able)\b/i;
  // Program text: statements end in ";" or braces, or call syntax "name(args);".
  const CODE_RE = /```|`[^`]+`|[{};]\s*$|\b[A-Za-z_]\w*\([^()]*\)\s*;|\/\/\s|^\s*(?:public|private|static|int|double|String|return|import)\b/;
  // A heading glued onto the sentence that follows it: "Foreign Keys A foreign key is ...".
  // Small words a heading may hold between its capitalised words ("Showing that A is a Subset of B").
  const GLUED_HEADING_RE = /^(?:[A-Z][\w’'-]*\s+(?:(?:and|of|the|for|in|to|with|that|is|a|an|not)\s+){0,3}){1,8}(?:A|An|The|In|For|To|We|Each|When|If|Every|Some|So|It|This|These|Here|Now|Note)\s+[a-z]/;
  // A bold display line (a formula or schema) glued in front of the sentence after it.
  // Also a bold run followed straight by a lower-case word, or a bold schema in mid-sentence before a capital.
  const GLUED_BOLD_RE = /^\*\*[^*]*[(),=][^*]*\*\*\s+\S|^\*\*[^*]+\*\*\s+[a-z]|\*\*[^*]*[(),=][^*]*\*\*\s+[A-Z]/;
  // A word split by a lost hyphenation: "char- acters", "**tab char-** **acters**".
  const BROKEN_WORD_RE = /[a-z]-(?:\*\*)?\s+(?:\*\*)?(?!(?:and|or|to|as|nor)\b)[A-Za-z]{2,}/;
  // An aside about a person ("Aristotle’s writings were ...", "Venn’s book ..."): a sidebar, not the subject.
  const PERSON_ASIDE_RE = /^[A-Z][a-z]+[’']s\s/;
  // Two sentence fragments glued at a lost line break: "a power. series".
  const GLUED_FRAGMENTS_RE = /\b(?!(?:vs|al|cf|etc|approx|resp|ie|eg)\.)[a-z]{2,}\.\s+[a-z]{2,}\b/;
  // Prose glued inside a math span by extraction ("\text{The}"): the sentence boundary is lost.
  const MATH_DEBRIS_RE = /\\text\{\s*[A-Z][a-z]+\s*\}|\\text\{[^}]*\b(?:the|and|of|is)\b[^}]*\}\s*\$?\s*[A-Za-z]/;
  // Openers that continue the previous sentence or point back at a person or a contrast just made.
  const CONTINUATION_RE = /^(?:And|But|Or|So|No|Yes|Further|The\s+other|The\s+same|In\s+our|The\s+\w+\s+also|Finally|Additionally|Also|Another|One\s+way|Other|Both|Neither|Either|Here|He|She|His|Her|Him|Instead|Otherwise|Conversely|In\s+contrast|By\s+contrast|As\s+a\s+consequence|In\s+addition|In\s+particular|In\s+fact|Before\s+continuing|First|Second|Third|Last|Later|Earlier)\b/;
  // The set-up of an example or exercise ("Suppose you want to ...", "Consider the task of ...").
  const SETUP_RE = /^(?:Suppose|Consider|Let|Imagine|Assume|Say)\b/;
  // A Title Case heading run into a sentence that goes on in lower case: "Clocked Sequential Circuit the clock ...".
  const GLUED_LOWER_HEADING_RE = /^(?:[A-Z][\w-]*\s+){3,}(?:the|a|an)\s/;
  // Share of tokens that are ordinary lower-case words; table and formula debris falls below it.
  const MIN_PROSE_SHARE = 0.5;
  // "When"/"Where" open conditions as often as questions ("When both inputs are 1, ... occurs."): only "?" makes those a question
  const QUESTION_OPENING_RE = /^(?:What|Which|Why|How|Who|Whom|Is|Are|Does|Do|Did|Can|Could|Should|Would)\s/;
  // Prose swallowed into a math span by extraction: "$Aset$", "$\text{The set}V$", "$it is in 1NF$", "$An$".
  const PROSE_IN_MATH_RE = new RegExp([
    '\\$[^$]*\\\\text\\{[^}$]*[a-z]\\s+[a-z][^}$]*\\}[^$]*\\$', // several words inside \text{}
    '\\$(?:[^$]*?[^\\\\a-zA-Z${])?[A-Za-z]?[a-z]{3,}[^$]*\\$', // a bare word of three or more letters
    '\\$[^$]*\\b[a-z]{2,}\\s+[a-z]{2,}\\b[^$]*\\$', // two short words in a row
    '\\$[A-Z][a-z]+\\$', // one capitalised word
    '\\$[^$]*[A-Z][a-z]{2,}[A-Z][a-z]{2,}[^$]*\\$', // words run together inside math: "\\frac{OperatorPrecedence}"
    // \text{} holding a word that is not a connective: math sets only "and", "or", "if" ... in text
    '\\$[^$]*\\\\text\\{\\s*(?!(?:and|or|if|iff|for|is|of|in|then|not|otherwise|where|with|when|all|some|such\\s+that)\\s*\\})[A-Za-z]{3,}\\s*\\}[^$]*\\$',
  ].join('|'));
  // Counts back to a list given earlier: "one of the four tests", "the next five identities", "the same is true".
  const COUNTED_BACK_RE = /\b(?:(?:one|each|all|both|any|none)\s+of\s+the|the\s+(?:next|previous|last|above|following))\s+(?:two|three|four|five|six|seven|eight|nine|ten)\b|\bthe\s+same\s+is\s+true\b/i;
  // Points at numbered items the reader cannot see: "Sentences 1 and 2 are ...", "lines 3-5".
  const NUMBERED_REFERENCE_RE = /\b[A-Za-z]+s\s+\d+\s*(?:and|or|through|to|[-–,])\s*\d+\b/;
  // A run-in capitalised heading glued to its paragraph: "CONVERSE, CONTRAPOSITIVE, AND INVERSE We can ...".
  const CAPS_HEADING_RE = /^[A-Z][A-Z0-9 ,'’&-]{5,}\s+[A-Z][a-z]/;
  const TERMINAL_RE = /[.!]["'”’)\]]*\s*\$*\s*$/;

  const stripMarks = (s) => String(s || '').replace(/\*\*|__/g, '').replace(/\s+/g, ' ').trim();
  const words = (s) => stripMarks(s).replace(/\$[^$]*\$/g, 'X').split(/\s+/).filter(Boolean);

  /** Why a sentence cannot stand alone in the summary, or null when it can. */
  function rejectReason(sentence) {
    const raw = String(sentence || '').trim();
    const s = stripMarks(raw);
    const sn = dep('stemNoise', './stem-noise.js');
    const nf = dep('noiseFilter', './noise-filter.js');
    const mt = dep('mathText', './math-text.js');
    const n = words(s).length;
    if (n < MIN_WORDS || n > MAX_WORDS) return 'length';
    if (/\?\s*["'”’)]*\s*$/.test(s) || QUESTION_OPENING_RE.test(s)) return 'question';
    if (OBJECTIVE_RE.test(s)) return 'objective';
    if (CODE_RE.test(raw)) return 'code';
    if (META_RE.test(s)) return 'meta';
    if (/:\s*\$*\s*$/.test(s) || !TERMINAL_RE.test(s)) return 'incomplete';
    if (sn && sn.isFragment(s)) return 'incomplete';
    if (mt && mt.isBalanced && !mt.isBalanced(raw)) return 'incomplete';
    if (sn && (sn.isDangling(s) || sn.hasUnresolvedReference(s))) return 'dangling';
    if (CONTINUATION_RE.test(s) || PERSON_ASIDE_RE.test(s)) return 'dangling';
    if (SETUP_RE.test(s)) return 'setup';
    // An analogy ("Like a train that changes tracks, ...") or a dated aside ("In 1982, ...") frames the topic.
    if (/^Like\s+(?:a|an|the)\s/.test(s) || /^In\s+(?:1[6-9]|20)\d\d\b/.test(s)) return 'aside';
    if (NUMBERED_REFERENCE_RE.test(s) || COUNTED_BACK_RE.test(s)) return 'dangling';
    if (sn && sn.isStemNoise(s)) return 'callout';
    if (GLUED_HEADING_RE.test(s) || CAPS_HEADING_RE.test(s) || GLUED_BOLD_RE.test(raw) || GLUED_LOWER_HEADING_RE.test(s) || GLUED_CAPTION_RE.test(s)) return 'glued';
    if (IDENTIFIER_RE.test(s.replace(/\$[^$]*\$/g, ' '))) return 'identifier';
    if (mathDamage(raw)) return 'math';
    const tokens = s.replace(/\$[^$]*\$/g, ' X ').split(/\s+/).filter(Boolean);
    if (tokens.filter((w) => /^[a-z][a-z'’-]*[.,;:]?$/.test(w)).length / tokens.length < MIN_PROSE_SHARE) return 'garbled';
    if (GLUED_FRAGMENTS_RE.test(s.replace(/\$[^$]*\$/g, 'X')) || MATH_DEBRIS_RE.test(raw)) return 'glued';
    if (isMangled(raw)) return 'mangled';
    if (nf && (nf.isGarbled(s) || nf.isNoise(s))) return 'garbled';
    return null;
  }

  /**
   * Text that extraction damaged: a word split by a lost hyphen, prose swallowed into a math span, or
   * letters of an unrelated script (recognition debris in a Latin-script document). Used for slide lines too.
   */
  function isMangled(text, opts = {}) {
    const raw = String(text || '');
    // Slides are not hyphenated at line ends: "Pneumonia- infection of ..." is a dash, not a split word.
    if (!opts.slide && BROKEN_WORD_RE.test(raw)) return true;
    // Each math span is judged on its own, so the prose between "$A$ and $B$ are sets" is never read as math.
    const spans = raw.match(/\$\$[\s\S]+?\$\$|\$[^$]+\$/g) || [];
    return spans.some((sp) => PROSE_IN_MATH_RE.test(sp)) || /[¿¡]/.test(raw) || /[぀-ヿ㐀-鿿가-힯]/.test(raw);
  }

  // Logic notation whose complement bar was lost in extraction reads as a falsehood:
  // "X + X = 1" (true is X + X' = 1), "Q = 1 and Q = 0" (true is Q = 1 and Q' = 0).
  const SAME_VAR_CONSTANT_RE = /(?:^|[^\w\\'])([A-Z])\s*(?:\+|·|\*|#|\\cdot)\s*\1\s*=\s*[01](?![\w'])/;
  const CONTRADICTION_RE = /(?:^|[^\w\\'])([A-Z])\s*=\s*([01])\s*(?:,\s*)?(?:and\s+)?\1\s*=\s*(?!\2)[01](?![\w'])/;
  const ENUMERATION_BEFORE_RE = /\b(?:both|either|for|when|whether|if|values?)\s*$/i;
  // An operator glyph that came through as something else: "X # Y" for the AND dot.
  const LOST_OPERATOR_RE = /\b[A-Z]\s*#\s*[A-Z]\b/;
  const COMPLEMENT_MARK_RE = /\\overline|\\bar\b|\\neg|¬|[A-Z]'|[A-Z]’/;

  /**
   * Why the notation of a line is known to be damaged, or null: a complement bar or an operator lost in
   * extraction turns a true statement into a false one. Such a line is dropped or marked, never shown as is.
   */
  function mathDamage(text) {
    const s = stripMarks(text).replace(/\$/g, ' ').replace(/\\text\{([^}]*)\}/g, '$1').replace(/\s+/g, ' ');
    if (/[¿¡]/.test(s) || LOST_OPERATOR_RE.test(s)) return 'operator';
    if (SAME_VAR_CONSTANT_RE.test(s)) return 'complement';
    const m = s.match(CONTRADICTION_RE);
    if (m && !ENUMERATION_BEFORE_RE.test(s.slice(0, m.index + (m[0].length - m[0].trimStart().length)))) return 'complement';
    // "X and Z are complemented ... to obtain X and Z": the same letters on both sides of a complement.
    if (/\bcomplement/i.test(s) && !COMPLEMENT_MARK_RE.test(String(text))) {
      const lists = s.match(/\b[A-Z](?:\s*(?:,|,?\s*and)\s*[A-Z]\b)+/g) || [];
      const keys = lists.map((l) => l.replace(/[^A-Z]/g, ''));
      if (keys.some((k, i) => keys.indexOf(k) !== i)) return 'complement';
    }
    return null;
  }

  /** Content words of a heading, for overlap scoring. */
  function headingWords(title) {
    const tok = dep('tokenizer', './tokenizer.js');
    const stop = tok ? tok.STOPWORDS : new Set();
    return new Set(stripMarks(title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !stop.has(w)));
  }

  /**
   * ctx.indexInParagraph: 0 for a paragraph's first sentence. ctx.terms: lower-case terms defined or
   * emphasised in the section. ctx.headingWords: a Set from headingWords().
   */
  function score(sentence, ctx = {}) {
    const raw = String(sentence || '');
    const s = stripMarks(raw);
    const lower = s.toLowerCase();
    const n = words(s).length;
    let value = 1;
    if (ctx.indexInParagraph === 0) value += W_FIRST_IN_PARAGRAPH;
    else if (ctx.indexInParagraph === 1) value += W_SECOND_IN_PARAGRAPH;
    const terms = ctx.terms || [];
    if (/\*\*[^*]+\*\*/.test(raw) || terms.some((t) => t && lower.includes(t))) value += W_TERM;
    if (CUE_RE.test(s)) value += W_CUE;
    if (n >= 10 && n <= 40) value += W_COMPLETE;
    if (ctx.headingWords && ctx.headingWords.size) {
      const shared = lower.split(/[^a-z0-9]+/).filter((w) => ctx.headingWords.has(w));
      value += W_HEADING_WORD * Math.min(2, new Set(shared).size);
    }
    if (META_RE.test(s)) value -= P_META;
    if (/\bfor\s+(?:example|instance)\b|\be\.g\./i.test(s)) value -= P_EXAMPLE_ASIDE;
    if (DATED_RE.test(s.replace(/\$[^$]*\$/g, ' '))) value -= P_DATED;
    const digits = (s.match(/\d/g) || []).length;
    if (digits / Math.max(1, s.length) > 0.12) value -= P_NUMERIC;
    return value;
  }

  /** Total key statements for a scope with `proseWords` words of running prose. */
  function budget(proseWords) {
    const wanted = Math.round((Number(proseWords) || 0) / WORDS_PER_STATEMENT);
    return Math.max(MIN_STATEMENTS, Math.min(MAX_STATEMENTS, wanted));
  }

  /**
   * Shares `total` statements among sections in proportion to their prose words. sizes: [{ words, available }]
   * where available is how many acceptable candidates the section has. Every section with a candidate gets
   * at least one; none gets more than MAX_PER_SECTION or more than it has.
   */
  function allocate(sizes, total) {
    const list = sizes || [];
    const allWords = list.reduce((n, x) => n + (x.words || 0), 0) || 1;
    const cap = (x) => Math.min(MAX_PER_SECTION, x.available || 0);
    const out = list.map((x) => Math.min(cap(x), Math.max(x.available ? 1 : 0, Math.floor((total * (x.words || 0)) / allWords))));
    let used = out.reduce((a, b) => a + b, 0);
    // Hand out what is left to the sections with the most prose per statement already given.
    while (used < total) {
      let best = -1;
      let bestRatio = -1;
      list.forEach((x, i) => {
        if (out[i] >= cap(x)) return;
        const ratio = (x.words || 0) / (out[i] + 1);
        if (ratio > bestRatio) { bestRatio = ratio; best = i; }
      });
      if (best < 0) break;
      out[best]++;
      used++;
    }
    return out;
  }

  /** True when the sentence carries a definitional or summarising cue. */
  const hasCue = (sentence) => CUE_RE.test(stripMarks(sentence));

  const api = {
    rejectReason, isMangled, mathDamage, score, budget, allocate, headingWords, hasCue,
    WORDS_PER_STATEMENT, MIN_STATEMENTS, MAX_STATEMENTS, MAX_PER_SECTION,
  };
  PDFStudy.summaryStatements = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

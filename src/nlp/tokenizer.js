/**
 * Deterministic Tokenizer, Sentence Splitter & TF-IDF Vectorizer (Zero Dependencies)
 * Includes STEM & Textbook Stopword Filters.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const STOPWORDS = new Set([
    'a','about','above','after','again','against','all','also','am','an','and','any','are',
    'as','at','be','because','been','before','being','below','between','both','but','by',
    'can','cannot','could','did','do','does','doing','down','during','each','either',
    'few','for','from','further','had','has','have','having','he','her','here','hers',
    'herself','him','himself','his','how','however','i','if','in','into','is','it','its',
    'itself','just','may','me','might','more','most','must','my','myself','no','nor',
    'not','now','of','off','on','once','only','or','other','ought','our','ours',
    'ourselves','out','over','own','same','she','should','so','some','such','than',
    'that','the','their','theirs','them','themselves','then','there','therefore','these',
    'they','this','those','through','thus','to','too','under','until','up','very','was',
    'we','were','what','when','where','which','while','who','whom','why','will','with',
    'would','you','your','yours','yourself','yourselves',
    // Textbook & Publisher Structural Stopwords
    'cengage','copyright','editorial','suppressed','electronic','rights','reserved',
    'figure','figures','fig','table','tables','example','examples','exercise','exercises',
    'solution','solutions','chapter','section','page','pages','remark','exploration',
    'graphing','utility','shown','see','let','use','using','find','finding','given',
  ]);

  const INVALID_TERM_STARTS = new Set([
    'this','that','these','those','it','they','we','you','he','she','there','here',
    'however','therefore','thus','moreover','furthermore','for','in','on','at','by',
    'figure','fig','table','chapter','section','example','note','when','where','while',
    'if','although','because','since','unless','whereas','both','each','many','some',
    'cengage','editorial','copyright','suppressed','third','overall','due','electronic',
    'statement','following','graph','function','equation','value','result','show','let',
  ]);

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().match(/\b[a-z0-9][a-z0-9-]*\b/g) || [];
  }

  function cleanMarkdown(text) {
    return (text || '')
      .replace(/\*\*|__/g, '')
      .replace(/[\u0000-\u001f\u007f-\u009f\uE000-\uF8FF\uFFFD]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const DIDACTIC_HEAD_RE =
    /^(?:\*\*)?(?:THEOREM\s+[A-Z0-9.]+|Definitions?\s+of\b|GUIDELINES\s+FOR\b|EXAMPLE\s+\d+|Proof\b|REMARK\b)/i;
  const CHAPTER_HEAD_RE = /^(?:chapter|section|unit|part|module|lesson|appendix)\s+[\dIVXA-Z]+\b/i;
  const NUMBERED_HEAD_RE = /^(?:\d+|[A-Z])(?:\.\d+)+\.?\s+[A-Z]/;

  function isTitleCase(text) {
    const words = text.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !STOPWORDS.has(w.toLowerCase()));
    return words.length > 0 && words.filter((w) => /^[A-Z]/.test(w)).length >= words.length * 0.6;
  }

  /**
   * True for a standalone heading line (whole line bold, "CHAPTER 3 ...", "1.1 Title Case Words"):
   * headings end the running sentence and are never glued onto the next one.
   */
  function isHeadingLine(line) {
    const t = String(line || '').trim();
    const plain = t.replace(/\*\*/g, '').trim();
    if (!plain || plain.length > 100 || /[.!?:;,]$/.test(plain)) return false;
    if (/^\*\*[^*]+\*\*$/.test(t)) return /^[A-Z0-9]/.test(plain); // lowercase start = wrapped bold run
    if (CHAPTER_HEAD_RE.test(plain)) return true;
    return NUMBERED_HEAD_RE.test(plain) && isTitleCase(plain.replace(/^[\d.A-Z]+\s+/, ''));
  }

  /** Lines that stand on their own (not a mid-sentence wrap), for line-level pattern matching. */
  function selfContainedLines(lines) {
    const ends = (l) => !l || /[.!?:]\s*(?:\*\*)?$/.test(l) || isHeadingLine(l);
    const starts = (l) => !l || /^(?:\*\*|[•▪◦\-*]\s|\d+[.)]\s)/.test(l);
    return lines.filter((l, i) => (ends(lines[i - 1]) || starts(l)) && (ends(l) || starts(lines[i + 1])));
  }

  function splitSentences(text) {
    if (!text) return [];
    // Headings and blank lines are hard boundaries; wrapped body lines are rejoined into sentences.
    // Didactic headings ("THEOREM 1.2 ...") get a period so they split off and are filtered below.
    const blocks = [[]];
    let inFence = false;
    for (const l of text.replace(/\r\n/g, '\n').split('\n')) {
      const trimmed = l.trim();
      if (/^```/.test(trimmed)) { inFence = !inFence; blocks.push([]); continue; }
      if (inFence) continue;
      // "**REMARK** The Intermediate Value Theorem tells you..." = a bold label, then a real sentence:
      const label = trimmed.match(/^\*\*(REMARK|Proof|NOTE|Exploration)\*\*\s+(\S.*)$/i);
      if (label) {
        blocks.push([`${label[1]}.`, label[2]]);
      } else if (DIDACTIC_HEAD_RE.test(trimmed) && !/[.!?]$/.test(trimmed)) {
        blocks[blocks.length - 1].push(`${trimmed}.`);
      } else if (!trimmed || isHeadingLine(trimmed)) {
        blocks.push([]);
      } else {
        blocks[blocks.length - 1].push(trimmed);
      }
    }
    const rejoined = blocks
      .filter((b) => b.length)
      .map((b) => b.join(' '))
      .join('\n\n');

    // Math/code spans ($...$, $$...$$, `...`), decimals and abbreviations are atomic (src/nlp/math-text.js).
    const mathText = PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);
    const { text: protectedText, restore } = mathText.protect(rejoined);

    const rawParts = protectedText.split(/(?<=[.!?\u2025])\s+(?=[A-Z0-9"(*\[$\u27E6])|\n{2,}/);
    const sentences = [];

    for (const part of rawParts) {
      const restored = restore(part).replace(/\s+/g, ' ').trim();
      if (
        restored.length >= 25 &&
        restored.split(/\s+/).length >= 5 &&
        !/^(?:THEOREM\s+[A-Z0-9.]+|Definitions?\s+of\b|EXAMPLE\s+\d+|Solution\b)/i.test(
          restored.replace(/\*\*/g, '')
        )
      ) {
        sentences.push(restored);
      }
    }
    return sentences;
  }

  function computeTfIdfVectors(sentences) {
    const n = sentences.length;
    const df = Object.create(null);
    const tokenized = sentences.map((s) => {
      const words = tokenize(cleanMarkdown(s)).filter((w) => !STOPWORDS.has(w) && w.length > 2);
      const unique = new Set(words);
      unique.forEach((w) => {
        df[w] = (df[w] || 0) + 1;
      });
      return words;
    });

    const idf = Object.create(null);
    for (const w of Object.keys(df)) {
      idf[w] = Math.log((n + 1) / (df[w] + 1)) + 1;
    }

    const vectors = tokenized.map((words) => {
      const vec = Object.create(null);
      const len = Math.max(1, words.length);
      for (const w of words) {
        vec[w] = (vec[w] || 0) + (1 / len) * idf[w];
      }
      return vec;
    });

    return { tokenized, idf, vectors };
  }

  function cosineSim(v1, v2) {
    let dot = 0;
    let n1 = 0;
    let n2 = 0;
    for (const k of Object.keys(v1)) {
      n1 += v1[k] * v1[k];
      if (v2[k]) dot += v1[k] * v2[k];
    }
    for (const k of Object.keys(v2)) {
      n2 += v2[k] * v2[k];
    }
    return n1 === 0 || n2 === 0 ? 0 : dot / (Math.sqrt(n1) * Math.sqrt(n2));
  }

  PDFStudy.tokenizer = {
    STOPWORDS,
    INVALID_TERM_STARTS,
    tokenize,
    cleanMarkdown,
    isHeadingLine,
    selfContainedLines,
    splitSentences,
    computeTfIdfVectors,
    cosineSim,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.tokenizer;
  }
})(typeof window !== 'undefined' ? window : globalThis);

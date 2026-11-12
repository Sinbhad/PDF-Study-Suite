/**
 * Deterministic Keyphrase Extraction (RAKE + YAKE!)
 * Zero external dependencies or models.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function getTokenizer() {
    if (PDFStudy.tokenizer) return PDFStudy.tokenizer;
    if (typeof require === 'function') return require('./tokenizer.js');
    throw new Error('Tokenizer module not loaded');
  }

  // Math function names and single letters never belong inside a keyphrase.
  const RAKE_BREAK = new Set('sin cos tan sec csc cot log lim exp arcsin arccos arctan sinh cosh tanh'.split(' '));
  const WORD_RE = /^[A-Za-z][A-Za-z-]*[A-Za-z]$/;

  /**
   * Splits text into candidate-bearing segments. A line break is a hard boundary unless it is a soft
   * wrap inside prose (long previous line without end punctuation, next line starting lowercase), so
   * headings, list items and caption lines never glue onto the following line.
   */
  function rakeSegments(text) {
    const lines = String(text || '').split(/\r?\n/);
    const segs = [];
    let cur = '';
    for (const line of lines) {
      const t = line.trim();
      if (!t) { if (cur) segs.push(cur); cur = ''; continue; }
      const soft = cur && /^[a-z(]/.test(t) && cur.split(' ').length >= 6 && !/[.!?:;]$/.test(cur);
      if (soft) cur += ' ' + t;
      else { if (cur) segs.push(cur); cur = t; }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  /**
   * RAKE (Rapid Automatic Keyword Extraction — Rose et al., 2010), boundary-aware variant:
   * candidates break at stopwords, punctuation, line/sentence boundaries, numbers and symbols, and at a
   * lowercase→Capitalised transition ("approach Construct"); compounds longer than maxWords are dropped,
   * and a once-seen 3+ word compound is cut where it joins two phrases seen elsewhere ("reaction | heat").
   */
  function stripMathAndCode(text) {
    const mt = PDFStudy.mathText || (typeof require === 'function' ? require('./math-text.js') : null);
    return mt ? mt.mask(String(text || '')).text.replace(/\u27E6M\d+\u27E7/g, ' ; ') : String(text || '');
  }

  function extractRakeKeyphrases(text, maxWords = 3, topK = 35) {
    const { STOPWORDS, cleanMarkdown } = getTokenizer();
    const runs = []; // [{ low: [...], raw: [...] }]
    for (const seg of rakeSegments(stripMathAndCode(text))) {
      for (const clause of cleanMarkdown(seg).split(/[.!?,;:\t"'()\[\]{}—–/]+/)) {
        let cur = { low: [], raw: [] };
        const flush = () => { if (cur.low.length) runs.push(cur); cur = { low: [], raw: [] }; };
        for (const tok of clause.split(/\s+/)) {
          const rawW = tok.replace(/^-+|-+$/g, '');
          const w = rawW.toLowerCase();
          if (!WORD_RE.test(rawW) || STOPWORDS.has(w) || w.length < 3 || RAKE_BREAK.has(w)) { flush(); continue; }
          const prev = cur.raw[cur.raw.length - 1];
          if (prev && /^[a-z]/.test(prev) && /^[A-Z][a-z]/.test(rawW)) flush(); // case-run boundary
          cur.low.push(w);
          cur.raw.push(rawW);
        }
        flush();
      }
    }

    // Statistical compound splitting: bigram counts plus phrase-initial / phrase-final word evidence.
    const bigram = Object.create(null);
    const initial = Object.create(null);
    const final = Object.create(null);
    for (const r of runs) {
      initial[r.low[0]] = (initial[r.low[0]] || 0) + 1;
      final[r.low[r.low.length - 1]] = (final[r.low[r.low.length - 1]] || 0) + 1;
      for (let i = 0; i + 1 < r.low.length; i++) {
        const b = r.low[i] + ' ' + r.low[i + 1];
        bigram[b] = (bigram[b] || 0) + 1;
      }
    }
    const pieces = [];
    for (const r of runs) {
      let startIdx = 0;
      for (let i = 0; r.low.length >= 3 && i + 1 < r.low.length; i++) {
        const b = r.low[i] + ' ' + r.low[i + 1];
        if (bigram[b] === 1 && final[r.low[i]] && initial[r.low[i + 1]]) {
          pieces.push({ low: r.low.slice(startIdx, i + 1), raw: r.raw.slice(startIdx, i + 1) });
          startIdx = i + 1;
        }
      }
      pieces.push({ low: r.low.slice(startIdx), raw: r.raw.slice(startIdx) });
    }

    const phrases = pieces.filter((p) => p.low.length <= maxWords);
    const originalCaseMap = new Map();
    const count = Object.create(null);
    const freq = Object.create(null);
    const degree = Object.create(null);
    for (const p of phrases) {
      const key = p.low.join(' ');
      count[key] = (count[key] || 0) + 1;
      if (!originalCaseMap.has(key)) originalCaseMap.set(key, p.raw.join(' '));
      for (const w of p.low) {
        freq[w] = (freq[w] || 0) + 1;
        degree[w] = (degree[w] || 0) + p.low.length - 1;
      }
    }

    const phraseScores = Object.create(null);
    for (const p of phrases) {
      const key = p.low.join(' ');
      if (phraseScores[key] === undefined) {
        phraseScores[key] = p.low.reduce((sum, w) => sum + (degree[w] + freq[w]) / freq[w], 0);
      }
    }

    return Object.entries(phraseScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([key, score]) => ({
        phrase: originalCaseMap.get(key) || key,
        lower: key,
        score: Math.round(score * 100) / 100,
        count: count[key],
      }));
  }

  /**
   * YAKE! (Campos et al., 2020) 5-Feature Statistical Single-Term Extractor
   */
  function extractYakeKeywords(text, topK = 25) {
    const { STOPWORDS, splitSentences, cleanMarkdown } = getTokenizer();
    const sentences = splitSentences(cleanMarkdown(text));
    if (sentences.length === 0) return [];

    const tf = Object.create(null);
    const tfUpper = Object.create(null);
    const tfAcro = Object.create(null);
    const sentIndices = Object.create(null);
    const displayForm = Object.create(null);

    sentences.forEach((sent, sIdx) => {
      const rawTokens = sent.match(/\b[A-Za-z][A-Za-z0-9-]*\b/g) || [];
      rawTokens.forEach((raw, tIdx) => {
        const low = raw.toLowerCase();
        if (STOPWORDS.has(low) || low.length < 3) return;
        tf[low] = (tf[low] || 0) + 1;
        if (!displayForm[low]) displayForm[low] = raw;
        if (raw === raw.toUpperCase() && raw.length > 1) {
          tfAcro[low] = (tfAcro[low] || 0) + 1;
          displayForm[low] = raw;
        } else if (tIdx > 0 && /^[A-Z]/.test(raw)) {
          tfUpper[low] = (tfUpper[low] || 0) + 1;
        }
        if (!sentIndices[low]) sentIndices[low] = [];
        sentIndices[low].push(sIdx);
      });
    });

    const counts = Object.values(tf);
    if (counts.length === 0) return [];
    const meanTf = counts.reduce((a, b) => a + b, 0) / counts.length;
    const stdTf =
      Math.sqrt(counts.reduce((acc, c) => acc + Math.pow(c - meanTf, 2), 0) / counts.length) + 1e-6;
    const nSents = sentences.length;

    const scored = [];
    for (const [w, count] of Object.entries(tf)) {
      const tCase = Math.max(tfUpper[w] || 0, tfAcro[w] || 0) / Math.log2(2 + count);
      const idxs = sentIndices[w];
      const medianPos = idxs[Math.floor(idxs.length / 2)];
      const tPos = Math.log(Math.log(3 + medianPos));
      const tFNorm = count / (meanTf + stdTf);
      const tSent = new Set(idxs).size / nSents;
      // Lower YAKE score means higher keyword salience; invert for unified ranking
      const rawYake = tPos / (1 + tCase + tFNorm + tSent);
      scored.push({
        phrase: displayForm[w] || w,
        lower: w,
        score: Math.round((1 / Math.max(0.05, rawYake)) * 100) / 100,
      });
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  PDFStudy.keywords = { extractRakeKeyphrases, extractYakeKeywords };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.keywords;
  }
})(typeof window !== 'undefined' ? window : globalThis);

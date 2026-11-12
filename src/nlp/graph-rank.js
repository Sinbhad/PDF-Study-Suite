/**
 * Extractive Sentence Ranking Algorithms: Luhn cluster significance + PageRank/LexRank centrality
 * (extracted from summarizer.js; re-exported there for existing callers).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function scoreLuhn(tokenizedSentences, maxGap = 4) {
    const freq = Object.create(null);
    for (const words of tokenizedSentences) {
      for (const w of words) freq[w] = (freq[w] || 0) + 1;
    }
    const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    const topCount = Math.max(5, Math.ceil(sorted.length * 0.15));
    const sigWords = new Set(sorted.slice(0, topCount).map((x) => x[0]));

    return tokenizedSentences.map((words) => {
      const sigIdx = [];
      words.forEach((w, i) => {
        if (sigWords.has(w)) sigIdx.push(i);
      });
      if (sigIdx.length === 0) return 0;

      let maxScore = 0;
      let cluster = [sigIdx[0]];
      for (let i = 1; i < sigIdx.length; i++) {
        if (sigIdx[i] - sigIdx[i - 1] <= maxGap) {
          cluster.push(sigIdx[i]);
        } else {
          const span = cluster[cluster.length - 1] - cluster[0] + 1;
          maxScore = Math.max(maxScore, (cluster.length * cluster.length) / span);
          cluster = [sigIdx[i]];
        }
      }
      const span = cluster[cluster.length - 1] - cluster[0] + 1;
      return Math.max(maxScore, (cluster.length * cluster.length) / span);
    });
  }

  function scoreGraphCentrality(vectors, cosineSim, threshold = 0, damping = 0.85, iterations = 22) {
    const n = vectors.length;
    if (n === 0) return [];
    const matrix = Array.from({ length: n }, () => new Float64Array(n));
    const rowSums = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const sim = cosineSim(vectors[i], vectors[j]);
        const val = threshold > 0 ? (sim >= threshold ? 1.0 : 0.0) : sim;
        matrix[i][j] = val;
        matrix[j][i] = val;
        rowSums[i] += val;
        rowSums[j] += val;
      }
    }

    let scores = new Float64Array(n).fill(1.0 / n);
    for (let step = 0; step < iterations; step++) {
      const next = new Float64Array(n).fill((1 - damping) / n);
      for (let i = 0; i < n; i++) {
        let incoming = 0;
        for (let j = 0; j < n; j++) {
          if (i !== j && rowSums[j] > 0) incoming += (matrix[j][i] / rowSums[j]) * scores[j];
        }
        next[i] += damping * incoming;
      }
      scores = next;
    }
    return Array.from(scores);
  }

  function normalizeScores(arr) {
    const max = Math.max(...arr, 1e-9);
    return arr.map((v) => v / max);
  }

  const api = { scoreLuhn, scoreGraphCentrality, normalizeScores };
  PDFStudy.graphRank = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

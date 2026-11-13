/**
 * Text metrics for the handwriting evaluation: normalisation, Levenshtein distance, CER / WER and a monotonic
 * alignment of recognised pieces to reference lines. Pure functions, no I/O (Node-testable).
 */

/** Same normalisation for reference and recognised text: NFKC, ASCII quotes/dashes, single spaces, no space before ,.;:!? */
function normalise(s) {
  return String(s == null ? '' : s).normalize('NFKC')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .trim();
}

/** Looser form for the secondary number: normalised, lower case, punctuation removed. */
function loose(s) {
  return normalise(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Edit distance between two strings or two arrays (unit costs). */
function levenshtein(a, b) {
  const A = typeof a === 'string' ? Array.from(a) : a;
  const B = typeof b === 'string' ? Array.from(b) : b;
  if (!A.length) return B.length;
  if (!B.length) return A.length;
  let prev = new Array(B.length + 1);
  let cur = new Array(B.length + 1);
  for (let j = 0; j <= B.length; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= B.length; j++) {
      const sub = prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[B.length];
}

const words = (s) => (s ? s.split(' ').filter(Boolean) : []);
const charLen = (s) => Array.from(s).length;

/**
 * Character and word edits of a hypothesis against a reference (both normalised here).
 * @returns {{refChars:number, charEdits:number, refWords:number, wordEdits:number, looseChars:number, looseEdits:number, cer:number, wer:number, looseCer:number}}
 */
function score(ref, hyp) {
  const r = normalise(ref);
  const h = normalise(hyp);
  const lr = loose(ref);
  const out = {
    refChars: charLen(r), charEdits: levenshtein(r, h),
    refWords: words(r).length, wordEdits: levenshtein(words(r), words(h)),
    looseChars: charLen(lr), looseEdits: levenshtein(lr, loose(hyp)),
  };
  return Object.assign(out, { cer: ratio(out.charEdits, out.refChars), wer: ratio(out.wordEdits, out.refWords), looseCer: ratio(out.looseEdits, out.looseChars) });
}

/** edits / length; an empty reference scores 0 when nothing was produced, else 1. */
function ratio(edits, len) {
  if (len > 0) return edits / len;
  return edits > 0 ? 1 : 0;
}

/**
 * Recognised pieces of one page result, in reading order (line by line, region by region).
 * Pieces with no text are left out: they hold nothing to compare.
 * @returns {{text:string, confidence:number, stats:?object, line:number, region:number}[]}
 */
function piecesOf(result) {
  const out = [];
  if (!result || !Array.isArray(result.lines)) return out;
  result.lines.forEach((l, li) => (l.regions || []).forEach((r, ri) => {
    const text = normalise(r.text);
    if (text) out.push({ text, confidence: Number(r.confidence) || 0, stats: r.stats || null, line: li, region: ri });
  }));
  return out;
}

/** Confidence of a group of pieces: length-weighted mean, plus the weakest piece; same for optional stats. */
function groupConfidence(group) {
  let wsum = 0; let csum = 0; let min = 1; let smean = 0; let smin = Infinity; let hasStats = true;
  for (const p of group) {
    const w = Math.max(1, charLen(p.text));
    wsum += w; csum += w * p.confidence; min = Math.min(min, p.confidence);
    if (p.stats && typeof p.stats.mean === 'number') smean += w * p.stats.mean; else hasStats = false;
    if (p.stats && typeof p.stats.min === 'number') smin = Math.min(smin, p.stats.min);
  }
  const out = { confidence: wsum ? csum / wsum : 0, minConfidence: group.length ? min : 0 };
  if (hasStats && group.length) out.stats = { mean: smean / wsum, min: smin === Infinity ? null : smin };
  return out;
}

/**
 * Monotonic alignment of reference lines to recognised pieces. A reference line can take 1..maxMerge
 * consecutive pieces (joined by a space); pieces left over are extras (hallucinations), lines left over are
 * misses. Minimises total character edits, where a miss costs its length and an extra piece its length.
 * @param {string[]} refLines
 * @param {{text:string, confidence:number}[]} pieces
 * @returns {{lines:object[], extras:object[], missed:number}}
 */
function alignLines(refLines, pieces, maxMerge) {
  const K = maxMerge || 3;
  const refs = refLines.map(normalise);
  const R = refs.length; const P = pieces.length;
  const len = (s) => charLen(s);
  const cost = Array.from({ length: R + 1 }, () => new Array(P + 1).fill(Infinity));
  const back = Array.from({ length: R + 1 }, () => new Array(P + 1).fill(null));
  const joined = (j, k) => pieces.slice(j, j + k).map((p) => p.text).join(' ');
  cost[0][0] = 0;
  for (let i = 0; i <= R; i++) {
    for (let j = 0; j <= P; j++) {
      const c = cost[i][j];
      if (c === Infinity) continue;
      const relax = (ni, nj, v, step) => {
        // ties prefer matches over skips, so a line that was read badly still shows what came back
        if (v < cost[ni][nj] || (v === cost[ni][nj] && step.k > 0 && back[ni][nj] && !(back[ni][nj].k > 0))) {
          cost[ni][nj] = v; back[ni][nj] = step;
        }
      };
      if (j < P) relax(i, j + 1, c + len(pieces[j].text), { pi: i, pj: j, k: 0, extra: true });
      if (i < R) relax(i + 1, j, c + len(refs[i]), { pi: i, pj: j, k: 0, extra: false });
      for (let k = 1; i < R && k <= K && j + k <= P; k++) {
        relax(i + 1, j + k, c + levenshtein(refs[i], joined(j, k)), { pi: i, pj: j, k });
      }
    }
  }
  const lines = new Array(R); const extras = [];
  for (let i = R, j = P; i > 0 || j > 0;) {
    const s = back[i][j];
    if (s.k > 0) {
      const group = pieces.slice(s.pj, s.pj + s.k);
      const got = joined(s.pj, s.k);
      const sc = score(refs[s.pi], got);
      lines[s.pi] = Object.assign({ index: s.pi, ref: refs[s.pi], got, matched: true, pieces: s.k,
        charEdits: sc.charEdits, refChars: sc.refChars, cer: sc.cer }, groupConfidence(group));
    } else if (s.extra) extras.unshift(pieces[s.pj]);
    else lines[s.pi] = { index: s.pi, ref: refs[s.pi], got: '', matched: false, pieces: 0, charEdits: len(refs[s.pi]), refChars: len(refs[s.pi]), cer: 1 };
    i = s.pi; j = s.pj;
  }
  return { lines, extras, missed: lines.filter((l) => !l.matched).length };
}

module.exports = { normalise, loose, levenshtein, score, ratio, piecesOf, groupConfidence, alignLines };

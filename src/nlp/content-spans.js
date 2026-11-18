/**
 * Content Spans: the stretches of a textbook page that are not the running exposition, found from their
 * typography and their place on the page, so card and quiz mining read the exposition only.
 *   example span    "EXAMPLE 3" / "Solution:" ... up to the end mark (◂ ▲ ■ □ ∎) or the next heading;
 *                   numbered sample items after "... the following sentences:" ("2. Toronto is the capital ...")
 *   biography       "GEORGE BOOLE (1815–1864) ..." up to where the interrupted sentence resumes (a line that
 *                   starts in lower case right after a finished sentence) or the next heading
 *   code            fenced ``` blocks and program-shaped lines
 *   tagged lines    extraction kinds and annotations (content-filter.js lineKind) win over all of the above
 * bookLineKinds(lines, { tags }) -> one kind per line ('content' | 'example' | 'biography' | 'code' | ...)
 * studyText(text, { tags })      -> the text with every non-content line removed (blank lines kept)
 * tags: optional [{ text, kind, isAnnotation }] from scope.lines; matched to text lines by their text.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const filter = () => dep('contentFilter', './content-filter.js');
  const tokenizer = () => dep('tokenizer', './tokenizer.js');

  // Typesetting marks that close a worked example or a proof.
  const END_MARK_RE = /[◂▲■□∎◀]\s*\$*\s*$/;
  const END_MARK_ANYWHERE_RE = /\s*[◂▲■□∎◀]\s*/g;
  // "... are given in the following list:" / "Consider the following sentences." introduces sample items.
  const SAMPLES_INTRO_RE = /\b(?:the\s+following|these)\s+(?:[a-z-]+\s+){0,3}(?:sentences|statements|propositions|examples|expressions|items|cases)\b|^consider\s+the\s+following\b/i;
  const NUMBERED_ITEM_RE = /^(?:\$\$)?\s*\d{1,2}[.)]\s+\S/;
  // An example's own question lines run back from "Solution:" until the last finished paragraph.
  const MAX_QUESTION_LINES = 4;
  const MAX_EXAMPLE_LINES = 60;
  const MAX_SOLUTION_LINES = 14;
  const MAX_UNMARKED_SOLUTION_LINES = 10;
  const MAX_BIOGRAPHY_LINES = 40;
  // A second boxed aside right after a biography ("HISTORICAL NOTE ...") belongs to the same sidebar.
  const SIDEBAR_HEAD_RE = /^(?:HISTORICAL\s+NOTES?|HISTORICAL\s+ASIDE)\b/;
  const EXERCISES_HEAD_RE = /^(?:\*\*)?(?:Exercises|Problems|Review\s+Questions|Review\s+Exercises|Practice\s+Problems)(?:\*\*)?$/;

  const plain = (s) => String(s || '').replace(/\*\*|__/g, '').trim();
  const isHeading = (line) => Boolean(tokenizer() && tokenizer().isHeadingLine(line));
  const endsSentence = (line) => /[.!?]["”’)]?\s*\$*\s*$/.test(plain(line));
  const opensLower = (line) => /^[a-z]/.test(plain(line));

  /** Index -> tagged line object, matched by trimmed text; extraction tags override the text rules. */
  function tagLookup(tags) {
    const byText = new Map();
    for (const t of tags || []) {
      if (t && t.text && (t.kind || t.isAnnotation) && !byText.has(plain(t.text))) byText.set(plain(t.text), t);
    }
    return (line) => byText.get(plain(line)) || null;
  }

  function markExamples(lines, kinds) {
    const start = (i) => {
      const t = plain(lines[i]);
      if (!filter().EXAMPLE_HEAD_RE.test(t)) return false;
      if (/^Solution\b/.test(t) || /^(?:\*\*|EXAMPLE|WORKED\s+EXAMPLE)/.test(String(lines[i]).trim())) return true;
      // "... is shown in\nExample 10." closes a wrapped sentence: a reference to an example, not its heading.
      return !/^Example\s+\d+(?:\.\d+)*[.,;)]/.test(t) && (i === 0 || !String(lines[i - 1]).trim() || endsSentence(lines[i - 1]));
    };
    for (let i = 0; i < lines.length; i++) {
      if (!start(i)) continue;
      // "Solution:" without an "EXAMPLE n" line: the question it answers sits just above it.
      if (/^Solution\b/.test(plain(lines[i]))) {
        for (let k = i - 1, n = 0; k >= 0 && n < MAX_QUESTION_LINES && kinds[k] === 'content'; k--, n++) {
          if (isHeading(lines[k]) || END_MARK_RE.test(plain(lines[k])) || (n > 0 && endsSentence(lines[k]) && !/\?\s*$/.test(plain(lines[k])))) break;
          kinds[k] = 'example';
        }
      }
      // The span runs to the end mark when the page kept it; without one (lost at a page break) it stops after
      // the first finished sentence of its last "Solution:", so the exposition that follows is not swallowed.
      const isSolution = (k) => /^Solution\b/.test(plain(lines[k]));
      let last = i;
      let solution = isSolution(i) ? i : -1;
      let closed = false;
      const limit = solution >= 0 ? MAX_SOLUTION_LINES : MAX_EXAMPLE_LINES;
      for (let k = i; k < lines.length && k - i < limit; k++) {
        if (k > i && (isHeading(lines[k]) || (start(k) && !isSolution(k)))) break;
        if (isSolution(k)) {
          if (solution >= 0 && solution !== k) break; // a second solution: the first one's end mark was lost
          solution = k;
        }
        last = k;
        if (END_MARK_RE.test(plain(lines[k]))) { closed = true; break; }
      }
      if (!closed) {
        const from = solution >= 0 ? solution : i;
        last = from;
        while (last < lines.length - 1 && last - from < MAX_UNMARKED_SOLUTION_LINES && !endsSentence(lines[last])) last++;
      }
      for (let k = i; k <= last; k++) kinds[k] = 'example';
      i = last;
    }
    // Numbered sample items under "the following sentences": the items illustrate, they do not teach.
    for (let i = 0; i < lines.length - 1; i++) {
      if (!SAMPLES_INTRO_RE.test(plain(lines[i]))) continue;
      for (let k = i + 1; k < lines.length && NUMBERED_ITEM_RE.test(plain(lines[k])); k++) kinds[k] = 'example';
    }
  }

  /**
   * A biography runs while it talks about its person. It ends where the interrupted exposition resumes: a line
   * in lower case right after a finished sentence, or a new sentence that names neither the person nor uses
   * he / his / she / her (checked together with the line after it, since a sentence may wrap).
   */
  function markBiographies(lines, kinds) {
    for (let i = 0; i < lines.length; i++) {
      const head = plain(lines[i]).match(filter().BIO_HEAD_RE);
      if (!head) continue;
      const surname = (head[0].match(/([A-Z][A-Z'’-]+)\s*\(/) || [])[1] || '';
      const person = new RegExp(`\\b(?:he|his|him|she|her|hers${surname ? `|${surname.toLowerCase()}` : ''})\\b`, 'i');
      let k = i;
      for (; k < lines.length && k - i < MAX_BIOGRAPHY_LINES; k++) {
        if (k === i) { kinds[k] = 'biography'; continue; }
        const freshSentence = endsSentence(lines[k - 1]);
        const resumesLower = freshSentence && opensLower(lines[k]);
        const leavesPerson = freshSentence && !SIDEBAR_HEAD_RE.test(plain(lines[k])) && !person.test(`${lines[k]} ${lines[k + 1] || ''}`);
        if (isHeading(lines[k]) || resumesLower || leavesPerson) break;
        kinds[k] = 'biography';
      }
      i = k - 1;
    }
  }

  /** "Exercises" / "Review Questions" to the next numbered heading: practice items, not exposition. */
  function markExercises(lines, kinds) {
    for (let i = 0; i < lines.length; i++) {
      if (!EXERCISES_HEAD_RE.test(plain(lines[i]))) continue;
      let k = i;
      for (; k < lines.length && (k === i || !isHeading(lines[k])); k++) kinds[k] = 'example';
      i = k - 1;
    }
  }

  function bookLineKinds(lines, opts = {}) {
    const list = (lines || []).map((l) => String(l == null ? '' : l));
    const tagOf = tagLookup(opts.tags);
    const kinds = list.map(() => 'content');
    let inFence = false;
    list.forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        kinds[i] = 'code';
        inFence = !inFence;
        return;
      }
      if (inFence) kinds[i] = 'code';
    });
    markExamples(list, kinds);
    markBiographies(list, kinds);
    markExercises(list, kinds);
    list.forEach((line, i) => {
      const tagged = tagOf(line);
      if (tagged) {
        kinds[i] = filter().lineKind(tagged);
        return;
      }
      // Line-level rules for what spans do not cover; captions and quips are only judged on short lines,
      // since a wrapped prose line can contain "(arrow)" or a capitalised word run without being one.
      if (kinds[i] !== 'content' || !plain(line) || /^\s*```/.test(line)) return;
      const kind = filter().lineKind(line);
      if (kind === 'url' || kind === 'citation' || kind === 'code') kinds[i] = kind;
      else if ((kind === 'caption' || kind === 'quip') && plain(line).split(/\s+/).length <= 12 && !endsSentence(line)) kinds[i] = kind;
    });
    return kinds;
  }

  function studyText(text, opts = {}) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const kinds = bookLineKinds(lines, opts);
    // Fenced code stays (its fence lines too) so sentence splitting still treats it as a hard boundary;
    // an unfenced program line is dropped like any other non-content line.
    let inFence = false;
    const fenced = lines.map((l) => {
      const fence = /^\s*```/.test(l);
      if (fence) inFence = !inFence;
      return fence || inFence;
    });
    // An end mark left on a kept line ("... same elements. ◂") is typography; without it the sentence ends there.
    return lines.filter((l, i) => kinds[i] === 'content' || fenced[i] || !l.trim())
      .map((l, i) => (fenced[i] ? l : l.replace(END_MARK_ANYWHERE_RE, ' ').replace(/\s+$/, '')))
      .join('\n');
  }

  const api = { bookLineKinds, studyText };
  PDFStudy.contentSpans = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

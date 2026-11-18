/**
 * Shared question markup for the Quiz and the Practice Test: formatted text + math in the stem,
 * in EVERY option and in the explanation. Options are full-width rows with letter keys, addressed
 * by index (data-opt-idx), so TeX, quotes or `<` inside an option can never break selection.
 * Shapes: multiple choice / cloze { id, question, options[], answer, answerIndex?, explanation?,
 *   badge?, skill?, category?, pageNumber?|page? } and self-graded { type: 'reveal', question,
 *   answer, explanation? } (no options: "Show answer", then "I got it / I missed it").
 * An answer value is an option index, or 'got' / 'missed' for reveal questions, or { typed, override? } for a
 * typed question { type: 'typed', answer, accept, form, others } (field and verdict: typed-card.js).
 * Every question carries a "Bad question" button (question-flags.js); a flagged question is not
 * valid any more, so it is never shown or counted again for this document.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LETTERS = 'ABCDEFGHIJ';
  const has = (t) => PDFStudy.richBlocks.hasContent(t);

  const hasOptions = (q) => Array.isArray(q.options) && q.options.filter(has).length >= 2;
  // A typed question (typed-card.js) has no options and is checked by the app, so it is no self-graded reveal.
  const isTyped = (q) => !!q && q.type === 'typed' && has(q.answer) && !!PDFStudy.typedCard;
  const isReveal = (q) => !!q && (q.type === 'reveal' || (!hasOptions(q) && q.type !== 'typed')) && has(q.answer);
  const isFlagged = (q) => !!PDFStudy.questionFlags && PDFStudy.questionFlags.isFlagged(q);
  /**
   * Questions with no prompt, with neither options nor an answer, or flagged as bad are never shown or counted.
   * The generator already skips flagged sources (excludeSources); the flag check stays for the list that was
   * drawn before the student flagged a question, and for saved runs from an earlier visit.
   */
  const isValid = (q) => !!q && has(q.question) && (isReveal(q) || isTyped(q) || (hasOptions(q) && q.type !== 'reveal' && q.type !== 'typed')) && !isFlagged(q);

  function correctIdx(q) {
    if (Number.isInteger(q.answerIndex)) return q.answerIndex;
    return (q.options || []).findIndex((o) => o === q.answer);
  }
  function isCorrect(q, ans) {
    if (isTyped(q)) return PDFStudy.typedCard.isCorrect(q, ans);
    return isReveal(q) ? ans === 'got' : Number.isInteger(ans) && ans === correctIdx(q);
  }

  const SKILL_LABEL = { formula: 'Formula', theorem: 'Theorem', definition: 'Definition', complexity: 'Complexity', algorithm: 'Algorithm', recall: 'Recall' };
  function skillOf(q) {
    if (q.skill) return String(q.skill).toLowerCase();
    const b = `${q.badge || ''} ${q.category || ''}`;
    if (/theorem|lemma|corollary|rule|law/i.test(b)) return 'theorem';
    if (/formula|identity|derivative|integral/i.test(b)) return 'formula';
    if (/complexity|big-?o|recurrence/i.test(b)) return 'complexity';
    if (/algorithm/i.test(b)) return 'algorithm';
    return isReveal(q) ? 'recall' : 'definition';
  }
  const skillLabel = (s) => SKILL_LABEL[s] || (s ? s[0].toUpperCase() + s.slice(1) : 'Concept');
  const badgeOf = (q) => String(q.badge || (isReveal(q) ? 'Recall' : skillLabel(skillOf(q)))).replace(/\s*[•·|]\s*/g, ' · ');

  /**
   * A recall question's explanation is its source line. When that is only "Term: <the answer>" and the prompt
   * already names the term, showing it would print the answer twice.
   */
  function repeatsAnswer(q) {
    const plain = (s) => (PDFStudy.richText ? PDFStudy.richText.plain(s) : String(s || ''));
    const words = (s) => plain(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const e = words(q.explanation);
    const a = words(q.answer);
    if (!e || !a || !e.endsWith(a)) return false;
    const rest = e.slice(0, e.length - a.length).trim();
    return !rest || ` ${words(q.question)} `.includes(` ${rest} `);
  }

  function revealBody(q, state, esc) {
    const sv = PDFStudy.studyViews;
    const graded = state.picked === 'got' || state.picked === 'missed';
    if (!state.shown && !graded && !state.reveal) {
      return `<button class="btn btn-secondary" type="button" data-show-qid="${esc(q.id)}">Show answer</button>`;
    }
    const grade = (val, label) => `<button class="btn btn-secondary btn-sm btn-${val}" type="button" data-qid="${esc(q.id)}" data-grade="${val}"
        aria-pressed="${state.picked === val}" ${state.locked ? 'disabled' : ''}>${label}</button>`;
    const source = repeatsAnswer(q) ? '' : sv.block(q.explanation);
    return `<div class="answer"><span class="label">Answer</span>${sv.block(q.answer)}${source}${sv.pageJump(q.pageNumber || q.page)}</div>
      <div class="q-grade" role="group" aria-label="Grade yourself">
        <span class="label">${state.reveal && !graded ? 'Not graded' : 'How did you do?'}</span>${grade('got', 'I got it')}${grade('missed', 'I missed it')}
      </div>`;
  }

  function choiceBody(q, state, esc) {
    const sv = PDFStudy.studyViews;
    const ci = correctIdx(q);
    const picked = state.picked;
    const answered = Number.isInteger(picked);
    const right = answered && picked === ci;
    const options = (q.options || []).map((opt, i) => {
      if (!has(opt)) return '';
      let cls = 'q-opt';
      let flag = '';
      if (state.reveal && i === ci) { cls += ' is-correct'; flag = 'Correct'; }
      else if (state.reveal && i === picked) { cls += ' is-wrong'; flag = 'Your answer'; }
      else if (!state.reveal && i === picked) cls += ' is-picked';
      return `<button class="${cls}" type="button" data-qid="${esc(q.id)}" data-opt-idx="${i}" aria-pressed="${i === picked}" ${state.locked ? 'disabled' : ''}>
          <span class="q-key" aria-hidden="true">${LETTERS[i] || i + 1}</span><span class="q-opt-text">${sv.rich(opt)}</span>${flag ? `<span class="q-flag">${flag}</span>` : ''}</button>`;
    }).join('');
    if (!state.reveal) return `<div class="q-options">${options}</div>`;
    const verdict = right ? 'Correct' : answered ? 'Not quite' : 'Not answered';
    const answerLine = right ? '' : `<div class="prose"><p>The answer is ${ci >= 0 ? `<strong>${LETTERS[ci]}</strong>: ${sv.rich(q.options[ci])}` : sv.rich(q.answer)}</p></div>`;
    return `<div class="q-options">${options}</div>
      <div class="q-feedback${right ? ' is-ok' : ''}">
        <p class="q-verdict">${verdict}</p>${answerLine}${sv.block(q.explanation)}${sv.pageJump(q.pageNumber || q.page)}
      </div>`;
  }

  /**
   * state: { picked?: number|'got'|'missed', reveal: boolean, locked: boolean, shown?: boolean }
   *   reveal -> mark correct/wrong + explanation; locked -> controls disabled; shown -> reveal answer visible.
   */
  function questionCard(q, num, state) {
    const sv = PDFStudy.studyViews;
    const esc = sv.escapeHtml;
    if (isFlagged(q)) return ''; // a sheet that still lists it (practice-test sections) skips it
    const body = isTyped(q) ? PDFStudy.typedCard.body(q, state, esc) : isReveal(q) ? revealBody(q, state, esc) : choiceBody(q, state, esc);
    const flagBtn = PDFStudy.questionFlags ? PDFStudy.questionFlags.buttonHtml(q) : '';
    return `
      <article class="q-card" data-qcard="${esc(q.id)}">
        <div class="q-head"><span class="label q-num">Question ${num}</span><span class="badge">${esc(badgeOf(q))}</span>${flagBtn}</div>
        ${sv.block(q.question, 'q-prompt')}
        ${body}
      </article>`;
  }

  const runs = new WeakMap(); // question list -> the run its view last passed in

  /**
   * Wire option / self-grade buttons: onPick(question, optionIndex | 'got' | 'missed'); onShow(question).
   * run (optional): { redraw, answers, retrying } - the view's own redraw function, its live answers
   * map and whether this is a retry of missed questions. With it, "Bad question" can drop a question
   * from the run in place and a finished run is saved; without it the view is rendered again from
   * the start. `questions` must be the view's live list, because a flagged question is removed from it.
   */
  function bindOptions(container, questions, onPick, onShow, run) {
    if (run) runs.set(questions, run);
    const liveRun = run || runs.get(questions);
    const find = (id) => questions.find((x) => String(x.id) === id);
    container.querySelectorAll('.q-opt').forEach((btn) => {
      btn.onclick = () => {
        const q = find(btn.getAttribute('data-qid'));
        if (q) onPick(q, parseInt(btn.getAttribute('data-opt-idx'), 10));
      };
    });
    container.querySelectorAll('[data-grade]').forEach((btn) => {
      btn.onclick = () => {
        const q = find(btn.getAttribute('data-qid'));
        if (q) onPick(q, btn.getAttribute('data-grade'));
      };
    });
    container.querySelectorAll('[data-show-qid]').forEach((btn) => {
      btn.onclick = () => {
        const q = find(btn.getAttribute('data-show-qid'));
        if (q && onShow) onShow(q);
      };
    });
    // Typed answers: Check (quiz) or kept as typed (practice test), and "I was right" after checking.
    if (PDFStudy.typedCard) PDFStudy.typedCard.bind(container, questions, onPick, (liveRun && liveRun.typed) || {});
    if (PDFStudy.studyViews.bindPageJumps) PDFStudy.studyViews.bindPageJumps(container);
    if (PDFStudy.questionFlags) PDFStudy.questionFlags.bind(container, questions, liveRun);
    if (PDFStudy.attemptLog) PDFStudy.attemptLog.drawn(container, questions, liveRun);
  }

  PDFStudy.quizCard = { correctIdx, isCorrect, isReveal, isTyped, isValid, skillOf, skillLabel, questionCard, bindOptions, repeatsAnswer, LETTERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.quizCard;
})(typeof window !== 'undefined' ? window : globalThis);

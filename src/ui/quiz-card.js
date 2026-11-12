/**
 * Shared question markup for the Quiz and the Practice Test: formatted text + math in the stem,
 * in EVERY option and in the explanation. Options are full-width rows with letter keys, addressed
 * by index (data-opt-idx), so TeX, quotes or `<` inside an option can never break selection.
 * Shapes: multiple choice / cloze { id, question, options[], answer, answerIndex?, explanation?,
 *   badge?, skill?, category?, pageNumber?|page? } and self-graded { type: 'reveal', question,
 *   answer, explanation? } (no options: "Show answer", then "I got it / I missed it").
 * An answer value is an option index, or 'got' / 'missed' for reveal questions.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const LETTERS = 'ABCDEFGHIJ';
  const has = (t) => PDFStudy.richBlocks.hasContent(t);

  const hasOptions = (q) => Array.isArray(q.options) && q.options.filter(has).length >= 2;
  const isReveal = (q) => !!q && (q.type === 'reveal' || !hasOptions(q)) && has(q.answer);
  /** Questions with no prompt, or with neither options nor an answer, are never shown or counted. */
  const isValid = (q) => !!q && has(q.question) && (isReveal(q) || (hasOptions(q) && q.type !== 'reveal'));

  function correctIdx(q) {
    if (Number.isInteger(q.answerIndex)) return q.answerIndex;
    return (q.options || []).findIndex((o) => o === q.answer);
  }
  const isCorrect = (q, ans) => (isReveal(q) ? ans === 'got' : Number.isInteger(ans) && ans === correctIdx(q));

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

  function revealBody(q, state, esc) {
    const sv = PDFStudy.studyViews;
    const graded = state.picked === 'got' || state.picked === 'missed';
    if (!state.shown && !graded && !state.reveal) {
      return `<button class="btn btn-secondary" type="button" data-show-qid="${esc(q.id)}">Show answer</button>`;
    }
    const grade = (val, label) => `<button class="btn btn-secondary btn-sm btn-${val}" type="button" data-qid="${esc(q.id)}" data-grade="${val}"
        aria-pressed="${state.picked === val}" ${state.locked ? 'disabled' : ''}>${label}</button>`;
    return `<div class="answer"><span class="label">Answer</span>${sv.block(q.answer)}${sv.block(q.explanation)}${sv.pageJump(q.pageNumber || q.page)}</div>
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
    const body = isReveal(q) ? revealBody(q, state, esc) : choiceBody(q, state, esc);
    return `
      <article class="q-card" data-qcard="${esc(q.id)}">
        <div class="q-head"><span class="label q-num">Question ${num}</span><span class="badge">${esc(badgeOf(q))}</span></div>
        ${sv.block(q.question, 'q-prompt')}
        ${body}
      </article>`;
  }

  /** Wire option / self-grade buttons: onPick(question, optionIndex | 'got' | 'missed'); onShow(question). */
  function bindOptions(container, questions, onPick, onShow) {
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
    if (PDFStudy.studyViews.bindPageJumps) PDFStudy.studyViews.bindPageJumps(container);
  }

  PDFStudy.quizCard = { correctIdx, isCorrect, isReveal, isValid, skillOf, skillLabel, questionCard, bindOptions, LETTERS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.quizCard;
})(typeof window !== 'undefined' ? window : globalThis);

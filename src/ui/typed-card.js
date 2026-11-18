/**
 * Typed-answer questions in the Quiz and the Practice Test: the answer field, the verdict and "I was right".
 * Checking is typed-check.js; this module only draws and wires (quiz-card.js calls it for type 'typed').
 *   body(q, state, esc)        state: { picked?: { typed, override? }, reveal, locked, typedMode: 'check' | 'sheet' }
 *                              'check'  the quiz: a Check button, the verdict at once
 *                              'sheet'  the practice test: the answer is kept as typed until "Submit test"
 *   isCorrect(q, answer)       the check, or the student's own "I was right"
 *   bind(container, questions, onPick, typed)
 *                              typed: { onDraft(q, text), onEnter(q), onOverride(q) } from the view's run
 * An empty answer is never checked: the field is marked invalid and the live region says what to do.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const tc = () => PDFStudy.typedCheck;

  const isTyped = (q) => !!q && q.type === 'typed';
  const textOf = (answer) => (answer && typeof answer === 'object' ? String(answer.typed || '') : typeof answer === 'string' ? answer : '');

  /** The checker's verdict for a stored answer: { correct, verdict, message } (override counts as right). */
  function result(q, answer) {
    const text = textOf(answer);
    if (answer && answer.override) return { correct: true, verdict: 'override', message: 'Counted as right by you.' };
    if (!text.trim()) return { correct: false, verdict: 'empty', message: 'Not answered.' };
    return tc() ? tc().check(q, text) : { correct: false, verdict: 'wrong', message: 'Not quite.' };
  }
  const isCorrect = (q, answer) => answer !== undefined && result(q, answer).correct;

  const ids = (q) => {
    const safe = String(q.id).replace(/[^A-Za-z0-9_-]/g, '_');
    return { input: `typed-${safe}`, hint: `typed-${safe}-hint` };
  };

  function inputBody(q, state, esc) {
    const id = ids(q);
    const sheet = state.typedMode === 'sheet';
    const hint = tc() ? tc().hintFor(q) : 'One term';
    return `<form class="q-typed" data-typed-qid="${esc(q.id)}" novalidate>
        <label class="q-typed-label" for="${id.input}">Your answer</label>
        <div class="q-typed-row">
          <input class="input q-typed-input" id="${id.input}" name="answer" type="text" value="${esc(textOf(state.picked))}"
            autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="${sheet ? 'next' : 'done'}"
            aria-describedby="${id.hint}" ${state.locked ? 'disabled' : ''} />
          ${sheet ? '' : `<button class="btn btn-primary q-typed-check" type="submit" ${state.locked ? 'disabled' : ''}>Check</button>`}
        </div>
        <p class="q-typed-hint" id="${id.hint}">${esc(hint)}${sheet ? ' · kept until you submit the test' : ''}</p>
      </form>`;
  }

  const VERDICT = {
    right: 'Correct', override: 'Counted as right', empty: 'Not answered', other: 'Not quite: another term from this section',
    shown: 'Not quite: that name is already in the question', unit: 'Not quite: check the unit', wrong: 'Not quite',
  };

  function doneBody(q, state, esc) {
    const sv = PDFStudy.studyViews;
    const r = result(q, state.picked);
    const typed = textOf(state.picked).trim();
    // A right answer in another spelling, form or unit says how the material writes it.
    const ownWords = r.correct && r.verdict !== 'override' && r.message !== 'Correct.';
    const verdict = ownWords ? r.message.replace(/\.$/, '') : VERDICT[r.verdict] || VERDICT.wrong;
    const exact = r.correct && r.verdict !== 'override';
    const overrideBtn = !r.correct && typed
      ? `<button class="btn btn-secondary btn-sm q-typed-override" type="button" data-override-qid="${esc(q.id)}">I was right</button>` : '';
    const note = r.verdict === 'override' ? '<p class="q-typed-note">This question is marked so its answer can be checked.</p>' : '';
    return `<p class="q-typed-given"><span class="label">Your answer</span> <span class="q-typed-text">${typed ? esc(typed) : '—'}</span></p>
      <div class="q-feedback${r.correct ? ' is-ok' : ''}">
        <p class="q-verdict">${esc(verdict)}</p>
        ${exact ? '' : `<div class="prose"><p>The answer is <strong>${sv.rich(q.answer)}</strong></p></div>`}
        ${sv.block(q.explanation)}${sv.pageJump(q.pageNumber || q.page)}
        ${overrideBtn ? `<div class="q-grade">${overrideBtn}</div>` : note}
      </div>`;
  }

  function body(q, state, esc) {
    return state.reveal ? doneBody(q, state, esc) : inputBody(q, state, esc);
  }

  /** Say something through the view's live region (the quiz's, or the one "Bad question" adds to the test). */
  function say(container, message) {
    if (PDFStudy.questionFlags && PDFStudy.questionFlags.say) PDFStudy.questionFlags.say(container, message);
  }

  function bind(container, questions, onPick, typed = {}) {
    const find = (id) => questions.find((x) => String(x.id) === id);
    container.querySelectorAll('form[data-typed-qid]').forEach((form) => {
      const q = find(form.getAttribute('data-typed-qid'));
      const input = form.querySelector('.q-typed-input');
      if (!q || !input) return;
      const sheet = !form.querySelector('.q-typed-check');
      form.onsubmit = (e) => {
        e.preventDefault();
        if (sheet) {
          if (typed.onEnter) typed.onEnter(q);
          return;
        }
        if (!input.value.trim()) {
          input.setAttribute('aria-invalid', 'true');
          say(container, 'Type an answer first, then press Check.');
          input.focus();
          return;
        }
        onPick(q, { typed: input.value });
      };
      input.oninput = () => {
        input.removeAttribute('aria-invalid');
        if (sheet && typed.onDraft) typed.onDraft(q, input.value);
      };
    });
    container.querySelectorAll('[data-override-qid]').forEach((btn) => {
      btn.onclick = () => {
        const q = find(btn.getAttribute('data-override-qid'));
        if (q && typed.onOverride) typed.onOverride(q);
      };
    });
  }

  PDFStudy.typedCard = { isTyped, isCorrect, result, body, bind, textOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.typedCard;
})(typeof window !== 'undefined' ? window : globalThis);

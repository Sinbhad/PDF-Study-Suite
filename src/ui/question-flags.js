/**
 * "Bad question" on quiz and practice-test questions. One click takes the question out of the run
 * without counting it, remembers the sentence it came from so it stays out of later quizzes for
 * this document, and offers Undo for a few seconds.
 *   isFlagged(q)                      used by quizCard.isValid, so flagged questions are never shown or counted
 *   buttonHtml(q)                     the button in a question's header
 *   bind(container, questions, run)   called by quizCard.bindOptions after every draw;
 *                                     run: { redraw, answers } from the view (see quiz-card.js)
 * Every later build ("New quiz", "New test", opening the section again) passes the flagged sources to the
 * generator as excludeSources (study-inputs.js), so it draws other questions in their place. The list on
 * screen was drawn before the flag, so isFlagged still takes the question out of it at once.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const USER = { user: true };
  const MESSAGE = 'Question removed. It will not come back for this document.';
  let pending = null; // { undo: undoBar handle, container }

  const session = () => PDFStudy.docSession;
  const isFlagged = (q) => !!session() && PDFStudy.docState.isFlagged(session().state(), q);

  function buttonHtml(q) {
    const esc = PDFStudy.studyViews.escapeHtml;
    return `<button class="btn-link act q-bad" type="button" data-flag-qid="${esc(q.id)}"
        title="Remove this question and keep it out of future quizzes for this document">Bad question</button>`;
  }

  /** Announce through the view's own live region, or a hidden one added for the practice test. */
  function say(container, message) {
    let live = container.querySelector('#quizLive') || container.querySelector('[data-flag-live]');
    if (!live) {
      live = document.createElement('div');
      live.className = 'sr-only';
      live.setAttribute('data-flag-live', '');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      container.appendChild(live);
    }
    setTimeout(() => { live.textContent = message; }, 80);
  }

  const onQuiz = () => !!PDFStudy.main && PDFStudy.main.appState.activeTab === 'quiz';

  /** The Quiz and Practice test tabs count the questions that are left. */
  function refreshTabCounts() {
    const main = PDFStudy.main;
    if (!main || !PDFStudy.tabs) return;
    const g = main.appState.generated;
    PDFStudy.tabs.setCounts({
      quiz: (g.quiz || []).filter(PDFStudy.quizCard.isValid).length,
      test: PDFStudy.testView ? PDFStudy.testView.count(g.test, main.appState.selectedScope.title) : 0,
    });
  }

  /**
   * Redraw the view after the question list changed. The quiz view cannot draw an empty run, and
   * its one-at-a-time position may now point past the end; both cases are settled here.
   */
  function redraw(container, questions, run, removedIndex) {
    const main = PDFStudy.main;
    refreshTabCounts();
    if (!run || !run.redraw || (onQuiz() && !questions.length)) {
      if (main) main.renderActiveTab(); // start over from the generated list, without the flagged question
      return;
    }
    run.redraw();
    const next = container.querySelector('#quizNextBtn');
    const wasLast = removedIndex >= questions.length;
    if (onQuiz() && wasLast && next && !container.querySelector('.results')) next.click(); // nothing left to ask: go to the results
  }

  function flag(container, questions, run, q) {
    const UB = PDFStudy.undoBar;
    const index = questions.indexOf(q);
    const hadAnswer = !!run && !!run.answers && Object.prototype.hasOwnProperty.call(run.answers, q.id);
    const answer = hadAnswer ? run.answers[q.id] : undefined;
    const sourceKey = session().change((state) => PDFStudy.docState.flagQuestion(state, q), USER);
    if (index >= 0) questions.splice(index, 1);
    if (hadAnswer) delete run.answers[q.id];
    if (PDFStudy.testReport) PDFStudy.testReport.forget(q);
    const restoreAttempt = PDFStudy.attemptLog ? PDFStudy.attemptLog.dropQuestion(q) : null;

    if (pending) pending.undo.clear();
    const handle = UB.start({
      message: MESSAGE,
      undo: () => {
        session().change((state) => PDFStudy.docState.unflag(state, sourceKey), USER);
        if (index >= 0) questions.splice(Math.min(index, questions.length), 0, q);
        if (hadAnswer) run.answers[q.id] = answer;
        if (PDFStudy.testReport) PDFStudy.testReport.recall(q);
        if (restoreAttempt) restoreAttempt();
        pending = null;
        redraw(container, questions, run, -1);
        say(container, 'Question is back.');
      },
      onExpire: () => {
        UB.dismiss(container, handle, container.querySelector('.q-opt, [data-show-qid], #testSubmitBtn'));
        pending = null;
      },
    });
    pending = { undo: handle, container };
    redraw(container, questions, run, index);
    say(container, `${MESSAGE} Undo is available for a few seconds.`);
    const undoBtn = container.querySelector(`[data-undo-bar="${handle.id}"] [data-undo]`);
    if (undoBtn) undoBtn.focus({ preventScroll: true });
  }

  /** The views rebuild their markup on every draw, so a pending Undo bar is put back each time. */
  function showPending(container) {
    const UB = PDFStudy.undoBar;
    if (!pending || pending.container !== container || pending.undo.done) return;
    if (container.querySelector(`[data-undo-bar="${pending.undo.id}"]`)) return;
    // Question lists scroll, so the bar is pinned to the bottom of the window.
    container.insertAdjacentHTML('beforeend', UB.html(pending.undo, { floating: true }));
    UB.bind(container, pending.undo);
  }

  function bind(container, questions, run) {
    if (!session()) return;
    container.querySelectorAll('[data-flag-qid]').forEach((btn) => {
      btn.onclick = () => {
        const q = questions.find((x) => String(x.id) === btn.getAttribute('data-flag-qid'));
        if (q) flag(container, questions, run, q);
      };
    });
    showPending(container);
  }

  PDFStudy.questionFlags = { isFlagged, buttonHtml, bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.questionFlags;
})(typeof window !== 'undefined' ? window : globalThis);

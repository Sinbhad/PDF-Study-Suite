/**
 * Quiz and practice-test results that survive a reload, saved per document and scope.
 *   record(kind, rows, { retry })       rows: [{ q, right }]; called when a run is finished
 *   drawn(container, questions, run)    called by quizCard.bindOptions after every draw: saves a
 *                                       finished quiz, and on a fresh run adds the line
 *                                       "Last time: 7/10 on 12 Nov." with "Retry the 3 you missed"
 *   dropQuestion(q)                     a question flagged as bad stops counting in the saved result
 * The missed questions are stored whole, so the retry works even when the next quiz is generated
 * differently. run: { answers, retrying } from the view (see quiz-card.js).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const USER = { user: true };
  const savedRuns = new WeakMap(); // a quiz's answers object -> the question list it was saved for
  const storedRetries = new WeakSet(); // answers objects of runs started from "Retry the ones you missed"
  let nextRunIsStoredRetry = false;

  const app = () => PDFStudy.main && PDFStudy.main.appState;
  const kindNow = () => (app().activeTab === 'test' ? 'test' : 'quiz');
  const scopeId = () => `${app().activeMode}:${app().selectedScope.id}`;
  const scopeTitle = () => app().selectedScope.label || app().selectedScope.title;

  function record(kind, rows, opts) {
    if (!PDFStudy.docSession || !app() || !rows.length) return;
    const K = PDFStudy.studyKeys;
    const attempt = {
      kind,
      scopeId: scopeId(),
      at: Date.now(),
      score: rows.filter((r) => r.right).length,
      total: rows.length,
      retry: !!(opts && opts.retry),
      rows: rows.map((r) => ({ key: K.questionKey(r.q), right: !!r.right })),
      missed: rows.filter((r) => !r.right).map((r) => r.q),
    };
    PDFStudy.docSession.change((state) => PDFStudy.docState.addAttempt(state, attempt), USER);
  }

  /** Returns a function that puts the saved result back as it was (for Undo), or null when nothing changed. */
  function dropQuestion(q) {
    if (!PDFStudy.docSession || !app()) return null;
    const key = PDFStudy.studyKeys.questionKey(q);
    const state = PDFStudy.docSession.state();
    const mine = state.attempts.filter((a) => a.kind === kindNow() && a.scopeId === scopeId());
    const attempt = mine[mine.length - 1];
    const row = attempt && attempt.rows.find((r) => r.key === key);
    if (!row) return null;
    const before = JSON.stringify(attempt);
    PDFStudy.docSession.change(() => {
      attempt.rows = attempt.rows.filter((r) => r !== row);
      attempt.total = attempt.rows.length;
      attempt.score = attempt.rows.filter((r) => r.right).length;
      attempt.missed = (attempt.missed || []).filter((m) => PDFStudy.studyKeys.questionKey(m) !== key);
    }, USER);
    return () => PDFStudy.docSession.change(() => Object.assign(attempt, JSON.parse(before)), USER);
  }

  function retryStored(container, kind, missed) {
    nextRunIsStoredRetry = true; // read by drawn() during the render below
    if (kind === 'quiz') {
      PDFStudy.quizView.renderQuizView(container, missed, scopeTitle());
    } else {
      PDFStudy.testView.reset();
      PDFStudy.testView.renderTestView(container, scopeTitle(), {
        title: `Practice test: ${scopeTitle()}`,
        retry: true,
        sections: [{ name: 'Missed questions', questions: missed }],
      });
    }
    nextRunIsStoredRetry = false;
  }

  function lastTimeLine(container, kind) {
    const head = container.querySelector('.view-head');
    const info = PDFStudy.docState.lastAttempt(PDFStudy.docSession.state(), kind, scopeId());
    if (!head || !info || container.querySelector('.last-time')) return;
    const missed = info.missed.filter(PDFStudy.quizCard.isValid);
    const when = PDFStudy.reviewSchedule.shortDate(info.last.at);
    const retryLabel = missed.length === 1 ? 'Retry the one you missed' : `Retry the ${missed.length} you missed`;
    head.insertAdjacentHTML('afterend', `<p class="last-time"><span>Last time: <strong>${info.last.score}/${info.last.total}</strong> on ${when}.</span>
        ${missed.length ? `<button class="btn-link act" type="button" data-retry-stored>${retryLabel}</button>` : ''}</p>`);
    const btn = container.querySelector('[data-retry-stored]');
    if (btn) btn.onclick = () => retryStored(container, kind, missed);
  }

  function saveFinishedQuiz(questions, run) {
    const QC = PDFStudy.quizCard;
    const done = questions.length > 0 && questions.every((q) => run.answers[q.id] !== undefined);
    if (!done || savedRuns.get(run.answers) === questions) return;
    savedRuns.set(run.answers, questions);
    const rows = questions.map((q) => ({ q, right: QC.isCorrect(q, run.answers[q.id]) }));
    record('quiz', rows, { retry: !!run.retrying || storedRetries.has(run.answers) });
  }

  function drawn(container, questions, run) {
    if (!PDFStudy.docSession || !app() || !run || !run.answers) return;
    if (nextRunIsStoredRetry) {
      storedRetries.add(run.answers);
      nextRunIsStoredRetry = false;
    }
    const kind = kindNow();
    if (kind === 'quiz') saveFinishedQuiz(questions, run); // a practice test is saved when it is submitted (test-report.js)
    const fresh = Object.keys(run.answers).length === 0 && !container.querySelector('.test-report');
    if (fresh && !run.retrying && !storedRetries.has(run.answers)) lastTimeLine(container, kind);
  }

  PDFStudy.attemptLog = { record, drawn, dropQuestion };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.attemptLog;
})(typeof window !== 'undefined' ? window : globalThis);

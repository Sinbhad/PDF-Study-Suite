/**
 * Practice test grading + score report (used by test-view.js).
 * Grades locally by option index; when PDFStudy.testEngine.gradeTest exists (#9 contract:
 * gradeTest(test, answers) -> { score, total, percent, bySkill, missed }) its score is preferred.
 * A submitted test is saved as an attempt (attempt-log.js). A question flagged as bad on the review
 * screen is taken out of the report with forget(), and put back by recall() if the student undoes it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  let lastGraded = null; // { result, rows: [{ q, right, dropped }] } of the newest submitted test

  /** { score, total, percent, bySkill, missed } over the rows that still count. */
  function summarise(rows) {
    const QC = PDFStudy.quizCard;
    const bySkill = {};
    const missed = [];
    let score = 0;
    const counted = rows.filter((r) => !r.dropped);
    counted.forEach((r) => {
      const skill = QC.skillOf(r.q);
      const row = (bySkill[skill] = bySkill[skill] || { right: 0, total: 0 });
      row.total += 1;
      if (r.right) {
        score += 1;
        row.right += 1;
      } else {
        missed.push(r.q);
      }
    });
    const total = counted.length;
    return { score, total, percent: total ? Math.round((score / total) * 100) : 0, bySkill, missed };
  }

  /** The engine's own score, when it graded the same number of questions. */
  function engineScore(test, questions, answers) {
    const QC = PDFStudy.quizCard;
    const eng = PDFStudy.testEngine;
    if (!eng || typeof eng.gradeTest !== 'function' || !test || questions.some(QC.isReveal)) return null;
    try {
      const byText = {};
      questions.forEach((q) => { if (Number.isInteger(answers[q.id])) byText[q.id] = q.options[answers[q.id]]; });
      const r = eng.gradeTest(test, byText);
      return r && Number.isFinite(r.score) && r.total === questions.length ? r.score : null;
    } catch (_e) {
      return null; // the local grade stands
    }
  }

  /** answers: { [qid]: optionIndex | 'got' | 'missed' }. Returns { score, total, percent, bySkill, missed: [question] }. */
  function grade(test, questions, answers) {
    const QC = PDFStudy.quizCard;
    const rows = questions.map((q) => ({ q, right: QC.isCorrect(q, answers[q.id]), dropped: false }));
    const result = summarise(rows);
    const fromEngine = engineScore(test, questions, answers);
    if (fromEngine !== null) {
      result.score = fromEngine;
      result.percent = Math.round((fromEngine / result.total) * 100);
    }
    lastGraded = { result, rows };
    // A retry sheet has no generated test behind it (test-view.js), or says so itself (attempt-log.js).
    if (PDFStudy.attemptLog) PDFStudy.attemptLog.record('test', rows, { retry: !test || !!test.retry });
    return result;
  }

  /** Recount the newest report in place, so the view that holds it shows the new numbers on its next draw. */
  function setDropped(q, dropped) {
    const row = lastGraded && lastGraded.rows.find((r) => r.q === q);
    if (!row) return;
    row.dropped = dropped;
    Object.assign(lastGraded.result, summarise(lastGraded.rows));
  }
  const forget = (q) => setDropped(q, true);
  const recall = (q) => setDropped(q, false);

  function verdict(pct) {
    if (pct >= 90) return 'Excellent, exam ready.';
    if (pct >= 75) return 'Solid. Review the missed items below.';
    if (pct >= 50) return 'Getting there. Retry the missed items.';
    return 'Keep studying. Revisit the summary and flashcards, then retry.';
  }

  function reportHtml(result, opts) {
    const QC = PDFStudy.quizCard;
    const esc = PDFStudy.studyViews.escapeHtml;
    const rows = Object.keys(result.bySkill).map((k) => {
      const r = result.bySkill[k];
      const pct = Math.round((r.right / r.total) * 100);
      return `<tr><th scope="row">${esc(QC.skillLabel(k))}</th><td>${r.right} / ${r.total}</td>
        <td><div class="progress"><div class="progress-fill ${pct < 60 ? 'fill-weak' : ''}" style="width:${pct}%"></div></div></td></tr>`;
    }).join('');
    const time = opts.elapsed ? ` · ${Math.floor(opts.elapsed / 60)}m ${opts.elapsed % 60}s` : '';
    return `
      <section class="results test-report" aria-label="Score report" tabindex="-1">
        <p class="eyebrow">${opts.retry ? 'Retry score report' : 'Score report'}</p>
        <p class="score">${result.score} / ${result.total}</p>
        <p class="results-line">${result.percent}% correct${esc(time)}${opts.timedOut ? ' · time ran out' : ''}. ${esc(verdict(result.percent))}</p>
        ${rows ? `<table class="data-table skill-table"><caption class="sr-only">Score by skill</caption><tbody>${rows}</tbody></table>` : ''}
        <div class="results-actions">
          ${result.missed.length ? `<button class="btn btn-primary" id="testRetryMissedBtn" type="button">Retry missed (${result.missed.length})</button>` : ''}
          <button class="btn btn-secondary" id="testReviewToggleBtn" type="button" aria-pressed="${!!opts.reviewAll}">${opts.reviewAll ? 'Show missed only' : 'Review all answers'}</button>
          <button class="btn btn-secondary" id="testNewBtn" type="button">New test</button>
          <button class="btn-link note-link" id="testPrintBtn" type="button">Print</button>
        </div>
      </section>`;
  }

  PDFStudy.testReport = { grade, forget, recall, reportHtml, verdict };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.testReport;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Practice test grading + score report (used by test-view.js).
 * Grades locally by option index; when PDFStudy.testEngine.gradeTest exists (#9 contract:
 * gradeTest(test, answers) -> { score, total, percent, bySkill, missed }) its score is preferred.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  /** answers: { [qid]: optionIndex | 'got' | 'missed' }. Returns { score, total, percent, bySkill, missed: [question] }. */
  function grade(test, questions, answers) {
    const QC = PDFStudy.quizCard;
    const bySkill = {};
    const missed = [];
    let score = 0;
    questions.forEach((q) => {
      const skill = QC.skillOf(q);
      const row = (bySkill[skill] = bySkill[skill] || { right: 0, total: 0 });
      row.total += 1;
      if (QC.isCorrect(q, answers[q.id])) { score += 1; row.right += 1; } else missed.push(q);
    });
    const total = questions.length;
    const local = { score, total, percent: total ? Math.round((score / total) * 100) : 0, bySkill, missed };
    const eng = PDFStudy.testEngine;
    if (!eng || typeof eng.gradeTest !== 'function' || !test || questions.some(QC.isReveal)) return local;
    try {
      const byText = {};
      questions.forEach((q) => { if (Number.isInteger(answers[q.id])) byText[q.id] = q.options[answers[q.id]]; });
      const r = eng.gradeTest(test, byText);
      if (r && Number.isFinite(r.score) && r.total === total) return { ...local, score: r.score, percent: Math.round((r.score / total) * 100) };
    } catch (_e) { /* local grade stands */ }
    return local;
  }

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
      <section class="results test-report" aria-label="Score report">
        <p class="eyebrow">${opts.retry ? 'Retry score report' : 'Score report'}</p>
        <p class="score">${result.score} / ${result.total}</p>
        <p class="results-line">${result.percent}% correct${esc(time)}${opts.timedOut ? ' · time ran out' : ''}. ${esc(verdict(result.percent))}</p>
        ${rows ? `<table class="data-table skill-table"><caption class="sr-only">Score by skill</caption><tbody>${rows}</tbody></table>` : ''}
        <div class="results-actions">
          ${result.missed.length ? `<button class="btn btn-primary" id="testRetryMissedBtn" type="button">Retry missed (${result.missed.length})</button>` : ''}
          <button class="btn btn-secondary" id="testReviewToggleBtn" type="button" aria-pressed="${!!opts.reviewAll}">${opts.reviewAll ? 'Show missed only' : 'Review all answers'}</button>
          <button class="btn btn-secondary" id="testNewBtn" type="button">New test</button>
          <button class="btn-link" id="testPrintBtn" type="button">Print</button>
        </div>
      </section>`;
  }

  PDFStudy.testReport = { grade, reportHtml, verdict };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.testReport;
})(typeof window !== 'undefined' ? window : globalThis);

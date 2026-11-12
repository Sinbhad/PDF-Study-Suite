/**
 * Quiz tab: instant check + explanation + source page jump, one at a time or all questions,
 * results with "Retry missed". Multiple choice / cloze are answered with A-D or 1-9; `reveal`
 * questions with Space/Enter (show answer) then G (got it) / M (missed it), feeding the same score.
 * Question markup is shared with the practice test via quiz-card.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  let viewMode = 'single'; // 'single' | 'all' (remembered between renders)

  function renderQuizView(container, rawQuestions, scopeTitle) {
    if (!container) return;
    const sv = PDFStudy.studyViews;
    const QC = PDFStudy.quizCard;
    const st = (PDFStudy.main && PDFStudy.main.appState) || { quizCount: 10, quizSeed: 0 };
    const regen = (count, seed) => PDFStudy.main && PDFStudy.main.regenerateQuiz(count, seed);
    const questions = (rawQuestions || []).filter(QC.isValid);

    if (questions.length === 0) {
      PDFStudy.keys.set('quiz', null);
      container.innerHTML = sv.viewHead('Quiz', scopeTitle) +
        sv.emptyState('Not enough material for a quiz', 'Pick a section with definitions, theorems or formulas to build questions from.');
      return;
    }

    let active = questions;
    let retrying = false;
    let idx = 0;
    let showResults = false;
    let announce = '';
    const answers = {}; // qid -> option index | 'got' | 'missed'
    const shown = {}; // qid -> reveal answer visible

    const isAnswered = (q) => answers[q.id] !== undefined;
    const isRight = (q) => QC.isCorrect(q, answers[q.id]);
    const firstUnanswered = () => active.findIndex((q) => !isAnswered(q));
    const allDone = () => active.every(isAnswered);
    const currentQuestion = () => (viewMode === 'single' ? active[idx] : active[firstUnanswered()]);

    function answer(q, value) {
      if (!q || isAnswered(q)) return;
      answers[q.id] = value;
      const plain = PDFStudy.richText ? PDFStudy.richText.plain(q.answer) : q.answer;
      announce = QC.isReveal(q) ? (isRight(q) ? 'Marked as correct.' : 'Marked as missed.') : isRight(q) ? 'Correct.' : `Incorrect. The answer is ${plain}.`;
      draw();
      const next = container.querySelector('#quizNextBtn');
      if (next) next.focus();
    }
    function show(q) {
      if (!q || shown[q.id]) return;
      shown[q.id] = true;
      announce = `Answer: ${PDFStudy.richText ? PDFStudy.richText.plain(q.answer) : q.answer}`;
      draw();
      const got = container.querySelector(`[data-qcard="${root.CSS && CSS.escape ? CSS.escape(q.id) : q.id}"] [data-grade="got"]`);
      if (got) got.focus();
    }
    function goNext() {
      if (idx < active.length - 1) idx += 1;
      else showResults = true;
      draw();
    }
    function retryMissed() {
      active = active.filter((q) => !isRight(q));
      [answers, shown].forEach((o) => Object.keys(o).forEach((k) => delete o[k]));
      retrying = true;
      idx = 0;
      showResults = false;
      draw();
    }

    PDFStudy.keys.set('quiz', (e) => {
      if (!container.isConnected || (viewMode === 'single' && showResults)) return false;
      const q = currentQuestion();
      if (!q || isAnswered(q)) return false;
      const k = e.key.toLowerCase();
      if (QC.isReveal(q)) {
        if (!shown[q.id] && (k === ' ' || k === 'enter')) show(q);
        else if (shown[q.id] && (k === 'g' || k === 'm')) answer(q, k === 'g' ? 'got' : 'missed');
        else return false;
        return true;
      }
      const i = /^[1-9]$/.test(k) ? parseInt(k, 10) - 1 : /^[a-j]$/.test(k) ? k.charCodeAt(0) - 97 : -1;
      if (i < 0 || i >= q.options.length) return false;
      answer(q, i);
      return true;
    });

    const card = (q, num) => QC.questionCard(q, num, { picked: answers[q.id], reveal: isAnswered(q), locked: isAnswered(q), shown: !!shown[q.id] });

    /** After a one-at-a-time run: every question with its verdict, missed ones first. */
    function reviewList() {
      const order = active.map((q, i) => ({ q, n: i + 1 })).sort((a, b) => isRight(a.q) - isRight(b.q) || a.n - b.n);
      return `<section class="sec"><h3 class="sec-title">Review your answers</h3><div class="q-list">${order.map((o) => card(o.q, o.n)).join('')}</div></section>`;
    }

    function resultsCard() {
      const correct = active.filter(isRight).length;
      const missed = active.length - correct;
      return `
        <section class="results" aria-label="Results">
          <p class="eyebrow">${retrying ? 'Retry results' : 'Results'}</p>
          <p class="score">${correct} / ${active.length}</p>
          <p class="results-line">${Math.round((correct / active.length) * 100)}% correct</p>
          <div class="results-actions">
            ${missed > 0 ? `<button class="btn btn-primary" id="retryMissedBtn" type="button">Retry missed (${missed})</button>` : ''}
            <button class="btn ${missed > 0 ? 'btn-secondary' : 'btn-primary'}" id="newQuizSetBtn" type="button">New quiz</button>
          </div>
        </section>`;
    }

    function draw() {
      const answered = active.filter(isAnswered).length;
      const correct = active.filter(isRight).length;
      const single = viewMode === 'single';
      const results = allDone() && (!single || showResults);
      const qMax = st.quizCount || 10;
      const cur = single ? active[Math.min(idx, active.length - 1)] : null;
      const body = single
        ? results ? resultsCard() + reviewList() : card(cur, idx + 1)
        : `${results ? resultsCard() : ''}<div class="q-list">${active.map((q, i) => card(q, i + 1)).join('')}</div>`;
      const nav = single && !results && cur && isAnswered(cur)
        ? `<div class="q-nav"><button class="btn btn-primary" id="quizNextBtn" type="button">${idx === active.length - 1 ? 'See results' : 'Next question'}</button></div>`
        : '';
      const status = single && !results ? `Question ${idx + 1} of ${active.length}` : `${answered} of ${active.length} answered`;
      const hint = !cur || results || isAnswered(cur) ? '' : QC.isReveal(cur) ? 'Space shows the answer · G got it · M missed it' : 'Press A–D or 1–4 to answer';

      container.innerHTML = `
        ${sv.viewHead('Quiz', scopeTitle, `${status} · ${correct} correct${retrying ? ' · missed questions only' : ''}`)}
        <div class="view-tools">
          <div class="chip-row" role="group" aria-label="Layout">${sv.chip('data-mode="single"', single, 'One at a time')}${sv.chip('data-mode="all"', !single, 'All questions')}</div>
          <div class="chip-row" role="group" aria-label="Quiz length">
            <span class="label">Length</span>${[5, 10, 15].map((n) => sv.chip(`data-qcount="${n}"`, qMax === n, String(n))).join('')}
            <button class="btn-link" id="newQuizSetBtn2" type="button">New quiz</button>
          </div>
        </div>
        <div class="progress q-progress" role="progressbar" aria-label="Quiz progress" aria-valuemin="0"
             aria-valuemax="${active.length}" aria-valuenow="${answered}">
          <div class="progress-fill" style="width:${Math.round((answered / active.length) * 100)}%"></div>
        </div>
        ${body}${nav}
        ${hint ? `<p class="key-hint">${hint}</p>` : ''}
        <div class="sr-only" id="quizLive" role="status" aria-live="polite"></div>`;

      bind();
      if (announce) {
        const live = container.querySelector('#quizLive');
        const msg = announce;
        announce = '';
        setTimeout(() => { if (live) live.textContent = msg; }, 60);
      }
    }

    function bind() {
      QC.bindOptions(container, active, answer, show);
      container.querySelectorAll('[data-mode]').forEach((btn) => {
        btn.onclick = () => {
          viewMode = btn.getAttribute('data-mode');
          const u = firstUnanswered();
          idx = u >= 0 ? u : active.length - 1;
          showResults = false;
          draw();
        };
      });
      container.querySelectorAll('[data-qcount]').forEach((btn) => {
        btn.onclick = () => regen(parseInt(btn.getAttribute('data-qcount'), 10), st.quizSeed || 0);
      });
      const newQuiz = () => regen(st.quizCount || 10, (st.quizSeed || 0) + 1);
      ['#newQuizSetBtn', '#newQuizSetBtn2'].forEach((sel) => {
        const b = container.querySelector(sel);
        if (b) b.onclick = newQuiz;
      });
      const nextBtn = container.querySelector('#quizNextBtn');
      if (nextBtn) nextBtn.onclick = goNext;
      const retry = container.querySelector('#retryMissedBtn');
      if (retry) retry.onclick = retryMissed;
    }

    draw();
  }

  PDFStudy.quizView = { renderQuizView };
})(typeof window !== 'undefined' ? window : globalThis);

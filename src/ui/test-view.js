/**
 * Practice Test tab: a full exam sheet grouped by section, untimed or timed, answers changeable
 * until "Submit test" (reveal questions are self-graded), then a score report by skill, review of
 * the missed items with explanations + source page jumps, and "Retry missed".
 * Generation: studyPipeline.practiceTest (testEngine.generateTest with the scope's cards, blocks and the
 * student's flagged sources; -> { title, sections: [{ name, questions }], total }). Grading/report: test-report.js.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const TIMERS = [0, 15, 30, 60]; // minutes, 0 = untimed
  let S = null; // current test session (survives tab switches for the same scope)
  let ticker = null;

  function normalize(res, scopeTitle) {
    if (!res) return null;
    let sections;
    if (Array.isArray(res)) sections = [{ name: 'Questions', questions: res }];
    else if (Array.isArray(res.sections)) sections = res.sections.map((s) => ({ name: s.name || s.title || 'Questions', questions: s.questions || [] }));
    else if (Array.isArray(res.questions)) sections = [{ name: 'Questions', questions: res.questions }];
    else return null;
    const seen = new Set();
    sections.forEach((sec, si) => {
      sec.questions = sec.questions.filter(PDFStudy.quizCard.isValid).map((q, qi) => {
        const id = seen.has(String(q.id)) || q.id == null ? `t${si}-${qi}` : String(q.id);
        seen.add(id);
        return { ...q, id };
      });
    });
    sections = sections.filter((s) => s.questions.length);
    return sections.length ? { raw: res, title: res.title || `Practice test: ${scopeTitle}`, sections } : null;
  }

  /** A new test from the same inputs as the first build (study-pipeline.js: cards, blocks, flagged sources). */
  function generate(st, seed) {
    const sp = PDFStudy.studyPipeline;
    if (!sp || !sp.practiceTest) return null;
    try {
      return normalize(sp.practiceTest(st, seed), st.selectedScope.title);
    } catch (_e) {
      return null;
    }
  }

  function newSession(test, opts = {}) {
    const questions = test ? test.sections.flatMap((s) => s.questions) : [];
    return { key: opts.key, seed: opts.seed || 0, test, questions, answers: {}, shown: {}, submitted: false, result: null,
      minutes: opts.minutes || 0, startedAt: Date.now(), retry: !!opts.retry, reviewAll: false, timedOut: false };
  }

  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
  const remaining = () => Math.max(0, Math.round(S.minutes * 60 - (Date.now() - S.startedAt) / 1000));
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  function renderTestView(container, scopeTitle, initialTest = null) {
    if (!container) return;
    const st = PDFStudy.main && PDFStudy.main.appState;
    const sv = PDFStudy.studyViews;
    const QC = PDFStudy.quizCard;
    const TR = PDFStudy.testReport;
    const key = st ? `${st.docName}|${st.selectedScope.id}|${st.activeMode}` : `direct|${scopeTitle}`;
    if (!S || S.key !== key) {
      const built = initialTest ? normalize(initialTest, scopeTitle) : st ? generate(st, 0) : null;
      S = newSession(built, { key });
    }
    stopTicker();
    const answeredCount = () => Object.keys(S.answers).length;
    const cardState = (q) => ({ picked: S.answers[q.id], reveal: S.submitted, locked: S.submitted, shown: !!S.shown[q.id], typedMode: 'sheet' });

    function submit(timedOut) {
      stopTicker();
      S.submitted = true;
      S.timedOut = !!timedOut;
      S.elapsed = Math.round((Date.now() - S.startedAt) / 1000);
      S.result = TR.grade(S.test && S.test.raw, S.questions, S.answers);
      draw();
      const rep = container.querySelector('.test-report');
      if (rep && rep.scrollIntoView) rep.scrollIntoView({ block: 'start' });
      if (rep) rep.focus({ preventScroll: true }); // the Submit button is gone: keyboard focus starts at the score
    }
    /** After a redraw that removed the button just used, focus `sel` (or the first question's first control). */
    function refocus(sel) {
      const target = (sel && container.querySelector(sel)) || container.querySelector('.q-card .q-opt:not(:disabled), .q-card [data-show-qid], .q-card .q-typed-input:not(:disabled)');
      if (target) target.focus();
    }
    const cardSel = (q) => `[data-qcard="${root.CSS && CSS.escape ? CSS.escape(q.id) : q.id}"]`;

    /** The answered count and the bar, without redrawing the sheet (a typed answer keeps its field and caret). */
    function refreshProgress() {
      const n = answeredCount();
      const lbl = container.querySelector('#testAnswered');
      if (lbl) lbl.textContent = `${n} of ${S.questions.length} answered`;
      const fill = container.querySelector('#testProgressFill');
      if (fill) fill.style.width = `${Math.round((n / S.questions.length) * 100)}%`;
    }
    // Typed answers on the sheet: kept as typed until "Submit test"; Enter moves on; "I was right" after submitting.
    const typed = {
      onDraft(q, text) {
        if (S.submitted) return;
        if (String(text).trim()) S.answers[q.id] = { typed: text };
        else delete S.answers[q.id];
        refreshProgress();
      },
      onEnter(q) {
        const card = container.querySelector(cardSel(q));
        const open = Array.from(container.querySelectorAll('.q-opt:not(:disabled), [data-show-qid], .q-typed-input:not(:disabled), #testSubmitBtn'));
        const next = card ? open.find((el) => !card.contains(el) && (card.compareDocumentPosition(el) & 4)) : null;
        if (next) next.focus();
      },
      onOverride(q) {
        if (!S.submitted || !S.answers[q.id]) return;
        S.answers[q.id] = { ...S.answers[q.id], override: true };
        TR.markRight(q);
        if (PDFStudy.attemptLog) PDFStudy.attemptLog.overridden(q, S.answers[q.id], true);
        draw();
        PDFStudy.questionFlags.say(container, 'Counted as right. The question is marked so its answer can be checked.');
        // The button is gone: on to the next question's controls, or back to the score.
        const card = container.querySelector(cardSel(q));
        const later = card ? Array.from(container.querySelectorAll('.q-card button, .q-card a')).find((el) => !card.contains(el) && (card.compareDocumentPosition(el) & 4)) : null;
        const target = later || (card && card.querySelector('.q-bad')) || container.querySelector('.test-report');
        if (target) target.focus({ preventScroll: !later });
      },
    };

    /** Re-render one question in place (keeps scroll position), then refresh the progress line. */
    function redrawCard(q) {
      const sel = `[data-qcard="${root.CSS && CSS.escape ? CSS.escape(q.id) : q.id}"]`;
      const card = container.querySelector(sel);
      if (card) {
        // The card is replaced: put keyboard focus back on the same control (Show answer -> "I got it").
        const had = card.contains(document.activeElement) ? document.activeElement : null;
        const again = !had ? '' : had.hasAttribute('data-opt-idx') ? `[data-opt-idx="${had.getAttribute('data-opt-idx')}"]`
          : had.hasAttribute('data-grade') ? `[data-grade="${had.getAttribute('data-grade')}"]` : had.hasAttribute('data-show-qid') ? '[data-grade="got"]' : '';
        card.outerHTML = QC.questionCard(q, S.questions.indexOf(q) + 1, cardState(q));
        QC.bindOptions(container, S.questions, pick, show);
        const target = again && container.querySelector(`${sel} ${again}`);
        if (target) target.focus();
      }
      refreshProgress();
    }
    function pick(q, value) {
      if (S.submitted) return;
      S.answers[q.id] = value;
      redrawCard(q);
    }
    function show(q) {
      S.shown[q.id] = true;
      redrawCard(q);
    }

    function sheetHtml() {
      const visible = (q) => !S.submitted || S.reviewAll || S.result.missed.includes(q);
      const sections = S.retry ? [{ name: 'Missed questions', questions: S.questions }] : S.test.sections;
      return sections.map((sec) => {
        const cards = sec.questions.map((q) => (visible(q) ? QC.questionCard(q, S.questions.indexOf(q) + 1, cardState(q)) : '')).join('');
        const heading = sections.length > 1 ? sv.titled('h3', 'sec-title', sec.name, 120) : '';
        return cards ? `<section class="test-section">${heading}<div class="q-list">${cards}</div></section>` : '';
      }).join('');
    }

    function draw() {
      const head = (meta) => sv.viewHead(S.retry ? 'Practice test · retry' : 'Practice test', scopeTitle, meta);
      if (!S.test || !S.questions.length) {
        container.innerHTML = head('') + sv.whyEmpty('test', 'Not enough material for a practice test', 'Pick a chapter or a longer page range with theorems, formulas or definitions.');
        return;
      }
      const n = answeredCount();
      const total = S.questions.length;
      const timerChips = TIMERS.map((m) => sv.chip(`data-test-min="${m}"`, S.minutes === m, m ? `${m} min` : 'Untimed')).join('');
      const meta = `${total} question${total === 1 ? '' : 's'}${S.test.sections.length > 1 ? ` · ${S.test.sections.length} sections` : ''}`;
      container.innerHTML = `
        ${head(meta)}
        ${S.submitted ? TR.reportHtml(S.result, { retry: S.retry, reviewAll: S.reviewAll, elapsed: S.elapsed, timedOut: S.timedOut }) : `
        <div class="view-tools"><div class="chip-row" role="group" aria-label="Time limit"><span class="label">Timer</span>${timerChips}</div></div>
        <div class="test-status">
          <span class="q-status" id="testAnswered">${n} of ${total} answered</span>
          ${S.minutes ? `<span class="test-timer" id="testTimer" role="timer" aria-live="off">${fmt(remaining())}</span>` : ''}
        </div>
        <div class="progress q-progress" aria-hidden="true"><div class="progress-fill" id="testProgressFill" style="width:${Math.round((n / total) * 100)}%"></div></div>`}
        ${S.submitted ? `<h3 class="sec-title">${S.reviewAll ? 'All answers' : 'Missed items'}<span class="sec-count">${S.reviewAll ? total : S.result.missed.length}</span></h3>` : ''}
        <div class="test-sheet">${sheetHtml()}</div>
        ${S.submitted ? '' : '<div class="q-nav"><button class="btn btn-primary" id="testSubmitBtn" type="button">Submit test</button></div>'}`;
      QC.bindOptions(container, S.questions, pick, show, { redraw: draw, answers: S.answers, retrying: S.retry, typed });
      const $ = (sel) => container.querySelector(sel);
      if ($('#testSubmitBtn')) {
        $('#testSubmitBtn').onclick = () => {
          const left = total - answeredCount();
          if (left && root.confirm && !root.confirm(`${left} question${left > 1 ? 's are' : ' is'} unanswered. Submit anyway?`)) return;
          submit(false);
        };
      }
      container.querySelectorAll('[data-test-min]').forEach((b) => {
        b.onclick = () => { S.minutes = +b.getAttribute('data-test-min'); S.startedAt = Date.now(); draw(); };
      });
      if ($('#testRetryMissedBtn')) {
        $('#testRetryMissedBtn').onclick = () => {
          S = newSession({ raw: null, sections: [{ name: 'Missed questions', questions: S.result.missed }] }, { key: S.key, seed: S.seed, minutes: S.minutes, retry: true });
          draw();
          refocus();
        };
      }
      if ($('#testReviewToggleBtn')) $('#testReviewToggleBtn').onclick = () => { S.reviewAll = !S.reviewAll; draw(); refocus('#testReviewToggleBtn'); };
      if ($('#testNewBtn')) $('#testNewBtn').onclick = () => { const seed = S.seed + 1; S = newSession(generate(st, seed), { key, seed, minutes: S.minutes }); draw(); refocus(); };
      if ($('#testPrintBtn')) $('#testPrintBtn').onclick = () => root.print && root.print();
      if (S.minutes && !S.submitted) {
        ticker = setInterval(() => {
          if (!container.isConnected || !container.querySelector('#testTimer')) return stopTicker();
          const left = remaining();
          container.querySelector('#testTimer').textContent = fmt(left);
          container.querySelector('#testTimer').classList.toggle('timer-low', left <= 60);
          if (left <= 0) submit(true);
        }, 1000);
      }
    }

    draw();
  }

  /** Number of questions the practice test will actually show (drives the tab count). */
  const count = (res, scopeTitle) => { const t = normalize(res, scopeTitle); return t ? t.sections.reduce((n, s) => n + s.questions.length, 0) : 0; };

  /** True when the student has answered or submitted the test on the sheet (a rebuild must not replace it unasked). */
  const inProgress = () => !!(S && (S.submitted || Object.keys(S.answers).length > 0));

  PDFStudy.testView = { renderTestView, count, inProgress, _normalize: normalize, reset: () => { S = null; stopTicker(); } };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.testView;
})(typeof window !== 'undefined' ? window : globalThis);

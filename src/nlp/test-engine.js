/**
 * Practice Test / Exam Generator (PDFStudy.testEngine) — ratified contract (#9/#13 on the swarm board).
 * generateTest(input, { maxQuestions, mode, didacticBlocks, sections, scopeTitle, seedOffset })
 *   -> { title, sections: [{ name, questions }], questions, total, skills }
 * Questions share the quizEngine shape plus `skill` ('formula'|'theorem'|'definition'|'complexity'),
 * `section`, `pageNumber`. Adds definition-matching items (term -> which statement defines it) whose
 * options are same-kind sibling statements of comparable length. gradeTest(test, answers) scores it.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const qe = () => dep('quizEngine', './quiz-engine.js');
  const fe = () => dep('flashcardEngine', './flashcard-engine.js');
  const mt = () => dep('mathText', './math-text.js');
  const sd = () => dep('stemDistractors', './stem-distractors.js');
  const sq = () => dep('stemQuestions', './stem-questions.js');

  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

  /** "Which statement correctly defines/states X?" with sibling statements of comparable length. */
  function matchingQuestions(cards, limit, seedOffset) {
    const prose = cards.filter((c) => !sq().isFormulaCard(c) && !/^(?:qa|overview)$/.test(c.kind || '') &&
      c.back.length >= 30 && c.back.length <= 320 && !norm(c.back).includes(norm(c.front)));
    const out = [];
    for (const card of prose) {
      if (out.length >= limit) break;
      const len = card.back.length;
      const hasM = mt().hasMathToken(card.back);
      const sibs = prose.filter((o) => o !== card && (o.kind || 'definition') === (card.kind || 'definition') &&
        mt().hasMathToken(o.back) === hasM &&
        o.back.length >= len * 0.45 && o.back.length <= len * 2.2 && norm(o.back) !== norm(card.back));
      if (sibs.length < 3) continue;
      const verb = card.kind === 'theorem' ? 'states' : card.kind === 'algorithm' ? 'describes' : 'defines';
      const question = `Which statement correctly ${verb} the ${card.front}?`;
      const distractors = sd().deterministicShuffle(sibs, card.front, seedOffset).slice(0, 3).map((o) => o.back);
      out.push({
        type: 'multiple_choice',
        badge: `Definition Match • ${card.category || 'Concept'}`,
        question,
        options: sd().deterministicShuffle([card.back, ...distractors], question, seedOffset),
        answer: card.back,
        explanation: `${card.front} (${card.context || 'source'}): ${card.back}`,
        skill: sq().skillOf(card),
        category: card.category,
        pageNumber: card.pageNumber || null,
      });
    }
    return out;
  }

  function buildSection(name, input, opts, budget) {
    const { mode = 'book', didacticBlocks = [], seedOffset = 0 } = opts;
    const quiz = qe().generateQuiz(input, { maxQuestions: budget, mode, didacticBlocks, seedOffset });
    const cards =
      mode === 'slides' && Array.isArray(input)
        ? fe().extractSlideFlashcards(input)
        : fe().extractBookFlashcards(String(input || ''), name, didacticBlocks);
    const asked = new Set(quiz.map((q) => norm(q.answer)));
    const matching = matchingQuestions(cards.filter((c) => !asked.has(norm(c.front))), Math.ceil(budget / 3), seedOffset);
    const questions = [...quiz.map((q) => ({ skill: 'definition', ...q })), ...matching];
    return { name, questions: questions.map((q) => ({ ...q, section: name })) };
  }

  /** Round-robin by skill so a test mixes formulas, theorems, definitions and complexity items. */
  function interleave(questions) {
    const groups = new Map();
    for (const q of questions) {
      if (!groups.has(q.skill)) groups.set(q.skill, []);
      groups.get(q.skill).push(q);
    }
    const lists = [...groups.values()];
    const out = [];
    for (let i = 0; out.length < questions.length; i++) lists.forEach((l) => l[i] && out.push(l[i]));
    return out;
  }

  function generateTest(input, options = {}) {
    const { maxQuestions = 20, scopeTitle = 'Practice Test', sections } = options;
    const specs = Array.isArray(sections) && sections.length
      ? sections.map((s, i) => ({ name: s.name || s.title || `Section ${i + 1}`, input: s.text || s.input || '', blocks: s.didacticBlocks }))
      : [{ name: scopeTitle, input, blocks: options.didacticBlocks }];
    const per = Math.max(4, Math.ceil(maxQuestions / specs.length));
    const seen = new Set();
    const built = specs.map((s) => {
      const sec = buildSection(s.name, s.input, { ...options, didacticBlocks: s.blocks || [] }, per);
      sec.questions = interleave(sec.questions).filter((q) => {
        const key = norm(q.question) + '|' + norm(q.answer);
        if (seen.has(key) || !q.options || q.options.length < 2) return false;
        seen.add(key);
        return true;
      });
      return sec;
    });
    // Trim proportionally to maxQuestions, then number questions t-1..t-N across the whole test.
    const total = built.reduce((n, s) => n + s.questions.length, 0);
    const keep = Math.min(1, maxQuestions / Math.max(1, total));
    let n = 0;
    for (const s of built) {
      s.questions = s.questions.slice(0, Math.max(1, Math.round(s.questions.length * keep))).map((q) => ({ ...q, id: `t-${++n}` }));
    }
    const sectionsOut = built.filter((s) => s.questions.length);
    const questions = sectionsOut.flatMap((s) => s.questions).slice(0, maxQuestions);
    const skills = questions.reduce((m, q) => ({ ...m, [q.skill]: (m[q.skill] || 0) + 1 }), {});
    return { title: scopeTitle, sections: sectionsOut, questions, total: questions.length, skills };
  }

  /** answers: { [questionId]: chosenOptionString } or an array aligned with test.questions. */
  function gradeTest(test, answers = {}) {
    const qs = (test && (test.questions || (test.sections || []).flatMap((s) => s.questions))) || [];
    const bySkill = {};
    const bySection = {};
    const missed = [];
    let score = 0;
    const same = (a, b) => (mt().isFormula(a) ? mt().formulaKey(a) === mt().formulaKey(b) : norm(a) === norm(b));
    qs.forEach((q, i) => {
      const given = Array.isArray(answers) ? answers[i] : answers[q.id];
      const ok = given !== undefined && given !== null && same(given, q.answer);
      for (const [map, key] of [[bySkill, q.skill || 'definition'], [bySection, q.section || 'Test']]) {
        map[key] = map[key] || { correct: 0, total: 0 };
        map[key].total++;
        if (ok) map[key].correct++;
      }
      if (ok) score++;
      else missed.push({ id: q.id, question: q.question, answer: q.answer, given: given ?? null, explanation: q.explanation, skill: q.skill, pageNumber: q.pageNumber || null });
    });
    const total = qs.length;
    return { score, total, percent: total ? Math.round((score / total) * 100) : 0, bySkill, bySection, missed };
  }

  const api = { generateTest, generatePracticeTest: generateTest, gradeTest, matchingQuestions };
  PDFStudy.testEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

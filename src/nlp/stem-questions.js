/**
 * STEM Question Builders shared by quiz-engine.js and test-engine.js.
 * formulaQuestion: "Which expression gives the derivative of $\tan x$?" with typed formula/complexity options.
 * skillOf: practice-test skill tag ('formula'|'theorem'|'definition'|'complexity') for a question/card.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const dep = (k, f) => PDFStudy[k] || (typeof require === 'function' ? require(f) : null);
  const mt = () => dep('mathText', './math-text.js');
  const sd = () => dep('stemDistractors', './stem-distractors.js');

  /** Cards whose back is itself a formula / complexity answer (asked in reverse: name -> expression). */
  function isFormulaCard(card) {
    return Boolean(card) && /^(?:formula|algorithm)$/.test(card.kind || '') && mt().isFormula(card.back);
  }

  function skillOf(card, answer) {
    if (answer && mt().isComplexity(answer)) return 'complexity';
    if (answer && mt().isFormula(answer)) return 'formula';
    const kind = (card && card.kind) || '';
    if (kind === 'theorem') return 'theorem';
    if (kind === 'algorithm') return 'complexity';
    if (kind === 'formula') return 'formula';
    return 'definition';
  }

  function promptFor(front) {
    const f = String(front || '').trim();
    if (/^(?:Derivative|Integral|Antiderivative|Limit|Time|Space|Running|Recurrence|Inverse)\b/i.test(f)) {
      return `Which expression gives the ${f[0].toLowerCase()}${f.slice(1)}?`;
    }
    return `Which formula correctly states the ${f}?`;
  }

  /** Reverse formula MCQ, or null when three distinct typed distractors cannot be built. */
  function formulaQuestion(card, formulaPool, id, seedOffset = 0) {
    if (!isFormulaCard(card)) return null;
    const answer = card.back.trim();
    const distractors = sd().selectDistractors(answer, formulaPool || [], card.front, 3, seedOffset, {});
    if (distractors.length < 3) return null;
    const question = promptFor(card.front);
    return {
      id,
      type: 'multiple_choice',
      badge: `${mt().isComplexity(answer) ? 'Complexity' : 'Formula'} • ${card.category || 'Formula'}`,
      question,
      options: sd().deterministicShuffle([answer, ...distractors], question, seedOffset),
      answer,
      explanation: `${card.front} (${card.context || 'source'}): ${answer}`,
      skill: skillOf(card, answer),
      category: card.category,
      pageNumber: card.pageNumber || null,
    };
  }

  const api = { isFormulaCard, skillOf, promptFor, formulaQuestion };
  PDFStudy.stemQuestions = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

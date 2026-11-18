/**
 * Why a selection with real text produced no (or very few) cards or questions, in plain words.
 * Pure: takes counts measured from the selection, returns the reason and the sentence to show.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const SHORT_WORDS = 120;
  const THIN_PAGE_WORDS = 40; // a page under this is mostly a figure, a title or white space
  const FEW_QUESTIONS = 3;

  const countWords = (text) => (String(text || '').match(/\S+/g) || []).length;

  /**
   * facts: { words, pages, thinPages, exerciseWords, exampleBlocks, blocks, found? } (found = cards and questions
   * the selection did give, which only changes the wording)
   * -> 'short' | 'exercises' | 'figures' | 'plain'
   */
  function reasonFor(facts) {
    const f = facts || {};
    const words = f.words || 0;
    const mostlyExamples = (f.blocks || 0) >= 3 && (f.exampleBlocks || 0) / f.blocks >= 0.6;
    if ((f.exerciseWords || 0) > words * 0.6 || mostlyExamples) return 'exercises';
    if ((f.pages || 0) > 0 && (f.thinPages || 0) / f.pages >= 0.5 && words / f.pages < 80) return 'figures';
    if (words < SHORT_WORDS) return 'short';
    return 'plain';
  }

  /** what: "this section" | "these slides" | "this slide" | "these pages" | "this chapter" */
  function sentence(reason, what, facts) {
    const cap = what.charAt(0).toUpperCase() + what.slice(1);
    const plural = /^these /.test(what);
    if (reason === 'short') {
      const n = Math.max(0, Math.round(((facts && facts.words) || 0) / 10) * 10);
      return `${cap} ${plural ? 'are' : 'is'} short${n ? ` (about ${n} words)` : ''}, so there is not much to build from.`;
    }
    if (reason === 'exercises') {
      return `${cap} ${plural ? 'are' : 'is'} mostly worked examples and exercises. Those are for practising, so they do not turn into cards or questions.`;
    }
    if (reason === 'figures') {
      return `${cap} ${plural ? 'are' : 'is'} mostly figures, with little text to build from.`;
    }
    // Some cards or questions did come out: "no clear definitions" would contradict the summary beside it.
    if (facts && facts.found > 0) return `${cap} ${plural ? 'have' : 'has'} only a few clear definitions, theorems or formulas to ask about.`;
    return `${cap} ${plural ? 'have' : 'has'} no clear definitions, theorems or formulas to ask about.`;
  }

  const TITLES = {
    summary: 'Nothing to summarise here',
    flashcards: 'No flashcards here',
    quiz: 'Not enough material for a quiz',
    test: 'Not enough material for a practice test',
  };

  /** Empty-tab message: { reason, title, text }. */
  function emptyMessage(tab, what, facts) {
    const reason = reasonFor(facts);
    return { reason, title: TITLES[tab] || TITLES.summary, text: sentence(reason, what, facts) };
  }

  /** One-line note for a quiz or test with fewer than three questions ('' otherwise). */
  function fewNote(count, what, facts) {
    if (!(count > 0 && count < FEW_QUESTIONS)) return '';
    const seen = Object.assign({}, facts, { found: Math.max(count, (facts && facts.found) || 0) });
    return `Only ${count} question${count === 1 ? '' : 's'} here. ${sentence(reasonFor(facts), what, seen)}`;
  }

  PDFStudy.thinResults = { reasonFor, sentence, emptyMessage, fewNote, countWords, THIN_PAGE_WORDS, FEW_QUESTIONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.thinResults;
})(typeof window !== 'undefined' ? window : globalThis);

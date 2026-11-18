/**
 * Small UI preferences in localStorage (theme, collapsed rail), file download and the Markdown
 * study-guide export. Study progress lives per document in IndexedDB (doc-store.js / doc-session.js);
 * the `knownCards` map that used to live here is only read once more, by takeLegacyKnown.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const STORAGE_KEY = 'pdf_study_suite_state_v1';

  function loadState() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_e) {
      return {};
    }
  }

  function saveState(state) {
    try {
      if (root.localStorage) {
        root.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
    } catch (_e) {
      // Ignore storage quota errors in restricted environments
    }
  }

  /**
   * Card fronts marked known for `docName` in the old `${docName}::${cardFront}` format. They are
   * removed from localStorage as they are returned, so they move to the per-document store once.
   */
  function takeLegacyKnown(docName) {
    const state = loadState();
    const known = state.knownCards || {};
    const prefix = `${docName}::`;
    const mine = Object.keys(known).filter((k) => k.startsWith(prefix));
    if (!mine.length) return [];
    const fronts = mine.filter((k) => known[k]).map((k) => k.slice(prefix.length));
    mine.forEach((k) => { delete known[k]; });
    saveState(state);
    return fronts;
  }

  /** Small UI preferences (theme, collapsed rail) kept alongside the study state. */
  function getPref(key, fallback) {
    const prefs = loadState().prefs || {};
    return prefs[key] === undefined ? fallback : prefs[key];
  }
  function setPref(key, value) {
    const state = loadState();
    state.prefs = { ...(state.prefs || {}), [key]: value };
    saveState(state);
  }

  function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportStudyGuideMarkdown({ docName, scopeTitle, summary, flashcards: generatedCards, quiz: generatedQuiz }) {
    // What the student sees: their edits and own cards in, deleted cards and bad questions out.
    const flashcards = PDFStudy.docSession ? PDFStudy.docSession.deck(generatedCards).cards : generatedCards;
    const quiz = PDFStudy.quizCard ? (generatedQuiz || []).filter(PDFStudy.quizCard.isValid) : generatedQuiz;
    const blocks = (summary && summary.didacticBlocks) || [];
    const defs = ((summary && summary.definitions) || []).filter((d) => d && d.term && d.definition);
    const lines = [
      `# Study Guide: ${docName}`,
      `## Scope: ${scopeTitle}`,
      '',
      ...(defs.length ? ['### Definitions', ...defs.map((d) => `- **${d.term}**: ${d.definition}`), ''] : []),
      ...(blocks.length
        ? [
            `### Theorems, Formulas & Definitions (${blocks.length})`,
            ...blocks.map((b) => `- **[${b.category}] ${b.title}**: ${b.body}`),
            '',
          ]
        : []),
      '### Key Concepts',
      ((summary && summary.keyTerms) || []).map((t) => `\`${t}\``).join(' • ') || 'None extracted',
      '',
      '### Executive Summary',
      ...((summary && summary.sentences) || []).map((s) => `- ${s}`),
      '',
      `### Flashcards (${(flashcards || []).length})`,
      ...(flashcards || []).map((c, i) => `${i + 1}. **${c.front}** — ${c.back} *(${c.context || ''})*`),
      '',
      `### Practice Quiz (${(quiz || []).length} Questions)`,
      ...(quiz || []).map(
        (q, i) =>
          `${i + 1}. **[${q.badge || 'Question'}]** ${String(q.question || '').replace(/\n/g, ' ')}\n${
            Array.isArray(q.options) && q.options.length ? `   - Options: ${q.options.join(' | ')}\n` : ''}   - **Answer:** ${q.answer}`
      ),
    ];
    const safeName = (docName || 'study-guide').replace(/[^a-z0-9-_]/gi, '_');
    downloadFile(`${safeName}_study_guide.md`, lines.join('\n'), 'text/markdown;charset=utf-8');
  }

  PDFStudy.storage = {
    loadState,
    saveState,
    takeLegacyKnown,
    getPref,
    setPref,
    downloadFile,
    exportStudyGuideMarkdown,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.storage;
  }
})(typeof window !== 'undefined' ? window : globalThis);

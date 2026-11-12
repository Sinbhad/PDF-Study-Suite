/**
 * Offline Persistence & Study Export Utilities (localStorage + Anki TSV / Markdown Export)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const STORAGE_KEY = 'pdf_study_suite_state_v1';

  function loadState() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : { knownCards: {}, quizScores: {} };
    } catch (_e) {
      return { knownCards: {}, quizScores: {} };
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

  function toggleCardKnown(docName, cardFront) {
    const state = loadState();
    const key = `${docName}::${cardFront}`;
    state.knownCards[key] = !state.knownCards[key];
    saveState(state);
    return !!state.knownCards[key];
  }

  function isCardKnown(docName, cardFront) {
    const state = loadState();
    return !!state.knownCards[`${docName}::${cardFront}`];
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

  function exportStudyGuideMarkdown({ docName, scopeTitle, summary, flashcards, quiz }) {
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
    toggleCardKnown,
    isCardKnown,
    getPref,
    setPref,
    downloadFile,
    exportStudyGuideMarkdown,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PDFStudy.storage;
  }
})(typeof window !== 'undefined' ? window : globalThis);

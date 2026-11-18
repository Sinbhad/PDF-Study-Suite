/**
 * Study Inputs: what the card, quiz and test engines are given for the selected scope, in one place, so the
 * first build, "New quiz" and "New test" all ask from the same material.
 *   bookCardBlocks(scopeObj)        extraction's tagged blocks (definition, theorem, key-concept, self-check,
 *                                   syntax, example, sidebar, proof) plus its tables as kind 'table' blocks
 *   excludedSources(appState)       Set of source keys the student flagged as bad questions for this document
 *   loadFlags(appState)             reads the stored flags (docStore.flaggedSources) once the document is known
 *   engineOptions(appState, extra)  { mode, didacticBlocks, cards, lines, excludeSources } for generateQuiz / generateTest
 *   quizInput(appState)             the slides (never flattened to text) or the scope text the engines read
 * DOM-free; appState is main.js's state (activeMode, lastScopeObj, slideDeck, selectedScope, generated).
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function bookCardBlocks(scopeObj) {
    if (!scopeObj) return [];
    const blocks = scopeObj.blocks && scopeObj.blocks.length ? scopeObj.blocks : scopeObj.didacticBlocks || [];
    const tables = (scopeObj.tables || []).map((t) => ({ ...t, kind: 'table' }));
    return [...blocks, ...tables];
  }

  /** Flags saved with the document plus those made in this session (doc-session.js holds the live state). */
  function excludedSources(appState) {
    const keys = new Set((appState && appState.flaggedSourceKeys) || []);
    const session = PDFStudy.docSession;
    const ds = PDFStudy.docState;
    if (session && ds && typeof session.state === 'function') {
      for (const f of ds.flaggedSources(session.state())) keys.add(f.key);
    }
    return keys;
  }

  async function loadFlags(appState) {
    const store = PDFStudy.docStore;
    const session = PDFStudy.docSession;
    const id = session && typeof session.id === 'function' ? session.id() : null;
    if (!store || !id || id === 'detached') return;
    try {
      appState.flaggedSourceKeys = (await store.flaggedSources(id)).map((f) => f.key);
    } catch (_e) {
      appState.flaggedSourceKeys = appState.flaggedSourceKeys || [];
    }
  }

  /** Is the scope read as slides (a deck, or mind-map pages whose blocks behave like slides)? */
  function asSlides(appState) {
    const cs = PDFStudy.ocrCanvasScope;
    const canvas = appState.activeMode !== 'slide_deck' && Boolean(cs) && cs.useSlides(appState.lastScopeObj);
    return { slides: appState.activeMode === 'slide_deck' || canvas, canvas };
  }

  function quizInput(appState, scopeSlides) {
    const { slides, canvas } = asSlides(appState);
    if (canvas) return appState.lastScopeObj.canvas.slides;
    if (slides) return scopeSlides(appState);
    return (appState.lastScopeObj && appState.lastScopeObj.text) || '';
  }

  function engineOptions(appState, extra = {}) {
    const { slides } = asSlides(appState);
    const generated = appState.generated || {};
    return {
      mode: slides ? 'slides' : 'book',
      didacticBlocks: (!slides && appState.lastScopeObj && appState.lastScopeObj.didacticBlocks) || [],
      cards: Array.isArray(generated.flashcards) ? generated.flashcards : undefined,
      lines: (!slides && appState.lastScopeObj && appState.lastScopeObj.lines) || undefined,
      excludeSources: excludedSources(appState),
      ...extra,
    };
  }

  const api = { bookCardBlocks, excludedSources, loadFlags, engineOptions, quizInput, asSlides };
  PDFStudy.studyInputs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

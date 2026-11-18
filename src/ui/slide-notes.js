/**
 * Slide Notes: the student's own pen notes on a slide, shown under that slide in the Summary as a collapsed
 * "Your notes on this slide" list. Only notes the recogniser read as mostly real words are shown
 * (nlp/annotation-notes.js); they are never mixed into the slide's points.
 *   html(slideNumber)  -> '' or the <details> list for that slide of the open deck
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  let cache = { deck: null, vocab: null }; // the deck's vocabulary, worked out once per deck

  function slidesOf() {
    const st = PDFStudy.main && PDFStudy.main.appState;
    return (st && st.activeMode === 'slide_deck' && st.slideDeck && st.slideDeck.slides) || [];
  }

  function html(slideNumber) {
    const AN = PDFStudy.annotationNotes;
    const sv = PDFStudy.studyViews;
    const slides = slidesOf();
    if (!AN || !sv || !slides.length) return '';
    const slide = slides.find((s) => s.slideNumber === slideNumber);
    if (!slide || !(slide.annotations || []).length) return '';
    if (cache.deck !== slides) cache = { deck: slides, vocab: AN.vocabulary(slides) };
    const notes = AN.readable(slide.annotations, cache.vocab);
    if (!notes.length) return '';
    return `<details class="slide-notes">
        <summary>Your notes on this slide <span class="nums">(${notes.length})</span></summary>
        <ul>${notes.map((n) => `<li>${sv.escapeHtml(n)}</li>`).join('')}</ul>
      </details>`;
  }

  PDFStudy.slideNotes = { html };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.slideNotes;
})(typeof window !== 'undefined' ? window : globalThis);

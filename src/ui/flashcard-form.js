/**
 * Inline form for editing a flashcard or adding the student's own: Front, Back, Save, Cancel.
 * It takes the place of the card while open. Both sides are required; Escape cancels.
 *   html(card | null)                          null -> "Add a card"
 *   bind(container, { onSave(text), onCancel })  text: { front, back }
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  function html(card) {
    const esc = PDFStudy.studyViews.escapeHtml;
    const adding = !card;
    return `
      <form class="fc-form" id="fcForm" novalidate aria-labelledby="fcFormTitle">
        <h3 class="fc-form-title" id="fcFormTitle">${adding ? 'Add a card' : 'Edit card'}</h3>
        <label class="label" for="fcFrontInput">Front</label>
        <textarea class="input fc-textarea" id="fcFrontInput" rows="3" aria-describedby="fcFormHint fcFormError">${adding ? '' : esc(card.front)}</textarea>
        <label class="label" for="fcBackInput">Back</label>
        <textarea class="input fc-textarea" id="fcBackInput" rows="5" aria-describedby="fcFormHint fcFormError">${adding ? '' : esc(card.back)}</textarea>
        <p class="fc-form-hint" id="fcFormHint">Math goes between dollar signs, like $x^2$. Start a line with • to make a list.</p>
        <p class="fc-form-error" id="fcFormError" role="alert"></p>
        <div class="fc-form-actions">
          <button class="btn btn-primary" type="submit">${adding ? 'Add card' : 'Save'}</button>
          <button class="btn btn-secondary" id="fcFormCancel" type="button">Cancel</button>
        </div>
      </form>`;
  }

  function bind(container, handlers) {
    const form = container.querySelector('#fcForm');
    if (!form) return;
    const front = form.querySelector('#fcFrontInput');
    const back = form.querySelector('#fcBackInput');
    const error = form.querySelector('#fcFormError');
    const filled = (el) => PDFStudy.richBlocks.hasContent(el.value);

    form.onsubmit = (e) => {
      e.preventDefault();
      const empty = [front, back].filter((el) => !filled(el));
      [front, back].forEach((el) => el.setAttribute('aria-invalid', String(!filled(el))));
      if (empty.length) {
        error.textContent = empty.length === 2 ? 'Write something on both sides, then save.' : `The ${empty[0] === front ? 'front' : 'back'} is empty. Write something there, then save.`;
        empty[0].focus();
        return;
      }
      handlers.onSave({ front: front.value.trim(), back: back.value.trim() });
    };
    form.querySelector('#fcFormCancel').onclick = handlers.onCancel;
    form.onkeydown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      handlers.onCancel();
    };
    front.focus();
  }

  PDFStudy.flashcardForm = { html, bind };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.flashcardForm;
})(typeof window !== 'undefined' ? window : globalThis);

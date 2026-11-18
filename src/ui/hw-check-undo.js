/**
 * The Undo bar of the "Check what was read" screen. The bar itself is undo-bar.js, as in the study views;
 * here it is drawn inside the dialog (everything behind a modal dialog is inert) and there is one at a time.
 *   hwCheckUndo.offer(message, undo)   show "message [Undo]" for a few seconds
 *   hwCheckUndo.clear()                take it away without undoing (the dialog is closing)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const box = () => document.getElementById('hwCheckUndo');
  let pending = null;

  function clear() {
    if (pending) pending.clear();
    pending = null;
    if (box()) box().innerHTML = '';
  }

  function offer(message, undo) {
    const U = PDFStudy.undoBar;
    clear();
    const mine = U.start({
      message,
      undo,
      onExpire: () => {
        if (pending !== mine) return;
        U.dismiss(box(), mine, document.getElementById('hwDoneBtn'));
        pending = null;
      },
    });
    pending = mine;
    box().innerHTML = U.html(mine, { floating: true });
    box().querySelector('[data-undo]').removeAttribute('title'); // the U shortcut belongs to the study views
    U.bind(box(), mine, () => {
      if (pending === mine) pending = null;
      box().innerHTML = '';
    });
  }

  PDFStudy.hwCheckUndo = { offer, clear };
})(typeof window !== 'undefined' ? window : globalThis);

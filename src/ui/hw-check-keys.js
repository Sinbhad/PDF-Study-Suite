/**
 * Keyboard map of the "Check what was read" screen (no DOM): which action a key press means, given where
 * the focus is. The dialog element itself handles Esc (its native `cancel`) and Tab.
 *   actionFor({ key, shiftKey, ctrlKey, metaKey, altKey }, where)   where: 'field' | 'image' | 'other'
 *   -> 'accept' | 'back' | 'add' | 'accept-page' | 'next-line' | 'prev-line' | 'next-unsure' | 'prev-unsure'
 *    | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'zoom-in' | 'zoom-out' | 'fit' | null
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PAN = { ArrowLeft: 'pan-left', ArrowRight: 'pan-right', ArrowUp: 'pan-up', ArrowDown: 'pan-down' };
  const ZOOM = { '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out', '0': 'fit' };

  function fieldAction(e, command) {
    if (e.key === 'Enter') {
      if (command) return e.shiftKey ? 'accept-page' : 'add';
      if (e.altKey) return null;
      return e.shiftKey ? 'back' : 'accept';
    }
    if (e.altKey && !command && !e.shiftKey) {
      if (e.key === 'ArrowDown') return 'next-line';
      if (e.key === 'ArrowUp') return 'prev-line';
    }
    return null;
  }

  function imageAction(e, command) {
    if (command || e.altKey) return null;
    return PAN[e.key] || ZOOM[e.key] || null;
  }

  function actionFor(e, where) {
    if (!e) return null;
    const command = Boolean(e.ctrlKey || e.metaKey);
    // F8 works from anywhere in the dialog
    if (e.key === 'F8' && !command && !e.altKey) return e.shiftKey ? 'prev-unsure' : 'next-unsure';
    if (where === 'field') return fieldAction(e, command);
    if (where === 'image') return imageAction(e, command);
    if (e.key === 'Enter' && command && e.shiftKey) return 'accept-page';
    return null;
  }

  PDFStudy.hwCheckKeys = { actionFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCheckKeys;
})(typeof window !== 'undefined' ? window : globalThis);

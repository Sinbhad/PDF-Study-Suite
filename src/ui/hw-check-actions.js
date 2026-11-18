/**
 * What each button and key of the "Check what was read" screen does: change the page through
 * PDFStudy.ocrEdits, count it for the message shown after closing, say what happened, offer Undo where
 * something was taken away, and tell the frame (hw-check.js) what to draw and where focus goes.
 *   run(action, arg)   action names: hw-check-keys.js and the data-act attributes in the views
 *   flush()            keep what is typed in the field being edited (before another action, and on close)
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const C = () => PDFStudy.hwCheck;
  const E = () => PDFStudy.ocrEdits;
  const M = () => PDFStudy.hwCheckModel;
  const T = () => PDFStudy.hwCheckText;
  const L = () => PDFStudy.hwCheckLines;
  const byId = (id) => document.getElementById(id);
  const pane = () => byId('hwLinesBody');
  const key = (pageNumber, id) => `${pageNumber}:${id}`;

  const offerUndo = (message, undo) => PDFStudy.hwCheckUndo.offer(message, undo);

  /** After an Undo: draw the page it belongs to (going back to it if the student has moved on). */
  function back(pageNumber, focus) {
    const S = C().session();
    if (!S) return;
    if (S.pageNumber === pageNumber) C().render(focus);
    else C().showPage(pageNumber, focus);
  }

  /** Text typed into the current field counts as a fix even when the student leaves it without Enter. */
  function keepField(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    const typed = L().valueOf(pane(), id);
    if (!row || typed == null) return false;
    const value = E().cleanLine(typed);
    if (!value || value === E().cleanLine(row.text)) return false;
    E().setText(C().page(), id, value);
    S.done.lines.add(key(S.pageNumber, id));
    return true;
  }

  function flush() {
    const S = C().session();
    if (!S) return;
    if (S.kind === 'lines' && S.currentId != null) keepField(S.currentId);
    const area = byId('hwTypeArea');
    if (area && area.value.trim() && E().typePage(C().page(), area.value)) S.done.typed.add(S.pageNumber);
  }

  function accept(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    if (!row || row.state === 'picture') return;
    const value = E().cleanLine(L().valueOf(pane(), id));
    if (!value) {
      remove(id);
      return;
    }
    const changed = row.state === 'check' || value !== E().cleanLine(row.text);
    if (changed) {
      E().setText(C().page(), id, value);
      S.done.lines.add(key(S.pageNumber, id));
    }
    const after = C().rows();
    const left = after.filter((r) => r.state === 'check').length;
    if (changed) C().announce(T().checkedAnnouncement(row, left, S.pageNumber));
    const next = M().nextOnPage(after, id, 1);
    C().render(next ? { id: next } : 'primary');
  }

  /** Shift+Enter: keep the text as it is typed, leave the line to be checked, go to the one before. */
  function goBack(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    if (!row) return;
    const value = E().cleanLine(L().valueOf(pane(), id));
    if (value && value !== E().cleanLine(row.text)) {
      E().setText(C().page(), id, value, { accept: row.state !== 'check' });
      S.done.lines.add(key(S.pageNumber, id));
    }
    const prev = M().nextOnPage(C().rows(), id, -1);
    C().render({ id: prev || id });
  }

  function remove(id) {
    const S = C().session();
    const page = C().page();
    const pageNumber = S.pageNumber;
    const before = C().rows();
    const at = before.findIndex((r) => r.id === id);
    if (at === -1 || !E().removeRegion(page, id)) return;
    const k = key(pageNumber, id);
    const counted = S.done.lines.has(k);
    S.done.lines.add(k);
    const after = C().rows();
    const next = after[at] || after[at - 1];
    C().announce('Line removed.');
    C().render(next ? { id: next.id } : 'title');
    offerUndo('Line removed.', () => {
      E().restoreRegion(page, id);
      const now = C().session();
      if (now && !counted) now.done.lines.delete(k);
      back(pageNumber, { id });
    });
  }

  function add(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    const newId = E().addRegion(C().page(), row ? id : null, '');
    if (!newId) return;
    C().announce(row ? `Line added below line ${row.line}.` : 'Line added.');
    C().render({ id: newId });
    S.currentId = newId;
  }

  function keepAsPicture(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    if (!row || !E().setRegionKind(C().page(), id, 'picture')) return;
    S.done.pictures.add(key(S.pageNumber, id));
    C().announce(`Line ${row.line} will be kept as a picture.`);
    C().render({ id });
  }

  function useAsText(id) {
    const S = C().session();
    const row = C().rows().find((r) => r.id === id);
    if (!row || !E().setRegionKind(C().page(), id, row.math ? 'math' : 'text')) return;
    S.done.pictures.delete(key(S.pageNumber, id));
    C().render({ id });
  }

  function looksRight() {
    const S = C().session();
    const page = C().page();
    const pageNumber = S.pageNumber;
    const prior = E().confirmPage(page);
    if (!prior.length) {
      step(1);
      return;
    }
    const fresh = prior.map((p) => key(pageNumber, p.id)).filter((k) => !S.done.lines.has(k));
    fresh.forEach((k) => S.done.lines.add(k));
    C().announce(`All lines on page ${pageNumber} checked.`);
    C().render('primary');
    offerUndo(`${T().plural(prior.length, 'line')} accepted on page ${pageNumber}.`, () => {
      E().undoConfirm(page, prior);
      const now = C().session();
      if (now) fresh.forEach((k) => now.done.lines.delete(k));
      back(pageNumber, 'primary');
    });
  }

  /** Next (1) or previous (-1) page of the list; past the last page the dialog is done. */
  function step(dir) {
    const S = C().session();
    const list = C().entries();
    const next = dir > 0 ? list.find((e) => e.pageNumber > S.pageNumber) : list.filter((e) => e.pageNumber < S.pageNumber).pop();
    if (next) C().showPage(next.pageNumber, 'first');
    else if (dir > 0) C().close();
  }

  function skip() {
    const S = C().session();
    E().skipPage(C().page(), true);
    const next = C().entries().find((e) => e.pageNumber > S.pageNumber && e.status !== 'skipped');
    if (next) C().showPage(next.pageNumber, 'first');
    else C().render('title');
  }

  function saveTyped() {
    const S = C().session();
    const page = C().page();
    const pageNumber = S.pageNumber;
    const area = byId('hwTypeArea');
    if (!E().typePage(page, area.value)) {
      byId('hwTypeError').textContent = 'Type at least one line first.';
      area.focus();
      return;
    }
    const counted = S.done.typed.has(pageNumber);
    S.done.typed.add(pageNumber);
    S.typing = false;
    C().announce(`Page ${pageNumber} typed in.`);
    C().render('title');
    offerUndo(`Page ${pageNumber} typed in.`, () => {
      E().undoTypePage(page);
      const now = C().session();
      if (now && !counted) now.done.typed.delete(pageNumber);
      back(pageNumber, 'title');
    });
  }

  function keepPage(on) {
    const S = C().session();
    E().keepPageAsPicture(C().page(), on);
    if (on) S.done.pictures.add(key(S.pageNumber, 'page'));
    else S.done.pictures.delete(key(S.pageNumber, 'page'));
    if (on) C().announce(`Page ${S.pageNumber} will be kept as a picture.`);
    C().render(on ? 'title' : 'first');
  }

  function nextUnsure(dir) {
    const S = C().session();
    const hit = M().nextUnsure(S.parsed, C().env(), { pageNumber: S.pageNumber, id: S.currentId }, dir);
    if (!hit) C().announce('Nothing left to check.');
    else if (hit.pageNumber === S.pageNumber) C().applyFocus({ id: hit.id });
    else C().showPage(hit.pageNumber, { id: hit.id });
  }

  function neighbour(id, dir) {
    const next = M().neighbour(C().rows(), id, dir);
    if (next) C().applyFocus({ id: next });
  }

  function readyPage() {
    const S = C().session();
    const list = C().entries().filter((e) => e.status !== 'reading');
    const next = list.find((e) => e.pageNumber > S.pageNumber) || list[0];
    if (next) C().showPage(next.pageNumber, 'first');
  }

  function typing(on) {
    const S = C().session();
    S.typing = on;
    C().render(on ? 'first' : 'title');
  }

  const ACTIONS = {
    accept, back: goBack, remove, add, picture: keepAsPicture, 'use-text': useAsText,
    'looks-right': looksRight, 'accept-page': looksRight, skip, 'type-save': saveTyped,
    commit: (id) => { if (keepField(id)) C().render(null); },
    unskip: () => { E().skipPage(C().page(), false); C().render('first'); },
    type: () => typing(true),
    'type-cancel': () => typing(false),
    guesses: () => { E().releasePicture(C().page()); C().render('first'); },
    'keep-page': () => keepPage(true),
    'page-text': () => keepPage(false),
    'next-page': () => step(1),
    'prev-page': () => step(-1),
    goto: (pageNumber) => C().showPage(pageNumber, 'first'),
    'ready-page': readyPage,
    'next-unsure': () => nextUnsure(1),
    'prev-unsure': () => nextUnsure(-1),
    'next-line': (id) => neighbour(id, 1),
    'prev-line': (id) => neighbour(id, -1),
    done: () => C().close(),
  };
  // These read the field themselves, or must not touch it
  const NO_FLUSH = ['accept', 'back', 'commit', 'type-save', 'type-cancel', 'done'];

  function run(action, arg) {
    const fn = ACTIONS[action];
    if (!fn || !C().session()) return false;
    if (!NO_FLUSH.includes(action)) flush();
    fn(arg);
    return true;
  }

  PDFStudy.hwCheckActions = { run, flush };
})(typeof window !== 'undefined' ? window : globalThis);

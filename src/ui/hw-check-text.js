/**
 * The words of the "Check what was read" screen that depend on counts or state (no DOM): progress line,
 * page-list labels, the name of a line's field, what is announced, the notice, and the message after
 * closing. Fixed labels live with the markup that shows them.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  const STATUS_WORDS = {
    reading: 'still reading',
    skipped: 'skipped',
    empty: 'nothing found',
    picture: 'kept as a picture',
    unread: 'not read',
  };

  /** What a page entry (hw-check-model.js) comes to in a few words; `long` spells out "lines". */
  function stateWords(entry, long) {
    if (STATUS_WORDS[entry.status]) return STATUS_WORDS[entry.status];
    if (entry.toCheck > 0) return long ? `${plural(entry.toCheck, 'line')} to check` : `${entry.toCheck} to check`;
    if (entry.status === 'hard') return 'hard to read';
    // Not "checked": a page whose lines all read clearly was never looked at by the student.
    return long ? 'nothing left to check' : 'nothing to check';
  }

  /** "Page 3 of 24 · 5 lines to check · 4 pages still being read" */
  function progress(entry, total, reading) {
    const parts = [`Page ${entry.pageNumber} of ${total}`, stateWords(entry, true)];
    if (reading > 0) parts.push(`${plural(reading, 'page')} still being read`);
    return parts.join(' · ');
  }

  /** "Page 3 · 5 to check" */
  const optionLabel = (entry) => `Page ${entry.pageNumber} · ${stateWords(entry, false)}`;

  /** "Page 3 of 24. 5 lines to check." */
  function pageAnnouncement(entry, total) {
    const words = stateWords(entry, true);
    return `Page ${entry.pageNumber} of ${total}. ${words.charAt(0).toUpperCase()}${words.slice(1)}.`;
  }

  const TAGS = { check: 'Check', checked: 'Checked', picture: 'Picture', added: 'Added' };

  /** Visible tags of a row (hw-check-model.js rows): its state, then "Maths". */
  function tags(row) {
    const out = [];
    if (TAGS[row.state]) out.push(TAGS[row.state]);
    if (row.math) out.push('Maths');
    return out;
  }

  const STATE_NAMES = { check: 'needs checking', checked: 'checked', picture: 'kept as a picture', added: 'added by you' };

  /** "Line 2, maths, needs checking" · "Line 4, part 2, checked" · "Line 6" */
  function fieldName(row) {
    const parts = [`Line ${row.line}`];
    if (row.parts > 1) parts.push(`part ${row.part}`);
    if (row.math) parts.push('maths');
    if (STATE_NAMES[row.state]) parts.push(STATE_NAMES[row.state]);
    return parts.join(', ');
  }

  /** "Line 3 checked. 4 left on this page." or "All lines on page 3 checked." */
  function checkedAnnouncement(row, left, pageNumber) {
    return left > 0 ? `Line ${row.line} checked. ${left} left on this page.` : `All lines on page ${pageNumber} checked.`;
  }

  /** "Accepts the 4 lines left to check on this page." */
  function looksRightNote(left) {
    return left === 1 ? 'Accepts the 1 line left to check on this page.' : `Accepts the ${left} lines left to check on this page.`;
  }

  /**
   * The notice above the study views. stats: { pages, low, passed, failed, skipped, cancelled, engine }.
   * Returns { text, button } ('' when there is nothing to say).
   */
  function notice(stats) {
    const parts = [];
    let button = '';
    if (!stats) return { text: '', button };
    if (stats.pages > 0) {
      if (stats.engine && stats.engine.available === false) {
        parts.push("The page reader is not installed, so the text on these pages can't be read here. You can type it in.");
        button = 'Type it in';
      } else {
        parts.push(`Read text from ${plural(stats.pages, 'picture page')}.`);
        if (stats.low > 0) {
          const one = stats.low === 1;
          parts.push(`${plural(stats.low, 'line')} may be wrong and ${one ? 'is' : 'are'} left out until you check ${one ? 'it' : 'them'}.`);
        } else if (!(stats.passed > 0)) parts.push('No lines look doubtful.');
        button = 'Check text';
      }
    }
    if (stats.passed > 0) parts.push(`${plural(stats.passed, 'page')} skipped.`);
    if (stats.failed) parts.push(`${plural(stats.failed, 'page')} could not be read.`);
    if (stats.skipped > 0 || stats.cancelled) parts.push('Reading was stopped early; pages not read are left out.');
    return { text: parts.join(' '), button };
  }

  /** After closing: "12 lines corrected · cards updated · 1 picture kept · 2 pages typed in" */
  function doneMessage(done) {
    const parts = done.lines > 0 ? [`${plural(done.lines, 'line')} corrected`, 'cards updated'] : ['Cards updated'];
    if (done.pictures > 0) parts.push(`${plural(done.pictures, 'picture')} kept`);
    if (done.typed > 0) parts.push(`${plural(done.typed, 'page')} typed in`);
    return parts.join(' · ');
  }

  PDFStudy.hwCheckText = {
    plural, stateWords, progress, optionLabel, pageAnnouncement, tags, fieldName, checkedAnnouncement, looksRightNote, notice, doneMessage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwCheckText;
})(typeof window !== 'undefined' ? window : globalThis);

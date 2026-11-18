/**
 * Opening a file: what kind of file it is, and the plain-language message for every way opening
 * can fail (wrong type, password, damaged, too big, unreadable). Pure; no DOM.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const HUGE_BYTES = 1024 * 1024 * 1024; // past this, a browser tab rarely has the memory to parse it

  /** file: { name, type } -> 'pdf' | 'jpeg' | 'png' | 'heic' | 'image' (another picture format) | 'other' */
  function kindOf(file) {
    const name = String((file && file.name) || '').toLowerCase();
    const type = String((file && file.type) || '').toLowerCase();
    if (type === 'application/pdf' || /\.pdf$/.test(name)) return 'pdf';
    if (type === 'image/jpeg' || /\.jpe?g$/.test(name)) return 'jpeg';
    if (type === 'image/png' || /\.png$/.test(name)) return 'png';
    if (/heic|heif/.test(type) || /\.hei[cf]$/.test(name)) return 'heic';
    if (/^image\//.test(type) || /\.(gif|webp|bmp|tiff?|avif|svg)$/.test(name)) return 'image';
    return 'other';
  }

  /**
   * Sorts a file selection into what to open.
   * -> { pdf: File | null, images: File[], problem: string } (problem '' when it can be opened)
   */
  function plan(files) {
    const list = Array.from(files || []);
    const kinds = list.map(kindOf);
    const pdfs = list.filter((_f, i) => kinds[i] === 'pdf');
    const images = list.filter((_f, i) => kinds[i] === 'jpeg' || kinds[i] === 'png');
    const none = { pdf: null, images: [], problem: '' };
    if (!list.length) return none;
    if (kinds.includes('heic')) {
      return Object.assign(none, { problem: 'HEIC photos cannot be opened here. Save or share the photo as a JPEG or PNG first, then try again.' });
    }
    if (kinds.includes('image')) {
      return Object.assign(none, { problem: 'That kind of picture cannot be opened here. Use a JPEG or PNG photo, or a PDF.' });
    }
    if (kinds.includes('other')) {
      return Object.assign(none, { problem: 'That file is not a PDF or a photo. Choose a PDF, or JPEG or PNG photos of the pages.' });
    }
    if (pdfs.length > 1 || (pdfs.length && images.length)) {
      return Object.assign(none, { problem: 'Open one PDF at a time, or a set of photos on their own.' });
    }
    return { pdf: pdfs[0] || null, images, problem: '' };
  }

  /** info: { size } -> the sentence for a failed open; never the raw error on its own. */
  function forError(err, info) {
    const name = String((err && err.name) || '');
    const why = String((err && err.message) || err || '');
    const size = (info && info.size) || 0;
    if (info && info.size === 0) return 'That file is empty. Download or export it again, then try once more.';
    if (name === 'PasswordException' || /password/i.test(why)) {
      return 'That PDF is password-protected. Open it in your PDF reader, save or print it as a new PDF without the password, then open that copy.';
    }
    if (name === 'RangeError' || /out of memory|allocation|array buffer|invalid array length|invalid typed array/i.test(why) || size > HUGE_BYTES) {
      return 'That file is too big for this browser to open. Split it into smaller PDFs (one chapter each works well) and open one of them.';
    }
    if (name === 'NotReadableError' || name === 'NotFoundError') {
      return 'That file could not be read from your device. Check that it still exists and is not open in another app, then try again.';
    }
    if (name === 'InvalidPDFException' || /invalid pdf|missing pdf|unexpected|bad xref|invalid root/i.test(why)) {
      return 'That file is not a readable PDF. It may be damaged or only partly downloaded. Download or export it again, then try once more.';
    }
    return `That PDF could not be opened. Export it again or try another file.${why ? ` (${why})` : ''}`;
  }

  /** The sentence for a photo that could not be turned into a page. */
  function forImageError(fileName) {
    const which = fileName ? `The photo "${fileName}"` : 'One of the photos';
    return `${which} could not be opened. It may be damaged. Save it again as a JPEG, then try once more.`;
  }

  PDFStudy.openMessages = { kindOf, plan, forError, forImageError };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.openMessages;
})(typeof window !== 'undefined' ? window : globalThis);

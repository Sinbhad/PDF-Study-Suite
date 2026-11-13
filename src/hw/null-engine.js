/** Fallback recogniser: never available, every region comes back empty so the user types it in. */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  PDFStudy.hwNullEngine = {
    name: 'none',
    /** @returns {Promise<{available:boolean, reason:string}>} */
    load() {
      return Promise.resolve({ available: false, reason: 'No handwriting model installed' });
    },
    /** @returns {Promise<{text:string, confidence:number}>} */
    recognise() {
      return Promise.resolve({ text: '', confidence: 0 });
    },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.hwNullEngine;
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this);

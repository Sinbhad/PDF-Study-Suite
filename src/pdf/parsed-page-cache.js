/**
 * Remembers parsed pages (what pdf-loader.js parseSinglePage returns) per document in the document store
 * (ui/doc-store.js, kind 'parsed'), so a document opened again skips PDF.js for every page it has seen.
 * Measured on an 85-slide lecture deck: parsing is about 95% PDF.js getOperatorList (decoding the slides'
 * pictures), which nothing here can make cheaper; reopening is where it can be skipped altogether.
 *   forDocument(pdfDoc, byteLength) -> Promise<cache | null>
 *       cache.get(pageNumber) -> Promise<page | null>   a private copy, safe to change
 *       cache.put(page)       -> Promise<boolean>       stores a copy taken now (later reading changes the
 *                                                        page in place; that is remembered by ui/ocr-cache.js)
 * The key holds a version made from the text of every src/pdf script and the PDF.js version, so any change
 * to how pages are parsed finds nothing and parses afresh: no number to remember to bump. Without a document
 * store (Node, tools/run-pdf.js), without a PDF fingerprint, or when the scripts cannot be read, there is no
 * cache and pages are parsed as before. Every call is async and never rejects.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const KIND = 'parsed';
  // A large textbook is opened a range at a time; its pages are kept too, but not past this many per document,
  // so parsed pages never crowd out pages that were read from pictures (the store has one size cap for both)
  const MAX_PAGES = 400;
  const MAX_PAGE_BYTES = 256 * 1024;

  let versionPromise = null;

  /** FNV-1a over a string, two seeds, as 16 hex digits. */
  function hash(text) {
    let a = 0x811c9dc5;
    let b = 0x01000193 ^ 0x5bd1e995;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }

  /** The scripts whose code decides what a parsed page holds: every src/pdf file and PDF.js itself. */
  function parserScripts() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return [];
    return Array.from(document.querySelectorAll('script[src]'))
      .map((s) => s.getAttribute('src'))
      .filter((src) => /(^|\/)src\/pdf\//.test(src) || /(^|\/)vendor\/pdf\.min\.js/.test(src));
  }

  /** Resolves to the parser version, or null when it cannot be known (then nothing is cached). */
  function version() {
    if (versionPromise) return versionPromise;
    versionPromise = (async () => {
      const list = parserScripts();
      if (!list.length || typeof fetch !== 'function') return null;
      try {
        const texts = await Promise.all(list.map(async (src) => {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`${src}: ${res.status}`);
          return `${src}\u0000${await res.text()}`;
        }));
        const lib = root.pdfjsLib || {};
        return hash(`${lib.version || ''}\u0001${texts.join('\u0001')}`);
      } catch (_err) {
        return null;
      }
    })();
    return versionPromise;
  }

  function copyOf(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function docIdOf(pdfDoc) {
    const keys = PDFStudy.studyKeys;
    const prints = pdfDoc && pdfDoc.fingerprints;
    const fingerprint = prints && prints[0];
    if (!keys || !keys.docId || !fingerprint) return null;
    return keys.docId({ fingerprint }); // the same id the study state is kept under (ui/doc-session.js)
  }

  async function forDocument(pdfDoc, byteLength) {
    const store = PDFStudy.docStore;
    const docId = docIdOf(pdfDoc);
    if (!store || !store.get || !store.put || !docId || !(pdfDoc.numPages <= MAX_PAGES)) return null;
    const v = await version();
    if (!v) return null;
    // Two files can share a fingerprint (a template's ID kept by the program that made them): the second
    // fingerprint, the size in bytes and the page count tell them apart
    const prints = pdfDoc.fingerprints || [];
    const file = hash(`${prints[1] || ''}|${byteLength || 0}|${pdfDoc.numPages}`);
    const keyOf = (n) => `${n}:${v}:${file}`;
    return {
      async get(pageNumber) {
        try {
          const hit = await store.get(docId, KIND, keyOf(pageNumber));
          return hit && hit.page && hit.page.pageNumber === pageNumber ? copyOf(hit.page) : null;
        } catch (_err) {
          return null;
        }
      },
      async put(page) {
        try {
          const kept = copyOf(page);
          if (store.sizeOf && store.sizeOf(kept) > MAX_PAGE_BYTES) return false;
          return await store.put(docId, KIND, keyOf(page.pageNumber), { page: kept });
        } catch (_err) {
          return false; // a page that cannot be copied is simply parsed again next time
        }
      },
    };
  }

  /** Test hook: a fixed parser version (Node has no scripts to read). */
  function useVersion(v) {
    versionPromise = Promise.resolve(v);
  }

  PDFStudy.parsedPageCache = { forDocument, version, useVersion, hash, KIND, MAX_PAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.parsedPageCache;
})(typeof window !== 'undefined' ? window : globalThis);

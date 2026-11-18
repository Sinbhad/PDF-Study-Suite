/**
 * Remembers what the page reader made of each page, per document (doc-store.js), so a document that was read
 * once opens again without starting the reader, with every change the student made on it.
 *   restore(parsedPdf, pageNumbers)  applies remembered results, then the student's edits, to those pages;
 *                                    resolves to how many pages it put back
 *   save(parsedPdf, pageNumber)      remembers the page's result as the reader gave it (ink.raw)
 *   saveCorrected(parsedPdf)         remembers every page corrected outside the correction screen since it was
 *                                    last saved (ocrLines.applyCorrection marks it ink.corrected)
 *   savePage(page)                   remembers the student's edits from "Check what was read" (pdf/ocr-edits.js
 *                                    calls it as PDFStudy.ocrStore.savePage after every change)
 *   reapply(parsedPdf, pageNumber)   puts remembered edits back on a page the reader has just read again
 * Three slots per page:
 *   'ocr'        the reader's result, key page + READER_VERSION. Stored before any edit, so a change to the
 *                noise and merge rules of pdf/ocr-noise.js and pdf/ocr-merge.js needs no new reading.
 *   'ocr-edits'  ocrEdits.serialise(page), key page + READER_VERSION: text fixes, removed, added and
 *                kept-as-picture lines, "Looks right", page flags. It is put back with ocrEdits.restore, which
 *                is idempotent and never saves. Edits name the reader's lines by id, and a new reader version
 *                may number its lines differently, so a version change drops these edits with the reading.
 *   'ocr-typed'  the same record for a page the student typed in, key page only. A typed-in page does not
 *                depend on what the reader found, so it survives a new reader version and is never read again.
 * Every call is async and never rejects. The store may be memory only (private window): the same calls work
 * for the rest of the session. Without a store or an open document session nothing is remembered.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const KIND = 'ocr';
  const EDITS = 'ocr-edits';
  const TYPED = 'ocr-typed';

  const need = (name, file) => PDFStudy[name] || (typeof require === 'function' ? require(file) : null);
  const ocrEdits = () => need('ocrEdits', '../pdf/ocr-edits.js');

  const pageOf = (parsed, n) => (parsed.pageCache && parsed.pageCache.get(n)) || (parsed.pages || []).find((p) => p && p.pageNumber === n);

  /**
   * A copy that later edits cannot reach: the in-memory store keeps values by reference, and the correction
   * screen changes the result's lines in place.
   */
  function copyOf(value) {
    if (value == null) return value;
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function keyOf(pageNumber) {
    const version = (PDFStudy.hwPipeline && PDFStudy.hwPipeline.READER_VERSION) || 'reader';
    return `${pageNumber}:${version}`;
  }

  /** The store and the open document's id, or null when either is missing. */
  function place() {
    const store = PDFStudy.docStore;
    const session = PDFStudy.docSession;
    const docId = session && session.id ? session.id() : null;
    if (!store || !store.get || !store.put || !docId || docId === 'detached') return null;
    return { store, docId };
  }

  /**
   * Worth remembering: a finished reading by a reader, or anything the student typed. A page that was only
   * partly read (stopped) or that no reader could read is read again next time.
   */
  function worthKeeping(result) {
    if (!result || !Array.isArray(result.lines) || result.partial) return false;
    const typed = result.lines.some((l) => (l.regions || []).some((r) => r.source === 'user'));
    const engine = result.engine;
    const read = typeof engine === 'string' ? !!engine : !!(engine && engine.available !== false);
    return typed || read;
  }

  const fetch = (at, kind, key) => at.store.get(at.docId, kind, key).catch(() => null);
  const editsIn = (hit) => (hit && hit.edits) || null;

  /** One page: the remembered reading and its edits, or a typed-in page on its own. True when anything came back. */
  function putBack(page, reading, edits, typed) {
    const E = ocrEdits();
    const record = edits || typed;
    if (reading && worthKeeping(reading.result)) {
      PDFStudy.ocrLines.applyToPage(page, copyOf(reading.result));
      if (record && E) E.restore(page, record);
    } else if (typed && E) {
      E.restore(page, typed); // re-derives the page from the typed lines: it now counts as read
    } else {
      return false;
    }
    page.ink.remembered = true;
    page.ink.skipped = false;
    return true;
  }

  async function restore(parsedPdf, pageNumbers) {
    const at = place();
    if (!at || !PDFStudy.ocrLines || !parsedPdf) return 0;
    const unread = (n) => {
      const page = pageOf(parsedPdf, n);
      return page && !(page.ink && page.ink.recognised);
    };
    const wanted = (pageNumbers || []).filter(unread);
    const found = await Promise.all(wanted.map((n) => Promise.all([
      fetch(at, KIND, keyOf(n)),
      fetch(at, EDITS, keyOf(n)),
      fetch(at, TYPED, String(n)),
    ])));
    let restored = 0;
    wanted.forEach((n, i) => {
      if (!unread(n)) return; // read while we were looking
      const [reading, edits, typed] = found[i];
      if (putBack(pageOf(parsedPdf, n), reading, editsIn(edits), editsIn(typed))) restored += 1;
    });
    return restored;
  }

  async function save(parsedPdf, pageNumber) {
    const at = place();
    const page = parsedPdf && pageOf(parsedPdf, pageNumber);
    const result = page && page.ink && page.ink.raw;
    if (!at || !worthKeeping(result)) return false;
    page.ink.corrected = false;
    try {
      return await at.store.put(at.docId, KIND, keyOf(pageNumber), { result: copyOf(result) });
    } catch (_err) {
      return false;
    }
  }

  async function saveCorrected(parsedPdf) {
    if (!parsedPdf) return 0;
    const pages = parsedPdf.pageCache && parsedPdf.pageCache.size ? Array.from(parsedPdf.pageCache.values()) : parsedPdf.pages || [];
    const changed = pages.filter((p) => p && p.ink && p.ink.corrected);
    const saved = await Promise.all(changed.map((p) => save(parsedPdf, p.pageNumber)));
    return saved.filter(Boolean).length;
  }

  /** Writes for one page go one after another, so a later edit is never overtaken by an earlier one. */
  const queues = new Map();

  function inOrder(id, write) {
    const next = (queues.get(id) || Promise.resolve()).then(write, write);
    queues.set(id, next);
    next.then(() => {
      if (queues.get(id) === next) queues.delete(id);
    });
    return next;
  }

  /**
   * Remembers the page's edits (all of them: the record replaces what was stored). A page whose edits were all
   * taken back stores an empty record. The reading itself is not written again: the edits carry the
   * corrections, so the remembered reading stays the reader's own.
   */
  function savePage(page) {
    const at = place();
    const E = ocrEdits();
    if (!at || !E || !page || !page.ink) return Promise.resolve(false);
    let data = null;
    try {
      data = copyOf(E.serialise(page));
    } catch (_err) {
      return Promise.resolve(false);
    }
    page.ink.corrected = false;
    const n = page.pageNumber;
    const write = async () => {
      try {
        const edits = await at.store.put(at.docId, EDITS, keyOf(n), { edits: data });
        const typed = await at.store.put(at.docId, TYPED, String(n), { edits: data && data.typed ? data : null });
        return Boolean(edits && typed);
      } catch (_err) {
        return false;
      }
    };
    return inOrder(`${at.docId}\u0000${n}`, write);
  }

  /** After a new reading of a page: the edits remembered for it under this reader version, if any. */
  async function reapply(parsedPdf, pageNumber) {
    const at = place();
    const E = ocrEdits();
    const page = parsedPdf && pageOf(parsedPdf, pageNumber);
    if (!at || !E || !page || !page.ink) return false;
    const record = editsIn(await fetch(at, EDITS, keyOf(pageNumber)));
    return record ? E.restore(page, record) : false;
  }

  PDFStudy.ocrCache = { restore, save, saveCorrected, savePage, reapply, keyOf, worthKeeping };
  // The seam the correction screen calls after every change (pdf/ocr-edits.js onChange)
  PDFStudy.ocrStore = { savePage };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.ocrCache;
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * Per-document store over IndexedDB, keyed by the document id from studyKeys.docId.
 *   loadDoc(docId) / saveDoc(docId, state)   the study state described in nlp/doc-state.js
 *   put(docId, kind, key, value) / get(docId, kind, key)
 *       a generic slot for expensive per-page results (recognised text of a scanned page, ...);
 *       capped in total size, oldest entries are evicted first
 *   flaggedSources(docId) -> [{ key, text }]  sentences the student marked as bad questions
 *   persist()                                 asks the browser once to keep this origin's data
 * Every call is async and never rejects. When IndexedDB is missing, blocked, full or in a private
 * window the same calls work on an in-memory copy for the rest of the session.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});
  const docState = () => PDFStudy.docState || (typeof require === 'function' ? require('../nlp/doc-state.js') : null);

  const DB_NAME = 'pdf-study-suite';
  const DB_VERSION = 1;
  const DOCS = 'docs';
  const BLOBS = 'blobs';
  const BLOB_META = 'blobMeta';
  const SEP = '\u0000';

  let blobCapBytes = 48 * 1024 * 1024;
  let dbPromise = null;
  let memoryOnly = false;
  let persistAsked = false;
  const memory = { docs: new Map(), blobs: new Map(), meta: new Map() };

  const blobId = (docId, kind, key) => [docId, kind, key].join(SEP);

  /** Approximate stored size in bytes. */
  function sizeOf(value) {
    if (value == null) return 0;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value.byteLength === 'number') return value.byteLength;
    if (typeof value.size === 'number' && typeof value.slice === 'function') return value.size; // Blob
    try {
      return JSON.stringify(value).length * 2;
    } catch (_e) {
      return 0;
    }
  }

  /** Ids to delete, oldest first, until the entries left fit in `cap` bytes. meta: [{ id, size, at }]. */
  function planEviction(meta, cap) {
    let total = meta.reduce((sum, m) => sum + m.size, 0);
    const evict = [];
    const oldestFirst = meta.slice().sort((a, b) => a.at - b.at);
    for (const m of oldestFirst) {
      if (total <= cap) break;
      evict.push(m.id);
      total -= m.size;
    }
    return evict;
  }

  function openDb() {
    if (memoryOnly) return Promise.reject(new Error('storage unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const idb = root.indexedDB; // reading the property can throw when storage is blocked
      if (!idb) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        [DOCS, BLOBS, BLOB_META].forEach((name) => {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB open blocked'));
    });
    dbPromise.catch(() => { memoryOnly = true; }); // no database at all: stop trying for this session
    return dbPromise;
  }

  /** Runs work(stores, done) in one transaction; resolves with the value given to done() once it commits. */
  async function transact(names, mode, work) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(names, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      work(names.map((n) => tx.objectStore(n)), (value) => { result = value; });
    });
  }

  /** IndexedDB first; a failed call (quota, blocked, private window) is answered from the in-memory copy. */
  async function withFallback(viaDb, viaMemory) {
    if (!memoryOnly) {
      try {
        return await viaDb();
      } catch (_e) {
        // fall through: this call is served from memory
      }
    }
    return viaMemory();
  }

  async function loadDoc(docId) {
    if (memory.docs.has(docId)) return memory.docs.get(docId);
    const stored = await withFallback(
      () => transact([DOCS], 'readonly', ([docs], done) => {
        const req = docs.get(docId);
        req.onsuccess = () => done(req.result || null);
      }),
      () => null
    );
    if (stored && !memory.docs.has(docId)) memory.docs.set(docId, stored);
    return memory.docs.get(docId) || null;
  }

  /** The in-memory copy is updated first, so a failed write never loses what the session did. */
  async function saveDoc(docId, state) {
    memory.docs.set(docId, state);
    return withFallback(
      () => transact([DOCS], 'readwrite', ([docs], done) => {
        docs.put(state, docId);
        done(true);
      }),
      () => false
    );
  }

  function putInMemory(id, value, meta) {
    memory.blobs.set(id, value);
    memory.meta.set(id, meta);
    planEviction(Array.from(memory.meta.values()), blobCapBytes).forEach((old) => {
      memory.blobs.delete(old);
      memory.meta.delete(old);
    });
    return true;
  }

  /** Resolves false when the value alone is larger than the whole cap (it is not stored). */
  async function put(docId, kind, key, value) {
    const id = blobId(docId, kind, key);
    const meta = { id, docId, size: sizeOf(value), at: Date.now() };
    if (meta.size > blobCapBytes) return false;
    return withFallback(
      () => transact([BLOBS, BLOB_META], 'readwrite', ([blobs, metas], done) => {
        blobs.put(value, id);
        metas.put(meta, id);
        const all = metas.getAll();
        all.onsuccess = () => {
          planEviction(all.result, blobCapBytes).forEach((old) => {
            blobs.delete(old);
            metas.delete(old);
          });
          done(true);
        };
      }),
      () => putInMemory(id, value, meta)
    );
  }

  async function get(docId, kind, key) {
    const id = blobId(docId, kind, key);
    const fromMemory = () => (memory.blobs.has(id) ? memory.blobs.get(id) : null);
    const stored = await withFallback(
      () => transact([BLOBS], 'readonly', ([blobs], done) => {
        const req = blobs.get(id);
        req.onsuccess = () => done(req.result === undefined ? null : req.result);
      }),
      fromMemory
    );
    return stored === null ? fromMemory() : stored; // a write that failed earlier lives in memory only
  }

  async function flaggedSources(docId) {
    const state = await loadDoc(docId);
    return state ? docState().flaggedSources(docState().upgrade(state)) : [];
  }

  /** Ask once per session, and only from code that runs after a user action. */
  async function persist() {
    if (persistAsked) return false;
    persistAsked = true;
    try {
      const sm = root.navigator && root.navigator.storage;
      return sm && sm.persist ? !!(await sm.persist()) : false;
    } catch (_e) {
      return false;
    }
  }

  /** Test hooks: shrink the cap, or force the in-memory copy. */
  function configure(opts) {
    if (opts && Number.isFinite(opts.blobCapBytes)) blobCapBytes = opts.blobCapBytes;
    if (opts && opts.memoryOnly) memoryOnly = true;
  }

  const api = {
    loadDoc, saveDoc, put, get, flaggedSources, persist, configure, planEviction, sizeOf,
    mode: () => (memoryOnly ? 'memory' : 'indexeddb'),
  };
  PDFStudy.docStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

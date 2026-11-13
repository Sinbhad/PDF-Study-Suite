/**
 * Synthetic fixtures for the handwriting suites: gray bitmaps, a mock recognition engine, a fake Worker that
 * drives the real worker core, and a tiny ink-only PDF built as a byte string.
 */
const path = require('path');
const src = (...p) => require(path.join(__dirname, '..', 'src', ...p));
const raster = src('hw', 'raster.js');
const segmenter = src('hw', 'segmenter.js');
const core = src('hw', 'hw-worker-core.js');

/** White (or `bg`) gray page. */
const bitmap = (w, h, bg = 255) => ({ gray: new Uint8Array(w * h).fill(bg), width: w, height: h });

function rect(img, x, y, w, h, v = 0) {
  for (let r = y; r < y + h; r++) img.gray.fill(v, r * img.width + x, r * img.width + x + w);
  return { x, y, w, h };
}

/** A "text row": n dark word blocks of height h separated by `gap` px. Returns the row's bounding box. */
function wordRow(img, x, y, h, n, wordW = 50, gap = 14) {
  for (let i = 0; i < n; i++) rect(img, x + i * (wordW + gap), y, wordW, h);
  return { x, y, w: n * wordW + (n - 1) * gap, h };
}

/** Fraction: numerator block, thin bar, denominator block. Returns the overall box. */
function fraction(img, x, y) {
  rect(img, x + 10, y, 40, 16);
  rect(img, x, y + 19, 60, 2);
  rect(img, x + 10, y + 24, 40, 16);
  return { x, y, w: 60, h: 40 };
}

const ruledPaper = (img, every, thick = 2) => { for (let y = every; y < img.height; y += every) rect(img, 0, y, img.width, thick, 0); };
const invert = (img) => { for (let i = 0; i < img.gray.length; i++) img.gray[i] = 255 - img.gray[i]; return img; };
const binarised = (img) => raster.binarise(img.gray, img.width, img.height);
const copy = (img) => ({ gray: img.gray.slice(), width: img.width, height: img.height });

/** Mock engine. script: [[text, confidence], ...] cycled per call; otherwise canned text by kind. */
function mockEngine(opts = {}) {
  const calls = [];
  return {
    name: 'mock', calls,
    async load(onProgress) {
      if (opts.progress && onProgress) onProgress({ loaded: 5, total: 10, file: 'model.bin' });
      return { available: true };
    },
    async recognise(crop, kind) {
      calls.push({ kind, w: crop.w, h: crop.h });
      const n = calls.length;
      if (opts.throwOn === n) throw new Error('boom');
      if (opts.script) { const [text, confidence] = opts.script[(n - 1) % opts.script.length]; return { text, confidence }; }
      return kind === 'math' ? { text: '\\frac{a}{b}', confidence: opts.confidence != null ? opts.confidence : 0.8 }
        : { text: `word ${n}`, confidence: opts.confidence != null ? opts.confidence : 0.9 };
    },
  };
}

/** Fake Worker factory that runs the real worker core in-process. stats: { created, posted[], terminated }. */
function fakeWorkerFactory(engine, stats) {
  return () => {
    stats.created++;
    const w = {
      onmessage: null, onerror: null,
      postMessage(msg) { stats.posted.push(msg.type); Promise.resolve().then(() => handler.handle(msg)); },
      terminate() { stats.terminated++; },
    };
    const handler = core.createHandler({ engine, raster, segmenter, post: (m) => { if (w.onmessage) w.onmessage({ data: m }); } });
    return w;
  };
}
const newStats = () => ({ created: 0, posted: [], terminated: 0 });

/** Ink-only PDF: no text operators, `strokes` m/l/S strokes per page laid out in rows. Returns an ArrayBuffer. */
function buildInkPdf(pageCount = 1, strokes = 36) {
  const objs = [];
  const kids = [];
  for (let p = 0; p < pageCount; p++) kids.push(`${3 + 2 * p} 0 R`);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  for (let p = 0; p < pageCount; p++) {
    let s = '1 w\n';
    for (let i = 0; i < strokes; i++) {
      const x = 72 + (i % 12) * 30;
      const y = 700 - Math.floor(i / 12) * 40;
      s += `${x} ${y} m ${x + 20} ${y + 8} l S\n`;
    }
    objs[3 + 2 * p] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents ${4 + 2 * p} 0 R >>`;
    objs[4 + 2 * p] = `<< /Length ${s.length} >>\nstream\n${s}endstream`;
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 1; i < objs.length; i++) { offsets[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const buf = Buffer.from(out, 'latin1');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

module.exports = { raster, segmenter, core, bitmap, rect, wordRow, fraction, ruledPaper, invert, binarised, copy, mockEngine, fakeWorkerFactory, newStats, buildInkPdf };

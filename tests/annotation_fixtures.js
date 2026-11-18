/**
 * Notes-app Annotation Fixtures (Node only: `node tests/annotation_fixtures.js`).
 * Builds small synthetic PDFs in memory and runs them through the real PDF.js + pdfLoader pipeline:
 *  - a slide with typed text plus invisible (render mode 3) handwriting recognition in a notes-app font:
 *    the invisible text must land in page.annotations / slide.annotations, never in lines, titles or bullets;
 *  - a picture-only slide whose only text is the same app's invisible notes (font family seen earlier);
 *  - negative: a scanned page whose OCR layer is invisible text in another font family keeps its text;
 *  - negative: a plain typed slide has no annotations.
 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

globalThis.window = globalThis;
globalThis.pdfjsLib = require(path.join(ROOT, 'vendor/pdf.min.js'));
globalThis.pdfjsWorker = require(path.join(ROOT, 'vendor/pdf.worker.min.js'));
['span-format', 'math-glyphs', 'math-tex', 'font-decoder', 'page-rules', 'math-line', 'formula-builder', 'column-layout',
  'line-builder', 'invisible-text', 'line-kinds', 'page-kind', 'pdf-loader', 'slide-lines', 'slide-reveal', 'slide-extractor']
  .forEach((m) => require(path.join(ROOT, `src/pdf/${m}.js`)));
const P = globalThis.PDFStudy;

const results = [];
const check = (name, ok, detail = '') => results.push({ name: `[annotation] ${name}`, ok: Boolean(ok), detail });

/** Minimal PDF: pages = [{ ops: string }]; fonts F1 Helvetica, F2 Helvetica-Bold, F3 notes-app font, F4 OCR font. */
function buildPdf(pages) {
  const objs = [];
  const add = (s) => objs.push(s) && objs.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const f3 = add('<< /Type /Font /Subtype /Type1 /BaseFont /AAAAAJ+.SFUI-Regular_wdth_opsz2B9AF4 >>');
  const f4 = add('<< /Type /Font /Subtype /Type1 /BaseFont /GlyphLessFont >>');
  const kids = [];
  for (const p of pages) {
    const c = add(`<< /Length ${p.ops.length} >>\nstream\n${p.ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const text = (font, size, x, y, str, mode = 0) => `BT ${mode ? `${mode} Tr ` : ''}/${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${str}) Tj ET`;

const annotatedSlide = [
  text('F2', 36, 80, 470, 'Borrelia Species'),
  text('F1', 28, 100, 400, '- Spread by hard tick vectors'),
  text('F1', 28, 100, 350, '- Outer surface proteins change in the tick'),
  // the notes app writes its recognition over the pen strokes: invisible, own font, stretched
  'BT 3 Tr /F3 40 Tf 1.5 0 0 1 300 480 Tm (zyme disease) Tj ET',
  'BT 3 Tr /F3 30 Tf 1 0 0 1 620 360 Tm (purplezy) Tj ET',
].join('\n');
const pictureSlide = 'BT 3 Tr /F3 30 Tf 1 0 0 1 200 300 Tm (block then dive deeper) Tj ET';
const scannedPage = [
  text('F4', 12, 72, 480, 'Scanned lecture handout line one about tick vectors', 3),
  text('F4', 12, 72, 460, 'Scanned lecture handout line two about antibody titers', 3),
].join('\n');
const plainSlide = [text('F2', 36, 80, 470, 'Leptospira Overview'), text('F1', 28, 100, 400, '- Shed in urine of carrier hosts')].join('\n');

(async () => {
  const buf = buildPdf([{ ops: annotatedSlide }, { ops: pictureSlide }, { ops: plainSlide }]);
  const parsed = await P.pdfLoader.loadPdfDocument(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), () => {});
  const [p1, p2, p3] = parsed.pages;
  const lineText = (p) => p.lines.map((l) => l.text).join(' | ');
  check('invisible notes leave the page lines', !/zyme|purplezy/.test(lineText(p1)) && /Borrelia/.test(lineText(p1)), lineText(p1));
  check('invisible notes are exposed as page.annotations with position', p1.annotations.length === 2 &&
    p1.annotations.every((a) => a.isAnnotation && a.pageNumber === 1 && Number.isFinite(a.x0) && Number.isFinite(a.topY)) &&
    p1.annotations.some((a) => /zyme disease/.test(a.text)), JSON.stringify(p1.annotations));
  check('picture-only slide: notes in a known notes-app font family are annotations', p2.lines.length === 0 && p2.annotations.length === 1, lineText(p2));
  check('plain typed slide has no annotations', p3.annotations.length === 0 && /Leptospira/.test(lineText(p3)), JSON.stringify(p3.annotations));
  const deck = P.slideExtractor.extractSlideDeck(parsed);
  const s1 = deck.slides[0];
  check('slide title and bullets exclude the notes', s1.title === 'Borrelia Species' && !s1.bullets.join(' ').includes('purplezy'), JSON.stringify(s1));
  check('slide carries its notes as slide.annotations', (s1.annotations || []).length === 2, JSON.stringify(s1.annotations));

  const scan = buildPdf([{ ops: scannedPage }]);
  const parsedScan = await P.pdfLoader.loadPdfDocument(scan.buffer.slice(scan.byteOffset, scan.byteOffset + scan.byteLength), () => {});
  const sp = parsedScan.pages[0];
  check('scanned page OCR layer (all text invisible, other font family) stays page text', sp.lines.length === 2 && sp.annotations.length === 0, lineText(sp));

  const report = results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok || !r.detail ? '' : `  (${r.detail})`}`);
  const passed = results.every((r) => r.ok);
  console.log(report.concat([passed ? 'PASS' : 'FAIL']).join('\n'));
  process.exit(passed ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

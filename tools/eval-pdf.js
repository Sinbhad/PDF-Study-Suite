/**
 * Wraps a JPEG or PNG image in a one-page PDF with no text layer (the image fills the page), so it reaches
 * the app exactly like a scanned or photographed page would. JPEG bytes are embedded unchanged (DCTDecode);
 * PNG pixels are decoded and embedded with FlateDecode.
 */
const zlib = require('zlib');
const { decodePng } = require('./eval-png.js');

/** Width, height and channel count from a JPEG's start-of-frame marker. */
function jpegInfo(buf) {
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), n: buf[i + 9] };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('not a baseline/progressive JPEG');
}

/** The image XObject (dictionary + stream bytes) for a JPEG or PNG file. */
function imageObject(buf, kind) {
  if (kind === 'png') {
    const img = decodePng(buf);
    const body = zlib.deflateSync(img.data);
    const cs = img.channels === 1 ? 'DeviceGray' : 'DeviceRGB';
    return { w: img.w, h: img.h, dict: `/ColorSpace /${cs} /BitsPerComponent 8 /Filter /FlateDecode /Length ${body.length}`, body };
  }
  const { w, h, n } = jpegInfo(buf);
  if (n !== 1 && n !== 3) throw new Error(`JPEG with ${n} colour components is not supported`);
  return { w, h, dict: `/ColorSpace /${n === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${buf.length}`, body: buf };
}

/** Image kind from the file name, or null when the tool does not handle it. */
function kindOf(file) {
  if (/\.jpe?g$/i.test(file)) return 'jpeg';
  if (/\.png$/i.test(file)) return 'png';
  return null;
}

/** One A4-wide page showing the image edge to edge, no text operators. */
function imageToPdf(buf, kind) {
  const img = imageObject(buf, kind);
  const pw = 595; const ph = Math.round((595 * img.h) / img.w);
  const content = Buffer.from(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
  const bodies = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} ${img.dict} >>\nstream\n`), img.body, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('\nendstream')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets = [];
  let pos = parts[0].length;
  bodies.forEach((b, i) => {
    offsets.push(pos);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), b, Buffer.from('\nendobj\n')]);
    parts.push(obj); pos += obj.length;
  });
  const xref = `xref\n0 6\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  return { pdf: Buffer.concat([...parts, Buffer.from(xref)]), w: img.w, h: img.h };
}

module.exports = { jpegInfo, imageToPdf, kindOf };

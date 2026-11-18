/**
 * Wraps JPEG images into a PDF with one image per page and no text, so photos of pages reach the
 * rest of the app exactly like a scanned PDF would. JPEG bytes are embedded unchanged (DCTDecode).
 * Pure byte work on Uint8Array: no DOM, no network.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const PAGE_WIDTH = 595; // A4 width in points; the height follows the image
  const u16 = (b, i) => (b[i] << 8) | b[i + 1];

  /** EXIF orientation (1-8) from an APP1 segment starting at `at`, or 1 when it has none. */
  function exifOrientation(b, at, length) {
    const head = at + 4;
    const isExif = b[head] === 0x45 && b[head + 1] === 0x78 && b[head + 2] === 0x69 && b[head + 3] === 0x66;
    if (!isExif) return 1;
    const tiff = head + 6;
    const little = b[tiff] === 0x49;
    const read16 = (i) => (little ? b[i] | (b[i + 1] << 8) : u16(b, i));
    const read32 = (i) => (little ? read16(i) | (read16(i + 2) << 16) : (read16(i) << 16) | read16(i + 2));
    const ifd = tiff + read32(tiff + 4);
    const end = at + 2 + length;
    if (ifd + 2 > end) return 1;
    const entries = read16(ifd);
    for (let k = 0; k < entries; k++) {
      const entry = ifd + 2 + k * 12;
      if (entry + 12 > end) break;
      if (read16(entry) === 0x0112) return read16(entry + 8) || 1;
    }
    return 1;
  }

  /** -> { w, h, n (colour components), orientation } from a JPEG's frame header; throws when it has none. */
  function jpegInfo(bytes) {
    if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
    let orientation = 1;
    let i = 2;
    while (i < bytes.length - 9) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      const length = u16(bytes, i + 2);
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { h: u16(bytes, i + 5), w: u16(bytes, i + 7), n: bytes[i + 9], orientation };
      if (marker === 0xe1) orientation = exifOrientation(bytes, i, length);
      i += 2 + length;
    }
    throw new Error('JPEG has no frame header');
  }

  /** True when the bytes can go into a PDF as they are: upright, grey or RGB. */
  function embeddable(info) {
    return info.orientation === 1 && (info.n === 1 || info.n === 3) && info.w > 0 && info.h > 0;
  }

  function concat(chunks) {
    const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  /**
   * images: [{ bytes: Uint8Array (JPEG), w, h, n }] -> Uint8Array holding a PDF, one page per image.
   * Object numbers: 1 catalog, 2 page tree, then page / image / content for each image.
   */
  function buildPdf(images) {
    if (!images || !images.length) throw new Error('no images');
    const enc = new TextEncoder();
    const text = (s) => enc.encode(s);
    const bodies = [];
    const kids = images.map((_img, k) => `${3 + k * 3} 0 R`).join(' ');
    bodies.push(text('<< /Type /Catalog /Pages 2 0 R >>'));
    bodies.push(text(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`));
    images.forEach((img, k) => {
      const pageId = 3 + k * 3;
      const pageHeight = Math.max(1, Math.round((PAGE_WIDTH * img.h) / img.w));
      const content = text(`q ${PAGE_WIDTH} 0 0 ${pageHeight} 0 0 cm /Im0 Do Q`);
      const colour = img.n === 1 ? 'DeviceGray' : 'DeviceRGB';
      bodies.push(text(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${pageHeight}] /Resources << /XObject << /Im0 ${pageId + 1} 0 R >> >> /Contents ${pageId + 2} 0 R >>`));
      bodies.push(concat([
        text(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${colour} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`),
        img.bytes,
        text('\nendstream'),
      ]));
      bodies.push(concat([text(`<< /Length ${content.length} >>\nstream\n`), content, text('\nendstream')]));
    });

    const parts = [text('%PDF-1.4\n')];
    const offsets = [];
    let pos = parts[0].length;
    bodies.forEach((body, k) => {
      offsets.push(pos);
      const obj = concat([text(`${k + 1} 0 obj\n`), body, text('\nendobj\n')]);
      parts.push(obj);
      pos += obj.length;
    });
    const rows = offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    const size = bodies.length + 1;
    parts.push(text(`xref\n0 ${size}\n0000000000 65535 f \n${rows}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
    return concat(parts);
  }

  PDFStudy.imagePdf = { jpegInfo, embeddable, buildPdf, PAGE_WIDTH };
  if (typeof module !== 'undefined' && module.exports) module.exports = PDFStudy.imagePdf;
})(typeof window !== 'undefined' ? window : globalThis);

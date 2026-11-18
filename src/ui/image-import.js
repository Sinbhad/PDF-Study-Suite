/**
 * Photos in, PDF out: turns the JPEG/PNG files a student picked into one PDF (a page per photo)
 * through image-pdf.js. A JPEG that is upright and grey/RGB goes in unchanged; anything else
 * (PNG, a rotated phone photo, CMYK) is drawn on a canvas and re-encoded as JPEG first.
 */
(function (root) {
  const PDFStudy = (root.PDFStudy = root.PDFStudy || {});

  const MAX_SIDE = 3000; // keeps a re-encoded page well inside canvas size limits
  const JPEG_QUALITY = 0.9;

  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });

  async function decode(file) {
    if (typeof root.createImageBitmap === 'function') return root.createImageBitmap(file);
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image could not be decoded'));
      };
      img.src = url;
    });
  }

  /** Draws the picture upright on white (PDF pages have no transparency here) and returns JPEG bytes. */
  async function reencode(file) {
    const picture = await decode(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(picture.width, picture.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.width * scale));
    canvas.height = Math.max(1, Math.round(picture.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
    if (picture.close) picture.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    canvas.width = 0; // release the pixel buffer now rather than at the next collection
    canvas.height = 0;
    if (!blob) throw new Error('image could not be encoded');
    return new Uint8Array(await blob.arrayBuffer());
  }

  /** One photo -> { bytes, w, h, n } ready for imagePdf.buildPdf. */
  async function toPageImage(file) {
    const ip = PDFStudy.imagePdf;
    let bytes = new Uint8Array(await file.arrayBuffer());
    let info = null;
    try {
      info = ip.jpegInfo(bytes);
    } catch (_notJpeg) {
      info = null;
    }
    if (!info || !ip.embeddable(info)) {
      bytes = await reencode(file);
      info = ip.jpegInfo(bytes);
    }
    return { bytes, w: info.w, h: info.h, n: info.n };
  }

  /**
   * files: photos (JPEG/PNG). onProgress(done, total, name). Pages follow the file names in order.
   * -> ArrayBuffer of the PDF. A photo that cannot be decoded rejects with err.fileName set.
   */
  async function photosToPdf(files, onProgress) {
    const sorted = Array.from(files).sort(byName);
    const pages = [];
    for (let i = 0; i < sorted.length; i++) {
      if (onProgress) onProgress(i + 1, sorted.length, sorted[i].name);
      try {
        pages.push(await toPageImage(sorted[i]));
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        wrapped.fileName = sorted[i].name;
        throw wrapped;
      }
    }
    return PDFStudy.imagePdf.buildPdf(pages).buffer;
  }

  /** The document name shown for a set of photos. */
  function nameFor(files) {
    const list = Array.from(files).sort(byName);
    return list.length === 1 ? list[0].name : `${list.length} photos (${list[0].name} and more)`;
  }

  PDFStudy.imageImport = { photosToPdf, nameFor };
})(typeof window !== 'undefined' ? window : globalThis);

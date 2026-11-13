/**
 * Minimal PNG reader/writer on Node's zlib (no packages). Reads non-interlaced 8-bit gray, gray+alpha, RGB,
 * RGBA and palette images (palette also at 1/2/4 bits, with tRNS alpha); alpha is composited onto white.
 */
const zlib = require('zlib');

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Undo the per-row filters in place; returns the unfiltered rows without their filter bytes. */
function unfilter(raw, h, stride, bpp) {
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const type = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0;
      const b = y ? out[o - stride + x] : 0;
      const c = y && x >= bpp ? out[o - stride + x - bpp] : 0;
      const v = raw[src + x];
      let r;
      if (type === 0) r = v;
      else if (type === 1) r = v + a;
      else if (type === 2) r = v + b;
      else if (type === 3) r = v + ((a + b) >> 1);
      else if (type === 4) r = v + paeth(a, b, c);
      else throw new Error(`PNG: bad filter type ${type} on row ${y}`);
      out[o + x] = r & 255;
    }
  }
  return out;
}

/**
 * Decode a PNG to 8-bit RGB (or gray when the source has no colour) composited onto white.
 * @returns {{w:number, h:number, channels:1|3, data:Buffer}}
 */
function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG file');
  let ihdr = null; let palette = null; let trns = null;
  const idat = [];
  for (let i = 8; i + 8 <= buf.length;) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('latin1', i + 4, i + 8);
    const body = buf.subarray(i + 8, i + 8 + len);
    if (type === 'IHDR') ihdr = { w: body.readUInt32BE(0), h: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    i += 12 + len;
  }
  if (!ihdr) throw new Error('PNG: no IHDR chunk');
  const { w, h, depth, color, interlace } = ihdr;
  if (interlace) throw new Error('PNG: interlaced images are not supported (re-save without interlacing)');
  if (!(color in CHANNELS)) throw new Error(`PNG: unknown colour type ${color}`);
  if (color === 3 ? ![1, 2, 4, 8].includes(depth) : depth !== 8) throw new Error(`PNG: ${depth}-bit colour type ${color} is not supported (8-bit only)`);
  if (color === 3 && !palette) throw new Error('PNG: palette image without PLTE');
  const ch = CHANNELS[color];
  const stride = Math.ceil((w * ch * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < h * (stride + 1)) throw new Error('PNG: image data is truncated');
  const px = unfilter(raw, h, stride, Math.max(1, (ch * depth) >> 3));
  const gray = color === 0 || color === 4;
  const out = Buffer.alloc(w * h * (gray ? 1 : 3));
  const over = (v, a) => Math.round((v * a + 255 * (255 - a)) / 255);
  for (let y = 0; y < h; y++) {
    const row = y * stride;
    for (let x = 0; x < w; x++) {
      const o = y * w + x;
      if (color === 0) out[o] = px[row + x];
      else if (color === 4) out[o] = over(px[row + 2 * x], px[row + 2 * x + 1]);
      else if (color === 3) {
        const idx = depth === 8 ? px[row + x] : (px[row + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        const a = trns && idx < trns.length ? trns[idx] : 255;
        for (let k = 0; k < 3; k++) out[o * 3 + k] = over(palette[idx * 3 + k] || 0, a);
      } else {
        const s = row + x * ch;
        const a = ch === 4 ? px[s + 3] : 255;
        for (let k = 0; k < 3; k++) out[o * 3 + k] = over(px[s + k], a);
      }
    }
  }
  return { w, h, channels: gray ? 1 : 3, data: out };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/**
 * Encode 8-bit pixels (colour type 0, 2, 4 or 6) as a PNG. `filter` (0-4) picks the row filter, so
 * tests can cover every decoder path; default 0.
 */
function encodePng(data, w, h, color, filter) {
  const ch = CHANNELS[color] || 1;
  const stride = w * ch;
  const f = filter || 0;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const v = data[y * stride + x];
      const a = x >= ch ? data[y * stride + x - ch] : 0;
      const b = y ? data[(y - 1) * stride + x] : 0;
      const c = y && x >= ch ? data[(y - 1) * stride + x - ch] : 0;
      const pred = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f];
      raw[y * (stride + 1) + 1 + x] = (v - pred) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = color;
  return Buffer.concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { decodePng, encodePng, crc32 };

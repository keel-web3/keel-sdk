// PNG in and out for the level worker (Node only): RGBA pictures the engine's
// CPU compositor makes (thumbnails, the tileset demo) written as PNG, and a
// creator's tileset atlas (8-bit grey, grey+alpha, RGB, RGBA or palette,
// not interlaced -- what pixel-art tools save) read back to RGBA.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'latin1'); Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** RGBA (width x height, top row first) as a PNG file. */
export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}
export const pngDataUrl = (width, height, rgba) => `data:image/png;base64,${encodePng(width, height, rgba).toString('base64')}`;

/** A PNG file to { width, height, rgba }. */
export function decodePng(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 33 || b.readUInt32BE(0) !== 0x89504e47 || b.readUInt32BE(4) !== 0x0d0a1a0a) throw Error('That file is not a PNG.');
  let at = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0, palette = null, alpha = null;
  const idat = [];
  while (at + 8 <= b.length) {
    const len = b.readUInt32BE(at), type = b.toString('latin1', at + 4, at + 8), data = b.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colour = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') alpha = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  if (!width || !height) throw Error('That PNG has no header.');
  if (width * height > 4096 * 4096) throw Error(`That PNG is ${width} x ${height}; a tileset atlas is at most 4096 x 4096.`);
  if (depth !== 8 || interlace) throw Error('Save the atlas as an 8-bit, non-interlaced PNG (what pixel-art tools write by default).');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw Error(`PNG colour type ${colour} isn't supported.`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), out = px.subarray(y * stride, (y + 1) * stride), up = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels] : 0, u = up ? up[x] : 0, c = up && x >= channels ? up[x - channels] : 0;
      let v = row[x];
      if (f === 1) v += a; else if (f === 2) v += u; else if (f === 3) v += (a + u) >> 1;
      else if (f === 4) { const p = a + u - c, pa = Math.abs(p - a), pb = Math.abs(p - u), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
      out[x] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let k = 0; k < width * height; k += 1) {
    const o = k * 4, s = k * channels;
    if (colour === 6) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = px[s + 3]; }
    else if (colour === 2) { rgba[o] = px[s]; rgba[o + 1] = px[s + 1]; rgba[o + 2] = px[s + 2]; rgba[o + 3] = 255; }
    else if (colour === 0) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = 255; }
    else if (colour === 4) { rgba[o] = rgba[o + 1] = rgba[o + 2] = px[s]; rgba[o + 3] = px[s + 1]; }
    else { const i = px[s]; if (!palette || i * 3 + 2 >= palette.length) throw Error('That PNG\'s palette is short.'); rgba[o] = palette[i * 3]; rgba[o + 1] = palette[i * 3 + 1]; rgba[o + 2] = palette[i * 3 + 2]; rgba[o + 3] = alpha && i < alpha.length ? alpha[i] : 255; }
  }
  return { width, height, rgba };
}

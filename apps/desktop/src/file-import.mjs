import { open, mkdir, link, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip } from 'node:zlib';
import path from 'node:path';

export const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const mediaTypeForName = (name) => ({ '.html': 'text/html', '.htm': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.pdf': 'application/pdf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }[path.extname(name).toLowerCase()] ?? 'application/octet-stream');

/** Preserve any regular file using bounded streams; file size chooses delivery, not acceptance. */
export async function preserveImportedFile(selected, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.import-${randomUUID()}`);
  const packed = `${temporary}.gz`;
  const handle = await open(selected, 'r');
  try {
    const initial = await handle.stat();
    if (!initial.isFile()) throw new Error('Choose a file. Folder import is not available yet.');
    const hash = createHash('sha256'); let byteLength = 0; let compressedByteLength = 0;
    await pipeline(handle.createReadStream({ autoClose: false }), new Transform({ transform(chunk, _encoding, next) { byteLength += chunk.length; hash.update(chunk); next(null, chunk); } }), createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
    const after = await handle.stat();
    if (after.size !== initial.size || after.mtimeMs !== initial.mtimeMs || after.ctimeMs !== initial.ctimeMs || byteLength !== initial.size) throw new Error('The source file changed during import. Save it and try again.');
    await pipeline(createReadStream(temporary), createGzip({ level: 9 }), new Transform({ transform(chunk, _encoding, next) { compressedByteLength += chunk.length; next(null, chunk); } }), createWriteStream(packed, { flags: 'wx', mode: 0o600 }));
    const id = hash.digest('hex');
    await link(temporary, path.join(directory, id)).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    await link(packed, path.join(directory, `${id}.gz`)).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    const name = path.basename(selected);
    return { id, name, type: mediaTypeForName(name), byteLength, compressedByteLength, compression: 'gzip', source: 'local-import' };
  } finally { await handle.close(); await rm(temporary, { force: true }); await rm(packed, { force: true }); }
}
const sizeLabel = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export async function readImportFile(selected, limit, purpose = 'file') {
  const name = path.basename(selected);
  const handle = await open(selected, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error(`Choose a file for this ${purpose} import. Folders cannot be imported here.`);
    const tooLarge = (size) => new Error(`${name} is ${sizeLabel(size)}. The ${purpose} import limit is ${sizeLabel(limit)}.${purpose === 'source' ? ' Add images, audio, models and other media in Objects. Unpack ZIP projects before importing their source files.' : ''}`);
    if (stat.size > limit) throw tooLarge(stat.size);
    const chunks = []; let total = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) throw tooLarge(total);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return { name, bytes: Buffer.concat(chunks, total) };
  } finally { await handle.close(); }
}

export function sourceFile(file) {
  const extension = path.extname(file.name).toLowerCase();
  if (['.zip', '.gz', '.tgz', '.tar', '.rar', '.7z'].includes(extension)) throw new Error('Unpack this archive first, then import its HTML, JavaScript and CSS files. Project-folder import is not available yet.');
  const media = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.glb', '.wasm', '.woff', '.woff2', '.ttf', '.pdf'];
  const binaryMessage = 'This is not a UTF-8 source file. Import media or binary files in Objects, then attach them to your project.';
  if (media.includes(extension)) throw new Error(binaryMessage);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes); } catch { throw new Error(binaryMessage); }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(content)) throw new Error(binaryMessage);
  if (file.bytes.length > MAX_SOURCE_BYTES) throw new Error('The source import limit is 4 MB.');
  const types = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
  return { name: file.name, content, type: types[extension] ?? 'text/plain' };
}

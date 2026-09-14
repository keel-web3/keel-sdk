import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

export const CURATED_WALLETS = Object.freeze([{
  id: 'metamask', name: 'MetaMask', version: '13.47.0', family: 'EVM', families: ['ethereum'],
  url: 'https://github.com/MetaMask/metamask-extension/releases/download/v13.47.0/metamask-chrome-13.47.0.zip',
  sha256: '0120b0dd07525710269b25e36e1719cb7013b5e42b645ecc1e8aed9a75977707',
  source: 'https://github.com/MetaMask/metamask-extension/releases/tag/v13.47.0',
}, {
  id: 'rabby', name: 'Rabby', version: '0.94.7', family: 'EVM', families: ['ethereum'],
  url: 'https://github.com/RabbyHub/Rabby/releases/download/v0.94.7/Rabby_v0.94.7.zip',
  sha256: 'cc752bf246bf70427748ce2b029649e446ea359709667d513b337b69a693dcd0',
  source: 'https://github.com/RabbyHub/Rabby/releases/tag/v0.94.7',
}, {
  id: 'temple', name: 'Temple', version: '2.0.31', family: 'Tezos + EVM', families: ['tezos', 'ethereum'],
  url: 'https://github.com/madfish-solutions/templewallet-extension/releases/download/2.0.31/chrome.zip',
  sha256: '45ca1aa71a2d7d60f3d2efe0ba15fc17cc32ca94c6cd28b4a8677496232d8bc5',
  source: 'https://github.com/madfish-solutions/templewallet-extension/releases/tag/2.0.31',
}]);

// A small, bounded ZIP reader for the pinned official package. Refuse ZIP64,
// links, duplicate paths and traversal before creating any file.
export function walletZipEntries(bytes) {
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || bytes.readUInt32LE(end) !== 0x06054b50 || bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6) || end + 22 + bytes.readUInt16LE(end + 20) !== bytes.length) throw Error('Unsupported wallet ZIP.');
  const count = bytes.readUInt16LE(end + 10); const start = bytes.readUInt32LE(end + 16);
  if (!count || count > 10000 || count !== bytes.readUInt16LE(end + 8) || start + bytes.readUInt32LE(end + 12) !== end) throw Error('Invalid wallet ZIP directory.');
  let offset = start; let total = 0; const files = []; const names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) throw Error('Invalid wallet ZIP entry.');
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10);
    const size = bytes.readUInt32LE(offset + 24), compressed = bytes.readUInt32LE(offset + 20);
    const n = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32);
    const mode = bytes.readUInt32LE(offset + 38) >>> 16; const local = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + n).toString('utf8'); offset += 46 + n + extra + comment;
    if (offset > end || !name || name.includes('\\') || name.includes('\0') || name.startsWith('/') || name.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..') || names.has(name) || (mode & 0xf000) === 0xa000 || flags & 1 || ![0,8].includes(method) || local + 30 > start) throw Error('Unsafe wallet ZIP entry.');
    names.add(name); total += size;
    if (total > 100 * 1024 * 1024 || bytes.readUInt32LE(local) !== 0x04034b50) throw Error('Wallet package exceeds limits.');
    const localNameSize = bytes.readUInt16LE(local + 26);
    if (bytes.subarray(local + 30, local + 30 + localNameSize).toString('utf8') !== name) throw Error('ZIP entry identity mismatch.');
    const data = local + 30 + localNameSize + bytes.readUInt16LE(local + 28);
    if (data + compressed > start) throw Error('Truncated wallet ZIP.');
    if (name.endsWith('/')) continue;
    const raw = bytes.subarray(data, data + compressed);
    const content = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
    if (content.length !== size) throw Error('Wallet file length mismatch.');
    files.push({ name, content });
  }
  if (offset !== end) throw Error('Invalid wallet ZIP length.');
  return files;
}

export async function downloadWallet(id, packages) {
  const source = CURATED_WALLETS.find(wallet => wallet.id === id);
  if (!source) throw Error('Unknown wallet download.');
  const response = await fetch(source.url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw Error('The official wallet download is unavailable. Try again shortly.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > 40_000_000) { await response.body.cancel().catch(() => {}); throw Error('Wallet download exceeds its expected size.'); } chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256) throw Error('Wallet download does not match the verified release. Nothing was installed.');
  await mkdir(packages.root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(packages.root, 'download-'));
  try {
    for (const file of walletZipEntries(bytes)) { const target = path.join(directory, file.name); await mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, file.content, { mode: 0o600, flag: 'wx' }); }
    return { ...await packages.stage(directory), officialRelease: source };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

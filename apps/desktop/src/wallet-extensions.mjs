import { constants } from 'node:fs';
import { mkdir, readdir, lstat, open, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const WALLET_SOURCES = Object.freeze([
  { id: 'metamask', name: 'MetaMask', url: 'https://metamask.io/download', family: 'EVM' },
  { id: 'rabby', name: 'Rabby', url: 'https://rabby.io', family: 'EVM' },
]);
const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 10000;
const uuid = /^[a-f0-9-]{36}$/;
const relativePath = (name) => typeof name === 'string' && name.length < 1024 && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && name.split('/').every((part) => part && part !== '.' && part !== '..');

// Copy reviewed bytes into a private directory. Never load the mutable user-selected folder.
async function packageFiles(root, destination) {
  let bytes = 0; const entries = [];
  const walk = async (directory, prefix = '', depth = 0) => {
    if (depth > 32) throw new Error('Extension folders are nested too deeply.');
    if (!(await lstat(directory)).isDirectory()) throw new Error('Choose an unpacked extension folder.');
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const name = prefix + entry.name;
      if (!relativePath(name) || ++walk.count > MAX_FILES) throw new Error('Extension contains too many files or an unsafe path.');
      const source = path.join(directory, entry.name);
      const stat = await lstat(source);
      if (stat.isSymbolicLink()) throw new Error('Extension folders cannot contain symbolic links.');
      if (stat.isDirectory()) {
        if (destination) await mkdir(path.join(destination, name), { mode: 0o700 });
        await walk(source, name + '/', depth + 1); continue;
      }
      if (!stat.isFile() || stat.size + bytes > MAX_BYTES) throw new Error('Choose an extension under 100 MB containing only regular files.');
      const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
      let data;
      try {
        const current = await file.stat();
        if (!current.isFile() || current.size + bytes > MAX_BYTES) throw new Error('Extension file changed during import.');
        data = await file.readFile();
      } finally { await file.close(); }
      bytes += data.length;
      if (bytes > MAX_BYTES) throw new Error('Extension exceeds 100 MB.');
      entries.push([name, createHash('sha256').update(data).digest('hex')]);
      if (destination) await writeFile(path.join(destination, name), data, { mode: 0o600, flag: 'wx' });
    }
  };
  walk.count = 0;
  await walk(root);
  return { digest: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), bytes, files: entries.length, names: new Set(entries.map(([name]) => name)) };
}

async function inspectPackage(directory) {
  const info = await packageFiles(directory);
  const raw = await readFile(path.join(directory, 'manifest.json'));
  if (raw.length > 256_000) throw new Error('Extension manifest exceeds 256 KB.');
  const manifest = JSON.parse(raw.toString('utf8'));
  if (!manifest || ![2,3].includes(manifest.manifest_version) || typeof manifest.name !== 'string' || !manifest.name || manifest.name.length > 256 || typeof manifest.version !== 'string' || !/^[\d.]{1,64}$/.test(manifest.version)) throw new Error('Extension manifest needs a name, version and supported manifest format.');
  const list = (value) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 256 || value.some((item) => typeof item !== 'string' || item.length > 2048)) throw new Error('Invalid extension permission list.'); return value; };
  const contentScripts = manifest.content_scripts ?? [];
  if (!Array.isArray(contentScripts) || contentScripts.length > 256) throw new Error('Invalid content script declarations.');
  const popup = manifest.action?.default_popup ?? manifest.browser_action?.default_popup ?? manifest.options_ui?.page ?? manifest.options_page;
  if (popup !== undefined && (!relativePath(popup) || !info.names.has(popup))) throw new Error('Extension start page must be a file in its package.');
  let name = manifest.name;
  if (/^__MSG_[\w]+__$/.test(name) && /^[a-zA-Z_-]{1,32}$/.test(manifest.default_locale ?? '')) {
    const messagesPath = path.join(directory, '_locales', manifest.default_locale, 'messages.json');
    try { const messages = JSON.parse(await readFile(messagesPath, 'utf8')); name = messages[name.slice(6,-2)]?.message ?? name; } catch { /* Retain the declared label if localization is missing. */ }
  }
  return {
    name: String(name).slice(0,256), version: manifest.version, manifestVersion: manifest.manifest_version,
    permissions: list(manifest.permissions), hostPermissions: list(manifest.host_permissions),
    optionalPermissions: [...list(manifest.optional_permissions), ...list(manifest.optional_host_permissions)],
    contentScriptMatches: [...new Set(contentScripts.flatMap((script) => list(script.matches)))],
    hasBackgroundWorker: !!manifest.background?.service_worker, entryPage: popup ?? null,
    startPage: name === 'MetaMask' && info.names.has('home.html') ? 'home.html' : name === 'Temple Wallet' && info.names.has('fullpage.html') ? 'fullpage.html' : popup ?? null,
    digest: info.digest, bytes: info.bytes, files: info.files,
    compatibility: 'unverified',
  };
}

export class WalletExtensionPackages {
  constructor(root) { this.root = root; this.pending = new Map(); }
  async stage(source) {
    if (this.pending.size >= 5) throw new Error('Finish or discard an extension review before importing another.');
    const token = randomUUID(); const directory = path.join(this.root, 'reviews', token);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await packageFiles(source, directory);
      const review = { ...await inspectPackage(directory), token };
      this.pending.set(token, review); return review;
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  }
  async discard(token) {
    if (!this.pending.has(token)) return;
    this.pending.delete(token); await rm(path.join(this.root, 'reviews', token), { recursive: true, force: true });
  }
  async install(token, digest) {
    const review = this.pending.get(token);
    if (!review || review.digest !== digest) throw new Error('Install must match the reviewed extension.');
    const stage = path.join(this.root, 'reviews', token);
    const current = await inspectPackage(stage);
    if (current.digest !== digest) throw new Error('Extension bytes changed after review. Discard and import again.');
    await mkdir(path.join(this.root, 'installed'), { recursive: true, mode: 0o700 });
    await rename(stage, this.directory(token)); this.pending.delete(token);
    return { ...current, installationId: token, enabled: true, installedAt: new Date().toISOString() };
  }
  directory(id) { if (!uuid.test(id)) throw new Error('Invalid extension installation.'); return path.join(this.root, 'installed', id); }
  async verify(record) {
    const current = await inspectPackage(this.directory(record.installationId));
    if (current.digest !== record.digest) throw new Error('Installed files changed. Extension is blocked; its wallet profile has been preserved.');
    return current;
  }
  async verifyDirectory(directory, digest) {
    if ((await inspectPackage(directory)).digest !== digest) throw new Error('Wallet package changed. Its saved profile has been preserved.');
  }
  async clearAbandonedReviews() { await rm(path.join(this.root, 'reviews'), { recursive: true, force: true }); }
}

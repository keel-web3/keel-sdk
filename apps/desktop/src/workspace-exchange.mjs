import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { stateSchema } from './workspace.mjs';

const blob = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), base64: z.string().max(90_000_000) }).strict();
const archive = z.object({ schema: z.literal('keel-workspace-export@1'), exportedAt: z.string().datetime(), state: stateSchema, blobs: z.array(blob).max(1000) }).strict();
export const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;

export function exportWorkspace(store) {
  const { state } = store.read(); let bytes = 0;
  const blobs = state.objects.map((object) => {
    if (bytes + object.byteLength > 64 * 1024 * 1024) throw new Error('Portable JSON export supports 64 MB total. Export larger originals individually from Objects; they remain preserved in this workspace.');
    const value = store.object(object.id); bytes += value.length;
    if (bytes > 64 * 1024 * 1024) throw new Error('Portable workspace export currently supports 64 MB of object data.');
    return { id: object.id, base64: value.toString('base64') };
  });
  const output = JSON.stringify({ schema: 'keel-workspace-export@1', exportedAt: new Date().toISOString(), state, blobs }, null, 2);
  if (Buffer.byteLength(output) > MAX_ARCHIVE_BYTES) throw new Error('Workspace export exceeds 96 MB.');
  return output;
}

export function inspectArchive(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > MAX_ARCHIVE_BYTES) throw new Error('Choose a KEEL workspace export smaller than 96 MB.');
  const value = archive.parse(JSON.parse(source));
  const blobs = new Map(); let total = 0;
  for (const item of value.blobs) {
    if (blobs.has(item.id)) throw new Error('Duplicate object bytes in the export.');
    const bytes = Buffer.from(item.base64, 'base64'); total += bytes.length;
    if (bytes.toString('base64') !== item.base64 || total > 64 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== item.id) throw new Error('Exported object bytes do not match their identity or size limit.');
    blobs.set(item.id, bytes);
  }
  if (value.state.objects.length !== blobs.size || value.state.objects.some((object) => blobs.get(object.id)?.length !== object.byteLength)) throw new Error('Export is missing original object bytes.');
  for (const key of ['projects','contracts','collections','wallets','memories','objects','moduleSelections']) if (new Set(value.state[key].map((item) => item.id)).size !== value.state[key].length) throw new Error(`Duplicate ${key} in export.`);
  return { state: value.state, blobs, digest: createHash('sha256').update(source).digest('hex') };
}

// Import adds copies of projects; chain/address contracts and byte objects are deduplicated.
// Existing records always win so an imported ABI never replaces the user's reviewed controls.
export function mergeArchive(store, imported, revision) {
  const current = store.read(); if (current.revision !== revision) throw new Error('Workspace changed. Review the import again.');
  const ids = new Map(imported.state.projects.map((project) => [project.id, randomUUID()]));
  const next = { ...current.state };
  next.projects = [...next.projects, ...imported.state.projects.map((project) => ({ ...project, id: ids.get(project.id), title: `${project.title.slice(0, 145)} (imported)` }))];
  for (const key of ['contracts','collections','objects']) next[key] = [...next[key], ...imported.state[key].filter((item) => !next[key].some((existing) => existing.id === item.id)).map((item) => item.projectId ? { ...item, projectId: ids.get(item.projectId) } : item)];
  for (const key of ['wallets','memories']) next[key] = [...next[key], ...imported.state[key].map((item) => ({ ...item, id: randomUUID(), ...(item.projectId ? { projectId: ids.get(item.projectId) ?? item.projectId } : {}) }))];
  next.moduleSelections = [...next.moduleSelections, ...imported.state.moduleSelections.map((item) => ({ ...item, id: randomUUID(), projectId: ids.get(item.projectId) }))];
  store.db.exec('BEGIN IMMEDIATE');
  try {
    for (const [id, bytes] of imported.blobs) store.db.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?)').run(id, bytes);
    const saved = store.save(next, revision); store.db.exec('COMMIT'); return saved;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

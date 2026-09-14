// The builder's project data, shared by main, the renderer and the tests (no
// Node, no engine code): a build is its op list, saved as a project file
// (builds/<name>.build.json) the worker replays; a built thing is saved as
// the builder's pack-file export (packs/<id>.ts). Destructive op batches are
// named here, so the agent tools send them through a review card first.
import { z } from 'zod';
export { opsHash } from './builder-ops-hash.mjs';

export const BUILD_FORMAT = 'keel-game-build@1';
/** A build's name: lower-case, digits and dashes (it names a project file). */
export const BUILD_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const buildName = z.string().regex(BUILD_NAME, 'Use a build name like main or war-banner.');
/** One builder op as JSON: the worker checks its fields against the builder's own table (validateOps). */
export const builderOp = z.object({ op: z.string().min(1).max(40) }).passthrough();
export const builderOps = z.array(builderOp).min(1).max(4000);
/** A saved build: everything it did, in order (an import alone is about a thousand ops). */
const savedOps = z.array(builderOp).max(20000);
/** The frame the builder preview document is served from (sandboxed like every keel-preview frame). */
export const BUILDER_PREVIEW_HOST = 'game-builder';
export const BUILDER_PREVIEW_URL = `keel-preview://${BUILDER_PREVIEW_HOST}/index.html`;
/** File types a 3D import reads (the engine's import tells formats from the bytes; these are what the picker offers). */
export const IMPORT_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl', 'vox'];
export const importable = (name = '') => IMPORT_EXTENSIONS.includes(String(name).toLowerCase().split('.').pop() ?? '');

export const builderKey = (projectId, name) => `${projectId}/${name}`;
export const buildFileName = (name) => `builds/${name}.build.json`;
const BUILD_FILE = /^builds\/([a-z0-9][a-z0-9-]{0,62})\.build\.json$/;
export const packFileName = (id) => `packs/${String(id).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'asset'}.ts`;

/** A build file's content: the format, its name and its op list (what replays it). */
export function writeBuildFile(name, ops) {
  return `${JSON.stringify({ format: BUILD_FORMAT, name, ops: savedOps.parse(ops) }, null, 1)}\n`;
}
export function readBuildFile(content) {
  let value;
  try { value = JSON.parse(content); } catch { throw Error('This build file is not JSON.'); }
  if (value?.format !== BUILD_FORMAT) throw Error(`This file is not a ${BUILD_FORMAT} build.`);
  return { name: buildName.parse(value.name), ops: savedOps.parse(value.ops ?? []) };
}

/** The project's builds, from its files (a broken file is listed with its error, never dropped). */
export function projectBuilds(project) {
  const out = [];
  for (const file of project?.files ?? []) {
    const match = BUILD_FILE.exec(file.name);
    if (!match) continue;
    try { out.push({ name: match[1], fileId: file.id, ops: readBuildFile(file.content).ops }); }
    catch (error) { out.push({ name: match[1], fileId: file.id, ops: [], error: error.message }); }
  }
  return out;
}

const uuid = () => globalThis.crypto.randomUUID();
function withFile(project, name, type, content) {
  const existing = project.files.find((file) => file.name === name);
  return { ...project, files: existing ? project.files.map((file) => file.id === existing.id ? { ...file, type, content } : file) : [...project.files, { id: uuid(), name, type, content }] };
}
/** The project with a build's op list saved (its file added or replaced). */
export const withBuildFile = (project, name, ops) => withFile(project, buildFileName(buildName.parse(name)), 'application/json', writeBuildFile(name, ops));
/** The project with pack files saved: [{ name: 'packs/x.ts', content }]. */
export function withPackFiles(project, files) {
  let next = project;
  for (const file of files) next = withFile(next, file.name, 'text/typescript', file.content);
  return next;
}

/** Two op lists as the same JSON. */
export const sameOps = (a, b) => a.length === b.length && JSON.stringify(a) === JSON.stringify(b);

/**
 * Ops that throw work away when the build already has something in it: a new
 * or generated model, a character replacing voxels (or the other way), an
 * erase of everything, undo of more than one step, forgetting a group or a
 * part. `state` is the build summary (keel_game_build_state): an empty build
 * loses nothing.
 */
export function destructiveOps(ops, state) {
  const hasWork = !!state && (state.model?.count > 0 || !!state.character || (state.history?.total ?? 0) > 0);
  if (!hasWork) return [];
  const out = [];
  ops.forEach((op, index) => {
    const why = op.op === 'new' ? 'starts an empty model'
      : op.op === 'generate' ? `replaces the build with a generated ${op.kind ?? 'model'}`
      : op.op === 'character' ? (state.character ? 'starts the character over' : 'sets the voxel model aside for a character')
      : op.op === 'erase' && (op.from === undefined || op.to === undefined) ? 'erases everything'
      : op.op === 'undo' && (op.steps ?? 1) > 1 ? `takes back ${op.steps} ops at once`
      : op.op === 'ungroup' ? `forgets the group ${op.name}`
      : op.op === 'unpart' ? `removes the part ${op.id}`
      : '';
    if (why) out.push({ index, op: op.op, why });
  });
  return out;
}

/** Largest file the 3D import reads (the engine parses it in memory, off the main thread). */
export const MAX_IMPORT_BYTES = 48 * 1024 * 1024;
/**
 * A workspace object's bytes for the import: it must be in the content-addressed store and verify.
 * @param {{ read(): { state: { objects: { id: string; name: string; byteLength: number }[] } }; verifyObject(id: string): Promise<unknown>; object(id: string): Uint8Array }} store
 * @param {string} id
 */
export async function importBytes(store, id) {
  const object = store.read().state.objects.find((item) => item.id === id);
  if (!object) throw Error('Import this file into KEEL first (Files, or the Import panel\'s file picker).');
  if (object.byteLength > MAX_IMPORT_BYTES) throw Error(`${object.name} is ${Math.round(object.byteLength / 1048576)} MB; the 3D import reads files up to ${MAX_IMPORT_BYTES / 1048576} MB.`);
  await store.verifyObject(id);
  return { name: object.name.replace(/\.[^.]+$/, ''), bytes: new Uint8Array(store.object(id)) };
}

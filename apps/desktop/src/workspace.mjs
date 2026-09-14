import {parseSVGRendererRecipe} from '@keel/sdk/svg-renderer-authoring';
import {parseDirectImageSettings} from '@keel/sdk/direct-image';
import {parseLayerCuration} from '@keel/sdk/layered-curation';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { parseKeelEngineIntent } from '@keel/sdk/engine';
import { createTrackedContract } from '@keel/sdk/contract-controls';
import { MAX_SOURCE_BYTES, preserveImportedFile } from './file-import.mjs';
import { readFileSync, existsSync, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { parseMetadata } from './metadata.mjs';
import { resolveRuntimeReferences, projectWithRuntime } from './runtime-library.mjs';
import { templateProject } from './creation-workflow.mjs';
import { gameSettingsSchema } from './game-engine/game-project.mjs';

import { layeredAssetIds, parseLayeredArt } from '@keel/sdk/layered-art';
const text = z.string().max(4000);
const runtimeReferenceSchema = z.array(z.object({ id: z.string().max(120), version: z.string().max(40), digest: z.string().regex(/^0x[a-f0-9]{64}$/), byteLength: z.number().int().positive() }).strict()).max(20).default([]);
const sourceName = z.string().min(1).max(160).refine((name) => !name.includes('\\') && !name.includes('\0') && name.split('/').every((part) => part && part !== '.' && part !== '..'), 'Use a relative project file name without traversal.');
export const projectSchema = z.object({
  svgRenderer:z.unknown().transform(parseSVGRendererRecipe).optional(),
  layerCuration:z.unknown().transform(parseLayerCuration).optional(),
  directImage: z.unknown().transform(parseDirectImageSettings).optional(),
  layered: z.unknown().transform(parseLayeredArt).optional(),
  id: z.string().uuid(), title: z.string().trim().min(1).max(160),
  intent: z.record(z.string(), z.unknown()).transform(parseKeelEngineIntent),
  files: z.array(z.object({ id: z.string().uuid(), name: sourceName, content: z.string().max(MAX_SOURCE_BYTES).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_SOURCE_BYTES, 'Each source file must fit within 4 MB. Import large media in Objects.'), type: z.string().max(160) }).strict()).max(100).refine((files) => new Set(files.map((f) => f.name)).size === files.length && new Set(files.map((f) => f.id)).size === files.length, 'Project file names and identities must be unique.'),
  objectIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000).default([]),
  runtimeModules: runtimeReferenceSchema.superRefine((refs, ctx) => { try { resolveRuntimeReferences(refs); } catch (error) { ctx.addIssue({ code: 'custom', message: error.message }); } }),
  contractIds: z.array(z.string().min(1).max(128)).max(1000).default([]),
  targetNetworkId: z.string().uuid().optional(),
  creation: z.object({ template: z.enum(['image', 'edition', 'collection', 'interactive', 'layered', 'game']), step: z.enum(['artwork', 'collection', 'review']), collectionName: z.string().max(160), artworkIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(1000), selectedCollectionId: z.string().max(256).optional() }).strict().optional(),
  presentation: z.object({ shell: z.enum(['canonical', 'none']).default('canonical'), delivery: z.enum(['auto', 'inline', 'hybrid']).default('auto'), entryObjectId: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().default({ shell: 'canonical', delivery: 'auto' }),
  listing: z.object({ artist: z.string().trim().max(160).default(''), tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]), discoverability: z.enum(['undecided', 'listed', 'unlisted']).default('undecided') }).strict().default({ artist: '', tags: [], discoverability: 'undecided' }),
  metadata: z.unknown().transform((value, ctx) => { try { return parseMetadata(value ?? {}); } catch (error) { ctx.addIssue({ code: 'custom', message: error.message }); return z.NEVER; } }).default({}),
  publication: z.object({ chainId: z.number().int().positive(), contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/), tokenId: z.string().max(78).regex(/^(0|[1-9]\d*)$/).refine((value) => BigInt(value) < 2n ** 256n), standard: z.enum(['erc721', 'erc1155']) }).strict().optional(),
  notes: text,
  game: gameSettingsSchema.optional(),
}).strict();
export const stateSchema = z.object({
  projects: z.array(projectSchema).max(100),
  contracts: z.array(z.unknown()).max(1000).transform((items) => items.map(createTrackedContract)),
  collections: z.array(z.object({ id: z.string().max(256), name: z.string().max(160), chainId: z.number().int().positive(), creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/), factory: z.string().regex(/^0x[0-9a-fA-F]{40}$/), contractId: z.string().max(80), collectionId: z.string().regex(/^[1-9]\d*$/), sharedCollectionId: z.string().regex(/^\d+$/), deployment: z.enum(['dedicated', 'shared', 'external']), observedBlock: z.string().regex(/^\d+$/) }).strict()).max(1000).default([]),
  wallets: z.array(z.object({ id: z.string().uuid(), label: z.string().min(1).max(160), family: z.enum(['ethereum', 'tezos']), address: z.string().min(1).max(128) }).strict().refine((wallet) => wallet.family === 'ethereum' ? /^0x[0-9a-fA-F]{40}$/.test(wallet.address) : /^(tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet.address), 'Enter a public address for the selected wallet family.')).max(100),
  memories: z.array(z.object({ id: z.string().uuid(), title: z.string().min(1).max(160), content: text, projectId: z.string().uuid().optional(), enabled: z.boolean().optional(), pinned: z.boolean().optional(), source: z.enum(['creator','assistant']).optional() }).strict()).max(200),
  objects: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().max(255), type: z.string().max(160), byteLength: z.number().int().nonnegative(), compressedByteLength: z.number().int().nonnegative().optional(), compression: z.literal('gzip').optional(), source: z.literal('local-import') }).strict()).max(5000),
  moduleSelections: z.array(z.object({ id: z.string().uuid(), projectId: z.string().uuid(), studioUrl: z.string().url().max(2048), name: z.string().max(160), metadata: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 64_000), observedAt: z.string().datetime(), evidence: z.literal('catalog-metadata-only') }).strict()).max(1000).default([]),
}).strict();
export const blankState = () => ({ projects: [], contracts: [], collections: [], wallets: [], memories: [], objects: [] });

// An app update may no longer ship a project's exact pinned runtime. Keep that
// project readable and editable; execution still resolves the exact identity.
// New or changed runtime selections continue to require installed bytes.
const savedStateSchema = stateSchema.extend({ projects: z.array(projectSchema.extend({ runtimeModules: runtimeReferenceSchema })).max(100) });

// Reads share one validated snapshot. Callers must build a new state before saving.
function freezeSnapshot(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

export class WorkspaceStore {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.objectDirectory = path === ':memory:' ? null : `${path}.objects`;
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK (id=1), revision INTEGER NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, bytes BLOB NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO workspace VALUES (1, 0, ?)').run(JSON.stringify(blankState()));
    this.readRevision = this.db.prepare('SELECT revision FROM workspace WHERE id=1');
    this.readBody = this.db.prepare('SELECT revision, body FROM workspace WHERE id=1');
    this.updateBody = this.db.prepare('UPDATE workspace SET revision=revision+1, body=? WHERE id=1 AND revision=?');
    this.snapshot = null;
  }
  read() {
    const { revision } = this.readRevision.get();
    if (this.snapshot?.revision === revision) return this.snapshot;
    const row = this.readBody.get();
    this.snapshot = freezeSnapshot({ revision: row.revision, state: savedStateSchema.parse(JSON.parse(row.body)) });
    return this.snapshot;
  }
  save(state, revision) {
    const parsed = savedStateSchema.parse(state);
    if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid workspace revision.');
    const current = this.read();
    if (current.revision !== revision) throw new Error('Workspace changed in another window. Reload before saving.');
    const previous = new Map(current.state.projects.map(project => [project.id, project]));
    for (const project of parsed.projects) {
      const before = previous.get(project.id);
      if (!before || JSON.stringify(before.runtimeModules) !== JSON.stringify(project.runtimeModules)) resolveRuntimeReferences(project.runtimeModules);
    }
    const body = JSON.stringify(parsed);
    if (Buffer.byteLength(body) > 16 * 1024 * 1024) throw new Error('Workspace exceeds the 16 MB draft limit. Import large media as objects.');
    for (const key of ['projects', 'contracts', 'collections', 'wallets', 'memories', 'objects', 'moduleSelections']) {
      if (new Set(parsed[key].map((item) => item.id)).size !== parsed[key].length) throw new Error(`Duplicate ${key} identity.`);
    }
    const contractIds = new Set(parsed.contracts.map((contract) => contract.id));
    const objectIds = new Set(parsed.objects.map((object) => object.id));
    for (const project of parsed.projects) {
      if (project.contractIds.some((id) => !contractIds.has(id))) throw new Error('Project refers to a contract that is not tracked in this workspace.');
      if (new Set(project.contractIds).size !== project.contractIds.length) throw new Error('Duplicate project contract link.');
      if (project.objectIds.some((id) => !objectIds.has(id))) throw new Error('Project refers to an unavailable object.');
      if (project.presentation.entryObjectId && !project.objectIds.includes(project.presentation.entryObjectId)) throw new Error('Attach the selected display object to the project first.');
      if (project.layered && layeredAssetIds(project.layered).some(id=>!project.objectIds.includes(id))) throw Error('Attach layer images before using them in the editor.');
      if(project.layerCuration?.versions.some(version=>layeredAssetIds(version.manifest).some(id=>!project.objectIds.includes(id))))throw Error('Keep the original layer assets attached while saved candidates use them.');
      if (project.creation?.artworkIds.some(id => !project.objectIds.includes(id))) throw new Error('Attach collection artwork before adding it to the guide.');
    }
    const result = this.updateBody.run(body, revision);
    if (result.changes !== 1) throw new Error('Workspace changed in another window. Reload before saving.');
    this.snapshot = freezeSnapshot({ revision: revision + 1, state: parsed });
    return this.snapshot;
  }
  importObject(bytes, name, type, revision) {
    const id = createHash('sha256').update(bytes).digest('hex');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read();
      if (current.revision !== revision) throw new Error('Workspace changed; reload before importing.');
      this.db.prepare('INSERT OR IGNORE INTO blobs VALUES (?, ?)').run(id, bytes);
      const result = this.save({ ...current.state, objects: [...current.state.objects.filter((o) => o.id !== id), { id, name, type, byteLength: bytes.byteLength, source: 'local-import' }] }, revision);
      this.db.exec('COMMIT'); return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  object(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid object digest.');
    const stored = this.objectFile(id);
    if (stored) { const bytes = readFileSync(stored); if (createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('Stored original bytes no longer match their digest. Restore the original before using this object.'); return bytes; }
    const row = this.db.prepare('SELECT bytes FROM blobs WHERE id=?').get(id);
    if (!row) throw new Error('Object bytes are unavailable.');
    return Buffer.from(row.bytes);
  }
  objectFile(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid object digest.');
    const file = this.objectDirectory && path.join(this.objectDirectory, id);
    return file && existsSync(file) ? file : null;
  }
  objectBody(id) {
    const file = this.objectFile(id);
    return file ? Readable.toWeb(createReadStream(file)) : this.object(id);
  }
  async verifyObject(id) {
    const file = this.objectFile(id); if (!file) { const bytes = this.object(id); if (createHash('sha256').update(bytes).digest('hex') !== id) throw new Error('Object digest mismatch.'); return; }
    const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== id) throw new Error('Stored original bytes no longer match their digest. Restore the original before exporting.');
  }
  async importFile(selected, revision) {
    if (!this.objectDirectory) throw new Error('File import requires a persistent workspace.');
    if (this.read().revision !== revision) throw new Error('Workspace changed; reload before importing.');
    const object = await preserveImportedFile(selected, this.objectDirectory);
    const current = this.read();
    if (current.revision !== revision) throw new Error('Workspace changed during import. The original file is preserved; try importing again.');
    const existing = current.state.objects.find((item) => item.id === object.id);
    return this.save({ ...current.state, objects: [...current.state.objects.filter((item) => item.id !== object.id), { ...object, ...(existing ? { name: existing.name } : {}) }] }, revision);
  }
  close() { this.db.close(); }
}

export function newProject(title, runtime = 'html') {
  return projectSchema.parse(projectWithRuntime({ id: randomUUID(), title, intent: { outcome: 'explore', runtime: 'html' }, notes: '', files: [{ id: randomUUID(), name: 'index.html', type: 'text/html', content: '<!doctype html>\n<html><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0d10;color:#f2f3f5;font:20px system-ui}main{text-align:center}h1{font:64px Georgia;margin:0}p{color:#9aa0ab}</style></head>\n<body><main><h1>Your next world.</h1><p>Make something worth keeping.</p></main></body></html>' }] }, runtime));
}

export function newTemplateProject(title, template) {
  return projectSchema.parse(templateProject(newProject(title), template));
}

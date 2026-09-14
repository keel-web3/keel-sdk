// The editor's side of the codec inspector: its own worker (a big document's
// explain never holds up a game build or the builder), recycled with the
// engine's sources like the game engine's -- the registry is rebuilt from the
// engine's schemas and every workspace manifest when they change. Inputs are
// resolved here (pasted text, a Files object from the content-addressed store,
// a saved project's codec record); the worker only ever sees bytes.
import { GameEngineService } from './game-engine-service.mjs';
import { MAX_CODEC_BYTES, parseCodecText, recordBytes } from './codec-project.mjs';

export class GameCodecService extends GameEngineService {
  /** @param {{ workerPath: string; engine?: GameEngineService; root?: string | null; searched?: string[]; projects?: string[]; [key: string]: unknown }} options -- `engine`: use the game engine's checkout (its root, where it looked, its projects). */
  constructor({ engine, ...options }) {
    super({ timeoutMs: 90_000, ...options, root: engine ? engine.root : options.root ?? null, searched: engine ? engine.searched : options.searched ?? [], projects: engine ? engine.projects : options.projects ?? [] });
  }

  schemas() { return this.cached('codec-schemas', () => this.call('schemas')); }
  explainBytes(bytes, { schema, maxNodes, maxHexBytes } = {}) { return this.call('explain', { bytes, ...(schema ? { schema } : {}), ...(maxNodes ? { maxNodes } : {}), ...(maxHexBytes !== undefined ? { maxHexBytes } : {}) }); }
  reencode(input) { return this.call('reencode', input); }
  solidity(schema, name) { return this.call('solidity', { schema, ...(name ? { name } : {}) }); }
  sample(kind) { return this.call('sample', { kind }); }
  async encodeOps(ops) { return (await this.call('encodeOps', { ops })).bytes; }

  /**
   * An inspector input as bytes and a label: exactly one of { text }, { objectId }
   * (a Files object, verified against its digest) or { projectId, file, record }
   * (the saved project in the store, or `project` when the caller already holds it).
   * @param {{ text?: string; objectId?: string; projectId?: string; file?: string; record?: string }} input
   * @param {{ store?: any; project?: any }} context
   */
  async resolve(input, { store, project } = {}) {
    const given = ['text', 'objectId', 'file'].filter((key) => input[key] !== undefined && input[key] !== '');
    if (given.length !== 1) throw new Error('Inspect one thing at a time: pasted text, a Files object, or a project file.');
    if (input.text !== undefined) { const { bytes, format } = parseCodecText(input.text); return { bytes, label: `Pasted ${format}`, format }; }
    if (input.objectId) {
      const object = store?.read().state.objects.find((item) => item.id === input.objectId);
      if (!object) throw new Error('That file isn’t in Files. Import it first.');
      if (object.byteLength > MAX_CODEC_BYTES) throw new Error(`${object.name} is ${Math.round(object.byteLength / 1048576)} MB; the inspector reads documents up to ${MAX_CODEC_BYTES / 1048576} MB.`);
      await store.verifyObject(object.id);
      return { bytes: new Uint8Array(store.object(object.id)), label: object.name, format: 'file' };
    }
    const saved = project ?? store?.read().state.projects.find((item) => item.id === input.projectId);
    if (!saved) throw new Error('Project not found.');
    const found = recordBytes(saved, input.file, input.record);
    const label = `${found.file}${found.record && found.record !== 'document' ? ` · ${found.record}` : ''}`;
    if (found.ops) return { bytes: await this.encodeOps(found.ops), label: `${label} (packed with storeOps)`, format: 'ops', ops: found.ops.length };
    return { bytes: found.bytes, label, format: 'record' };
  }

  /** Resolve an input and explain it: what the procedure and the agent tool return (plus where it came from). */
  async explain(input, context = {}) {
    const source = await this.resolve(input, context);
    const result = await this.explainBytes(source.bytes, { schema: input.schema, maxNodes: input.maxNodes, maxHexBytes: input.maxHexBytes });
    return { ...result, source: { label: source.label, format: source.format, ...(source.ops !== undefined ? { ops: source.ops } : {}) } };
  }
}

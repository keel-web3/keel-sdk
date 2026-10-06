import { compileKeelCollectorMetadata, readKeelTokenMatrix, type KeelCollectorMetadataOptions } from '@keel/sdk';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ToolDefinition } from './types.js';

export const METADATA_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: 'keel-metadata-prepare',
    description: 'Default collector metadata import. Compile generator/imported marketplace fields and optional full records into shared native dictionary slugs and binary token rows. JSON is assembled by KeelTokenMatrix when read; no complete document is stored per token in the default mode, and no Base64/hex payload files are created. Explicit json/none choices remain available. Preparation does not publish or sign.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['manifestPath', 'outputDirectory'], properties: {
      manifestPath: { type: 'string', maxLength: 4096, description: 'Workspace input: {tokenCount,tokens:[{tokenId,metadata,details?}]}. Metadata and details must be actual generator/importer output; do not invent traits or reroll seeds.' },
      outputDirectory: { type: 'string', maxLength: 4096, description: 'Existing workspace directory for native .bin files and the local binding plan.' },
      storage: { type: 'string', enum: ['compact-matrix', 'json', 'none'], description: 'Defaults to compact-matrix. json is an explicit complete-document compatibility option; none explicitly disables metadata.' },
      blockBytes: { type: 'integer', minimum: 4, maximum: 23000 },
      dictionaryBytes: { type: 'integer', minimum: 1, maximum: 23000 },
    } },
  },
  async run(context, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('Invalid metadata request.');
    const args = input as Record<string, unknown>;
    if (Object.keys(args).some(key => !['manifestPath', 'outputDirectory', 'storage', 'blockBytes', 'dictionaryBytes'].includes(key))) throw new TypeError('Unknown metadata request field.');
    if (typeof args.manifestPath !== 'string' || typeof args.outputDirectory !== 'string') throw new TypeError('Supply metadata input and an output directory.');
    const output = await context.workspace.resolveExistingDirectory(args.outputDirectory);
    const source = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode((await context.workspace.readFile(args.manifestPath, 16_000_000)).bytes));
    if (!source || !Number.isInteger(source.tokenCount) || !Array.isArray(source.tokens) || !source.tokens.length || source.tokens.length > 100000 || Object.keys(source).some(key => !['tokenCount', 'tokens'].includes(key))) throw new TypeError('Invalid metadata manifest.');
    for (const token of source.tokens) if (!token || Object.keys(token).some(key => !['tokenId', 'metadata', 'details'].includes(key))) throw new TypeError('Invalid metadata token.');
    const compiled = compileKeelCollectorMetadata(source.tokens, source.tokenCount, {
      ...(args.storage === undefined ? {} : { storage: args.storage as NonNullable<KeelCollectorMetadataOptions['storage']> }),
      ...(args.blockBytes === undefined ? {} : { blockBytes: args.blockBytes as number }),
      ...(args.dictionaryBytes === undefined ? {} : { dictionaryBytes: args.dictionaryBytes as number }),
    });
    const digest = (bytes: Uint8Array) => { const hash = createHash('sha256'); hash.update(bytes); return '0x' + hash.digest('hex'); };
    const save = async (name: string, bytes: Uint8Array) => ({ path: await context.workspace.writeBytes(path.join(output, name), bytes), byteLength: bytes.length, sha256: digest(bytes) });
    const prepare = async (name: string, group: Extract<ReturnType<typeof compileKeelCollectorMetadata>, {enabled: true}>['marketplace']) => {
      const { matrix, dictionary } = group;
      const pages = [];
      for (const page of dictionary.pages) pages.push({ ...await save(`${name}-dictionary-${page.index}.bin`, page.bytes), slugId: page.slugId, entries: page.entries,
        bindings: Array.from({length: Math.ceil(page.entries.length / 100)}, (_, batch) => {
          const entries = page.entries.slice(batch * 100, (batch + 1) * 100);
          return {firstKey: entries[0]!.key, boundaries: [...entries.map(entry => entry.offset), entries.at(-1)!.offset + entries.at(-1)!.length]};
        }) });
      const objects = [];
      for (const value of dictionary.objects) objects.push({ key: value.id, ...await save(`${name}-value-${value.id}.bin`, value.bytes) });
      const rows = [];
      for (const block of matrix.blocks) rows.push({ index: block.index, ...await save(`${name}-rows-${block.index}.bin`, block.bytes) });
      return { deploymentLayout: matrix.deploymentLayout, pages, objects, rows, templates: matrix.templates,
        storedBytes: matrix.sharedValueBytes + matrix.matrixBytes, matrixBytes: matrix.matrixBytes,
        readPlan: dictionary.readPlan, expected: matrix.rows.map(row => { const bytes = readKeelTokenMatrix(matrix, row.tokenId); return { tokenId: row.tokenId, byteLength: bytes.length, sha256: digest(bytes) }; }) };
    };
    const result = { schema: compiled.schema, storage: compiled.storage, enabled: compiled.enabled,
      base64Layers: 0, published: false, selectedChainBindingsVerified: false,
      ...(compiled.enabled ? { marketplace: await prepare('marketplace', compiled.marketplace),
        ...(compiled.details ? { details: await prepare('details', compiled.details) } : {}), warnings: compiled.warnings } : {}),
      binding: 'KeelTokenMatrix: cast native slugs, bindPackedTable(firstKey,slugId,boundaries), bindTemplate, bindRowBlock. Oversize values use bindTable/object storage. Read back tokenJSON and compare the expected SHA256 before accepting publication.',
    };
    const manifestPath = await context.workspace.writeJson(path.join(output, 'metadata-plan.json'), result);
    return { ...result, manifestPath };
  },
}];

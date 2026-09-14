import { compileKeelTokenMatrix, readKeelTokenMatrix, type KeelMatrixToken } from '@keel/sdk';
import { createHash } from 'node:crypto';
import type { ToolDefinition } from './types.js';
const sha256 = (bytes: Uint8Array) => { const hash = createHash('sha256'); hash.update(bytes); return `0x${hash.digest('hex')}`; };
const toHex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString('hex')}`;

export const MATRIX_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: 'keel-token-matrix-prepare',
    description: 'Compile shared metadata, traits and media parts into reusable storage values, output templates and compact token selection rows. Uses the same SDK compiler as the editor. Reads workspace files only; does not sign, upload, or change a collection.',
    inputSchema: { type:'object', properties:{
      manifestPath:{type:'string',maxLength:4096,description:'Workspace JSON: {tokenCount,tokens:[{tokenId,parts:[{role,path}]}]}. Large collections can declare shared parts:[{id,role,path}] once and use partIds:[id,...] in each token. Part ID 0 inserts the current decimal token ID. Missing rows remain unavailable.'},
      outputPath:{type:'string',maxLength:4096,description:'Optional workspace path for the prepared matrix manifest.'},
    }, required:['manifestPath'], additionalProperties:false },
  },
  async run(context, input) {
    const args = input as Record<string,unknown>;
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k=>!['manifestPath','outputPath'].includes(k))) throw Error('Invalid matrix request.');
    for (const key of ['manifestPath','outputPath']) if (args[key] !== undefined && (typeof args[key] !== 'string' || (args[key] as string).length > 4096)) throw Error('Invalid workspace path.');
    if (typeof args.manifestPath !== 'string') throw Error('Supply a matrix manifest.');
    const source = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode((await context.workspace.readFile(args.manifestPath,16_000_000)).bytes));
    if (!source || !Number.isInteger(source.tokenCount) || source.tokenCount < 1 || source.tokenCount > 100000 || !Array.isArray(source.tokens) || !source.tokens.length || source.tokens.length > source.tokenCount) throw Error('Invalid matrix supply.');
    const shared = new Map<number,{role:string;path:string}>();
    if (source.parts !== undefined) {
      if (!Array.isArray(source.parts) || source.parts.length > 100000) throw Error('Invalid shared part dictionary.');
      for (const part of source.parts) {
        if (!part || !Number.isSafeInteger(part.id) || part.id < 1 || shared.has(part.id)) throw Error('Duplicate or invalid shared part ID.');
        shared.set(part.id,part);
      }
    }
    const cache = new Map<string,Uint8Array>(), paths = new Map<string,string>();
    let bytesRead = 0;
    const tokens: KeelMatrixToken[] = [];
    for (const token of source.tokens) {
      if (!token || (token.parts !== undefined && token.partIds !== undefined)) throw Error('Choose inline parts or shared part IDs.');
      if (token.partIds !== undefined && (!Array.isArray(token.partIds) || token.partIds.length > 512)) throw Error('Invalid shared part references.');
      const inputParts = token.partIds === undefined ? token.parts : token.partIds.map((id: number)=>id === 0 ? 0 : shared.get(id));
      if (!Array.isArray(inputParts) || !inputParts.length || inputParts.length > 512) throw Error('Invalid token parts.');
      const parts = [];
      for (const part of inputParts) {
        if (part === 0 && token.partIds !== undefined) { parts.push({role:'token-id',bytes:new TextEncoder().encode(String(token.tokenId))}); continue; }
        if (!part || typeof part.path !== 'string' || part.path.length > 4096 || typeof part.role !== 'string' || part.role.length > 128) throw Error('Invalid matrix part.');
        let bytes = cache.get(part.path);
        if (!bytes) {
          bytes = (await context.workspace.readFile(part.path,2_000_000)).bytes;
          bytesRead += bytes.length; if (bytesRead > 128_000_000) throw Error('This preparation exceeds the 128 MB local input budget.');
          cache.set(part.path,bytes); paths.set(sha256(bytes),part.path);
        }
        if (part.encoding !== undefined) throw Error('Matrix values must be prepared before storage; read-time encoding is not supported.');
        parts.push({role:part.role,bytes});
      }
      tokens.push({tokenId:token.tokenId,parts});
    }
    const matrix = compileKeelTokenMatrix(tokens,source.tokenCount);
    const result = {
      schema:matrix.schema, tokenCount:matrix.tokenCount,populatedTokens:matrix.populatedTokens,complete:matrix.complete,
      rowStride:matrix.rowStride,rowsPerBlock:matrix.rowsPerBlock,matrixBytes:matrix.matrixBytes,sharedValueBytes:matrix.sharedValueBytes,
      table:matrix.table.map(value=>({id:value.id,digest:value.digest,byteLength:value.bytes.length,roles:value.roles,path:paths.get(value.digest)})),
      templates:matrix.templates,
      blocks:matrix.blocks.map(block=>({index:block.index,bytes:toHex(block.bytes),digest:sha256(block.bytes)})),
      reads:matrix.rows.map(row=>{const bytes=readKeelTokenMatrix(matrix,row.tokenId);return {tokenId:row.tokenId,byteLength:bytes.length,digest:sha256(bytes)};}),
      published:false,selectedChainBindingsVerified:false,
    };
    const outputPath = args.outputPath === undefined ? undefined : await context.workspace.writeJson(args.outputPath as string,result);
    return outputPath ? {
      schema:result.schema, outputPath, tokenCount:result.tokenCount, populatedTokens:result.populatedTokens,
      complete:result.complete, rowStride:result.rowStride, matrixBytes:result.matrixBytes,
      sharedValueBytes:result.sharedValueBytes, sharedValues:result.table.length, templates:result.templates.length,
      published:false, selectedChainBindingsVerified:false,
    } : result;
  },
}];

import { sha256, type Hex } from 'viem';

export const KEEL_MATRIX_TOKEN_ID = 0xffff;
export const KEEL_MATRIX_ROW_SLOT = 0x8000;
type Piece = { readonly role: string; readonly bytes: Uint8Array };
export interface KeelMatrixToken { readonly tokenId: number; readonly parts: readonly Piece[] }

/** Compile shared output templates and trait/resource tables. Token rows contain
 * only 16-bit choices; they never contain a JSON document or an image payload.
 * Equal resources share one table entry even across different template layouts.
 */
export function compileKeelTokenMatrix(tokens: readonly KeelMatrixToken[], tokenCount: number) {
  if (!Number.isSafeInteger(tokenCount) || tokenCount < 1 || tokenCount > 100_000 || !tokens.length) throw new Error('Invalid matrix supply.');
  const table: { id: number; digest: Hex; bytes: Uint8Array; roles: string[] }[] = [];
  const byDigest = new Map<Hex, number>();
  const byBytes = new WeakMap<Uint8Array, number>();
  const groups = new Map<string, { tokenId: number; values: number[] }[]>();
  const seen = new Set<number>();
  for (const token of [...tokens].sort((a, b) => a.tokenId - b.tokenId)) {
    if (!Number.isSafeInteger(token.tokenId) || token.tokenId < 0 || token.tokenId >= tokenCount || seen.has(token.tokenId)) throw new Error('Duplicate or invalid token ID.');
    seen.add(token.tokenId);
    if (!token.parts.length || token.parts.length > 512) throw new Error('Invalid matrix template length.');
    const values = token.parts.map(part => {
      if (!part.bytes.length) throw new Error('Empty matrix fragment.');
      if (part.role === 'token-id') {
        if (new TextDecoder().decode(part.bytes) !== String(token.tokenId)) throw new Error('Token ID fragment mismatch.');
        return KEEL_MATRIX_TOKEN_ID;
      }
      let id = byBytes.get(part.bytes);
      if (id === undefined) {
        const bytes = part.bytes, digest = sha256(bytes);
        id = byDigest.get(digest);
        if (id === undefined) {
          id = table.length + 1;
          if (id >= KEEL_MATRIX_ROW_SLOT) throw new Error('Matrix needs more than 32767 shared values.');
          table.push({ id, digest, bytes: bytes.slice(), roles: [] }); byDigest.set(digest, id);
        } else {
          const entry = table[id - 1]!;
          if (entry.bytes.length !== bytes.length || entry.bytes.some((b, i) => b !== bytes[i])) throw new Error('Conflicting matrix digest.');
        }
        byBytes.set(bytes, id);
      }
      const entry = table[id - 1]!;
      if (!entry.roles.includes(part.role)) entry.roles.push(part.role);
      return id;
    });
    // token-id placeholders must remain aligned even when other roles match.
    const key = JSON.stringify(token.parts.map(part => part.role));
    const group = groups.get(key) ?? []; group.push({ tokenId: token.tokenId, values }); groups.set(key, group);
  }
  const templates: { id: number; commands: number[]; slots: number }[] = [];
  const rows: { tokenId: number; templateId: number; choices: number[] }[] = [];
  for (const group of groups.values()) {
    const first = group[0]!; let slots = 0;
    const commands = first.values.map((value, at) => group.every(row => row.values[at] === value) ? value : KEEL_MATRIX_ROW_SLOT + slots++);
    if (slots > 512 || templates.length >= 65534) throw new Error('Matrix template exceeds its compact row bounds.');
    const template = { id: templates.length + 1, commands, slots }; templates.push(template);
    for (const row of group) rows.push({ tokenId: row.tokenId, templateId: template.id,
      choices: row.values.filter((_, i) => commands[i]! >= KEEL_MATRIX_ROW_SLOT && commands[i] !== KEEL_MATRIX_TOKEN_ID) });
  }
  rows.sort((a, b) => a.tokenId - b.tokenId);
  const rowStride = 4 + 2 * Math.max(...templates.map(t => t.slots));
  const rowsPerBlock = Math.floor(23_000 / rowStride);
  const blocks = Array.from({ length: Math.ceil(tokenCount / rowsPerBlock) }, (_, index) => ({ index,
    bytes: new Uint8Array(Math.min(rowsPerBlock, tokenCount - index * rowsPerBlock) * rowStride) }));
  for (const row of rows) {
    const block = blocks[Math.floor(row.tokenId / rowsPerBlock)]!;
    const view = new DataView(block.bytes.buffer), offset = (row.tokenId % rowsPerBlock) * rowStride;
    view.setUint16(offset, row.templateId); view.setUint16(offset + 2, row.choices.length);
    row.choices.forEach((id, i) => view.setUint16(offset + 4 + i * 2, id));
  }
  return { schema: 'keel-token-matrix@1' as const, tokenCount, populatedTokens: rows.length,
    complete: rows.length === tokenCount, table, templates, rows, blocks, rowStride, rowsPerBlock,
    sharedValueBytes: table.reduce((n, entry) => n + entry.bytes.length, 0),
    matrixBytes: blocks.reduce((n, block) => n + block.bytes.length, 0) };
}

export function readKeelTokenMatrix(matrix: ReturnType<typeof compileKeelTokenMatrix>, tokenId: number): Uint8Array {
  if (!Number.isInteger(tokenId) || tokenId < 0 || tokenId >= matrix.tokenCount) throw new Error('Invalid token ID.');
  const block = matrix.blocks[Math.floor(tokenId / matrix.rowsPerBlock)]!;
  const view = new DataView(block.bytes.buffer, block.bytes.byteOffset, block.bytes.byteLength);
  const offset = tokenId % matrix.rowsPerBlock * matrix.rowStride;
  const template = matrix.templates[view.getUint16(offset) - 1];
  if (!template || view.getUint16(offset + 2) !== template.slots) throw new Error('Token has no complete matrix row.');
  const parts = template.commands.map(command => {
    if (command === KEEL_MATRIX_TOKEN_ID) return new TextEncoder().encode(String(tokenId));
    const id = command >= KEEL_MATRIX_ROW_SLOT ? view.getUint16(offset + 4 + 2 * (command - KEEL_MATRIX_ROW_SLOT)) : command;
    const item = matrix.table[id - 1]; if (!item || sha256(item.bytes) !== item.digest) throw new Error('Missing or corrupt matrix value.');
    return item.bytes;
  });
  const output = new Uint8Array(parts.reduce((n, bytes) => n + bytes.length, 0));
  let at = 0; for (const bytes of parts) { output.set(bytes, at); at += bytes.length; }
  return output;
}


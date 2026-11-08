import { createHash } from 'node:crypto';

const hash = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
};

/** KOC1 metadata leaf, with a one-based u32 position. */
export function metadataLeaf(position: number, message: string): Buffer {
  if (!Number.isInteger(position) || position < 1 || position > 0xffffffff) throw new RangeError('position');
  const n = Buffer.alloc(4);
  n.writeUInt32BE(position);
  return hash(Buffer.from([0]), Buffer.from('KOC1'), n, hash(Buffer.from(message, 'utf8')));
}

/** KOC1 tree: odd nodes are carried unchanged; an empty tree has a zero root. */
export function merkleRoot(leaves: readonly Uint8Array[]): Buffer {
  let level = leaves.map(x => {
    if (x.length !== 32) throw new RangeError('leaf length');
    return Buffer.from(x);
  });
  if (!level.length) return Buffer.alloc(32);
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? hash(Buffer.from([1]), level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

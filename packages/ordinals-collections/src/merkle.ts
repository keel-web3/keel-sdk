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

export type MerkleSibling = { side: 'left' | 'right'; hash: Buffer };

/** Build a KOC1 proof without inventing siblings at promoted odd levels. */
export function merkleProof(leaves: readonly Uint8Array[], index: number): MerkleSibling[] {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) throw new RangeError('index');
  let level = leaves.map(x => {
    if (x.length !== 32) throw new RangeError('leaf length');
    return Buffer.from(x);
  });
  const proof: MerkleSibling[] = [];
  while (level.length > 1) {
    const sibling = index ^ 1;
    if (sibling < level.length) proof.push({ side: sibling < index ? 'left' : 'right', hash: level[sibling] });
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? hash(Buffer.from([1]), level[i], level[i + 1]) : level[i]);
    level = next;
    index = Math.floor(index / 2);
  }
  return proof;
}

export function verifyMerkleProof(leaf: Uint8Array, proof: readonly MerkleSibling[], root: Uint8Array): boolean {
  if (leaf.length !== 32 || root.length !== 32) return false;
  let current = Buffer.from(leaf);
  for (const sibling of proof) {
    if (!sibling || (sibling.side !== 'left' && sibling.side !== 'right') || sibling.hash?.length !== 32) return false;
    current = sibling.side === 'left'
      ? hash(Buffer.from([1]), sibling.hash, current)
      : hash(Buffer.from([1]), current, sibling.hash);
  }
  return current.equals(root);
}

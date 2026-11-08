import { createHash } from 'node:crypto';

const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const bytes = (value, length, label) => {
  if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length * 2}}$`).test(value)) throw new TypeError(`invalid ${label}`);
  return Buffer.from(value, 'hex');
};
const u32 = (value, label) => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError(`invalid ${label}`);
  const result = Buffer.alloc(4); result.writeUInt32BE(value); return result;
};
const tree = leaves => {
  if (!leaves.length) return Buffer.alloc(32);
  while (leaves.length > 1) {
    const next = [];
    for (let i = 0; i < leaves.length; i += 2) next.push(i + 1 === leaves.length ? leaves[i] : hash(Buffer.from([1]), leaves[i], leaves[i + 1]));
    leaves = next;
  }
  return leaves[0];
};
const leaf = (entry, rank) => hash(Buffer.from('KOC1/m'), u32(rank, 'rank'), bytes(entry.txid, 32, 'txid'), u32(entry.height, 'height'), u32(entry.txIndex, 'txIndex'), bytes(entry.m, 32, 'minter key'), bytes(entry.paymentOutpoint, 36, 'payment outpoint'));

// Inputs must already be independently validated and classified as members or refund candidates.
// This commitment primitive does not establish mint validity, completeness, or chain membership.
export function indexRoot({ recipe, height, blockhash, members, refunds }) {
  if (!Array.isArray(members) || !Array.isArray(refunds)) throw new TypeError('members and refunds must be arrays');
  const seen = new Set();
  for (const group of [members, refunds]) {
    let previous = null;
    for (const entry of group) {
      const key = bytes(entry.txid, 32, 'txid').toString('hex');
      if (seen.has(key)) throw new Error('duplicate transaction');
      seen.add(key);
      u32(entry.height, 'height'); u32(entry.txIndex, 'txIndex');
      if (entry.height > height) throw new Error('entry exceeds covered height');
      if (previous && (entry.height < previous.height || (entry.height === previous.height && entry.txIndex <= previous.txIndex))) throw new Error('entries out of order');
      previous = entry;
    }
  }
  const membersRoot = tree(members.map((entry, i) => leaf(entry, i + 1)));
  const overRoot = tree(refunds.map((entry, i) => leaf(entry, i + 1)));
  const root = hash(Buffer.from('KOC1/i'), bytes(recipe, 36, 'recipe'), u32(height, 'height'), bytes(blockhash, 32, 'blockhash'), u32(members.length, 'count'), membersRoot, overRoot);
  return { count: members.length, over: refunds.length, membersRoot: membersRoot.toString('hex'), overRoot: overRoot.toString('hex'), indexRoot: root.toString('hex') };
}

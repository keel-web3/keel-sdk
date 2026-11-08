import { createHash } from 'node:crypto';

const hash = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('sha256');
  for (const part of parts) h.update(part);
  return h.digest();
};

/** Frozen KOC1 D5 blind permutation; IDs and block hashes use internal bytes. */
export function permutation(recipe: Uint8Array, blockhash: Uint8Array, max: number): { seed: Buffer; perm: number[] } {
  if (recipe.length !== 36 || blockhash.length !== 32) throw new RangeError('commitment length');
  if (!Number.isSafeInteger(max) || max < 1 || max > 0xffffffff) throw new RangeError('max');
  const seed = hash(Buffer.from('KOC1/perm'), recipe, blockhash);
  const perm = Array.from({ length: max }, (_, i) => i + 1);
  for (let i = max - 1; i > 0; i--) {
    const n = Buffer.alloc(4);
    n.writeUInt32BE(i);
    const j = Number(BigInt('0x' + hash(seed, n).toString('hex')) % BigInt(i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return { seed, perm };
}

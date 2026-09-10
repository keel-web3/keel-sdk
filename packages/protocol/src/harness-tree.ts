/** Four little-endian uint64 references per word: uint32 revision, uint32 key. */
export interface HarnessChild { readonly key: number; readonly revision: number }
export interface HarnessObject { readonly objectId: `0x${string}`; readonly revision: bigint }
export interface HarnessNode {
  readonly metadata: bigint;
  readonly children: readonly bigint[];
  readonly objects: readonly HarnessObject[];
}
const U32 = (1n << 32n) - 1n;
const U256 = (1n << 256n) - 1n;
function u32(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 1 || value > Number(U32)) throw new RangeError("Harness key/revision must fit a nonzero uint32.");
  return BigInt(value);
}
export function packHarnessChildren(children: readonly HarnessChild[]): bigint[] {
  if (children.length < 1 || children.length > 128) throw new RangeError("A Harness branch requires 1–128 children.");
  const words = Array<bigint>(Math.ceil(children.length / 4)).fill(0n);
  children.forEach((child, index) => {
    words[index >> 2] = words[index >> 2]! | (((u32(child.key) << 32n) | u32(child.revision)) << BigInt((index & 3) * 64));
  });
  return words;
}
export function unpackHarnessChildren(count: number, words: readonly bigint[]): HarnessChild[] {
  if (!Number.isSafeInteger(count) || count < 1 || count > 128 || words.length !== Math.ceil(count / 4)) throw new RangeError("Invalid Harness child count/word length.");
  for (const word of words) if (word < 0n || word > U256) throw new RangeError("Invalid Harness word.");
  if (count % 4 !== 0 && (words.at(-1)! >> BigInt((count % 4) * 64)) !== 0n) throw new RangeError("Nonzero Harness tail padding.");
  return Array.from({length: count}, (_, i) => {
    const entry = words[i >> 2]! >> BigInt((i & 3) * 64);
    const key = Number((entry >> 32n) & U32), revision = Number(entry & U32);
    u32(key); u32(revision);
    return {key, revision};
  });
}
export function decodeHarnessTreeMetadata(word: bigint): {count: number; depth: number; objects: bigint} {
  if (word <= 0n || word >> 80n !== 0n) throw new RangeError("Invalid Harness metadata.");
  const value = {count: Number(word & 255n), depth: Number((word >> 8n) & 255n), objects: word >> 16n};
  if (value.count < 1 || value.count > 128 || value.depth < 2 || value.objects < 1n) throw new RangeError("Invalid Harness metadata bounds.");
  return value;
}
export interface HarnessWalkLimits {
  readonly maxObjects?: number;
  readonly maxDepth?: number;
  readonly maxNodeReads?: number;
  readonly maxVisits?: number;
  readonly signal?: AbortSignal;
}
/** Iterative DFS preserves repeated slots/order while caching immutable node reads.
 * Child latest revisions and token-specific child forks are deliberately never followed. */
export async function resolveHarnessTree(
  root: HarnessNode,
  readNode: (child: HarnessChild) => Promise<HarnessNode>,
  limits: HarnessWalkLimits = {},
): Promise<HarnessObject[]> {
  const maxObjects = limits.maxObjects ?? 1_000_000, maxDepth = limits.maxDepth ?? 64;
  const maxNodeReads = limits.maxNodeReads ?? 65_536, maxVisits = limits.maxVisits ?? 2_000_000;
  for (const value of [maxObjects, maxDepth, maxNodeReads, maxVisits]) {
    if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("Invalid Harness traversal budget.");
  }
  type Frame = {node: HarnessNode; refs: HarnessChild[]; index: number; total: number; depth: number; key?: string};
  const cache = new Map<string, HarnessNode>(), active = new Set<string>();
  let reads = 0, visits = 0;
  function frame(node: HarnessNode, key?: string): Frame {
    if (++visits > maxVisits) throw new RangeError("Harness visit budget exceeded.");
    let refs: HarnessChild[] = [];
    if (node.metadata === 0n) {
      if (node.children.length !== 0 || node.objects.length < 1 || node.objects.length > 128) throw new Error("Invalid Harness leaf.");
      for (const object of node.objects) {
        if (!/^0x[0-9a-fA-F]{64}$/.test(object.objectId) || BigInt(object.objectId) === 0n || object.revision < 1n || object.revision >= 1n << 64n) throw new Error("Invalid Harness object.");
      }
    } else {
      const meta = decodeHarnessTreeMetadata(node.metadata);
      if (node.objects.length !== 0 || meta.objects > BigInt(maxObjects) || meta.depth > maxDepth) throw new RangeError("Harness tree exceeds traversal bounds.");
      refs = unpackHarnessChildren(meta.count, node.children);
    }
    return {node, refs, index: 0, total: 0, depth: 1, ...(key === undefined ? {} : {key})};
  }
  const stack: Frame[] = [frame(root)], out: HarnessObject[] = [];
  while (stack.length !== 0) {
    limits.signal?.throwIfAborted();
    if (stack.length > maxDepth) throw new RangeError("Harness depth budget exceeded.");
    const current = stack.at(-1)!;
    if (current.node.metadata === 0n) {
      if (out.length + current.node.objects.length > maxObjects) throw new RangeError("Harness object budget exceeded.");
      out.push(...current.node.objects);
      current.total = current.node.objects.length;
    } else if (current.index < current.refs.length) {
      const ref = current.refs[current.index++]!, key = `${ref.key}:${ref.revision}`;
      if (active.has(key)) throw new Error("Cyclic Harness response.");
      let node = cache.get(key);
      if (node === undefined) {
        if (++reads > maxNodeReads) throw new RangeError("Harness read budget exceeded.");
        node = await readNode(ref);
        cache.set(key, node);
      }
      active.add(key);
      stack.push(frame(node, key));
      continue;
    } else {
      const meta = decodeHarnessTreeMetadata(current.node.metadata);
      if (BigInt(current.total) !== meta.objects || current.depth !== meta.depth) throw new Error("Harness cached counts/depth do not match its children.");
    }
    stack.pop();
    if (current.key !== undefined) active.delete(current.key);
    const parent = stack.at(-1);
    if (parent !== undefined) { parent.total += current.total; parent.depth = Math.max(parent.depth, current.depth + 1); }
  }
  return out;
}

/** Decode the registry's packed key counter and governed admission bounds. */
export function decodeHarnessTreeControl(word: bigint): { nextKey: number; maxDepth: number; maxObjects: bigint } {
  if (word < 0n || word >> 104n !== 0n) throw new RangeError("Invalid Harness control word.");
  const result = { nextKey: Number(word & U32), maxDepth: Number((word >> 32n) & 255n), maxObjects: word >> 40n };
  if (result.maxDepth < 2 || result.maxObjects === 0n) throw new RangeError("Invalid Harness limits.");
  return result;
}

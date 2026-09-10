import { encodeAbiParameters, keccak256, stringToHex, type Hex } from "viem";
import { packHarnessChildren, type HarnessChild, type HarnessObject } from "@keel/protocol";
export { packHarnessChildren, unpackHarnessChildren, decodeHarnessTreeMetadata, decodeHarnessTreeControl, resolveHarnessTree } from "@keel/protocol";
export type { HarnessChild, HarnessObject, HarnessNode, HarnessWalkLimits } from "@keel/protocol";

/** General-purpose grouping for compositions that will receive revisions.
 * Override fanout for measured workloads; larger groups reduce node overhead. */
export const DEFAULT_HARNESS_FANOUT = 32;

export const HARNESS_TREE_DOMAIN = keccak256(stringToHex("keel.harness.tree.v1"));
export function harnessTreeDigest(children: readonly HarnessChild[]): Hex {
  const words = packHarnessChildren(children);
  return keccak256(encodeAbiParameters([{type:"bytes32"}, {type:"uint8"}, {type:"uint256[]"}], [HARNESS_TREE_DOMAIN, children.length, words]));
}
export interface PublishedHarnessNode extends HarnessChild { readonly fingerprint: Hex }
export interface HarnessBuildNode {
  readonly fingerprint: Hex;
  readonly kind: "leaf" | "branch";
  readonly objects: readonly HarnessObject[];
  readonly children: readonly HarnessBuildNode[];
  readonly depth: number;
  readonly objectCount: number;
  readonly reuse?: PublishedHarnessNode;
}
/** Bottom-up plan. Fingerprints identify ordered contents; only explicitly supplied
 * published receipts may mark a node reusable. No keys, signing or publication are invented. */
export function planHarnessTree(objects: readonly HarnessObject[], options: {
  fanout?: number; maxDepth?: number; maxObjects?: number; published?: readonly PublishedHarnessNode[];
} = {}): { root: HarnessBuildNode; writes: HarnessBuildNode[] } {
  const fanout = options.fanout ?? DEFAULT_HARNESS_FANOUT, maxDepth = options.maxDepth ?? 16, maxObjects = options.maxObjects ?? 1_000_000;
  if (!Number.isSafeInteger(fanout) || fanout < 2 || fanout > 128) throw new RangeError("Harness fanout must be 2–128.");
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || !Number.isSafeInteger(maxObjects) || maxObjects < 1 || objects.length < 1 || objects.length > maxObjects) throw new RangeError("Harness build bounds exceeded.");
  const published = new Map(options.published?.map(node => {
    packHarnessChildren([node]);
    return [node.fingerprint, node] as const;
  }));
  const nodes = new Map<Hex, HarnessBuildNode>();
  function add(node: Omit<HarnessBuildNode, "reuse">): HarnessBuildNode {
    const existing = nodes.get(node.fingerprint);
    if (existing) return existing;
    const reuse = published.get(node.fingerprint);
    const result = {...node, ...(reuse === undefined ? {} : {reuse})};
    nodes.set(node.fingerprint, result); return result;
  }
  let level: HarnessBuildNode[] = [];
  for (let i = 0; i < objects.length; i += fanout) {
    const part = objects.slice(i, i + fanout);
    for (const object of part) if (BigInt(object.objectId) === 0n || object.revision < 1n || object.revision >= 1n << 64n) throw new RangeError("Invalid Harness object.");
    const fingerprint = keccak256(encodeAbiParameters([{type:"bytes1"}, {type:"bytes32[]"}, {type:"uint64[]"}], ["0x00", part.map(o=>o.objectId), part.map(o=>o.revision)]));
    level.push(add({fingerprint, kind:"leaf", objects:part, children:[], depth:1, objectCount:part.length}));
  }
  while (level.length > 1) {
    const next: HarnessBuildNode[] = [];
    for (let i = 0; i < level.length; i += fanout) {
      const part = level.slice(i, i + fanout), depth = 1 + Math.max(...part.map(n=>n.depth));
      if (depth > maxDepth) throw new RangeError("Harness build depth exceeded.");
      const fingerprint = keccak256(encodeAbiParameters([{type:"bytes1"}, {type:"bytes32[]"}], ["0x01", part.map(n=>n.fingerprint)]));
      next.push(add({fingerprint, kind:"branch", objects:[], children:part, depth, objectCount:part.reduce((sum,n)=>sum+n.objectCount,0)}));
    }
    level = next;
  }
  const root = level[0]!, writes: HarnessBuildNode[] = [], scheduled = new Set<Hex>();
  const stack = [{node:root, visited:false}];
  while (stack.length) {
    const {node, visited} = stack.pop()!;
    if (node.reuse || scheduled.has(node.fingerprint)) continue;
    if (!visited) { stack.push({node,visited:true}); for (let i=node.children.length-1; i>=0; --i) stack.push({node:node.children[i]!,visited:false}); }
    else { scheduled.add(node.fingerprint); writes.push(node); }
  }
  return {root,writes};
}
/** Use registered child keys from confirmed publication results, then submit the
 * parent's packed words with forgeHarnessTree/appendHarnessTree. */
export function packHarnessBuildNode(node: HarnessBuildNode, published: ReadonlyMap<Hex, HarnessChild>): bigint[] {
  if (node.kind !== "branch") throw new TypeError("Only branch nodes have packed children.");
  return packHarnessChildren(node.children.map(child => {
    const ref = child.reuse ?? published.get(child.fingerprint);
    if (!ref) throw new Error(`Child ${child.fingerprint} has not been published and registered.`);
    return ref;
  }));
}

export const HARNESS_KEY_BATCH_SIZE = 128;
export const HARNESS_SLOT_SOURCE_MAX = (1n << 40n) - 1n;

/** Plan aliases for confirmed existing Harnesses. No key numbers are predicted. */
export function planHarnessKeyBatches(harnessIds: readonly Hex[]): {
  functionName: "registerHarnessKeys"; args: [Hex[]];
}[] {
  const ids = [...new Set(harnessIds.map(id => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(id) || BigInt(id) === 0n) throw new RangeError("Invalid Harness ID.");
    return id.toLowerCase() as Hex;
  }))];
  const batches: {functionName: "registerHarnessKeys"; args: [Hex[]]}[] = [];
  for (let i = 0; i < ids.length; i += HARNESS_KEY_BATCH_SIZE) {
    batches.push({functionName: "registerHarnessKeys", args: [ids.slice(i, i + HARNESS_KEY_BATCH_SIZE)]});
  }
  return batches;
}

/** Supply the parent's confirmed slots and revision record from the same chain/block.
 * A stale parent reverts onchain. Reuse keeps IDs fixed; changed IDs use full append. */
export function planHarnessLeafUpdate(input: {
  harnessId: Hex;
  expectedParent: bigint;
  slotSourceRevision: number | bigint;
  currentObjectIds: readonly Hex[];
  objects: readonly HarnessObject[];
  manifestDigest: Hex;
  seedSetDigest: Hex;
}): {
  functionName: "appendHarnessSelections";
  args: [Hex, bigint, bigint[], Hex, Hex];
} | {
  functionName: "appendHarnessRevision";
  args: [Hex, bigint, Hex[], bigint[], Hex, Hex];
} {
  const {harnessId, expectedParent, currentObjectIds, objects, manifestDigest, seedSetDigest} = input;
  // ABI decoders return uint40 as a number; accept exact bigint inputs too.
  if (typeof input.slotSourceRevision === "number" && !Number.isSafeInteger(input.slotSourceRevision)) throw new RangeError("Invalid Harness list source.");
  const slotSourceRevision = BigInt(input.slotSourceRevision);
  const validWord = (word: string) => /^0x[0-9a-fA-F]{64}$/.test(word);
  if (!validWord(harnessId) || BigInt(harnessId) === 0n || !validWord(manifestDigest) || BigInt(manifestDigest) === 0n || !validWord(seedSetDigest)) throw new RangeError("Invalid Harness commitment.");
  if (expectedParent < 1n || expectedParent >= (1n << 64n) - 1n || slotSourceRevision < 0n || slotSourceRevision > HARNESS_SLOT_SOURCE_MAX || slotSourceRevision > expectedParent) throw new RangeError("Invalid Harness parent or list source.");
  if (objects.length < 1 || objects.length > 128) throw new RangeError("Harness leaf must contain 1–128 objects.");
  const ids: Hex[] = [], revisions: bigint[] = [];
  for (const object of objects) {
    if (!validWord(object.objectId) || BigInt(object.objectId) === 0n || object.revision < 1n || object.revision >= 1n << 64n) throw new RangeError("Invalid Harness object.");
    ids.push(object.objectId); revisions.push(object.revision);
  }
  const source = slotSourceRevision === 0n ? expectedParent : slotSourceRevision;
  const unchangedIds = currentObjectIds.length === ids.length && currentObjectIds.every((id, i) => id.toLowerCase() === ids[i]!.toLowerCase());
  if (unchangedIds && source <= HARNESS_SLOT_SOURCE_MAX) {
    return {functionName:"appendHarnessSelections", args:[harnessId, expectedParent, revisions, manifestDigest, seedSetDigest]};
  }
  return {functionName:"appendHarnessRevision", args:[harnessId, expectedParent, ids, revisions, manifestDigest, seedSetDigest]};
}

/**
 * Harness trees on Tezos, with EVM's calls and payloads.
 *
 * EVM's KeelHarnessRegistry holds flat harnesses and trees in one contract.
 * Tezos splits it: KeelHarnessTreeRegistry holds keys, limits and branch
 * children, and writes each branch revision through KeelHarnessRegistry in the
 * same operation. Studio names the EVM call; this module builds the same
 * payload (children as `packHarnessChildren` words, the same policy codes) and
 * routes it to the piece that holds it. The tree digest is identical on both
 * chains. Nothing here signs, submits or reads a chain.
 *
 * EVM's `seedSetDigest` is named `entropySetDigest` here, because KEEL tool
 * inputs refuse key names containing "seed" as possible signer material.
 */

import type { HarnessChild } from "@keel/protocol";
import { harnessTreeDigest, packHarnessChildren } from "./harness-tree.js";
import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import { resolveKeelTezosCall } from "./tezos-split-registries.js";
import type { TezosMichelineValue, TezosTransactionOperation } from "./tezos-publication.js";

export const KEEL_TEZOS_HARNESS_TREE_ACTION = "keel.tezos.harness-tree-action@1" as const;
const MAX_CHILDREN = 128;
const UINT32_MAX = (1n << 32n) - 1n;
const HEX = /^(?:0x)?[0-9a-fA-F]*$/u;
const SECRET_KEY = /(?:private|secret|mnemonic|seed|passphrase)/iu;

function assertNoSecrets(value: unknown, path: string): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new TypeError(`Private signer material is never accepted: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

export type KeelTezosHarnessTreeAction =
  | { readonly kind: "bind" }
  | { readonly kind: "register-keys"; readonly harnessIds: readonly string[] }
  | { readonly kind: "set-limits"; readonly maxDepth: number | string | bigint; readonly maxObjects: number | string | bigint }
  | { readonly kind: "forge"; readonly salt: string; readonly collection: string; readonly editPolicy: number; readonly forkPolicy: number;
      readonly children: readonly HarnessChild[]; readonly manifestDigest: string; readonly entropySetDigest: string;
      /** Set for the publication job's forge_harness_tree_for; omit when the creator forges. */
      readonly creator?: string }
  | { readonly kind: "append"; readonly harnessId: string; readonly expectedParent: number | string | bigint; readonly children: readonly HarnessChild[];
      readonly manifestDigest: string; readonly entropySetDigest: string }
  | { readonly kind: "fork"; readonly harnessId: string; readonly tokenId: number | string | bigint; readonly baseRevision: number | string | bigint;
      readonly expectedForkParent: number | string | bigint; readonly children: readonly HarnessChild[]; readonly manifestDigest: string }
  | { readonly kind: "append-selections"; readonly harnessId: string; readonly expectedParent: number | string | bigint;
      readonly revisions: readonly (number | string | bigint)[]; readonly manifestDigest: string; readonly entropySetDigest: string };

export interface KeelTezosHarnessTreeActionInput {
  readonly network: string;
  readonly sender: string;
  /** KeelHarnessRegistry, the piece EVM's flat calls live on. */
  readonly harnessRegistry: string;
  /** KeelHarnessTreeRegistry, bound to it once by the registry's manager. */
  readonly treeRegistry: string;
  readonly action: KeelTezosHarnessTreeAction;
}

const mInt = (value: bigint): TezosMichelineValue => ({ int: value.toString() });
const mBytes = (hex: string): TezosMichelineValue => ({ bytes: hex });
const mString = (value: string): TezosMichelineValue => ({ string: value });
function mPair(values: readonly TezosMichelineValue[]): TezosMichelineValue {
  let result = values[values.length - 1] as TezosMichelineValue;
  for (let index = values.length - 2; index >= 0; index -= 1) result = { prim: "Pair", args: [values[index] as TezosMichelineValue, result] };
  return result;
}

function natural(value: unknown, label: string, { positive = false, max }: { readonly positive?: boolean; readonly max?: bigint } = {}): bigint {
  let result: bigint;
  if (typeof value === "bigint") result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) result = BigInt(value);
  else throw new TypeError(`${label} must be a nonnegative integer.`);
  if (result < 0n || (positive && result === 0n)) throw new TypeError(`${label} must be ${positive ? "positive" : "nonnegative"}.`);
  if (max !== undefined && result > max) throw new TypeError(`${label} exceeds ${max.toString()}.`);
  return result;
}

function bytes(value: unknown, label: string, { exact, max }: { readonly exact?: number; readonly max?: number } = {}): string {
  if (typeof value !== "string" || !HEX.test(value)) throw new TypeError(`${label} must be hex.`);
  const clean = value.replace(/^0x/u, "").toLowerCase();
  const length = clean.length / 2;
  if (clean.length % 2 !== 0 || (exact !== undefined && length !== exact) || (max !== undefined && (length === 0 || length > max))) {
    throw new TypeError(`${label} must be ${exact !== undefined ? `${exact}-byte` : `1..${max ?? "any"}-byte`} hex.`);
  }
  return clean;
}

function address(value: unknown, label: string, contract = false): string {
  if (typeof value !== "string" || (contract && !value.startsWith("KT1"))) throw new TypeError(`${label} must be ${contract ? "an originated KT1 contract" : "a Tezos address"}.`);
  keelTezosAddressBytes(value, label);
  return value;
}

/** EVM's _validateChildren checks that a payload can see: 1..128 children, nonzero uint32 keys and revisions. */
function children(value: unknown): { readonly count: bigint; readonly words: TezosMichelineValue[]; readonly digest: string } {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CHILDREN) throw new TypeError(`children must hold 1..${MAX_CHILDREN} entries.`);
  const checked = value.map((child: unknown, index): HarnessChild => {
    if (child === null || typeof child !== "object") throw new TypeError(`children[${index}] must be { key, revision }.`);
    const { key, revision } = child as Record<string, unknown>;
    return { key: Number(natural(key, `children[${index}].key`, { positive: true, max: UINT32_MAX })),
      revision: Number(natural(revision, `children[${index}].revision`, { positive: true, max: UINT32_MAX })) };
  });
  return { count: BigInt(checked.length), words: packHarnessChildren(checked).map(mInt), digest: harnessTreeDigest(checked) };
}

/**
 * Build one harness tree call for Tezos, routed to the piece that holds it.
 * `register-keys` returns no keys on Tezos: read `harness_key_of` afterwards.
 */
export function prepareKeelTezosHarnessTreeAction(input: KeelTezosHarnessTreeActionInput) {
  if (input === null || typeof input !== "object") throw new TypeError("harness tree action must be an object.");
  assertNoSecrets(input, "input");
  if (typeof input.network !== "string") throw new TypeError("network must be an exact Tezos Net... chain identity.");
  keelTezosChainIdBytes(input.network);
  const sender = address(input.sender, "sender");
  const pieces: Record<string, string> = {
    KeelHarnessRegistry: address(input.harnessRegistry, "harnessRegistry", true),
    KeelHarnessTreeRegistry: address(input.treeRegistry, "treeRegistry", true),
  };
  if (pieces.KeelHarnessRegistry === pieces.KeelHarnessTreeRegistry) throw new TypeError("harnessRegistry and treeRegistry must differ.");
  const action = input.action;
  let entrypoint: string;
  let value: TezosMichelineValue;
  let consequence: string;
  let readback: string[];
  let tree: { readonly count: bigint; readonly digest: string } | undefined;
  switch (action?.kind) {
    case "bind":
      entrypoint = "bind_tree_registry";
      value = mString(pieces.KeelHarnessTreeRegistry as string);
      consequence = "The registry's manager binds the tree registry once. It must name this registry and index; tree calls fail closed until then.";
      readback = ["tree_registry"];
      break;
    case "register-keys": {
      const ids = action.harnessIds;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_CHILDREN) throw new TypeError(`harnessIds must hold 1..${MAX_CHILDREN} IDs.`);
      entrypoint = "register_harness_keys";
      value = ids.map((id, index) => mBytes(bytes(id, `harnessIds[${index}]`, { exact: 32 })));
      consequence = "Give each existing harness a compact uint32 key, once; a repeat keeps its key. The keys are read back, not returned.";
      readback = ["harness_key_of", "tree_control"];
      break;
    }
    case "set-limits": {
      const depth = natural(action.maxDepth, "maxDepth", { max: 255n });
      if (depth < 2n) throw new TypeError("maxDepth must be at least 2.");
      entrypoint = "set_tree_limits";
      value = mPair([mInt(depth), mInt(natural(action.maxObjects, "maxObjects", { positive: true, max: (1n << 216n) - 1n }))]);
      consequence = "Governance sets the tree depth and expanded-object limits checked on every later tree write.";
      readback = ["tree_control"];
      break;
    }
    case "forge": {
      const packed = children(action.children);
      tree = packed;
      const policies = [natural(action.editPolicy, "editPolicy", { max: 255n }), natural(action.forkPolicy, "forkPolicy", { max: 255n })];
      const request = [mBytes(bytes(action.salt, "salt", { max: 32 })), mString(address(action.collection, "collection", true)), ...policies.map(mInt),
        mInt(packed.count), packed.words, mBytes(bytes(action.manifestDigest, "manifestDigest", { exact: 32 })),
        mBytes(bytes(action.entropySetDigest, "entropySetDigest", { exact: 32 }))];
      if (action.creator === undefined) {
        entrypoint = "forge_harness_tree";
        value = mPair(request);
        consequence = "The collection controller forges a branch harness whose revision 1 pins these child revisions.";
      } else {
        entrypoint = "forge_harness_tree_for";
        value = mPair([mString(address(action.creator, "creator")), ...request]);
        consequence = "The registry's publication job forges the branch harness for this creator.";
      }
      readback = ["predict_harness_id", "harness_tree", "harness_revision_commitment"];
      break;
    }
    case "append": {
      const packed = children(action.children);
      tree = packed;
      entrypoint = "append_harness_tree";
      value = mPair([mBytes(bytes(action.harnessId, "harnessId", { exact: 32 })), mInt(natural(action.expectedParent, "expectedParent", { positive: true })),
        mInt(packed.count), packed.words, mBytes(bytes(action.manifestDigest, "manifestDigest", { exact: 32 })),
        mBytes(bytes(action.entropySetDigest, "entropySetDigest", { exact: 32 }))]);
      consequence = "Append a branch revision at the exact unfrozen head.";
      readback = ["harness_tree", "harness_revision_commitment", "latest_harness_revision"];
      break;
    }
    case "fork": {
      const packed = children(action.children);
      tree = packed;
      entrypoint = "fork_harness_tree_for_token";
      value = mPair([mBytes(bytes(action.harnessId, "harnessId", { exact: 32 })), mInt(natural(action.tokenId, "tokenId")),
        mInt(natural(action.baseRevision, "baseRevision", { positive: true })), mInt(natural(action.expectedForkParent, "expectedForkParent")),
        packed.words, mBytes(bytes(action.manifestDigest, "manifestDigest", { exact: 32 }))]);
      consequence = "The token owner selects new revisions of the base's child keys; the keys stay in place.";
      readback = ["token_fork_tree", "effective_harness"];
      break;
    }
    case "append-selections": {
      const revisions = action.revisions;
      if (!Array.isArray(revisions) || revisions.length === 0 || revisions.length > MAX_CHILDREN) throw new TypeError(`revisions must hold 1..${MAX_CHILDREN} entries.`);
      entrypoint = "append_harness_selections";
      value = mPair([mBytes(bytes(action.harnessId, "harnessId", { exact: 32 })), mInt(natural(action.expectedParent, "expectedParent", { positive: true })),
        revisions.map((revision, index) => mInt(natural(revision, `revisions[${index}]`, { positive: true }))),
        mBytes(bytes(action.manifestDigest, "manifestDigest", { exact: 32 })), mBytes(bytes(action.entropySetDigest, "entropySetDigest", { exact: 32 }))]);
      consequence = "Reuse the parent leaf's ordered artifact IDs with new revisions; the digest equals a full append of the same slots.";
      readback = ["harness_slots", "harness_revision_commitment"];
      break;
    }
    default: throw new TypeError("Unknown harness tree action.");
  }
  const target = resolveKeelTezosCall("KeelHarnessRegistry", entrypoint);
  if (target.kind !== "entrypoint") throw new Error(`${entrypoint} is not an entrypoint.`);
  const operation: TezosTransactionOperation = { kind: "transaction", amount: "0", destination: pieces[target.contract] as string, parameters: { entrypoint, value } };
  return {
    schema: KEEL_TEZOS_HARNESS_TREE_ACTION, status: "review-only" as const, family: "tezos" as const, network: input.network, expectedSender: sender,
    action: action.kind, contract: target.contract, operation, consequence,
    readback: readback.map((name) => ({ ...resolveKeelTezosCall("KeelHarnessRegistry", name), destination: pieces[resolveKeelTezosCall("KeelHarnessRegistry", name).contract] })),
    ...(tree === undefined ? {} : { childCount: Number(tree.count), treeDigest: tree.digest }),
    signing: "not-performed" as const, submission: "not-performed" as const,
  };
}

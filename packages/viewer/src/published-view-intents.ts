import { canonicalJson, utf8ToBytes, verifyIntegrity, walletIntentToken, type EffectiveCapabilities, type Hex } from "@keel/protocol";
import { resolveKeelContractPlugin, type ResolveKeelPluginOptions } from "./plugin-adapter.js";
import type { ResolvedArtifact } from "./types.js";

/** Explicit opt-in carried inside the verified, published outer manifest. */
export interface PublishedViewIntentPolicy {
  readonly enabled: true;
  readonly intents: readonly { readonly plugin: string; readonly id: string }[];
}

export interface InstalledViewOperation {
  readonly selector: Hex;
  /** Installed host code validates symbolic input and constructs calldata. */
  readonly encode: (proposal: unknown) => Hex;
}

export interface PublishedViewReadRequest {
  readonly chainId: number;
  readonly address: Hex;
  readonly data: Hex;
  readonly blockNumber: bigint;
  readonly blockHash: Hex;
  readonly signal: AbortSignal;
}

/**
 * A view intent cannot grant itself networking. This gate is called by the
 * trusted host; it does not install a transport or relax the child CSP.
 * The same recursive plugin verifier checks publication, permissions, code,
 * graph bindings and installed adapter bytes before a read adapter is returned.
 */
export async function createPublishedViewReader(input: {
  readonly outer: ResolvedArtifact;
  readonly plugin: string;
  readonly intentId: string;
  readonly capabilities: EffectiveCapabilities;
  readonly operation: InstalledViewOperation;
  readonly verification: ResolveKeelPluginOptions;
  readonly read: (request: PublishedViewReadRequest) => Promise<unknown>;
}) {
  if (input.outer.commitment?.digestVerified !== true) throw new Error("Read intents require a verified published manifest");
  const outer = { ...input.outer, manifest: structuredClone(input.outer.manifest) };
  const commitment = structuredClone(input.outer.commitment.integrity);
  if (commitment.algorithm === "none" || !await verifyIntegrity(
    utf8ToBytes(canonicalJson(outer.manifest)), commitment, input.verification.customDigest,
  )) throw new Error("Published manifest changed after verification");
  const raw = outer.manifest.extensions?.["keel-read-intents@1"];
  if (typeof raw !== "object" || raw === null) throw new Error("Manifest has not enabled read intents");
  const policy = raw as Partial<PublishedViewIntentPolicy>;
  if (policy.enabled !== true || !Array.isArray(policy.intents) || policy.intents.length > 32
    || !policy.intents.some(intent => intent?.plugin === input.plugin && intent?.id === input.intentId)) {
    throw new Error("Manifest has not enabled this read intent");
  }
  if (!input.capabilities.isAllowed("network.manifested")
    || !input.capabilities.isAllowed(walletIntentToken(input.intentId))) {
    throw new Error("Host capability policy denies this manifested read");
  }
  const verified = await resolveKeelContractPlugin(outer, input.plugin, input.verification);
  const intent = verified.intents.get(input.intentId);
  if (!intent || intent.stateMutability !== "view" || intent.valuePolicy !== "zero"
    || intent.target !== "plugin-contract" || intent.selector.toLowerCase() !== input.operation.selector.toLowerCase()) {
    throw new Error("Published intent does not authorize the installed view operation");
  }
  // Capture immutable primitives, never a mutable intent table supplied to UI.
  const chainId = verified.descriptor.contract.chainId;
  const address = verified.descriptor.contract.address;
  const selector = intent.selector.toLowerCase();
  const blockNumber = verified.blockNumber;
  const blockHash = verified.blockHash;
  const encode = input.operation.encode;
  const read = input.read;
  const signal = input.verification.signal ?? new AbortController().signal;
  return Object.freeze({
    disclosure: Object.freeze({
      manifestDigest: verified.graph.manifestDigest,
      permissionsDigest: verified.descriptor.permissions.digest,
      intentId: input.intentId, chainId, address, blockNumber, blockHash,
      graphFrozen: verified.graph.frozen,
      proof: "Published view intent; RPC result is separate from immutable asset verification",
    }),
    async read(proposal: unknown) {
      if (signal.aborted) throw new Error("Read session ended");
      const data = encode(proposal);
      if (!/^0x(?:[0-9a-f]{2}){4,516}$/iu.test(data) || data.slice(0, 10).toLowerCase() !== selector) {
        throw new Error("Installed adapter produced calldata outside its published intent");
      }
      return read({ chainId, address, data, blockNumber, blockHash, signal });
    },
  });
}

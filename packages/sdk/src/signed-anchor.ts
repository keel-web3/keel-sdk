import {
  encodeAbiParameters, encodeFunctionData, hashTypedData, isAddress, keccak256,
  parseAbi, parseAbiParameters, sha256, size, stringToHex,
  type Address, type Hex, type PublicClient,
} from "viem";
import { ABIS } from "./abis/keel-anchors.generated.js";

export const signedAnchorAdapterAbi = parseAbi([
  "struct Attestation { uint64 nonce; uint64 deadline; bytes32 anchorId; bytes32 requestDigest; bytes32 evidenceDigest; }",
  "function anchorRegistry() view returns (address)",
  "function signer() view returns (address)",
  "function policyDigest() view returns (bytes32)",
  "function validUntil() view returns (uint64)",
  "function retired() view returns (bool)",
  "function requestDigest(bytes32 anchorId) view returns (bytes32)",
  "function attestationDigest(Attestation attestation) view returns (bytes32)",
  "function submitAttestation(Attestation attestation,bytes signature)",
]);

export type SignedAnchorAttestation = {
  nonce: bigint; deadline: bigint; anchorId: Hex; requestDigest: Hex; evidenceDigest: Hex;
};
export type SignedAnchorContext = {
  objectId: Hex; artifactRevision: bigint;
  source: { family: number; network: number; registry: Hex; objectKey: Hex; revision: bigint; eventDigest: Hex };
  contentRoot: Hex; verifierId: Hex; verifierAdapter: Address; contributor: Address;
  taskCount: number; contentByteLength: bigint;
};
export type SignedAnchorTask = { digestKind: number; expectedDigest: Hex; locator: string };

const zero32 = `0x${"00".repeat(32)}`;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
function bytes32(value: Hex, name: string) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || same(value, zero32)) throw new Error(`Invalid ${name}`);
}
function uint64(value: bigint, name: string) {
  if (value < 0n || value >= 1n << 64n) throw new Error(`Invalid ${name}`);
}

/** Exact registry/request binding used by KeelSignedAnchorVerifier. Progress and timestamps are deliberately excluded. */
export function signedAnchorRequestDigest(registry: Address, policy: Hex, anchor: SignedAnchorContext, task: SignedAnchorTask): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters(
    "address,bytes32,bytes32,uint64,(uint8,uint32,bytes32,bytes32,uint64,bytes32),bytes32,bytes32,address,address,uint32,uint64,uint8,bytes32,bytes32",
  ), [registry, policy, anchor.objectId, anchor.artifactRevision,
    [anchor.source.family, anchor.source.network, anchor.source.registry, anchor.source.objectKey, anchor.source.revision, anchor.source.eventDigest],
    anchor.contentRoot, anchor.verifierId, anchor.verifierAdapter, anchor.contributor,
    anchor.taskCount, anchor.contentByteLength, task.digestKind, task.expectedDigest, keccak256(stringToHex(task.locator))]));
}

/** Build an offline signing request. This function neither observes a source chain nor signs or broadcasts. */
export function buildSignedAnchorTypedData(options: { chainId: number; adapter: Address; attestation: SignedAnchorAttestation }) {
  const {chainId, adapter, attestation} = options;
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid destination chain");
  if (!isAddress(adapter) || /^0x0{40}$/i.test(adapter)) throw new Error("Invalid adapter");
  uint64(attestation.nonce, "nonce"); uint64(attestation.deadline, "deadline");
  if (attestation.nonce === 0n) throw new Error("Invalid nonce");
  bytes32(attestation.anchorId, "anchor ID"); bytes32(attestation.requestDigest, "request digest");
  bytes32(attestation.evidenceDigest, "evidence digest");
  return {
    domain: {name: "KEEL Signed Anchor", version: "1", chainId, verifyingContract: adapter},
    primaryType: "Attestation" as const,
    types: {Attestation: [
      {name: "anchorId", type: "bytes32"}, {name: "nonce", type: "uint64"},
      {name: "requestDigest", type: "bytes32"}, {name: "evidenceDigest", type: "bytes32"},
      {name: "deadline", type: "uint64"},
    ]} as const,
    message: attestation,
  };
}

/**
 * Prepare an approval from one destination block and observed decoded source bytes.
 * The injected observer owns source identity/finality validation under the pinned policy.
 * Its evidence bytes should be retained publicly; their hash is recorded by the adapter.
 */
export async function prepareSignedAnchorAttestation(options: {
  publicClient: PublicClient; expectedChainId: number; adapter: Address; expectedSigner: Address;
  expectedPolicyDigest: Hex; anchorId: Hex; deadline: bigint;
  observeSource: (request: {
    anchor: SignedAnchorContext; task: SignedAnchorTask; policyDigest: Hex; blockNumber: bigint;
  }) => Promise<{ decodedBytes: Hex; evidence: Hex }>;
}) {
  const {publicClient: reader, adapter, anchorId} = options;
  if (await reader.getChainId() !== options.expectedChainId) throw new Error("Wrong destination chain");
  const block = await reader.getBlock();
  if (block.number === null) throw new Error("A mined destination block is required");
  const common = {address: adapter, abi: signedAnchorAdapterAbi, blockNumber: block.number} as const;
  const [registry, signer, policy, until, retired, requestDigest] = await Promise.all([
    reader.readContract({...common, functionName: "anchorRegistry"}),
    reader.readContract({...common, functionName: "signer"}),
    reader.readContract({...common, functionName: "policyDigest"}),
    reader.readContract({...common, functionName: "validUntil"}),
    reader.readContract({...common, functionName: "retired"}),
    reader.readContract({...common, functionName: "requestDigest", args: [anchorId]}),
  ]);
  if (!same(signer, options.expectedSigner) || !same(policy, options.expectedPolicyDigest)) throw new Error("Signer policy mismatch");
  if (retired || options.deadline < block.timestamp || options.deadline > until) throw new Error("Inactive signing window");
  const registryCommon = {address: registry, abi: ABIS.KeelAttestedAnchorRegistry, blockNumber: block.number} as const;
  const [anchor, task] = await Promise.all([
    reader.readContract({...registryCommon, functionName: "anchorState", args: [anchorId]}),
    reader.readContract({...registryCommon, functionName: "anchorTask", args: [anchorId, 0]}),
  ]);
  if (anchor.status !== 1 || task.status !== 1 || !same(anchor.verifierAdapter, adapter)
      || anchor.taskCount !== 1 || task.digestKind !== 0 || anchor.contentByteLength === 0n
      || !same(task.expectedDigest, anchor.contentRoot)) throw new Error("Unsupported or inactive anchor request");
  const [verifier, family] = await Promise.all([
    reader.readContract({...registryCommon, functionName: "anchorVerifier", args: [anchor.verifierId]}),
    reader.readContract({...registryCommon, functionName: "chainFamily", args: [anchor.source.family]}),
  ]);
  if (verifier.retired || family.retired || verifier.trustClass !== 3 || !same(verifier.specDigest, policy)) throw new Error("Inactive attestation policy");
  if (!same(signedAnchorRequestDigest(registry, policy, anchor, task), requestDigest)) throw new Error("Request binding mismatch");

  const observed = await options.observeSource({anchor, task, policyDigest: policy, blockNumber: block.number});
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(observed.decodedBytes)
      || !/^0x(?:[0-9a-fA-F]{2})+$/.test(observed.evidence)) throw new Error("Source bytes and evidence must be nonempty bytes");
  if (BigInt(size(observed.decodedBytes)) !== anchor.contentByteLength || !same(sha256(observed.decodedBytes), task.expectedDigest)) {
    throw new Error("Observed source content does not match the requested revision");
  }
  const attestation: SignedAnchorAttestation = {
    nonce: anchor.nonce, deadline: options.deadline, anchorId, requestDigest, evidenceDigest: keccak256(observed.evidence),
  };
  const typedData = buildSignedAnchorTypedData({chainId: options.expectedChainId, adapter, attestation});
  const digest = hashTypedData(typedData);
  const contractDigest = await reader.readContract({...common, functionName: "attestationDigest", args: [attestation]});
  if (!same(digest, contractDigest)) throw new Error("Signing schema mismatch");
  return {typedData, attestation, digest, evidence: observed.evidence, blockNumber: block.number, registry, signer, policyDigest: policy};
}

/** Calldata for a relayer. The contract rechecks current policy, expiry and request generation when executed. */
export function encodeSignedAnchorSubmission(attestation: SignedAnchorAttestation, signature: Hex): Hex {
  return encodeFunctionData({abi: signedAnchorAdapterAbi, functionName: "submitAttestation", args: [attestation, signature]});
}

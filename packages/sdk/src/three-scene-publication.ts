import {
  KEEL_CANONICALIZATION,
  KEEL_CONTENT_GATEWAY_PROTOCOL,
  KEEL_MANIFEST_SCHEMA,
  KEEL_RUNTIME_PROTOCOL,
  KEEL_VIEWER_PROTOCOL,
  assertValidManifest,
  canonicalJson,
  createIntegrity,
  manifestIntegrity,
  utf8ToBytes,
  type ArtifactManifest,
  type Hex as ProtocolHex,
  type Integrity,
} from "@keel/protocol";
import {
  bytesToHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { keelHoldAbi } from "./abi.js";
import {
  buildKeelPublicationPlan,
  KEEL_NATIVE_CARRIER_V1,
  KEEL_NATIVE_CHUNK_BYTES,
  KEEL_NATIVE_CHUNKS_PER_TRANSACTION,
  mergeKeelPublicationRecovery,
  selectResumableKeelJobId,
  type KeelPublicationPlan,
  type KeelPublicationRecovery,
} from "./managed-publication.js";

/** Review-only protocol for one frozen Three.js scene and its native object. */
export const KEEL_THREE_SCENE_PUBLICATION_PROTOCOL = "keel-three-scene-publication@1" as const;
export const KEEL_THREE_SCENE_VIEWER_EXTENSION = "keel-immutable-scene@1" as const;
export const KEEL_THREE_SCENE_DEFAULT_MEDIA_TYPE = "text/html" as const;
export const KEEL_THREE_SCENE_DEFAULT_CREATED_AT = "2026-01-01T00:00:00.000Z" as const;

const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const BYTES32 = /^0x[0-9a-f]{64}$/iu;
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

const WELD_OBJECT_SIGNATURE = "function weldObject(bytes32[] slugIds, bytes32 digest, uint64 byteLength, uint8 compression, string mediaType) returns (bytes32 objectId)" as const;
const weldObjectSignatures = keelHoldAbi.filter((entry) => entry.startsWith("function weldObject("));
if (weldObjectSignatures.length !== 1 || weldObjectSignatures[0] !== WELD_OBJECT_SIGNATURE) {
  throw new Error("The compiler-derived KeelHold ABI does not expose the exact canonical weldObject function.");
}
const WELD_OBJECT_ABI = parseAbi([WELD_OBJECT_SIGNATURE]);

export interface KeelImmutableThreeSceneInput {
  readonly chainId: number;
  readonly owner: Address;
  readonly executor: Address;
  /** Native KeelHold store receiving the immutable scene carriers/object. */
  readonly hold: Address;
  readonly deadline: bigint;
  readonly scene: {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    readonly bytes: Uint8Array;
    readonly mediaType?: string;
    readonly createdAt?: string;
    readonly tokenId?: string;
    readonly seed?: Hex;
    readonly backgroundColor?: string;
  };
}

export interface KeelThreeSceneViewerProof {
  readonly manifest: ArtifactManifest;
  readonly integrity: Integrity;
  readonly defaults: {
    readonly manifestTrust: "digest";
    readonly sandbox: "strict";
    readonly capabilities: Readonly<Record<string, never>>;
    readonly verification: "required";
  };
}

export interface KeelImmutableThreeScenePublicationPlan {
  readonly protocol: typeof KEEL_THREE_SCENE_PUBLICATION_PROTOCOL;
  readonly status: "review-only";
  readonly sceneId: string;
  readonly sceneDigest: Hex;
  readonly sceneObjectId: Hex;
  readonly sceneByteLength: number;
  readonly edition: { readonly size: 1; readonly serial: 1 };
  readonly immutable: true;
  readonly storageMode: typeof KEEL_NATIVE_CARRIER_V1;
  readonly viewer: KeelThreeSceneViewerProof;
  readonly publication: KeelPublicationPlan;
  readonly walletApproval: "required";
  readonly signing: "not-performed";
  readonly submitted: false;
}

export interface KeelImmutableThreeSceneRecovery {
  readonly protocol: typeof KEEL_THREE_SCENE_PUBLICATION_PROTOCOL;
  readonly storageMode: typeof KEEL_NATIVE_CARRIER_V1;
  readonly planDigest: Hex;
  readonly jobId?: bigint;
  readonly recovery: KeelPublicationRecovery;
  /** Receipt reconciliation/resume never requests another owner signature. */
  readonly walletApproval: "not-requested";
}

function ensureAddress(value: Address, label: string): Address {
  if (!ADDRESS.test(value)) throw new TypeError(`${label} must be an Ethereum address.`);
  return value.toLowerCase() as Address;
}

function ensureBytes32(value: string, label: string): Hex {
  if (!BYTES32.test(value)) throw new TypeError(`${label} must be a bytes32 value.`);
  return value.toLowerCase() as Hex;
}

function ensurePositiveSafe(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer.`);
  return value;
}

function splitNativeScene(bytes: Uint8Array): readonly (readonly Hex[])[] {
  const chunks: Hex[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += KEEL_NATIVE_CHUNK_BYTES) {
    chunks.push(bytesToHex(bytes.subarray(offset, Math.min(offset + KEEL_NATIVE_CHUNK_BYTES, bytes.byteLength))));
  }
  const batches: Hex[][] = [];
  for (let index = 0; index < chunks.length; index += KEEL_NATIVE_CHUNKS_PER_TRANSACTION) {
    batches.push(chunks.slice(index, index + KEEL_NATIVE_CHUNKS_PER_TRANSACTION));
  }
  return Object.freeze(batches.map((batch) => Object.freeze(batch)));
}

function nativeObjectId(
  slugIds: readonly Hex[],
  digest: Hex,
  byteLength: number,
  mediaType: string,
): Hex {
  const indexBytes = new Uint8Array(slugIds.length * 32);
  slugIds.forEach((slugId, index) => {
    const bytes = Uint8Array.from(slugId.slice(2).match(/../gu) ?? [], (value) => Number.parseInt(value, 16));
    indexBytes.set(bytes, index * 32);
  });
  const indexDigest = keccak256(bytesToHex(indexBytes));
  const preimage = encodeAbiParameters(
    [
      { type: "bytes1" },
      { type: "bytes32" },
      { type: "bytes32" },
      { type: "uint64" },
      { type: "uint64" },
      { type: "uint8" },
      { type: "bytes32" },
    ],
    ["0x00", indexDigest, digest, BigInt(byteLength), BigInt(byteLength), 0, keccak256(stringToHex(mediaType))],
  );
  return keccak256(preimage);
}

function sceneManifest(input: {
  readonly chainId: number;
  readonly hold: Address;
  readonly scene: KeelImmutableThreeSceneInput["scene"];
  readonly sceneDigest: Hex;
  readonly sceneObjectId: Hex;
}): ArtifactManifest {
  const mediaType = input.scene.mediaType ?? KEEL_THREE_SCENE_DEFAULT_MEDIA_TYPE;
  const sceneResource = {
    id: "scene",
    role: "entrypoint" as const,
    mediaType,
    executable: true,
    originalName: "scene.html",
    aliases: ["/content/scene"],
    sources: [{
      kind: "onchain" as const,
      chainId: input.chainId,
      store: input.hold,
      objectId: input.sceneObjectId,
      compression: "none" as const,
      integrity: { algorithm: "sha256" as const, digest: input.sceneDigest, byteLength: input.scene.bytes.byteLength },
    }],
  };
  const maxResourceBytes = Math.max(input.scene.bytes.byteLength + 4_096, 64 * 1024);
  const maxTotalBytes = Math.max(input.scene.bytes.byteLength + 16 * 1024, 256 * 1024);
  const manifest: ArtifactManifest = {
    schema: KEEL_MANIFEST_SCHEMA,
    canonicalization: KEEL_CANONICALIZATION,
    id: input.scene.id,
    name: input.scene.name,
    ...(input.scene.description === undefined ? {} : { description: input.scene.description }),
    entrypoint: { resource: "scene", mode: "html" },
    resources: [sceneResource],
    fallback: { image: "scene", animation: "scene", backgroundColor: input.scene.backgroundColor ?? "#05060b" },
    runtime: {
      engine: { protocol: KEEL_RUNTIME_PROTOCOL, viewerProtocol: KEEL_VIEWER_PROTOCOL, renderer: "browser" },
      determinism: { mode: "live" },
      content: {
        protocol: KEEL_CONTENT_GATEWAY_PROTOCOL,
        mode: "verified-only",
        externalSources: "host-verified",
        manifestTrust: "digest",
        blockUndeclared: true,
        resourcePathPrefix: "/content/",
        onchainPathPrefix: "/onchain/",
        ipfsPathPrefix: "/ipfs/",
      },
      sandbox: "strict",
      capabilities: {},
      maxResourceBytes,
      maxTotalBytes,
      maxRecursionDepth: 8,
      maxResources: 8,
      timeoutMs: 30_000,
    },
    revision: { number: 1, compatibility: { min: 1, max: 1 }, policy: "immutable", frozen: true },
    provenance: {
      createdAt: input.scene.createdAt ?? KEEL_THREE_SCENE_DEFAULT_CREATED_AT,
      chainId: input.chainId,
      ...(input.scene.tokenId === undefined ? {} : { tokenId: input.scene.tokenId }),
    },
    extensions: {
      "keel:immutable-scene": {
        protocol: KEEL_THREE_SCENE_VIEWER_EXTENSION,
        runtime: "three.js",
        editionSize: 1,
        editionSerial: 1,
        storageMode: KEEL_NATIVE_CARRIER_V1,
        objectId: input.sceneObjectId,
        sceneDigest: input.sceneDigest,
        verification: {
          manifestTrust: "digest",
          sandbox: "strict",
          content: "verified-only",
          source: "native-keel",
        },
        ...(input.scene.seed === undefined ? {} : { seed: ensureBytes32(input.scene.seed, "scene.seed") }),
      },
    },
  };
  assertValidManifest(manifest);
  return manifest;
}

/**
 * Build one unsigned, native-only publication for a single immutable Three.js
 * scene. The planner owns the Hold weld operation so callers cannot quietly
 * turn the one-of-one into a multi-operation or history-storage publication.
 */
export async function buildKeelImmutableThreeScenePublicationPlan(
  source: KeelImmutableThreeSceneInput,
): Promise<KeelImmutableThreeScenePublicationPlan> {
  const input = Object.freeze({
    ...source,
    scene: Object.freeze({
      ...source.scene,
      bytes: Uint8Array.from(source.scene.bytes),
    }),
  });
  const chainId = ensurePositiveSafe(input.chainId, "chainId");
  const owner = ensureAddress(input.owner, "owner");
  const executor = ensureAddress(input.executor, "executor");
  const hold = ensureAddress(input.hold, "hold");
  const legacyOverrides = input as KeelImmutableThreeSceneInput & {
    readonly operationTarget?: unknown;
    readonly operationValue?: unknown;
  };
  if (legacyOverrides.operationTarget !== undefined || legacyOverrides.operationValue !== undefined) {
    throw new TypeError("The immutable Three.js scene always welds to its reviewed Hold with zero value.");
  }
  if (!SAFE_ID.test(input.scene.id)) throw new TypeError("scene.id must be a bounded metadata-safe identifier.");
  if (input.scene.name.trim().length === 0) throw new TypeError("scene.name is required.");
  if (input.scene.bytes.byteLength === 0) throw new RangeError("An immutable scene cannot be empty.");
  const mediaType = input.scene.mediaType ?? KEEL_THREE_SCENE_DEFAULT_MEDIA_TYPE;
  if (mediaType.trim().length === 0 || mediaType.length > 127 || /[\u0000-\u001f\u007f]/u.test(mediaType)) throw new TypeError("scene.mediaType is invalid.");
  const sceneDigest = (await createIntegrity(input.scene.bytes)).digest as Hex;
  const batches = splitNativeScene(input.scene.bytes);
  const slugIds = batches.flat().map((payload) => keccak256(payload));
  const sceneObjectId = nativeObjectId(slugIds, sceneDigest, input.scene.bytes.byteLength, mediaType);
  const operationData = encodeFunctionData({
    abi: WELD_OBJECT_ABI,
    functionName: "weldObject",
    args: [slugIds, sceneDigest, BigInt(input.scene.bytes.byteLength), 0, mediaType],
  });
  const publication = await buildKeelPublicationPlan({
    owner,
    executor,
    deadline: input.deadline,
    decodedDigest: sceneDigest,
    storedDigest: sceneDigest,
    decodedByteLength: input.scene.bytes.byteLength,
    storedBytes: input.scene.bytes,
    compression: "none",
    mediaType,
    operations: [{
      target: hold,
      data: operationData,
    }],
    contentObjectCount: 1,
    logicalOperationCount: 1,
    includeExecutorControlGas: true,
  });
  if (publication.storageMode !== KEEL_NATIVE_CARRIER_V1 || publication.operations.length !== 1) {
    throw new Error("The immutable Three.js scene must remain one native publication with one logical operation.");
  }
  const manifest = sceneManifest({ chainId, hold, scene: input.scene, sceneDigest, sceneObjectId });
  const integrity = await manifestIntegrity(manifest);
  return Object.freeze({
    protocol: KEEL_THREE_SCENE_PUBLICATION_PROTOCOL,
    status: "review-only",
    sceneId: input.scene.id,
    sceneDigest,
    sceneObjectId,
    sceneByteLength: input.scene.bytes.byteLength,
    edition: Object.freeze({ size: 1 as const, serial: 1 as const }),
    immutable: true,
    storageMode: KEEL_NATIVE_CARRIER_V1,
    viewer: Object.freeze({
      manifest,
      integrity,
      defaults: Object.freeze({
        manifestTrust: "digest" as const,
        sandbox: "strict" as const,
        capabilities: Object.freeze({}) as Readonly<Record<string, never>>,
        verification: "required" as const,
      }),
    }),
    publication,
    walletApproval: "required",
    signing: "not-performed",
    submitted: false,
  });
}

/** Short alias for callers that do not need the immutable qualifier. */
export const buildKeelThreeScenePublicationPlan = buildKeelImmutableThreeScenePublicationPlan;

/**
 * Reconcile a saved journal and confirmed receipt IDs for the exact scene
 * plan. This is deliberately read-only: a receipt wins over a stale local ID,
 * ambiguity fails closed, and the returned approval state is never requested.
 */
export function recoverKeelImmutableThreeScenePublication(input: {
  readonly plan: KeelImmutableThreeScenePublicationPlan;
  readonly savedJobId?: string;
  readonly confirmedJobIds: readonly bigint[];
  readonly recovery: KeelPublicationRecovery & { readonly planDigest: Hex };
}): KeelImmutableThreeSceneRecovery {
  const planDigest = ensureBytes32(input.recovery.planDigest, "recovery.planDigest");
  if (planDigest !== input.plan.publication.planDigest.toLowerCase()) {
    throw new Error("The KEEL publication recovery evidence identifies a different immutable plan.");
  }
  const jobId = selectResumableKeelJobId({
    ...(input.savedJobId === undefined ? {} : { savedJobId: input.savedJobId }),
    confirmedJobIds: input.confirmedJobIds,
  });
  const recoveryJobId = input.recovery.jobId === undefined
    ? undefined
    : selectResumableKeelJobId({ savedJobId: input.recovery.jobId, confirmedJobIds: [] });
  if (jobId !== undefined && recoveryJobId !== undefined && jobId !== recoveryJobId) {
    throw new Error("The KEEL publication recovery evidence identifies a different job.");
  }
  const selectedJobId = jobId ?? recoveryJobId;
  const recovery = mergeKeelPublicationRecovery(undefined, {
    ...(selectedJobId === undefined ? {} : { jobId: selectedJobId.toString() }),
    completedChunks: input.recovery.completedChunks,
    completedOperations: input.recovery.completedOperations,
    failedChunkIndexes: input.recovery.failedChunkIndexes,
    failedOperationIndexes: input.recovery.failedOperationIndexes,
    transactionHashes: input.recovery.transactionHashes,
  });
  return Object.freeze({
    protocol: KEEL_THREE_SCENE_PUBLICATION_PROTOCOL,
    storageMode: KEEL_NATIVE_CARRIER_V1,
    planDigest,
    ...(selectedJobId === undefined ? {} : { jobId: selectedJobId }),
    recovery,
    walletApproval: "not-requested",
  });
}

/** Canonical manifest bytes for callers that need to persist the viewer proof. */
export function canonicalKeelThreeSceneManifestBytes(manifest: ArtifactManifest): Uint8Array {
  assertValidManifest(manifest);
  return utf8ToBytes(canonicalJson(manifest));
}

// Keep the protocol Hex alias visible in generated declaration files without
// widening the public manifest digest to an arbitrary string.
export type KeelThreeSceneManifestDigest = ProtocolHex;

import type { Integrity } from "@keel/protocol";
import {
  createKeelChunkPlan,
  type KeelChunkPlan,
} from "./keel-document.js";
import type { Hex } from "./types.js";

/** The unsigned upload contract used by Fray's creator release flow. */
export const FRAY_KEEL_UPLOAD_PLAN_PROTOCOL = "fray-keel-upload-plan@1" as const;

export type FrayUploadFamily = "ethereum" | "tezos";

/** `KeelImmutableCheckpointRegistry` identity, field for field. */
export interface KeelTezosCheckpointIdentity {
  /** The carrier the registry hauls slugs from (`haul_slug`). */
  readonly hold: string;
  readonly expected_index_root: Hex;
  readonly expected_slug_count: number;
  readonly expected_stored_sha256: Hex;
  readonly expected_stored_byte_length: number;
  readonly decoded_sha256: Hex;
  readonly decoded_byte_length: number;
  readonly media_type: Hex;
  readonly compression: Hex;
}

export type FrayKeelTezosOperation =
  | {
      readonly kind: "write_chunk";
      readonly contract: string;
      readonly entrypoint: "write_chunk";
      readonly content: Hex;
    }
  | {
      readonly kind: "begin_checkpoint";
      readonly contract: string;
      readonly entrypoint: "begin_checkpoint";
      readonly object_id: Hex;
      readonly identity: KeelTezosCheckpointIdentity;
    }
  | {
      readonly kind: "append_checkpoint_slug";
      readonly contract: string;
      readonly entrypoint: "append_checkpoint_slug";
      readonly object_id: Hex;
      readonly expected_index: number;
      readonly slug_pointer: Hex;
    }
  | {
      readonly kind: "seal_checkpoint";
      readonly contract: string;
      readonly entrypoint: "seal_checkpoint";
      readonly object_id: Hex;
    };

export interface FrayKeelUploadPlan {
  readonly protocol: typeof FRAY_KEEL_UPLOAD_PLAN_PROTOCOL;
  readonly status: "review-only";
  readonly family: FrayUploadFamily;
  readonly network: string;
  readonly objectName: string;
  readonly mediaType: string;
  readonly source: {
    readonly integrity: Integrity;
    readonly byteLength: number;
  };
  readonly chunks: KeelChunkPlan;
  readonly tezos?: {
    readonly keelHold: string;
    readonly checkpointRegistry: string;
    /** The only account that can begin, append and seal this checkpoint. */
    readonly owner: string;
    readonly objectId: Hex;
    /** Confirm objectId before signing: it must equal this view's answer. */
    readonly objectIdView: {
      readonly contract: string;
      readonly view: "predict_object_id";
      readonly input: { readonly owner: string; readonly identity: KeelTezosCheckpointIdentity };
    };
    readonly operations: readonly FrayKeelTezosOperation[];
    readonly readView: "read_immutable_object";
  };
  readonly walletApproval: "required";
  readonly signing: "not-performed";
  readonly submission: "not-performed";
}

export interface CreateFrayKeelUploadPlanInput {
  readonly family: FrayUploadFamily;
  readonly network: string;
  readonly objectName: string;
  readonly mediaType: string;
  readonly maxChunkBytes?: number;
  readonly keccak256: (chunk: Uint8Array) => Hex | Promise<Hex>;
  readonly bytes: Uint8Array;
  readonly tezos?: {
    readonly keelHold: string;
    readonly checkpointRegistry: string;
    /**
     * The account that signs begin, append and seal. The registry binds the
     * object ID to it: objectId = sha256(PACK(record(owner, identity))), the
     * `predict_object_id` view. Another account cannot pre-claim it.
     */
    readonly owner: string;
    readonly objectId: Hex;
    readonly identity: KeelTezosCheckpointIdentity;
  };
}

/**
 * Build the creator-facing Fray upload plan on top of the canonical Keel
 * chunk planner. The returned object deliberately contains unsigned contract
 * operations only; a wallet adapter owns simulation, approval, and receipt.
 */
export async function createFrayKeelUploadPlan(
  input: CreateFrayKeelUploadPlanInput,
): Promise<FrayKeelUploadPlan> {
  if (input.network.trim().length === 0) throw new TypeError("Fray upload network is required.");
  const chunks = await createKeelChunkPlan(input.bytes, {
    objectName: input.objectName,
    mediaType: input.mediaType,
    ...(input.maxChunkBytes === undefined ? {} : { maxChunkBytes: input.maxChunkBytes }),
    keccak256: input.keccak256,
  });
  if (input.tezos !== undefined) {
    if (!/^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/u.test(input.tezos.owner ?? "")) throw new TypeError("Fray Tezos upload needs the checkpoint owner address.");
    if (input.tezos.identity.hold !== input.tezos.keelHold) throw new TypeError("The checkpoint identity must name the Hold the slugs are written to.");
    if (!/^0x[0-9a-fA-F]{64}$/u.test(input.tezos.objectId)) throw new TypeError("Fray Tezos objectId must be 32 bytes.");
  }
  const tezos = input.tezos === undefined
    ? undefined
    : {
        keelHold: input.tezos.keelHold,
        checkpointRegistry: input.tezos.checkpointRegistry,
        owner: input.tezos.owner,
        objectId: input.tezos.objectId,
        objectIdView: {
          contract: input.tezos.checkpointRegistry,
          view: "predict_object_id" as const,
          input: { owner: input.tezos.owner, identity: input.tezos.identity },
        },
        operations: createKeelTezosCheckpointOperations({
          chunks,
          keelHold: input.tezos.keelHold,
          checkpointRegistry: input.tezos.checkpointRegistry,
          identity: input.tezos.identity,
          objectId: input.tezos.objectId,
        }),
        readView: "read_immutable_object" as const,
      };
  return {
    protocol: FRAY_KEEL_UPLOAD_PLAN_PROTOCOL,
    status: "review-only",
    family: input.family,
    network: input.network,
    objectName: input.objectName,
    mediaType: input.mediaType,
    source: {
      integrity: chunks.integrity,
      byteLength: chunks.byteLength,
    },
    chunks,
    ...(tezos === undefined ? {} : { tezos }),
    walletApproval: "required",
    signing: "not-performed",
    submission: "not-performed",
  };
}

function createKeelTezosCheckpointOperations(input: {
  readonly chunks: KeelChunkPlan;
  readonly keelHold: string;
  readonly checkpointRegistry: string;
  readonly identity: KeelTezosCheckpointIdentity;
  readonly objectId: Hex;
}): readonly FrayKeelTezosOperation[] {
  const pointers = input.chunks.chunks.map((chunk, index) => {
    const pointer = chunk.slugId;
    if (pointer === undefined) throw new TypeError(`Fray chunk ${index.toString()} has no Keccak pointer.`);
    return pointer;
  });
  return [
    ...input.chunks.chunks.map((chunk, index) => ({
      kind: "write_chunk" as const,
      contract: input.keelHold,
      entrypoint: "write_chunk" as const,
      content: bytesToHex(chunk.bytes),
      index,
    })).map(({ index, ...operation }) => operation),
    {
      kind: "begin_checkpoint",
      contract: input.checkpointRegistry,
      entrypoint: "begin_checkpoint",
      object_id: input.objectId,
      identity: input.identity,
    },
    ...pointers.map((slugPointer, index) => ({
      kind: "append_checkpoint_slug" as const,
      contract: input.checkpointRegistry,
      entrypoint: "append_checkpoint_slug" as const,
      object_id: input.objectId,
      expected_index: index,
      slug_pointer: slugPointer,
    })),
    {
      kind: "seal_checkpoint",
      contract: input.checkpointRegistry,
      entrypoint: "seal_checkpoint",
      object_id: input.objectId,
    },
  ];
}

function bytesToHex(bytes: Uint8Array): Hex {
  let output = "0x";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output as Hex;
}

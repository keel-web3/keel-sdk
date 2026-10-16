/**
 * Multi-part graph publication from the MCP: per-part KeelHold objects (castSlugs + weldObject) and the ROOT
 * weldComposite that joins them, e.g. shell top + modules + assets + entry + shell bottom. Before this, chain-plan
 * could only composite its own single-file recursive plans, so the root weld of an Inline graph had to be built by
 * hand with the SDK outside the MCP.
 */
import { createKeelManagedCompositePlan, createKeelManagedObjectPlan, estimateKeelHoldCallGas, keelManagedCastOperations } from "@keel/sdk/native-managed";
import { KEEL_INLINE_COMPACT_MEDIA_TYPE, KEEL_CAST_MAX_SLUGS, keelGasLimit, keelMinimumTransactions, keelTransactionGasCap } from "@keel/sdk";
import { deliverResult, sha256Hex } from "./large-output.js";
import type { ToolContext, Workspace } from "./types.js";

type Hex = `0x${string}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const OBJECT_ID = /^0x[0-9a-fA-F]{64}$/u;
const MAX_PART_BYTES = 64 * 1024 * 1024;

export interface GraphWeldPartInput {
  readonly bytes?: Uint8Array;
  readonly objectId?: string;
  readonly label?: string;
  readonly path?: string;
}

export interface GraphWeldOperation {
  readonly kind: "castSlugs" | "weldObject" | "weldComposite";
  readonly part: number | "root" | readonly number[];
  readonly to: Hex;
  readonly valueWei: "0";
  readonly data: Hex;
  readonly estimatedGas: number;
  readonly gasLimit: number;
}

/** Welds cannot be batched: KeelHold has one weldObject/weldComposite per call and no KEEL weld batcher exists. */
export const KEEL_WELD_BATCHING = Object.freeze({
  available: false,
  reason: "KeelHold exposes weldObject/weldComposite one per call and no KEEL weld batcher is deployed; a generic multicall would make the batcher, not the creator, the welding msg.sender. Each weld is one transaction (about 130k-250k gas).",
});

/** Plan every part and the root. Parts given only by objectId are treated as already published. */
export async function planGraphWeld(input: {
  readonly hold: string;
  readonly mediaType: string;
  readonly parts: readonly GraphWeldPartInput[];
  readonly content?: Uint8Array;
  readonly chainId?: number;
}) {
  if (!ADDRESS.test(input.hold)) throw new TypeError("hold must be a 20-byte KeelHold address.");
  const hold = input.hold.toLowerCase() as Hex;
  if (input.parts.length < 1 || input.parts.length > 128) throw new RangeError("A graph root welds 1 through 128 parts.");
  const cap = keelTransactionGasCap({ ...(input.chainId === undefined ? {} : { chainId: input.chainId }) });
  const casts: { chunk: { id: Hex; bytes: Uint8Array }; part: number }[] = [];
  const welds: GraphWeldOperation[] = [];
  const parts = [];
  const ids: Hex[] = [];
  const pieces: Uint8Array[] = [];
  const priced = (data: Hex) => {
    const estimatedGas = estimateKeelHoldCallGas(data);
    if (estimatedGas === undefined) throw new Error("Not a KeelHold storage call.");
    const limit = keelGasLimit(estimatedGas, cap.gasCap);
    if (!limit.fits) throw Object.assign(new RangeError(`transaction-gas-cap-exceeded: one KeelHold call needs ~${estimatedGas} gas, above the ${cap.gasCap} per-transaction cap.`), { code: "transaction-gas-cap-exceeded" });
    return { estimatedGas, gasLimit: limit.gasLimit };
  };
  for (const [index, part] of input.parts.entries()) {
    if (part.bytes === undefined) {
      if (part.objectId === undefined || !OBJECT_ID.test(part.objectId)) throw new TypeError(`part ${index} needs bytes (path) or an existing objectId.`);
      ids.push(part.objectId.toLowerCase() as Hex);
      parts.push({ index, ...(part.label === undefined ? {} : { label: part.label }), objectId: part.objectId.toLowerCase(), source: "existing-object" as const });
      continue;
    }
    const plan = await createKeelManagedObjectPlan(part.bytes, { hold: hold as `0x${string}`, mediaType: input.mediaType, compression: "none" });
    if (part.objectId !== undefined && part.objectId.toLowerCase() !== plan.objectId.toLowerCase()) {
      throw new Error(`part ${index}: the bytes weld to ${plan.objectId}, not the declared objectId ${part.objectId}.`);
    }
    for (const chunk of plan.chunks) if (!casts.some((entry) => entry.chunk.id === chunk.id)) casts.push({ chunk, part: index });
    for (const weld of plan.operations) welds.push({ kind: weld.data.startsWith("0x5f97a164") ? "weldComposite" : "weldObject", part: index, to: hold, valueWei: "0", data: weld.data, ...priced(weld.data) });
    ids.push(plan.objectId);
    pieces.push(part.bytes);
    parts.push({
      index, ...(part.label === undefined ? {} : { label: part.label }), ...(part.path === undefined ? {} : { path: part.path }),
      objectId: plan.objectId, digest: plan.digest, byteLength: plan.byteLength, chunks: plan.chunks.length,
      weldOperations: plan.operations.length, source: "bytes" as const,
    });
  }
  let content = input.content;
  if (content === undefined) {
    if (pieces.length !== input.parts.length) throw new TypeError("Parts given only by objectId need contentPath: the exact concatenated graph bytes the root commits to.");
    content = new Uint8Array(pieces.reduce((total, piece) => total + piece.byteLength, 0));
    let offset = 0;
    for (const piece of pieces) {
      content.set(piece, offset);
      offset += piece.byteLength;
    }
  } else if (pieces.length === input.parts.length) {
    const joined = Buffer.concat(pieces);
    if (joined.byteLength !== content.byteLength || !joined.equals(content)) throw new Error("contentPath does not equal the concatenation of the part files.");
  }
  const root = createKeelManagedCompositePlan(ids, content, { hold: hold as `0x${string}`, mediaType: input.mediaType });
  // Casts from EVERY part packed together (slugs are content-addressed): as few transactions as the cap allows.
  const packed = keelManagedCastOperations({ chunks: casts.map((entry) => entry.chunk) }, hold as `0x${string}`, { maxSlugs: KEEL_CAST_MAX_SLUGS, targetGas: cap.targetGas });
  const castOperations: GraphWeldOperation[] = packed.map((cast) => ({
    kind: "castSlugs", part: [...new Set(cast.slugIds.map((id) => casts.find((entry) => entry.chunk.id === id)!.part))], to: hold, valueWei: "0", data: cast.data, ...priced(cast.data),
  }));
  const operations: GraphWeldOperation[] = [...castOperations, ...welds, { kind: "weldComposite", part: "root", to: hold, valueWei: "0", data: root.operation.data, ...priced(root.operation.data) }];
  const totalEstimatedGas = operations.reduce((total, operation) => total + operation.estimatedGas, 0);
  return {
    schema: "keel.graph-weld-prepare@1" as const,
    status: "review-only" as const,
    hold,
    mediaType: input.mediaType,
    root: { objectId: root.objectId, digest: root.digest, byteLength: Number(root.byteLength), contentSha256: sha256Hex(content), parts: ids },
    parts,
    operationCount: operations.length,
    transactions: {
      count: operations.length,
      casts: castOperations.length,
      welds: operations.length - castOperations.length,
      totalEstimatedGas,
      gasCap: cap.gasCap,
      gasCapSource: cap.source,
      packingTargetGas: cap.targetGas,
      maxSlugsPerCast: KEEL_CAST_MAX_SLUGS,
      minimumPossible: keelMinimumTransactions(totalEstimatedGas, cap.gasCap),
      weldBatching: KEEL_WELD_BATCHING,
      note: "Every operation carries gasLimit = estimate + 7%, always at or under the cap. Casts are packed across parts; welds stay one per transaction.",
    },
    operations,
    storageOnly: true as const,
    next: "Each operation is a KeelHold storage write: pass it to wallet-request-prepare (storage-only needs no evidence). Check objectExists first and skip parts already on the selected chain. Bind the root objectId only after receipts and read-back.",
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  };
}

export function summarizeGraphWeld(plan: Awaited<ReturnType<typeof planGraphWeld>>) {
  const { operations, ...rest } = plan;
  return { ...rest, operations: operations.slice(0, 32).map((operation) => ({ kind: operation.kind, part: operation.part, to: operation.to, estimatedGas: operation.estimatedGas, gasLimit: operation.gasLimit, dataBytes: (operation.data.length - 2) / 2, dataSha256: sha256Hex(operation.data) })), operationsTruncated: operations.length > 32 };
}

async function readPart(workspace: Workspace, pathValue: string): Promise<Uint8Array> {
  return (await workspace.readFile(pathValue, MAX_PART_BYTES)).bytes;
}

export async function graphWeldPrepareTool(context: ToolContext, value: unknown): Promise<unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("keel-graph-weld-prepare arguments must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["hold", "chainId", "mediaType", "parts", "contentPath", "out"].includes(key)) throw new TypeError(`keel-graph-weld-prepare arguments.${key} is not supported.`);
  if (typeof input.hold !== "string") throw new TypeError("hold is required.");
  if (input.chainId !== undefined && (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId < 1)) throw new TypeError("chainId must be a positive integer.");
  const mediaType = input.mediaType === undefined ? KEEL_INLINE_COMPACT_MEDIA_TYPE : input.mediaType;
  if (typeof mediaType !== "string" || mediaType.length === 0 || mediaType.length > 128) throw new TypeError("mediaType is invalid.");
  if (!Array.isArray(input.parts)) throw new TypeError("parts must be an ordered list.");
  const parts: GraphWeldPartInput[] = [];
  for (const [index, entry] of input.parts.entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError(`parts[${index}] must be an object.`);
    const part = entry as Record<string, unknown>;
    for (const key of Object.keys(part)) if (!["path", "objectId", "label"].includes(key)) throw new TypeError(`parts[${index}].${key} is not supported.`);
    if (part.path !== undefined && typeof part.path !== "string") throw new TypeError(`parts[${index}].path must be a workspace path.`);
    if (part.objectId !== undefined && typeof part.objectId !== "string") throw new TypeError(`parts[${index}].objectId must be bytes32 hex.`);
    parts.push({
      ...(part.path === undefined ? {} : { path: part.path as string, bytes: await readPart(context.workspace, part.path as string) }),
      ...(part.objectId === undefined ? {} : { objectId: part.objectId as string }),
      ...(typeof part.label === "string" ? { label: part.label.slice(0, 128) } : {}),
    });
  }
  const content = typeof input.contentPath === "string" ? await readPart(context.workspace, input.contentPath) : undefined;
  const plan = await planGraphWeld({ hold: input.hold, mediaType, parts, ...(content === undefined ? {} : { content }), ...(typeof input.chainId === "number" ? { chainId: input.chainId } : {}) });
  const result = { ...plan, ...(typeof input.chainId === "number" ? { chainId: input.chainId } : {}) };
  return deliverResult(context.workspace, result, {
    outPath: typeof input.out === "string" ? input.out : `.keel-mcp/graph-weld/${plan.root.objectId.slice(2, 18)}.json`,
    ...(typeof input.out === "string" ? { force: true } : {}),
    summary: (full) => summarizeGraphWeld(full),
  });
}

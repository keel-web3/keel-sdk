import { createIntegrity, type Hex } from "@keel/protocol";
import {
  inspectKeelInlineExistingObjectReuse,
  type KeelInlineExistingObjectReusePart,
} from "@keel/sdk/inline-viewer-graph";
import { PREPARED_COPY_POLICY } from "./prepared-copy-guidance.js";
import type { JsonSchema, ToolDefinition } from "./types.js";

const ROLES = ["shell-prefix", "module", "entrypoint", "asset", "shell-suffix"] as const;
const MAX_BYTES = 2_000_000;
const hex32: JsonSchema = { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" };
const address: JsonSchema = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const schema: JsonSchema = {
  type: "object", additionalProperties: false,
  properties: {
    chainId: { type: "integer", minimum: 1 }, store: address, builder: address,
    readback: { type: "object", additionalProperties: false, properties: {
      blockNumber: { type: "string", pattern: "^[0-9]+$", maxLength: 78 }, blockHash: hex32,
      orderedObjectIds: { type: "array", minItems: 2, maxItems: 128, items: hex32,
        description: "Exact ordered reference vector read from the existing selected-chain binding at this block. It must match parts; authenticate it before publication." },
    }, required: ["blockNumber", "blockHash", "orderedObjectIds"] },
    parts: { type: "array", minItems: 2, maxItems: 128, items: {
      type: "object", additionalProperties: false, properties: {
        id: { type: "string", minLength: 1, maxLength: 128 },
        role: { type: "string", enum: [...ROLES] }, objectId: hex32,
        mediaType: { type: "string", maxLength: 128 }, compression: { type: "string", enum: ["none"] },
        bytesPath: { type: "string", minLength: 1, maxLength: 2048 }, digest: hex32,
        byteLength: { type: "integer", minimum: 1, maximum: MAX_BYTES }, transactionHash: hex32,
      }, required: ["id", "role", "objectId", "mediaType", "compression", "bytesPath", "digest", "byteLength", "transactionHash"],
    } },
  }, required: ["chainId", "store", "builder", "readback", "parts"],
};

function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new TypeError(`${label} has unsupported fields. Source uploads and encoding overrides are forbidden in an existing-object plan.`);
  return result;
}
function text(value: unknown, label: string, max = 2048): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new TypeError(`${label} is invalid.`);
  return value;
}
function hex(value: unknown, length: number, label: string): Hex {
  const result = text(value, label, length + 2).toLowerCase();
  if (!new RegExp(`^0x[0-9a-f]{${length}}$`, "u").test(result) || /^0x0+$/u.test(result)) throw new TypeError(`${label} is invalid.`);
  return result as Hex;
}

export const PREPARED_COPY_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-inline-reuse-plan",
    description: "FIRST for existing onchain objects: validate exact read-back files and plan copy-only Inline assembly using the matching registered builder. KEEL's aligned Base64 fragments are copied between the prepared top/bottom without re-encoding the body. The raw-percent builder also copies its exact prepared fragments. Zero uploads, zero repacking, zero runtime body encoding. Incompatible binary/media/alignment fails instead of inventing an encoder. Caller-supplied receipt/block evidence still requires selected-chain authentication before publication; no signing or submission.",
    inputSchema: schema,
  },
  async run(context, value) {
    const input = object(structuredClone(value), ["chainId", "store", "builder", "readback", "parts"], "Existing Inline assembly");
    if (typeof input.chainId !== "number" || !Number.isSafeInteger(input.chainId) || input.chainId < 1) throw new TypeError("chainId is invalid.");
    const chainId = input.chainId, store = hex(input.store, 40, "store"), builder = hex(input.builder, 40, "builder");
    const block = object(input.readback, ["blockNumber", "blockHash", "orderedObjectIds"], "readback");
    const blockNumber = text(block.blockNumber, "readback.blockNumber", 78);
    if (!/^[0-9]+$/u.test(blockNumber)) throw new TypeError("readback.blockNumber is invalid.");
    const blockHash = hex(block.blockHash, 64, "readback.blockHash");
    if (!Array.isArray(input.parts) || input.parts.length < 2 || input.parts.length > 128) throw new TypeError("parts must contain 2 through 128 ordered references.");
    if (!Array.isArray(block.orderedObjectIds) || block.orderedObjectIds.length !== input.parts.length) throw new TypeError("Read-back orderedObjectIds must match the exact existing reference count.");
    const orderedObjectIds = block.orderedObjectIds.map((id, index) => hex(id, 64, `readback.orderedObjectIds[${index}]`));
    const published: KeelInlineExistingObjectReusePart[] = [];
    const references: Array<{ id: string; role: string; objectId: Hex; mediaType: string; digest: Hex; byteLength: number; transactionHash: Hex }> = [];
    const ids = new Set<string>(); let storedBytes = 0;
    for (const [index, value] of input.parts.entries()) {
      const item = object(value, ["id", "role", "objectId", "mediaType", "compression", "bytesPath", "digest", "byteLength", "transactionHash"], `part ${index}`);
      const id = text(item.id, `part ${index}.id`, 128);
      if (ids.has(id)) throw new TypeError(`Duplicate logical part ${id}.`); ids.add(id);
      const role = text(item.role, `${id}.role`, 32) as typeof ROLES[number];
      if (!ROLES.includes(role) || (index === 0 ? role !== "shell-prefix" : index === input.parts.length - 1 ? role !== "shell-suffix" : role === "shell-prefix" || role === "shell-suffix")) throw new TypeError("Preserve ordered shell prefix, body references, shell suffix.");
      const mediaType = text(item.mediaType, `${id}.mediaType`, 128);
      if (item.compression !== "none") throw new TypeError(`${id} must already be an uncompressed prepared carriage.`);
      if (typeof item.byteLength !== "number" || !Number.isSafeInteger(item.byteLength) || item.byteLength < 1 || item.byteLength > MAX_BYTES) throw new TypeError(`${id}.byteLength is invalid.`);
      const objectId = hex(item.objectId, 64, `${id}.objectId`), digest = hex(item.digest, 64, `${id}.digest`), transactionHash = hex(item.transactionHash, 64, `${id}.transactionHash`);
      if (objectId !== orderedObjectIds[index]) throw new TypeError(`${id} changes the read-back ordered reference vector. Preserve the existing object order.`);
      storedBytes += item.byteLength; if (storedBytes > MAX_BYTES) throw new RangeError("Existing assembly exceeds the complete-return budget before metadata.");
      const loaded = await context.workspace.readFile(text(item.bytesPath, `${id}.bytesPath`), MAX_BYTES);
      const integrity = await createIntegrity(loaded.bytes);
      if (integrity.digest.toLowerCase() !== digest || integrity.byteLength !== item.byteLength) throw new TypeError(`${id} read-back bytes do not match the exact onchain commitment.`);
      published.push({ role, bytes: loaded.bytes, integrity, carrier: { chainId, store, objectId, mediaType, compression: "none", storedByteLength: item.byteLength } });
      references.push({ id, role, objectId, mediaType, digest, byteLength: item.byteLength, transactionHash });
    }
    const inspected = await inspectKeelInlineExistingObjectReuse({ existingParts: published,
      existingObjectReuse: { mode: "assembly-only", chainId, store } });
    const requiredBuilder = inspected.carriage === "raw-percent" ? "KeelRawTokenURIBuilder"
      : inspected.carriage === "percent" ? "KeelPercentTokenURIBuilder" : "KeelHarnessBuilder";
    const preparedBodyBytes = published.reduce((total, part) => total + (
      inspected.carriage === "follow-latest" && part.role.startsWith("shell-") ? 0 : part.bytes.byteLength
    ), 0);
    return {
      schema: "keel-inline-reuse-plan@1", status: "review-only", chainId, store, builder,
      readback: { blockNumber, blockHash, orderedObjectIds, authentication: "caller-supplied; selected-chain receipt, runtime, registration, binding order and block checks still required" },
      assembly: { policy: PREPARED_COPY_POLICY.id, requiredBuilder, carriage: inspected.carriage,
        bodyTransform: inspected.storageTransform, objectOrder: references, selectedChainBindingVerified: inspected.selectedChainBindingVerified },
      bytes: { newStoredBytes: inspected.newSourcePublicationBytes, reusedStoredBytes: storedBytes, preparedBodyBytes },
      objectWrites: [], uploadPlan: null,
      requiredBeforePublication: ["exact selected-chain registered shell/builder and object receipt read-back", "existing binding supports the requested revision", "complete tokenURI byte equality, read gas and no-network browser proof"],
      signing: "not-performed", submission: "not-performed",
    };
  },
}];

import { KEEL_ENGINE_CATALOG, KEEL_ENGINE_CHOICES, planKeelProject } from "@keel/sdk/engine";
import { planKeelTezosStandardRoute } from "@keel/sdk/tezos-standard";
import { planKeelGraphRevision } from "@keel/sdk/revision-publication";
import type { JsonSchema, ToolDefinition } from "./types.js";
import { contractControls, parseContractAbi } from "@keel/sdk/contract-controls";
import { inspectNetwork, type KeelNetworkInspectionTarget } from "@keel/sdk/network-inspection";
import { TOOL_SCHEMAS } from "./schemas.js";

const properties: Record<string, JsonSchema> = {};
for (const [key, choices] of Object.entries(KEEL_ENGINE_CHOICES)) {
  const choice: JsonSchema = { type: "string", enum: choices };
  properties[key === "stage" ? "stages" : key] = key === "access" || key === "stage"
    ? { type: "array", items: choice, minItems: 1, maxItems: choices.length } : choice;
}
for (const field of ["title", "network", "collectionAddress", "supply"]) properties[field] = { type: "string", minLength: 1, maxLength: 160 };
properties.chainId = { type: "integer", minimum: 1 };

const tezosStandardRoutePlanSchema: JsonSchema = {
  type: "object",
  properties: {
    network: { type: "string", minLength: 15, maxLength: 15, description: "Exact selected Tezos Net... chain identity." },
    originalAssetByteLength: { type: "integer", minimum: 0, description: "Measured original creator asset or canonical root-shell bytes." },
    compressedAssetByteLength: { type: "integer", minimum: 0, description: "Measured stored child-resource bytes used by the compact default." },
    completeInlineByteLength: { type: "integer", minimum: 0, description: "Measured complete inline animation/tokenURI return bytes." },
    builderConfigured: { type: "boolean", description: "Whether the selected chain's receipt-backed KEEL inline builder is configured." },
    bootShellCompression: { type: "string", enum: ["none", "gzip", "deflate", "brotli"] },
    mediaType: { type: "string", minLength: 1, maxLength: 128 },
    html: { type: "string", maxLength: 4194304, description: "Optional measured shell HTML used to detect runtime network fetches." },
    mode: { type: "string", enum: ["auto", "inline", "hybrid"] },
    readGas: { type: "integer", minimum: 0 },
    blockGasLimit: { type: "integer", minimum: 1 },
  },
  required: ["network", "originalAssetByteLength", "compressedAssetByteLength", "completeInlineByteLength", "builderConfigured"],
  additionalProperties: false,
};

function tezosStandardRoutePlan(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Tezos standard route planning requires an object.");
  const input = value as Record<string, unknown>;
  const allowed = new Set(["network", "originalAssetByteLength", "compressedAssetByteLength", "completeInlineByteLength", "builderConfigured", "bootShellCompression", "mediaType", "html", "mode", "readGas", "blockGasLimit"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new TypeError(`Unsupported Tezos standard route field: ${key}.`);
  const network = input.network;
  if (typeof network !== "string" || !/^Net[1-9A-HJ-NP-Za-km-z]{12}$/u.test(network)) throw new TypeError("network must be an exact Tezos Net... identity.");
  const byteLength = (key: string): number => {
    const result = input[key];
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw new TypeError(`${key} must be a nonnegative safe byte count.`);
    return result;
  };
  const builderConfigured = input.builderConfigured;
  if (typeof builderConfigured !== "boolean") throw new TypeError("builderConfigured must be boolean.");
  const bootShellCompression = input.bootShellCompression;
  if (bootShellCompression !== undefined && !["none", "gzip", "deflate", "brotli"].includes(String(bootShellCompression))) throw new TypeError("Unsupported bootShellCompression.");
  const mediaType = input.mediaType;
  if (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length === 0 || mediaType.length > 128)) throw new TypeError("mediaType is invalid.");
  const html = input.html;
  if (html !== undefined && (typeof html !== "string" || html.length > 4194304)) throw new TypeError("html is invalid or too large.");
  const mode = input.mode;
  if (mode !== undefined && !["auto", "inline", "hybrid"].includes(String(mode))) throw new TypeError("mode must be auto, inline, or hybrid.");
  const optionalGas = (key: string): bigint | undefined => {
    const result = input[key];
    if (result === undefined) return undefined;
    if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) throw new TypeError(`${key} must be a nonnegative safe integer.`);
    if (key === "blockGasLimit" && result === 0) throw new TypeError("blockGasLimit must be positive.");
    return BigInt(result);
  };
  const readGas = optionalGas("readGas");
  const blockGasLimit = optionalGas("blockGasLimit");
  return planKeelTezosStandardRoute({
    network,
    originalAssetByteLength: byteLength("originalAssetByteLength"),
    compressedAssetByteLength: byteLength("compressedAssetByteLength"),
    completeInlineByteLength: byteLength("completeInlineByteLength"),
    builderConfigured,
    ...(bootShellCompression === undefined ? {} : { bootShellCompression: String(bootShellCompression) }),
    ...(mediaType === undefined ? {} : { mediaType: mediaType as string }),
    ...(html === undefined ? {} : { html: html as string }),
    ...(mode === undefined ? {} : { mode: mode as "auto" | "inline" | "hybrid" }),
    ...(readGas === undefined ? {} : { readGas }),
    ...(blockGasLimit === undefined ? {} : { blockGasLimit }),
  });
}

export const ENGINE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-network-inspect",
    description: "Read the chosen EVM or Tezos RPC network now: chain identity, current head, gas boundaries, available fee quote and KEEL setup gaps. Custom networks are supported. Does not deploy, sign or establish contract authority; fee quotes need exact prepared calls before estimating publication cost.",
    inputSchema: { type: "object", properties: { family: { type: "string", enum: ["ethereum", "tezos"] }, rpcUrl: { type: "string", minLength: 1, maxLength: 2048 }, chainId: { type: "integer", minimum: 1 }, network: { type: "string", minLength: 1, maxLength: 64 }, holdAddress: { type: "string", minLength: 42, maxLength: 42 }, builderAddress: { type: "string", minLength: 42, maxLength: 42 } }, required: ["family", "rpcUrl"], additionalProperties: false },
  },
  async run(_context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Network inspection requires an exact RPC target.");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["family", "rpcUrl", "chainId", "network", "holdAddress", "builderAddress"].includes(key))) throw new TypeError("Unsupported network inspection field.");
    return inspectNetwork(input as unknown as KeelNetworkInspectionTarget);
  },
}, {
  descriptor: {
    name: "keel-tezos-standard-route-plan",
    description: "Apply the default KEEL Tezos route: canonical shell, native OnchFS, Hold, Index, HarnessBuilder, FA2/TZIP-12, and KeelSleeve. Measure the complete inline return and automatically choose Inline only when it fits; otherwise choose the RPC-backed Hybrid presentation without moving bytes offchain. Review-only: no signing, submission, or contract address is created.",
    inputSchema: tezosStandardRoutePlanSchema,
  },
  async run(_context, value) { return tezosStandardRoutePlan(value); },
}, {
  descriptor: {
    name: "keel-contract-controls",
    description: "Inspect an uploaded ABI or compiler artifact as bounded JSON text and list exact read/write signatures and parameter controls. ABI import proves neither code identity nor user authority; proxy calls target the proxy. No RPC or wallet action occurs.",
    inputSchema: { type: "object", properties: { abiJson: { type: "string", minLength: 2, maxLength: 512000 } }, required: ["abiJson"], additionalProperties: false },
  },
  async run(_context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Contract controls require abiJson.");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => key !== "abiJson") || typeof input.abiJson !== "string" || input.abiJson.length > 512000) throw new TypeError("Contract controls require bounded abiJson only.");
    const result = { schema: "keel-contract-controls@1", controls: contractControls(parseContractAbi(input.abiJson)), authority: "unverified", signing: "not-performed", submission: "not-performed" };
    if (JSON.stringify(result).length > 262144) throw new TypeError("Contract controls exceed the MCP response budget. Inspect a smaller ABI.");
    return result;
  },
}, {
  descriptor: {
    name: "keel-engine-catalog",
    description: "Discover collection types, mint systems, independent permission domains, storage choices, runtime modules and setup steps. Source inventory only; not live deployment proof.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  async run(_context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length) throw new TypeError("Engine catalog accepts an empty object.");
    return KEEL_ENGINE_CATALOG;
  },
}, {
  descriptor: {
    name: "keel-revision-plan",
    description: "Hard gate for one-file updates to an existing versioned KEEL graph. It compares the live and candidate resource graphs, requires every unchanged object ID and commitment to be reused, reports only new versus reused bytes, and blocks unrelated or oversized republishing before wallet review. No I/O, signing, or submission.",
    inputSchema: TOOL_SCHEMAS.revisionPlan,
  },
  async run(_context, value) {
    return planKeelGraphRevision(value);
  },
}, {
  descriptor: {
    name: "keel-project-decisions",
    description: "Shared SDK/desktop creator planner. Preserve known choices; ask only returned nextQuestions, up to three at a time. Suggestions are not selected chain, storage, economics or authority. Planned never means ready to publish. No I/O.",
    inputSchema: { type: "object", properties, additionalProperties: false },
  },
  async run(_context, value) { return planKeelProject(value); },
}];

import {
  createViemEthereumAdapterCodecs,
  prepareEthereumKeelHoldOperations,
  type EthereumAdapterResult,
} from "@keel/ethereum-adapter";
import path from "node:path";
import { deliverResult, sha256Hex } from "./large-output.js";
import { KEEL_EIP7825_TX_GAS_CAP, keelGasLimit, keelMinimumTransactions } from "@keel/sdk";
import { estimateKeelHoldCallGas } from "@keel/sdk/native-managed";
import type { Workspace } from "./types.js";

const MAX_PLAN_BYTES = 4 * 1024 * 1024;
const MAX_SLUG_BYTES = 23_000;
const MAX_SOURCE_ENTRIES = 65_536;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;
/** Descriptors are written to a workspace file when they do not fit inline; this only bounds process memory. */
const MAX_FILE_RESULT_BYTES = 512 * 1024 * 1024;
const SAFE_RELATIVE = /^(?!\/)(?!.*(?:^|\/)(?:\.|\.\.)$)[^\\\u0000-\u001f\u007f]+$/u;

function safeRelative(value: string): boolean {
  return SAFE_RELATIVE.test(value) && value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const fields = new Set(allowed);
  for (const key of Object.keys(value)) if (!fields.has(key)) throw new TypeError(`${label}.${key} is not supported.`);
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) throw new TypeError(`${key} must be a non-empty string.`);
  return result;
}

function optionalBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const result = value[key];
  if (result === undefined) return undefined;
  if (typeof result !== "boolean") throw new TypeError(`${key} must be boolean.`);
  return result;
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

function collectChunkFiles(plan: unknown): string[] {
  const input = record(plan, "upload plan");
  const values: unknown[] = [];
  if (input.schema === "keel-upload-plan@2") {
    if (Array.isArray(input.chunks)) values.push(...input.chunks);
  } else if (input.schema === "keel-recursive-upload-plan@2" && Array.isArray(input.objects)) {
    for (const objectValue of input.objects) {
      const item = record(objectValue, "upload plan object");
      if (item.kind === "leaf" && Array.isArray(item.chunks)) values.push(...item.chunks);
    }
  }
  const files = new Set<string>();
  for (const value of values) {
    const item = record(value, "upload plan chunk");
    if (typeof item.file === "string" && safeRelative(item.file)) files.add(item.file);
    if (files.size > MAX_SOURCE_ENTRIES) throw new RangeError(`upload plan references more than ${MAX_SOURCE_ENTRIES} chunk files.`);
  }
  return [...files];
}

async function loadPlan(workspace: Workspace, planPath: string): Promise<{ readonly plan: unknown; readonly chunks: Readonly<Record<string, Uint8Array>> }> {
  const loaded = await workspace.readFile(planPath, MAX_PLAN_BYTES);
  const plan = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as unknown;
  const directory = path.dirname(planPath);
  const chunks: Record<string, Uint8Array> = {};
  let total = 0;
  for (const file of collectChunkFiles(plan)) {
    const relative = path.join(directory, file);
    try {
      const chunk = await workspace.readFile(relative, MAX_SLUG_BYTES);
      total += chunk.bytes.byteLength;
      if (!Number.isSafeInteger(total) || total > MAX_SOURCE_BYTES) throw new RangeError(`chunk bytes exceed the ${MAX_SOURCE_BYTES}-byte adapter limit.`);
      chunks[file] = chunk.bytes;
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      throw error;
    }
  }
  return { plan, chunks };
}

export async function ethereumEncodeTool(workspace: Workspace, value: unknown): Promise<unknown> {
  const input = record(value, "ethereum-encode arguments");
  exact(input, ["plan", "family", "chainId", "target", "qr", "out"], "ethereum-encode arguments");
  const planPath = requiredString(input, "plan");
  const family = requiredString(input, "family");
  if (family !== "ethereum") throw new TypeError("ethereum-encode currently supports family ethereum only.");
  const chainId = input.chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) throw new TypeError("chainId must be a positive safe integer.");
  const target = requiredString(input, "target");
  const qrRequested = optionalBoolean(input, "qr") === true;
  const outValue = input.out;
  if (outValue !== undefined && (typeof outValue !== "string" || !safeRelative(outValue) || !outValue.endsWith(".json"))) throw new TypeError("out must be a workspace-relative .json path.");
  const loaded = await loadPlan(workspace, planPath);
  const result: EthereumAdapterResult = await prepareEthereumKeelHoldOperations({
    plan: loaded.plan,
    chunks: loaded.chunks,
    target: { family: "ethereum", chainId, address: target },
    codecs: createViemEthereumAdapterCodecs(),
    maxResultBytes: MAX_FILE_RESULT_BYTES,
  });
  // Explicit per-transaction gas (EIP-7825): every operation carries estimate + 7%, and one that cannot fit is refused.
  const priced = result.status === "ready-for-review"
    ? {
        ...result,
        operations: result.operations.map((operation, index) => {
          const estimatedGas = estimateKeelHoldCallGas(operation.data as `0x${string}`) ?? 0;
          const limit = keelGasLimit(Math.max(estimatedGas, 21_000));
          if (!limit.fits) throw new RangeError(`transaction-gas-cap-exceeded: operation ${index} (${operation.kind}) needs ~${estimatedGas} gas, above the ${limit.gasCap} per-transaction cap.`);
          return { ...operation, estimatedGas, gasLimit: limit.gasLimit };
        }),
      }
    : result;
  const totalEstimatedGas = priced.status === "ready-for-review" ? priced.operations.reduce((total, operation) => total + (operation as { estimatedGas: number }).estimatedGas, 0) : 0;
  const output = {
    ...priced,
    ...(priced.status === "ready-for-review" ? { transactions: { count: priced.operations.length, totalEstimatedGas, gasCap: KEEL_EIP7825_TX_GAS_CAP, minimumPossible: keelMinimumTransactions(totalEstimatedGas), weldBatching: "unavailable: one weld per KeelHold call" } } : {}),
    planPath,
    transport: {
      qr: "unsupported",
      requested: qrRequested,
      reason: "This offline adapter emits unsigned calldata only; review it first, then use wallet-request-prepare for a connector-specific request.",
    },
  };
  // Never defer a valid encode because it is large: write the complete descriptors to the workspace and hand back
  // the path + digest. Falling back to hand SDK encoding outside the MCP is exactly what this prevents.
  const defaultOut = path.join(path.dirname(planPath), `${path.basename(planPath, ".json")}.ethereum-encode.json`);
  return deliverResult(workspace, output, {
    outPath: typeof outValue === "string" ? outValue : defaultOut,
    force: typeof outValue === "string",
    summary: (value) => ({
      status: value.status,
      family: value.family,
      chainReady: value.chainReady,
      ...("source" in value && value.source !== undefined ? { source: value.source } : {}),
      planPath,
      ...(value.status === "ready-for-review" ? {
        operationCount: value.operations.length,
        transactions: (value as { transactions?: unknown }).transactions,
        operations: value.operations.slice(0, 64).map((operation) => ({
          operationId: operation.operationId, kind: operation.kind, to: operation.to, signature: operation.signature,
          estimatedGas: (operation as { estimatedGas?: number }).estimatedGas, gasLimit: (operation as { gasLimit?: number }).gasLimit,
          dataBytes: (operation.data.length - 2) / 2, dataSha256: sha256Hex(operation.data),
        })),
        operationsTruncated: value.operations.length > 64,
        signing: value.signing,
        submission: value.submission,
      } : { issues: value.issues, code: value.code }),
      transport: value.transport,
    }),
  });
}

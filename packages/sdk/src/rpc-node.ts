/** Local-only private provider settings. Never include this file in browser artwork. */
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { createKeelRpcPool, resolveKeelRpcConfiguration, type KeelRpcConfiguration, type KeelRpcEnvironment } from "./rpc.js";

export function parseKeelRpcConfiguration(value: unknown): KeelRpcConfiguration {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("RPC config must be a JSON object.");
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some(k => !["schema", "chainId", "rpcUrl", "rpcUrls", "timeoutMs", "minIntervalMs", "maxResponseBytes"].includes(k))
      || object.schema !== undefined && object.schema !== "keel-rpc-config@1") throw new TypeError("Unsupported RPC config fields/schema.");
  for (const k of ["chainId", "timeoutMs", "minIntervalMs", "maxResponseBytes"]) if (object[k] !== undefined && typeof object[k] !== "number") throw new TypeError("RPC numeric settings must be numbers.");
  if (object.rpcUrl !== undefined && typeof object.rpcUrl !== "string" || object.rpcUrls !== undefined && (!Array.isArray(object.rpcUrls) || object.rpcUrls.some(v => typeof v !== "string"))) throw new TypeError("RPC URLs must be strings.");
  const config = object as KeelRpcConfiguration;
  resolveKeelRpcConfiguration({}, {}, config);
  return config;
}
export async function readKeelRpcConfiguration(workspace = process.cwd()): Promise<KeelRpcConfiguration> {
  const root = await realpath(workspace);
  const path = resolve(root, ".keel/rpc.json");
  let actual: string;
  try { actual = await realpath(path); } catch (error) { if ((error as { code?: string }).code === "ENOENT") return {}; throw new Error("RPC config cannot be read; check local .keel/rpc.json."); }
  const local = relative(root, actual);
  if (local === ".." || local.startsWith("../") || isAbsolute(local)) throw new Error("RPC config must remain inside the selected workspace.");
  const info = await stat(actual);
  if (!info.isFile() || info.size > 16384) throw new Error("RPC config must be a bounded regular JSON file.");
  try { const bytes = await readFile(actual); if (bytes.length > 16384) throw new Error("Oversized config."); return parseKeelRpcConfiguration(JSON.parse(bytes.toString("utf8"))); }
  catch { throw new Error("Invalid local RPC config. Check .keel/rpc.json or run pnpm rpc:configure; keep provider API keys local."); }
}
export async function createKeelNodeRpc(options: {
  readonly workspace?: string;
  readonly explicit?: KeelRpcConfiguration;
  readonly environment?: KeelRpcEnvironment;
} = {}) {
  const configuration = resolveKeelRpcConfiguration(options.explicit, options.environment ?? process.env,
    await readKeelRpcConfiguration(options.workspace));
  return { configuration, pool: createKeelRpcPool({ ...configuration, allowLoopback: configuration.source === "explicit" }) };
}

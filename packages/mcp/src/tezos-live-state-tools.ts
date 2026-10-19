import { prepareKeelTezosLiveState } from "@keel/sdk/tezos-live-state";
import type { JsonSchema, ToolDefinition } from "./types.js";

/**
 * MCP door to the opt-in Tezos live-state module (`@keel/sdk/tezos-live-state`).
 * Prepare-only: it reads the publish-time snapshot (public read-only RPC GETs
 * and view simulations) or accepts one offline, and returns the data-phase
 * fragment the token's HTML embeds. No key material, signing or submission.
 */

const NETWORK: JsonSchema = { type: "string", pattern: "^Net[1-9A-HJ-NP-Za-km-z]{12}$", description: "Exact selected Tezos chain identity (Net...)." };
const KT1: JsonSchema = { type: "string", pattern: "^KT1[1-9A-HJ-NP-Za-km-z]{33}$" };
const URL_LIST: JsonSchema = { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 512 } };
const SECRET = /(?:private|secret|mnemonic|seed|passphrase)/iu;

const TYPE: JsonSchema = {
  description: "Declared Michelson type: nat | int | mutez | string | bytes | text (bytes read as UTF-8) | bool | unit | address | timestamp, or {pair:[...]}, {record:[[name,type],...]} (right comb in the contract's field order; SmartPy sorts record fields alphabetically), {option:t}, {list:t}, {map:[k,v]}.",
  anyOf: [
    { type: "string", enum: ["nat", "int", "mutez", "string", "bytes", "text", "bool", "unit", "address", "timestamp"] },
    { type: "object", properties: { pair: { type: "array" }, record: { type: "array" }, option: {}, list: {}, map: { type: "array" } } },
  ],
};

const READ: JsonSchema = {
  type: "object", additionalProperties: false, required: ["name", "kind", "contract"],
  properties: {
    name: { type: "string", pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$", description: "Variable the artwork reads as <globalName>.values.<name>." },
    kind: { type: "string", enum: ["big_map", "view"] },
    contract: KT1,
    bigMap: { type: "string", pattern: "^[A-Za-z0-9_]{1,64}$", description: "big_map: storage annotation without % (resolved to its id; key/value types compared with the contract)." },
    bigMapId: { anyOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^(?:0|[1-9][0-9]*)$" }], description: "big_map: id, required for an offline snapshot." },
    key: { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: TYPE, value: {} }, description: "big_map: the key; packed and hashed to its expr... script_expr here, never in the browser." },
    value: TYPE,
    absent: { description: "big_map: the value an absent key reads as (default null)." },
    view: { type: "string", pattern: "^[A-Za-z0-9_.%@]{1,31}$", description: "view: onchain view name, read through run_script_view." },
    input: { type: "object", additionalProperties: false, required: ["type", "value"], properties: { type: TYPE, value: {} } },
    returns: TYPE,
  },
};

function input(value: unknown): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("keel-tezos-live-state-prepare requires an object.");
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${path}[${index}]`)); return; }
    if (node === null || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (SECRET.test(key)) throw new TypeError(`Private signer material is never accepted by keel-tezos-live-state-prepare: ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  };
  walk(value, "input");
  return value as Record<string, any>;
}

export const TEZOS_LIVE_STATE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    descriptor: {
      name: "keel-tezos-live-state-prepare",
      description: "Opt-in live Tezos state for a token's HTML without rewriting token_metadata. Declare reads (a big_map value by key: the Michelson-packed key and its expr... script_expr are computed here; or an onchain view through run_script_view), freeze them into an embedded JSON snapshot at publish/mint time (read now from rpcUrl, or supplied offline with bigMapId), and get a phase:\"data\" fragment that publishes <globalName>.values synchronously, then reads the explicit public RPC list (TzKT optional, big_map reads only) and replaces a value only when the endpoint names the same chain, is not behind the snapshot and the answer decodes to the declared type. Blocked sandboxes keep the snapshot. Declared types are compared with the contract's own storage/view types when read live. No Base64 lane. Marketplace thumbnails and attributes still come from the stored token_metadata. Read-only: no signing, submission or state change.",
      inputSchema: {
        type: "object", additionalProperties: false, required: ["network", "reads", "rpcUrls"],
        properties: {
          network: NETWORK,
          reads: { type: "array", minItems: 1, maxItems: 32, items: READ },
          rpcUrl: { type: "string", minLength: 1, maxLength: 512, description: "Where to read the publish-time snapshot (HTTPS, or loopback HTTP for an Octez mockup/sandbox). Give this or snapshot." },
          snapshot: { type: "object", additionalProperties: false, required: ["level", "values"], properties: { level: { type: "integer", minimum: 0 }, blockHash: { type: "string", pattern: "^B[1-9A-HJ-NP-Za-km-z]{50}$" }, values: { type: "object" } }, description: "Offline snapshot in canonical form (each value round-trips through its declared type)." },
          block: { type: "string", description: "head (default) or a block hash to pin the snapshot." },
          checkTypes: { type: "boolean", default: true },
          rpcUrls: { ...URL_LIST, description: "Public RPC bases the token tries in order at view time (HTTPS). Teia's documented connect-src allowlist covers *.tzkt.io (e.g. https://rpc.tzkt.io/mainnet) and https://mainnet.smartpy.io." },
          tzktUrls: { type: "array", maxItems: 6, items: { type: "string", minLength: 1, maxLength: 512 }, description: "Optional TzKT API bases (https://api.tzkt.io) for big_map reads when every RPC fails." },
          globalName: { type: "string", pattern: "^[A-Za-z_$][A-Za-z0-9_$]*$", default: "KEEL_TEZOS_LIVE" },
          moduleId: { type: "string", maxLength: 120 },
          autoRefresh: { type: "boolean", default: true },
          refreshIntervalMs: { type: "integer", minimum: 0, description: "0 = read once; otherwise at least 30000." },
          timeoutMs: { type: "integer", minimum: 500, maximum: 60_000 },
          maxItems: { type: "integer", minimum: 1, maximum: 65_536 },
          allowLoopbackEndpoints: { type: "boolean", description: "Test harnesses only: embed loopback HTTP endpoints. Never for a published token." },
        },
      },
    },
    run: async (_context, value) => prepareKeelTezosLiveState(input(value) as never),
  },
];

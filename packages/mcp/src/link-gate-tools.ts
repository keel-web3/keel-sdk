import { rm } from "node:fs/promises";
import path from "node:path";
import {
  enforceKeelLinkGate,
  formatKeelLinkGateReport,
  KeelLinkGateRefusal,
  loadKeelLinkGateInfrastructure,
  scanKeelLinkGate,
  snapshotKeelLinkGatePreviews,
  type KeelExplicitExternalPreview,
  type KeelLinkGateIndexEntry,
  type KeelLinkGateReport,
  type KeelLinkGateResource,
} from "@keel/sdk/link-gate";
import { searchKeelIndexes } from "./fray-agent.js";
import type { ToolContext, ToolDefinition } from "./types.js";

/**
 * KEEL link gate for the MCP.
 *
 * Every tool that produces onchain-bound bytes (an upload plan, encoded calls, a wallet request or a Studio stage)
 * is listed in KEEL_LINK_GATED_TOOLS; every other tool is listed in KEEL_LINK_GATE_EXEMPT_TOOLS with the reason it
 * pushes nothing onchain. The test suite fails when a tool is in neither list, so a new route cannot ship unguarded.
 *
 * Gated tools check their inputs before any plan exists (in the SDK: createKeelWalletRequest, createUploadPlan,
 * prepareKeelCreatorInline, stageKeelStudioProject; here: keel-inline-prepare, graph weld, Tezos Hold, chain-plan,
 * contract deployment). withKeelLinkGate adds a result net: payload fields of the result (calldata, hex sources,
 * tokenURIs, Tezos parameters, including a result delivered as a workspace file) are scanned before it is returned.
 */

const MAX_GATE_FILE_BYTES = 64 * 1024 * 1024;

export const KEEL_LINK_GATED_TOOLS: ReadonlySet<string> = new Set([
  // Upload plans and storage writes.
  "upload-plan", "chain-plan", "ethereum-encode", "publish-plan", "keel-graph-weld-prepare", "keel-tezos-hold-resources-prepare",
  // Inline / creator preparation and Studio publication.
  "keel-inline-prepare", "keel-creator-inline-prepare", "keel-studio-stage-project", "keel-studio-draft", "keel-studio-project",
  "fray-stage-project", "keel-creator-collection-prepare", "keel-shell-prepare", "keel-metadata-prepare", "keel-prereveal-prepare",
  "keel-svg-call-plan", "keel-layered-reveal-plan", "keel-layered-direct-image-plan", "keel-token-matrix-prepare", "keel-onchain-data-prepare",
  // Wallet requests and encoded contract calls.
  "wallet-request-prepare", "wallet-link", "module-review-prepare", "keel-contract-controls", "keel-campaign-controls",
  "keel-manager-module-replacement-prepare", "keel-field-schema-prepare", "keel-field-grant-prepare", "keel-field-edit-prepare",
  "keel-arena-match-prepare", "keel-arena-claim-prepare",
  // Tezos operations.
  "keel-tezos-shell-prepare", "keel-tezos-publication-prepare", "keel-tezos-collection-originate-prepare", "keel-tezos-presentation-bind-prepare",
  "keel-tezos-mint-gate-prepare", "keel-tezos-token-selection-prepare", "keel-tezos-custody-presentation-prepare", "keel-tezos-custody-refresh-prepare",
  "keel-tezos-mint-prepare", "keel-tezos-seed-action-prepare", "keel-tezos-harness-tree-prepare", "keel-tezos-automation-prepare",
  "keel-tezos-token-bound-account-prepare", "keel-tezos-recovery-prepare", "keel-tezos-governance-prepare", "keel-tezos-entrypoint-capability-prepare",
  "keel-tezos-token-metadata-prepare", "keel-tezos-live-state-prepare",
]);

const READS = "reads or inspects; produces no onchain bytes";
const LOCAL = "local media, project or editor work; nothing is pushed onchain";
const PLANS = "planning guidance only; no bytes, calls or wallet requests";
const AUDITS = "audits bytes already published or prepared; refuses links itself";

export const KEEL_LINK_GATE_EXEMPT_TOOLS: Readonly<Record<string, string>> = Object.freeze({
  "keel-link-gate": "the gate itself",
  "keel-send-window-plan": "schedules nonces and gas for calls whose bytes the preparing tool already gated; it adds no bytes",
  "keel-media-capabilities": READS, "keel-media-candidate": LOCAL, "keel-media-compare": LOCAL, "keel-studio-media": LOCAL,
  "keel-signature-privacy-readiness": READS,
  "trailer-snapshot": LOCAL, "trailer-clip": LOCAL, "trailer-inspect": READS, "trailer-plan": PLANS, "trailer-capture": LOCAL,
  "trailer-beats": LOCAL, "trailer-render": LOCAL, "trailer-verify": READS, "trailer-stills": LOCAL,
  "keel-tezos-collection-launch-plan": PLANS, "keel-tezos-readback-check": AUDITS, "keel-tezos-standard-route-plan": PLANS,
  "keel-artist-contracts": READS, "keel-network-inspect": READS, "keel-contract-workflow-preflight": PLANS, "keel-engine-catalog": READS,
  "keel-revision-plan": PLANS, "keel-project-decisions": PLANS, "keel-inline-reuse-plan": AUDITS, "keel-inline-publication-check": AUDITS,
  "keel-inline-token-audit": AUDITS, "keel-manager-modules-inspect": READS, "keel-network-discover": READS, "keel-network-check": READS,
  "keel-rpc-check": READS, "keel-project-author": LOCAL, "keel-token-standard-audit": AUDITS,
  "keel-editor-project-list": LOCAL, "keel-editor-project-read": LOCAL, "keel-editor-project-update": LOCAL, "keel-editor-project-open": LOCAL,
  "keel-layered-check": READS, "keel-layered-select": PLANS, "keel-layered-sample": LOCAL, "keel-layered-math": PLANS, "keel-layered-curation": PLANS,
  "keel-svg-create": LOCAL, "keel-svg-inspect": READS,
  "keel-material-guide": READS, "keel-material-distill": LOCAL,
  analyze: READS, "media-optimize": LOCAL, "media-optimize-apply": LOCAL, build: LOCAL, verify: READS, cost: PLANS,
  "module-resolve": READS, "module-lock": LOCAL, "fray-auction-intake": PLANS, "keel-chain-guide": READS, "keel-library-search": READS,
  "keel-endpoint-config": READS, "keel-studio-capabilities": READS, "keel-studio-project-intake": PLANS, "keel-studio-connect": "account connection; no bytes",
  "keel-studio-access": "access-list administration; sends no transaction", "keel-shell-search": READS, "keel-plugins-list": READS,
});

const HEX_KEYS = new Set(["data", "calldata", "sourceHex", "hex", "bytecode", "initCode", "bytes"]);
const TEXT_KEYS = new Set(["tokenURI", "tokenUri", "parameters", "michelson", "artifactUri", "displayUri", "thumbnailUri"]);
const HEX = /^(?:0x)?(?:[0-9a-fA-F]{2})+$/u;

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value.replace(/^0x/iu, ""), "hex"));
}

/** Onchain-bound payload fields of a tool result, addressed by JSON path. */
export function keelLinkGatePayloadResources(value: unknown, root = "result"): KeelLinkGateResource[] {
  const resources: KeelLinkGateResource[] = [];
  const stack: [unknown, string, number][] = [[value, root, 0]];
  let visited = 0;
  while (stack.length > 0 && visited < 100_000) {
    const [current, at, depth] = stack.pop()!;
    visited += 1;
    if (current === null || typeof current !== "object" || depth > 16) continue;
    const entries: [string, unknown][] = Array.isArray(current) ? current.map((item, index) => [String(index), item]) : Object.entries(current);
    for (const [key, item] of entries) {
      const where = Array.isArray(current) ? `${at}[${key}]` : `${at}.${key}`;
      if (typeof item === "string") {
        if (HEX_KEYS.has(key) && item.length > 2 && HEX.test(item) && (key !== "data" || item.startsWith("0x"))) resources.push({ id: where, bytes: hexBytes(item) });
        else if (TEXT_KEYS.has(key) && item.length > 0) resources.push({ id: where, bytes: new TextEncoder().encode(item) });
      } else if (key === "parameters" && item !== null && typeof item === "object") {
        resources.push({ id: where, bytes: new TextEncoder().encode(JSON.stringify(item)) });
        stack.push([item, where, depth + 1]);
      } else stack.push([item, where, depth + 1]);
    }
  }
  return resources;
}

async function deliveredResources(context: ToolContext, result: unknown): Promise<{ resources: KeelLinkGateResource[]; files: string[] }> {
  const resources: KeelLinkGateResource[] = [], files: string[] = [];
  const delivery = result !== null && typeof result === "object" ? (result as { delivery?: { mode?: unknown; path?: unknown; absolutePath?: unknown } }).delivery : undefined;
  if (delivery?.mode === "workspace-file" && typeof delivery.path === "string") {
    const file = await context.workspace.readFile(delivery.path, MAX_GATE_FILE_BYTES);
    files.push(file.path);
    resources.push(...keelLinkGatePayloadResources(JSON.parse(new TextDecoder().decode(file.bytes)) as unknown, delivery.path));
  }
  return { resources, files };
}

/** Wrap every gated tool so its onchain-bound result fields pass the gate before the result is returned. */
export function withKeelLinkGate(definitions: readonly ToolDefinition[]): ToolDefinition[] {
  return definitions.map((definition) => {
    const name = definition.descriptor.name;
    if (!KEEL_LINK_GATED_TOOLS.has(name)) return definition;
    return {
      ...definition,
      async run(context, value) {
        const externalPreviews = snapshotKeelLinkGatePreviews(value && typeof value === "object" ? (value as { externalPreviews?: readonly KeelExplicitExternalPreview[] }).externalPreviews : undefined);
        const result = await definition.run(context, value);
        const delivered = await deliveredResources(context, result);
        try {
          const resources = [...keelLinkGatePayloadResources(result), ...delivered.resources];
          if (resources.length > 0) await enforceKeelLinkGate({ route: name, resources, externalPreviews, workspaceRoot: context.workspace.root });
        } catch (error) {
          // A refused result must not survive as a usable plan file.
          for (const file of delivered.files) if (path.resolve(file).startsWith(path.resolve(context.workspace.root) + path.sep)) await rm(file, { force: true });
          throw error;
        }
        return result;
      },
    };
  });
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("keel-link-gate arguments must be an object.");
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new TypeError(`keel-link-gate arguments.${key} is not supported.`);
  return value as Record<string, unknown>;
}

function indexEntries(search: unknown): KeelLinkGateIndexEntry[] {
  const entries: KeelLinkGateIndexEntry[] = [];
  const result = search as { modules?: readonly { source?: unknown; entry?: Record<string, unknown> }[]; library?: readonly Record<string, unknown>[] } | undefined;
  const text = (value: unknown) => typeof value === "string" && value.length > 0 ? value : undefined;
  const digestOf = (value: Record<string, unknown>) => text(value.digest) ?? text(value.sha256) ?? text((value.integrity as Record<string, unknown> | undefined)?.digest);
  for (const { entry } of result?.modules ?? []) {
    if (!entry) continue;
    const digest = digestOf(entry), moduleId = text(entry.moduleId) ?? text(entry.id) ?? text(entry.name);
    if (!digest || !moduleId) continue;
    entries.push({ moduleId, version: text(entry.version) ?? "unversioned", digest, source: "keel-index",
      ...(typeof entry.byteLength === "number" ? { byteLength: entry.byteLength } : {}),
      ...(typeof entry.chainId === "number" ? { chainId: entry.chainId } : {}),
      names: [text(entry.name), text(entry.library), ...(Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [])].filter((name): name is string => name !== undefined) });
  }
  for (const entry of result?.library ?? []) {
    const digest = digestOf(entry), moduleId = text(entry.assetId) ?? text(entry.name);
    if (!digest || !moduleId) continue;
    entries.push({ moduleId, version: text(entry.graphVersion) ?? text(entry.policyVersion) ?? "unversioned", digest, source: "keel-library-index",
      ...(typeof entry.chainId === "number" ? { chainId: entry.chainId } : {}),
      ...(entry.selection && typeof entry.selection === "object" ? { selection: entry.selection as Record<string, unknown> } : {}),
      names: [text(entry.name), ...(Array.isArray(entry.tags) ? entry.tags.filter((tag): tag is string => typeof tag === "string") : [])].filter((name): name is string => name !== undefined) });
  }
  return entries;
}

async function linkGateTool(context: ToolContext, value: unknown): Promise<unknown> {
  const input = record(value, ["files", "text", "hex", "route", "chainId", "searchIndexes", "studioUrl", "assert"]);
  const resources: KeelLinkGateResource[] = [];
  if (input.files !== undefined) {
    if (!Array.isArray(input.files) || input.files.length > 256) throw new TypeError("files must be a list of at most 256 entries.");
    for (const [index, entry] of input.files.entries()) {
      const file = typeof entry === "string" ? { path: entry } : record(entry, ["path", "id", "mediaType"]);
      if (typeof file.path !== "string") throw new TypeError(`files[${index}].path is required.`);
      const loaded = await context.workspace.readFile(file.path, MAX_GATE_FILE_BYTES);
      resources.push({ id: typeof file.id === "string" ? file.id : file.path, bytes: loaded.bytes, ...(typeof file.mediaType === "string" ? { mediaType: file.mediaType } : {}) });
    }
  }
  if (input.text !== undefined) {
    if (typeof input.text !== "string") throw new TypeError("text must be a string.");
    resources.push({ id: "text", bytes: new TextEncoder().encode(input.text) });
  }
  if (input.hex !== undefined) {
    if (typeof input.hex !== "string" || !HEX.test(input.hex)) throw new TypeError("hex must be even-length hexadecimal bytes.");
    resources.push({ id: "hex", bytes: hexBytes(input.hex) });
  }
  if (resources.length === 0) throw new TypeError("Supply files, text or hex to scan.");
  const route = typeof input.route === "string" && input.route.length > 0 ? input.route.slice(0, 128) : "keel-link-gate";
  const chainId = typeof input.chainId === "number" && Number.isSafeInteger(input.chainId) && input.chainId > 0 ? input.chainId : undefined;
  const base = { route, resources, workspaceRoot: context.workspace.root, ...(chainId === undefined ? {} : { chainId }) };
  let report: KeelLinkGateReport = scanKeelLinkGate(base);
  if (report.status === "blocked") {
    // Same answer as the push routes: KEEL's registered shell/reader reproduced verbatim is not a creator link.
    await loadKeelLinkGateInfrastructure();
    report = scanKeelLinkGate(base);
  }
  let indexSearch: { readonly queries: readonly string[]; readonly status: readonly unknown[] } | undefined;
  if (input.searchIndexes === true) {
    // Query the configured Studio module/library indexes for every library the bytes revealed, then rescan with them.
    const queries = [...new Set(report.suggestions.map((suggestion) => suggestion.library))].slice(0, 8);
    const studioUrl = typeof input.studioUrl === "string" ? input.studioUrl : undefined;
    const results = await Promise.all(queries.map((query) => searchKeelIndexes({ query, workspaceRoot: context.workspace.root, ...(studioUrl === undefined ? {} : { studioUrl }) }).catch((error: unknown) => ({ status: "unavailable", error: error instanceof Error ? error.message : String(error) }))));
    const index = results.flatMap(indexEntries);
    if (index.length > 0) report = scanKeelLinkGate({ ...base, index });
    indexSearch = { queries, status: results.map((result) => (result as { status?: unknown }).status) };
  }
  if (input.assert === true && report.status === "blocked") throw new KeelLinkGateRefusal(report);
  return {
    ...report,
    summary: formatKeelLinkGateReport(report),
    ...(indexSearch === undefined ? {} : { indexSearch }),
    next: report.status === "blocked"
      ? "Remove each listed locator, or drop the embedded library and declare the suggested registered module, then rerun the push tool. Suggestions never substitute bytes."
      : report.suggestions.length > 0
        ? "No locators. The suggested registered modules can replace embedded copies; reuse them by exact digest after selected-chain read-back."
        : "No locators and no embedded registered libraries found.",
  };
}

export const LINK_GATE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-link-gate",
    description: "Scan bytes before any KEEL onchain push. Opens gzip/zlib/deflate/Brotli, percent/URI81, Base64, data: URI and script-escape layers recursively and reports every http(s)://, ipfs://, ar://, web3:// or keel-onchain:// locator with resource, byte offset, decoding path, URL and context (only http://www.w3.org/2000/svg is allowed). Also finds embedded libraries by exact sha256, license banner and CDN/GitHub URL, and suggests the registered KEEL modules to reuse (module id, version, digest, selected-chain availability); searchIndexes=true also queries the configured Studio module/library indexes. Every push tool (upload-plan, publish-plan, wallet-request-prepare, keel-inline-prepare, keel-creator-inline-prepare, Studio staging, Hold uploads) runs this gate itself and refuses on a hit. Read-only: suggestions never substitute bytes; no signing or submission.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        files: { type: "array", maxItems: 256, items: { anyOf: [{ type: "string" }, { type: "object", additionalProperties: false, required: ["path"], properties: { path: { type: "string" }, id: { type: "string" }, mediaType: { type: "string" } } }] } },
        text: { type: "string", description: "Inline text to scan, e.g. a tokenURI." },
        hex: { type: "string", description: "Hex bytes to scan, e.g. calldata." },
        route: { type: "string", description: "Push route the report is for." },
        chainId: { type: "integer", minimum: 1, description: "Selected chain for module availability." },
        searchIndexes: { type: "boolean", default: false, description: "Also query the configured Studio module/library indexes for detected libraries." },
        studioUrl: { type: "string" },
        assert: { type: "boolean", default: false, description: "Refuse (error) instead of reporting when a locator is found." },
      },
    },
  },
  run: linkGateTool,
}];

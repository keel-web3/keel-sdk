import { prepareKeelAuthenticatedCreatorInline, prepareKeelCreatorInline } from "@keel/sdk";
import { mcpRpc } from "./rpc-tools.js";
import { discoverKeelNodeNetworks } from '@keel/sdk/network-node';
import { resolveKeelCreatorTarget } from '@keel/sdk/network-index';
import { planKeelSendWindow } from "@keel/sdk/send-window";
import { resolveKeelTransactionGasPolicy } from "@keel/sdk/transaction-gas-policy";
import type { Address } from "viem";
import type { ToolDefinition } from "./types.js";

export const CREATOR_INLINE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-creator-inline-prepare",
    description: "Prepare modular files for the modern creator factory/renderer route. Automatically selects Brotli when smaller, URI81 carriage for both compressed and uncompressed payloads, COPY-compatible escaping and the gzip/Base64 verification shell. Produces only one upload representation per payload, container commitments, poster carriage and immutable renderer binding arguments. No codec decision is required. Default chain, active creator instance and store come from the public deployment index and workspace configuration. Reuse the exact registered shell: its prefix/suffix are references to verify, never creator-upload substitutes. Writes an unsigned byte plan; chain registration, exact selected-chain readback, full URI/MCP check, call gas, offline browser, wallet approval and mint receipt remain required.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      chainId: { type: "integer", minimum: 1 }, instance: { type: "string", minLength: 1, maxLength: 256 }, store: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      compression: { type: "string", enum: ["auto", "brotli", "none"], default: "auto" }, brotliQuality: { type: "integer", minimum: 0, maximum: 11 },
      payloadStorage: { type: "string", enum: ["compact", "raw"], default: "compact", description: "This dense prepared route requires Compact. Raw remains unchanged through its compatible native reader and is rejected here." },
      viewer: { type: "string", enum: ["keel-verification-shell", "none"], default: "keel-verification-shell", description: "This route requires the registered verification shell. Explicit none remains the creator-owned shell route and is rejected here." },
      resources: { type: "array", minItems: 1, maxItems: 40, items: { type: "object", additionalProperties: false, properties: {
        id: { type: "string", minLength: 1, maxLength: 160 }, path: { type: "string", maxLength: 2048 }, mediaType: { type: "string", maxLength: 128 },
        role: { type: "string", enum: ["entrypoint", "module", "asset"] }, aliases: { type: "array", maxItems: 32, items: { type: "string", minLength: 1, maxLength: 512 } },
        compression: { type: "string", enum: ["auto", "brotli", "none"] },
      }, required: ["id", "path", "mediaType", "role"] } },
      posterPath: { type: "string", maxLength: 2048 }, posterMediaType: { type: "string", maxLength: 128 },
      description: { type: "string", maxLength: 2048 }, out: { type: "string", maxLength: 2048 },
    }, required: ["resources", "posterPath", "posterMediaType", "out"] },
  },
  async run(context, value) {
    const v = value as { chainId?: number; instance?: string; store?: Address; compression?: "auto" | "brotli" | "none"; brotliQuality?: number; payloadStorage?: "compact" | "raw"; viewer?: "keel-verification-shell" | "none"; resources: { id: string; path: string; mediaType: string; role: "entrypoint" | "module" | "asset"; aliases?: string[]; compression?: "auto" | "brotli" | "none" }[]; posterPath: string; posterMediaType: string; description?: string; out: string };
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["chainId", "instance", "store", "compression", "brotliQuality", "payloadStorage", "viewer", "resources", "posterPath", "posterMediaType", "description", "out"].includes(k)) || !Array.isArray(v.resources) || !v.resources.length || v.resources.length > 40 || typeof v.out !== "string" || typeof v.posterPath !== "string" || typeof v.posterMediaType !== "string") throw new TypeError("Supply modular resource files, poster and output plan path.");
    if (v.payloadStorage !== undefined && v.payloadStorage !== "compact") throw new TypeError("Fresh dense COPY requires Compact; preserve Raw through its compatible native reader.");
    if (v.viewer !== undefined && v.viewer !== "keel-verification-shell") throw new TypeError("Fresh dense COPY requires the registered verification shell; preserve viewer=none through its creator-owned shell route.");
    const discovered = await discoverKeelNodeNetworks({ workspace: context.workspace.root, explicit: { ...(v.chainId === undefined ? {} : { chainId: v.chainId }), ...(v.instance === undefined ? {} : { instance: v.instance }) } });
    const target = resolveKeelCreatorTarget(discovered.index, discovered.selection);
    const chainId = target.chainId;
    const store = v.store ?? target.store;
    if (store.toLowerCase() !== target.store.toLowerCase()) throw new TypeError('Supplied store differs from the index-selected creator instance. Select its recorded instance in .keel/config.json.');
    const resources = [];
    let sourceBytes = 0;
    for (const r of v.resources) {
      if (!r || typeof r !== "object" || Object.keys(r).some(k => !["id", "path", "mediaType", "role", "aliases", "compression"].includes(k)) || typeof r.path !== "string") throw new TypeError("Invalid modular resource file.");
      const file = await context.workspace.readFile(r.path, 2_000_000);
      sourceBytes += file.bytes.length;
      if (sourceBytes > 32 * 1024 * 1024) throw new RangeError("Creator resources exceed the preparation source bound.");
      resources.push({ id: r.id, mediaType: r.mediaType, role: r.role, ...(r.aliases ? { aliases: r.aliases } : {}), ...(r.compression === undefined ? {} : { compression: r.compression }), bytes: file.bytes });
    }
    const poster = await context.workspace.readFile(v.posterPath, 2_000_000);
    // Prepare only against the shell the selected chain actually registered: its reader grammar and
    // carriage come from the chain, never a local default. A legacy (Base90) shell, or no URI81
    // creator instance at all, stops here with the reason instead of writing a plan no reader accepts.
    const { pool } = await mcpRpc(context, { chainId });
    const publication = { resources, poster: { bytes: poster.bytes, mediaType: v.posterMediaType }, ...(v.description ? { description: v.description } : {}), ...(v.compression === undefined ? {} : { compression: v.compression }), ...(v.brotliQuality === undefined ? {} : { brotliQuality: v.brotliQuality }) };
    // Without a history-capable RPC the shell cannot be authenticated. The plan is then written for review
    // only, and says so: its first gate is the authentication, because no upload may follow an unread shell.
    let shellAuthentication: "authenticated" | "unavailable" = "authenticated";
    const plan = await prepareKeelAuthenticatedCreatorInline({ pool, index: discovered.index, selection: discovered.selection, publication }).catch(async (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      if (code === "rpc.setup-required") {
        shellAuthentication = "unavailable";
        const local = await prepareKeelCreatorInline({ chainId, store: store as Address, ...publication });
        return { ...local, requiredGates: [`Authenticate the registered shell of ${target.instance} on chain ${chainId} with a history-capable RPC (pnpm rpc:configure), then prepare again. A legacy-carriage (Base90) shell cannot read this plan; do not upload until preparation is authenticated, and never fall back to a web3://, IPFS or Hybrid pointer under 2,000,000 bytes.`, ...local.requiredGates] };
      }
      if (code !== "KEEL_REGISTERED_CARRIAGE_MISMATCH") throw error;
      throw Object.assign(new TypeError(`No fresh Inline route on chain ${chainId}: creator instance ${target.instance} registers a legacy-carriage shell, and fresh preparation requires an authenticated URI81 shell. Nothing was planned or written. Stop and tell the user; do not fall back to a web3://, IPFS or Hybrid pointer (Inline is the default under 2,000,000 bytes). The fix is infrastructure: register a URI81 reader profile and shell for a creator instance on this chain, then select it in .keel/config.json.`), { code: "KEEL_REGISTERED_CARRIAGE_MISMATCH" });
    });
    const object = (o: typeof plan.objects[number]) => ({ id: o.id, objectId: o.objectId, digest: o.digest, byteLength: o.byteLength, mediaType: o.mediaType, sourceHex: "0x" + Buffer.from(o.bytes).toString("hex"), chunks: o.chunks.map(c => ({ id: c.id, sourceHex: "0x" + Buffer.from(c.bytes).toString("hex") })), operations: o.operations, newBytes: o.newBytes, reusedBytes: o.reusedBytes });
    const unsigned = { protocol: plan.protocol, status: plan.status, chainId, store, deployment: target, resources: plan.resources.map(r => ({ id: r.id, sourceIntegrity: r.sourceIntegrity, compression: r.compression, encoding: r.encoding, encryption: r.encryption })), objects: plan.objects.map(object), shell: { revision: plan.shell.revision, prefix: object(plan.shell.prefix), suffix: object(plan.shell.suffix), requiredRegistration: plan.shell.requiredRegistration, bootEncoding: plan.shell.bootEncoding, bootCompression: plan.shell.bootCompression }, request: plan.request, sourceBytes: plan.sourceBytes, newStoredBytes: plan.newStoredBytes, completeTokenURIBytes: null, requiredGates: plan.requiredGates };
    const reviewed = { ...unsigned, payloadStorage: plan.payloadStorage, viewer: plan.viewer, provisionalTokenURIBudget: plan.provisionalTokenURIBudget };
    const file = await context.workspace.writeJson(v.out, JSON.parse(JSON.stringify(reviewed, (_, x) => typeof x === "bigint" ? x.toString() : x)));
    return { protocol: plan.protocol, status: "review-only", chainId, store, deployment: target, plan: file, sourceBytes: plan.sourceBytes, newStoredBytes: plan.newStoredBytes, completeTokenURIBytes: null, shellAuthentication, resources: unsigned.resources, requiredGates: plan.requiredGates, signing: "not-performed", submission: "not-performed" };
  },
}, {
  descriptor: {
    name: "keel-send-window-plan",
    description: "Plan the next window of a long publication (uploads, validations, collection, bind, mint) so its calls are broadcast together instead of one receipt at a time. Simulates the next calls in order with eth_simulateV1 on the selected chain and returns each call's nonce and gas (simulated use × margin, state gas included). Send them in nonce order without waiting, read every receipt, stop on the first failure, then call again with startIndex = nextIndex. Never estimate gas for one call at a time or wait for each receipt in a multi-call publication. Never signs or submits.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      chainId: { type: "integer", minimum: 1 }, from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      callsPath: { type: "string", maxLength: 2048, description: "Workspace JSON: the ordered planned calls, each {to, data, value?}, e.g. a compiled publication's steps." },
      startIndex: { type: "integer", minimum: 0, default: 0 }, maximumCalls: { type: "integer", minimum: 1, maximum: 255, default: 16 },
      marginBps: { type: "integer", minimum: 10000, maximum: 30000, default: 13000 }, out: { type: "string", maxLength: 2048 },
    }, required: ["chainId", "from", "callsPath"] },
  },
  async run(context, value) {
    const v = value as { chainId: number; from: Address; callsPath: string; startIndex?: number; maximumCalls?: number; marginBps?: number; out?: string };
    const file = await context.workspace.readFile(v.callsPath, 64 * 1024 * 1024);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
    const list = Array.isArray(parsed) ? parsed : (parsed as { steps?: unknown })?.steps;
    if (!Array.isArray(list)) throw new TypeError("callsPath must hold an array of planned calls or an object with steps.");
    // Compiled journals nest each call; plain plans list {to, data, value}.
    const calls = list.map(entry => { const call = (entry as { call?: unknown }).call ?? entry; const c = call as { to: Address; data: `0x${string}`; value?: `0x${string}` }; return { to: c.to, data: c.data, ...(c.value ? { value: c.value } : {}) }; });
    const { pool } = await mcpRpc(context, { chainId: v.chainId });
    const block = await pool.request({ method: "eth_getBlockByNumber", params: ["latest", false] }) as { timestamp: string; gasLimit: string };
    const policy = resolveKeelTransactionGasPolicy({ chainId: v.chainId, blockTimestamp: BigInt(block.timestamp), blockGasLimit: BigInt(block.gasLimit) });
    const window = await planKeelSendWindow({ transport: pool, chainId: v.chainId, from: v.from, calls, maximumTransactionGas: policy.maximumTotalGas,
      ...(v.startIndex === undefined ? {} : { startIndex: v.startIndex }), ...(v.maximumCalls === undefined ? {} : { maximumCalls: v.maximumCalls }), ...(v.marginBps === undefined ? {} : { marginBps: v.marginBps }) });
    const written = v.out ? await context.workspace.writeJson(v.out, window) : undefined;
    return { ...window, gasPolicy: policy.profile, ...(written ? { file: written } : {}), remaining: calls.length - window.nextIndex };
  },
}];

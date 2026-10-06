import { prepareKeelCreatorInline, resolveModuleTarget } from "@keel/sdk";
import type { Address } from "viem";
import type { ToolDefinition } from "./types.js";

export const CREATOR_INLINE_TOOL_DEFINITIONS: readonly ToolDefinition[] = [{
  descriptor: {
    name: "keel-creator-inline-prepare",
    description: "Prepare modular files for the modern creator factory/renderer route. Automatically selects Brotli when smaller, Base90 carriage, COPY-compatible escaping and the gzip/Base64 verification shell. Produces only one upload representation per payload, container commitments, poster carriage and immutable renderer binding arguments. No codec decision is required. Default network is Ethereum Sepolia and its recorded creator store. Reuse the exact registered shell: its prefix/suffix are references to verify, never creator-upload substitutes. Writes an unsigned byte plan; chain registration, exact selected-chain readback, full URI/MCP check, call gas, offline browser, wallet approval and mint receipt remain required.",
    inputSchema: { type: "object", additionalProperties: false, properties: {
      chainId: { type: "integer", minimum: 1 }, store: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
      resources: { type: "array", minItems: 1, maxItems: 40, items: { type: "object", additionalProperties: false, properties: {
        id: { type: "string", maxLength: 128 }, path: { type: "string", maxLength: 2048 }, mediaType: { type: "string", maxLength: 128 },
        role: { type: "string", enum: ["entrypoint", "module", "asset"] }, aliases: { type: "array", maxItems: 32, items: { type: "string", maxLength: 128 } },
      }, required: ["id", "path", "mediaType", "role"] } },
      posterPath: { type: "string", maxLength: 2048 }, posterMediaType: { type: "string", maxLength: 128 },
      description: { type: "string", maxLength: 2048 }, out: { type: "string", maxLength: 2048 },
    }, required: ["resources", "posterPath", "posterMediaType", "out"] },
  },
  async run(context, value) {
    const v = value as { chainId?: number; store?: Address; resources: { id: string; path: string; mediaType: string; role: "entrypoint" | "module" | "asset"; aliases?: string[] }[]; posterPath: string; posterMediaType: string; description?: string; out: string };
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["chainId", "store", "resources", "posterPath", "posterMediaType", "description", "out"].includes(k)) || !Array.isArray(v.resources) || !v.resources.length || v.resources.length > 40 || typeof v.out !== "string" || typeof v.posterPath !== "string" || typeof v.posterMediaType !== "string") throw new TypeError("Supply modular resource files, poster and output plan path.");
    const chainId = v.chainId ?? 11155111;
    const store = v.store ?? resolveModuleTarget({ module: "keel-hold", contract: "KeelHold", chainId, instance: "creator-inline-20261005" }).address;
    const resources = [];
    let sourceBytes = 0;
    for (const r of v.resources) {
      if (!r || typeof r !== "object" || Object.keys(r).some(k => !["id", "path", "mediaType", "role", "aliases"].includes(k)) || typeof r.path !== "string") throw new TypeError("Invalid modular resource file.");
      const file = await context.workspace.readFile(r.path, 2_000_000);
      sourceBytes += file.bytes.length;
      if (sourceBytes > 32 * 1024 * 1024) throw new RangeError("Creator resources exceed the preparation source bound.");
      resources.push({ id: r.id, mediaType: r.mediaType, role: r.role, ...(r.aliases ? { aliases: r.aliases } : {}), bytes: file.bytes });
    }
    const poster = await context.workspace.readFile(v.posterPath, 2_000_000);
    const plan = await prepareKeelCreatorInline({ chainId, store: store as Address, resources, poster: { bytes: poster.bytes, mediaType: v.posterMediaType }, ...(v.description ? { description: v.description } : {}) });
    const object = (o: typeof plan.objects[number]) => ({ id: o.id, objectId: o.objectId, digest: o.digest, byteLength: o.byteLength, mediaType: o.mediaType, sourceHex: "0x" + Buffer.from(o.bytes).toString("hex"), chunks: o.chunks.map(c => ({ id: c.id, sourceHex: "0x" + Buffer.from(c.bytes).toString("hex") })), operations: o.operations, newBytes: o.newBytes, reusedBytes: o.reusedBytes });
    const unsigned = { protocol: plan.protocol, status: plan.status, chainId, store, resources: plan.resources.map(r => ({ id: r.id, sourceIntegrity: r.sourceIntegrity, compression: r.compression, encoding: r.encoding, encryption: r.encryption })), objects: plan.objects.map(object), shell: { revision: plan.shell.revision, prefix: object(plan.shell.prefix), suffix: object(plan.shell.suffix), requiredRegistration: plan.shell.requiredRegistration, bootEncoding: plan.shell.bootEncoding, bootCompression: plan.shell.bootCompression }, request: plan.request, sourceBytes: plan.sourceBytes, newStoredBytes: plan.newStoredBytes, completeTokenURIBytes: null, requiredGates: plan.requiredGates };
    const file = await context.workspace.writeJson(v.out, JSON.parse(JSON.stringify(unsigned, (_, x) => typeof x === "bigint" ? x.toString() : x)));
    return { protocol: plan.protocol, status: "review-only", chainId, store, plan: file, sourceBytes: plan.sourceBytes, newStoredBytes: plan.newStoredBytes, completeTokenURIBytes: null, resources: unsigned.resources, requiredGates: plan.requiredGates, signing: "not-performed", submission: "not-performed" };
  },
}];

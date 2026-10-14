import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { createKeelManagedObjectPlan } from "./native-managed.js";
import { buildKeelOnchainContainerBinding } from "./verification-shell.js";
import { buildKeelPreparedDenseCopyShell, prepareKeelDensePayload } from "./prepared-dense-copy.js";
import { prepareKeelDenseCopyFragment, serializeKeelDenseTransportJSON } from "./dense-transport.js";
import { assertKeelInlineImageBytes } from "./collector-policy.js";
import { normalizedAddress, uint } from "./validation.js";
import { resolveKeelPayloadStorage, resolveKeelShell, type KeelPayloadStorageMode } from "@keel/protocol";

const MEDIA = "application/vnd.keel.token-uri-raw-percent-fragment";

/** The registered inline loader consumes completed module exports in descriptor
 * order. Resolve its supported static imports before producing fresh fragments;
 * source inventory and physical payload order remain independent of playback. */
function creatorModulePlaybackOrder(resources: readonly {
  readonly id: string; readonly aliases?: readonly string[]; readonly role: string;
  readonly mediaType: string; readonly bytes: Uint8Array;
}[]) {
  const modules = resources.filter(resource => resource.role === "module" && resource.mediaType === "text/javascript");
  const aliases = new Map(modules.flatMap(resource => [resource.id, ...(resource.aliases ?? [])].map(alias => [alias, resource.id] as const)));
  const reference = (specifier: string) => {
    const withoutDot = specifier.replace(/^\.\//u, "");
    const id = aliases.get(specifier) ?? aliases.get(withoutDot) ?? aliases.get(`./${withoutDot}`) ?? aliases.get(`/content/${withoutDot}`);
    if (id === undefined) throw new TypeError(`Undeclared verified module import ${specifier}.`);
    return id;
  };
  const dependencies = new Map<string, ReadonlySet<string>>();
  for (const resource of modules) {
    const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(resource.bytes);
    const imports = new Set<string>();
    // Match the registered loader's import/re-export grammar rather than
    // claiming general ECMAScript module or cyclic live-binding support.
    for (const pattern of [
      /(^|[;\n])\s*import\s*[^;\n]+?\s*from\s*(["'])([^"']+)\2\s*;?/gu,
      /(^|[;\n])\s*import\s*(["'])([^"']+)\2\s*;?/gu,
      /(^|[;\n}])\s*export\s*\{[^}]*\}\s*from\s*(["'])([^"']+)\2\s*;?/gu,
    ]) for (const match of source.matchAll(pattern)) imports.add(reference(match[3]!));
    dependencies.set(resource.id, imports);
  }
  const active = new Set<string>(), completed = new Set<string>(), ordered: string[] = [];
  const visit = (id: string) => {
    if (completed.has(id)) return;
    if (active.has(id)) throw new TypeError(`Cyclic verified module imports are unsupported: ${id}.`);
    active.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    active.delete(id); completed.add(id); ordered.push(id);
  };
  for (const resource of modules) visit(resource.id);
  return ordered;
}

/** Only committed fragments are a proven lower bound before token context is
 * available. An envelope reserve is an estimate, never the final size gate. */
export function assessKeelCreatorPreparedInlineBudget(preparedFragmentBytes: number) {
  if (!Number.isSafeInteger(preparedFragmentBytes) || preparedFragmentBytes < 0 || preparedFragmentBytes > 2_000_000) throw new RangeError("Prepared Inline fragments alone exceed the complete URI byte limit.");
  return Object.freeze({ status: "provisional-unmeasured" as const, preparedFragmentBytes,
    reservedEnvelopeBytes: 65_536, estimatedCompleteTokenURIBytes: preparedFragmentBytes + 65_536,
    completeTokenURIBytes: null, requiresCompleteRead: true as const });
}
export const KEEL_CREATOR_PREPARED_COPY_ABI = parseAbi([
  "function bindPreparedTokenPresentation(address collection,uint256 tokenId,(uint64 shellRevision,bytes32[] bodyObjectIds,bytes32[] bodyDigests,bytes32 imageObjectId,bytes32 imageDigest,bytes32 containerTableObjectId,bytes32 containerTableDigest,string description) request)",
]);

/** Fresh creator resources remain modular. Encoding and compression are automatic;
 * only these prepared carriers are uploaded, never another compressed binary copy.
 * This is a byte plan: publication still authenticates the registered shell,
 * selected-chain readback, complete URI, call gas and offline browser behavior. */
export async function prepareKeelCreatorInline(input: {
  readonly chainId: number;
  readonly store: Address;
  readonly payloadStorage?: KeelPayloadStorageMode;
  readonly viewer?: "keel-verification-shell" | "none";
  /** Default shared by all resources; per-resource explicit choices win. */
  readonly compression?: "auto" | "brotli" | "none";
  readonly brotliQuality?: number;
  readonly resources: readonly {
    readonly id: string; readonly aliases?: readonly string[];
    readonly role: "entrypoint" | "module" | "asset";
    readonly mediaType: string; readonly bytes: Uint8Array;
    readonly compression?: "auto" | "brotli" | "none";
  }[];
  readonly poster: { readonly bytes: Uint8Array; readonly mediaType: string };
  readonly description?: string;
  readonly shellRevision?: bigint;
  readonly readSlug?: (id: Hex) => Promise<Uint8Array | null>;
}) {
  const payloadStorage = resolveKeelPayloadStorage(input.payloadStorage);
  if (payloadStorage === "raw") throw new TypeError("Raw storage preserves supplied bytes. Fresh dense COPY requires Compact and cannot substitute an encoded carrier for Raw; select its compatible native reader.");
  if (resolveKeelShell(input.viewer) !== "keel-verification-shell") throw new TypeError("This prepared route requires the registered verification shell. Preserve viewer=none through its creator-owned shell route.");
  // Registered shell bytes and descriptor IDs bind the literal address spelling.
  // Use one checksum form for registry addresses and caller-supplied variants.
  const store = getAddress(normalizedAddress(input.store, "0x0000000000000000000000000000000000000000", "store"));
  if (/^0x0{40}$/u.test(store)) throw new TypeError("A deployed store is required.");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("Invalid creator chain.");
  const chainId = input.chainId;
  const compression = input.compression ?? "auto";
  const brotliQuality = input.brotliQuality;
  const readSlug = input.readSlug;
  const posterBytes = Uint8Array.from(input.poster.bytes);
  const posterMediaType = input.poster.mediaType;
  assertKeelInlineImageBytes(posterBytes, posterMediaType);
  if (!input.resources.length || input.resources.length > 40 || input.resources.filter(r => r.role === "entrypoint").length !== 1) throw new TypeError("Creator Inline needs exactly one entrypoint and at most 40 modular resources.");
  const ids = new Set<string>();
  const names = new Map<string, string>();
  const sourceResources: Array<(typeof input.resources)[number]> = [];
  let sourceBytes = 0;
  // Match the actual embedded reader, and validate the whole namespace before
  // compressing any input. Relative import aliases remain creator declarations.
  for (const resource of input.resources) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/@-]{0,159}$/u.test(resource.id) || ids.has(resource.id)) throw new TypeError("Invalid or duplicate creator resource ID.");
    ids.add(resource.id);
    if (resource.aliases && (!Array.isArray(resource.aliases) || resource.aliases.length > 32 || resource.aliases.some(alias => typeof alias !== "string" || !alias.length || alias.length > 512 || /[\u0000-\u001f\u007f]/u.test(alias)))) throw new TypeError("Invalid creator resource aliases.");
    for (const name of [resource.id, ...(resource.aliases ?? [])]) {
      const previous = names.get(name);
      if (previous !== undefined && previous !== resource.id) throw new TypeError(`Ambiguous creator resource alias ${name}.`);
      names.set(name, resource.id);
    }
    if (!(resource.bytes instanceof Uint8Array) || !resource.bytes.length) throw new TypeError("Invalid creator resource bytes.");
    sourceBytes += resource.bytes.length;
    if (sourceBytes > 32 * 1024 * 1024) throw new RangeError("Creator resources exceed the decoded graph byte boundary.");
    sourceResources.push({ ...resource, ...(resource.aliases === undefined ? {} : { aliases: [...resource.aliases] }), bytes: Uint8Array.from(resource.bytes) });
  }
  const playbackModuleOrder = creatorModulePlaybackOrder(sourceResources);
  const description = input.description ?? "";
  if (new TextEncoder().encode(description).length > 2048) throw new RangeError("Creator description exceeds 2048 bytes.");
  const shellRevision = uint(input.shellRevision, 1n, "shellRevision", (1n << 64n) - 1n);
  if (!shellRevision) throw new RangeError("A registered shell revision is required.");
  const shell = await buildKeelPreparedDenseCopyShell({ embeddedContainerDelivery: { chainId, store } });
  const object = async (id: string, bytes: Uint8Array, mediaType = MEDIA) => ({
    id, bytes, ...await createKeelManagedObjectPlan(bytes, { hold: store, mediaType, compression: "none", ...(readSlug ? { readSlug } : {}) }),
  });
  const resources = [];
  const declaredBindings = new Set<string>();
  const carrierBindings = new Map<string, string>();
  for (const resource of sourceResources) {
    if (!["entrypoint", "module", "asset"].includes(resource.role) || typeof resource.mediaType !== "string" || !resource.mediaType || resource.mediaType.length > 128 || !(resource.bytes instanceof Uint8Array) || !resource.bytes.length) throw new TypeError("Invalid creator resource.");
    if (resource.role === "entrypoint" && resource.mediaType !== "text/html") throw new TypeError("The creator entrypoint must be HTML.");
    const source = resource.bytes.slice();
    if (/^(?:text\/|application\/(?:javascript|json))/u.test(resource.mediaType)) new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source);
    const payload = prepareKeelDensePayload(source, { compression: resource.compression ?? compression, ...(brotliQuality === undefined ? {} : { brotliQuality }) });
    const carrier = await object(resource.id + ":payload", payload.preparedBytes);
    const binding = await buildKeelOnchainContainerBinding({ chainId, store, objectId: carrier.objectId, compression: payload.compression, bytes: source, storedBytes: payload.compressedBytes });
    const previousBinding = carrierBindings.get(carrier.objectId);
    if (previousBinding !== undefined && previousBinding !== binding.id) throw new TypeError("One prepared carrier cannot bind conflicting codec or decoded commitments. Preserve the explicit source choices and select a compatible reader before publication.");
    carrierBindings.set(carrier.objectId, binding.id);
    const firstBinding = !declaredBindings.has(binding.id);
    declaredBindings.add(binding.id);
    const pack = { containerId: binding.id, objectId: carrier.objectId, storedIntegrity: payload.storedIntegrity, storedDense: payload.storedDense };
    const descriptor = { id: resource.id, aliases: [...(resource.aliases ?? [resource.id])], role: resource.role, mediaType: resource.mediaType, integrity: payload.decodedIntegrity, onchain: { containerId: binding.id, offset: 0 }, containerBindings: firstBinding ? [binding] : [] };
    resources.push({ id: resource.id, sourceIntegrity: payload.decodedIntegrity, compression: payload.compression, encoding: payload.transportProfile, encryption: "none" as const, payload, carrier, binding, pack, descriptor });
  }
  const objects = [];
  const body = [];
  const descriptorsById = new Map(resources.map(resource => [resource.id, resource.descriptor]));
  let moduleIndex = 0;
  const descriptors = resources.map(resource => resource.descriptor.role === "module" && resource.descriptor.mediaType === "text/javascript"
    ? descriptorsById.get(playbackModuleOrder[moduleIndex++]!)! : resource.descriptor);
  // Multiple logical members can refer to one immutable physical container.
  // Copy its pack once, declare its binding once, and retain every descriptor.
  const physicalResources = [...new Map(resources.map(resource => [resource.binding.id, resource])).values()];
  for (let i = 0; i < physicalResources.length; i++) {
    const resource = physicalResources[i]!;
    const text = serializeKeelDenseTransportJSON(resource.pack);
    const slot = serializeKeelDenseTransportJSON(resource.pack.storedDense).slice(1, -1);
    const at = text.indexOf('"storedDense":"') + '"storedDense":"'.length;
    if (text.slice(at, at + slot.length) !== slot) throw new TypeError("Invalid prepared pack slot.");
    const head = await object(resource.id + ":header", prepareKeelDenseCopyFragment((i ? "," : "") + text.slice(0, at)));
    const tail = await object(resource.id + ":descriptor", prepareKeelDenseCopyFragment(text.slice(at + slot.length) + (i === physicalResources.length - 1 ? new TextDecoder().decode(shell.containerBridge) + "," + descriptors.map(serializeKeelDenseTransportJSON).join(",") : "")));
    objects.push(head, resource.carrier, tail);
    body.push(head, resource.carrier, tail);
  }
  const rows = physicalResources.map(r => ({ byteLength: BigInt(r.payload.compressedBytes.length), digest: r.payload.storedIntegrity.digest, objectId: r.carrier.objectId, containerId: r.binding.id }));
  const tableBytes = Uint8Array.from(Buffer.from(encodeAbiParameters([{ type: "tuple[]", components: [{ name: "byteLength", type: "uint256" }, { name: "digest", type: "bytes32" }, { name: "objectId", type: "bytes32" }, { name: "containerId", type: "bytes32" }] }], [rows]).slice(2), "hex"));
  const table = await object("container-table", tableBytes, "application/vnd.keel.inline-prepared-container-table");
  const posterURI = `data:${posterMediaType};base64,${Buffer.from(posterBytes).toString("base64")}`;
  const image = await object("poster-carriage", new TextEncoder().encode(posterURI));
  objects.push(table, image);
  const prefix = await object("registered-shell-prefix", prepareKeelDenseCopyFragment(new TextDecoder().decode(shell.prefix)));
  const suffix = await object("registered-shell-suffix", prepareKeelDenseCopyFragment(new TextDecoder().decode(shell.suffix)));
  const preparedBodyBytes = new Uint8Array(body.reduce((n, p) => n + p.bytes.length, 0));
  let offset = 0; for (const p of body) { preparedBodyBytes.set(p.bytes, offset); offset += p.bytes.length; }
  const preparedBytes = prefix.bytes.length + preparedBodyBytes.length + suffix.bytes.length + image.bytes.length;
  // The final metadata/context can only be measured once collection/token bindings exist.
  const provisionalTokenURIBudget = assessKeelCreatorPreparedInlineBudget(preparedBytes);
  return {
    protocol: "keel.creator-prepared-inline@1" as const, chainId, store, payloadStorage, viewer: "keel-verification-shell" as const,
    status: "review-only" as const, signing: "not-performed" as const, submission: "not-performed" as const,
    shell: { revision: shellRevision, prefix, suffix, requiredRegistration: "keel.shell.inline-raw-percent-protection@1" as const, bootEncoding: shell.shellBootEncoding, bootCompression: shell.shellBootCompression },
    resources, objects, preparedBodyBytes, table, image, posterURI, playbackModuleOrder,
    optimization: {
      sourceByteIdentity: "verified-exact" as const,
      physicalPayloadCount: physicalResources.length, sharedLogicalResourceCount: resources.length - physicalResources.length,
      compressedPayloadBytes: physicalResources.reduce((n, r) => n + r.payload.compressedBytes.length, 0),
      preparedPayloadBytes: physicalResources.reduce((n, r) => n + r.carrier.bytes.length, 0),
      preparedPayloadBytesSaved: physicalResources.some(r => r.payload.optimization.preparedBytesSaved === null) ? null
        : physicalResources.reduce((n, r) => n + (r.payload.optimization.preparedBytesSaved ?? 0), 0),
      shellPreparedBytes: prefix.bytes.length + suffix.bytes.length,
      decoderDelivery: "included-in-prepared-shell" as const,
      requiredCodecs: [...new Set(resources.map(r => r.compression).filter(c => c !== "none"))],
      offchainPayloads: [] as readonly string[],
    },
    request: { shellRevision, bodyObjectIds: body.map(o => o.objectId), bodyDigests: body.map(o => o.digest), imageObjectId: image.objectId, imageDigest: image.digest, containerTableObjectId: table.objectId, containerTableDigest: table.digest, description },
    sourceBytes: resources.reduce((n, r) => n + r.sourceIntegrity.byteLength, 0),
    newStoredBytes: objects.reduce((n, o) => n + o.newBytes, 0), reusedStoredBytes: objects.reduce((n, o) => n + o.reusedBytes, 0),
    completeTokenURIBytes: null, preparedBytesBeforeLiveEnvelope: preparedBytes, provisionalTokenURIBudget,
    requiredGates: ["registered-shell-and-reader", "selected-chain-object-readback", "keel-inline-publication-check", "complete-tokenURI-and-call-gas", "offline-browser", "wallet-approval", "mint-receipt-and-tokenURI-readback"] as const,
  };
}

/** Review-only binding call. It cannot sign or replace the publication gates. */
export function buildKeelCreatorPreparedCopyBindingCall(input: {
  readonly renderer: Address; readonly collection: Address; readonly tokenId: bigint;
  readonly plan: Awaited<ReturnType<typeof prepareKeelCreatorInline>>;
}) {
  const renderer = normalizedAddress(input.renderer, "0x0000000000000000000000000000000000000000", "renderer"), collection = normalizedAddress(input.collection, "0x0000000000000000000000000000000000000000", "collection");
  const tokenId = uint(input.tokenId, 0n, "tokenId");
  if (/^0x0{40}$/u.test(renderer) || /^0x0{40}$/u.test(collection)) throw new TypeError("Deployed creator contracts are required.");
  if (!tokenId || input.plan.protocol !== "keel.creator-prepared-inline@1") throw new TypeError("Invalid creator prepared binding.");
  return { to: renderer, data: encodeFunctionData({ abi: KEEL_CREATOR_PREPARED_COPY_ABI, functionName: "bindPreparedTokenPresentation", args: [collection, tokenId, input.plan.request] }), value: 0n, chainId: input.plan.chainId, status: "review-only" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

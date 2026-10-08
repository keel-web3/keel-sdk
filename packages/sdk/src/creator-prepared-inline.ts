import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { createKeelManagedObjectPlan } from "./native-managed.js";
import { buildKeelOnchainContainerBinding } from "./verification-shell.js";
import { buildKeelPreparedDenseCopyShell, prepareKeelDensePayload } from "./prepared-dense-copy.js";
import { prepareKeelDenseCopyFragment, serializeKeelDenseTransportJSON } from "./dense-transport.js";
import { assertKeelInlineImageBytes } from "./collector-policy.js";
import { normalizedAddress, uint } from "./validation.js";

const MEDIA = "application/vnd.keel.token-uri-raw-percent-fragment";
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
  // Registered shell bytes and descriptor IDs bind the literal address spelling.
  // Use one checksum form for registry addresses and caller-supplied variants.
  const store = getAddress(normalizedAddress(input.store, "0x0000000000000000000000000000000000000000", "store"));
  if (/^0x0{40}$/u.test(store)) throw new TypeError("A deployed store is required.");
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new TypeError("Invalid creator chain.");
  if (!input.resources.length || input.resources.length > 40 || input.resources.filter(r => r.role === "entrypoint").length !== 1) throw new TypeError("Creator Inline needs exactly one entrypoint and at most 40 modular resources.");
  const ids = new Set<string>();
  const description = input.description ?? "";
  if (new TextEncoder().encode(description).length > 2048) throw new RangeError("Creator description exceeds 2048 bytes.");
  const shellRevision = uint(input.shellRevision, 1n, "shellRevision", (1n << 64n) - 1n);
  if (!shellRevision) throw new RangeError("A registered shell revision is required.");
  const shell = await buildKeelPreparedDenseCopyShell({ embeddedContainerDelivery: { chainId: input.chainId, store } });
  const object = async (id: string, bytes: Uint8Array, mediaType = MEDIA) => ({
    id, bytes, ...await createKeelManagedObjectPlan(bytes, { hold: store, mediaType, compression: "none", ...(input.readSlug ? { readSlug: input.readSlug } : {}) }),
  });
  const resources = [];
  for (const resource of input.resources) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(resource.id) || ids.has(resource.id)) throw new TypeError("Invalid or duplicate creator resource ID.");
    ids.add(resource.id);
    if (resource.aliases && (!Array.isArray(resource.aliases) || resource.aliases.length > 32 || resource.aliases.some(a => typeof a !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(a)))) throw new TypeError("Invalid creator resource aliases.");
    if (!["entrypoint", "module", "asset"].includes(resource.role) || typeof resource.mediaType !== "string" || !resource.mediaType || resource.mediaType.length > 128 || !(resource.bytes instanceof Uint8Array) || !resource.bytes.length) throw new TypeError("Invalid creator resource.");
    if (resource.role === "entrypoint" && resource.mediaType !== "text/html") throw new TypeError("The creator entrypoint must be HTML.");
    const source = resource.bytes.slice();
    const payload = prepareKeelDensePayload(source, { compression: resource.compression ?? input.compression ?? "auto", ...(input.brotliQuality === undefined ? {} : { brotliQuality: input.brotliQuality }) });
    const carrier = await object(resource.id + ":payload", payload.preparedBytes);
    const binding = await buildKeelOnchainContainerBinding({ chainId: input.chainId, store, objectId: carrier.objectId, compression: payload.compression, bytes: source, storedBytes: payload.compressedBytes });
    const pack = { containerId: binding.id, objectId: carrier.objectId, storedIntegrity: payload.storedIntegrity, storedDense: payload.storedDense };
    const descriptor = { id: resource.id, aliases: [...(resource.aliases ?? [resource.id])], role: resource.role, mediaType: resource.mediaType, integrity: payload.decodedIntegrity, onchain: { containerId: binding.id, offset: 0 }, containerBindings: [binding] };
    resources.push({ id: resource.id, sourceIntegrity: payload.decodedIntegrity, compression: payload.compression, encoding: payload.transportProfile, encryption: "none" as const, payload, carrier, binding, pack, descriptor });
  }
  const objects = [];
  const body = [];
  const descriptors = resources.map(r => r.descriptor);
  for (let i = 0; i < resources.length; i++) {
    const resource = resources[i]!;
    const text = serializeKeelDenseTransportJSON(resource.pack);
    const slot = serializeKeelDenseTransportJSON(resource.pack.storedDense).slice(1, -1);
    const at = text.indexOf('"storedDense":"') + '"storedDense":"'.length;
    if (text.slice(at, at + slot.length) !== slot) throw new TypeError("Invalid prepared pack slot.");
    const head = await object(resource.id + ":header", prepareKeelDenseCopyFragment((i ? "," : "") + text.slice(0, at)));
    const tail = await object(resource.id + ":descriptor", prepareKeelDenseCopyFragment(text.slice(at + slot.length) + (i === resources.length - 1 ? new TextDecoder().decode(shell.containerBridge) + "," + descriptors.map(serializeKeelDenseTransportJSON).join(",") : "")));
    objects.push(head, resource.carrier, tail);
    body.push(head, resource.carrier, tail);
  }
  const rows = resources.map(r => ({ byteLength: BigInt(r.payload.compressedBytes.length), digest: r.payload.storedIntegrity.digest, objectId: r.carrier.objectId, containerId: r.binding.id }));
  const tableBytes = Uint8Array.from(Buffer.from(encodeAbiParameters([{ type: "tuple[]", components: [{ name: "byteLength", type: "uint256" }, { name: "digest", type: "bytes32" }, { name: "objectId", type: "bytes32" }, { name: "containerId", type: "bytes32" }] }], [rows]).slice(2), "hex"));
  const table = await object("container-table", tableBytes, "application/vnd.keel.inline-prepared-container-table");
  const posterBytes = input.poster.bytes.slice();
  assertKeelInlineImageBytes(posterBytes, input.poster.mediaType);
  const posterURI = `data:${input.poster.mediaType};base64,${Buffer.from(posterBytes).toString("base64")}`;
  const image = await object("poster-carriage", new TextEncoder().encode(posterURI));
  objects.push(table, image);
  const prefix = await object("registered-shell-prefix", prepareKeelDenseCopyFragment(new TextDecoder().decode(shell.prefix)));
  const suffix = await object("registered-shell-suffix", prepareKeelDenseCopyFragment(new TextDecoder().decode(shell.suffix)));
  const preparedBodyBytes = new Uint8Array(body.reduce((n, p) => n + p.bytes.length, 0));
  let offset = 0; for (const p of body) { preparedBodyBytes.set(p.bytes, offset); offset += p.bytes.length; }
  const preparedBytes = prefix.bytes.length + preparedBodyBytes.length + suffix.bytes.length + image.bytes.length;
  // The final metadata/context can only be measured once collection/token bindings exist.
  if (preparedBytes + 65536 > 2_000_000) throw new RangeError("Creator prepared Inline exceeds the complete URI reserve.");
  return {
    protocol: "keel.creator-prepared-inline@1" as const, chainId: input.chainId, store,
    status: "review-only" as const, signing: "not-performed" as const, submission: "not-performed" as const,
    shell: { revision: shellRevision, prefix, suffix, requiredRegistration: "keel.shell.inline-raw-percent-protection@1" as const, bootEncoding: shell.shellBootEncoding, bootCompression: shell.shellBootCompression },
    resources, objects, preparedBodyBytes, table, image, posterURI,
    optimization: {
      sourceByteIdentity: "verified-exact" as const,
      compressedPayloadBytes: resources.reduce((n, r) => n + r.payload.compressedBytes.length, 0),
      preparedPayloadBytes: resources.reduce((n, r) => n + r.carrier.bytes.length, 0),
      preparedPayloadBytesSaved: resources.some(r => r.payload.optimization.preparedBytesSaved === null) ? null
        : resources.reduce((n, r) => n + (r.payload.optimization.preparedBytesSaved ?? 0), 0),
      shellPreparedBytes: prefix.bytes.length + suffix.bytes.length,
      decoderDelivery: "included-in-prepared-shell" as const,
      requiredCodecs: [...new Set(resources.map(r => r.compression).filter(c => c !== "none"))],
      offchainPayloads: [] as readonly string[],
    },
    request: { shellRevision, bodyObjectIds: body.map(o => o.objectId), bodyDigests: body.map(o => o.digest), imageObjectId: image.objectId, imageDigest: image.digest, containerTableObjectId: table.objectId, containerTableDigest: table.digest, description },
    sourceBytes: resources.reduce((n, r) => n + r.sourceIntegrity.byteLength, 0),
    newStoredBytes: objects.reduce((n, o) => n + o.newBytes, 0), reusedStoredBytes: objects.reduce((n, o) => n + o.reusedBytes, 0),
    completeTokenURIBytes: null, preparedBytesBeforeLiveEnvelope: preparedBytes,
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

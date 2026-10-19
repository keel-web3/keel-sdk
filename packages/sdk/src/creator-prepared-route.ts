import { resolveKeelPreparationReadBounds } from "@keel/protocol";
import { createHash } from "node:crypto";
import { parseAbi, encodeFunctionData, decodeFunctionResult, hexToBytes, keccak256, stringToHex, type Abi, type Hex } from "viem";
import { keelHoldAbi } from "./abi.js";
import { verifyKeelIndexedCreator } from "./network-verification.js";
import { parseKeelNetworkIndex, resolveKeelCreatorTarget, type KeelNetworkIndex, type KeelNetworkSelection } from "./network-index.js";
import type { KeelRpcPool } from "./rpc.js";
import { prepareKeelCreatorInline, assessKeelCreatorPreparedInlineBudget } from "./creator-prepared-inline.js";
import { createKeelManagedObjectPlan } from "./native-managed.js";
import { decodeKeelPreparedDenseCopyFragment } from "./dense-transport.js";
import { inspectKeelInlinePayloadCarriage, inspectKeelPreparedDenseCopyDocument } from "./inline-transport-audit.js";
import { readKeelPreparedInlineSources } from "./prepared-inline-sources.js";

const ABI = parseAbi([
  "function preparedCopyBuilder() view returns(address)",
  "function preparedCopyShellRegistry() view returns(address)",
  "function preparedCopyValidationRegistry() view returns(address)",
  "function artifactRegistry() view returns(address)",
  "function manager() view returns(address)",
  "function keelHold() view returns(address)",
  "function platformAuthority() view returns(address)",
  "function rawFragmentValidationRegistry() view returns(address)",
  "function RAW_INLINE_PROTECTION_SHELL_ID() view returns(bytes32)",
  "function creatorManagedShell(bytes32) view returns(bool)",
  "function shellRevision(bytes32,uint64) view returns(bytes32 prefix,bytes32 suffix,uint8 mode,bool exists,bytes32 metadataObjectId)",
  "function builder() view returns(address)",
  "function verifiedDigest(bytes32) view returns(bytes32)",
  "function requireRegistration(bytes32) view",
]);
const HOLD = parseAbi(keelHoldAbi);
const MEDIA = "application/vnd.keel.token-uri-raw-percent-fragment";
const hash = (bytes: Uint8Array): Hex => `0x${createHash("sha256").update(bytes).digest("hex")}`;
const same = (left: unknown, right: string) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();

/** Fresh publication only. Consumes exact registered shell bytes rather than
 * assuming the installed SDK recreates an immutable older shell revision.
 * This function performs reads and local preparation; it emits no payment call. */
export async function prepareKeelAuthenticatedCreatorInline(input: {
  readonly pool: KeelRpcPool;
  readonly index: KeelNetworkIndex;
  readonly selection?: KeelNetworkSelection;
  readonly publication: Omit<Parameters<typeof prepareKeelCreatorInline>[0], "chainId" | "store" | "readSlug" | "readerGrammar">;
}) {
  // Infrastructure authentication must not suspend before the caller's source,
  // policy and selected deployment become one immutable preparation request.
  const pool = input.pool;
  const index = parseKeelNetworkIndex(input.index);
  const selection = { ...(input.selection ?? {}) };
  const declared = input.publication;
  const readBounds = resolveKeelPreparationReadBounds(declared);
  if (Object.hasOwn(declared, "readerGrammar")) throw new TypeError("Authenticated preparation derives reader grammar from the registered profile; callers cannot override it.");
  if (!Array.isArray(declared.resources) || !declared.resources.length || declared.resources.length > 40) throw new RangeError("Creator publication supports 1..40 modular resources.");
  let sourceBytes = 0;
  for (const resource of declared.resources) {
    if (!(resource.bytes instanceof Uint8Array) || !resource.bytes.length
      || resource.aliases !== undefined && (!Array.isArray(resource.aliases) || resource.aliases.length > 32)) throw new TypeError("Invalid creator publication source or aliases.");
    sourceBytes += resource.bytes.length;
    if (sourceBytes > 32 * 1024 * 1024) throw new RangeError("Creator publication exceeds its decoded source byte bound.");
  }
  if (!(declared.poster.bytes instanceof Uint8Array) || !declared.poster.bytes.length || declared.poster.bytes.length > 2_000_000) throw new RangeError("Creator publication poster exceeds the complete Inline byte bound.");
  const publication = { ...declared, ...(readBounds.nonstandardReadPolicy === undefined ? {} : { nonstandardReadPolicy: readBounds.nonstandardReadPolicy }), ...(readBounds.preparationReadBudget === undefined ? {} : { preparationReadBudget: readBounds.preparationReadBudget }),
    resources: declared.resources.map(resource => ({ ...resource, ...(resource.aliases === undefined ? {} : { aliases: [...resource.aliases] }), bytes: Uint8Array.from(resource.bytes) })),
    poster: { ...declared.poster, bytes: Uint8Array.from(declared.poster.bytes) },
  };
  const target = resolveKeelCreatorTarget(index, selection);
  const infrastructure = await verifyKeelIndexedCreator(pool, index, selection);
  const block = `0x${BigInt(infrastructure.blockNumber).toString(16)}`;
  const read = async (address: Hex, name: string, args: readonly unknown[] = [], abi: Abi = ABI): Promise<unknown> => {
    const data = await pool.request({ method: "eth_call", params: [{ to: address, data: encodeFunctionData({ abi, functionName: name, args }) }, block] });
    if (typeof data !== "string" || !/^0x[0-9a-f]*$/iu.test(data)) throw new Error(`Invalid ${name} read.`);
    return decodeFunctionResult({ abi, functionName: name, data: data as Hex });
  };
  const indexed = (name: string): Hex => {
    const matches = target.deployments.filter(entry => entry.contract === name);
    if (matches.length !== 1) throw new TypeError(`Prepared publication requires one authenticated ${name}.`);
    return matches[0]!.address;
  };
  const builder = indexed("KeelRawTokenURIBuilder"), registry = indexed("KeelRawInlineShellRegistry"), validation = indexed("KeelRawFragmentValidationRegistry"), artifacts = indexed("KeelArtifactRegistry");
  for (const [address, name, expected] of [
    [target.renderer, "preparedCopyBuilder", builder], [target.renderer, "preparedCopyShellRegistry", registry],
    [target.renderer, "preparedCopyValidationRegistry", validation], [target.renderer, "artifactRegistry", artifacts],
    [registry, "keelHold", target.store], [artifacts, "keelHold", target.store], [registry, "rawFragmentValidationRegistry", validation],
    [validation, "builder", builder],
  ] as const) if (!same(await read(address, name), expected)) throw new TypeError(`Prepared publication ${name} binding mismatch.`);
  const manager = await read(artifacts, "manager");
  if (typeof manager !== "string" || !same(await read(registry, "platformAuthority"), manager)) throw new TypeError("Prepared shell authority mismatch.");
  const shellId = await read(registry, "RAW_INLINE_PROTECTION_SHELL_ID");
  if (typeof shellId !== "string" || !/^0x[0-9a-f]{64}$/iu.test(shellId)
    || shellId !== keccak256(stringToHex("keel.shell.inline-raw-percent-protection@1"))
    || await read(registry, "creatorManagedShell", [shellId]) !== false) throw new TypeError("Prepared creator shell is not registered.");
  const revision = publication.shellRevision ?? 1n;
  const shell = await read(registry, "shellRevision", [shellId, revision]) as readonly unknown[];
  if (!Array.isArray(shell) || shell[2] !== 3 || shell[3] !== true) throw new TypeError("Prepared creator shell revision is unavailable or incompatible.");
  // The registry authority commits the profile; index receipts and runtime reads
  // bind its reader identity. A local SDK default must not reinterpret old code.
  if (typeof shell[4] !== "string" || !/^0x[0-9a-f]{64}$/iu.test(shell[4])) throw new TypeError("Registered shell metadata identity is missing.");
  const metadataRecord = await read(target.store, "getObject", [shell[4]], HOLD) as Record<string, unknown>;
  if (!metadataRecord || metadataRecord.exists !== true || metadataRecord.compression !== 0
    || metadataRecord.mediaType !== "application/json" || typeof metadataRecord.digest !== "string"
    || typeof metadataRecord.byteLength !== "bigint" || metadataRecord.byteLength < 1n || metadataRecord.byteLength > 65536n
    || metadataRecord.byteLength !== metadataRecord.storedByteLength) throw new TypeError("Registered reader profile metadata is unavailable or incompatible.");
  await read(builder, "requireRegistration", [shell[4]]);
  const metadataRaw = await read(target.store, "haulObject", [shell[4]], HOLD);
  if (typeof metadataRaw !== "string" || metadataRaw.length > 2 + 65536 * 2
    || !/^0x(?:[0-9a-f]{2})*$/iu.test(metadataRaw)) throw new TypeError("Invalid registered reader profile bytes.");
  const metadataBytes = hexToBytes(metadataRaw as Hex);
  if (BigInt(metadataBytes.length) !== metadataRecord.byteLength || !same(hash(metadataBytes), metadataRecord.digest)) throw new TypeError("Registered reader profile digest mismatch.");
  const metadata: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new TypeError("Invalid registered reader profile metadata.");
  const manifest = metadata as Record<string, unknown>;
  if (["base90-v1", "base91-v1"].includes(String(manifest.transport)) || ["base90", "base91"].includes(String(manifest.binaryPayloadCarriage))) {
    throw Object.assign(new TypeError("Registered shell uses a legacy carriage; fresh preparation requires an authenticated URI81 shell. Reuse existing bindings unchanged."), { code: "KEEL_REGISTERED_CARRIAGE_MISMATCH" });
  }
  const profile = manifest.readerProfile as Record<string, unknown> | undefined;
  const readerCodeHash = infrastructure.contracts.find(contract => same(contract.address, builder))?.runtimeCodeHash;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)
    || profile.protocol !== "keel.prepared-reader-profile@1" || profile.chainId !== target.chainId
    || !same(profile.store, target.store) || !same(profile.reader, builder)
    || typeof readerCodeHash !== "string" || !same(profile.runtimeCodeHash, readerCodeHash)
    || profile.transportProfile !== "uri81-block-v1"
    || !["uri81", "legacy-strict"].includes(String(profile.readerGrammar))) throw new TypeError("Registered reader grammar is missing or does not match its authenticated deployment.");
  const readerGrammar = profile.readerGrammar as "uri81" | "legacy-strict";
  // This immutable selected-chain reader was independently probed with all three
  // excluded literals. Metadata cannot relabel it as the wider URI81 grammar.
  if (readerCodeHash.toLowerCase() === "0x4751a10e95fce5b2c195cf16dac31b4b3bbce11bc8b8671feb6ef11c2977ae44"
    && readerGrammar !== "legacy-strict") throw new TypeError("Registered reader grammar conflicts with its immutable bytecode.");
  const registered = async (objectId: unknown, id: string) => {
    if (typeof objectId !== "string" || !/^0x[0-9a-f]{64}$/iu.test(objectId)) throw new TypeError("Invalid registered shell object.");
    const record = await read(target.store, "getObject", [objectId], HOLD) as Record<string, unknown>;
    if (!record || record.exists !== true || record.compression !== 0 || record.mediaType !== MEDIA
      || typeof record.digest !== "string" || typeof record.byteLength !== "bigint" || record.byteLength > 2_000_000n
      || record.byteLength !== record.storedByteLength || !same(await read(validation, "verifiedDigest", [objectId]), record.digest)) throw new TypeError("Registered prepared shell object is not verified.");
    await read(builder, "requireRegistration", [objectId]);
    const raw = await read(target.store, "haulObject", [objectId], HOLD);
    if (typeof raw !== "string" || !/^0x(?:[0-9a-f]{2})*$/iu.test(raw)) throw new TypeError("Invalid prepared shell readback.");
    const bytes = hexToBytes(raw as Hex);
    if (BigInt(bytes.length) !== record.byteLength || !same(hash(bytes), record.digest)) throw new TypeError("Prepared shell readback differs from its commitment.");
    const object = { id, bytes, ...await createKeelManagedObjectPlan(bytes, { hold: target.store, mediaType: MEDIA, compression: "none" }) };
    if (!same(object.objectId, objectId)) throw new TypeError("Registered shell uses an unsupported object representation.");
    return object;
  };
  const [prefix, suffix] = await Promise.all([registered(shell[0], "registered-shell-prefix"), registered(shell[1], "registered-shell-suffix")]);
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(decodeKeelPreparedDenseCopyFragment(bytes));
  const plan = await prepareKeelCreatorInline({ ...publication, chainId: target.chainId, store: target.store, readerGrammar });
  const html = decode(prefix.bytes) + decode(plan.preparedBodyBytes) + decode(suffix.bytes);
  // Authenticate the registered decoder before quoting or publishing new payloads.
  const registeredShell = inspectKeelPreparedDenseCopyDocument(html);
  if (registeredShell?.transportProfile !== "uri81-block-v1") throw Object.assign(new TypeError("Registered shell uses a legacy carriage; fresh preparation requires an authenticated URI81 shell. Reuse existing bindings unchanged; do not replace the shell or upload engines."), { code: "KEEL_REGISTERED_CARRIAGE_MISMATCH" });
  const audit = inspectKeelInlinePayloadCarriage(new TextEncoder().encode(html));
  if (audit.preparedDenseCopy?.transportProfile !== "uri81-block-v1" || audit.payloadCount !== plan.optimization.physicalPayloadCount) throw new TypeError("Registered shell does not match the prepared payload profile.");
  const sources = await readKeelPreparedInlineSources({ htmlBytes: new TextEncoder().encode(html), chainId: target.chainId, store: plan.store, tableDigest: plan.table.digest });
  const originalSources = new Map(plan.resources.map(resource => [resource.id, resource]));
  if (sources.resources.length !== plan.resources.length || sources.resources.some(resource => {
    const original = originalSources.get(resource.id);
    return original === undefined || resource.integrity.digest !== original.sourceIntegrity.digest || resource.integrity.byteLength !== original.sourceIntegrity.byteLength
      || resource.role !== original.descriptor.role || resource.mediaType !== original.descriptor.mediaType || JSON.stringify(resource.aliases) !== JSON.stringify(original.descriptor.aliases);
  })) throw new TypeError("Registered prepared source replay differs from the original resources.");
  const preparedBytesBeforeLiveEnvelope = plan.preparedBytesBeforeLiveEnvelope - plan.shell.prefix.bytes.length - plan.shell.suffix.bytes.length + prefix.bytes.length + suffix.bytes.length;
  const provisionalTokenURIBudget = assessKeelCreatorPreparedInlineBudget(preparedBytesBeforeLiveEnvelope, publication.nonstandardReadPolicy, publication.preparationReadBudget);
  const canonicalBlock = await pool.request({ method: "eth_getBlockByNumber", params: [block, false] }) as { hash?: unknown };
  if (!same(canonicalBlock?.hash, String(infrastructure.blockHash))) throw new TypeError("Prepared route block was reorganized during authentication.");
  return { ...plan, shell: { ...plan.shell, prefix, suffix }, preparedBytesBeforeLiveEnvelope, provisionalTokenURIBudget,
    optimization: { ...plan.optimization, shellPreparedBytes: prefix.bytes.length + suffix.bytes.length },
    route: { factory: target.factory, renderer: target.renderer, builder, registry, validation, instance: target.instance,
      shellId, shellRevision: revision, readerGrammar, readerProfileMetadataObjectId: shell[4], readerProfileMetadataDigest: metadataRecord.digest,
      authenticatedBlockNumber: infrastructure.blockNumber, authenticatedBlockHash: infrastructure.blockHash },
    // Authentication of deployment and sources does not simulate a new token.
    prepaymentSimulation: "required" as const, infrastructure };
}

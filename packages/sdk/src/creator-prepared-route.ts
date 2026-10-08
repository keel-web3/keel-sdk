import { createHash } from "node:crypto";
import { parseAbi, encodeFunctionData, decodeFunctionResult, hexToBytes, keccak256, stringToHex, type Abi, type Hex } from "viem";
import { keelHoldAbi } from "./abi.js";
import { verifyKeelIndexedCreator } from "./network-verification.js";
import { resolveKeelCreatorTarget, type KeelNetworkIndex, type KeelNetworkSelection } from "./network-index.js";
import type { KeelRpcPool } from "./rpc.js";
import { prepareKeelCreatorInline } from "./creator-prepared-inline.js";
import { createKeelManagedObjectPlan } from "./native-managed.js";
import { decodeKeelPreparedDenseCopyFragment } from "./dense-transport.js";
import { inspectKeelInlinePayloadCarriage } from "./inline-transport-audit.js";

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
  readonly publication: Omit<Parameters<typeof prepareKeelCreatorInline>[0], "chainId" | "store" | "readSlug">;
}) {
  const selection = input.selection ?? {};
  const target = resolveKeelCreatorTarget(input.index, selection);
  const infrastructure = await verifyKeelIndexedCreator(input.pool, input.index, selection);
  const block = `0x${BigInt(infrastructure.blockNumber).toString(16)}`;
  const read = async (address: Hex, name: string, args: readonly unknown[] = [], abi: Abi = ABI): Promise<unknown> => {
    const data = await input.pool.request({ method: "eth_call", params: [{ to: address, data: encodeFunctionData({ abi, functionName: name, args }) }, block] });
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
  const revision = input.publication.shellRevision ?? 1n;
  const shell = await read(registry, "shellRevision", [shellId, revision]) as readonly unknown[];
  if (!Array.isArray(shell) || shell[2] !== 3 || shell[3] !== true) throw new TypeError("Prepared creator shell revision is unavailable or incompatible.");
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
  const plan = await prepareKeelCreatorInline({ ...input.publication, chainId: target.chainId, store: target.store });
  const decode = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: true }).decode(decodeKeelPreparedDenseCopyFragment(bytes));
  const html = decode(prefix.bytes) + decode(plan.preparedBodyBytes) + decode(suffix.bytes);
  const audit = inspectKeelInlinePayloadCarriage(new TextEncoder().encode(html));
  if (audit.preparedDenseCopy?.transportProfile !== "base90-v1" || audit.payloadCount !== plan.resources.length) throw new TypeError("Registered shell does not match the prepared payload profile.");
  const preparedBytesBeforeLiveEnvelope = plan.preparedBytesBeforeLiveEnvelope - plan.shell.prefix.bytes.length - plan.shell.suffix.bytes.length + prefix.bytes.length + suffix.bytes.length;
  if (preparedBytesBeforeLiveEnvelope + 65_536 > 2_000_000) throw new RangeError("Registered prepared Inline exceeds the complete URI reserve.");
  const canonicalBlock = await input.pool.request({ method: "eth_getBlockByNumber", params: [block, false] }) as { hash?: unknown };
  if (!same(canonicalBlock?.hash, String(infrastructure.blockHash))) throw new TypeError("Prepared route block was reorganized during authentication.");
  return { ...plan, shell: { ...plan.shell, prefix, suffix }, preparedBytesBeforeLiveEnvelope,
    optimization: { ...plan.optimization, shellPreparedBytes: prefix.bytes.length + suffix.bytes.length },
    route: { factory: target.factory, renderer: target.renderer, builder, registry, validation, instance: target.instance,
      shellId, shellRevision: revision, authenticatedBlockNumber: infrastructure.blockNumber, authenticatedBlockHash: infrastructure.blockHash },
    // Authentication of deployment and sources does not simulate a new token.
    prepaymentSimulation: "required" as const, infrastructure };
}

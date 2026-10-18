import { keccak256, sha256 } from "viem";

import { KEEL_TEZOS_MODULES } from "./tezos-modules.generated.js";
import type { TezosMichelineValue, TezosOperationDetailsBase, TezosTransactionOperation } from "./tezos-publication.js";

/**
 * The KEEL Tezos creator-collection route.
 *
 * Every function here prepares review-only Tezos operation details for the
 * contracts in keel-contracts `src/modules/<module>/tezos`: KeelHoldOnchFS,
 * KeelIndex, KeelCollectionFA2, KeelPresentationStateRegistry,
 * KeelCreatorProfileRegistry and OneMintController. Nothing signs, submits,
 * forges, or invents a KT1 address. Every entrypoint is checked against the
 * generated source catalogue before it is emitted, every network is an exact
 * `Net...` chain identity, and any secret-bearing field is refused.
 */

export const KEEL_TEZOS_COLLECTION_ROUTE = "keel.tezos.collection-route@1" as const;
export const KEEL_TEZOS_BURN_ADDRESS = "tz1burnburnburnburnburnburnburjAYjjX" as const;
/** Tezos `max_operation_data_length`; one wallet operation group may not exceed it. */
export const KEEL_TEZOS_MAX_OPERATION_BYTES = 32_768 as const;
/** Planning budget per operation group, below the protocol limit for signature and branch bytes. */
export const KEEL_TEZOS_OPERATION_GROUP_BUDGET = 30_000 as const;
export const KEEL_TEZOS_DEFAULT_CHUNK_BYTES = 16_384 as const;
export const KEEL_TEZOS_OPEN_SUPPLY = "18446744073709551615" as const;

/** The deployable classes this route originates or calls, and the catalogue module that owns each. */
export const KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS = Object.freeze({
  hold: { module: "keel-hold", contract: "KeelHoldOnchFS", source: "keel_hold_onchfs.py" },
  index: { module: "keel-hold", contract: "KeelIndex", source: "keel_index.py" },
  collection: { module: "keel-die", contract: "KeelCollectionFA2", source: "keel_collection_fa2.py" },
  presentation: { module: "keel-presentation", contract: "KeelPresentationStateRegistry", source: "keel_presentation_state.py" },
  creatorProfile: { module: "keel-creator-identity", contract: "KeelCreatorProfileRegistry", source: "keel_creator_profile.py" },
  oneMint: { module: "keel-mint-access", contract: "OneMintController", source: "keel_mint_gate.py" },
  mintGate: { module: "keel-mint-access", contract: "KeelMintGate", source: "keel_mint_gate.py" },
} as const);

export type KeelTezosRouteContract = keyof typeof KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS;

/** MCP tools that carry a Tezos KEEL collection from origination to read-back, in route order. */
export const KEEL_TEZOS_COLLECTION_ROUTE_TOOLS = Object.freeze([
  "keel-tezos-collection-launch-plan",
  "keel-tezos-collection-originate-prepare",
  "keel-tezos-hold-resources-prepare",
  "keel-tezos-presentation-bind-prepare",
  "keel-tezos-mint-gate-prepare",
  "keel-tezos-mint-prepare",
  "keel-tezos-token-metadata-prepare",
  "keel-tezos-readback-check",
] as const);

/** SDK functions behind those tools. */
export const KEEL_TEZOS_COLLECTION_ROUTE_SDK = Object.freeze([
  "planKeelTezosCollectionLaunch",
  "prepareKeelTezosCollectionOriginations",
  "prepareKeelTezosHoldResources",
  "prepareKeelTezosPresentationBinding",
  "prepareKeelTezosMintGate",
  "prepareKeelTezosMintGateAction",
  "prepareKeelTezosMint",
  "prepareKeelTezosTokenMetadata",
  "checkKeelTezosCollectionPublication",
] as const);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const PREFIXES = { KT1: [2, 90, 121], tz1: [6, 161, 159], tz2: [6, 161, 161], tz3: [6, 161, 164], tz4: [6, 161, 166], Net: [87, 82, 0] } as const;
const SECRET_KEY = /(?:private|secret|mnemonic|seed|passphrase)/iu;
const HEX = /^(?:0x)?[0-9a-fA-F]*$/u;

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesOf(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/u, "");
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  return out;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256Hex(value: Uint8Array): string {
  return sha256(value).slice(2);
}

function keccakHex(value: Uint8Array): string {
  return keccak256(value).slice(2);
}

function base58Decode(value: string, prefix: keyof typeof PREFIXES, size: number, label: string): Uint8Array {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 64) throw new TypeError(`${label} must be a Tezos ${prefix} value.`);
  let n = 0n;
  for (const character of value) {
    const digit = ALPHABET.indexOf(character);
    if (digit < 0) throw new TypeError(`${label} has an invalid Base58 character.`);
    n = n * 58n + BigInt(digit);
  }
  const raw: number[] = [];
  while (n > 0n) { raw.unshift(Number(n & 255n)); n >>= 8n; }
  for (const character of value) { if (character !== "1") break; raw.unshift(0); }
  const decoded = Uint8Array.from(raw);
  const head = PREFIXES[prefix];
  if (decoded.length !== head.length + size + 4 || head.some((byte, index) => decoded[index] !== byte)) throw new TypeError(`${label} has an invalid Base58 prefix or length.`);
  const body = decoded.slice(0, -4);
  const checksum = sha256(sha256(body, "bytes"), "bytes").slice(0, 4);
  if (hexOf(decoded.slice(-4)) !== hexOf(checksum)) throw new TypeError(`${label} has an invalid Base58 checksum.`);
  return decoded.slice(head.length, -4);
}

/** Validate an exact `Net...` chain identity and return its 4 chain-id bytes. */
export function keelTezosChainIdBytes(network: string): Uint8Array {
  return base58Decode(network, "Net", 4, "network");
}

function assertNetwork(network: unknown): string {
  if (typeof network !== "string") throw new TypeError("network must be an exact Tezos Net... chain identity.");
  keelTezosChainIdBytes(network);
  return network;
}

/** The 22-byte binary address encoding used by Michelson PACK. */
export function keelTezosAddressBytes(address: string, label = "address"): Uint8Array {
  if (typeof address !== "string") throw new TypeError(`${label} must be a Tezos address.`);
  const prefix = address.slice(0, 3) as keyof typeof PREFIXES;
  if (prefix === "KT1") return concatBytes([Uint8Array.of(1), base58Decode(address, "KT1", 20, label), Uint8Array.of(0)]);
  if (prefix === "tz1" || prefix === "tz2" || prefix === "tz3" || prefix === "tz4") {
    return concatBytes([Uint8Array.of(0, Number(prefix.slice(2)) - 1), base58Decode(address, prefix, 20, label)]);
  }
  throw new TypeError(`${label} must be a tz1-4 or KT1 Tezos address.`);
}

function assertAddress(value: unknown, label: string): string {
  keelTezosAddressBytes(value as string, label);
  return value as string;
}

function assertContract(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.startsWith("KT1")) throw new TypeError(`${label} must be an originated KT1 contract.`);
  return assertAddress(value, label);
}

function assertNoSecrets(value: unknown, path = "input"): void {
  if (Array.isArray(value)) { value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`)); return; }
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new TypeError(`Secret-bearing field is not accepted: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
  assertNoSecrets(value, label);
  return value as Record<string, unknown>;
}

function natural(value: unknown, label: string, { positive = false, max }: { readonly positive?: boolean; readonly max?: bigint } = {}): bigint {
  let result: bigint;
  if (typeof value === "bigint") result = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) result = BigInt(value);
  else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) result = BigInt(value);
  else throw new TypeError(`${label} must be a nonnegative integer.`);
  if (result < 0n || (positive && result === 0n)) throw new TypeError(`${label} must be ${positive ? "positive" : "nonnegative"}.`);
  if (max !== undefined && result > max) throw new TypeError(`${label} exceeds ${max.toString()}.`);
  return result;
}

function hexValue(value: unknown, label: string, length?: number): string {
  if (typeof value !== "string" || !HEX.test(value)) throw new TypeError(`${label} must be hex.`);
  const clean = value.replace(/^0x/u, "").toLowerCase();
  if (clean.length % 2 !== 0 || (length !== undefined && clean.length !== length * 2)) throw new TypeError(`${label} must be ${length === undefined ? "even-length" : `${length}-byte`} hex.`);
  return clean;
}

function digest32(value: unknown, label: string): string {
  const clean = hexValue(value, label, 32);
  if (/^0+$/u.test(clean)) throw new TypeError(`${label} must be a nonzero 32-byte digest.`);
  return clean;
}

const CATALOG_SURFACE = new Map<string, { readonly entrypoints: ReadonlySet<string>; readonly views: ReadonlySet<string> }>();
for (const module of KEEL_TEZOS_MODULES) {
  for (const contract of module.deployable) {
    CATALOG_SURFACE.set(contract, {
      entrypoints: new Set(module.entrypoints?.[contract] ?? []),
      views: new Set(module.views?.[contract] ?? []),
    });
  }
}

/** Fail closed unless the generated source catalogue lists this entrypoint on the deployable class. */
export function assertKeelTezosEntrypoint(contract: string, entrypoint: string): void {
  const surface = CATALOG_SURFACE.get(contract);
  if (surface === undefined) throw new Error(`${contract} is not a catalogued Tezos KEEL deployable.`);
  if (!surface.entrypoints.has(entrypoint)) throw new Error(`${contract} has no catalogued entrypoint ${entrypoint}.`);
}

/** Fail closed unless the generated source catalogue lists this onchain view on the deployable class. */
export function assertKeelTezosView(contract: string, view: string): void {
  const surface = CATALOG_SURFACE.get(contract);
  if (surface === undefined) throw new Error(`${contract} is not a catalogued Tezos KEEL deployable.`);
  if (!surface.views.has(view)) throw new Error(`${contract} has no catalogued view ${view}.`);
}

// ---------------------------------------------------------------------------
// Micheline
// ---------------------------------------------------------------------------

const mBytes = (hex: string): TezosMichelineValue => ({ bytes: hex });
const mInt = (value: bigint | number | string): TezosMichelineValue => ({ int: String(value) });
const mString = (value: string): TezosMichelineValue => ({ string: value });
const mBool = (value: boolean): TezosMichelineValue => ({ prim: value ? "True" : "False" });
const mNone: TezosMichelineValue = { prim: "None" };
const mSome = (value: TezosMichelineValue): TezosMichelineValue => ({ prim: "Some", args: [value] });
const mUnit: TezosMichelineValue = { prim: "Unit" };
const mText = (value: string): TezosMichelineValue => mBytes(hexOf(utf8(value)));

function mPair(values: readonly TezosMichelineValue[]): TezosMichelineValue {
  if (values.length < 2) throw new TypeError("A Micheline pair needs at least two values.");
  let result = values[values.length - 1] as TezosMichelineValue;
  for (let index = values.length - 2; index >= 0; index -= 1) result = { prim: "Pair", args: [values[index] as TezosMichelineValue, result] };
  return result;
}

function mStringMap(entries: readonly (readonly [string, TezosMichelineValue])[]): TezosMichelineValue {
  // Michelson map literals must be strictly ordered by key; compare UTF-8 bytes as Michelson does.
  const sorted = [...entries].sort(([left], [right]) => compareBytes(utf8(left), utf8(right)));
  for (let index = 1; index < sorted.length; index += 1) if ((sorted[index - 1] as readonly [string, TezosMichelineValue])[0] === (sorted[index] as readonly [string, TezosMichelineValue])[0]) throw new TypeError("Duplicate Tezos map key.");
  return sorted.map(([key, value]) => ({ prim: "Elt", args: [mString(key), value] }));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) if (left[index] !== right[index]) return (left[index] as number) - (right[index] as number);
  return left.length - right.length;
}

function call(contract: KeelTezosRouteContract, destination: string, entrypoint: string, value: TezosMichelineValue, amountMutez: bigint = 0n): TezosTransactionOperation {
  assertKeelTezosEntrypoint(KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS[contract].contract, entrypoint);
  return { kind: "transaction", amount: amountMutez.toString(), destination, parameters: { entrypoint, value } };
}

/** Rough forged size of a prepared operation: parameter payload plus manager-operation overhead. */
export function estimateKeelTezosOperationBytes(operation: TezosOperationDetailsBase | TezosTransactionOperation): number {
  const payload = (value: unknown): number => {
    if (Array.isArray(value)) return 5 + value.reduce((total: number, item) => total + payload(item), 0);
    if (value === null || typeof value !== "object") return 0;
    const node = value as Record<string, unknown>;
    if (typeof node.bytes === "string") return 5 + node.bytes.length / 2;
    if (typeof node.string === "string") return 5 + utf8(node.string).length;
    if (typeof node.int === "string") return 1 + Math.ceil(node.int.length / 2);
    const annots = Array.isArray(node.annots) ? 4 + node.annots.reduce((total: number, annot) => total + utf8(String(annot)).length + 1, 0) : 0;
    return 2 + annots + (Array.isArray(node.args) ? node.args.reduce((total: number, item) => total + payload(item), 0) : 0);
  };
  const body = operation.kind === "origination" ? payload(operation.script?.code) + payload(operation.script?.storage) : payload(operation.parameters?.value) + 40;
  return 120 + body;
}

/** Split operations into wallet batches that each fit the Tezos operation-size limit. */
export function groupKeelTezosOperations<T extends TezosOperationDetailsBase | TezosTransactionOperation>(operations: readonly T[], budget: number = KEEL_TEZOS_OPERATION_GROUP_BUDGET): readonly (readonly T[])[] {
  const groups: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const operation of operations) {
    const bytes = estimateKeelTezosOperationBytes(operation);
    if (bytes > budget) throw new RangeError(`A single Tezos operation (${bytes} estimated bytes) exceeds the ${budget}-byte group budget.`);
    if (current.length > 0 && size + bytes > budget) { groups.push(current); current = []; size = 0; }
    current.push(operation);
    size += bytes;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

// ---------------------------------------------------------------------------
// PACK helpers (only the shapes the route contracts hash)
// ---------------------------------------------------------------------------

function zarith(value: bigint): Uint8Array {
  if (value < 0n) throw new TypeError("PACK helper only encodes naturals.");
  const out: number[] = [];
  let rest = value >> 6n;
  out.push(Number(value & 0x3fn) | (rest > 0n ? 0x80 : 0));
  while (rest > 0n) {
    const next = rest >> 7n;
    out.push(Number(rest & 0x7fn) | (next > 0n ? 0x80 : 0));
    rest = next;
  }
  return Uint8Array.from(out);
}

const packNat = (value: bigint): Uint8Array => concatBytes([Uint8Array.of(0), zarith(value)]);
function packBytes(value: Uint8Array): Uint8Array {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, value.length);
  return concatBytes([Uint8Array.of(0x0a), length, value]);
}
const packPair = (left: Uint8Array, right: Uint8Array): Uint8Array => concatBytes([Uint8Array.of(0x07, 0x07), left, right]);
const packed = (body: Uint8Array): Uint8Array => concatBytes([Uint8Array.of(0x05), body]);

/** The KeelHoldOnchFS object descriptor that `weld_object` commits to. Digests are 32-byte hex; labels are UTF-8. */
export interface KeelTezosOnchfsObjectDescriptor {
  readonly fileCid: string;
  readonly manifestSha256: string;
  readonly storedSha256: string;
  readonly storedByteLength: number | string | bigint;
  readonly decodedSha256: string;
  readonly decodedByteLength: number | string | bigint;
  readonly mediaType: string;
  readonly compression: string;
}

/**
 * KeelHoldOnchFS object id: sha256(PACK(object_descriptor)), matching the `predict_object_id`
 * view. Every descriptor field is committed (the manifest through its digest), as EVM KeelHold
 * hashes its descriptor, so an object id can never be bound to other bytes.
 */
export function keelTezosOnchfsObjectId(descriptor: KeelTezosOnchfsObjectDescriptor): string {
  const fields = [
    packBytes(bytesOf(digest32(descriptor.fileCid, "fileCid"))),
    packBytes(bytesOf(digest32(descriptor.manifestSha256, "manifestSha256"))),
    packBytes(bytesOf(digest32(descriptor.storedSha256, "storedSha256"))),
    packNat(natural(descriptor.storedByteLength, "storedByteLength")),
    packBytes(bytesOf(digest32(descriptor.decodedSha256, "decodedSha256"))),
    packNat(natural(descriptor.decodedByteLength, "decodedByteLength")),
    packBytes(utf8(descriptor.mediaType)),
    packBytes(utf8(descriptor.compression)),
  ];
  let body = fields[fields.length - 1] as Uint8Array;
  for (let index = fields.length - 2; index >= 0; index -= 1) body = packPair(fields[index] as Uint8Array, body);
  return sha256Hex(packed(body));
}

/** OneMint merkle leaf: sha256(sha256(PACK(Pair account allowance))), matching the `merkle_leaf` view. */
export function keelTezosOneMintMerkleLeaf(account: string, allowance: bigint | number | string): string {
  const body = packed(packPair(packBytes(keelTezosAddressBytes(account, "allowlist account")), packNat(natural(allowance, "allowance", { positive: true }))));
  return sha256Hex(sha256(body, "bytes"));
}

export interface KeelTezosAllowlistEntry { readonly account: string; readonly allowance: number | string | bigint; }
export interface KeelTezosAllowlistTree {
  readonly root: string;
  readonly leaves: readonly { readonly account: string; readonly allowance: string; readonly leaf: string; readonly proof: readonly string[] }[];
}

/** Sorted-pair SHA-256 tree that `merkle_mint` verifies. An odd node is carried up unchanged. */
export function buildKeelTezosAllowlistTree(entries: readonly KeelTezosAllowlistEntry[]): KeelTezosAllowlistTree {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError("An allowlist needs at least one entry.");
  if (entries.length > 65_536) throw new RangeError("An allowlist is limited to 65,536 entries per stage.");
  const seen = new Set<string>();
  const leaves = entries.map((entry, index) => {
    const account = assertAddress(entry.account, `allowlist[${index}].account`);
    if (seen.has(account)) throw new TypeError(`Duplicate allowlist account ${account}.`);
    seen.add(account);
    const allowance = natural(entry.allowance, `allowlist[${index}].allowance`, { positive: true });
    return { account, allowance: allowance.toString(), leaf: keelTezosOneMintMerkleLeaf(account, allowance) };
  });
  const hashPair = (left: string, right: string): string => {
    const [low, high] = left < right ? [left, right] : [right, left];
    return sha256Hex(concatBytes([bytesOf(low), bytesOf(high)]));
  };
  const proofs = leaves.map(() => [] as string[]);
  let level = leaves.map((leaf, index) => ({ hash: leaf.leaf, members: [index] }));
  while (level.length > 1) {
    const next: { hash: string; members: number[] }[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index] as { hash: string; members: number[] };
      const right = level[index + 1];
      if (right === undefined) { next.push(left); continue; }
      for (const member of left.members) (proofs[member] as string[]).push(right.hash);
      for (const member of right.members) (proofs[member] as string[]).push(left.hash);
      next.push({ hash: hashPair(left.hash, right.hash), members: [...left.members, ...right.members] });
    }
    level = next;
  }
  const root = (level[0] as { hash: string }).hash;
  return { root, leaves: leaves.map((leaf, index) => ({ ...leaf, proof: proofs[index] as string[] })) };
}

/** `create_profile` policy id helper: sha256(PACK(Pair creator salt)) used by the presentation registry. */
export function keelTezosPresentationPolicyId(creator: string, salt: string): string {
  return sha256Hex(packed(packPair(packBytes(keelTezosAddressBytes(creator, "creator")), packBytes(bytesOf(hexValue(salt, "salt"))))));
}

/**
 * Predict the OneMint drop id: sha256(PACK(record(chain_id, controller, creator, domain, metadata_digest, nonce, target))).
 * The prediction is a convenience for staging follow-up calls; the selected chain's
 * `latest_drop_for_target` view must agree before those calls are signed.
 */
export function predictKeelTezosOneMintDropId(input: { readonly network: string; readonly oneMint: string; readonly creator: string; readonly target: string; readonly metadataDigest: string; readonly creatorNonce?: number | string | bigint }): string {
  const chain = keelTezosChainIdBytes(input.network);
  const domain = utf8("keel.tezos.one-mint.v2");
  const fields = [
    packBytes(chain),
    packBytes(keelTezosAddressBytes(input.oneMint, "oneMint")),
    packBytes(keelTezosAddressBytes(input.creator, "creator")),
    packBytes(domain),
    packBytes(bytesOf(digest32(input.metadataDigest, "metadataDigest"))),
    packNat(natural(input.creatorNonce ?? 0, "creatorNonce")),
    packBytes(keelTezosAddressBytes(input.target, "target")),
  ];
  let body = fields[fields.length - 1] as Uint8Array;
  for (let index = fields.length - 2; index >= 0; index -= 1) body = packPair(fields[index] as Uint8Array, body);
  return sha256Hex(packed(body));
}

// ---------------------------------------------------------------------------
// Origination storage (equal to the SmartPy-compiled initial storage)
// ---------------------------------------------------------------------------

const EMPTY: TezosMichelineValue = [];

export interface KeelTezosContractMetadata {
  readonly name: string;
  readonly description?: string;
  readonly version?: string;
  readonly homepage?: string;
  readonly authors?: readonly string[];
  readonly license?: { readonly name: string; readonly details?: string };
  readonly interfaces?: readonly string[];
}

/** TZIP-16 contract metadata JSON stored at origination; administrators may replace it until `freeze_contract_metadata`. */
export function buildKeelTezosContractMetadata(metadata: KeelTezosContractMetadata | undefined): string {
  if (metadata === undefined) return JSON.stringify({ name: "KEEL", interfaces: ["TZIP-012", "TZIP-016"] });
  assertObject(metadata, "collectionMetadata");
  if (typeof metadata.name !== "string" || metadata.name.length === 0 || metadata.name.length > 256) throw new TypeError("collectionMetadata.name must be 1-256 characters.");
  const document: Record<string, unknown> = { name: metadata.name };
  if (metadata.description !== undefined) document.description = String(metadata.description);
  if (metadata.version !== undefined) document.version = String(metadata.version);
  if (metadata.license !== undefined) document.license = metadata.license;
  if (metadata.authors !== undefined) document.authors = [...metadata.authors].map(String);
  if (metadata.homepage !== undefined) document.homepage = String(metadata.homepage);
  document.interfaces = [...new Set(["TZIP-012", "TZIP-016", "TZIP-021", ...(metadata.interfaces ?? [])])];
  const json = JSON.stringify(document);
  if (utf8(json).length > 8_192) throw new RangeError("TZIP-16 contract metadata is limited to 8,192 bytes in this route.");
  return json;
}

/**
 * Initial KeelCollectionFA2 storage, field for field with the compiled record
 * (`keel_collection_fa2.py` over the shared `keel_fa2_nft.py` KeelNFTLedger).
 * Holder metadata editing is off unless the creator explicitly enables it:
 * administrators rewrite and freeze token metadata; holders edit or freeze their
 * own token only while the creator allows it.
 * An optional default royalty is what `royalty_info` reports to the KEEL market.
 */
/** A collection-wide default royalty, as ERC-2981 `_setDefaultRoyalty`: basis points of the sale price. */
export interface KeelTezosRoyalty {
  readonly receiver: string;
  /** 1..10000 basis points. */
  readonly bps: number;
}

function royaltyConfig(value: KeelTezosRoyalty, label: string): { receiver: string; bps: number } {
  assertObject(value, label);
  const receiver = assertAddress(value.receiver, `${label}.receiver`);
  if (receiver === KEEL_TEZOS_BURN_ADDRESS) throw new TypeError(`${label}.receiver cannot be the burn address.`);
  if (!Number.isSafeInteger(value.bps) || value.bps < 1 || value.bps > 10_000) throw new RangeError(`${label}.bps must be 1..10000.`);
  return { receiver, bps: value.bps };
}

function royaltyValue(value: KeelTezosRoyalty | null | undefined, label: string): TezosMichelineValue {
  if (value === undefined || value === null) return mNone;
  const config = royaltyConfig(value, label);
  return mSome(mPair([mString(config.receiver), mInt(config.bps)]));
}

/**
 * The TZIP-21 `royalties` token-metadata field for the same royalty, so Tezos
 * marketplaces that read token metadata and the KEEL market that reads
 * `royalty_info` see one split.
 */
export function keelTezosRoyaltyTokenMetadata(value: KeelTezosRoyalty): { readonly decimals: 4; readonly shares: Readonly<Record<string, number>> } {
  const config = royaltyConfig(value, "royalty");
  return { decimals: 4, shares: { [config.receiver]: config.bps } };
}

export function buildKeelTezosCollectionFA2Storage(input: { readonly administrator: string; readonly keelIndex: string; readonly maxSupply: number | string | bigint; readonly contractMetadataJson?: string; readonly holderMetadataEditing?: boolean; readonly defaultRoyalty?: KeelTezosRoyalty }): TezosMichelineValue {
  const administrator = assertAddress(input.administrator, "administrator");
  if (administrator === KEEL_TEZOS_BURN_ADDRESS) throw new TypeError("administrator cannot be the burn address.");
  const keelIndex = assertAddress(input.keelIndex, "keelIndex");
  const maxSupply = natural(input.maxSupply, "maxSupply", { positive: true });
  if (input.holderMetadataEditing !== undefined && typeof input.holderMetadataEditing !== "boolean") throw new TypeError("holderMetadataEditing must be a boolean.");
  const metadataJson = input.contractMetadataJson ?? JSON.stringify({ name: "KEEL", interfaces: ["TZIP-012", "TZIP-016"] });
  return mPair([
    mInt(1), // administrator_count
    [mString(administrator)], // administrators
    mBool(false), // contract_metadata_frozen
    mPair([mBytes(""), mBytes(""), mBytes(""), mBool(false)]), // default_presentation
    royaltyValue(input.defaultRoyalty, "defaultRoyalty"), // default_royalty
    mString(keelIndex), // keel_index
    EMPTY, // ledger
    mInt(maxSupply), // max_supply
    mStringMap([["", mText("tezos-storage:content")], ["content", mText(metadataJson)]]), // metadata
    EMPTY, // minters
    mInt(1), // next_token_id
    EMPTY, // operators
    EMPTY, // owner_balances
    mBool(false), // presentation_frozen
    EMPTY, // reserved_capacity
    EMPTY, // token_jsons
    EMPTY, // token_metadata
    EMPTY, // token_metadata_frozen
    mBool(input.holderMetadataEditing === true), // token_owner_can_edit
    EMPTY, // token_owners
    mInt(0), // total_reserved_capacity
  ]);
}

export function buildKeelTezosHoldOnchFSStorage(input: { readonly administrator: string }): TezosMichelineValue {
  return mPair([mString(assertAddress(input.administrator, "administrator")), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, mNone]);
}

export function buildKeelTezosIndexStorage(input: { readonly administrator: string }): TezosMichelineValue {
  const administrator = assertAddress(input.administrator, "administrator");
  if (administrator === KEEL_TEZOS_BURN_ADDRESS) throw new TypeError("administrator cannot be the burn address.");
  return mPair([mString(administrator), EMPTY, [mString(administrator)], EMPTY, EMPTY]);
}

export function buildKeelTezosPresentationStateStorage(): TezosMichelineValue {
  return mPair([EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
}

export function buildKeelTezosCreatorProfileStorage(input: { readonly manager: string }): TezosMichelineValue {
  return mPair([EMPTY, mString(assertContract(input.manager, "manager")), EMPTY, EMPTY]);
}

export function buildKeelTezosOneMintStorage(input: { readonly creatorProfileRegistry: string }): TezosMichelineValue {
  const registry = assertContract(input.creatorProfileRegistry, "creatorProfileRegistry");
  return mPair([EMPTY, EMPTY, mString(registry), EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY]);
}

export function buildKeelTezosMintGateStorage(input: { readonly administrator: string; readonly creatorProfileRegistry: string; readonly platformSigner?: string; readonly platformFeeRecipient?: string; readonly platformFeeBps?: number }): TezosMichelineValue {
  const administrator = assertAddress(input.administrator, "administrator");
  const registry = assertContract(input.creatorProfileRegistry, "creatorProfileRegistry");
  const fee = natural(input.platformFeeBps ?? 0, "platformFeeBps", { max: 2_000n });
  if (fee !== 0n && (input.platformSigner === undefined || input.platformFeeRecipient === undefined)) throw new TypeError("A platform fee requires a platform signer and fee recipient.");
  if (input.platformSigner !== undefined && !/^tz[1-4]/u.test(input.platformSigner)) throw new TypeError("platformSigner must be a tz key hash.");
  return mPair([
    EMPTY, mString(administrator), EMPTY, [mString(administrator)], EMPTY, EMPTY, EMPTY, mString(registry), EMPTY, EMPTY, EMPTY,
    mBool(false), EMPTY, mInt(fee),
    input.platformFeeRecipient === undefined ? mNone : mSome(mString(assertAddress(input.platformFeeRecipient, "platformFeeRecipient"))),
    input.platformSigner === undefined ? mNone : mSome(mString(assertAddress(input.platformSigner, "platformSigner"))),
    EMPTY,
  ]);
}

// ---------------------------------------------------------------------------
// 1. Originations
// ---------------------------------------------------------------------------

export interface KeelTezosCompiledCode {
  /** The compiled Micheline `code` array (SmartPy `*_contract.json`). */
  readonly code: readonly TezosMichelineValue[];
  /** Optional expected SHA-256 of `JSON.stringify(code)`; refused on mismatch. */
  readonly sha256?: string;
}

export interface KeelTezosCollectionOriginationsInput {
  readonly network: string;
  readonly creator: string;
  readonly maxSupply: number | string | bigint;
  readonly collectionMetadata?: KeelTezosContractMetadata;
  /** Let holders rewrite their own token metadata. Default false: only the creator's administrators edit. */
  readonly holderMetadataEditing?: boolean;
  /** Collection-wide default royalty (ERC-2981 counterpart). Omitted means none. */
  readonly royalty?: KeelTezosRoyalty;
  /** Compiled code per route contract; route contracts without code are reported as unresolved. */
  readonly code: Partial<Record<"hold" | "index" | "collection" | "presentation" | "creatorProfile" | "oneMint", KeelTezosCompiledCode>>;
  /** Receipt-backed addresses already known (for example a shared KEEL creator-profile registry). */
  readonly bindings?: Partial<Record<"hold" | "index" | "presentation" | "creatorProfile" | "manager", string>>;
}

function verifyCode(key: string, compiled: KeelTezosCompiledCode | undefined): readonly TezosMichelineValue[] | undefined {
  if (compiled === undefined) return undefined;
  if (!Array.isArray(compiled.code) || compiled.code.length < 3) throw new TypeError(`${key} code must be a compiled Micheline script array.`);
  const prims = compiled.code.map((item) => (item as { prim?: string }).prim);
  for (const required of ["parameter", "storage", "code"]) if (!prims.includes(required)) throw new TypeError(`${key} code is missing its ${required} section.`);
  const digest = sha256Hex(utf8(JSON.stringify(compiled.code)));
  if (compiled.sha256 !== undefined && hexValue(compiled.sha256, `${key} code sha256`, 32) !== digest) throw new Error(`${key} compiled code does not match its expected SHA-256.`);
  const contract = KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS[key as KeelTezosRouteContract].contract;
  const parameter = JSON.stringify(compiled.code[prims.indexOf("parameter")]);
  for (const entrypoint of CATALOG_SURFACE.get(contract)?.entrypoints ?? []) {
    if (!parameter.includes(`"%${entrypoint}"`)) throw new Error(`${key} code does not expose the catalogued ${contract}.${entrypoint} entrypoint.`);
  }
  return compiled.code;
}

/**
 * Stage the collection originations. Foundation contracts need no address;
 * the FA2 needs the Index receipt and OneMint needs a creator-profile registry.
 */
export function prepareKeelTezosCollectionOriginations(input: KeelTezosCollectionOriginationsInput) {
  assertObject(input, "originations");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const maxSupply = natural(input.maxSupply, "maxSupply", { positive: true });
  const metadataJson = buildKeelTezosContractMetadata(input.collectionMetadata);
  if (input.holderMetadataEditing !== undefined && typeof input.holderMetadataEditing !== "boolean") throw new TypeError("holderMetadataEditing must be a boolean.");
  const holderMetadataEditing = input.holderMetadataEditing === true;
  const royalty = input.royalty === undefined ? undefined : royaltyConfig(input.royalty, "royalty");
  const bindings = input.bindings ?? {};
  for (const [name, address] of Object.entries(bindings)) if (address !== undefined) assertContract(address, `bindings.${name}`);
  const code = input.code ?? {};
  const codes = Object.fromEntries((["hold", "index", "collection", "presentation", "creatorProfile", "oneMint"] as const).map((key) => [key, verifyCode(key, code[key])]));

  type Entry = { label: string; artifact: string; contract: string; dependsOn: string[]; operation: TezosOperationDetailsBase | null; unresolvedBindings?: string[]; codeSha256?: string; storageSha256?: string };
  const entry = (key: "hold" | "index" | "collection" | "presentation" | "creatorProfile" | "oneMint", dependsOn: string[], storage: () => TezosMichelineValue): Entry => {
    const contract = KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS[key].contract;
    const unresolved = dependsOn.filter((name) => bindings[name as keyof typeof bindings] === undefined);
    const script = codes[key];
    if (script === undefined) unresolved.push(`code:${key}`);
    if (unresolved.length > 0) return { label: contract, artifact: key, contract, dependsOn, operation: null, unresolvedBindings: unresolved };
    const initial = storage();
    return {
      label: contract, artifact: key, contract, dependsOn,
      operation: { kind: "origination", balance: "0", script: { code: script as readonly TezosMichelineValue[], storage: initial } },
      codeSha256: sha256Hex(utf8(JSON.stringify(script))),
      storageSha256: sha256Hex(utf8(JSON.stringify(initial))),
    };
  };
  const foundation = [
    ...(bindings.hold === undefined ? [entry("hold", [], () => buildKeelTezosHoldOnchFSStorage({ administrator: creator }))] : []),
    ...(bindings.index === undefined ? [entry("index", [], () => buildKeelTezosIndexStorage({ administrator: creator }))] : []),
    ...(bindings.presentation === undefined ? [entry("presentation", [], () => buildKeelTezosPresentationStateStorage())] : []),
    ...(bindings.creatorProfile === undefined ? [entry("creatorProfile", ["manager"], () => buildKeelTezosCreatorProfileStorage({ manager: bindings.manager as string }))] : []),
  ];
  const dependent = [
    entry("collection", ["index"], () => buildKeelTezosCollectionFA2Storage({ administrator: creator, keelIndex: bindings.index as string, maxSupply, contractMetadataJson: metadataJson, holderMetadataEditing, ...(royalty === undefined ? {} : { defaultRoyalty: royalty }) })),
    entry("oneMint", ["creatorProfile"], () => buildKeelTezosOneMintStorage({ creatorProfileRegistry: bindings.creatorProfile as string })),
  ];
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "originate" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    collection: { maxSupply: maxSupply.toString(), contractMetadata: JSON.parse(metadataJson) as unknown, metadataEditing: { creator: true, holders: holderMetadataEditing, holderFreeze: holderMetadataEditing }, royalty: royalty === undefined ? null : { ...royalty, tokenMetadataRoyalties: keelTezosRoyaltyTokenMetadata(royalty) } },
    stages: [
      { id: "originate-foundation", purpose: "Originate the Hold (OnchFS), the revision Index, the presentation-state registry and, when no shared registry is bound, a creator-profile registry.", requiresReceipts: [] as string[], operations: foundation },
      { id: "originate-collection", purpose: "Originate the FA2 collection against the Index receipt and the OneMint gate against the creator-profile registry receipt.", requiresReceipts: ["index", "creatorProfile"], operations: dependent },
    ],
    addressBindings: ["hold", "index", "presentation", "creatorProfile", "collection", "oneMint"].map((name) => ({ name, source: bindings[name as keyof typeof bindings] === undefined ? "operation-receipt" as const : "supplied-binding" as const, ...(bindings[name as keyof typeof bindings] === undefined ? {} : { address: bindings[name as keyof typeof bindings] }) })),
    caveat: "Origination parameters only. Simulate each operation group with the creator's wallet on the selected network, read the KT1 from the applied receipt, and pass it back as a binding for the next stage.",
  };
}

// ---------------------------------------------------------------------------
// 2. Hold / OnchFS resources
// ---------------------------------------------------------------------------

export interface KeelTezosHoldResourceInput {
  readonly name: string;
  readonly mediaType: string;
  /** Stored bytes, exactly as they are written. */
  readonly bytes: Uint8Array;
  /** Stored compression label; `none` (default) for native bytes. */
  readonly compression?: string;
  /** Decoded commitment when `compression` is not `none`. */
  readonly decoded?: { readonly sha256: string; readonly byteLength: number };
}

/** HPACK literal headers (no indexing, no Huffman): the OnchFS file-metadata encoding resolvers decode. */
export function encodeKeelTezosOnchfsMetadata(headers: Readonly<Record<string, string>>): Uint8Array {
  const integer = (value: number): number[] => {
    if (value < 127) return [value];
    const out = [127];
    let rest = value - 127;
    while (rest >= 128) { out.push((rest & 0x7f) | 0x80); rest >>= 7; }
    out.push(rest);
    return out;
  };
  const parts: number[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const key = utf8(name.toLowerCase());
    const text = utf8(value);
    parts.push(0x00, ...integer(key.length), ...key, ...integer(text.length), ...text);
  }
  return Uint8Array.from(parts);
}

/** Exact OnchFS file CID computed by `create_file`: keccak(0x01 || keccak(content) || keccak(metadata)). */
export function keelTezosOnchfsFileCid(content: Uint8Array, metadata: Uint8Array): string {
  return keccakHex(concatBytes([Uint8Array.of(1), bytesOf(keccakHex(content)), bytesOf(keccakHex(metadata))]));
}

/** Exact OnchFS directory CID computed by `create_directory` (Michelson key order, cons-reversed). */
export function keelTezosOnchfsDirectoryCid(files: Readonly<Record<string, string>>): string {
  const names = Object.keys(files).sort((left, right) => compareBytes(utf8(left), utf8(right)));
  const parts: Uint8Array[] = [];
  for (const name of names) {
    if (name.length === 0) throw new TypeError("OnchFS file names cannot be empty.");
    parts.unshift(bytesOf(keccakHex(utf8(name))));
    parts.unshift(bytesOf(hexValue(files[name], `directory.${name}`, 32)));
  }
  return keccakHex(concatBytes([Uint8Array.of(0), ...parts]));
}

export interface KeelTezosHoldResourcesInput {
  readonly network: string;
  readonly creator: string;
  readonly hold: string;
  readonly resources: readonly KeelTezosHoldResourceInput[];
  readonly chunkBytes?: number;
  /** Also create one OnchFS directory over every resource name (for multi-file presentations). */
  readonly directory?: boolean;
}

/** Chunk, address and weld creator resources into KeelHoldOnchFS; returns `onchfs://` URIs and object ids. */
export function prepareKeelTezosHoldResources(input: KeelTezosHoldResourcesInput) {
  assertObject(input, "hold resources");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const hold = assertContract(input.hold, "hold");
  const chunkBytes = Number(natural(input.chunkBytes ?? KEEL_TEZOS_DEFAULT_CHUNK_BYTES, "chunkBytes", { positive: true, max: 28_000n }));
  if (!Array.isArray(input.resources) || input.resources.length === 0 || input.resources.length > 256) throw new TypeError("resources must list 1-256 creator resources.");
  const writes: TezosTransactionOperation[] = [];
  const files: TezosTransactionOperation[] = [];
  const welds: TezosTransactionOperation[] = [];
  const written = new Set<string>();
  const names = new Set<string>();
  const resources = input.resources.map((resource, index) => {
    const label = `resources[${index}]`;
    if (typeof resource.name !== "string" || resource.name.length === 0 || resource.name.length > 255 || resource.name.includes("/")) throw new TypeError(`${label}.name must be a single non-empty path segment.`);
    if (names.has(resource.name)) throw new TypeError(`Duplicate resource name ${resource.name}.`);
    names.add(resource.name);
    if (typeof resource.mediaType !== "string" || resource.mediaType.length === 0 || utf8(resource.mediaType).length > 128) throw new TypeError(`${label}.mediaType must be 1-128 bytes.`);
    if (!(resource.bytes instanceof Uint8Array) || resource.bytes.length === 0) throw new TypeError(`${label}.bytes must be non-empty bytes.`);
    const compression = resource.compression ?? "none";
    if (!/^[a-z0-9-]{1,16}$/u.test(compression)) throw new TypeError(`${label}.compression must be a 1-16 character label.`);
    if (compression !== "none" && resource.decoded === undefined) throw new TypeError(`${label}.decoded is required for compressed stored bytes.`);
    const stored = resource.bytes;
    const storedSha256 = sha256Hex(stored);
    const decodedSha256 = compression === "none" ? storedSha256 : digest32(resource.decoded?.sha256, `${label}.decoded.sha256`);
    const decodedByteLength = compression === "none" ? stored.length : Number(natural(resource.decoded?.byteLength, `${label}.decoded.byteLength`, { positive: true }));
    const pointers: string[] = [];
    for (let offset = 0; offset < stored.length; offset += chunkBytes) {
      const chunk = stored.subarray(offset, offset + chunkBytes);
      const pointer = keccakHex(chunk);
      pointers.push(pointer);
      if (!written.has(pointer)) { written.add(pointer); writes.push(call("hold", hold, "write_chunk", mBytes(hexOf(chunk)))); }
    }
    const metadata = encodeKeelTezosOnchfsMetadata({ "content-type": resource.mediaType, ...(compression === "none" ? {} : { "content-encoding": compression }) });
    const fileCid = keelTezosOnchfsFileCid(stored, metadata);
    files.push(call("hold", hold, "create_file", mPair([pointers.map(mBytes), mBytes(hexOf(metadata))])));
    const manifest = JSON.stringify({ compression, decodedByteLength, decodedSha256, fileCid, mediaType: resource.mediaType, name: resource.name, schema: "keel.tezos.object@1", storedByteLength: stored.length, storedSha256 });
    const manifestHex = hexOf(utf8(manifest));
    const manifestSha256 = sha256Hex(utf8(manifest));
    const objectId = keelTezosOnchfsObjectId({ fileCid, manifestSha256, storedSha256, storedByteLength: stored.length, decodedSha256, decodedByteLength, mediaType: resource.mediaType, compression });
    welds.push(call("hold", hold, "weld_object", mPair([
      mText(compression), mInt(decodedByteLength), mBytes(decodedSha256), mBytes(fileCid), mBytes(manifestHex), mBytes(manifestSha256), mText(resource.mediaType), mBytes(objectId), mInt(stored.length), mBytes(storedSha256),
    ])));
    return { name: resource.name, mediaType: resource.mediaType, compression, objectId, manifestSha256, fileCid, onchfsUri: `onchfs://${fileCid}`, storedByteLength: stored.length, storedSha256, decodedByteLength, decodedSha256, chunkCount: pointers.length, chunkPointers: pointers, metadataHex: hexOf(metadata) };
  });
  const directoryEntries: Record<string, string> = Object.fromEntries(resources.map((resource) => [resource.name, resource.fileCid]));
  const directoryCid = input.directory === true ? keelTezosOnchfsDirectoryCid(directoryEntries) : undefined;
  const directoryOps = directoryCid === undefined ? [] : [call("hold", hold, "create_directory", mStringMap(Object.entries(directoryEntries).map(([name, cid]) => [name, mBytes(cid)])))];
  const operations = [...writes, ...files, ...welds, ...directoryOps];
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "hold-resources" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    hold,
    resources,
    ...(directoryCid === undefined ? {} : { directory: { cid: directoryCid, onchfsUri: `onchfs://${directoryCid}`, files: directoryEntries } }),
    storage: { storedBytes: resources.reduce((total, resource) => total + resource.storedByteLength, 0), newChunkCount: writes.length, payloadStorage: "native-bytes-once" },
    operations,
    batches: groupKeelTezosOperations(operations),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    caveat: "Chunks are content-addressed and idempotent. Read back each object with `get_object`/`haul_object` and each file with `read_file` before binding presentation or metadata to it.",
  };
}

// ---------------------------------------------------------------------------
// 3. Presentation / renderer binding
// ---------------------------------------------------------------------------

const REVISION_POLICIES = { immutable: 0, creator: 1, timelocked: 4 } as const;
const PRESENTATION_AUTHORITIES = ["immutable", "creator", "oracle", "token-owner", "creator-or-token-owner"] as const;
const PRESENTATION_UPDATE_KINDS = ["resource-revision", "harness-revision"] as const;

export interface KeelTezosPresentationBindingInput {
  readonly network: string;
  readonly creator: string;
  readonly collection: string;
  readonly index: string;
  /** The collection presentation manifest (onchfs://, data:, tezos-storage: or keel+tezos:// for KEEL readers). */
  readonly manifestUri: string;
  readonly manifestDigest: string;
  readonly previewUri?: string;
  /** Register the collection with the Index (first binding only). Default true. */
  readonly registerCollection?: boolean;
  /** Revision number to publish and activate. Default 1. */
  readonly revision?: number;
  readonly revisionPolicy?: keyof typeof REVISION_POLICIES;
  /** Optional KeelPresentationStateRegistry policy that records the renderer object revision. */
  readonly presentationPolicy?: {
    readonly registry: string;
    readonly salt: string;
    readonly tokenId?: number;
    readonly mediaType: string;
    readonly maxBytes: number;
    readonly valueDigest: string;
    readonly byteLength: number;
    readonly authority?: (typeof PRESENTATION_AUTHORITIES)[number];
    readonly updateKind?: (typeof PRESENTATION_UPDATE_KINDS)[number];
    readonly expectedParent?: number;
    readonly create?: boolean;
  };
  /** Weld the default presentation permanently. Requires an explicit true. */
  readonly freeze?: boolean;
}

const PRESENTATION_URI = /^(?:onchfs:\/\/[0-9a-f]{64}(?:\/[^\s]*)?|data:[^\s]+|tezos-storage:[^\s]+|keel\+tezos:\/\/[^\s]+)$/u;

export function prepareKeelTezosPresentationBinding(input: KeelTezosPresentationBindingInput) {
  assertObject(input, "presentation binding");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const collection = assertContract(input.collection, "collection");
  const index = assertContract(input.index, "index");
  if (typeof input.manifestUri !== "string" || !PRESENTATION_URI.test(input.manifestUri) || utf8(input.manifestUri).length > 2_048) throw new TypeError("manifestUri must be an onchain carrier URI (onchfs://, data:, tezos-storage: or keel+tezos://) of at most 2,048 bytes.");
  if (input.previewUri !== undefined && (typeof input.previewUri !== "string" || !PRESENTATION_URI.test(input.previewUri))) throw new TypeError("previewUri must be an onchain carrier URI.");
  const manifestDigest = digest32(input.manifestDigest, "manifestDigest");
  const revision = natural(input.revision ?? 1, "revision", { positive: true });
  const policyName = input.revisionPolicy ?? "creator";
  if (!Object.hasOwn(REVISION_POLICIES, policyName)) throw new TypeError("revisionPolicy must be immutable, creator or timelocked.");
  const operations: TezosTransactionOperation[] = [];
  if (input.registerCollection ?? revision === 1n) operations.push(call("index", index, "register_collection", mPair([mString(collection), mString(creator)])));
  operations.push(call("index", index, "publish_collection_revision", mPair([
    mInt(0), mString(collection), mInt(1), mInt(1), mBytes(manifestDigest), mText(input.manifestUri), mInt(revision - 1n), mInt(REVISION_POLICIES[policyName]),
  ])));
  operations.push(call("index", index, "activate_collection_revision", mPair([mString(collection), mInt(revision)])));
  operations.push(call("collection", collection, "set_default_presentation", mPair([mText(input.manifestUri), mBytes(manifestDigest), mText(input.previewUri ?? input.manifestUri)])));
  let policyId: string | undefined;
  if (input.presentationPolicy !== undefined) {
    const policy = assertObject(input.presentationPolicy, "presentationPolicy") as unknown as NonNullable<KeelTezosPresentationBindingInput["presentationPolicy"]>;
    const registry = assertContract(policy.registry, "presentationPolicy.registry");
    const salt = hexValue(policy.salt, "presentationPolicy.salt");
    policyId = keelTezosPresentationPolicyId(creator, salt);
    const authority = policy.authority ?? "creator";
    if (!PRESENTATION_AUTHORITIES.includes(authority)) throw new TypeError("presentationPolicy.authority is not supported.");
    if (authority === "oracle") throw new TypeError("Oracle presentation authority needs an explicit oracle and is not prepared by the collection route.");
    const updateKind = policy.updateKind ?? "resource-revision";
    if (!PRESENTATION_UPDATE_KINDS.includes(updateKind)) throw new TypeError("presentationPolicy.updateKind must be resource-revision or harness-revision.");
    if (typeof policy.mediaType !== "string" || policy.mediaType.length === 0 || utf8(policy.mediaType).length > 128) throw new TypeError("presentationPolicy.mediaType must be 1-128 bytes.");
    const maxBytes = natural(policy.maxBytes, "presentationPolicy.maxBytes", { positive: true });
    const byteLength = natural(policy.byteLength, "presentationPolicy.byteLength", { positive: true });
    if (byteLength > maxBytes) throw new TypeError("presentationPolicy.byteLength exceeds maxBytes.");
    if (policy.create !== false) {
      // Value kinds mirror the EVM registry's ValueKind; a resource or harness revision is `binary`.
      operations.push(call("presentation", registry, "create_policy", mPair([
        mText(authority), mSome(mString(collection)), mBool(false), mInt(maxBytes), mText(policy.mediaType), mNone, mBytes(policyId), mBytes(salt), mInt(natural(policy.tokenId ?? 0, "presentationPolicy.tokenId")), mText(updateKind), mText("binary"),
      ])));
    }
    operations.push(call("presentation", registry, "append_resource_revision", mPair([
      mInt(byteLength), mInt(natural(policy.expectedParent ?? 0, "presentationPolicy.expectedParent")), mText(policy.mediaType), mBytes(policyId), mBytes(digest32(policy.valueDigest, "presentationPolicy.valueDigest")),
    ])));
  }
  if (input.freeze === true) operations.push(call("collection", collection, "freeze_default_presentation", mUnit));
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "bind-presentation" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    binding: { collection, index, manifestUri: input.manifestUri, manifestDigest, previewUri: input.previewUri ?? input.manifestUri, revision: revision.toString(), revisionPolicy: policyName, ...(policyId === undefined ? {} : { presentationPolicyId: policyId }), frozen: input.freeze === true },
    operations,
    batches: groupKeelTezosOperations(operations),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    caveat: "The collection's `keel_index` must already name this Index (set at origination). Read back `default_presentation`, the Index `active_presentation` and, when present, `current_presentation` before minting.",
  };
}

// ---------------------------------------------------------------------------
// 4. Mint gate (OneMintController)
// ---------------------------------------------------------------------------

const STAGE_KINDS = { off: 0, public: 2, premint: 9, end: 10, merkle: 12 } as const;
export type KeelTezosStageKind = keyof typeof STAGE_KINDS;

export interface KeelTezosStageInput {
  readonly kind: KeelTezosStageKind;
  /** Unix seconds. Stages must be contiguous: each start equals the previous end. */
  readonly startTime: number;
  readonly endTime: number;
  readonly priceMutez?: number | string | bigint;
  readonly maxPerTransaction?: number;
  readonly maxPerWallet?: number;
  readonly metadataDigest?: string;
  /** Merkle stages only: the allowlist whose root is set after the drop exists. */
  readonly allowlist?: readonly KeelTezosAllowlistEntry[];
}

export interface KeelTezosMintGateInput {
  readonly network: string;
  readonly creator: string;
  readonly collection: string;
  readonly oneMint: string;
  readonly supply: number | string | bigint | "open";
  readonly maxPerTransaction: number;
  readonly maxPerWallet: number;
  readonly payout?: string;
  readonly metadataDigest: string;
  readonly stages: readonly KeelTezosStageInput[];
  /** Grant OneMint the collection minter capability first. Default true. */
  readonly setMinter?: boolean;
  /** Create the creator profile OneMint requires (`can_create_drop`). */
  readonly creatorProfile?: { readonly registry: string; readonly username: string; readonly metadataUri: string; readonly recoveryAddress?: string };
  /** Pause the drop as soon as it exists (pilot-token posture). */
  readonly startPaused?: boolean;
  /** Creator's current OneMint nonce for drop-id prediction. Default 0. */
  readonly creatorNonce?: number;
}

function stageMicheline(stage: KeelTezosStageInput, index: number, defaults: { readonly digest: string }): TezosMichelineValue {
  const label = `stages[${index}]`;
  if (!Object.hasOwn(STAGE_KINDS, stage.kind)) throw new TypeError(`${label}.kind must be off, public, premint, end or merkle. Signed allowlist, claim and token-payment stages need a signer or payment token this route does not prepare.`);
  const start = natural(stage.startTime, `${label}.startTime`);
  const end = natural(stage.endTime, `${label}.endTime`);
  if (start >= end) throw new TypeError(`${label} must start before it ends.`);
  const price = natural(stage.priceMutez ?? 0, `${label}.priceMutez`);
  if ((stage.kind === "off" || stage.kind === "end" || stage.kind === "premint") && price !== 0n) throw new TypeError(`${label} (${stage.kind}) must be free.`);
  return mPair([
    mInt(STAGE_KINDS[stage.kind]), mInt(start), mInt(end), mInt(price), mNone, mNone, mNone,
    mInt(natural(stage.maxPerTransaction ?? 0, `${label}.maxPerTransaction`)), mInt(natural(stage.maxPerWallet ?? 0, `${label}.maxPerWallet`)),
    mBytes(stage.metadataDigest === undefined ? defaults.digest : digest32(stage.metadataDigest, `${label}.metadataDigest`)),
  ]);
}

/** Configure a priced, supply-capped, allowlisted and pausable drop on OneMintController. */
export function prepareKeelTezosMintGate(input: KeelTezosMintGateInput) {
  assertObject(input, "mint gate");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const collection = assertContract(input.collection, "collection");
  const oneMint = assertContract(input.oneMint, "oneMint");
  const payout = assertAddress(input.payout ?? creator, "payout");
  if (payout === KEEL_TEZOS_BURN_ADDRESS) throw new TypeError("payout cannot be the burn address.");
  const supply = input.supply === "open" ? BigInt(KEEL_TEZOS_OPEN_SUPPLY) : natural(input.supply, "supply", { positive: true });
  const maxTx = natural(input.maxPerTransaction, "maxPerTransaction", { positive: true });
  const maxWallet = natural(input.maxPerWallet, "maxPerWallet", { positive: true });
  if (maxTx > maxWallet || maxWallet > supply) throw new TypeError("Limits must satisfy maxPerTransaction <= maxPerWallet <= supply.");
  const metadataDigest = digest32(input.metadataDigest, "metadataDigest");
  if (!Array.isArray(input.stages) || input.stages.length === 0 || input.stages.length > 16) throw new TypeError("stages must list 1-16 stages.");
  input.stages.forEach((stage, index) => {
    if (index > 0 && natural(stage.startTime, `stages[${index}].startTime`) !== natural((input.stages[index - 1] as KeelTezosStageInput).endTime, `stages[${index - 1}].endTime`)) throw new TypeError(`stages[${index}] must start exactly when the previous stage ends.`);
    if (stage.kind !== "merkle" && stage.allowlist !== undefined) throw new TypeError(`stages[${index}].allowlist belongs to a merkle stage.`);
  });
  const operations: TezosTransactionOperation[] = [];
  if (input.creatorProfile !== undefined) {
    const profile = assertObject(input.creatorProfile, "creatorProfile") as unknown as NonNullable<KeelTezosMintGateInput["creatorProfile"]>;
    const registry = assertContract(profile.registry, "creatorProfile.registry");
    if (typeof profile.username !== "string" || profile.username.length === 0) throw new TypeError("creatorProfile.username is required.");
    if (typeof profile.metadataUri !== "string" || profile.metadataUri.length === 0 || utf8(profile.metadataUri).length > 2_048) throw new TypeError("creatorProfile.metadataUri must be 1-2,048 bytes.");
    operations.push({
      kind: "transaction", amount: "0", destination: registry,
      // Unset object ID and organization are bytes32 zero, as in the EVM registry; empty bytes are refused.
      parameters: { entrypoint: "create_profile", value: mPair([
        mBytes(sha256Hex(utf8(profile.username.normalize("NFC").toLowerCase()))), mText(profile.metadataUri), mString(KEEL_TEZOS_BURN_ADDRESS), mBytes("00".repeat(32)), mBytes("00".repeat(32)), mInt(0), mString(assertAddress(profile.recoveryAddress ?? KEEL_TEZOS_BURN_ADDRESS, "creatorProfile.recoveryAddress")),
      ]) },
    });
    assertKeelTezosEntrypoint("KeelCreatorProfileRegistry", "create_profile");
  }
  if (input.setMinter !== false) operations.push(call("collection", collection, "set_minter", mPair([mString(oneMint), mBool(true)])));
  operations.push(call("oneMint", oneMint, "create_drop", mPair([
    mString(collection), mString(payout), mInt(supply), mInt(maxTx), mInt(maxWallet),
    input.stages.map((stage, index) => stageMicheline(stage, index, { digest: metadataDigest })),
    mBytes(metadataDigest),
  ])));
  const dropId = predictKeelTezosOneMintDropId({ network, oneMint, creator, target: collection, metadataDigest, creatorNonce: input.creatorNonce ?? 0 });
  const allowlists = input.stages.flatMap((stage, index) => stage.kind === "merkle" && stage.allowlist !== undefined ? [{ stageIndex: index, tree: buildKeelTezosAllowlistTree(stage.allowlist) }] : []);
  const followUp: TezosTransactionOperation[] = [
    ...allowlists.map(({ stageIndex, tree }) => call("oneMint", oneMint, "set_stage_merkle_root", mPair([mBytes(dropId), mInt(stageIndex), mBytes(tree.root)]))),
    ...(input.startPaused === true ? [call("oneMint", oneMint, "set_drop_paused", mPair([mBytes(dropId), mBool(true)]))] : []),
  ];
  const missingRoots = input.stages.flatMap((stage, index) => stage.kind === "merkle" && stage.allowlist === undefined ? [index] : []);
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "configure-mint-gate" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    drop: {
      oneMint, collection, payout, supply: input.supply === "open" ? "open" : supply.toString(), maxPerTransaction: maxTx.toString(), maxPerWallet: maxWallet.toString(), metadataDigest,
      stages: input.stages.map((stage, index) => ({ index, kind: stage.kind, startTime: stage.startTime, endTime: stage.endTime, priceMutez: String(stage.priceMutez ?? 0) })),
      predictedDropId: dropId,
      allowlists: allowlists.map(({ stageIndex, tree }) => ({ stageIndex, root: tree.root, entries: tree.leaves.length, proofs: tree.leaves })),
      ...(missingRoots.length > 0 ? { merkleStagesAwaitingRoot: missingRoots } : {}),
      startsPaused: input.startPaused === true,
    },
    operations,
    followUp: { requires: "The selected chain's OneMint `latest_drop_for_target(collection)` must equal predictedDropId before these are signed.", operations: followUp },
    batches: groupKeelTezosOperations(operations),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    caveat: "create_drop reserves the full finite supply on the FA2 at once; the collection max supply must cover every drop.",
  };
}

export type KeelTezosMintGateAction =
  | { readonly action: "pause" | "unpause"; readonly dropId: string }
  | { readonly action: "close"; readonly dropId: string }
  | { readonly action: "set-supply"; readonly dropId: string; readonly supply: number | string | bigint }
  | { readonly action: "set-merkle-root"; readonly dropId: string; readonly stageIndex: number; readonly allowlist: readonly KeelTezosAllowlistEntry[] }
  | { readonly action: "withdraw"; readonly recipient?: string }
  | { readonly action: "set-minter"; readonly collection: string; readonly account: string; readonly enabled: boolean }
  | { readonly action: "set-holder-metadata-editing"; readonly collection: string; readonly enabled: boolean }
  | { readonly action: "set-collection-metadata"; readonly collection: string; readonly collectionMetadata: KeelTezosContractMetadata }
  | { readonly action: "freeze-collection-metadata"; readonly collection: string }
  | { readonly action: "set-default-royalty"; readonly collection: string; readonly royalty: KeelTezosRoyalty }
  | { readonly action: "remove-default-royalty"; readonly collection: string };

/**
 * One governed mint-gate or collection change: pause/unpause/close a drop, change supply or
 * allowlist, withdraw proceeds, grant a minter, let holders edit their own token metadata,
 * replace / permanently freeze the collection's TZIP-16 metadata, or set its default royalty.
 */
export function prepareKeelTezosMintGateAction(input: { readonly network: string; readonly creator: string; /** Required for every drop action (not set-minter or set-holder-metadata-editing). */ readonly oneMint?: string } & KeelTezosMintGateAction) {
  assertObject(input, "mint gate action");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const collectionAction = input.action === "set-minter" || input.action === "set-holder-metadata-editing" || input.action === "set-collection-metadata" || input.action === "freeze-collection-metadata" || input.action === "set-default-royalty" || input.action === "remove-default-royalty";
  const oneMint = collectionAction ? "" : assertContract(input.oneMint, "oneMint");
  let operation: TezosTransactionOperation;
  let detail: Record<string, unknown> = {};
  switch (input.action) {
    case "pause":
    case "unpause": operation = call("oneMint", oneMint, "set_drop_paused", mPair([mBytes(digest32(input.dropId, "dropId")), mBool(input.action === "pause")])); break;
    case "close": operation = call("oneMint", oneMint, "close_drop", mBytes(digest32(input.dropId, "dropId"))); break;
    case "set-supply": operation = call("oneMint", oneMint, "update_drop_supply", mPair([mBytes(digest32(input.dropId, "dropId")), mInt(natural(input.supply, "supply", { positive: true }))])); break;
    case "set-merkle-root": {
      const tree = buildKeelTezosAllowlistTree(input.allowlist);
      operation = call("oneMint", oneMint, "set_stage_merkle_root", mPair([mBytes(digest32(input.dropId, "dropId")), mInt(natural(input.stageIndex, "stageIndex")), mBytes(tree.root)]));
      detail = { root: tree.root, proofs: tree.leaves };
      break;
    }
    case "withdraw": operation = call("oneMint", oneMint, "withdraw", mPair([mNone, mString(assertAddress(input.recipient ?? creator, "recipient"))])); break;
    case "set-minter": operation = call("collection", assertContract(input.collection, "collection"), "set_minter", mPair([mString(assertAddress(input.account, "account")), mBool(input.enabled)])); break;
    case "set-holder-metadata-editing":
      if (typeof input.enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
      operation = call("collection", assertContract(input.collection, "collection"), "set_token_owner_can_edit", mBool(input.enabled));
      detail = { metadataEditing: { creator: true, holders: input.enabled, holderFreeze: input.enabled } };
      break;
    case "set-collection-metadata": {
      const json = buildKeelTezosContractMetadata(input.collectionMetadata);
      operation = call("collection", assertContract(input.collection, "collection"), "set_contract_metadata", mPair([mString("content"), mSome(mText(json))]));
      detail = { contractMetadata: JSON.parse(json) as unknown };
      break;
    }
    case "freeze-collection-metadata": operation = call("collection", assertContract(input.collection, "collection"), "freeze_contract_metadata", mUnit); break;
    case "set-default-royalty": {
      const royalty = royaltyConfig(input.royalty, "royalty");
      operation = call("collection", assertContract(input.collection, "collection"), "set_default_royalty", royaltyValue(royalty, "royalty"));
      detail = { royalty: { ...royalty, tokenMetadataRoyalties: keelTezosRoyaltyTokenMetadata(royalty) } };
      break;
    }
    case "remove-default-royalty":
      operation = call("collection", assertContract(input.collection, "collection"), "set_default_royalty", mNone);
      detail = { royalty: null };
      break;
    default: throw new TypeError("Unsupported Tezos mint-gate action.");
  }
  return { schema: KEEL_TEZOS_COLLECTION_ROUTE, step: "mint-gate-action" as const, status: "review-only" as const, family: "tezos" as const, network, expectedSender: creator, action: input.action, operation, ...detail, signing: "not-performed" as const, submission: "not-performed" as const };
}

// ---------------------------------------------------------------------------
// 5. Mint and batch mint
// ---------------------------------------------------------------------------

export type KeelTezosMintRequest =
  | { readonly mode: "public"; readonly dropId: string; readonly stageIndex: number; readonly quantity: number; readonly priceMutez: number | string | bigint }
  | { readonly mode: "merkle"; readonly dropId: string; readonly stageIndex: number; readonly quantity: number; readonly priceMutez: number | string | bigint; readonly allowance: number; readonly proof: readonly string[] }
  | { readonly mode: "premint"; readonly dropId: string; readonly stageIndex: number; readonly quantity: number; readonly recipient: string }
  /** Direct FA2 issuance by an authorized minter. `unreserved` never consumes any drop's reserved supply. */
  | { readonly mode: "direct"; readonly quantity: number; readonly recipient?: string; readonly unreserved?: boolean };

export interface KeelTezosMintInput {
  readonly network: string;
  /** The wallet that sends the mint (collector, or the creator for premint/direct). */
  readonly sender: string;
  readonly oneMint?: string;
  readonly collection?: string;
  readonly mints: readonly KeelTezosMintRequest[];
  /** Optional mint_data bytes forwarded by OneMint (hex). */
  readonly mintData?: string;
}

/** Public, allowlist (merkle), premint and direct-minter mints; several requests become one batch. */
export function prepareKeelTezosMint(input: KeelTezosMintInput) {
  assertObject(input, "mint");
  const network = assertNetwork(input.network);
  const sender = assertAddress(input.sender, "sender");
  const mintData = mBytes(hexValue(input.mintData ?? "", "mintData"));
  if (!Array.isArray(input.mints) || input.mints.length === 0 || input.mints.length > 64) throw new TypeError("mints must list 1-64 mint requests.");
  let total = 0n;
  let tokens = 0n;
  const operations = input.mints.map((mint, index) => {
    const label = `mints[${index}]`;
    const quantity = natural(mint.quantity, `${label}.quantity`, { positive: true, max: 500n });
    tokens += quantity;
    if (mint.mode === "direct") {
      const collection = assertContract(input.collection, "collection");
      return call("collection", collection, mint.unreserved === true ? "strike_unreserved" : "strike", mPair([mString(assertAddress(mint.recipient ?? sender, `${label}.recipient`)), mInt(quantity)]));
    }
    const oneMint = assertContract(input.oneMint, "oneMint");
    const dropId = mBytes(digest32(mint.dropId, `${label}.dropId`));
    const stage = mInt(natural(mint.stageIndex, `${label}.stageIndex`));
    if (mint.mode === "premint") return call("oneMint", oneMint, "admin_strike", mPair([dropId, stage, mString(assertAddress(mint.recipient, `${label}.recipient`)), mInt(quantity), mintData]));
    const amount = natural(mint.priceMutez, `${label}.priceMutez`) * quantity;
    total += amount;
    if (mint.mode === "public") return call("oneMint", oneMint, "public_mint", mPair([dropId, stage, mInt(quantity), mintData]), amount);
    if (mint.mode === "merkle") {
      if (!Array.isArray(mint.proof) || mint.proof.length > 64) throw new TypeError(`${label}.proof must list at most 64 sibling digests.`);
      return call("oneMint", oneMint, "merkle_mint", mPair([dropId, stage, mInt(quantity), mInt(natural(mint.allowance, `${label}.allowance`, { positive: true })), (mint.proof as readonly string[]).map((sibling: string, position: number) => mBytes(hexValue(sibling, `${label}.proof[${position}]`, 32))), mintData]), amount);
    }
    throw new TypeError(`${label}.mode must be public, merkle, premint or direct.`);
  });
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "mint" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: sender,
    tokens: tokens.toString(),
    paymentMutez: total.toString(),
    operations,
    batches: groupKeelTezosOperations(operations),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    caveat: "Token ids are assigned by the FA2 in strike order. Read the `keel_collection_struck` event or `total_supply` from the applied receipt before writing token metadata.",
  };
}

// ---------------------------------------------------------------------------
// 6. TZIP-12 / TZIP-21 token metadata with self-contained presentation
// ---------------------------------------------------------------------------

export interface KeelTezosTokenMetadataInput {
  readonly tokenId: number;
  readonly name: string;
  readonly description?: string;
  readonly symbol?: string;
  /** Self-contained HTML; stored inline as a raw-percent `data:text/html` artifactUri. */
  readonly html?: string;
  /** Self-contained SVG preview; stored inline as a raw-percent `data:image/svg+xml` displayUri. */
  readonly previewSvg?: string;
  /** Onchain carrier URIs (onchfs:// from the Hold) for larger or binary resources. */
  readonly artifactUri?: string;
  readonly artifactMediaType?: string;
  readonly displayUri?: string;
  readonly displayMediaType?: string;
  readonly thumbnailUri?: string;
  readonly attributes?: readonly { readonly name: string; readonly value: string | number | boolean }[];
  readonly creators?: readonly string[];
  readonly tags?: readonly string[];
  readonly rights?: string;
  /** TZIP-21 royalties: shares out of 10^decimals, keyed by tz/KT1 address (marketplaces such as objkt read this). */
  readonly royalties?: { readonly decimals: number; readonly shares: Readonly<Record<string, number | string>> };
}

const KEEL_POINTER = /^(?:keel-onchain|keel\+tezos|keel):/iu;
const ONCHAIN_CARRIER = /^(?:onchfs:\/\/[0-9a-f]{64}(?:\/[^\s]*)?|data:[^\s]+|tezos-storage:[^\s]+)$/u;

/** Raw-percent text data URI: only bytes that cannot appear literally in a URI are escaped; never Base64. */
export function keelTezosTextDataUri(mediaType: string, text: string): string {
  if (!/^[a-z]+\/[a-z0-9.+-]+$/u.test(mediaType)) throw new TypeError("Inline data URI media type is invalid.");
  return `data:${mediaType};charset=utf-8,${encodeURIComponent(text)}`;
}

function carrier(value: unknown, label: string, allowExternal: boolean): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a URI.`);
  if (KEEL_POINTER.test(value)) throw new TypeError(`${label} is a KEEL pointer, not self-contained presentation. Use inline data or an onchfs:// Hold carrier.`);
  if (!ONCHAIN_CARRIER.test(value) && !allowExternal) throw new TypeError(`${label} must be an onchain carrier (data:, onchfs:// or tezos-storage:). External carriers need allowExternalCarrier=true.`);
  return value;
}

/** Build the TZIP-21 token_info map (string values) for one token. */
export function buildKeelTezosTokenInfo(token: KeelTezosTokenMetadataInput, options: { readonly allowExternalCarrier?: boolean } = {}): Record<string, string> {
  assertObject(token, "token");
  natural(token.tokenId, "tokenId", { positive: true });
  if (typeof token.name !== "string" || token.name.length === 0 || token.name.length > 256) throw new TypeError("token name must be 1-256 characters.");
  if (token.html !== undefined && token.artifactUri !== undefined) throw new TypeError("Choose inline html or an artifactUri carrier, not both.");
  if (token.previewSvg !== undefined && token.displayUri !== undefined) throw new TypeError("Choose an inline previewSvg or a displayUri carrier, not both.");
  const allowExternal = options.allowExternalCarrier === true;
  const artifactUri = token.html !== undefined ? keelTezosTextDataUri("text/html", token.html) : token.artifactUri === undefined ? undefined : carrier(token.artifactUri, "artifactUri", allowExternal);
  const displayUri = token.previewSvg !== undefined ? keelTezosTextDataUri("image/svg+xml", token.previewSvg) : token.displayUri === undefined ? undefined : carrier(token.displayUri, "displayUri", allowExternal);
  if (artifactUri === undefined) throw new TypeError("A KEEL Tezos token needs its animation (artifactUri): inline html or an onchfs:// carrier.");
  if (displayUri === undefined) throw new TypeError("A KEEL Tezos token needs its preview image (displayUri): inline previewSvg or an onchfs:// carrier.");
  const thumbnailUri = token.thumbnailUri === undefined ? displayUri : carrier(token.thumbnailUri, "thumbnailUri", allowExternal);
  const artifactMime = token.html !== undefined ? "text/html" : token.artifactMediaType ?? "text/html";
  const displayMime = token.previewSvg !== undefined ? "image/svg+xml" : token.displayMediaType ?? "image/svg+xml";
  const info: Record<string, string> = {
    name: token.name,
    decimals: "0",
    isBooleanAmount: "true",
    shouldPreferSymbol: "false",
    artifactUri,
    displayUri,
    thumbnailUri,
    formats: JSON.stringify([{ uri: artifactUri, mimeType: artifactMime }, ...(displayUri === artifactUri ? [] : [{ uri: displayUri, mimeType: displayMime }])]),
  };
  if (token.description !== undefined) info.description = String(token.description);
  if (token.symbol !== undefined) info.symbol = String(token.symbol);
  if (token.attributes !== undefined) info.attributes = JSON.stringify(token.attributes.map((attribute) => ({ name: String(attribute.name), value: attribute.value })));
  if (token.creators !== undefined) info.creators = JSON.stringify(token.creators.map((creator) => assertAddress(creator, "creators[]")));
  if (token.tags !== undefined) info.tags = JSON.stringify(token.tags.map(String));
  if (token.rights !== undefined) info.rights = String(token.rights);
  if (token.royalties !== undefined) {
    assertObject(token.royalties, "royalties");
    const decimals = Number(natural(token.royalties.decimals, "royalties.decimals"));
    if (decimals > 6) throw new RangeError("royalties.decimals must be 0-6.");
    const entries = Object.entries(token.royalties.shares ?? {});
    if (entries.length === 0 || entries.length > 16) throw new TypeError("royalties.shares must name 1-16 recipients.");
    const shares: Record<string, number> = {};
    let total = 0n;
    for (const [recipient, share] of entries) {
      const amount = natural(share, `royalties.shares.${recipient}`);
      shares[assertAddress(recipient, "royalties recipient")] = Number(amount);
      total += amount;
    }
    if (total > 10n ** BigInt(decimals)) throw new RangeError("royalties shares exceed 100%.");
    info.royalties = JSON.stringify({ decimals, shares });
  }
  return info;
}

export function prepareKeelTezosTokenMetadata(input: { readonly network: string; readonly creator: string; readonly collection: string; readonly tokens: readonly KeelTezosTokenMetadataInput[]; readonly freeze?: boolean; readonly allowExternalCarrier?: boolean }) {
  assertObject(input, "token metadata");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const collection = assertContract(input.collection, "collection");
  if (!Array.isArray(input.tokens) || input.tokens.length === 0 || input.tokens.length > 256) throw new TypeError("tokens must list 1-256 tokens.");
  const seen = new Set<number>();
  const operations: TezosTransactionOperation[] = [];
  const tokens = input.tokens.map((token) => {
    if (seen.has(token.tokenId)) throw new TypeError(`Duplicate token ${token.tokenId}.`);
    seen.add(token.tokenId);
    const info = buildKeelTezosTokenInfo(token, { allowExternalCarrier: input.allowExternalCarrier === true });
    const operation = call("collection", collection, "set_token_metadata", mPair([mInt(token.tokenId), mStringMap(Object.entries(info).map(([key, value]) => [key, mText(value)]))]));
    const estimated = estimateKeelTezosOperationBytes(operation);
    if (estimated > KEEL_TEZOS_OPERATION_GROUP_BUDGET) throw new RangeError(`Token ${token.tokenId} metadata is about ${estimated} bytes; one Tezos operation is limited to ${KEEL_TEZOS_MAX_OPERATION_BYTES}. Store the HTML in the Hold (keel-tezos-hold-resources-prepare) and pass its onchfs:// URI as artifactUri.`);
    operations.push(operation);
    if (input.freeze === true) operations.push(call("collection", collection, "freeze_token_metadata", mInt(token.tokenId)));
    const presentation = (uri: string) => uri.startsWith("data:") ? "inline-data" : uri.startsWith("onchfs://") ? "onchfs-hold" : uri.startsWith("tezos-storage:") ? "tezos-storage" : "external";
    return {
      tokenId: token.tokenId,
      tokenInfo: info,
      tokenInfoSha256: sha256Hex(utf8(JSON.stringify(Object.entries(info).sort(([left], [right]) => left < right ? -1 : 1)))),
      presentation: { artifact: presentation(info.artifactUri as string), display: presentation(info.displayUri as string), selfContained: [info.artifactUri, info.displayUri].every((uri) => /^(?:data:|onchfs:\/\/|tezos-storage:)/u.test(uri as string)) },
      estimatedOperationBytes: estimated,
    };
  });
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "token-metadata" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    collection,
    standard: "TZIP-12 token_metadata with TZIP-21 fields" as const,
    tokens,
    operations,
    batches: groupKeelTezosOperations(operations),
    signing: "not-performed" as const,
    submission: "not-performed" as const,
    metadataEditing: { creator: "rewrite until frozen", holders: "only when token_owner_can_edit is enabled", holderFreeze: "only when token_owner_can_edit is enabled" },
    caveat: "Administrators rewrite token metadata until that token is frozen; holders edit only when the creator enables token_owner_can_edit. Read it back with the `token_metadata` view and compare tokenInfoSha256 before announcing the token.",
  };
}

// ---------------------------------------------------------------------------
// 7. Selected-network read-back (RPC and TzKT)
// ---------------------------------------------------------------------------

function micheline(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") throw new Error("Tezos view returned no Micheline value.");
  return value as Record<string, unknown>;
}

function textOfBytes(hex: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytesOf(hex));
}

/** Decode the `token_metadata` view result (Pair token_id { Elt key bytes }) into strings. */
export function decodeKeelTezosTokenMetadataView(value: unknown): { readonly tokenId: string; readonly tokenInfo: Record<string, string> } {
  const node = micheline(value);
  const args = node.args as unknown[] | undefined;
  if (node.prim !== "Pair" || !Array.isArray(args) || args.length < 2) throw new Error("token_metadata view did not return a Pair.");
  const tokenId = String((args[0] as { int?: string }).int ?? "");
  const rest = args.length > 2 ? args.slice(1) : args[1];
  const elements = Array.isArray(rest) ? rest : [];
  const tokenInfo: Record<string, string> = {};
  for (const element of elements) {
    const item = micheline(element);
    const pair = item.args as { string?: string; bytes?: string }[] | undefined;
    if (item.prim !== "Elt" || !Array.isArray(pair) || typeof pair[0]?.string !== "string" || typeof pair[1]?.bytes !== "string") throw new Error("token_info entry is not an Elt string bytes.");
    tokenInfo[pair[0].string] = textOfBytes(pair[1].bytes);
  }
  return { tokenId, tokenInfo };
}

export interface KeelTezosReadbackRpc {
  readonly rpcUrl: string;
  readonly fetchImpl?: typeof fetch;
}

async function getJson<T>(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<T> {
  const response = await fetchImpl(url, { ...init, headers: { accept: "application/json", ...(init?.body === undefined ? {} : { "content-type": "application/json" }) } });
  if (!response.ok) throw new Error(`Tezos read ${response.status} for ${new URL(url).pathname}`);
  return await response.json() as T;
}

function readUrl(value: string, label: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new TypeError(`${label} must use HTTPS unless it is local.`);
  if (url.username !== "" || url.password !== "") throw new TypeError(`${label} must not embed credentials.`);
  return value.replace(/\/$/u, "");
}

export interface KeelTezosPublicationCheckInput {
  readonly network: string;
  readonly rpcUrl: string;
  readonly tzktUrl?: string;
  readonly collection: string;
  readonly oneMint?: string;
  readonly hold?: string;
  readonly index?: string;
  readonly expectedManifestDigest?: string;
  readonly expectedTokens?: readonly { readonly tokenId: number; readonly tokenInfo?: Readonly<Record<string, string>>; readonly tokenInfoSha256?: string }[];
  readonly expectedObjects?: readonly string[];
  /** Expected `token_owner_can_edit`; omitted means the creator-only default (false). */
  readonly expectedHolderMetadataEditing?: boolean;
  /** Expected default royalty (`null` for none); omitted skips the check. */
  readonly expectedRoyalty?: KeelTezosRoyalty | null;
  readonly fetchImpl?: typeof fetch;
}

/** Read the selected network and verify the published collection, gate binding, presentation and token metadata. */
export async function checkKeelTezosCollectionPublication(input: KeelTezosPublicationCheckInput) {
  assertNoSecrets({ ...input, fetchImpl: undefined });
  const network = assertNetwork(input.network);
  const rpc = readUrl(input.rpcUrl, "rpcUrl");
  const collection = assertContract(input.collection, "collection");
  const fetchImpl = input.fetchImpl ?? fetch;
  const checks: { readonly name: string; readonly ok: boolean; readonly detail?: unknown }[] = [];
  const record = async (name: string, run: () => Promise<{ ok: boolean; detail?: unknown }>) => {
    try { const result = await run(); checks.push({ name, ok: result.ok, ...(result.detail === undefined ? {} : { detail: result.detail }) }); }
    catch (error) { checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) }); }
  };
  const view = async (contract: string, name: string, viewInput: TezosMichelineValue) => {
    const result = await getJson<{ data?: unknown }>(fetchImpl, `${rpc}/chains/main/blocks/head/helpers/scripts/run_script_view`, {
      method: "POST",
      body: JSON.stringify({ contract, view: name, input: viewInput, chain_id: network, unparsing_mode: "Readable" }),
    });
    return result.data;
  };
  let headLevel: number | undefined;
  await record("chain-identity", async () => {
    const chain = await getJson<string>(fetchImpl, `${rpc}/chains/main/chain_id`);
    const header = await getJson<{ level: number; hash?: string }>(fetchImpl, `${rpc}/chains/main/blocks/head/header`);
    headLevel = header.level;
    return { ok: chain === network, detail: { chainId: chain, level: header.level } };
  });
  for (const [label, address] of [["collection", collection], ["oneMint", input.oneMint], ["hold", input.hold], ["index", input.index]] as const) {
    if (address === undefined) continue;
    assertContract(address, label);
    await record(`${label}-originated`, async () => {
      const script = await getJson<{ code?: unknown }>(fetchImpl, `${rpc}/chains/main/blocks/head/context/contracts/${address}/script`);
      return { ok: Array.isArray(script.code), detail: { address } };
    });
  }
  await record("collection-supply", async () => {
    assertKeelTezosView("KeelCollectionFA2", "total_supply");
    const supply = micheline(await view(collection, "total_supply", mUnit));
    return { ok: typeof supply.int === "string", detail: { totalSupply: supply.int } };
  });
  if (input.oneMint !== undefined) {
    await record("one-mint-is-minter", async () => {
      assertKeelTezosView("KeelCollectionFA2", "is_minter");
      const result = micheline(await view(collection, "is_minter", mString(input.oneMint as string)));
      return { ok: result.prim === "True", detail: { minter: input.oneMint } };
    });
  }
  await record("metadata-editing-authority", async () => {
    assertKeelTezosView("KeelCollectionFA2", "token_owner_can_edit");
    const expected = input.expectedHolderMetadataEditing === true;
    const result = micheline(await view(collection, "token_owner_can_edit", mUnit));
    return { ok: result.prim === (expected ? "True" : "False"), detail: { holderMetadataEditing: result.prim === "True", expected } };
  });
  if (input.expectedRoyalty !== undefined) {
    const expected = input.expectedRoyalty === null ? null : royaltyConfig(input.expectedRoyalty, "expectedRoyalty");
    await record("default-royalty", async () => {
      assertKeelTezosView("KeelCollectionFA2", "royalty_info");
      // At a 10000-mutez price the amount equals the basis points exactly.
      const result = micheline(await view(collection, "royalty_info", mPair([mInt(0), mInt(10_000)])));
      if (result.prim === "None") return { ok: expected === null, detail: { royalty: null, expected } };
      const pair = micheline(((result.args as unknown[] | undefined) ?? [])[0]);
      const [receiver, amount] = ((pair.args as unknown[] | undefined) ?? []).map((item) => micheline(item));
      const actual = { receiver: receiver?.string, bps: Number(amount?.int) };
      return { ok: expected !== null && actual.receiver === expected.receiver && actual.bps === expected.bps, detail: { royalty: actual, expected } };
    });
  }
  if (input.expectedManifestDigest !== undefined) {
    await record("default-presentation", async () => {
      assertKeelTezosView("KeelCollectionFA2", "default_presentation");
      const expected = digest32(input.expectedManifestDigest, "expectedManifestDigest");
      const value = JSON.stringify(await view(collection, "default_presentation", mUnit));
      return { ok: value.includes(`"${expected}"`) && value.includes("\"True\""), detail: { expectedManifestDigest: expected } };
    });
  }
  if (input.hold !== undefined && input.expectedObjects !== undefined) {
    for (const objectId of input.expectedObjects) {
      await record(`hold-object-${digest32(objectId, "expectedObjects[]").slice(0, 12)}`, async () => {
        assertKeelTezosView("KeelHoldOnchFS", "get_object");
        const value = JSON.stringify(await view(input.hold as string, "get_object", mBytes(digest32(objectId, "expectedObjects[]"))));
        return { ok: value.length > 2, detail: { objectId } };
      });
    }
  }
  for (const expected of input.expectedTokens ?? []) {
    await record(`token-metadata-${expected.tokenId}`, async () => {
      assertKeelTezosView("KeelCollectionFA2", "token_metadata");
      const decoded = decodeKeelTezosTokenMetadataView(await view(collection, "token_metadata", mInt(natural(expected.tokenId, "tokenId", { positive: true }))));
      const digest = sha256Hex(utf8(JSON.stringify(Object.entries(decoded.tokenInfo).sort(([left], [right]) => left < right ? -1 : 1))));
      const matchesInfo = expected.tokenInfo === undefined || JSON.stringify(Object.entries(expected.tokenInfo).sort(([left], [right]) => left < right ? -1 : 1)) === JSON.stringify(Object.entries(decoded.tokenInfo).sort(([left], [right]) => left < right ? -1 : 1));
      const matchesDigest = expected.tokenInfoSha256 === undefined || hexValue(expected.tokenInfoSha256, "tokenInfoSha256", 32) === digest;
      const selfContained = /^(?:data:|onchfs:\/\/|tezos-storage:)/u.test(decoded.tokenInfo.artifactUri ?? "") && /^(?:data:|onchfs:\/\/|tezos-storage:)/u.test(decoded.tokenInfo.displayUri ?? "");
      return { ok: decoded.tokenId === String(expected.tokenId) && matchesInfo && matchesDigest && selfContained, detail: { tokenInfoSha256: digest, keys: Object.keys(decoded.tokenInfo).sort(), selfContained } };
    });
  }
  if (input.tzktUrl !== undefined) {
    const tzkt = readUrl(input.tzktUrl, "tzktUrl");
    await record("tzkt-head", async () => {
      const head = await getJson<{ chainId?: string; level?: number }>(fetchImpl, `${tzkt}/v1/head`);
      return { ok: head.chainId === network, detail: { chainId: head.chainId, level: head.level, rpcLevel: headLevel } };
    });
    await record("tzkt-collection", async () => {
      const contract = await getJson<{ address?: string; kind?: string; tzips?: string[] }>(fetchImpl, `${tzkt}/v1/contracts/${collection}`);
      return { ok: contract.address === collection, detail: { kind: contract.kind, tzips: contract.tzips } };
    });
    for (const expected of input.expectedTokens ?? []) {
      await record(`tzkt-token-${expected.tokenId}`, async () => {
        const tokens = await getJson<{ tokenId?: string; metadata?: Record<string, unknown> }[]>(fetchImpl, `${tzkt}/v1/tokens?contract=${collection}&tokenId=${natural(expected.tokenId, "tokenId", { positive: true }).toString()}`);
        const token = tokens[0];
        return { ok: token?.tokenId === String(expected.tokenId), detail: { indexedMetadata: token?.metadata === undefined ? "pending" : "present" } };
      });
    }
  }
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "readback" as const,
    family: "tezos" as const,
    network,
    collection,
    checkedAt: new Date().toISOString(),
    checks,
    publicationVerified: checks.length > 0 && checks.every((check) => check.ok),
    note: "Read-only selected-network evidence. It does not replace receipt checks for each applied operation, browser rendering of the artifactUri, or the creator's wallet review.",
  };
}

// ---------------------------------------------------------------------------
// 8. Route plan
// ---------------------------------------------------------------------------

/** The ordered creator route with the receipts each step needs. */
export function planKeelTezosCollectionLaunch(input: { readonly network: string; readonly creator: string; readonly maxSupply: number | string; readonly pilotFirst?: boolean; readonly sharedCreatorProfileRegistry?: string }) {
  assertObject(input, "launch plan");
  const network = assertNetwork(input.network);
  const creator = assertAddress(input.creator, "creator");
  const maxSupply = natural(input.maxSupply, "maxSupply", { positive: true });
  if (input.sharedCreatorProfileRegistry !== undefined) assertContract(input.sharedCreatorProfileRegistry, "sharedCreatorProfileRegistry");
  const pilot = input.pilotFirst !== false;
  const steps = [
    { id: "originate-foundation", tool: "keel-tezos-collection-originate-prepare", sdk: "prepareKeelTezosCollectionOriginations", produces: ["hold", "index", "presentation", ...(input.sharedCreatorProfileRegistry === undefined ? ["creatorProfile"] : [])], requires: input.sharedCreatorProfileRegistry === undefined ? ["manager KT1 for a creator-profile registry"] : [] },
    { id: "originate-collection", tool: "keel-tezos-collection-originate-prepare", sdk: "prepareKeelTezosCollectionOriginations", produces: ["collection", "oneMint"], requires: ["index", "creatorProfile"] },
    { id: "store-resources", tool: "keel-tezos-hold-resources-prepare", sdk: "prepareKeelTezosHoldResources", produces: ["objectIds", "onchfs URIs"], requires: ["hold"] },
    { id: "bind-presentation", tool: "keel-tezos-presentation-bind-prepare", sdk: "prepareKeelTezosPresentationBinding", produces: ["active collection revision", "default_presentation"], requires: ["collection", "index", "manifest object read-back"] },
    { id: "configure-mint-gate", tool: "keel-tezos-mint-gate-prepare", sdk: "prepareKeelTezosMintGate", produces: ["dropId"], requires: ["collection", "oneMint", "creator profile"], note: pilot ? "Create the drop paused (startPaused=true); only the pilot token is minted before read-back." : undefined },
    { id: "mint", tool: "keel-tezos-mint-prepare", sdk: "prepareKeelTezosMint", produces: ["token ids"], requires: ["dropId", "drop unpaused or premint stage"], note: pilot ? "Mint ONE pilot token (premint stage or direct minter) first." : undefined },
    { id: "token-metadata", tool: "keel-tezos-token-metadata-prepare", sdk: "prepareKeelTezosTokenMetadata", produces: ["token_metadata"], requires: ["token ids", "inline html or onchfs:// artifact", "inline or onchfs:// preview"] },
    { id: "readback", tool: "keel-tezos-readback-check", sdk: "checkKeelTezosCollectionPublication", produces: ["publicationVerified"], requires: ["rpcUrl for the selected network", "optional TzKT"] },
    { id: "open-minting", tool: "keel-tezos-mint-gate-prepare", sdk: "prepareKeelTezosMintGateAction", produces: ["unpaused drop"], requires: ["publicationVerified", "browser check of the pilot artifactUri"] },
  ].map((step) => Object.fromEntries(Object.entries(step).filter(([, value]) => value !== undefined)));
  return {
    schema: KEEL_TEZOS_COLLECTION_ROUTE,
    step: "plan" as const,
    status: "review-only" as const,
    family: "tezos" as const,
    network,
    expectedSender: creator,
    maxSupply: maxSupply.toString(),
    contracts: KEEL_TEZOS_COLLECTION_ROUTE_CONTRACTS,
    steps,
    gates: [
      "Every KT1 comes from an applied origination receipt on this exact network.",
      "Every Hold object is read back (get_object / read_file) before presentation or metadata references it.",
      "Token metadata exposes self-contained artifactUri and displayUri (data: or onchfs://); KEEL pointers are refused.",
      "The pilot token passes token_metadata read-back and a browser render before the drop is unpaused.",
      "Token metadata stays creator-administered: holder editing is off unless the creator explicitly enables it.",
    ],
    signing: "not-performed" as const,
    submission: "not-performed" as const,
  };
}

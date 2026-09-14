import { sha256 } from "viem";

/**
 * Review-only Tezos publication primitives.
 *
 * The adapter deliberately stops at wallet approval.  It prepares ordinary
 * Beacon operation details, patches dependent origination storage only from
 * receipt-backed addresses, and reads the selected chain for verification.
 * It never accepts a secret key, mnemonic, or private key.
 */

export const KEEL_TEZOS_PUBLICATION_PROTOCOL = "keel.tezos.publication-plan@1" as const;
export const KEEL_TEZOS_PUBLICATION_NETWORK = "NetXsqzbfFenSTS" as const;
export const KEEL_TEZOS_PUBLICATION_RPC = "https://rpc.shadownet.teztnets.com" as const;
export const KEEL_TEZOS_ADMIN_PLACEHOLDER = "tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx" as const;
export const KEEL_TEZOS_DEPENDENCY_PLACEHOLDER = "KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton" as const;

export type TezosMichelineValue =
  | { readonly bytes: string }
  | { readonly int: string }
  | { readonly string: string }
  | { readonly prim: string; readonly args?: readonly TezosMichelineValue[]; readonly annots?: readonly string[] }
  | readonly TezosMichelineValue[];

export interface TezosMichelsonScript {
  readonly code: readonly TezosMichelineValue[];
  readonly storage: TezosMichelineValue;
}

export interface TezosOperationDetailsBase {
  readonly kind: "origination" | "transaction";
  readonly amount?: string;
  readonly balance?: string;
  readonly destination?: string;
  readonly parameters?: { readonly entrypoint: string; readonly value: TezosMichelineValue };
  readonly script?: TezosMichelsonScript;
}

export interface TezosArtifactTemplate {
  readonly key: string;
  readonly label: string;
  readonly script: TezosMichelsonScript;
  readonly dependency?: string;
}

export interface TezosOriginationsInput {
  readonly creator: string;
  readonly network: string;
  readonly artifacts: Readonly<Record<string, TezosArtifactTemplate>>;
}

export interface TezosOriginationsPlan {
  readonly protocol: typeof KEEL_TEZOS_PUBLICATION_PROTOCOL;
  readonly status: "review-only";
  readonly network: string;
  readonly expectedSender: string;
  readonly signing: "not-performed";
  readonly submission: "not-performed";
  readonly stages: readonly {
    readonly id: string;
    readonly purpose: string;
    readonly requiresReceipts: readonly string[];
    readonly operations: readonly {
      readonly label: string;
      readonly artifact: string;
      readonly dependsOn: readonly string[];
      readonly operation: TezosOperationDetailsBase | null;
      readonly unresolvedBindings?: readonly string[];
    }[];
  }[];
  readonly addressBindings: readonly { readonly name: string; readonly source: "operation-receipt"; readonly requiredBefore: string }[];
}

export interface TezosTransactionOperation {
  readonly kind: "transaction";
  readonly amount: string;
  readonly destination: string;
  readonly parameters: { readonly entrypoint: string; readonly value: TezosMichelineValue };
}

export interface TezosCarrierChunkInscription {
  readonly type: "chunk";
  readonly content: string;
  readonly hash: string;
}

export interface TezosCarrierFileInscription {
  readonly type: "file";
  readonly cid: string;
  readonly metadata: string;
  readonly chunks: readonly string[];
}

export interface TezosCarrierDirectoryInscription {
  readonly type: "directory";
  readonly cid: string;
  readonly files: Readonly<Record<string, string>>;
}

export type TezosCarrierInscription = TezosCarrierChunkInscription | TezosCarrierFileInscription | TezosCarrierDirectoryInscription;

export interface TezosCarrierBinding {
  readonly objectId: string;
  readonly fileCid: string;
  readonly manifest: string;
  readonly manifestSha256: string;
  readonly storedSha256: string;
  readonly storedByteLength: number;
  readonly decodedSha256: string;
  readonly decodedByteLength: number;
  readonly mediaType: string;
  readonly compression: string;
}

export interface TezosCarrierDocument {
  readonly inscriptions: readonly TezosCarrierInscription[];
  readonly keelObjects: readonly TezosCarrierBinding[];
}

const TEZOS_ADDRESS = /^(?:tz[1-4]|KT1)[1-9A-HJ-NP-Za-km-z]{33}$/u;
const TEZOS_NETWORK = /^Net[1-9A-HJ-NP-Za-km-z]{12}$/u;
const HEX = /^[0-9a-fA-F]*$/u;
const SECRET_KEY = /(?:private|secret|mnemonic|seed|passphrase)/iu;

function assertAddress(value: string, label: string): void {
  if (typeof value !== "string" || !TEZOS_ADDRESS.test(value)) throw new TypeError(`${label} must be a Tezos tz or KT1 address.`);
}

function assertNetwork(value: string): void {
  if (typeof value !== "string" || !TEZOS_NETWORK.test(value)) throw new TypeError("network must be an exact Tezos Net... identity.");
}

function assertHex(value: string, label: string, bytes?: number): string {
  if (typeof value !== "string" || !HEX.test(value) || (value.length % 2) !== 0 || (bytes !== undefined && value.length !== bytes * 2)) throw new TypeError(`${label} must be canonical hex.`);
  return value.toLowerCase();
}

function bytes(value: string): { readonly bytes: string } {
  return { bytes: assertHex(value, "bytes") };
}

function int(value: number | bigint | string): { readonly int: string } {
  const result = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(result)) throw new TypeError("Micheline integer must be a nonnegative decimal string.");
  return { int: result };
}

function stringValue(value: string): { readonly string: string } {
  if (typeof value !== "string") throw new TypeError("Micheline string must be a string.");
  return { string: value };
}

function pair(values: readonly TezosMichelineValue[]): TezosMichelineValue {
  if (values.length < 2) throw new TypeError("A Micheline pair needs at least two values.");
  let result = values[values.length - 1] as TezosMichelineValue;
  for (let index = values.length - 2; index >= 0; index -= 1) result = { prim: "Pair", args: [values[index] as TezosMichelineValue, result] };
  return result;
}

function list(values: readonly TezosMichelineValue[]): TezosMichelineValue {
  return values;
}

function map(entries: readonly (readonly [string, TezosMichelineValue])[]): TezosMichelineValue {
  // Micheline map literals must be strictly ordered by their comparable key;
  // Tezos rejects an otherwise valid NFT token_info map as
  // `unordered_map_literal` during simulation.
  return [...entries]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => ({ prim: "Elt", args: [stringValue(key), value] }));
}

function hexBytes(value: string, label: string): { readonly bytes: string } {
  return bytes(assertHex(value.replace(/^0x/u, ""), label));
}

function utf8Hex(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function replaceAddressStrings(value: TezosMichelineValue, replacements: Readonly<Record<string, string>>): TezosMichelineValue {
  if (Array.isArray(value)) return value.map((item) => replaceAddressStrings(item, replacements));
  if (typeof value !== "object" || value === null) return value;
  const node = value as Exclude<TezosMichelineValue, readonly TezosMichelineValue[]>;
  if ("string" in node) return { string: replacements[node.string] ?? node.string };
  if ("bytes" in node || "int" in node) return node;
  return {
    ...node,
    ...(node.args === undefined ? {} : { args: node.args.map((item) => replaceAddressStrings(item, replacements)) }),
  };
}

function assertNoSecrets(value: unknown, path = "input"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new TypeError(`Secret-bearing field is not accepted: ${path}.${key}`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function artifactOperation(artifact: TezosArtifactTemplate, creator: string, bindings: Readonly<Record<string, string>>): TezosOperationDetailsBase {
  const replacements: Record<string, string> = { [KEEL_TEZOS_ADMIN_PLACEHOLDER]: creator };
  if (artifact.dependency !== undefined) replacements[KEEL_TEZOS_DEPENDENCY_PLACEHOLDER] = bindings[artifact.dependency] as string;
  return { kind: "origination", balance: "0", script: { code: artifact.script.code, storage: replaceAddressStrings(artifact.script.storage, replacements) } };
}

/** Prepare the two-stage originations without inventing a KT1 address. */
export function buildTezosOneOfOneOriginations(input: TezosOriginationsInput): TezosOriginationsPlan {
  assertNoSecrets(input);
  assertAddress(input.creator, "creator");
  assertNetwork(input.network);
  const required = ["hold", "index", "shell", "collection"];
  for (const key of required) if (input.artifacts[key] === undefined) throw new TypeError(`Missing standard Tezos artifact: ${key}`);
  const independent = ["hold", "index"].filter((key) => input.artifacts[key] !== undefined);
  const dependent = ["shell", "collection"].filter((key) => input.artifacts[key] !== undefined);
  const makeStage = (id: string, purpose: string, keys: readonly string[], bindings: Readonly<Record<string, string>> = {}, requiredReceipts: readonly string[] = Object.keys(bindings)) => ({
    id,
    purpose,
    requiresReceipts: requiredReceipts,
    operations: keys.map((key) => {
      const artifact = input.artifacts[key] as TezosArtifactTemplate;
      const dependency = artifact.dependency === undefined ? [] : [artifact.dependency];
      const unresolvedBindings = dependency.filter((name) => bindings[name] === undefined);
      return {
        label: artifact.label,
        artifact: key,
        dependsOn: dependency,
        operation: unresolvedBindings.length === 0 ? artifactOperation(artifact, input.creator, bindings) : null,
        ...(unresolvedBindings.length === 0 ? {} : { unresolvedBindings }),
      };
    }),
  });
  return {
    protocol: KEEL_TEZOS_PUBLICATION_PROTOCOL,
    status: "review-only",
    network: input.network,
    expectedSender: input.creator,
    signing: "not-performed",
    submission: "not-performed",
    stages: [
      makeStage("originate-foundation", "Originate the shared KEEL Hold and revision index; no dependent KT1 address is assumed.", independent),
      makeStage("originate-dependent", "Originate the shell carrier and 1/1 FA2 only after the foundation receipts bind their addresses.", dependent, {}, ["hold", "index"]),
    ],
    addressBindings: [
      { name: "hold", source: "operation-receipt", requiredBefore: "originate-dependent" },
      { name: "index", source: "operation-receipt", requiredBefore: "originate-dependent" },
      { name: "shell", source: "operation-receipt", requiredBefore: "configure-and-publish" },
      { name: "collection", source: "operation-receipt", requiredBefore: "configure-and-publish" },
    ],
  };
}

/** Rebind a dependent storage template after the originating receipt is known. */
export function prepareTezosDependentOriginations(input: TezosOriginationsInput, bindings: Readonly<Record<string, string>>, keys: readonly string[] = ["shell", "collection"]): readonly TezosOperationDetailsBase[] {
  assertNoSecrets(input);
  assertAddress(input.creator, "creator");
  for (const name of keys) {
    const artifact = input.artifacts[name];
    if (artifact === undefined) throw new TypeError(`Unknown Tezos artifact: ${name}`);
    if (artifact.dependency !== undefined && bindings[artifact.dependency] === undefined) throw new TypeError(`Missing receipt-backed binding: ${artifact.dependency}`);
  }
  return keys.map((key) => artifactOperation(input.artifacts[key] as TezosArtifactTemplate, input.creator, bindings));
}

/** Build the exact standard OnchFS writes and Keel object welds for a carrier. */
export function buildKeelHoldCarrierOperations(input: { readonly hold: string; readonly source: string; readonly document: TezosCarrierDocument }): readonly TezosTransactionOperation[] {
  assertNoSecrets(input);
  assertAddress(input.hold, "hold");
  assertAddress(input.source, "source");
  const operations: TezosTransactionOperation[] = [];
  const chunks = input.document.inscriptions.filter((item): item is TezosCarrierChunkInscription => item.type === "chunk");
  const files = input.document.inscriptions.filter((item): item is TezosCarrierFileInscription => item.type === "file");
  const directories = input.document.inscriptions.filter((item): item is TezosCarrierDirectoryInscription => item.type === "directory");
  for (const chunk of chunks) operations.push({ kind: "transaction", amount: "0", destination: input.hold, parameters: { entrypoint: "write_chunk", value: hexBytes(chunk.content, "chunk content") } });
  for (const file of files) operations.push({ kind: "transaction", amount: "0", destination: input.hold, parameters: { entrypoint: "create_file", value: pair([list(file.chunks.map((chunk) => hexBytes(chunk, "chunk pointer"))), hexBytes(file.metadata, "file metadata")]) } });
  for (const directory of directories) operations.push({ kind: "transaction", amount: "0", destination: input.hold, parameters: { entrypoint: "create_directory", value: map(Object.entries(directory.files).map(([name, cid]) => [name, hexBytes(cid, "directory child CID")])) } });
  for (const object of input.document.keelObjects) {
    operations.push({
      kind: "transaction",
      amount: "0",
      destination: input.hold,
      parameters: {
        entrypoint: "weld_object",
        value: pair([
          hexBytes(utf8Hex(object.compression), "compression"),
          int(object.decodedByteLength),
          hexBytes(object.decodedSha256, "decoded digest"),
          hexBytes(object.fileCid, "file CID"),
          hexBytes(object.manifest, "object manifest"),
          hexBytes(object.manifestSha256, "manifest digest"),
          hexBytes(utf8Hex(object.mediaType), "media type"),
          hexBytes(object.objectId, "object id"),
          int(object.storedByteLength),
          hexBytes(object.storedSha256, "stored digest"),
        ]),
      },
    });
  }
  return operations;
}

export function buildKeelHoldConfigureVerifier(input: { readonly hold: string; readonly source: string; readonly prefixObjectId: string; readonly suffixObjectId: string; readonly protocol?: string }): TezosTransactionOperation {
  assertAddress(input.hold, "hold");
  assertAddress(input.source, "source");
  return { kind: "transaction", amount: "0", destination: input.hold, parameters: { entrypoint: "configure_verifier", value: pair([hexBytes(input.prefixObjectId, "prefix object id"), hexBytes(input.suffixObjectId, "suffix object id"), hexBytes(utf8Hex(input.protocol ?? "keel.verification-shell.v1"), "verifier protocol")]) } };
}

export function buildKeelForgeHarness(input: { readonly hold: string; readonly source: string; readonly salt: string; readonly slotObjectIds: readonly string[]; readonly manifestSha256: string }): TezosTransactionOperation {
  assertAddress(input.hold, "hold");
  assertAddress(input.source, "source");
  return { kind: "transaction", amount: "0", destination: input.hold, parameters: { entrypoint: "forge_harness", value: pair([hexBytes(input.salt, "harness salt"), hexBytes(input.manifestSha256, "harness digest"), list(input.slotObjectIds.map((id) => hexBytes(id, "slot object id")))]) } };
}

export function buildKeelIndexRegisterCollection(input: { readonly index: string; readonly source: string; readonly collection: string; readonly controller?: string }): TezosTransactionOperation {
  assertAddress(input.index, "index");
  assertAddress(input.source, "source");
  assertAddress(input.collection, "collection");
  const controller = input.controller ?? input.source;
  assertAddress(controller, "controller");
  return { kind: "transaction", amount: "0", destination: input.index, parameters: { entrypoint: "register_collection", value: pair([stringValue(input.collection), stringValue(controller)]) } };
}

export function buildKeelIndexPublishCollection(input: { readonly index: string; readonly source: string; readonly collection: string; readonly manifestUri: string; readonly manifestDigest: string; readonly parentRevision?: number; readonly compatibilityMin?: number; readonly compatibilityMax?: number; readonly policy?: number; readonly activationTime?: number }): TezosTransactionOperation {
  assertAddress(input.index, "index");
  assertAddress(input.source, "source");
  assertAddress(input.collection, "collection");
  const compatibilityMin = input.compatibilityMin ?? 1;
  const compatibilityMax = input.compatibilityMax ?? compatibilityMin;
  return {
    kind: "transaction",
    amount: "0",
    destination: input.index,
    parameters: {
      entrypoint: "publish_collection_revision",
      value: pair([
        int(input.activationTime ?? 0),
        stringValue(input.collection),
        int(compatibilityMax),
        int(compatibilityMin),
        hexBytes(input.manifestDigest, "manifest digest"),
        hexBytes(utf8Hex(input.manifestUri), "manifest URI"),
        int(input.parentRevision ?? 0),
        int(input.policy ?? 0),
      ]),
    },
  };
}

export function buildKeelIndexActivateCollection(input: { readonly index: string; readonly source: string; readonly collection: string; readonly revision?: number }): TezosTransactionOperation {
  assertAddress(input.index, "index");
  assertAddress(input.source, "source");
  assertAddress(input.collection, "collection");
  return { kind: "transaction", amount: "0", destination: input.index, parameters: { entrypoint: "activate_collection_revision", value: pair([stringValue(input.collection), int(input.revision ?? 1)]) } };
}

export function buildKeelCollectionSetMinter(input: { readonly collection: string; readonly source: string; readonly account?: string; readonly enabled?: boolean }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const account = input.account ?? input.source;
  assertAddress(account, "account");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "set_minter", value: pair([stringValue(account), { prim: input.enabled === false ? "False" : "True" }]) } };
}

export function buildKeelCollectionPresentation(input: { readonly collection: string; readonly source: string; readonly manifestUri: string; readonly manifestDigest: string; readonly previewUri?: string }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "set_default_presentation", value: pair([hexBytes(utf8Hex(input.manifestUri), "manifest URI"), hexBytes(input.manifestDigest, "manifest digest"), hexBytes(utf8Hex(input.previewUri ?? input.manifestUri), "preview URI")]) } };
}

export function buildKeelCollectionStrike(input: { readonly collection: string; readonly source: string; readonly recipient?: string; readonly quantity?: number }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const recipient = input.recipient ?? input.source;
  assertAddress(recipient, "recipient");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "strike", value: pair([stringValue(recipient), int(input.quantity ?? 1)]) } };
}

/**
 * Write the ordinary FA2/TZIP token_info map for a minted token.
 *
 * `animation_url` and `artifactUri` are intentionally opaque standard URI
 * fields here.  The caller may select `onchfs://<file-cid>`, `ipfs://...`,
 * `tezos-storage:...`, or another resolver-supported standard carrier.  A
 * `keel+tezos://` URI is not a public standard carrier and is therefore not
 * generated by this helper; the KEEL harness route remains a separate
 * compatibility field in the metadata.
 */
export function buildKeelCollectionSetTokenMetadata(input: { readonly collection: string; readonly source: string; readonly tokenId?: number; readonly tokenInfo: Readonly<Record<string, string>> }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const tokenId = input.tokenId ?? 1;
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos tokenId must be a positive integer.");
  const entries = Object.entries(input.tokenInfo).map(([key, value]) => [key, hexBytes(utf8Hex(value), `Tezos token_info.${key}`)] as const);
  if (entries.length === 0) throw new TypeError("Tezos token_info must contain at least one field.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "set_token_metadata", value: pair([int(tokenId), map(entries)]) } };
}

/** Store the small raw JSON compatibility document consumed by KeelSleeve. */
export function buildKeelCollectionSetTokenJson(input: { readonly collection: string; readonly source: string; readonly tokenId?: number; readonly value: string }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const tokenId = input.tokenId ?? 1;
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos tokenId must be a positive integer.");
  if (input.value.length === 0) throw new TypeError("Tezos token JSON must not be empty.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "set_token_json", value: pair([int(tokenId), stringValue(input.value)]) } };
}

/** Permanently weld the selected public token metadata and compatibility JSON. */
export function buildKeelCollectionFreezeTokenMetadata(input: { readonly collection: string; readonly source: string; readonly tokenId?: number }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const tokenId = input.tokenId ?? 1;
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos tokenId must be a positive integer.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "freeze_token_metadata", value: int(tokenId) } };
}

/**
 * Build the release/mint calls used by the prototype's native Tezos NFT lane.
 *
 * This is intentionally separate from `strike`: the FA2 NFT prototype stores
 * `ledger` as `token_id -> owner` and commits a relative TZIP-12 metadata URI
 * before the first mint. A one-unit balance in a multi-asset ledger is not the
 * same storage contract and is not treated as an NFT by Tezos indexers.
 */
export function buildKeelTezosNftStoreContent(input: { readonly collection: string; readonly source: string; readonly key: string; readonly value: string }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  if (input.key.length === 0 || input.key.includes("/")) throw new TypeError("Tezos NFT metadata key must be a non-empty single path segment.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "store_content", value: pair([stringValue(input.key), hexBytes(input.value, "Tezos NFT metadata bytes")]) } };
}

export function buildKeelTezosNftPrepareRelease(input: { readonly collection: string; readonly source: string; readonly tokenId?: number; readonly maximumSupply?: number; readonly tokenInfo: Readonly<Record<string, string>> }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const tokenId = input.tokenId ?? 1;
  const maximumSupply = input.maximumSupply ?? 1;
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos NFT tokenId must be a positive integer.");
  if (!Number.isSafeInteger(maximumSupply) || maximumSupply !== 1) throw new TypeError("Tezos one-of-one maximumSupply must be 1.");
  const entries = Object.entries(input.tokenInfo).map(([key, value]) => [key, hexBytes(value, `Tezos NFT token_info.${key}`)] as const);
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "prepare_release", value: pair([int(maximumSupply), pair([int(tokenId), map(entries)])]) } };
}

export function buildKeelTezosNftReserveRelease(input: { readonly collection: string; readonly source: string; readonly tokenId?: number; readonly expectedMaximumSupply?: number; readonly expectedMetadataUri: string }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const tokenId = input.tokenId ?? 1;
  const expectedMaximumSupply = input.expectedMaximumSupply ?? 1;
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos NFT tokenId must be a positive integer.");
  if (!Number.isSafeInteger(expectedMaximumSupply) || expectedMaximumSupply !== 1) throw new TypeError("Tezos one-of-one expectedMaximumSupply must be 1.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "reserve_release", value: pair([int(expectedMaximumSupply), pair([hexBytes(utf8Hex(input.expectedMetadataUri), "Tezos NFT metadata URI"), int(tokenId)])]) } };
}

export function buildKeelTezosNftMint(input: { readonly collection: string; readonly source: string; readonly recipient?: string; readonly tokenId?: number }): TezosTransactionOperation {
  assertAddress(input.collection, "collection");
  assertAddress(input.source, "source");
  const recipient = input.recipient ?? input.source;
  const tokenId = input.tokenId ?? 1;
  assertAddress(recipient, "recipient");
  if (!Number.isSafeInteger(tokenId) || tokenId < 1) throw new TypeError("Tezos NFT tokenId must be a positive integer.");
  return { kind: "transaction", amount: "0", destination: input.collection, parameters: { entrypoint: "mint", value: pair([stringValue(recipient), int(tokenId)]) } };
}

/** Prepare the compiled prototype NFT origination without inventing an address. */
export function buildTezosNftCollectionOrigination(input: { readonly creator: string; readonly network: string; readonly code: readonly TezosMichelineValue[]; readonly storage: TezosMichelineValue }): TezosOperationDetailsBase {
  assertNoSecrets(input);
  assertAddress(input.creator, "creator");
  assertNetwork(input.network);
  return {
    kind: "origination",
    balance: "0",
    script: {
      code: input.code,
      storage: replaceAddressStrings(input.storage, { [KEEL_TEZOS_ADMIN_PLACEHOLDER]: input.creator }),
    },
  };
}

export interface TezosRpcAdapterOptions {
  readonly rpcUrl: string;
  readonly network: string;
  readonly fetchImpl?: typeof fetch;
}

export class KeelTezosPublicationAdapter {
  readonly rpcUrl: string;
  readonly network: string;
  readonly fetchImpl: typeof fetch;

  constructor(options: TezosRpcAdapterOptions) {
    assertNetwork(options.network);
    const url = new URL(options.rpcUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new TypeError("Tezos RPC must use HTTPS unless it is local.");
    this.rpcUrl = options.rpcUrl.replace(/\/$/u, "");
    this.network = options.network;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async get<T = unknown>(path: string): Promise<T> {
    if (!path.startsWith("/")) throw new TypeError("Tezos RPC paths must be absolute.");
    const response = await this.fetchImpl(`${this.rpcUrl}${path}`, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Tezos RPC ${response.status} for ${path}`);
    return await response.json() as T;
  }

  async preflight(address: string): Promise<{ readonly address: string; readonly network: string; readonly chainId: string; readonly head: { readonly level: number; readonly hash: string; readonly timestamp: string }; readonly balanceMutez: string }> {
    assertAddress(address, "address");
    const [chainId, header, balance] = await Promise.all([
      this.get<string>("/chains/main/chain_id"),
      this.get<{ readonly level: number; readonly hash?: string; readonly timestamp: string }>("/chains/main/blocks/head/header"),
      this.get<string>(`/chains/main/blocks/head/context/contracts/${address}/balance`),
    ]);
    return { address, network: this.network, chainId, head: { level: header.level, hash: header.hash ?? "", timestamp: header.timestamp }, balanceMutez: balance };
  }

  async storage(address: string): Promise<unknown> {
    assertAddress(address, "contract");
    return await this.get(`/chains/main/blocks/head/context/contracts/${address}/storage`);
  }

  async view(address: string, view: string, input: TezosMichelineValue): Promise<unknown> {
    assertAddress(address, "contract");
    if (!/^[a-zA-Z0-9_.-]{1,31}$/u.test(view)) throw new TypeError("Tezos view name is invalid.");
    const response = await this.fetchImpl(`${this.rpcUrl}/chains/main/blocks/head/helpers/scripts/run_script_view`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ contract: address, view, input, chain_id: this.network, unparsing_mode: "Readable" }),
    });
    if (!response.ok) throw new Error(`Tezos RPC ${response.status} for view ${view}`);
    const result = await response.json() as { readonly data?: unknown };
    return result.data ?? result;
  }
}

/** Fail closed on operation receipt mismatches; this is not a signing helper. */
export function assertTezosAppliedReceipt(receipt: { readonly hash: string; readonly contents: readonly { readonly metadata?: { readonly operation_result?: { readonly status?: string }; readonly internal_operation_results?: readonly { readonly result?: { readonly status?: string } }[] } }[] }, expectedHash: string): void {
  if (receipt.hash !== expectedHash) throw new Error("Tezos receipt hash does not match the submitted wallet operation.");
  const applied = receipt.contents.length > 0 && receipt.contents.every((content) => content.metadata?.operation_result?.status === "applied" && (content.metadata.internal_operation_results ?? []).every((inner) => inner.result?.status === "applied"));
  if (!applied) throw new Error("Tezos operation was included but did not apply.");
}

export function digestMicheline(value: unknown): string {
  return sha256(`0x${utf8Hex(JSON.stringify(value))}` as `0x${string}`);
}

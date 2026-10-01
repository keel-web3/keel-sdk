import { getAddress, keccak256, parseAbi, toBytes, toHex, type Address, type Hex } from "viem";

/**
 * One model for every contract a creator works with, shared by Studio, the
 * KEEL editor and agents.
 *
 * A contract is identified by chain and address only. What it IS comes from
 * on-chain evidence (code, proxy slots, ERC-165) and from where it was found
 * (a factory record, an indexed event, a release, a FRAY auction, or the
 * creator adding it). What the creator CALLS it (label, category, tags,
 * notes) is theirs to change and never changes the identity.
 *
 * Shared KEEL contracts (the shared ERC-1155, the FRAY auction house, sale
 * controllers) hold many creators' work. They appear here because the
 * creator has logical collections inside them, and each of those collections
 * is listed and nameable on its own.
 */

export const KEEL_CONTRACT_REGISTRY_PROTOCOL = "keel-contract-registry@1" as const;

export type KeelContractFamily =
  /** A collection contract that belongs to this creator: a factory clone, a legacy die, or one they deployed. */
  | "creator-collection"
  /** A KEEL contract that holds many creators' collections, such as the shared ERC-1155. */
  | "shared-collection"
  /** A FRAY auction house; the creator's auctions are its logical collections. */
  | "fray-auction"
  /** A sale or drop controller; the creator's drops are its logical collections. */
  | "drop-controller"
  /** KEEL infrastructure (factories, registries, renderers) shown for reference. */
  | "infrastructure"
  /** Anything else the creator manages. */
  | "custom";

export type KeelContractStandard = "erc721" | "erc1155" | "erc20" | "unknown";
export type KeelProxyKind = "none" | "eip1967" | "beacon" | "minimal-clone";
export type KeelContractSource = "factory" | "indexer" | "release" | "drop" | "fray" | "manual" | "agent";

export interface KeelContractProxy {
  readonly kind: KeelProxyKind;
  /** Both the EIP-1967 implementation and beacon slots are set: the contract is unusual and needs review. */
  readonly conflict?: true;
  readonly implementation?: Address;
  readonly admin?: Address;
  readonly beacon?: Address;
}

/** A collection, drop, auction or token range that lives inside one contract. */
export interface KeelLogicalCollection {
  /** Stable within the contract: "factory:12", "shared:3", "die", "drop:0x…", "auction:7", "custom:…". */
  readonly key: string;
  readonly kind: "factory-collection" | "shared-collection" | "die-collection" | "drop" | "fray-auction" | "token-range" | "custom";
  readonly name: string;
  /** The on-chain id for this kind: factory collection id, shared collection id, drop id or auction id. */
  readonly externalId?: string;
  /** Inclusive token id bounds when they are known exactly (decimal strings). */
  readonly tokenIds?: { readonly from?: string; readonly to?: string };
  readonly open?: boolean;
  readonly source: KeelContractSource;
  /** Creator-chosen display name; `name` keeps the on-chain or discovered name. */
  readonly label?: string;
  readonly tags?: readonly string[];
}

export type KeelSignerFlow = "wallet" | "eip712-authorization" | "agent-grant" | "bridge" | "server-signer";

/** Someone or something allowed to act for a contract, and how that permission is exercised. */
export interface KeelContractSigner {
  readonly id: string;
  readonly address?: Address;
  readonly role: "owner" | "admin" | "minter" | "stage-signer" | "agent" | "custom";
  readonly flow: KeelSignerFlow;
  readonly label: string;
  /** For bridge flows: which relay serves the requests, and when it was last seen. */
  readonly bridge?: { readonly server: string; readonly queue: string; readonly lastSeenAt?: string };
  readonly status: "active" | "pending" | "revoked" | "unverified";
}

export interface KeelContractOrganization {
  readonly label?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}

export interface KeelContractEntry extends KeelContractOrganization {
  readonly protocol: typeof KEEL_CONTRACT_REGISTRY_PROTOCOL;
  /** `${chainId}:${lowercase address}` */
  readonly key: string;
  readonly chainId: number;
  readonly address: Address;
  readonly family: KeelContractFamily;
  readonly standard: KeelContractStandard;
  readonly deployment: "dedicated" | "shared" | "external" | "standalone";
  readonly proxy: KeelContractProxy;
  /** What the contract reports or what discovery found, before the creator renames it. */
  readonly name: string;
  readonly symbol?: string;
  /** Which KEEL ABI fits, when known (e.g. "keel721", "keel-creator-721a", "keel-shared-1155", "one-mint-controller"). */
  readonly abiId?: string;
  readonly sources: readonly KeelContractSource[];
  readonly collections: readonly KeelLogicalCollection[];
  readonly signers: readonly KeelContractSigner[];
}

/* ---------------------------------------------------------------- ABIs */

/** Events a registry indexer needs from KeelCreatorFactory (keel-die). */
export const keelCreatorFactoryRegistryAbi = parseAbi([
  "event CreatorCollectionRegistered(bool mintCompatible, uint8 standard, uint8 deployment, string name, uint256 indexed collectionId, address indexed creator, address indexed tokenContract, uint128 sharedCollectionId, bytes32 metadataDigest)",
  "event CreatorCollectionTransferred(uint256 indexed collectionId, address indexed creator, address indexed previousCreator)",
  "event CreatorCollectionClosed(bool enforcedOnToken, uint256 indexed collectionId, address indexed tokenContract, uint128 sharedCollectionId)",
  "event CreatorERC721ImplementationSelected(uint8 kind, uint256 indexed collectionId, address indexed tokenContract)",
  "event DeferredCollectionCreated(bool patrons, uint256 collectionId, address indexed tokenContract, bytes32 indexed reservationId)",
  "function collection(uint256 collectionId) view returns ((address creator, address tokenContract, uint128 sharedCollectionId, uint64 createdAt, uint8 standard, uint8 deployment, bool open, bool mintCompatible, string name, bytes32 metadataDigest))",
  "function creatorCollectionIds(address creator) view returns (uint256[])",
  "function creatorCollectionCount(address creator) view returns (uint256)",
  "function erc721ImplementationKind(uint256 collectionId) view returns (uint8)",
  "function shared1155() view returns (address)",
  "function metadataRenderer() view returns (address)",
  "function implementation721() view returns (address)",
  "function implementationStandard721() view returns (address)",
  "function implementation1155() view returns (address)",
  "function implementationSeeded721() view returns (address)",
]);

/** Events a registry indexer needs from KeelShared1155. */
export const keelShared1155RegistryAbi = parseAbi([
  "event SharedCollectionCreated(string name, uint128 indexed collectionId, address indexed creator)",
  "event SharedItemCreated(uint128 indexed itemIndex, uint128 indexed collectionId, uint256 indexed tokenId, uint256 maxSupply)",
  "event SharedCollectionCreatorTransferred(uint128 indexed collectionId, address indexed creator, address indexed previousCreator)",
  "event SharedCollectionClosedPermanently(uint128 indexed collectionId)",
  "event SharedItemClosedPermanently(uint256 indexed tokenId)",
]);

/** The OneMint event that binds a drop to the exact token contract (and ERC-1155 item) it mints. */
export const keelDropTargetAbi = parseAbi([
  "event DropTargetBound(bytes32 indexed dropId, address indexed target, uint256 indexed tokenId, bool itemized)",
]);

/* ---------------------------------------------------------------- identity */

export function keelContractKey(chainId: number, address: string): string {
  if (!Number.isSafeInteger(chainId) || chainId < 1) throw new TypeError("A positive chain id is required.");
  return `${chainId}:${getAddress(address).toLowerCase()}`;
}

/* ---------------------------------------------------------------- shared ids */

const SHARED_SHIFT = 128n;

/** Every token of shared collection `id` lies in [id << 128, ((id + 1) << 128) - 1]. */
export function keelSharedCollectionTokenRange(sharedCollectionId: bigint | string): { readonly from: string; readonly to: string } {
  const id = BigInt(sharedCollectionId);
  if (id < 0n || id >= 1n << SHARED_SHIFT) throw new RangeError("Shared collection id is out of range.");
  return { from: (id << SHARED_SHIFT).toString(), to: (((id + 1n) << SHARED_SHIFT) - 1n).toString() };
}

/* ---------------------------------------------------------------- inspection */

/** The read surface inspection needs; a viem PublicClient satisfies it. */
export interface KeelContractReader {
  getCode(input: { address: Address; blockNumber?: bigint }): Promise<Hex | undefined>;
  getStorageAt(input: { address: Address; slot: Hex; blockNumber?: bigint }): Promise<Hex | undefined>;
  readContract(input: { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[]; blockNumber?: bigint }): Promise<unknown>;
  getBlockNumber(): Promise<bigint>;
}

const eip1967Slot = (name: string): Hex => toHex(BigInt(keccak256(toBytes(`eip1967.proxy.${name}`))) - 1n, { size: 32 });
export const EIP1967_IMPLEMENTATION_SLOT = eip1967Slot("implementation");
export const EIP1967_ADMIN_SLOT = eip1967Slot("admin");
export const EIP1967_BEACON_SLOT = eip1967Slot("beacon");
const MINIMAL_CLONE = /^0x363d3d373d3d3d363d73([0-9a-fA-F]{40})5af43d82803e903d91602b57fd5bf3$/u;

export const ERC165_INTERFACES = { erc165: "0x01ffc9a7", erc721: "0x80ac58cd", erc721Metadata: "0x5b5e139f", erc1155: "0xd9b67a26", erc2981: "0x2a55205a", accessControl: "0x7965db0b" } as const;

const supportsInterfaceAbi = [{ type: "function", name: "supportsInterface", stateMutability: "view", inputs: [{ name: "interfaceId", type: "bytes4" }], outputs: [{ type: "bool" }] }] as const;
const textAbi = (name: string) => [{ type: "function", name, stateMutability: "view", inputs: [], outputs: [{ type: "string" }] }] as const;
const ownerAbi = [{ type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const implementationAbi = [{ type: "function", name: "implementation", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;

export interface KeelContractInspection {
  readonly chainId: number;
  readonly address: Address;
  readonly blockNumber: string;
  readonly hasCode: boolean;
  readonly codeHash?: Hex;
  readonly codeSize: number;
  readonly proxy: KeelContractProxy;
  readonly interfaces: Readonly<Record<keyof typeof ERC165_INTERFACES, boolean>>;
  readonly standard: KeelContractStandard;
  readonly name?: string;
  readonly symbol?: string;
  readonly owner?: Address;
  /** Evidence, not authority: a successful read is not proof of who controls the contract. */
  readonly authority: "unverified";
}

function slotAddress(value: Hex | undefined): Address | undefined {
  if (!value || /^0x0*$/u.test(value)) return undefined;
  return getAddress(`0x${value.slice(-40)}`);
}

const TRANSPORT_ERRORS: ReadonlySet<string> = new Set(["HttpRequestError", "WebSocketRequestError", "SocketClosedError", "TimeoutError", "LimitExceededRpcError", "ResourceUnavailableRpcError"]);

/**
 * True when a read failed because the network didn't answer, not because the
 * contract said no. Optional probes treat a revert as "not supported" but must
 * not turn an outage into a wrong (and cached) answer.
 */
export function isKeelTransportFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && typeof current === "object" && depth < 8; depth += 1) {
    const { name, cause } = current as { readonly name?: unknown; readonly cause?: unknown };
    if (typeof name === "string" && TRANSPORT_ERRORS.has(name)) return true;
    current = cause;
  }
  return false;
}

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try { return await read(); } catch (error) {
    if (isKeelTransportFailure(error)) throw error;
    return undefined;
  }
}

/**
 * Reads what a contract is at one block: code, proxy relationship (EIP-1967
 * implementation or beacon, or an EIP-1167 minimal clone), ERC-165 support,
 * and name, symbol and owner when it answers them. Never throws for a
 * contract that simply lacks an optional function.
 */
export async function inspectKeelContract(reader: KeelContractReader, input: { readonly chainId: number; readonly address: string; readonly blockNumber?: bigint }): Promise<KeelContractInspection> {
  const address = getAddress(input.address);
  const blockNumber = input.blockNumber ?? await reader.getBlockNumber();
  const at = { blockNumber };
  const code = await reader.getCode({ address, ...at });
  const empty = Object.fromEntries(Object.keys(ERC165_INTERFACES).map((key) => [key, false])) as Record<keyof typeof ERC165_INTERFACES, boolean>;
  if (!code || code === "0x") {
    return { chainId: input.chainId, address, blockNumber: blockNumber.toString(), hasCode: false, codeSize: 0, proxy: { kind: "none" }, interfaces: empty, standard: "unknown", authority: "unverified" };
  }
  const [implementationSlot, adminSlot, beaconSlot] = await Promise.all([EIP1967_IMPLEMENTATION_SLOT, EIP1967_ADMIN_SLOT, EIP1967_BEACON_SLOT]
    .map((slot) => optional(() => reader.getStorageAt({ address, slot, ...at }))));
  const implementation = slotAddress(implementationSlot);
  const admin = slotAddress(adminSlot);
  const beacon = slotAddress(beaconSlot);
  const clone = MINIMAL_CLONE.exec(code);
  let proxy: KeelContractProxy = { kind: "none" };
  if (beacon) {
    const target = await optional(() => reader.readContract({ address: beacon, abi: implementationAbi, functionName: "implementation", ...at }));
    proxy = { kind: "beacon", beacon, ...(typeof target === "string" ? { implementation: getAddress(target) } : {}), ...(admin ? { admin } : {}), ...(implementation ? { conflict: true as const } : {}) };
  } else if (implementation) {
    proxy = { kind: "eip1967", implementation, ...(admin ? { admin } : {}) };
  } else if (clone?.[1]) {
    proxy = { kind: "minimal-clone", implementation: getAddress(`0x${clone[1]}`) };
  }
  const supports = async (id: Hex) => (await optional(() => reader.readContract({ address, abi: supportsInterfaceAbi, functionName: "supportsInterface", args: [id], ...at }))) === true;
  const erc165 = await supports(ERC165_INTERFACES.erc165);
  const interfaces = { ...empty, erc165 };
  if (erc165) {
    const keys = (Object.keys(ERC165_INTERFACES) as (keyof typeof ERC165_INTERFACES)[]).filter((key) => key !== "erc165");
    const results = await Promise.all(keys.map((key) => supports(ERC165_INTERFACES[key])));
    keys.forEach((key, index) => { interfaces[key] = results[index] === true; });
  }
  const [name, symbol, owner] = await Promise.all([
    optional(() => reader.readContract({ address, abi: textAbi("name"), functionName: "name", ...at })),
    optional(() => reader.readContract({ address, abi: textAbi("symbol"), functionName: "symbol", ...at })),
    optional(() => reader.readContract({ address, abi: ownerAbi, functionName: "owner", ...at })),
  ]);
  const standard: KeelContractStandard = interfaces.erc721 ? "erc721" : interfaces.erc1155 ? "erc1155" : "unknown";
  return {
    chainId: input.chainId,
    address,
    blockNumber: blockNumber.toString(),
    hasCode: true,
    codeHash: keccak256(code),
    codeSize: (code.length - 2) / 2,
    proxy,
    interfaces,
    standard,
    ...(typeof name === "string" && name.length <= 200 ? { name } : {}),
    ...(typeof symbol === "string" && symbol.length <= 64 ? { symbol } : {}),
    ...(typeof owner === "string" && !/^0x0{40}$/iu.test(owner) ? { owner: getAddress(owner) } : {}),
    authority: "unverified",
  };
}

/* ---------------------------------------------------------------- organization */

const CONTROL = /[\u0000-\u001f\u007f]/u;

function boundedText(value: unknown, what: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  const text = value.trim().replace(/\s+/gu, " ");
  if (text.length > max || CONTROL.test(text)) throw new TypeError(`${what} must be at most ${max} characters.`);
  return text || undefined;
}

/** Tags are short, lowercase and unique so they work as filters and search terms. */
export function normalizeKeelContractTags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 24) throw new TypeError("Use at most 24 tags.");
  const tags = value.map((entry) => {
    if (typeof entry !== "string") throw new TypeError("Tags must be text.");
    const tag = entry.trim().toLowerCase().replace(/\s+/gu, "-");
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{0,39}$/u.test(tag)) throw new TypeError(`"${entry}" is not a valid tag. Use letters, numbers, dots, dashes or underscores.`);
    return tag;
  });
  return [...new Set(tags)];
}

/** Validates the creator-owned fields; unknown keys are rejected so the record stays exact. */
export function normalizeKeelContractOrganization(value: unknown): KeelContractOrganization {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Organization must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["label", "category", "tags", "notes", "pinned", "archived"].includes(key)) throw new TypeError(`"${key}" cannot be set on a contract.`);
  const label = boundedText(input.label, "Name", 120);
  const category = boundedText(input.category, "Category", 48);
  const notes = typeof input.notes === "string" ? input.notes.trim() : input.notes;
  if (notes !== undefined && (typeof notes !== "string" || notes.length > 4000)) throw new TypeError("Notes must be at most 4000 characters.");
  for (const flag of ["pinned", "archived"] as const) if (input[flag] !== undefined && typeof input[flag] !== "boolean") throw new TypeError(`${flag} must be true or false.`);
  const tags = input.tags === undefined ? undefined : normalizeKeelContractTags(input.tags);
  return {
    ...(label === undefined ? {} : { label }),
    ...(category === undefined ? {} : { category }),
    ...(tags === undefined ? {} : { tags }),
    ...(typeof notes === "string" && notes ? { notes } : {}),
    ...(typeof input.pinned === "boolean" ? { pinned: input.pinned } : {}),
    ...(typeof input.archived === "boolean" ? { archived: input.archived } : {}),
  };
}

/* ---------------------------------------------------------------- merging */

const FAMILY_RANK: Readonly<Record<KeelContractFamily, number>> = { "creator-collection": 0, "shared-collection": 1, "fray-auction": 2, "drop-controller": 3, custom: 4, infrastructure: 5 };
/** Sources that read the chain's own records; their family wins over one inferred from a release or the creator. */
const FACTUAL_SOURCES: ReadonlySet<KeelContractSource> = new Set(["factory", "indexer", "fray"]);
const factual = (entry: KeelContractEntry) => entry.sources.some((source) => FACTUAL_SOURCES.has(source));

function chooseFamily(previous: KeelContractEntry, entry: KeelContractEntry): KeelContractFamily {
  if (factual(entry) !== factual(previous)) return factual(entry) ? entry.family : previous.family;
  return FAMILY_RANK[entry.family] < FAMILY_RANK[previous.family] ? entry.family : previous.family;
}

function mergeCollection(previous: KeelLogicalCollection | undefined, next: KeelLogicalCollection): KeelLogicalCollection {
  if (!previous) return next;
  const tags = [...new Set([...(previous.tags ?? []), ...(next.tags ?? [])])];
  const label = previous.label ?? next.label;
  return { ...previous, ...next, ...(label ? { label } : {}), ...(tags.length ? { tags } : {}) };
}

/** Combines what several sources know about the same contract into one entry. */
export function mergeKeelContractEntries(entries: readonly KeelContractEntry[]): KeelContractEntry[] {
  const byKey = new Map<string, KeelContractEntry>();
  for (const entry of entries) {
    const previous = byKey.get(entry.key);
    if (!previous) { byKey.set(entry.key, entry); continue; }
    const collections = new Map(previous.collections.map((item) => [item.key, item]));
    for (const item of entry.collections) collections.set(item.key, mergeCollection(collections.get(item.key), item));
    const signers = new Map(previous.signers.map((item) => [item.id, item]));
    for (const item of entry.signers) if (!signers.has(item.id)) signers.set(item.id, item);
    byKey.set(entry.key, {
      ...previous,
      ...entry,
      // A more specific family or a known proxy/standard is never replaced by a vaguer one.
      family: chooseFamily(previous, entry),
      standard: entry.standard !== "unknown" ? entry.standard : previous.standard,
      proxy: entry.proxy.kind !== "none" ? entry.proxy : previous.proxy,
      name: previous.name && previous.name !== short(previous.address) ? previous.name : entry.name,
      sources: [...new Set([...previous.sources, ...entry.sources])],
      collections: [...collections.values()],
      signers: [...signers.values()],
      ...pickOrganization(previous, entry),
    });
  }
  return [...byKey.values()];
}

function pickOrganization(previous: KeelContractOrganization, next: KeelContractOrganization): KeelContractOrganization {
  // Creator-owned fields come from whichever source carries them (the saved record); discovery never erases them.
  const tags = [...new Set([...(previous.tags ?? []), ...(next.tags ?? [])])];
  return {
    ...(next.label ?? previous.label ? { label: next.label ?? previous.label! } : {}),
    ...(next.category ?? previous.category ? { category: next.category ?? previous.category! } : {}),
    ...(tags.length ? { tags } : {}),
    ...(next.notes ?? previous.notes ? { notes: next.notes ?? previous.notes! } : {}),
    ...(next.pinned ?? previous.pinned ? { pinned: true } : {}),
    ...(next.archived ?? previous.archived ? { archived: true } : {}),
  };
}

function short(address: string): string { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function displayName(entry: Pick<KeelContractEntry, "label" | "name" | "address">): string {
  return entry.label ?? (entry.name || short(entry.address));
}

export interface KeelContractGroup {
  readonly id: "pinned" | "collections" | "shared" | "sales" | "custom" | "infrastructure" | "archived";
  readonly title: string;
  readonly description: string;
  readonly entries: readonly KeelContractEntry[];
}

/** The order a creator scans their contracts in: their own collections first, archived last. */
export function groupKeelContracts(entries: readonly KeelContractEntry[]): KeelContractGroup[] {
  const sorted = [...entries].sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const pick = (test: (entry: KeelContractEntry) => boolean) => sorted.filter((entry) => !entry.archived && test(entry));
  const groups: KeelContractGroup[] = [
    { id: "pinned", title: "Pinned", description: "The contracts you keep at hand.", entries: pick((entry) => entry.pinned === true) },
    { id: "collections", title: "Your collections", description: "Contracts that hold only your work. Most are lightweight copies of a KEEL template, created for you by the factory.", entries: pick((entry) => !entry.pinned && entry.family === "creator-collection") },
    { id: "shared", title: "Your work in shared KEEL contracts", description: "KEEL contracts that hold many artists' collections. Yours are listed inside each one.", entries: pick((entry) => !entry.pinned && (entry.family === "shared-collection" || entry.family === "fray-auction")) },
    { id: "sales", title: "Drops and sales", description: "Contracts that run your sales: phases, prices and who can mint.", entries: pick((entry) => !entry.pinned && entry.family === "drop-controller") },
    { id: "custom", title: "Custom contracts", description: "Contracts you added yourself.", entries: pick((entry) => !entry.pinned && entry.family === "custom") },
    { id: "infrastructure", title: "KEEL infrastructure", description: "Factories and registries your contracts rely on, for reference.", entries: pick((entry) => !entry.pinned && entry.family === "infrastructure") },
    { id: "archived", title: "Archived", description: "Hidden from the lists above; nothing on chain changed.", entries: sorted.filter((entry) => entry.archived === true) },
  ];
  return groups.filter((group) => group.entries.length > 0);
}

/** A plain-language line about what kind of contract this is. */
export function describeKeelContract(entry: Pick<KeelContractEntry, "family" | "standard" | "proxy" | "deployment">): string {
  const standard = entry.standard === "erc721" ? "ERC-721" : entry.standard === "erc1155" ? "ERC-1155" : entry.standard === "erc20" ? "ERC-20" : "";
  const shape = entry.proxy.kind === "minimal-clone" ? "lightweight copy of a KEEL template" : entry.proxy.kind === "eip1967" ? "upgradeable proxy" : entry.proxy.kind === "beacon" ? "beacon proxy" : "";
  const role = { "creator-collection": "Your collection", "shared-collection": "Shared KEEL collection contract", "fray-auction": "FRAY auction house", "drop-controller": "Drop and sale controller", infrastructure: "KEEL infrastructure", custom: "Custom contract" }[entry.family];
  return [role, standard, shape].filter(Boolean).join(" · ");
}

/* ---------------------------------------------------------------- factory discovery */

export interface KeelCreatorFactoryRecord {
  readonly collectionId: string;
  readonly sharedCollectionId: string;
  readonly tokenContract: Address;
  readonly name: string;
  readonly open: boolean;
  readonly standard: "erc721" | "erc1155";
  readonly deployment: "dedicated" | "shared" | "external";
  /** For dedicated ERC-721 clones: which template the clone copies. */
  readonly implementation?: "erc721a" | "erc721" | "seeded-erc721a";
}

/**
 * The creator's collections from a KeelCreatorFactory at one block. The
 * factory list is swap-and-pop, so results are sorted by collection id and
 * never used as drop numbers.
 */
async function mapLimited<T, U>(values: readonly T[], limit: number, mapper: (value: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor; cursor += 1; results[index] = await mapper(values[index] as T); }
  }));
  return results;
}

export interface KeelFactoryDiscoveryOptions {
  readonly factory: string;
  readonly creator: string;
  readonly abi: readonly unknown[];
  readonly blockNumber?: bigint;
  /** Most collections to read (default 500). */
  readonly limit?: number;
  /** Parallel reads (default 8). */
  readonly concurrency?: number;
  /**
   * Refuse instead of degrading: the factory must have code, the count must
   * match the ids, ids must be unique, and more ids than `limit` is an error.
   */
  readonly strict?: boolean;
}

/**
 * The creator's collections from a KeelCreatorFactory at one block. The
 * factory list is swap-and-pop, so results are sorted by collection id and
 * never used as drop numbers.
 */
export async function discoverKeelCreatorFactoryCollections(reader: Pick<KeelContractReader, "readContract" | "getBlockNumber"> & Partial<Pick<KeelContractReader, "getCode">>, input: KeelFactoryDiscoveryOptions): Promise<{ readonly blockNumber: string; readonly records: readonly KeelCreatorFactoryRecord[]; readonly truncated: boolean }> {
  const factory = getAddress(input.factory);
  const creator = getAddress(input.creator);
  const limit = input.limit ?? 500;
  const blockNumber = input.blockNumber ?? await reader.getBlockNumber();
  const read = (functionName: string, args: readonly unknown[] = []) => reader.readContract({ address: factory, abi: input.abi, functionName, args, blockNumber });
  if (input.strict) {
    if (!reader.getCode) throw new TypeError("Strict discovery needs a reader that can read code.");
    const code = await reader.getCode({ address: factory, blockNumber });
    if (!code || code === "0x") throw new Error("The selected factory has no code on this chain.");
  }
  const ids = await read("creatorCollectionIds", [creator]);
  if (!Array.isArray(ids)) throw new Error("The factory did not return collection ids.");
  const unique = [...new Set(ids.map((id) => BigInt(id as bigint)))];
  if (input.strict) {
    if (unique.length !== ids.length) throw new Error("The factory returned duplicate collection ids.");
    const count = BigInt(await read("creatorCollectionCount", [creator]) as bigint);
    if (count !== BigInt(ids.length)) throw new Error("Factory collection count and ids disagree at this block.");
    if (unique.length > limit) throw new Error(`This creator has ${unique.length} collections; read at most ${limit} at once or page through an indexer.`);
  }
  const sorted = unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const chosen = sorted.slice(0, limit);
  const records = await mapLimited(chosen, Math.max(1, input.concurrency ?? 8), async (id): Promise<KeelCreatorFactoryRecord> => {
    const record = await read("collection", [id]) as { creator: string; tokenContract: string; sharedCollectionId: bigint; standard: number | bigint; deployment: number | bigint; open: boolean; name: string };
    if (getAddress(record.creator) !== creator) throw new Error(`Factory collection ${id} belongs to another creator.`);
    const standard = Number(record.standard) === 1 ? "erc1155" : "erc721";
    const deployment = (["dedicated", "shared", "external"] as const)[Number(record.deployment)];
    if (!deployment) throw new Error(`Factory collection ${id} has an unknown deployment kind.`);
    let implementation: KeelCreatorFactoryRecord["implementation"];
    if (deployment === "dedicated" && standard === "erc721") {
      const kind = Number(await read("erc721ImplementationKind", [id]));
      implementation = (["erc721a", "erc721", "seeded-erc721a"] as const)[kind];
      if (!implementation) throw new Error(`Factory collection ${id} uses an unknown ERC-721 template.`);
    }
    return { collectionId: id.toString(), sharedCollectionId: BigInt(record.sharedCollectionId).toString(), tokenContract: getAddress(record.tokenContract), name: String(record.name).slice(0, 200), open: record.open === true, standard, deployment, ...(implementation ? { implementation } : {}) };
  });
  return { blockNumber: blockNumber.toString(), records, truncated: sorted.length > chosen.length };
}

/** Turns factory records into registry entries: one per token contract, with each collection listed inside. */
export interface KeelFactoryTemplates { readonly erc721a?: string; readonly erc721?: string; readonly seeded?: string; readonly erc1155?: string }

/** Reads the factory's template (implementation) addresses so clones can name what they copy. */
export async function readKeelFactoryTemplates(reader: Pick<KeelContractReader, "readContract">, factory: string, blockNumber?: bigint): Promise<KeelFactoryTemplates> {
  const read = async (functionName: string) => {
    try { return getAddress(String(await reader.readContract({ address: getAddress(factory), abi: keelCreatorFactoryRegistryAbi, functionName, ...(blockNumber === undefined ? {} : { blockNumber }) }))); } catch (error) { if (isKeelTransportFailure(error)) throw error; return undefined; }
  };
  const [erc721a, erc721, seeded, erc1155] = await Promise.all([read("implementation721"), read("implementationStandard721"), read("implementationSeeded721"), read("implementation1155")]);
  return { ...(erc721a ? { erc721a } : {}), ...(erc721 ? { erc721 } : {}), ...(seeded ? { seeded } : {}), ...(erc1155 ? { erc1155 } : {}) };
}

export function entriesFromFactoryRecords(chainId: number, records: readonly KeelCreatorFactoryRecord[], templates: KeelFactoryTemplates = {}): KeelContractEntry[] {
  return mergeKeelContractEntries(records.map((record): KeelContractEntry => {
    const shared = record.deployment === "shared";
    const collection: KeelLogicalCollection = shared
      ? { key: `shared:${record.sharedCollectionId}`, kind: "shared-collection", name: record.name, externalId: record.sharedCollectionId, tokenIds: keelSharedCollectionTokenRange(record.sharedCollectionId), open: record.open, source: "factory" }
      : { key: `factory:${record.collectionId}`, kind: "factory-collection", name: record.name, externalId: record.collectionId, open: record.open, source: "factory" };
    return {
      protocol: KEEL_CONTRACT_REGISTRY_PROTOCOL,
      key: keelContractKey(chainId, record.tokenContract),
      chainId,
      address: record.tokenContract,
      family: shared ? "shared-collection" : record.deployment === "external" ? "custom" : "creator-collection",
      standard: record.standard,
      deployment: record.deployment,
      proxy: record.deployment === "dedicated" ? (() => {
        const template = record.standard === "erc1155" ? templates.erc1155 : record.implementation === "erc721" ? templates.erc721 : record.implementation === "seeded-erc721a" ? templates.seeded : templates.erc721a;
        return { kind: "minimal-clone" as const, ...(template ? { implementation: getAddress(template) } : {}) };
      })() : { kind: "none" as const },
      name: shared ? "KEEL shared editions" : record.name,
      abiId: shared ? "keel-shared-1155" : record.standard === "erc1155" ? "keel-creator-1155" : record.implementation === "erc721" ? "keel-creator-721" : record.implementation === "seeded-erc721a" ? "keel-creator-seeded-721a" : "keel-creator-721a",
      sources: ["factory"],
      collections: [collection],
      signers: [],
    };
  }));
}


/* ---------------------------------------------------------------- shared validators */

export const KEEL_SIGNER_FLOW_LABELS: Readonly<Record<KeelSignerFlow, { readonly label: string; readonly detail: string }>> = {
  wallet: { label: "Wallet", detail: "A person approves each action in their wallet." },
  "eip712-authorization": { label: "Signed authorization", detail: "The owner signs a one-time permission that someone else submits." },
  "agent-grant": { label: "Agent (draft access)", detail: "An AI agent prepares drafts; a person still approves anything on chain." },
  bridge: { label: "Technomancy bridge", detail: "Requests are relayed through your bridge program to a local agent; approvals stay in a wallet." },
  "server-signer": { label: "Server signer", detail: "A key held by a server signs narrow permissions such as invite-list access." },
};

export const KEEL_SIGNER_ROLE_LABELS: Readonly<Record<KeelContractSigner["role"], string>> = {
  owner: "Owner", admin: "Admin", minter: "Minter", "stage-signer": "Sale phase signer", agent: "Agent", custom: "Custom",
};

const SECRET_LIKE = /(?:^|[^0-9a-f])(?:0x)?[0-9a-f]{64}(?:[^0-9a-f]|$)|\b(?:sk|pk|key|token|secret|password)[-_]?[a-z0-9]{12,}/iu;

/** Validates one signer record. It is bookkeeping: nothing here can sign, and secrets are refused outright. */
export function normalizeKeelContractSigner(value: unknown): KeelContractSigner {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("A signer must be an object.");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["id", "address", "role", "flow", "label", "bridge", "status"].includes(key)) throw new TypeError(`"${key}" cannot be set on a signer.`);
  if (typeof input.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(input.id)) throw new TypeError("Signer id must be 1–64 letters, numbers, dashes or underscores.");
  const label = boundedText(input.label, "Signer name", 80);
  if (!label) throw new TypeError("Name the signer.");
  if (SECRET_LIKE.test(label)) throw new TypeError("That looks like a key or token. Never store secrets here.");
  if (!(input.role as string in KEEL_SIGNER_ROLE_LABELS)) throw new TypeError("Unknown signer role.");
  if (!(input.flow as string in KEEL_SIGNER_FLOW_LABELS)) throw new TypeError("Unknown signer flow.");
  if (!["active", "pending", "revoked", "unverified"].includes(input.status as string)) throw new TypeError("Unknown signer status.");
  let bridge: KeelContractSigner["bridge"];
  if (input.bridge !== undefined) {
    if (input.flow !== "bridge") throw new TypeError("Only bridge flows record a bridge.");
    const raw = input.bridge as Record<string, unknown>;
    if (raw === null || typeof raw !== "object") throw new TypeError("Bridge must be an object.");
    for (const key of Object.keys(raw)) if (!["server", "queue", "lastSeenAt"].includes(key)) throw new TypeError(`"${key}" cannot be set on a bridge.`);
    const server = boundedText(raw.server, "Bridge server", 120);
    const queue = boundedText(raw.queue, "Bridge queue", 200);
    if (!server || !queue) throw new TypeError("A bridge needs a server name and a queue.");
    if (/[?#@]|token=|key=/iu.test(server) || /[?#@]|token=|key=/iu.test(queue) || SECRET_LIKE.test(server) || SECRET_LIKE.test(queue)) throw new TypeError("Bridge server and queue must not contain credentials or query strings.");
    if (!/^\/[A-Za-z0-9/_-]{0,199}$/u.test(queue)) throw new TypeError("Bridge queue must be a path such as /api/bridge/jobs.");
    const lastSeenAt = raw.lastSeenAt === undefined ? undefined : String(raw.lastSeenAt);
    if (lastSeenAt !== undefined && Number.isNaN(Date.parse(lastSeenAt))) throw new TypeError("Bridge last-seen time is invalid.");
    bridge = { server, queue, ...(lastSeenAt ? { lastSeenAt } : {}) };
  }
  return {
    id: input.id,
    ...(input.address === undefined || input.address === "" ? {} : { address: getAddress(String(input.address)) }),
    role: input.role as KeelContractSigner["role"],
    flow: input.flow as KeelSignerFlow,
    label,
    ...(bridge ? { bridge } : {}),
    status: input.status as KeelContractSigner["status"],
  };
}

export function normalizeKeelContractSigners(value: unknown): KeelContractSigner[] {
  if (!Array.isArray(value) || value.length > 32) throw new TypeError("Use at most 32 signers.");
  const signers = value.map(normalizeKeelContractSigner);
  if (new Set(signers.map((signer) => signer.id)).size !== signers.length) throw new TypeError("Signer ids must be unique.");
  return signers;
}

/** Creator labels for collections inside a contract, keyed by registry key. */
export function normalizeKeelCollectionLabels(value: unknown): Record<string, { readonly label?: string; readonly tags?: readonly string[] }> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Collection labels must be an object.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 500) throw new TypeError("Too many collection labels.");
  return Object.fromEntries(entries.map(([key, raw]) => {
    if (!/^[a-z-]+:[A-Za-z0-9x:._-]{1,100}$|^die$/u.test(key)) throw new TypeError(`"${key}" is not a collection key.`);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("Each collection label must be an object.");
    const item = raw as Record<string, unknown>;
    for (const field of Object.keys(item)) if (!["label", "tags"].includes(field)) throw new TypeError(`"${field}" cannot be set on a collection.`);
    const label = boundedText(item.label, "Collection name", 120);
    const tags = item.tags === undefined ? undefined : normalizeKeelContractTags(item.tags);
    return [key, { ...(label ? { label } : {}), ...(tags?.length ? { tags } : {}) }];
  }));
}

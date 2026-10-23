import { keelTezosAddressBytes, keelTezosChainIdBytes } from "./tezos-collection.js";
import { getAddress, keccak256, stringToHex } from "viem";

export const KEEL_ARTIST_CONTRACTS_PROTOCOL = "keel-artist-contracts@1" as const;
export const KEEL_ARTIST_CONTRACT_ROLES = ["collection", "sale", "companion", "bridge", "verifier", "physical", "images", "renderer", "storage", "index", "factory", "infrastructure", "custom"] as const;
export type KeelArtistContractRole = typeof KEEL_ARTIST_CONTRACT_ROLES[number];
export type KeelArtistChain = { readonly family: "ethereum"; readonly chainId: number } | { readonly family: "tezos"; readonly network: string };
export interface KeelArtistProfileReference { readonly chain: KeelArtistChain; readonly registry: string; readonly creatorId: string }
export interface KeelArtistContract {
  readonly chain: KeelArtistChain;
  readonly address: string | null;
  readonly role: KeelArtistContractRole;
  readonly collection: string;
  readonly name: string;
}
export interface KeelArtistContractsInput {
  readonly artist: { readonly name: string; readonly key: string; readonly profiles?: readonly KeelArtistProfileReference[] };
  readonly collections: readonly { readonly key: string; readonly name: string }[];
  readonly contracts: readonly KeelArtistContract[];
}
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw new TypeError(`Invalid ${label}.`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f]/.test(value)) throw new TypeError(`Invalid ${label}.`);
  return value.trim();
}
function key(value: unknown, label: string): string {
  const result = text(value, label, 96);
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(result)) throw new TypeError(`Invalid ${label}.`);
  return result;
}
export function keelArtistChainKey(value: KeelArtistChain): string {
  if (value.family === "ethereum") {
    object(value, ["family", "chainId"], "EVM chain");
    if (!Number.isSafeInteger(value.chainId) || value.chainId < 1) throw new TypeError("Exact EVM chain ID is required.");
    return `eip155:${value.chainId}`;
  }
  object(value, ["family", "network"], "Tezos chain");
  if (value.family !== "tezos" || !/^Net[1-9A-HJ-NP-Za-km-z]{12}$/.test(value.network)) throw new TypeError("Exact Tezos network is required.");
  keelTezosChainIdBytes(value.network);
  return `tezos:${value.network}`;
}

/** A creator's organization manifest, suitable for their existing KEEL profile
 * metadata. It groups contracts across chains without claiming that a label
 * proves ownership, or that unconfigured contracts have been deployed. */
export function buildKeelArtistContracts(value: unknown) {
  const input = object(value, ["artist", "collections", "contracts"], "artist contracts manifest");
  const artist = object(input.artist, ["name", "key", "profiles"], "artist");
  const artistKey = key(artist.key, "artist key"); const artistName = text(artist.name, "artist name");
  const profiles: KeelArtistProfileReference[] = [];
  const profileChains = new Set<string>();
  if (artist.profiles !== undefined) {
    if (!Array.isArray(artist.profiles) || artist.profiles.length > 64) throw new TypeError("Bounded artist profile references are required.");
    for (const raw of artist.profiles) {
      const reference = object(raw, ["chain", "registry", "creatorId"], "creator profile");
      const chain = reference.chain as KeelArtistChain; const chainKey = keelArtistChainKey(chain);
      if (profileChains.has(chainKey)) throw new TypeError("Ambiguous artist profile on the same chain."); profileChains.add(chainKey);
      if (typeof reference.registry !== "string" || typeof reference.creatorId !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(reference.creatorId) || /^0x0{64}$/.test(reference.creatorId)) throw new TypeError("Exact creator profile reference is required.");
      let registry: string;
      if (chain.family === "ethereum") { registry = getAddress(reference.registry); if (/^0x0{40}$/.test(registry)) throw new TypeError("Zero profile registry."); }
      else { if (!reference.registry.startsWith("KT1")) throw new TypeError("Expected an originated profile registry."); keelTezosAddressBytes(reference.registry); registry = reference.registry; }
      profiles.push({ chain: chain.family === "ethereum" ? { family: "ethereum", chainId: chain.chainId } : { family: "tezos", network: chain.network }, registry, creatorId: reference.creatorId.toLowerCase() });
    }
    profiles.sort((a, b) => keelArtistChainKey(a.chain).localeCompare(keelArtistChainKey(b.chain), "en"));
  }
  if (!Array.isArray(input.collections) || !input.collections.length || input.collections.length > 512 || !Array.isArray(input.contracts) || input.contracts.length > 4096) throw new TypeError("Bounded collections and contracts are required.");
  const collectionKeys = new Set<string>();
  const collections = input.collections.map((raw: unknown) => {
    const entry = object(raw, ["key", "name"], "collection"); const id = key(entry.key, "collection key");
    if (collectionKeys.has(id)) throw new TypeError("Duplicate collection key."); collectionKeys.add(id);
    return { key: id, name: text(entry.name, "collection name") };
  }).sort((a, b) => a.key.localeCompare(b.key, "en"));
  const identities = new Set<string>(); const roles = new Set<string>();
  const contracts = input.contracts.map((raw: unknown) => {
    const entry = object(raw, ["chain", "address", "role", "collection", "name"], "contract");
    const chain = entry.chain as KeelArtistChain; const chainKey = keelArtistChainKey(chain);
    const role = entry.role as KeelArtistContractRole;
    if (!KEEL_ARTIST_CONTRACT_ROLES.includes(role)) throw new TypeError("Unknown contract role.");
    const collection = key(entry.collection, "contract collection");
    if (!collectionKeys.has(collection)) throw new TypeError("Contract references an unknown collection.");
    let address: string | null = null;
    if (entry.address !== null) {
      if (typeof entry.address !== "string") throw new TypeError("Contract address must be exact or null while unconfigured.");
      if (chain.family === "ethereum") { address = getAddress(entry.address); if (/^0x0{40}$/.test(address)) throw new TypeError("Zero contract address."); }
      else { if (!entry.address.startsWith("KT1")) throw new TypeError("Expected an originated Tezos contract address."); keelTezosAddressBytes(entry.address); address = entry.address; }
    }
    // Primary roles resolve to one target. A collection may use several
    // immutable helpers; infrastructure/custom entries use their exact address
    // (or declared name until deployed) so they remain individually discoverable.
    const name = text(entry.name, "contract name");
    const helper = role === "infrastructure" || role === "custom";
    const roleKey = `${collection}:${chainKey}:${role}${helper ? `:${address ?? name}` : ""}`;
    if (roles.has(roleKey)) throw new TypeError("Ambiguous collection contract role."); roles.add(roleKey);
    const identity = address === null ? null : `${chainKey}:${chain.family === "ethereum" ? address.toLowerCase() : address}`;
    if (identity) identities.add(identity);
    return { chain: chain.family === "ethereum" ? { family: "ethereum" as const, chainId: chain.chainId } : { family: "tezos" as const, network: chain.network }, chainKey, address, identity, role, collection, name, status: address === null ? "unconfigured" as const : "declared-needs-readback" as const };
  }).sort((a, b) => `${a.collection}:${a.chainKey}:${a.role}:${a.address ?? a.name}`.localeCompare(`${b.collection}:${b.chainKey}:${b.role}:${b.address ?? b.name}`, "en"));
  const manifest = { schema: KEEL_ARTIST_CONTRACTS_PROTOCOL, artist: { key: artistKey, name: artistName, ...(profiles.length ? { profiles } : {}) }, collections, contracts };
  return { ...manifest, commitment: keccak256(stringToHex(JSON.stringify(manifest))), contractCount: identities.size,
    groups: collections.map((collection) => ({ ...collection, contracts: contracts.filter((entry) => entry.collection === collection.key) })),
    attribution: profiles.length ? "profile-reference-needs-readback" as const : "creator-declared" as const,
    authority: "not-established" as const, signing: "not-performed" as const, submission: "not-performed" as const };
}

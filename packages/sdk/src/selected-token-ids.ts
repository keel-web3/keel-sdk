import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";

/** Optional capability of new KEEL standard ERC-721 implementations. Existing
 * deployed clones retain their original code and sequential mint behavior. */
export const keelSelectedTokenIdsAbi = parseAbi([
  "function selectedTokenIds() view returns (bool)",
  "function selectedTokenPolicy() view returns (address)",
  "function enableSelectedTokenIds(address policy)",
  "event SelectedTokenIdsEnabled(address indexed policy)",
]);

/** Exact manager mintData. Supply, selection mode and policy are enforced by
 * the collection; this encoding does not authorize or submit a mint. */
export function encodeKeelSelectedTokenIds(ids: readonly (bigint | string)[], maximum?: bigint): Hex {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) throw new TypeError("Select 1..500 token IDs.");
  if (maximum !== undefined && (typeof maximum !== "bigint" || maximum < 1n)) throw new TypeError("Invalid maximum token ID.");
  const seen = new Set<string>();
  const values = ids.map((id) => {
    if (typeof id !== "bigint" && (typeof id !== "string" || !/^[1-9][0-9]{0,77}$/.test(id))) throw new TypeError("Token IDs must be exact positive integers.");
    const value = BigInt(id);
    if (value < 1n || value >= 1n << 256n || maximum !== undefined && value > maximum) throw new RangeError("Token ID is outside the collection range.");
    if (seen.has(value.toString())) throw new TypeError("Duplicate token ID.");
    seen.add(value.toString()); return value;
  });
  return encodeAbiParameters([{ type: "uint256[]" }], [values]);
}

/** Irreversible setup before any supply or reservations exist. Exact selected-
 * chain code/capability and caller authority require independent readback. */
export function buildKeelSelectedTokenIdsSetupCall(collection: Address, policy: Address) {
  const to = getAddress(collection); const allocationPolicy = getAddress(policy);
  return Object.freeze({ to, data: encodeFunctionData({ abi: keelSelectedTokenIdsAbi, functionName: "enableSelectedTokenIds", args: [allocationPolicy] }), value: "0" as const,
    authority: "owner-or-lifecycle-manager" as const, capability: "requires-selected-chain-readback" as const,
    signing: "not-performed" as const, submission: "not-performed" as const });
}

/** Optional bounded ERC721 accounting for newly qualified implementations.
 * This creates no NFTs. It moves owner-entry creation to setup and derives
 * holder balances from at most 256 selected IDs. Read costs grow with supply. */
export const keelPreparedOwnershipAbi = parseAbi([
  "function preparedOwnership() view returns (bool)",
  "function enablePreparedOwnership()",
  "event PreparedOwnershipEnabled(uint256 maxSupply)",
  "error OwnershipPreparationLocked()",
]);

/** Call only after enabling selected IDs and before creating reservations or
 * supply. Old clones do not gain this capability through an SDK update. */
export function buildKeelPreparedOwnershipSetupCall(collection: Address) {
  return Object.freeze({ to: getAddress(collection),
    data: encodeFunctionData({ abi: keelPreparedOwnershipAbi, functionName: "enablePreparedOwnership" }), value: "0" as const,
    authority: "owner-or-lifecycle-manager" as const, capability: "requires-selected-chain-readback" as const,
    signing: "not-performed" as const, submission: "not-performed" as const });
}

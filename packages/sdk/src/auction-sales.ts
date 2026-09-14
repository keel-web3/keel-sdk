import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, type Address } from "viem";
import { keelMintReleaseAbi } from "./mint-releases.js";

export type KeelAuctionOutcome = Readonly<{ routeId: bigint; releaseId: bigint; supply: number }>;
const maxUint256 = (1n << 256n) - 1n;
const maxUint64 = (1n << 64n) - 1n;

/** Each house uses its own issuer; auction IDs are scoped to that issuer. */
export function keelAuctionAllocationId(issuer: Address, auctionId: bigint) {
  if (auctionId <= 0n || auctionId > maxUint256) throw new RangeError("Auction ID must fit uint256 and be positive.");
  return keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "address" }, { type: "uint256" }],
    ["keel.fray-auction.allocation.v1", getAddress(issuer), auctionId],
  ));
}

function outcome(value: KeelAuctionOutcome) {
  if (value.routeId <= 0n || value.routeId > maxUint256 || value.releaseId <= 0n || value.releaseId > maxUint64)
    throw new RangeError("Outcome requires a valid route and release ID.");
  if (!Number.isInteger(value.supply) || value.supply < 1 || value.supply > 0xffffffff)
    throw new RangeError("Outcome supply must be 1..4294967295.");
  return Object.freeze({ ...value });
}

/** Reuses creator-owned release bindings. No collection deployment or transaction is submitted. */
export function prepareKeelAuctionOutcomes(input: {
  chainId: bigint; router: Address; issuer: Address; auctionId: bigint;
  bidder: KeelAuctionOutcome; patrons?: KeelAuctionOutcome;
}) {
  if (input.chainId <= 0n) throw new RangeError("chainId must be positive.");
  const bidder = outcome(input.bidder);
  const patrons = input.patrons ? outcome(input.patrons) : undefined;
  const sharedRoute = patrons?.routeId === bidder.routeId;
  if (sharedRoute && patrons!.releaseId !== bidder.releaseId)
    throw new RangeError("One route/allocation must bind to one release for both outcomes.");
  const issuer = getAddress(input.issuer);
  const allocationId = keelAuctionAllocationId(issuer, input.auctionId);
  const bindings = (patrons && !sharedRoute ? [bidder, patrons] : [bidder]).map((item) => Object.freeze({
    status: "review-only" as const, chainId: input.chainId, to: getAddress(input.router), value: 0n,
    data: encodeFunctionData({ abi: keelMintReleaseAbi, functionName: "bindReleaseAllocation",
      args: [item.releaseId, item.routeId, issuer, allocationId] }),
    routeId: item.routeId, releaseId: item.releaseId,
    reserve: sharedRoute ? Math.max(bidder.supply, patrons!.supply) : item.supply,
  }));
  return Object.freeze({ status: "review-only" as const, auctionId: input.auctionId, issuer, allocationId,
    mode: patrons ? "fray" as const : "ordinary" as const,
    bidder: Object.freeze({ supply: bidder.supply, routeId: bidder.routeId }),
    patrons: Object.freeze({ supply: patrons?.supply ?? 0, routeId: patrons?.routeId ?? 0n }),
    bindings: Object.freeze(bindings),
  });
}

/** Asset standard is independent of whether bidding or patron clearing selected the winner. */
export function decodeKeelAuctionSalePolicy(word: bigint) {
  if (word < 0n || word >> 35n !== 0n || (word & 0xffffffffn) === 0n)
    throw new RangeError("Invalid auction sale policy.");
  return Object.freeze({ deferred: (word & (1n << 34n)) !== 0n, bidderSupply: Number(word & 0xffffffffn),
    bidderStandard: word & (1n << 32n) ? "ERC1155" as const : "ERC721" as const,
    patronStandard: word & (1n << 33n) ? "ERC1155" as const : "ERC721" as const,
  });
}

export const keelAuctionSaleHouseAbi = parseAbi([
  "function createKeelSaleAuction(uint256 expectedAuctionId,(uint64 startTime,uint64 duration,uint64 extensionWindow,uint64 maximumExtension,uint128 reserve,uint128 bidIncrement,uint128 minimumPatronCap,uint32 maximumEditionSize,uint8 patronPricingMode,bool patronWithdrawalsEnabled,(uint8 mode,uint32 schemaVersion,bytes32 digest,string uri,address royaltyRecipient,uint96 royaltyBps,bool mutableMetadata) metadata) params,address issuer,(uint32 supply,uint256 routeId) bidder,(uint32 supply,uint256 routeId) patrons) returns (uint256 auctionId)",
  "function bidderOnlySale(uint256 auctionId) view returns (bool)",
  "event KeelSaleModeBound(uint256 indexed auctionId,bool bidderOnly,uint256 policy)",
]);

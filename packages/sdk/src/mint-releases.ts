import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  decodeKeelReleasePolicy,
  describeKeelReleasePolicy,
  encodeKeelReleasePolicy,
  type KeelReleaseMode,
} from "@keel/protocol";
import { keelReleaseSnapshotAbi, oneMintControllerAbi } from "./abi.js";
import {
  buildOneMintDrop,
  buildOneMintItemDrop,
  type NormalizedOneMintDrop,
  type NormalizedOneMintItemDrop,
} from "./one-mint.js";
export {
  decodeKeelReleasePolicy,
  describeKeelReleasePolicy,
  encodeKeelReleasePolicy,
  KEEL_MAX_RELEASE_SUPPLY,
} from "@keel/protocol";

export const keelMintReleaseAbi = parseAbi([
  ...keelReleaseSnapshotAbi,
  "function createRelease(uint256 routeId,address factory,bytes32 name,uint64 limit,uint64 ceiling,uint8 mode) returns (uint64 id)",
  "function bindReleaseAllocation(uint64 id,uint256 routeId,address controller,bytes32 allocationId)",
  "function setReleaseLimit(uint64 id,uint64 limit,bool lock)",
  "function nameReleaseToken(uint64 id,uint64 local,bytes32 name)",
  "function releasePolicy(uint64 id) view returns (uint256)",
  "function releaseRoute(uint64 id) view returns (uint256)",
  "function releaseByNumber(address creator,uint64 number) view returns (uint64)",
  "function releaseByName(address creator,bytes32 name) view returns (uint64)",
  "function creatorReleaseCount(address creator) view returns (uint64)",
  "function resolveReleaseToken(uint64 id,uint64 local) view returns (address target,uint256 tokenId)",
  "function resolveCollectionToken(address target,uint256 tokenId) view returns (uint64 id,uint64 local)",
  "function resolveNamedReleaseToken(address creator,bytes32 releaseName,bytes32 tokenName) view returns (address target,uint256 tokenId)",
  "function route(uint256 routeId) view returns ((address creator,address target,address hook,bytes32 targetCodeHash,bytes32 hookCodeHash,uint256 tokenId,uint8 standard,bool enabled))",
]);
const targetAbi = parseAbi([
  "function owner() view returns (address)",
  "function mintManager() view returns (address)",
  "function maxSupply() view returns (uint256)",
  "function item(uint256 tokenId) view returns (uint128 maxSupply,uint128 minted,uint128 totalReserved,bool open,bool exists)",
  "function collection(uint128 collectionId) view returns (address creator,address pendingCreator,uint128 nextItemIndex,bool open,bool exists,string name)",
]);
/** Exact UTF-8 alias: case and whitespace are significant; display titles remain separate. */
export function keelReleaseName(name: string): Hex {
  if (name.length === 0 || new TextEncoder().encode(name).length > 256)
    throw new RangeError("Release names require 1..256 UTF-8 bytes.");
  // Reject strings whose invalid surrogate code units would be silently replaced during UTF-8 encoding.
  if (new TextDecoder().decode(new TextEncoder().encode(name)) !== name)
    throw new TypeError("Name is not valid Unicode.");
  return keccak256(stringToHex(name));
}
export function prepareKeelRelease(input: {
  readonly chainId: bigint;
  readonly router: Address;
  readonly routeId: bigint;
  readonly factory: Address;
  readonly name: string;
  readonly mode?: KeelReleaseMode;
  readonly limit?: bigint;
  readonly ceiling?: bigint;
}) {
  if (input.chainId <= 0n) throw new RangeError("chainId must be positive.");
  const policy = decodeKeelReleasePolicy(encodeKeelReleasePolicy(input));
  if (input.routeId <= 0n) throw new RangeError("routeId must be positive.");
  const data = encodeFunctionData({
    abi: keelMintReleaseAbi,
    functionName: "createRelease",
    args: [
      input.routeId,
      getAddress(input.factory),
      keelReleaseName(input.name),
      policy.limit,
      policy.ceiling,
      ["fixed", "adjustable", "open"].indexOf(policy.mode),
    ],
  });
  return Object.freeze({
    status: "review-only" as const,
    chainId: input.chainId,
    to: getAddress(input.router),
    data,
    value: 0n,
    policy,
  });
}
export function predictOneMintReleaseAllocation(input: {
  readonly chainId: bigint;
  readonly controller: Address;
  readonly creator: Address;
  readonly creatorNonce: bigint;
  readonly drop: NormalizedOneMintDrop | NormalizedOneMintItemDrop;
}): Hex {
  if (input.chainId <= 0n || input.creatorNonce < 0n)
    throw new RangeError("Invalid chain or nonce.");
  const itemized = "targetTokenId" in input.drop;
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "bool" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        keccak256(stringToHex("keel.one-mint.drop.v2")),
        input.chainId,
        getAddress(input.controller),
        getAddress(input.drop.target),
        itemized ? input.drop.targetTokenId : 0n,
        itemized,
        getAddress(input.creator),
        input.creatorNonce,
        input.drop.metadataDigest,
      ],
    ),
  );
}
/** Bind first, then create the campaign. Recheck nonce/authority before signing; a failed/stale batch is not a created drop. */
export function prepareOneMintReleaseCampaign(input: {
  readonly chainId: bigint;
  readonly router: Address;
  readonly controller: Address;
  readonly creator: Address;
  readonly creatorNonce: bigint;
  readonly releaseId: bigint;
  readonly routeId: bigint;
  readonly drop: NormalizedOneMintDrop | NormalizedOneMintItemDrop;
}) {
  const itemized = "targetTokenId" in input.drop;
  const drop = itemized
    ? buildOneMintItemDrop(input.drop as NormalizedOneMintItemDrop)
    : buildOneMintDrop(input.drop);
  const allocationId = predictOneMintReleaseAllocation({ ...input, drop });
  const bound = encodeFunctionData({
    abi: keelMintReleaseAbi,
    functionName: "bindReleaseAllocation",
    args: [
      input.releaseId,
      input.routeId,
      getAddress(input.controller),
      allocationId,
    ],
  });
  const args = [
    drop.target,
    ...(itemized ? [(drop as NormalizedOneMintItemDrop).targetTokenId] : []),
    drop.payout,
    drop.supply,
    drop.maxPerTransaction,
    drop.maxPerWallet,
    drop.stages,
    drop.metadataDigest,
  ];
  const create = encodeFunctionData({
    abi: parseAbi(oneMintControllerAbi),
    functionName: itemized ? "createItemDrop" : "createDrop",
    args,
  } as Parameters<typeof encodeFunctionData>[0]);
  return Object.freeze({
    status: "review-only" as const,
    chainId: input.chainId,
    creator: getAddress(input.creator),
    creatorNonce: input.creatorNonce,
    allocationId,
    calls: Object.freeze([
      { to: getAddress(input.router), data: bound, value: 0n },
      { to: getAddress(input.controller), data: create, value: 0n },
    ]),
  });
}
export interface KeelReleaseSnapshot {
  readonly source: "pinned-rpc";
  readonly chainId: number;
  readonly blockNumber: string;
  readonly blockHash: Hex;
  readonly router: Address;
  readonly routerCodeHash: Hex;
  readonly releaseId: string;
  readonly collection: Address;
  readonly policyWord: string;
  readonly authority: Address | null;
  readonly targetMaximum: string;
  readonly rows: readonly (readonly [string, string])[];
}
/** Reads one block and checks it again for a reorg. This is chain state, not a contract-audit attestation. */
export async function readKeelReleaseSnapshot(
  client: PublicClient,
  input: {
    readonly router: Address;
    readonly releaseId: bigint;
    readonly expectedRouterCodeHash?: Hex;
    readonly expectedChainId?: number;
  },
): Promise<KeelReleaseSnapshot> {
  const chainId = await client.getChainId();
  if (input.expectedChainId !== undefined && input.expectedChainId !== chainId)
    throw new Error("Release chain differs from the selected chain.");
  const block = await client.getBlock();
  if (block.number === null || block.hash === null)
    throw new Error("A mined block is required.");
  const address = getAddress(input.router),
    blockNumber = block.number;
  const [word, routeId, code] = await Promise.all([
    client.readContract({
      address,
      abi: keelMintReleaseAbi,
      functionName: "releasePolicy",
      args: [input.releaseId],
      blockNumber,
    }),
    client.readContract({
      address,
      abi: keelMintReleaseAbi,
      functionName: "releaseRoute",
      args: [input.releaseId],
      blockNumber,
    }),
    client.getCode({ address, blockNumber }),
  ]);
  if (code === undefined || code === "0x")
    throw new Error("Release router code is missing.");
  const routerCodeHash = keccak256(code);
  if (
    input.expectedRouterCodeHash !== undefined &&
    routerCodeHash.toLowerCase() !== input.expectedRouterCodeHash.toLowerCase()
  )
    throw new Error(
      "Release router code does not match the expected deployment.",
    );
  const route = await client.readContract({
    address,
    abi: keelMintReleaseAbi,
    functionName: "route",
    args: [routeId],
    blockNumber,
  });
  const manager = await client.readContract({
    address: route.target,
    abi: targetAbi,
    functionName: "mintManager",
    blockNumber,
  });
  if (manager.toLowerCase() !== address.toLowerCase())
    throw new Error("Collection mint manager differs from the release router.");
  let authority: Address | null = null;
  try {
    authority = await client.readContract({
      address: route.target,
      abi: targetAbi,
      functionName: "owner",
      blockNumber,
    });
  } catch {
    if (route.standard === 1) {
      try {
        const group = await client.readContract({
          address: route.target,
          abi: targetAbi,
          functionName: "collection",
          args: [route.tokenId >> 128n],
          blockNumber,
        });
        authority = group[0];
      } catch {
        /* Unknown authority stays unknown. */
      }
    }
  }
  const targetMaximum =
    route.standard === 0
      ? await client.readContract({
          address: route.target,
          abi: targetAbi,
          functionName: "maxSupply",
          blockNumber,
        })
      : (
          await client.readContract({
            address: route.target,
            abi: targetAbi,
            functionName: "item",
            args: [route.tokenId],
            blockNumber,
          })
        )[0];
  const confirmed = await client.getBlock({ blockNumber });
  if (confirmed.hash !== block.hash || (await client.getChainId()) !== chainId)
    throw new Error("Chain snapshot changed; read the release again.");
  return Object.freeze({
    source: "pinned-rpc",
    chainId,
    blockNumber: blockNumber.toString(),
    blockHash: block.hash,
    router: address,
    routerCodeHash,
    releaseId: input.releaseId.toString(),
    collection: route.target,
    policyWord: word.toString(),
    authority,
    targetMaximum: targetMaximum.toString(),
    rows: describeKeelReleasePolicy(word),
  });
}

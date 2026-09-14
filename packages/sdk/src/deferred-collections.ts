import { encodeAbiParameters, encodeFunctionData, getAddress, keccak256, parseAbi, parseAbiParameters, zeroHash, type Address, type Hex } from "viem";
import { buildKeelCreator721Config, buildKeelCreator1155Config, type KeelCreator721ConfigInput, type KeelCreator1155ConfigInput } from "./creator-collections.js";

/** Factory capability only: an auction resolver must separately enforce final settlement. */
export type KeelDeferredCollectionOutcome =
  | { readonly standard: "ERC721"; readonly implementation?: "ERC721A" | "ERC721"; readonly config: KeelCreator721ConfigInput }
  | { readonly standard: "ERC1155"; readonly config: KeelCreator1155ConfigInput };

const config721 = "(string name,string symbol,uint256 maxSupply,address royaltyReceiver,uint96 royaltyBps,bytes32 metadataDigest)";
const config1155 = "(string name,string symbol,address royaltyReceiver,uint96 royaltyBps,bytes32 metadataDigest)";
const request = "(bool patrons,address creator,address resolver,bytes32 salt,bytes32 otherCommitment)";
export const keelDeferredCollectionAbi = parseAbi([
  "function reserveDeferredCollection(address resolver,bytes32 salt,bytes32 bidderCommitment,bytes32 patronCommitment) returns (bytes32 reservationId)",
  `function createDeferredERC721(${request} request,${config721} config,uint8 kind) returns (uint256 collectionId,address tokenContract)`,
  `function createDeferredERC1155(${request} request,${config1155} config) returns (uint256 collectionId,address tokenContract)`,
  "function deferredCollections(bytes32 reservationId) view returns (bytes32 commitment)",
]);

function word(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new TypeError("Expected bytes32.");
  return value;
}

function normalizeOutcome(value: KeelDeferredCollectionOutcome) {
  if (value.standard === "ERC721") {
    if (value.implementation !== undefined && value.implementation !== "ERC721A" && value.implementation !== "ERC721")
      throw new TypeError("Deferred seeded collections require a committed seed profile and are not supported by this entrypoint.");
    const kind = value.implementation === "ERC721" ? 1 : 0;
    const config = buildKeelCreator721Config(value.config);
    const commitment = keccak256(encodeAbiParameters(parseAbiParameters(`uint8,uint8,${config721}`), [0,kind,config]));
    return { standard: "ERC721" as const, kind, config, commitment };
  }
  if (value.standard !== "ERC1155") throw new TypeError("Unknown token standard.");
  const config = buildKeelCreator1155Config(value.config);
  const commitment = keccak256(encodeAbiParameters(parseAbiParameters(`uint8,${config1155}`), [1,config]));
  return { standard: "ERC1155" as const, config, commitment };
}

export function keelDeferredCollectionCommitment(outcome: KeelDeferredCollectionOutcome): Hex {
  return normalizeOutcome(outcome).commitment;
}

/** Uses a sale-specific salt, independent of the creator's ordinary deployment nonce. */
export function keelDeferredCollectionId(input: {chainId: bigint; factory: Address; creator: Address; resolver: Address; salt: Hex}): Hex {
  if (input.chainId <= 0n || input.chainId >= 1n << 256n) throw new RangeError("chainId must fit uint256 and be positive.");
  return keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,address,bytes32"), [
    "keel.deferred-collection.v1",input.chainId,getAddress(input.factory),getAddress(input.creator),getAddress(input.resolver),word(input.salt),
  ]));
}

/** Builds unsigned reservation and fulfillment calls. Fulfillment will revert until the resolver selects its commitment. */
export function prepareKeelDeferredCollection(input: {
  chainId: bigint; factory: Address; creator: Address; resolver: Address; salt: Hex;
  bidder: KeelDeferredCollectionOutcome; patrons?: KeelDeferredCollectionOutcome;
}) {
  const reservationId = keelDeferredCollectionId(input);
  const bidder = normalizeOutcome(input.bidder);
  const patrons = input.patrons ? normalizeOutcome(input.patrons) : undefined;
  const base = {status:"review-only" as const,chainId:input.chainId,to:getAddress(input.factory),value:0n};
  const creator=getAddress(input.creator),resolver=getAddress(input.resolver);
  const fulfillment = (outcome:ReturnType<typeof normalizeOutcome>,isPatron:boolean,otherCommitment:Hex) => {
    const params={patrons:isPatron,creator,resolver,salt:input.salt,otherCommitment};
    const data = outcome.standard === "ERC721"
      ? encodeFunctionData({abi:keelDeferredCollectionAbi,functionName:"createDeferredERC721",args:[params,outcome.config,outcome.kind]})
      : encodeFunctionData({abi:keelDeferredCollectionAbi,functionName:"createDeferredERC1155",args:[params,outcome.config]});
    return {...base,data,commitment:outcome.commitment};
  };
  return {
    reservationId,
    reservation:{...base,account:creator,data:encodeFunctionData({abi:keelDeferredCollectionAbi,functionName:"reserveDeferredCollection",args:[resolver,input.salt,bidder.commitment,patrons?.commitment??zeroHash]})},
    bidder:fulfillment(bidder,false,patrons?.commitment??zeroHash),
    patrons:patrons?fulfillment(patrons,true,bidder.commitment):undefined,
  };
}

import { encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, parseAbiParameters, type Address, type Hex, type PublicClient } from "viem";
import { prepareKeelDeferredCollection, type KeelDeferredCollectionOutcome } from "./deferred-collections.js";
import { buildKeelCreator721Config, buildKeelCreator1155Config } from "./creator-collections.js";
import { keelAuctionSaleHouseAbi } from "./auction-sales.js";

export type KeelPublicationFunding = "creator-upfront" | "proceeds" | "claimant";
export type KeelDeferredAuctionOutcome = KeelDeferredCollectionOutcome & {readonly supply:number};
const fundingModes = {"creator-upfront":0,proceeds:1,claimant:2} as const;
const planParameters = parseAbiParameters("(uint8 fundingMode,uint32 chunkCount,uint32 bidderSupply,uint32 patronSupply,uint128 publicationBudget,address executor,bytes32 objectId,(uint8 kind,bytes configuration) bidder,(uint8 kind,bytes configuration) patrons)");
export const keelDeferredAuctionIssuerAbi = parseAbi([
  "function fundPublication(uint256 auctionId) payable returns (bytes32 intentId)",
  "function quotePublication(uint256 auctionId) view returns (bytes32 intentId,uint256 fee,uint256 proceeds,uint32 revision,bool needsIntent)",
]);
export const keelDeferredAuctionHouseAbi = [
  {...keelAuctionSaleHouseAbi[0],name:"createKeelDeferredAuction",inputs:[...keelAuctionSaleHouseAbi[0].inputs.slice(0,3),{name:"plan",type:"bytes"} ]},
  ...parseAbi(["function settlePosition(uint256 auctionId)","function settlePositionWithStamp(uint256 auctionId)","function publicationReserve(uint256 auctionId) view returns (uint256)"]),
] as const;

function count(value:number,label:string):number {
  if(!Number.isInteger(value)||value<1||value>0xffffffff) throw new RangeError(`${label} must fit a positive uint32.`);
  return value;
}
function collection(outcome:KeelDeferredAuctionOutcome,objectId:Hex) {
  count(outcome.supply,"Supply");
  if(outcome.config.metadataDigest.toLowerCase()!==objectId.toLowerCase()) throw new TypeError("Collection metadataDigest must commit to this KEEL object ID.");
  if(outcome.standard==="ERC721") {
    const config=buildKeelCreator721Config(outcome.config);
    if(config.maxSupply<BigInt(outcome.supply)) throw new RangeError("Collection supply is smaller than its auction outcome.");
    return {kind:outcome.implementation==="ERC721"?1:0,configuration:encodeAbiParameters(parseAbiParameters("(string name,string symbol,uint256 maxSupply,address royaltyReceiver,uint96 royaltyBps,bytes32 metadataDigest)"),[config])};
  }
  return {kind:2,configuration:encodeAbiParameters(parseAbiParameters("(string name,string symbol,address royaltyReceiver,uint96 royaltyBps,bytes32 metadataDigest)"),[buildKeelCreator1155Config(outcome.config)])};
}

/** Reserve the alternatives, then pass encodedPlan to createKeelDeferredAuction. Neither call deploys an NFT. */
export function prepareKeelDeferredAuction(input:{
  chainId:bigint; factory:Address; issuer:Address; creator:Address; auctionId:bigint;
  objectId:Hex; executor:Address; chunkCount:number; funding:KeelPublicationFunding; publicationBudgetWei?:bigint;
  bidder:KeelDeferredAuctionOutcome; patrons?:KeelDeferredAuctionOutcome;
}) {
  if(input.auctionId<=0n||input.auctionId>=1n<<256n) throw new RangeError("Auction ID must fit a positive uint256.");
  if(!/^0x[0-9a-fA-F]{64}$/.test(input.objectId)||BigInt(input.objectId)===0n) throw new TypeError("A nonzero object ID is required.");
  if(!Object.hasOwn(fundingModes,input.funding)) throw new TypeError("Unknown funding policy.");
  const budget=input.publicationBudgetWei??0n;
  if(budget<0n||budget>=1n<<128n||(input.funding==="proceeds")!==(budget>0n)) throw new RangeError("Only proceeds funding requires a positive uint128 budget.");
  const executor=getAddress(input.executor);if(BigInt(executor)===0n)throw new TypeError("An uploader is required.");
  const salt=`0x${input.auctionId.toString(16).padStart(64,"0")}` as Hex;
  const deferred=prepareKeelDeferredCollection({chainId:input.chainId,factory:input.factory,creator:input.creator,resolver:input.issuer,salt,bidder:input.bidder,...(input.patrons?{patrons:input.patrons}:{})});
  const plan={fundingMode:fundingModes[input.funding],chunkCount:count(input.chunkCount,"Chunk count"),bidderSupply:input.bidder.supply,patronSupply:input.patrons?.supply??0,
    publicationBudget:budget,executor,objectId:input.objectId,bidder:collection(input.bidder,input.objectId),patrons:input.patrons?collection(input.patrons,input.objectId):{kind:0,configuration:"0x" as Hex}};
  return {...deferred,auctionId:input.auctionId,issuer:getAddress(input.issuer),funding:input.funding,encodedPlan:encodeAbiParameters(planParameters,[plan]),plan};
}

/** Exact block-pinned quote; a changed fee or competing publication causes execution to revert instead of overcharging. */
export async function prepareKeelAuctionPublication(input:{client:PublicClient;issuer:Address;auctionId:bigint;chainId:number}) {
  if(await input.client.getChainId()!==input.chainId) throw new Error("Publication quote is on the wrong chain.");
  const block=await input.client.getBlock();
  const issuer=getAddress(input.issuer);
  const [intentId,fee,proceeds,revision,needsIntent]=await input.client.readContract({address:issuer,abi:keelDeferredAuctionIssuerAbi,functionName:"quotePublication",args:[input.auctionId],blockNumber:block.number});
  const check=await input.client.getBlock({blockNumber:block.number});
  if(check.hash!==block.hash)throw new Error("Chain reorganized while quoting publication; refresh the quote.");
  return {intentId,fee,proceeds,revision,needsIntent,blockNumber:block.number,blockHash:block.hash,
    transaction:{status:"review-only" as const,chainId:input.chainId,to:issuer,value:fee-proceeds,data:encodeFunctionData({abi:keelDeferredAuctionIssuerAbi,functionName:"fundPublication",args:[input.auctionId]})}};
}

/** Settle funds, optionally claiming a stamp, without attempting main-NFT delivery. */
export function prepareKeelAuctionSettlement(input: {
  house: Address; auctionId: bigint; chainId: number; claimStamp?: boolean;
}) {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) throw new RangeError("A positive chain ID is required.");
  if (input.auctionId <= 0n || input.auctionId >= 1n << 256n) throw new RangeError("Auction ID must fit a positive uint256.");
  const house = getAddress(input.house);
  if (BigInt(house) === 0n) throw new TypeError("An auction house is required.");
  return {status: "review-only" as const, chainId: input.chainId, to: house, value: 0n,
    data: encodeFunctionData({abi: keelDeferredAuctionHouseAbi,
      functionName: input.claimStamp ? "settlePositionWithStamp" : "settlePosition", args: [input.auctionId]})};
}

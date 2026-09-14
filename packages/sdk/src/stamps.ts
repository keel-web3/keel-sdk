import {encodeFunctionData,getAddress,parseAbi,type Address,type Hex} from "viem";

export const keelStampRegistryAbi = parseAbi([
  "function predictControllerAdapter(address saleController) view returns (address)",
  "function createControllerAdapter(address saleController) returns (address adapter)",
  "function adapterOf(address controller_) view returns (address adapter)",
  "function saleIdFor(address controller_,uint256 localId) view returns (uint256 registryId)",
  "function configureKeel(uint256 auctionId,uint256 releaseId,uint96 priceWei,uint32 borderId,bytes3 background,bool transferable,string collectionName,bytes32 objectId) returns (address collection)",
  "function setSourceObject(uint256 id,bytes32 objectId)",
  "function registerBorder(string name,bytes32 objectId) returns (uint32 id)",
  "event SourceObjectSet(uint256 indexed saleId,bytes32 indexed objectId)",
]);
export const keelStampControllerAbi = parseAbi([
  "function configureKeel(uint256 localId,uint96 price,uint32 border,bytes3 background,bool transferable,string name,bytes32 objectId) returns (address)",
  "function tokenIdFor(uint256 localId,uint256 localTokenId) view returns (uint256)",
]);

/** Source bytes are published through the normal Hold intent flow before this setup. */
export function prepareKeelStamp(input:{chainId:number;registry:Address;saleId:bigint;releaseId?:bigint;
  controllerAdapter?:Address;objectId:Hex;priceWei:bigint;borderId:number;background:Hex;transferable:boolean;name:string}) {
  if(!Number.isSafeInteger(input.chainId)||input.chainId<=0)throw new RangeError("Invalid chain ID.");
  if(input.saleId<=0n||input.saleId>=(1n<<64n))throw new RangeError("Invalid sale ID.");
  if(input.priceWei<0n||input.priceWei>=(1n<<96n))throw new RangeError("Invalid stamp price.");
  if(!Number.isInteger(input.borderId)||input.borderId<1||input.borderId>0xffffffff)throw new RangeError("Invalid border ID.");
  if(!/^0x[0-9a-fA-F]{6}$/.test(input.background))throw new TypeError("Expected an RGB color.");
  if(!/^0x[0-9a-fA-F]{64}$/.test(input.objectId)||BigInt(input.objectId)===0n)throw new TypeError("Expected a KEEL object ID.");
  if(!/^[A-Za-z0-9 _-]{1,48}$/.test(input.name))throw new TypeError("Invalid stamp collection name.");
  const target=getAddress(input.controllerAdapter??input.registry);
  if(BigInt(target)===0n)throw new TypeError("A registry or controller adapter is required.");
  let data:Hex;
  if(input.controllerAdapter) data=encodeFunctionData({abi:keelStampControllerAbi,functionName:"configureKeel",args:[input.saleId,input.priceWei,input.borderId,input.background,input.transferable,input.name,input.objectId]});
  else {
    if(input.saleId>=1n<<63n||input.releaseId===undefined||input.releaseId<=0n||input.releaseId>0xffffffffn)throw new RangeError("A valid local sale and release are required.");
    data=encodeFunctionData({abi:keelStampRegistryAbi,functionName:"configureKeel",args:[input.saleId,input.releaseId,input.priceWei,input.borderId,input.background,input.transferable,input.name,input.objectId]});
  }
  return {status:"review-only" as const,chainId:input.chainId,to:target,value:0n,data};
}

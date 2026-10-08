import { concatHex, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, getAddress, hexToBytes, keccak256, parseAbi, sha256, stringToHex, toHex, type Abi, type Hex, type PublicClient } from "viem";
import { prepareKeelAuthenticatedCreatorInline } from "./creator-prepared-route.js";
import { createKeelCreatorPublicationJournal, type KeelCreatorPublicationStep } from "./creator-publication-journal.js";
import { buildKeelCreatorPreparedCopyBindingCall, KEEL_CREATOR_PREPARED_COPY_ABI } from "./creator-prepared-inline.js";
import { buildKeelCreatorERC721ACall, buildKeelCreatorAdminMintCall, buildKeelCreatorAdminMintToggleCall } from "./creator-collection-wallet.js";
import { prepareKeelWeld } from "./hold-publication.js";
import { keelHoldAbi } from "./abi.js";
import { resolveKeelCreatorTarget } from "./network-index.js";
import type { KeelSimulationCall } from "./publication-preflight.js";

const ABI = parseAbi([
  "function creatorNonces(address) view returns(uint256)", "function nextCollectionId() view returns(uint256)",
  "function predictNextCollectionAddress(address,uint8) view returns(address)", "function mintManager() view returns(address)",
  "function nextRouteId() view returns(uint256)", "function registerERC721Route(address,address) returns(uint256)",
  "function MAX_SCAN_BYTES() view returns(uint32)", "function verifiedDigest(bytes32) view returns(bytes32)",
  "function verifiedImageDigest(bytes32) view returns(bytes32)",
  "function validationProgress(bytes32) view returns(bytes32,uint64,uint8)",
  "function imageValidationProgress(bytes32) view returns(bytes32,uint64,uint8)",
  "function validate(bytes32,bytes32) returns(bool)", "function validateImage(bytes32,bytes32) returns(bool)",
  "function contextURI(bytes) pure returns(bytes)", "function percentEscape(bytes) pure returns(bytes)",
  "function tokenURI(uint256) view returns(string)",
]);
const HOLD = parseAbi(keelHoldAbi);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const same = (a: unknown,b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
const utf8 = (value: Uint8Array) => new TextDecoder("utf-8",{fatal:true}).decode(value);
type AuthInput = Parameters<typeof prepareKeelAuthenticatedCreatorInline>[0];
export interface KeelCreatorPreparedCompilerInput extends AuthInput {
  readonly identity: { readonly id: string; readonly actorId: string; readonly owner: Hex; readonly sourceRevision: string; readonly settingsRevision: string };
  readonly collection: { readonly name: string; readonly symbol: string; readonly royaltyReceiver: Hex; readonly royaltyBps: bigint; readonly metadataDigest: Hex };
  readonly recipient: Hex;
  readonly gas: { readonly maximumTransactionGas: bigint; readonly maximumReadGas: bigint; readonly collectionOverheadGas: bigint; readonly maximumTokenUriBytes: number }
    & ({ readonly gasPrice: Hex; readonly maxFeePerGas?: never; readonly maxPriorityFeePerGas?: never } | { readonly gasPrice?: never; readonly maxFeePerGas: Hex; readonly maxPriorityFeePerGas: Hex });
}

/** Compiles one fresh creator-owned ERC721A 1-of-1, with real paid storage,
 * registration, bounded validation, creation, binding and mint calls. No wallet
 * request is returned here. The persisted journal's next-step gate must simulate
 * every remaining call and the complete public tokenURI before each payment. */
export async function compileKeelCreatorPreparedPublication(input: KeelCreatorPreparedCompilerInput) {
  input={...input,index:structuredClone(input.index),...(input.selection===undefined?{}:{selection:structuredClone(input.selection)}),identity:structuredClone(input.identity),collection:structuredClone(input.collection),gas:structuredClone(input.gas),publication:structuredClone(input.publication)};
  if(input.gas.gasPrice!==undefined&&(input.gas.maxFeePerGas!==undefined||input.gas.maxPriorityFeePerGas!==undefined))throw new TypeError("Transaction fee styles cannot be mixed.");
  const owner=getAddress(input.identity.owner), recipient=getAddress(input.recipient);
  if(owner===ZERO||recipient===ZERO)throw new TypeError("Creator and mint recipient must be nonzero.");
  const {maximumTransactionGas,maximumReadGas,collectionOverheadGas,maximumTokenUriBytes}=input.gas;
  if(maximumTransactionGas<=0n||maximumReadGas<=0n||collectionOverheadGas<0n||!Number.isSafeInteger(maximumTokenUriBytes)||maximumTokenUriBytes<1||maximumTokenUriBytes>2_000_000)throw new TypeError("Explicit selected-chain transaction and separate read limits are required.");
  const fees = input.gas.gasPrice!==undefined ? {gasPrice:input.gas.gasPrice} : {maxFeePerGas:input.gas.maxFeePerGas,maxPriorityFeePerGas:input.gas.maxPriorityFeePerGas};
  if(Object.values(fees).some(v=>typeof v!=="string"||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(v))||("maxFeePerGas" in fees&&BigInt(fees.maxPriorityFeePerGas!)>BigInt(fees.maxFeePerGas!)))throw new TypeError("Exact valid transaction fees are required.");
  const prepared=await prepareKeelAuthenticatedCreatorInline(input), target=resolveKeelCreatorTarget(input.index,input.selection);
  const blockNumber=BigInt(prepared.route.authenticatedBlockNumber), block=toHex(blockNumber);
  const read=async(address:Hex,functionName:string,args:readonly unknown[]=[],abi:Abi=ABI):Promise<unknown>=>{
    const value=await input.pool.request({method:"eth_call",params:[{from:owner,to:address,data:encodeFunctionData({abi,functionName,args})},block]});
    if(typeof value!=="string"||!/^0x(?:[0-9a-f]{2})*$/iu.test(value))throw new TypeError(`Invalid ${functionName} read.`);
    return decodeFunctionResult({abi,functionName,data:value as Hex});
  };
  if(!same(await read(target.factory,"mintManager"),target.mintRoutes))throw new TypeError("Creator factory is not bound to the authenticated mint registry.");
  const creatorNonce=await read(target.factory,"creatorNonces",[owner]) as bigint;
  const collectionId=await read(target.factory,"nextCollectionId") as bigint;
  const collection=getAddress(await read(target.factory,"predictNextCollectionAddress",[owner,0]) as Hex);
  if(await input.pool.request({method:"eth_getCode",params:[collection,block]})!=="0x")throw new TypeError("Fresh compiler cannot replace or migrate an existing collection.");
  const routeId=await read(target.mintRoutes,"nextRouteId") as bigint;
  const scanBytes=Number(await read(prepared.route.validation,"MAX_SCAN_BYTES"));
  if(!Number.isSafeInteger(scanBytes)||scanBytes<1||creatorNonce<0n||collectionId<1n||routeId<1n)throw new TypeError("Invalid factory, mint route or validation bounds.");
  const steps:KeelCreatorPublicationStep[]=[], assertions:{callIndex:number;returnData:Hex}[]=[];
  const call=(to:Hex,data:Hex,value=0n):KeelSimulationCall=>({from:owner,to,data,value:toHex(value),gas:toHex(maximumTransactionGas),...fees});
  const add=(phase:KeelCreatorPublicationStep["phase"],to:Hex,data:Hex,value=0n,expected?:Hex)=>{
    if(steps.length>=255)throw new RangeError("Fresh publication exceeds the simulation call bound.");
    if(expected!==undefined)assertions.push({callIndex:steps.length,returnData:expected});
    steps.push({id:`${phase}:${steps.length}`,phase,call:call(to,data,value)});
  };
  // Future object plans see only exact locally planned bytes, alongside pinned
  // chain reads. This removes duplicate slug uploads between modular objects.
  const slugs=new Map<string,Hex>(), objects=new Set<string>(), sealed=new Set<string>(), registered=new Set<string>();
  const client={getBlockNumber:async()=>blockNumber,readContract:async(request:{address:Hex;abi:Abi;functionName:string;args?:readonly unknown[]})=>{
    const id=String(request.args?.[0]).toLowerCase();
    if(request.functionName==="slugPointer"&&slugs.has(id))return owner;
    if(request.functionName==="getSlug"&&slugs.has(id))return slugs.get(id)!;
    if(request.functionName==="objectExists"&&objects.has(id))return true;
    if(request.functionName==="isSealed"&&sealed.has(id))return true;
    if(request.functionName==="harnessRegistered"&&registered.has(id))return true;
    return read(request.address,request.functionName,request.args??[],request.abi);
  }} as unknown as Pick<PublicClient,"getBlockNumber"|"readContract">;
  let platformFee=0n,newStoredBytes=0,reusedStoredBytes=0;
  const unique=[...new Map(prepared.objects.map(o=>[o.objectId.toLowerCase(),o])).values()];
  for(const object of unique){
    let weld=await prepareKeelWeld({client,hold:prepared.store,payer:owner,bytes:object.bytes,mediaType:object.mediaType,objectName:object.id,renderer:prepared.route.builder});
    if(!same(weld.objectId,object.objectId)){
      // Managed preparation deliberately retains its 512KiB leaf boundaries.
      // Fee accounting must wrap that exact graph rather than silently replacing
      // its content-addressed root with prepareKeelWeld's fanout partition.
      const operations=object.operations.map(operation=>{
        const decoded=decodeFunctionData({abi:HOLD,data:operation.data});
        if(!same(operation.target,prepared.store)||operation.value!==0n)throw new TypeError("Invalid managed object operation.");
        if(decoded.functionName==="weldObject"){
          const [ids,digest,length,compression,mediaType]=decoded.args as readonly [readonly Hex[],Hex,bigint,number,string];
          if(ids.length>weld.limits.maxChildrenPerObject||compression!==0||mediaType!==object.mediaType)throw new TypeError("Prepared managed leaf exceeds selected Hold limits.");
          return {operation,slugCount:ids.length,id:keccak256(encodeAbiParameters([{type:"bytes1"},{type:"bytes32"},{type:"bytes32"},{type:"uint64"},{type:"uint64"},{type:"uint8"},{type:"bytes32"}],["0x00",keccak256(concatHex(ids)),digest,length,length,0,keccak256(stringToHex(mediaType))]))};
        }
        if(decoded.functionName!=="weldComposite")throw new TypeError("Unsupported prepared object operation.");
        const [ids,digest,length,mediaType]=decoded.args as readonly [readonly Hex[],Hex,bigint,string];
        if(ids.length>weld.limits.maxChildrenPerObject||mediaType!==object.mediaType)throw new TypeError("Prepared composite exceeds selected Hold limits.");
        return {operation,slugCount:0,id:keccak256(encodeAbiParameters([{type:"bytes1"},{type:"bytes32"},{type:"bytes32"},{type:"uint64"},{type:"uint64"},{type:"bytes32"}],["0x01",keccak256(concatHex(ids)),digest,length,length,keccak256(stringToHex(mediaType))]))};
      });
      if(!same(operations.at(-1)?.id,object.objectId))throw new TypeError("Managed graph does not reconstruct the prepared root.");
      const slugCount=operations.reduce((n,o)=>n+o.slugCount,0), intentId=keccak256(encodeAbiParameters([{type:"address"},{type:"bytes32"},{type:"address"}],[owner,object.objectId,owner]));
      const intent=await read(prepared.store,"weldIntent",[intentId],HOLD) as {executor:Hex;objectId:Hex;complete:boolean;slugCount:number;remainingSlugs:number};
      const isSealed=await read(prepared.store,"isSealed",[object.objectId],HOLD);
      const transactions:typeof weld.transactions=[];let publicationFee=0n,harnessFee=0n,storedBytes=0;
      if(!isSealed||(BigInt(intent.executor)!==0n&&!intent.complete)){
        if(BigInt(intent.executor)===0n){
          const [fee,revision]=await read(prepared.store,"quoteWeld",[slugCount,owner],HOLD) as readonly [bigint,number];publicationFee=fee;
          transactions.push({target:prepared.store,signer:owner,value:fee,data:encodeFunctionData({abi:HOLD,functionName:"initWeld",args:[object.objectId,slugCount,owner,revision]})});
        }else if(intent.complete||intent.slugCount!==slugCount||!same(intent.objectId,object.objectId)||!same(intent.executor,owner))throw new TypeError("Stored intent differs from exact managed graph.");
        let missing=0;
        for(const chunk of object.chunks){
          if(chunk.bytes.length>weld.limits.maxSlugBytes)throw new TypeError("Prepared slug exceeds selected Hold limits.");
          const planned=slugs.get(chunk.id.toLowerCase());
          const pointer=planned?owner:await read(prepared.store,"slugPointer",[chunk.id],HOLD);
          if(BigInt(String(pointer))!==0n){
            const bytes=planned??await read(prepared.store,"getSlug",[chunk.id],HOLD);
            if(typeof bytes!=="string"||!same(bytes,toHex(chunk.bytes)))throw new TypeError("Existing slug differs from exact managed bytes.");
          }else{
            missing++;storedBytes+=chunk.bytes.length;
            transactions.push({target:prepared.store,signer:owner,value:0n,data:encodeFunctionData({abi:HOLD,functionName:"castSlugsFor",args:[intentId,[toHex(chunk.bytes)]]})});
          }
        }
        if(BigInt(intent.executor)!==0n&&missing>intent.remainingSlugs)throw new TypeError("Managed intent upload allowance is exhausted.");
        for(const {operation,id} of operations)if(!objects.has(id.toLowerCase())&&!await read(prepared.store,"objectExists",[id],HOLD))transactions.push({...operation,signer:owner});
        transactions.push({target:prepared.store,signer:owner,value:0n,data:encodeFunctionData({abi:HOLD,functionName:"sealObject",args:[intentId]})});
      }
      if(!await read(prepared.store,"harnessRegistered",[object.objectId,prepared.route.builder],HOLD)){
        const fees=await read(prepared.store,"harnessFees",[],HOLD) as {registrationWei:bigint;revision:number};
        harnessFee=await read(prepared.store,"feeExempt",[owner],HOLD)?0n:fees.registrationWei;
        transactions.push({target:prepared.store,signer:owner,value:harnessFee,data:encodeFunctionData({abi:HOLD,functionName:"registerHarness",args:[object.objectId,prepared.route.builder,fees.revision]})});
      }
      weld={...weld,objectId:object.objectId,intentId,slugCount,transactions,publicationFee,harnessFee,platformFee:publicationFee+harnessFee,storedBytes,reusedBytes:object.storedByteLength-storedBytes};
    }
    platformFee+=weld.platformFee;newStoredBytes+=weld.storedBytes;reusedStoredBytes+=weld.reusedBytes;
    for(const tx of weld.transactions){
      if(!same(tx.signer,owner)||!same(tx.target,prepared.store))throw new TypeError("Storage calls must be creator-owned and target the authenticated Hold.");
      const decoded=decodeFunctionData({abi:HOLD,data:tx.data});
      if(decoded.functionName==="castSlugsFor"){
        const [intentId,batch]=decoded.args as readonly [Hex,readonly Hex[]];
        // A batch is a gas optimization, not an authority to exceed a chain's
        // transaction ceiling. One bounded Hold slug per payable transaction.
        for(const bytes of batch){add("upload",tx.target,encodeFunctionData({abi:HOLD,functionName:"castSlugsFor",args:[intentId,[bytes]]}));slugs.set(keccak256(bytes).toLowerCase(),bytes);}
      }else add("upload",tx.target,tx.data,tx.value);
    }
    objects.add(object.objectId.toLowerCase());sealed.add(object.objectId.toLowerCase());registered.add(object.objectId.toLowerCase());
  }
  for(const object of unique){
    if(object.objectId===prepared.table.objectId)continue;
    for(const image of object.objectId===prepared.image.objectId?[true]:[false]){
      const verified=await read(prepared.route.validation,image?"verifiedImageDigest":"verifiedDigest",[object.objectId]);
      if(same(verified,object.digest))continue;
      const progress=await read(prepared.route.validation,image?"imageValidationProgress":"validationProgress",[object.objectId]) as readonly [Hex,bigint,number];
      if((BigInt(progress[0])!==0n&&!same(progress[0],object.digest))||progress[1]<0n||progress[1]>BigInt(object.bytes.length)||BigInt(String(verified))!==0n)throw new TypeError("Existing validation commitment differs from prepared bytes.");
      const count=Math.max(1,Math.ceil((object.bytes.length-Number(progress[1]))/scanBytes));
      for(let i=0;i<count;i++)add("validate",prepared.route.validation,encodeFunctionData({abi:ABI,functionName:image?"validateImage":"validate",args:[object.objectId,object.digest]}),0n,i===count-1?encodeAbiParameters([{type:"bool"}],[true]):undefined);
    }
  }
  const factory=buildKeelCreatorERC721ACall({chainId:prepared.chainId,creator:owner,factoryAddress:target.factory,config:{...input.collection,maxSupply:1n}});
  // The global directory ID may advance for other creators. Exact predicted
  // collection identity is proved by the subsequent owner-only binding, mint,
  // complete read and authenticated factory receipt; do not pin an unrelated ID.
  add("create-collection",target.factory,factory.data);
  const bind=buildKeelCreatorPreparedCopyBindingCall({renderer:target.renderer,collection,tokenId:1n,plan:prepared});
  add("bind",bind.to,bind.data);
  // Exact contract86e80e9: zero is the supported no-custom-hook route.
  add("mint-route",target.mintRoutes,encodeFunctionData({abi:ABI,functionName:"registerERC721Route",args:[collection,ZERO]}),0n,encodeAbiParameters([{type:"uint256"}],[routeId]));
  const toggle=buildKeelCreatorAdminMintToggleCall({chainId:prepared.chainId,creator:owner,routeRegistryAddress:target.mintRoutes,routeId,enabled:true});
  add("mint-route",toggle.call.to,toggle.call.data);
  const mint=buildKeelCreatorAdminMintCall({chainId:prepared.chainId,creator:owner,routeRegistryAddress:target.mintRoutes,routeId,recipient,quantity:1n});
  add("mint",mint.call.to,mint.call.data);
  const bindingType=KEEL_CREATOR_PREPARED_COPY_ABI[0].inputs[2];
  const commitment=keccak256(encodeAbiParameters([{type:"bytes32"},{type:"uint256"},{type:"address"},{type:"uint256"},bindingType],[keccak256(stringToHex("keel.creator-prepared-copy-presentation@1")),BigInt(prepared.chainId),collection,1n,prepared.request]));
  const runtime=prepared.infrastructure.contracts.find(c=>same(c.address,target.renderer))!.runtimeCodeHash!;
  const context=JSON.stringify({protocol:"keel-context@3",chainId:String(prepared.chainId),collection:collection.toLowerCase(),tokenId:"1",composerAddress:target.renderer.toLowerCase(),composerCodeHash:runtime.toLowerCase(),composerRevision:"1",containerTableObjectId:prepared.table.objectId.toLowerCase(),containerTableDigest:prepared.table.digest.toLowerCase(),presentationDigest:commitment,presentationDigestType:"keccak256:keel.creator-prepared-copy-presentation@1"});
  const contextURI=utf8(hexToBytes(await read(prepared.route.builder,"contextURI",[stringToHex(context)]) as Hex));
  const escape=async(text:string)=>utf8(hexToBytes(await read(prepared.route.builder,"percentEscape",[stringToHex(text)]) as Hex));
  const prefix=`{"name":${JSON.stringify(input.collection.name+" #1")},"description":${JSON.stringify(prepared.request.description)},"image":"`;
  const expectedTokenURI="data:application/json;charset=utf-8,"+await escape(prefix)+utf8(prepared.image.bytes)+await escape('\",\"animation_url\":\"data:text/html;charset=utf-8,')+utf8(prepared.shell.prefix.bytes)+utf8(prepared.preparedBodyBytes)+utf8(prepared.shell.suffix.bytes)+await escape(contextURI+'\",\"keel_schema\":\"keel-inline-raw-percent-token-uri@1\"}');
  const completeTokenURIBytes=new TextEncoder().encode(expectedTokenURI).length;
  if(completeTokenURIBytes>maximumTokenUriBytes)throw new RangeError("Complete prepared tokenURI exceeds the selected Inline limit.");
  const journal=createKeelCreatorPublicationJournal({...input.identity,prepared,collection,tokenId:1n,steps,simulation:{metadataCall:{from:owner,to:collection,data:encodeFunctionData({abi:ABI,functionName:"tokenURI",args:[1n]}),value:"0x0",gas:toHex(maximumReadGas)},expectedTokenURI,maximumTokenUriBytes,maximumReadGas,collectionOverheadGas,maximumTransactionGas,assertions}});
  const finalBlock=await input.pool.request({method:"eth_getBlockByNumber",params:[block,false]}) as {hash?:unknown};
  if(!same(finalBlock?.hash,String(prepared.route.authenticatedBlockHash)))throw new TypeError("Publication snapshot was reorganized during compilation.");
  return {journal,creatorNonce:creatorNonce.toString(),routeId:routeId.toString(),collectionId:collectionId.toString(),sourceBytes:prepared.sourceBytes,newStoredBytes,reusedStoredBytes,platformFee:platformFee.toString(),completeTokenURIBytes,expectedTokenURISha256:sha256(stringToHex(expectedTokenURI)),status:"compiled-awaiting-simulation" as const,signing:"not-performed" as const,submission:"not-performed" as const};
}

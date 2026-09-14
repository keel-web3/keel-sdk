import { encodeFunctionData, encodeAbiParameters, parseAbi, keccak256, type Address, type Hex } from 'viem';
import { layerDigest } from './layered-art.js';
export const LAYER_REVEAL_ABI=parseAbi([
  'function allocationReady() view returns (bool)', 'function fulfilled() view returns (bool)',
  'function keyPublished() view returns (bool)', 'function revealAt() view returns (uint256)',
  'function keyCommitment() view returns (bytes32)', 'function manifestDigest() view returns (bytes32)',
  'function ciphertextDigest() view returns (bytes32)', 'function publishKey(bytes32 key)',
  'function seedOf(uint256 tokenId) view returns (bytes32)', 'function requestReveal()',
  'function settleFutureBlock()', 'function revealCreatorSeed(bytes32 secret)',
]);
export function layeredTokenSeed(input:{chainId:bigint;reveal:Address;collection:Address;manifest:Hex;allocation:Hex;supply:bigint;rootSeed:Hex;tokenId:bigint}):Hex {
  if(input.tokenId<1n||input.tokenId>input.supply)throw Error('Token is outside the frozen allocation.');
  return keccak256(encodeAbiParameters([{type:'string'},{type:'uint256'},{type:'address'},{type:'address'},{type:'bytes32'},{type:'bytes32'},{type:'uint256'},{type:'bytes32'},{type:'uint256'}],['keel-layered-token@1',input.chainId,input.reveal,input.collection,input.manifest,input.allocation,input.supply,input.rootSeed,input.tokenId]));
}
/** Local wallet preparation only. Never expose key input or returned calldata to an agent or log. */
export async function prepareLayeredKeyRelease(client:{getChainId:()=>Promise<number>;getBlock:(input:any)=>Promise<any>;getCode:(input:any)=>Promise<Hex|undefined>;readContract:(input:any)=>Promise<any>},input:{chainId:number;address:Address;runtimeCodeHash:Hex;manifestDigest:Hex;ciphertextDigest:Hex;key:Uint8Array}) {
  if(input.key.length!==32||await client.getChainId()!==input.chainId)throw Error('Wrong reveal key length or selected network.');
  // Use a finalized block for every read. Do not construct key calldata until every gate passes.
  const block=await client.getBlock({blockTag:'finalized'});if(typeof block.number!=='bigint'||typeof block.timestamp!=='bigint')throw Error('A finalized chain snapshot is required.');
  const code=await client.getCode({address:input.address,blockNumber:block.number});if(!code||keccak256(code)!==input.runtimeCodeHash)throw Error('Reveal module code does not match the reviewed immutable deployment.');
  const read=(functionName:string)=>client.readContract({address:input.address,abi:LAYER_REVEAL_ABI,functionName,blockNumber:block.number});
  const [fulfilled,published,ready,time,keyHash,manifest,cipher]=await Promise.all(['fulfilled','keyPublished','allocationReady','revealAt','keyCommitment','manifestDigest','ciphertextDigest'].map(read));
  if(fulfilled!==true||published!==false||ready!==true||typeof time!=='bigint'||block.timestamp<time)throw Error('Wait for finalized seed, reveal time and frozen allocation before preparing the key.');
  if(manifest!==input.manifestDigest||cipher!==input.ciphertextDigest||keyHash!==`0x${await layerDigest(input.key)}`)throw Error('The prepared bundle does not match this reveal contract.');
  return {chainId:input.chainId,to:input.address,data:encodeFunctionData({abi:LAYER_REVEAL_ABI,functionName:'publishKey',args:[`0x${Array.from(input.key,b=>b.toString(16).padStart(2,'0')).join('')}`]}),value:'0',snapshot:block.number.toString(),sensitive:true,signing:'not-performed'};
}
/** Read-only adapter for an audited immutable allocation/reveal deployment. */
export async function readLayeredTokenContext(client:{getChainId:()=>Promise<number>;getBlock:(input:any)=>Promise<any>;getCode:(input:any)=>Promise<Hex|undefined>;readContract:(input:any)=>Promise<any>},input:{chainId:number;address:Address;runtimeCodeHash:Hex;manifestDigest:Hex;ciphertextDigest:Hex;tokenId:bigint;encrypted:boolean}) {
  if(await client.getChainId()!==input.chainId)throw Error('Wrong selected network.');
  const block=await client.getBlock({blockTag:'finalized'});if(typeof block.number!=='bigint')throw Error('Finalized token context is unavailable.');
  const code=await client.getCode({address:input.address,blockNumber:block.number});if(!code||keccak256(code)!==input.runtimeCodeHash)throw Error('Reveal code differs from the reviewed deployment.');
  const abi=parseAbi(['function manifestDigest() view returns(bytes32)','function ciphertextDigest() view returns(bytes32)','function seedOf(uint256 tokenId) view returns(bytes32)','function keyPublished() view returns(bool)','function revealKey() view returns(bytes32)']);
  const read=(functionName:string,args:any[]=[])=>client.readContract({address:input.address,abi,functionName,args,blockNumber:block.number});
  const [manifest,cipher,seed]=await Promise.all([read('manifestDigest'),read('ciphertextDigest'),read('seedOf',[input.tokenId])]);
  if(manifest!==input.manifestDigest||cipher!==input.ciphertextDigest||typeof seed!=='string'||!/^0x[0-9a-f]{64}$/i.test(seed))throw Error('Token context does not match the prepared layer bundle.');
  let key:string|undefined;if(input.encrypted){if(await read('keyPublished')!==true)throw Error('The encryption key has not been revealed.');const value=await read('revealKey');if(typeof value!=='string'||!/^0x[0-9a-f]{64}$/i.test(value))throw Error('Invalid revealed key.');key=value.slice(2);}
  return {seed,tokenId:input.tokenId.toString(),...(key?{key}:{}),manifestDigest:manifest,blockNumber:block.number.toString(),chainId:input.chainId,reveal:input.address,proof:'finalized-rpc-readback'};
}

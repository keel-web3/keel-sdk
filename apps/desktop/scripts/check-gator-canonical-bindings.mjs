/** Receipt and exact-byte verification of an existing compact catalog snapshot.
 * Verifies publication; does not assert the snapshot is Studio's active config. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,keccak256,sha256} from 'viem';
import {keelHoldAbi} from '@keel/sdk/abi';
import {readKeelManagedObject} from '@keel/sdk/native-publication';
import {buildKeelInlineShellFragments,decodeKeelInlineGraphFragment} from '@keel/sdk/inline-viewer-graph';
const root='apps/desktop/artifacts/gator-inline-sepolia/canonical-bindings';await mkdir(root,{recursive:true});
const snapshot='/tmp/keel-compact-sepolia-image-v2-20260908';
const catalog=JSON.parse(await readFile(snapshot+'/bootstrap/studio/keel-inline-fragment-catalog.json','utf8'));
const journal=JSON.parse(await readFile(snapshot+'/catalog-journal-public.json','utf8'));
assert.equal(catalog.chainId,11155111);assert.ok(catalog.compact);
const c=createPublicClient({transport:http('https://ethereum-sepolia-rpc.publicnode.com',{timeout:20000,retryCount:1})});assert.equal(await c.getChainId(),11155111);
const blockNumber=await c.getBlockNumber(),abi=parseAbi(keelHoldAbi);
const read=(functionName,args)=>c.readContract({address:catalog.store,abi,functionName,args,blockNumber});
const ports={record:async id=>{const r=await read('getObject',[id]);assert.ok(r.exists);return {...r,chunkCount:Number(r.chunkCount)};},parts:(id,count)=>read('getObjectPartIds',[id,0n,BigInt(count)]),slug:(id,index)=>read('readSlug',[id,BigInt(index)])};
const receipt=await c.getTransactionReceipt({hash:catalog.compact.builderDeploymentTransactionHash}).catch(()=>null);
if(receipt){assert.equal(receipt.status,'success');assert.equal(receipt.contractAddress.toLowerCase(),catalog.compact.builder);}
assert.equal(keccak256(await c.getCode({address:catalog.compact.builder,blockNumber})),catalog.compact.builderRuntimeCodeHash);
assert.equal((await c.readContract({address:catalog.compact.builder,abi:parseAbi(['function keelHold() view returns(address)']),functionName:'keelHold',blockNumber})).toLowerCase(),catalog.store);
const local=await buildKeelInlineShellFragments(),checks=[];
// Published fragments may retain up to eight alignment spaces. Compare their
// decoded shell source, using the same normalization as Studio's catalog reader.
const normalized=bytes=>Buffer.from(bytes).toString('utf8').replace(/ {0,8}$/u,'');
for(const key of ['prefix','suffix']){
 const expected=catalog.compact.shell[key],r=await c.getTransactionReceipt({hash:journal.operations[key+':weld'].hash}).catch(()=>null);if(r)assert.equal(r.status,'success');
 const bytes=await readKeelManagedObject(expected.objectId,ports);assert.equal(sha256(bytes),expected.digest);assert.equal(bytes.length,expected.byteLength);
 await writeFile(root+'/'+key+'.raw-percent.bin',bytes);
 const decoded=decodeKeelInlineGraphFragment(bytes,expected.mediaType);
 const registered=catalog.shell[key],registeredBytes=await readKeelManagedObject(registered.objectId,ports);
 assert.equal(sha256(registeredBytes),registered.digest);assert.equal(registeredBytes.length,registered.byteLength);
 const registeredDecoded=decodeKeelInlineGraphFragment(registeredBytes,registered.mediaType);
 assert.equal(normalized(decoded),normalized(registeredDecoded),'Compact carriage must match the registered shell');
 const matches=normalized(decoded)===normalized(local[key].bytes);
 checks.push({key,objectId:expected.objectId,byteLength:bytes.length,digest:expected.digest,receipt:r?.transactionHash??null,compactMatchesRegisteredShell:true,decodedMatchesLocalShell:matches,localDigest:local[key].integrity.digest,decodedDigest:sha256(decoded)});
}
const report={schema:'gator-canonical-catalog-readback@1',checkedAt:new Date().toISOString(),chainId:11155111,block:String(blockNumber),catalogSource:snapshot+'/bootstrap/studio/keel-inline-fragment-catalog.json',builder:catalog.compact.builder,builderReceipt:receipt?.transactionHash??null,builderCodeMatches:true,store:catalog.store,checks,allLocalShellBytesMatch:checks.every(x=>x.decodedMatchesLocalShell),layeredRuntimeCatalogBindingPresent:catalog.compact.modules.some(x=>x.moduleId==='keel-layered-runtime-v4'&&x.version==='4.0.1'),activeStudioCatalogVerified:false,newTransactionsSent:0};
await writeFile(root+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));

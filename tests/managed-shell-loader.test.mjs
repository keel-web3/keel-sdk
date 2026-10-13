import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildKeelManagedShellLoader } from '../packages/sdk/dist/managed-shell-loader.js';
import { readFile } from 'node:fs/promises';
const reference = {chainId:11155111,store:'0x1111111111111111111111111111111111111111',objectId:'0x'+'ab'.repeat(32),digest:'0x'+'cd'.repeat(32)};
const one='https://ethereum-sepolia-rpc.publicnode.com/';
const two='https://sepolia.drpc.org/';
const configuration=html=>JSON.parse(html.match(/globalThis\.__KEEL_MANAGED_SHELL__=(.*?);/u)[1]);
test('governed provider failover remains transport configuration around exact native object references',()=>{
 const first=configuration(buildKeelManagedShellLoader({...reference,rpcUrl:one}));
 const second=configuration(buildKeelManagedShellLoader({...reference,rpcUrls:[one,two],maxConcurrentReads:12}));
 for(const key of Object.keys(reference)) { assert.equal(first[key],reference[key]); assert.equal(second[key],reference[key]); }
 assert.deepEqual(first.rpcUrls,[one]);assert.deepEqual(second.rpcUrls,[one,two]);
 assert.equal(first.maxConcurrentReads,4);assert.equal(second.maxConcurrentReads,12);
 assert.equal(second.rpcUrl,undefined);assert.equal(second.estimatedLoadMs,undefined);
});
test('loader refuses ambiguous, ungoverned, duplicate and unbounded transport configurations',()=>{
 for(const patch of [{rpcUrls:[]},{rpcUrl:one,rpcUrls:[one]}, {rpcUrls:[one,one]}, {rpcUrls:Array(9).fill(one)}, {rpcUrls:[one],rpcHosts:[]}, {rpcUrls:['https://unapproved.example/']}, {rpcUrls:['https://127.0.0.1/'],rpcHosts:['127.0.0.1']}, {rpcUrls:[one+'#x']}, ...[0,65,1.5,NaN].map(maxConcurrentReads=>({rpcUrls:[one],maxConcurrentReads}))]) assert.throws(()=>buildKeelManagedShellLoader({...reference,...patch}));
 assert.doesNotThrow(()=>buildKeelManagedShellLoader({...reference,rpcUrls:['https://reader.example/'],rpcHosts:['reader.example'],maxConcurrentReads:64}));
});
test('portable loader reuses canonical governed transport and bounded native graph reader',async()=>{
 const runtime=await readFile(new URL('../packages/sdk/scripts/managed-shell-runtime.mjs',import.meta.url),'utf8');
 assert.match(runtime,/createKeelChain/u);assert.match(runtime,/createKeelHoldObjectReader/u);
 assert.match(runtime,/rpc:c\.rpcUrls\?\?c\.rpcUrl,hosts:c\.rpcHosts/u);
 assert.match(runtime,/maxConcurrentReads:c\.maxConcurrentReads\?\?4/u);
 assert.match(runtime,/crypto\.subtle\.digest\('SHA-256',bytes\)/u);
 assert.match(runtime,/actual!==c\.digest\.toLowerCase\(\)/u);
 assert.doesNotMatch(runtime,/Promise\.all\(.*map/u);
});

test('the bundled managed runtime verifies native bytes at a pinned hash and mounts the existing shell',async()=>{
 const result=await executeFixture(false);
 assert.equal(result.failed,false);
 assert.match(result.html,/verify-corner/);assert.match(result.html,/__KEEL_ONCHAIN_CONTEXT__/);
 assert.ok(result.requests.some(r=>r.method==='eth_getCode'));
 for(const request of result.requests.filter(r=>['eth_call','eth_getCode'].includes(r.method))) assert.deepEqual(request.params[1],{blockHash:'0x'+'11'.repeat(32),requireCanonical:true});
});
test('the bundled managed runtime never mounts corrupt native object bytes',async()=>{
 const result=await executeFixture(true);
 assert.equal(result.failed,true);assert.equal(result.html,'');assert.match(result.error,/mismatch|integrity/i);
});
async function executeFixture(corrupt) {
 const {runInNewContext}=await import('node:vm');
 const {webcrypto,createHash}=await import('node:crypto');
 const {encodeFunctionResult,parseAbi}=await import('viem');
 const {KEEL_MANAGED_SHELL_RUNTIME}=await import('../packages/sdk/dist/managed-shell-runtime.js');
 const abi=parseAbi([
  'function getObject(bytes32) view returns ((bytes32 digest,bytes32 indexDigest,address descriptorPointer,uint64 byteLength,uint64 storedByteLength,uint64 chunkCount,uint8 compression,bool composite,bool exists,string mediaType))',
  'function getObjectSlugPointers(bytes32,uint256,uint256) view returns(address[])',
 ]);
 const source='<html><head></head><body><div id="verify-corner">existing shell</div></body></html>';
 const bytes=new TextEncoder().encode(encodeURIComponent(encodeURIComponent(source)));
 const digest='0x'+createHash('sha256').update(bytes).digest('hex');
 const requests=[],result={requests,html:'',failed:false,error:''};
 let complete;const done=new Promise(resolve=>{complete=resolve});
 const status={set textContent(value){result.error=value;result.failed=true;complete();}};
 const record={digest,indexDigest:'0x'+'00'.repeat(32),descriptorPointer:'0x'+'00'.repeat(20),byteLength:BigInt(bytes.length),storedByteLength:BigInt(bytes.length),chunkCount:1n,compression:0,composite:false,exists:true,mediaType:'text/html'};
 const context={setTimeout,clearTimeout,URL,AbortController,TextDecoder,TextEncoder,Uint8Array,DataView,ArrayBuffer,crypto:webcrypto,
  __KEEL_MANAGED_SHELL__:{...reference,digest,rpcUrls:[one],rpcHosts:['publicnode.com'],maxConcurrentReads:4},
  __KEEL_ONCHAIN_CONTEXT__:{json:'{"tokenId":"1"}'},
  document:{getElementById:()=>status,documentElement:{dataset:{}},open(){},write(html){result.html=html;},close(){complete();}},
  fetch:async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);let data;
   if(request.method==='eth_chainId')data='0xaa36a7';
   else if(request.method==='eth_getBlockByNumber')data={number:'0x10',hash:'0x'+'11'.repeat(32)};
   else if(request.method==='eth_getCode'){const code=new Uint8Array(bytes);if(corrupt)code[0]^=1;data='0x00'+Buffer.from(code).toString('hex');}
   else if(request.method==='eth_call'){
    if(request.params[0].data.length===74)data=encodeFunctionResult({abi,functionName:'getObject',result:record});
    else data=encodeFunctionResult({abi,functionName:'getObjectSlugPointers',result:['0x'+'22'.repeat(20)]});
   }else throw Error('Unexpected mocked RPC');
   return Response.json({jsonrpc:'2.0',id:request.id,result:data});
  }};
 runInNewContext(KEEL_MANAGED_SHELL_RUNTIME,context);
 let timeout;try{await Promise.race([done,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Mock runtime did not settle')),2000)})]);}finally{clearTimeout(timeout);}
 return result;
}

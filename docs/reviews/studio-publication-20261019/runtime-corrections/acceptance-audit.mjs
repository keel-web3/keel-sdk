// Implementer acceptance of the independent reviewer's exact three counterexamples.
// The original review reproducer is unchanged and continues to assert the old bug.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2]),output=resolve(process.argv[3]);
const module=path=>import(pathToFileURL(resolve(root,path)).href);
const {createKeelRpcClient}=await module('packages/protocol/dist/keel-rpc.js');
const {createKeelChain}=await module('packages/viewer/src/keel-rpc-view.js');
const sha=value=>createHash('sha256').update(value).digest('hex');
const urls=['https://one.example/rpc','https://two.example/rpc'],hosts=['one.example','two.example'];
const store='0x'+'11'.repeat(20),block={number:'0x123',hash:'0x'+'ab'.repeat(32)},results=[];
for(const family of ['protocol','viewer']){
 const calls=[];
 const fetchImpl=async(url,init)=>{const q=JSON.parse(init.body);calls.push({url,method:q.method});if(q.method==='eth_chainId')return Response.json({jsonrpc:'2.0',id:q.id,result:'0x7a69'});if(url===urls[0])return Response.json({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted',data:'0x'+'ab'.repeat(40_000)}},{status:503});return Response.json({jsonrpc:'2.0',id:q.id,result:'0x6000'});};
 const client=family==='protocol'?createKeelRpcClient({family:'ethereum',chainId:31337,verifyChainId:true,endpoints:urls,hostList:hosts,fetchImpl,maxRetries:0}):createKeelChain({rpc:urls,hosts,keelHold:store,expectedChainId:31337,fetchImpl,maxRetries:0});
 let error;try{if(family==='protocol')await client.call({to:store,data:'0x1234',block:'0x123'});else await client.call(store,'0x1234','0x123');}catch(value){error=value;}
 const execution=calls.filter(q=>q.method==='eth_call');assert.equal(error?.terminal,true);assert.equal(execution.length,1);assert.ok(calls.every(q=>q.url===urls[0]));
 results.push({case:family+' oversized genuine RPC revert',status:'PASS',errorCode:error.code,terminal:error.terminal,errorBodyBytes:80086,executionDispatches:execution.length,alternateRecipientDispatches:calls.filter(q=>q.url!==urls[0]).length});
}
const calls=[];
const client=createKeelChain({rpc:urls,hosts,keelHold:store,expectedChainId:31337,fetchImpl:async(_url,init)=>{const q=JSON.parse(init.body);if(q.method==='eth_chainId')return Response.json({jsonrpc:'2.0',id:q.id,result:'0x7a69'});if(q.method==='eth_getBlockByNumber')return Response.json({jsonrpc:'2.0',id:q.id,result:block});calls.push(q.params);return Response.json({jsonrpc:'2.0',id:q.id,result:calls.length===1?'0x6001':'0x6002'});}});
await client.pinBlock();const slot='0x'+'00'.repeat(32),override=n=>({[store]:{stateDiff:{[slot]:'0x'+n.toString(16).padStart(64,'0')}}});
const params=[{to:store,data:'0x1234'},'latest',override(1)];
const pending=client.request('eth_call',params);params[0].data='0x9999';params[2]=override(9);
const first=await pending,second=await client.request('eth_call',[{to:store,data:'0x1234'},'latest',override(2)]);
assert.equal(first,'0x6001');assert.equal(second,'0x6002');assert.equal(calls.length,2);assert.equal(calls[0][0].data,'0x1234');assert.deepEqual(calls[0][2],override(1));
assert.equal(await client.request('eth_call',[{to:store,data:'0x1234'},'latest',override(1)]),first);assert.equal(calls.length,2);
results.push({case:'full pinned execution-argument identity and pre-await snapshot',status:'PASS',first,second,physicalCalls:calls.length,firstOverrideSHA256:sha(JSON.stringify(calls[0][2])),secondOverrideSHA256:sha(JSON.stringify(calls[1][2])),immutableInputSnapshot:true});
const receipt={schema:'keel-runtime-review-correction-acceptance@1',sourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),environment:{node:process.version,zlib:process.versions.zlib},scope:'Implementer test with actual SDK/source transports and in-memory HTTP doubles; no public network, EVM, browser, signature or original-program proof',reviewBaseline:{siteEvidenceCommit:'ece35e3d5d642174cfbfcc509fdfe42d554e40f9',oldRuntimeSource:'606479dff9d26e9af011001182e0dd91dab65f7c'},sourceHashes:{protocol:sha(await readFile(resolve(root,'packages/protocol/src/keel-rpc.ts'))),viewer:sha(await readFile(resolve(root,'packages/viewer/src/keel-rpc-view.js')))},results};
await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(results));

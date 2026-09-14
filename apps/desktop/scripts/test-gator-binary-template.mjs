/** Exact local read proof. Does not publish, modify the collection, or send layers outside this machine. */
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createPublicClient,createWalletClient,http,toHex,sha256,keccak256,encodeFunctionData,decodeAbiParameters} from 'viem';
import {createKeelNativeObjectPlan} from '../../../packages/sdk/dist/native-publication.js';
const root='apps/desktop/artifacts/gator-inline-sepolia/3750-native-binary';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const inputs=await json('apps/desktop/artifacts/gator-ape-rebuild/mixed-codec-test-3750/selected.json');
const files=await Promise.all(inputs.map(async r=>({bytes:await readFile(r.file),mediaType:r.type})));
const holdBuild=await json('apps/desktop/artifacts/gator-sepolia/sepolia-hold-build.json');
const compiled=(await json('apps/desktop/artifacts/gator-inline-sepolia/binary-template-build.json')).contracts['apps/desktop/contracts/KeelBinaryTemplateReader.sol:KeelBinaryTemplateReader'];
const sources=[],index=new Map();
const add=(bytes,base64)=>{const id=base64+':'+createHash('sha256').update(bytes).digest('hex');if(!index.has(id)){index.set(id,sources.length);sources.push({bytes,base64});}return index.get(id);};
const literals=[];
function recipe(document){const occurrences=[];for(const r of files){const encoded=r.bytes.toString('base64');for(let start=document.indexOf(encoded);start>=0;start=document.indexOf(encoded,start+encoded.length))occurrences.push({start,end:start+encoded.length,bytes:r.bytes});}occurrences.sort((a,b)=>a.start-b.start);let cursor=0;const sequence=[];for(const hit of occurrences){assert.ok(hit.start>=cursor,'Overlapping substitution');if(hit.start>cursor)sequence.push(add(Buffer.from(document.slice(cursor,hit.start)),false));sequence.push(add(hit.bytes,true));cursor=hit.end;}if(cursor<document.length)sequence.push(add(Buffer.from(document.slice(cursor)),false));return {sequence,bytes:Buffer.from(document)};}
const recipes=[recipe(await readFile(root+'/metadata-candidate.json','utf8')),recipe(await readFile(root+'/metadata-candidate-uri.txt','utf8')),recipe(await readFile(root+'/image.svg','utf8')),recipe(await readFile(root+'/viewer.html','utf8'))];
const child=spawn('/Users/ravonus/.foundry/bin/anvil',['--port','0','--chain-id','31337','--gas-limit','150000000'],{stdio:['ignore','pipe','pipe']});
try{
const url=await new Promise((resolve,reject)=>{let s='';const timer=setTimeout(()=>reject(Error('Local EVM timeout')),15000);child.once('error',reject);child.stdout.on('data',b=>{s+=b;const m=s.match(/Listening on (127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve('http://'+m[1]);}});});
const c=createPublicClient({transport:http(url,{timeout:60000})}),w=createWalletClient({transport:http(url,{timeout:60000})}),[account]=await w.getAddresses();assert.equal(await c.getChainId(),31337);
const receipt=async hash=>{const r=await c.waitForTransactionReceipt({hash});assert.equal(r.status,'success');return r;};
const hold=(await receipt(await w.deployContract({account,chain:null,abi:holdBuild.abi,bytecode:holdBuild.bytecode.object}))).contractAddress;
const reader=(await receipt(await w.deployContract({account,chain:null,abi:compiled.abi,bytecode:'0x'+compiled.bin,args:[hold]}))).contractAddress;
const chunks=new Map(),sourcePlans=[];
for(const source of sources){const plan=await createKeelNativeObjectPlan(source.bytes,{objectName:'template-source',mediaType:source.base64?'application/octet-stream':'text/plain',keccak256});for(const chunk of plan.chunks)chunks.set(keccak256(chunk),chunk);sourcePlans.push({slugs:plan.slugIds,base64:source.base64});}
let uploadGas=0n;const pending=[...chunks.values()];for(let i=0;i<pending.length;i+=3)uploadGas+=(await receipt(await w.writeContract({account,chain:null,address:hold,abi:holdBuild.abi,functionName:'castSlugs',args:[pending.slice(i,i+3).map(toHex)]}))).gasUsed;
await receipt(await w.writeContract({account,chain:null,address:reader,abi:compiled.abi,functionName:'addSources',args:[sourcePlans]}));
for(const [id,r] of recipes.entries())await receipt(await w.writeContract({account,chain:null,address:reader,abi:compiled.abi,functionName:'setRecipe',args:[BigInt(id),r.sequence,BigInt(r.bytes.length),sha256(r.bytes)]}));
console.log(JSON.stringify({phase:'local-read',sources:sources.length,binarySources:sources.filter(s=>s.base64).length,storedBytes:[...chunks.values()].reduce((n,b)=>n+b.length,0)}));
const reads=[];for(const [i,fn] of ['tokenJSON','tokenURI','image','animation'].entries()){
const data=encodeFunctionData({abi:compiled.abi,functionName:fn,args:[0n]});
try{const response=await c.call({to:reader,data,gas:150_000_000n});const [actual]=decodeAbiParameters([{type:'bytes'}],response.data);assert.equal(actual,toHex(recipes[i].bytes));const gas=await c.estimateGas({to:reader,data,gas:150_000_000n});reads.push({function:fn,bytes:recipes[i].bytes.length,gas:String(gas),exactBytes:true,under60Million:gas<60_000_000n});}catch(e){reads.push({function:fn,under60Million:false,error:e.shortMessage??e.message});}}
console.log(JSON.stringify({reads}));
const response=await c.call({to:reader,data:toHex('/tokenJSON/0.json'),gas:150_000_000n});const [actual]=decodeAbiParameters([{type:'bytes'}],response.data);assert.equal(actual,toHex(recipes[0].bytes));
const report={schema:'gator-binary-template-local-proof@1',localOnly:true,published:false,sources:sources.length,binaryLayerSources:sources.filter(s=>s.base64).length,uniqueStoredBytes:[...chunks.values()].reduce((n,b)=>n+b.length,0),chunks:chunks.size,setupUploadGas:String(uploadGas),reads,manualWeb3PathExact:true,canonicalPublicationReuseBound:false};await writeFile(root+'/binary-read-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{child.kill('SIGTERM');}

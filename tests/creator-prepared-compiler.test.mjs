import {compileKeelCreatorPreparedPublication} from '../packages/sdk/dist/creator-prepared-compiler.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {parseAbi,keccak256,encodeFunctionResult,decodeFunctionData,toHex,stringToHex,sha256} from 'viem';
import {prepareKeelAuthenticatedCreatorInline,prepareKeelCreatorInline,buildKeelNetworkIndex,keelHoldAbi} from '../packages/sdk/dist/index.js';
const names=['KeelHold','KeelCreatorFactory','KeelArtifactTokenRenderer','KeelMintRouteRegistry','KeelRawTokenURIBuilder','KeelRawInlineShellRegistry','KeelRawFragmentValidationRegistry','KeelArtifactRegistry'];
const address=n=>'0x'+n.toString(16).padStart(40,'0'), hash=n=>'0x'+n.toString(16).padStart(64,'0');
const addresses=Object.fromEntries(names.map((n,i)=>[n,address(i+1)]));
const code='0x60006000',blockHash=hash(999);
const deployments=names.map((contract,i)=>({contract,address:addresses[contract],chainId:31337,module:'test',instance:'prepared-test',runtimeCodeHash:keccak256(code),txHash:hash(i+1),block:'1'}));
const index=buildKeelNetworkIndex(deployments,{defaultChainId:31337,networks:[{chainId:31337,name:'test',environment:'local',defaultInstance:'prepared-test',rpcUrls:[]}]});
const publication={resources:[{id:'index.html',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<html><body>'+('exact source'.repeat(100))+'</body></html>')}],poster:{mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')}};
const abi=parseAbi([...keelHoldAbi,
 'function requireRegistration(bytes32) view', 'function metadataRenderer() view returns(address)', 'function preparedCopyBuilder() view returns(address)', 'function preparedCopyShellRegistry() view returns(address)', 'function preparedCopyValidationRegistry() view returns(address)', 'function artifactRegistry() view returns(address)', 'function manager() view returns(address)', 'function platformAuthority() view returns(address)', 'function rawFragmentValidationRegistry() view returns(address)', 'function RAW_INLINE_PROTECTION_SHELL_ID() view returns(bytes32)', 'function creatorManagedShell(bytes32) view returns(bool)', 'function shellRevision(bytes32,uint64) view returns(bytes32,bytes32,uint8,bool,bytes32)', 'function builder() view returns(address)', 'function verifiedDigest(bytes32) view returns(bytes32)',  'function keelHold() view returns(address)',
 'function mintManager() view returns(address)', 'function creatorNonces(address) view returns(uint256)', 'function nextCollectionId() view returns(uint256)',
 'function predictNextCollectionAddress(address,uint8) view returns(address)', 'function nextRouteId() view returns(uint256)',
 'function MAX_SCAN_BYTES() view returns(uint32)', 'function verifiedImageDigest(bytes32) view returns(bytes32)',
 'function validationProgress(bytes32) view returns(bytes32,uint64,uint8)', 'function imageValidationProgress(bytes32) view returns(bytes32,uint64,uint8)',
 'function contextURI(bytes) pure returns(bytes)', 'function percentEscape(bytes) pure returns(bytes)']);
async function fixture(bad={}){
 const plan=await prepareKeelCreatorInline({...publication,chainId:31337,store:addresses.KeelHold});
 const objects=new Map([plan.shell.prefix,plan.shell.suffix].map(o=>[o.objectId,o]));const preparedObjects=new Map(plan.objects.map(o=>[o.objectId,o]));const requests=[];
 const pool={status:()=>[],request:async req=>{requests.push(req);
  if(req.method==='eth_chainId')return '0x7a69';if(req.method==='eth_blockNumber')return '0x2';
  if(req.method==='eth_getBlockByNumber')return {number:'0x2',hash:bad.reorg&&requests.filter(r=>r.method==='eth_getBlockByNumber').length>1?hash(123):blockHash};
  if(req.method==='eth_getCode')return req.params[0].toLowerCase()===address(800)?(bad.existing?code:'0x'):bad.runtime?'0x6001':code;
  if(req.method==='eth_getTransactionReceipt'){const entry=deployments.find(d=>d.txHash===req.params[0]);return {status:'0x1',transactionHash:entry.txHash,contractAddress:entry.address,blockNumber:'0x1',blockHash};}
  assert.equal(req.method,'eth_call');assert.equal(req.params[1],'0x2');
  const call=decodeFunctionData({abi,data:req.params[0].data}), name=call.functionName;let result;
  const bindings={mintManager:'KeelMintRouteRegistry',metadataRenderer:'KeelArtifactTokenRenderer',keelHold:'KeelHold',preparedCopyBuilder:'KeelRawTokenURIBuilder',preparedCopyShellRegistry:'KeelRawInlineShellRegistry',preparedCopyValidationRegistry:'KeelRawFragmentValidationRegistry',artifactRegistry:'KeelArtifactRegistry',rawFragmentValidationRegistry:'KeelRawFragmentValidationRegistry',builder:'KeelRawTokenURIBuilder'};
  if(bindings[name])result=bad.binding===name?address(888):addresses[bindings[name]];
  else if(name==='manager'||name==='platformAuthority')result=address(999);
  else if(name==='RAW_INLINE_PROTECTION_SHELL_ID')result=keccak256(stringToHex('keel.shell.inline-raw-percent-protection@1'));
  else if(name==='creatorManagedShell')result=false;
  else if(name==='shellRevision')result=[plan.shell.prefix.objectId,plan.shell.suffix.objectId,bad.mode?2:3,true,hash(501)];
  else if(name==='creatorNonces')result=3n;
  else if(name==='nextCollectionId')result=5n;
  else if(name==='predictNextCollectionAddress')result=address(800);
  else if(name==='nextRouteId')result=7n;
  else if(name==='MAX_SCAN_BYTES')result=32768;
  else if(name==='limits')result=[24575,8,128,16,1n];
  else if(name==='slugPointer')result=address(0);
  else if(name==='weldIntent')result={payer:address(0),executor:address(0),objectId:hash(0),slugCount:0,remainingSlugs:0,complete:false};
  else if(['isSealed','objectExists','harnessRegistered','feeExempt'].includes(name))result=false;
  else if(name==='quoteWeld')result=[11n,1n];
  else if(name==='harnessFees')result={registrationWei:13n,revision:1};
  else if(name==='requireSystemsActive')result=undefined;
  else if(name==='percentEscape')result=toHex(Buffer.from(escapeBytes(Buffer.from(call.args[0].slice(2),'hex'))));
  else if(name==='contextURI'){
    const b=Buffer.from(call.args[0].slice(2),'hex');
    result=toHex(Buffer.from(escapeBytes(Buffer.from(`<script>(()=>{try{const v="${b.toString('base64url')}",b=v.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-v.length%4)%4),j=atob(b),c=Object.freeze(JSON.parse(j)),o=Object.freeze({json:j,digest:"${sha256(b)}",byteLength:${b.length}});Object.defineProperty(globalThis,"__KEEL_CONTEXT__",{value:c,enumerable:true,writable:false,configurable:false});Object.defineProperty(globalThis,"__KEEL_ONCHAIN_CONTEXT__",{value:o,enumerable:true,writable:false,configurable:false})}catch(e){document.documentElement.dataset.keelContext="failed";throw e}})()</script>`))));
  }
  else if(name==='validationProgress'||name==='imageValidationProgress')result=[bad.progress?hash(999):hash(0),0n,0];
  else if(name==='verifiedImageDigest')result=bad.cached?preparedObjects.get(call.args[0]).digest:hash(0);
  else {const object=objects.get(call.args[0]);
   if(!object){assert.equal(name,'verifiedDigest');return encodeFunctionResult({abi,functionName:name,result:bad.cached?preparedObjects.get(call.args[0]).digest:hash(0)});}
   if(name==='requireRegistration'&&bad.registration)throw Error('not registered');
   if(name==='verifiedDigest')result=bad.digest?hash(777):object.digest;
   if(name==='haulObject')result=toHex(bad.bytes?Uint8Array.of(1):object.bytes);
   if(name==='getObject')result={digest:object.digest,indexDigest:hash(0),descriptorPointer:address(1),byteLength:BigInt(object.bytes.length),storedByteLength:BigInt(object.bytes.length),chunkCount:1,compression:0,composite:false,exists:true,mediaType:'application/vnd.keel.token-uri-raw-percent-fragment'};
  }
  return encodeFunctionResult({abi,functionName:name,result});
 }};return {pool,plan,requests};
}
const escapeBytes=bytes=>[...bytes].map(b=>b<128&&(0x47fffffe87ffffffafffffd200000000n>>BigInt(b)&1n)?String.fromCharCode(b):'%'+b.toString(16).toUpperCase().padStart(2,'0')).join('');
const config={identity:{id:'release-1',actorId:'actor-1',owner:address(700),sourceRevision:'source-1',settingsRevision:'settings-1'},collection:{name:'Exact "Art"',symbol:'EXACT',royaltyReceiver:address(700),royaltyBps:500n,metadataDigest:hash(80)},recipient:address(701),gas:{maximumTransactionGas:16_777_216n,maximumReadGas:50_000_000n,collectionOverheadGas:100_000n,maximumTokenUriBytes:2_000_000,gasPrice:'0x1'}};
test('compiler emits exact paid calls, predicted factory binding, mint route and full URI but no wallet request',async()=>{
 const f=await fixture();const result=await compileKeelCreatorPreparedPublication({pool:f.pool,index,publication,...config});
 assert.equal(result.status,'compiled-awaiting-simulation');assert.equal(result.journal.collection,address(800));assert.equal(result.creatorNonce,'3');
 assert.equal(result.approval,undefined);assert.equal(result.journal.receipts.length,0);
 assert.ok(BigInt(result.platformFee)>0n);assert.ok(result.completeTokenURIBytes>1000);
 assert.ok(result.journal.steps.every(s=>s.call.from.toLowerCase()===address(700)&&BigInt(s.call.gas)===16_777_216n&&s.call.gasPrice==='0x1'));
 assert.equal(result.journal.steps.filter(s=>s.phase==='mint').length,1);assert.equal(result.journal.steps.filter(s=>s.phase==='mint-route').length,2);
 assert.equal(result.journal.simulation.observationCalls,undefined);
 const paid=result.journal.steps.filter(s=>BigInt(s.call.value)>0n);assert.ok(paid.length>1);
 assert.ok(paid.every(s=>s.phase==='upload'));assert.equal(paid.reduce((n,s)=>n+BigInt(s.call.value),0n),BigInt(result.platformFee));assert.ok(paid.every(s=>[11n,13n].includes(BigInt(s.call.value))));
 const casts=result.journal.steps.filter(s=>s.phase==='upload').map(s=>decodeFunctionData({abi,data:s.call.data})).filter(c=>c.functionName==='castSlugsFor');assert.ok(casts.length);assert.ok(casts.every(c=>c.args[1].length===1));
 const full=result.journal.simulation.expectedTokenURI;assert.equal(Buffer.byteLength(full),result.completeTokenURIBytes);
 const metadata=JSON.parse(decodeURIComponent(full.slice(full.indexOf(',')+1)));
 const html=decodeURIComponent(metadata.animation_url.slice(metadata.animation_url.indexOf(',')+1));
 const context=JSON.parse(Buffer.from(html.match(/const v="([A-Za-z0-9_-]+)",b=v.replace/)[1],'base64url').toString());assert.equal(context.collection,address(800));assert.equal(context.composerAddress,addresses.KeelArtifactTokenRenderer);assert.equal(context.chainId,'31337');
 assert.equal(metadata.name,'Exact "Art" #1');assert.equal(metadata.image,f.plan.posterURI);assert.match(metadata.animation_url,/data:text\/html;charset=utf-8,/);
 const inputs=f.requests.filter(r=>r.method==='eth_call');assert.ok(inputs.every(r=>r.params[1]==='0x2'));
 assert.ok(f.requests.every(r=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(r.method)));
});
test('compiler rejects existing collections and mint manager drift before payment',async()=>{
 for(const bad of [{existing:true},{binding:'mintManager'},{progress:true},{reorg:true}]){const f=await fixture(bad);await assert.rejects(compileKeelCreatorPreparedPublication({pool:f.pool,index,publication,...config}));}
});
test('compiler rejects missing transaction fees and invalid gas/URI bounds',async()=>{
 for(const gas of [{...config.gas,maxFeePerGas:'0x1',maxPriorityFeePerGas:'0x1'},{...config.gas,gasPrice:undefined},{...config.gas,maximumTransactionGas:0n},{...config.gas,maximumTokenUriBytes:2_000_001}]){
  const f=await fixture();await assert.rejects(compileKeelCreatorPreparedPublication({pool:f.pool,index,publication,...config,gas}));
 }
});
test('journal identity binds source, settings, exact fee quote and all source calls',async()=>{
 const f=await fixture(),a=await compileKeelCreatorPreparedPublication({pool:f.pool,index,publication,...config});
 const g=await fixture(),b=await compileKeelCreatorPreparedPublication({pool:g.pool,index,publication,...config,identity:{...config.identity,sourceRevision:'source-2'}});
 assert.notEqual(a.journal.fingerprint,b.journal.fingerprint);
 const phases=a.journal.steps.map(s=>s.phase);assert.ok(phases.lastIndexOf('upload')<phases.indexOf('validate'));assert.ok(phases.lastIndexOf('validate')<phases.indexOf('create-collection'));
});

test('exact cached validation is reused, while changed source calls change journal identity',async()=>{
 const f=await fixture({cached:true});const cached=await compileKeelCreatorPreparedPublication({pool:f.pool,index,publication,...config});
 assert.equal(cached.journal.steps.filter(s=>s.phase==='validate').length,0);
 const g=await fixture();const original=await compileKeelCreatorPreparedPublication({pool:g.pool,index,publication,...config});
 const h=await fixture();const changed=await compileKeelCreatorPreparedPublication({pool:h.pool,index,publication:{...publication,description:'changed exact bytes'},...config});
 assert.notEqual(original.journal.fingerprint,changed.journal.fingerprint);assert.notEqual(original.expectedTokenURISha256,changed.expectedTokenURISha256);
});
test('managed payload above 512KiB preserves its exact prepared graph under fee-aware publication',async()=>{
 const f=await fixture();const resources=[...publication.resources,{id:'large.bin',role:'asset',mediaType:'application/octet-stream',compression:'none',bytes:Buffer.alloc(550_000,120)}];
 const result=await compileKeelCreatorPreparedPublication({pool:f.pool,index,publication:{...publication,resources},...config});
 assert.ok(result.completeTokenURIBytes<2_000_000);
 const writes=result.journal.steps.filter(s=>s.phase==='upload').map(s=>decodeFunctionData({abi,data:s.call.data}));
 assert.ok(writes.some(s=>s.functionName==='weldComposite'));
 assert.ok(writes.filter(s=>s.functionName==='castSlugsFor').every(s=>s.args[1].length===1));
 assert.ok(result.journal.steps.filter(s=>s.phase==='validate').length>10);
 assert.ok(BigInt(result.platformFee)>0n);
});

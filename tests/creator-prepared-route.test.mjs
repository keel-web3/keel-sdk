import test from 'node:test';import assert from 'node:assert/strict';
import {parseAbi,keccak256,encodeFunctionResult,decodeFunctionData,toHex,stringToHex} from 'viem';
import {prepareKeelAuthenticatedCreatorInline,prepareKeelCreatorInline,buildKeelNetworkIndex,keelHoldAbi} from '../packages/sdk/dist/index.js';
const names=['KeelHold','KeelCreatorFactory','KeelArtifactTokenRenderer','KeelMintRouteRegistry','KeelRawTokenURIBuilder','KeelRawInlineShellRegistry','KeelRawFragmentValidationRegistry','KeelArtifactRegistry'];
const address=n=>'0x'+n.toString(16).padStart(40,'0'), hash=n=>'0x'+n.toString(16).padStart(64,'0');
const addresses=Object.fromEntries(names.map((n,i)=>[n,address(i+1)]));
const code='0x60006000',blockHash=hash(999);
const deployments=names.map((contract,i)=>({contract,address:addresses[contract],chainId:31337,module:'test',instance:'prepared-test',runtimeCodeHash:keccak256(code),txHash:hash(i+1),block:'1'}));
const index=buildKeelNetworkIndex(deployments,{defaultChainId:31337,networks:[{chainId:31337,name:'test',environment:'local',defaultInstance:'prepared-test',rpcUrls:[]}]});
const publication={resources:[{id:'index.html',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<html><body>'+('exact source'.repeat(100))+'</body></html>')}],poster:{mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')}};
const abi=parseAbi([...keelHoldAbi,
 'function requireRegistration(bytes32) view', 'function metadataRenderer() view returns(address)', 'function preparedCopyBuilder() view returns(address)', 'function preparedCopyShellRegistry() view returns(address)', 'function preparedCopyValidationRegistry() view returns(address)', 'function artifactRegistry() view returns(address)', 'function manager() view returns(address)', 'function platformAuthority() view returns(address)', 'function rawFragmentValidationRegistry() view returns(address)', 'function RAW_INLINE_PROTECTION_SHELL_ID() view returns(bytes32)', 'function creatorManagedShell(bytes32) view returns(bool)', 'function shellRevision(bytes32,uint64) view returns(bytes32,bytes32,uint8,bool,bytes32)', 'function builder() view returns(address)', 'function verifiedDigest(bytes32) view returns(bytes32)', 'function keelHold() view returns(address)']);
async function fixture(bad={}){
 const plan=await prepareKeelCreatorInline({...publication,chainId:31337,store:addresses.KeelHold});
 const objects=new Map([plan.shell.prefix,plan.shell.suffix].map(o=>[o.objectId,o]));const requests=[];
 const pool={status:()=>[],request:async req=>{requests.push(req);
  if(req.method==='eth_chainId')return '0x7a69';if(req.method==='eth_blockNumber')return '0x2';
  if(req.method==='eth_getBlockByNumber')return {number:'0x2',hash:blockHash};
  if(req.method==='eth_getCode')return bad.runtime?'0x6001':code;
  if(req.method==='eth_getTransactionReceipt'){const entry=deployments.find(d=>d.txHash===req.params[0]);return {status:'0x1',transactionHash:entry.txHash,contractAddress:entry.address,blockNumber:'0x1',blockHash};}
  assert.equal(req.method,'eth_call');assert.equal(req.params[1],'0x2');
  const call=decodeFunctionData({abi,data:req.params[0].data}), name=call.functionName;let result;
  const bindings={metadataRenderer:'KeelArtifactTokenRenderer',keelHold:'KeelHold',preparedCopyBuilder:'KeelRawTokenURIBuilder',preparedCopyShellRegistry:'KeelRawInlineShellRegistry',preparedCopyValidationRegistry:'KeelRawFragmentValidationRegistry',artifactRegistry:'KeelArtifactRegistry',rawFragmentValidationRegistry:'KeelRawFragmentValidationRegistry',builder:'KeelRawTokenURIBuilder'};
  if(bindings[name])result=bad.binding===name?address(888):addresses[bindings[name]];
  else if(name==='manager'||name==='platformAuthority')result=address(999);
  else if(name==='RAW_INLINE_PROTECTION_SHELL_ID')result=keccak256(stringToHex('keel.shell.inline-raw-percent-protection@1'));
  else if(name==='creatorManagedShell')result=false;
  else if(name==='shellRevision')result=[plan.shell.prefix.objectId,plan.shell.suffix.objectId,bad.mode?2:3,true,hash(501)];
  else {const object=objects.get(call.args[0]);assert.ok(object);
   if(name==='requireRegistration'&&bad.registration)throw Error('not registered');
   if(name==='verifiedDigest')result=bad.digest?hash(777):object.digest;
   if(name==='haulObject')result=toHex(bad.bytes?Uint8Array.of(1):object.bytes);
   if(name==='getObject')result={digest:object.digest,indexDigest:hash(0),descriptorPointer:address(1),byteLength:BigInt(object.bytes.length),storedByteLength:BigInt(object.bytes.length),chunkCount:1,compression:0,composite:false,exists:true,mediaType:'application/vnd.keel.token-uri-raw-percent-fragment'};
  }
  return encodeFunctionResult({abi,functionName:name,result});
 }};return {pool,plan,requests};
}
test('prepared route authenticates pinned infrastructure and exact registered shell at one block before creating a local plan',async()=>{
 const f=await fixture();const plan=await prepareKeelAuthenticatedCreatorInline({pool:f.pool,index,publication});
 assert.equal(plan.route.renderer,addresses.KeelArtifactTokenRenderer);assert.equal(plan.shell.suffix.objectId,f.plan.shell.suffix.objectId);
 assert.equal(plan.prepaymentSimulation,'required');assert.equal(plan.completeTokenURIBytes,null);
 assert.ok(f.requests.every(r=>!['eth_sendTransaction','eth_sendRawTransaction'].includes(r.method)));
});
test('wrong runtime, binding, codec revision, cached digest or shell bytes fail before returning a prepared route',async()=>{
 for(const bad of [{runtime:true},{binding:'preparedCopyBuilder'},{mode:true},{digest:true},{bytes:true},{registration:true}]){
  const f=await fixture(bad);await assert.rejects(prepareKeelAuthenticatedCreatorInline({pool:f.pool,index,publication}));
 }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {keelRpcHostList,keelRpcHostListDigest} from '../packages/protocol/dist/index.js';
import {createKeelRpcReadManifest,verifyKeelRpcReadManifest,estimateKeelHybridRead,KEEL_DEFAULT_RPC_READ_CONCURRENCY} from '../packages/sdk/dist/rpc-read-manifest.js';
import {createKeelStudioDefaultProfile,resolveKeelBuildDefaults} from '../packages/sdk/dist/studio-project-defaults.js';
import {buildKeelManagedShellLoader} from '../packages/sdk/dist/managed-shell-loader.js';
import {KEEL_NATIVE_CHUNK_BYTES} from '../packages/sdk/dist/managed-publication.js';
const one='https://ethereum-sepolia-rpc.publicnode.com/';
const two='https://sepolia.drpc.org/';
const base={chainId:11155111,rpcUrls:[one,two]};
const now=10000;
const capability=(patch={})=>({url:one,chainId:11155111,basis:'measured',observedChainId:11155111,samples:3,observedAtMs:9000,validUntilMs:11000,source:'Deterministic test fixture',latencyMs:[100,200],bytesPerSecond:[1000000,2000000],maxResponseBytes:1000000,maxConcurrentReads:2,...patch});
const reference={chainId:11155111,store:'0x1111111111111111111111111111111111111111',objectId:'0x'+'ab'.repeat(32),digest:'0x'+'cd'.repeat(32)};
const config=html=>JSON.parse(html.match(/globalThis\.__KEEL_MANAGED_SHELL__=(.*?);/u)[1]);
const estimate=(manifest,extra={})=>estimateKeelHybridRead({manifest,resources:[{storedBytes:92000}],nowMs:now,...extra});

test('bundled capabilities are unknown rather than invented measurements; bytes use native chunks and hex wire overhead',()=>{
 assert.equal(KEEL_NATIVE_CHUNK_BYTES,23000);
 const manifest=createKeelRpcReadManifest(base), result=estimate(manifest);
 assert.equal(result.status,'estimated');assert.equal(result.policyStatus,'bundled');
 assert.equal(result.byteBasis,'source-provisional');assert.equal(result.readCount,11);
 assert.ok(result.wireBytes>2*92000);assert.ok(result.highMs>result.lowMs);
 assert.ok(result.endpoints.every(row=>row.evidence==='unknown' && row.maxCallGas===undefined));
 assert.match(result.assumptions.join(' '),/not a benchmark/);assert.match(result.assumptions.join(' '),/tokenURI acquisition/);
 assert.equal(estimate(createKeelRpcReadManifest({...base,rpcUrls:[one]})).lowMs,result.lowMs,'failover pools cannot invent aggregate bandwidth');
});
test('measurement/declaration provenance and staleness remain explicit and future records are ignored',()=>{
 const manifest=createKeelRpcReadManifest({...base,endpoints:[capability()]});
 const result=estimate(manifest);
 assert.equal(result.endpoints[0].evidence,'measured');assert.equal(result.endpoints[0].maxConcurrentReads,2);
 assert.equal(result.endpoints[1].evidence,'unknown');
 assert.equal(estimate(manifest,{nowMs:11000}).endpoints[0].evidence,'stale');
 assert.equal(estimate(manifest,{nowMs:8999}).endpoints[0].evidence,'stale');
 assert.equal(estimate(manifest,{nowMs:11000}).endpoints[0].maxConcurrentReads,4);
 assert.equal(estimate(createKeelRpcReadManifest({...base,endpoints:[capability({basis:'declared'})]})).endpoints[0].evidence,'declared');
});
test('declared response caps can make a model unavailable without silently changing endpoint selection',()=>{
 const manifest=createKeelRpcReadManifest({...base,rpcUrls:[one],endpoints:[capability({maxResponseBytes:100})]});
 const result=estimate(manifest);assert.equal(result.status,'unavailable');assert.equal(result.lowMs,undefined);
 assert.equal(result.endpoints.length,1);assert.equal(result.endpoints[0].eligible,false);
 assert.deepEqual(manifest.rpcUrls,[one]);
});
test('serial resource traversal prevents an optimistic global chunk parallelism estimate',()=>{
 const manifest=createKeelRpcReadManifest({...base,rpcUrls:[one]});
 assert.ok(estimate(manifest,{resources:Array.from({length:4},()=>({storedBytes:23000}))}).lowMs > estimate(manifest).lowMs);
 assert.ok(estimate(manifest,{maxConcurrentReads:1}).lowMs > estimate(manifest,{maxConcurrentReads:4}).lowMs);
 for(const maxConcurrentReads of [0,65,1.5,NaN])assert.throws(()=>estimate(manifest,{maxConcurrentReads}));
 for(const resources of [[],[{storedBytes:-1}],[{storedBytes:1,chunkCount:0}],Array.from({length:4097},()=>({storedBytes:1}))])assert.throws(()=>estimate(manifest,{resources}));
});
test('schema refuses duplicate/private/ungoverned endpoints and wrong-chain or ungrounded capability claims',()=>{
 for(const patch of [{rpcUrls:[]},{rpcUrls:[one,one]},{rpcUrls:['https://127.0.0.1/']},{rpcUrls:['https://evil.example/']},{rpcUrls:[one+'#fragment']},
  {endpoints:[capability({chainId:1})]},{endpoints:[capability({observedChainId:1})]},{endpoints:[capability({samples:undefined})]},
  {endpoints:[capability({validUntilMs:9000})]},{endpoints:[capability({maxConcurrentReads:65})]},{endpoints:[capability({latencyMs:[200,100]})]},
  {endpoints:[capability(),capability()]}])assert.throws(()=>createKeelRpcReadManifest({...base,...patch}));
 const result=estimate(createKeelRpcReadManifest({...base,rpcUrls:['https://sepolia.drpc.org/private-key?secret=x']}));
 assert.doesNotMatch(JSON.stringify(result),/private-key|secret=x/);
});
test('snapshot host policy remains visibly stale after governance rotation',()=>{
 const manifest=createKeelRpcReadManifest({...base,hostList:keelRpcHostList({hosts:['publicnode.com','drpc.org'],revision:2,epoch:2,currentEpoch:3})});
 assert.equal(estimate(manifest).policyStatus,'stale-snapshot');
});
test('remote manifest updates need exact trusted hash/revision/chain and verified host policy, with no fetch or execution',async()=>{
 const hosts=['publicnode.com','drpc.org'];
 const hostList=keelRpcHostList({hosts,revision:2,epoch:3,currentEpoch:4,digest:await keelRpcHostListDigest(hosts,2,3)});
 const manifest=createKeelRpcReadManifest({...base,hostList,revision:7,endpoints:[capability()]});
 const bytes=new TextEncoder().encode(JSON.stringify({...manifest,script:'globalThis.pwned=true'}));
 const digest='0x'+createHash('sha256').update(bytes).digest('hex');
 const expected={digest,chainId:base.chainId,revision:7,hostList};
 const verified=await verifyKeelRpcReadManifest(bytes,expected);
 assert.equal(verified.revision,7);assert.equal(verified.script,undefined);assert.equal(globalThis.pwned,undefined);
 assert.equal(estimate(verified).policyStatus,'stale-snapshot');
 for(const patch of [{digest:'0x'+'00'.repeat(32)},{revision:8},{chainId:1},{hostList:{...hostList,hosts:['publicnode.com']}},{hostList:{...hostList,digest:undefined}}])await assert.rejects(verifyKeelRpcReadManifest(bytes,{...expected,...patch}));
 await assert.rejects(verifyKeelRpcReadManifest(new Uint8Array(65537),expected));
});
test('same canonical layered concurrency setting reaches SDK/MCP defaults and existing loader, preserving explicit override',()=>{
 const profile={...createKeelStudioDefaultProfile(),global:{rpcMaxConcurrentReads:12},byMedia:{'image/png':{rpcMaxConcurrentReads:8}}};
 const policy=resolveKeelBuildDefaults(profile,{mediaType:'image/png',project:{rpcMaxConcurrentReads:6},build:{rpcMaxConcurrentReads:3}});
 assert.equal(policy.values.rpcMaxConcurrentReads,3);assert.equal(policy.sources.rpcMaxConcurrentReads,'build');
 assert.equal(resolveKeelBuildDefaults(createKeelStudioDefaultProfile()).values.rpcMaxConcurrentReads,KEEL_DEFAULT_RPC_READ_CONCURRENCY);
 assert.equal(config(buildKeelManagedShellLoader({...reference,rpcUrls:[one],buildDefaults:policy})).maxConcurrentReads,3);
 assert.equal(config(buildKeelManagedShellLoader({...reference,rpcUrls:[one],buildDefaults:policy,maxConcurrentReads:2})).maxConcurrentReads,2);
 assert.throws(()=>resolveKeelBuildDefaults(profile,{build:{rpcMaxConcurrentReads:65}}));
});
test('manifest loader preserves paid object references, revision disclosure and explicit conflict rejection',()=>{
 const manifest=createKeelRpcReadManifest({...base,revision:5,hostList:keelRpcHostList({hosts:['publicnode.com','drpc.org'],revision:2,epoch:3,currentEpoch:4})});
 const value=config(buildKeelManagedShellLoader({...reference,rpcManifest:manifest}));
 for(const key of Object.keys(reference))assert.equal(value[key],reference[key]);
 assert.equal(value.rpcManifestRevision,5);assert.equal(value.rpcHostListRevision,2);assert.equal(value.rpcHostListCurrentEpoch,4);
 for(const patch of [{rpcUrl:one},{rpcUrls:[one]},{rpcHosts:['publicnode.com']},{chainId:1}])assert.throws(()=>buildKeelManagedShellLoader({...reference,rpcManifest:manifest,...patch}));
});

test('root and leaf pointer pages contribute their real ABI/hex response size to cap eligibility',()=>{
 const manifest=createKeelRpcReadManifest({...base,rpcUrls:[one],endpoints:[capability({maxResponseBytes:4096})]});
 const resource={storedBytes:1};
 const tiny=estimate(manifest,{resources:[resource]});assert.equal(tiny.status,'estimated');
 const pages=estimate(manifest,{resources:Array.from({length:128},()=>resource)});assert.equal(pages.status,'unavailable');
 const next=estimate(manifest,{resources:Array.from({length:129},()=>resource)});assert.equal(next.readCount,pages.readCount+4);
 assert.ok(next.wireBytes>pages.wireBytes);
});
test('manifest capability concurrency bounds actual loader fan-out and the same estimate conservatively across the pool',()=>{
 const now=Date.now();
 const manifest=createKeelRpcReadManifest({...base,endpoints:[capability({observedAtMs:now-1000,validUntilMs:now+100000,maxConcurrentReads:2})]});
 const value=config(buildKeelManagedShellLoader({...reference,rpcManifest:manifest,maxConcurrentReads:8}));
 assert.equal(value.requestedMaxConcurrentReads,8);assert.equal(value.maxConcurrentReads,2);
 const result=estimate(manifest,{nowMs:now,maxConcurrentReads:8});assert.ok(result.endpoints.every(endpoint=>endpoint.maxConcurrentReads===2));
});

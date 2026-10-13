import test from 'node:test';
import assert from 'node:assert/strict';
import {keccak256,parseAbi,encodeFunctionResult} from 'viem';
import {prepareKeelPreReveal,verifyKeelPreReveal,sealKeelPreRevealArtifact,openKeelPreRevealArtifact,
  readKeelPreRevealAnchor,buildKeelPreRevealCommitCall,refreshKeelShellPreRevealInfo,createKeelPreRevealArtifactController} from '../packages/sdk/dist/pre-reveal.js';

const collection='0x'+'11'.repeat(20),registry='0x'+'22'.repeat(20),publisher='0x'+'33'.repeat(20);
const chainId=11155111,hash='0x'+'44'.repeat(32),bytes=new TextEncoder().encode('original artwork π'),h=n=>'0x'+n.repeat(64);
const recipe={generatorDigest:h('1'),parametersDigest:h('2'),seedRuleDigest:h('3')};
const token={tokenId:'2',assetBytes:bytes,attributes:[{trait_type:'Color',value:'Cyan'},{trait_type:'Body',value:'Coupe'}]};
const prepare=(mode='assets',tokens=[token])=>prepareKeelPreReveal({chainId,collection,mode,tokens});
const check=(plan,changes={})=>verifyKeelPreReveal({manifest:plan.manifest,token,reveal:plan.privateProofs[0],...changes});

test('one salted allocation root hides art/traits and binds token, chain, count and collection',async()=>{
  const plan=await prepare(),second=await prepare();
  assert.notEqual(plan.manifest.root,second.manifest.root);
  assert.ok(!JSON.stringify(plan.manifest).match(/Cyan|Coupe|salt|original artwork/));
  assert.ok(!JSON.stringify(plan.privateProofs).match(/Cyan|Coupe|original artwork/));
  const result=await check(plan);assert.equal(result.matches,true);assert.equal(result.assetBytesMatched,true);
  assert.equal(result.attributeAssignmentMatched,true);assert.equal(result.anchored,false);
  for(const manifest of [{...plan.manifest,chainId:1},{...plan.manifest,collection:publisher}])assert.equal((await check(plan,{manifest})).matches,false);
  await assert.rejects(check(plan,{manifest:{...plan.manifest,count:2}}),/count/);
  await assert.rejects(check(plan,{token:{...token,tokenId:'3'}}),/token/);
});
test('changed art or assigned traits do not match; attribute order is canonical',async()=>{
  const plan=await prepare();
  for(const other of [{...token,assetBytes:new Uint8Array([9])},{...token,attributes:[{trait_type:'Color',value:'Red'}]}]){
    const result=await check(plan,{token:other});assert.equal(result.matches,false);assert.equal(result.assetBytesMatched,false);assert.equal(result.attributeAssignmentMatched,false);
  }
  assert.equal((await check(plan,{token:{...token,attributes:[...token.attributes].reverse()}})).matches,true);
  await assert.rejects(prepare('assets',[token,token]),/Duplicate/);
  await assert.rejects(prepare('attributes',[{tokenId:'1'}]),/assigned/);
  await assert.rejects(prepare('assets',[{...token,assetHash:h('f')}]),/bytes/);
});
test('random-on-mint plan binds the recipe; it never pretends to know a future seed or final image',async()=>{
  const item={tokenId:'8',recipe},plan=await prepare('seeded',[item]);
  const result=await verifyKeelPreReveal({manifest:plan.manifest,token:item,reveal:plan.privateProofs[0]});
  assert.equal(result.matches,true);assert.equal(result.generatorRecipeMatched,true);assert.equal(result.assetBytesMatched,false);
  assert.equal(result.needsMintSeedCheck,true);assert.equal(result.needsGeneratorReplay,true);
  assert.equal((await verifyKeelPreReveal({manifest:plan.manifest,token:{...item,recipe:{...recipe,seedRuleDigest:h('4')}},reveal:plan.privateProofs[0]})).matches,false);
  const known={...item,seed:h('a')},fixed=await prepare('seeded',[known]);
  assert.equal((await verifyKeelPreReveal({manifest:fixed.manifest,token:known,reveal:fixed.privateProofs[0],mintedSeed:h('a')})).seedMatches,true);
  assert.equal((await verifyKeelPreReveal({manifest:fixed.manifest,token:known,reveal:fixed.privateProofs[0],mintedSeed:h('b')})).seedMatches,false);
  const both={...known,assetBytes:bytes},withArt=await prepare('seeded',[both]);
  const independent=await verifyKeelPreReveal({manifest:withArt.manifest,token:both,reveal:withArt.privateProofs[0],mintedSeed:h('a')});
  assert.equal(independent.assetBytesMatched,true);assert.equal(independent.needsGeneratorReplay,true);
});
test('forged or serialized publication claims do not upgrade local checks',async()=>{
  const plan=await prepare();
  const anchor={chainId,collection,registry,root:plan.manifest.root,revision:'1',publishedAtBlock:'1',publisher,snapshotBlock:'2'};
  assert.equal((await check(plan,{anchor})).anchored,false);
  assert.equal(buildKeelPreRevealCommitCall(plan.manifest,registry).submission,'not-performed');
});
test('registry reads authenticate chain, immutable code and original revision at one block hash',async()=>{
  const plan=await prepare(),code='0x60006000',requests=[];
  const abi=parseAbi(['struct Commitment {bytes32 root;uint64 publishedAt;address publisher;uint8 authority;bool exists;}','function commitmentAt(address collection,uint64 revision) view returns(Commitment)']);
  const row=encodeFunctionResult({abi,functionName:'commitmentAt',result:{root:plan.manifest.root,publishedAt:7n,publisher,authority:1,exists:true}});
  let wrongCode=false;
  const fetchImpl=async(url,init)=>{
    const request=JSON.parse(init.body);requests.push(request);
    const result=request.method==='eth_chainId'?'0xaa36a7':request.method==='eth_getBlockByNumber'?{number:'0x10',hash,timestamp:'0x20'}:
      request.method==='eth_getCode'?(wrongCode?'0x00':code):row;
    if(request.method==='eth_call'||request.method==='eth_getCode')assert.deepEqual(request.params.at(-1),{blockHash:hash,requireCanonical:true});
    return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  };
  const input={manifest:plan.manifest,registry,revision:'4',runtimeCodeHash:keccak256(code),rpc:{family:'ethereum',chainId,endpoints:['https://ethereum-sepolia-rpc.publicnode.com'],fetchImpl}};
  const anchor=await readKeelPreRevealAnchor(input);assert.equal((await check(plan,{anchor})).anchored,true);
  assert.equal((await check(plan,{anchor:JSON.parse(JSON.stringify(anchor))})).anchored,false);
  assert.equal(anchor.publishedAtBlock,'7');assert.equal(anchor.revision,'4');
  wrongCode=true;await assert.rejects(readKeelPreRevealAnchor(input),/runtime code/);
  assert.equal(requests.filter(x=>x.method==='eth_call').length,1);
});
test('native ciphertext round-trips without a bulk text copy; corrupt data and wrong keys fail',async()=>{
  const original=new Uint8Array(4096).fill(65),sealed=await sealKeelPreRevealArtifact(original);
  assert.ok(sealed.ciphertext instanceof Uint8Array);assert.ok(sealed.ciphertext.length<original.length);
  const opened=await openKeelPreRevealArtifact(sealed);assert.deepEqual(opened.bytes,original);
  await assert.rejects(openKeelPreRevealArtifact({...sealed,key:new Uint8Array(32)}),/commitment/);
  const corrupted=sealed.ciphertext.slice();corrupted[corrupted.length-1]^=1;
  await assert.rejects(openKeelPreRevealArtifact({...sealed,ciphertext:corrupted}),/commitment/);
});
test('optional denied anchor reads leave local reveal proof and protected verification untouched',async()=>{
  const plan=await prepare(),before=Object.freeze({state:'verified'});let panel;
  const client={putPanel:async p=>{panel=p;},fail(){assert.fail('Cannot change file proof');},verification:()=>before};
  const result=await refreshKeelShellPreRevealInfo({manifest:plan.manifest,token,reveal:plan.privateProofs[0],client,readAnchor:async()=>{throw new Error('denied');}});
  assert.equal(result.available,true);assert.equal(result.check.anchored,false);assert.equal(client.verification(),before);
  assert.equal(panel.page,'token');assert.equal(panel.rows.find(x=>x.label==='Publication').value,'Publication has not been checked');
});
test('prereveal controller keeps the placeholder through absent/denied keys and mounts exact art only once',async()=>{
  const item={tokenId:'7',assetBytes:bytes},plan=await prepare('encrypted',[item]),sealed=await sealKeelPreRevealArtifact(bytes);
  const {key,...artifact}=sealed;let available,denied=false,reads=0,mounts=0;
  const options={artifact,manifest:plan.manifest,token:{tokenId:'7'},reveal:plan.privateProofs[0],
    readPublishedKey:async()=>{reads++;if(denied)throw new Error('denied');return available;},
    mount:async opened=>{mounts++;assert.deepEqual(opened.bytes,bytes);}};
  const controller=createKeelPreRevealArtifactController(options);
  assert.equal((await controller.refresh()).phase,'waiting');assert.equal(mounts,0);
  denied=true;assert.equal((await controller.refresh()).phase,'unavailable');assert.equal(controller.phase,'waiting');
  denied=false;available=key;const before=reads;
  const [a,b]=await Promise.all([controller.refresh(),controller.refresh()]);assert.equal(a,b);
  assert.equal(reads,before+1);assert.equal(mounts,1);assert.equal(a.phase,'revealed');
  assert.equal((await controller.refresh()).phase,'revealed');assert.equal(mounts,1);
  const different=createKeelPreRevealArtifactController({...options,token:{tokenId:'7',attributes:[{trait_type:'Injected',value:'Different'}]}});
  assert.equal((await different.refresh()).phase,'unavailable');assert.equal(mounts,1);
});

test('optional RPC reads cancel oversized streams before reading the remaining response',async()=>{
  const {createKeelRpcClient}=await import('../packages/protocol/dist/keel-rpc.js');
  let reads=0,cancelled=false;
  const rpc=createKeelRpcClient({family:'ethereum',chainId,endpoints:['https://ethereum-sepolia-rpc.publicnode.com'],maxResponseBytes:8,
    fetchImpl:async()=>new Response(new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(2048).fill(32));},cancel(){cancelled=true;}}))});
  await assert.rejects(rpc.call({to:collection,data:'0x'}),error=>error.code==='limit.response-bytes');
  assert.ok(reads<=2);assert.equal(cancelled,true);
});

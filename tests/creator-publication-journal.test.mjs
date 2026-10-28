import test from 'node:test';import assert from 'node:assert/strict';
import {encodeFunctionData,encodeAbiParameters,parseAbi,keccak256} from 'viem';
import {prepareKeelCreatorInline,buildKeelCreatorPreparedCopyBindingCall,createKeelCreatorPublicationJournal,prepareKeelCreatorPublicationWalletStep,recordKeelCreatorPublicationReceipt,serializeKeelCreatorPublicationJournal,parseKeelCreatorPublicationJournal,beginKeelCreatorPublicationWalletAttempt,rejectKeelCreatorPublicationWalletAttempt} from '../packages/sdk/dist/index.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),h=n=>'0x'+n.toString(16).padStart(64,'0');
const owner=a(1),collection=a(2),renderer=a(3),factory=a(4),store=a(5),mint=a(6),code='0x6000',expected='data:application/json,{"name":"verified exact"}';
const block={number:'0x12',hash:h(42),timestamp:'0x68f00000',gasLimit:'0x1000000'};
const call=(to,data='0x1234')=>({from:owner,to,data,value:'0x0',gas:'0xf4240',maxFeePerGas:'0x1000000',maxPriorityFeePerGas:'0xf4240'});
async function setup(maximumReadGas=1_000_000n){
 const prepared=await prepareKeelCreatorInline({chainId:11155111,store,resources:[{id:'index.html',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<p>exact</p>'.repeat(100))}],poster:{mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')}});
 prepared.prepaymentSimulation='required';prepared.route={renderer,factory,builder:a(7),registry:a(8),validation:a(9),instance:'test',shellId:h(1),shellRevision:1n,authenticatedBlockNumber:'18',authenticatedBlockHash:block.hash};prepared.infrastructure={contracts:[{address:renderer,runtimeCodeHash:keccak256(code)},{address:factory,runtimeCodeHash:keccak256(code)}]};
 const binding=buildKeelCreatorPreparedCopyBindingCall({renderer,collection,tokenId:1n,plan:prepared});
 const steps=[{id:'upload',phase:'upload',call:call(store)},{id:'validate',phase:'validate',call:call(a(9))},{id:'create',phase:'create-collection',call:call(factory)},{id:'bind',phase:'bind',call:call(renderer,binding.data)},{id:'route',phase:'mint-route',call:call(mint)},{id:'mint',phase:'mint',call:call(mint)}];
 const journal=createKeelCreatorPublicationJournal({id:'fresh-1',actorId:'actor',owner,sourceRevision:'sha256:source',settingsRevision:'defaults:1',prepared,collection,tokenId:1n,steps,simulation:{metadataCall:call(collection,encodeFunctionData({abi:parseAbi(['function tokenURI(uint256) view returns(string)']),functionName:'tokenURI',args:[1n]})),expectedTokenURI:expected,maximumTokenUriBytes:2_000_000,maximumReadGas,collectionOverheadGas:10_000n,maximumTransactionGas:16_000_000n}});
 return {journal,steps};
}
const actor={actorId:'actor',owner,sourceRevision:'sha256:source',settingsRevision:'defaults:1'};
function transport(journal,options={}){let pass=0;const requests=[];return {requests,request:async request=>{
 requests.push(request);if(request.method==='eth_chainId')return '0xaa36a7';if(request.method==='eth_getBlockByNumber')return block;
 if(request.method==='eth_getCode')return request.params[0]===collection?(options.existing?'0x6000':'0x'):code;
 if(request.method==='eth_getTransactionByHash'){const step=journal.steps[0];return {hash:h(100),from:owner,to:step.call.to,input:options.changedReceipt?'0x99':step.call.data,value:'0x0'};}
 if(request.method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:h(100),blockHash:block.hash,blockNumber:block.number};
 if(request.method==='eth_simulateV1'){if(options.error)throw options.error;pass++;const calls=request.params[0].blockStateCalls;return calls.map((item,i)=>({timestamp:'0x'+(BigInt(block.timestamp)+BigInt(i+1)).toString(16),number:'0x'+(BigInt(block.number)+BigInt(i+1)).toString(16),hash:h(1000+i),parentHash:i===0?block.hash:h(999+i),transactions:item.calls.map(({gas,nonce})=>({gas,...(nonce===undefined?{}:{nonce})})),calls:[{status:'0x1',gasUsed:'0x186a0',maxUsedGas:'0x186a0',returnData:pass===3&&i===calls.length-1?encodeAbiParameters([{type:'string'}],[options.badMetadata?'changed':expected]):'0x'}]}));}
 throw Error(request.method);
}};}
test('fresh creator journal exposes no wallet request until every remaining transaction and full read passes',async()=>{
 const {journal}=await setup();assert.equal(journal.approval,undefined);
 assert.deepEqual(parseKeelCreatorPublicationJournal(serializeKeelCreatorPublicationJournal(journal)),journal);
 const rpc=transport(journal);const result=await prepareKeelCreatorPublicationWalletStep(journal,actor,rpc);
 assert.equal(result.status,'approval-required');assert.equal(result.stepId,'upload');assert.equal(result.proof.validatedTransactionCalls,6);
 assert.equal(result.proof.metadataTarget,collection);assert.equal(result.proof.completeTokenUriBytes,Buffer.byteLength(expected));
 for(const change of [{settingsRevision:'new'},{actorId:'other'},{sourceRevision:'new'}])await assert.rejects(prepareKeelCreatorPublicationWalletStep(journal,{...actor,...change},transport(journal)));
 for(const options of [{existing:true},{badMetadata:true},{error:{code:-32601}}])await assert.rejects(prepareKeelCreatorPublicationWalletStep(journal,actor,transport(journal,options)));
});
test('verified receipts survive resume and exclude successful uploads from later replay',async()=>{
 const {journal}=await setup();const recorded=await recordKeelCreatorPublicationReceipt(journal,h(100),transport(journal));
 assert.equal(recorded.receipts.length,1);assert.equal((await recordKeelCreatorPublicationReceipt(recorded,h(100),transport(journal))).receipts.length,1);
 const rpc=transport(recorded);const next=await prepareKeelCreatorPublicationWalletStep(recorded,actor,rpc);assert.equal(next.stepId,'validate');assert.equal(next.proof.validatedTransactionCalls,5);
 assert.equal(rpc.requests.filter(r=>r.method==='eth_simulateV1')[0].params[0].blockStateCalls[0].calls[0].to,a(9));
 await assert.rejects(recordKeelCreatorPublicationReceipt(journal,h(100),transport(journal,{changedReceipt:true})));
 const tampered=structuredClone(recorded);tampered.steps[1].call.data='0x55';await assert.rejects(prepareKeelCreatorPublicationWalletStep(tampered,actor,transport(tampered)));
});


test('a persisted unknown wallet outcome blocks duplicate requests until rejection or exact receipt',async()=>{
 const {journal}=await setup();const pending=beginKeelCreatorPublicationWalletAttempt(journal,'attempt-1',Date.now());
 const rpc=transport(pending);const blocked=await prepareKeelCreatorPublicationWalletStep(pending,actor,rpc);
 assert.equal(blocked.status,'wallet-attempt-pending');assert.equal(blocked.approval,null);assert.equal(rpc.requests.length,0);
 assert.equal(parseKeelCreatorPublicationJournal(serializeKeelCreatorPublicationJournal(pending)).walletAttempt.id,'attempt-1');
 assert.throws(()=>beginKeelCreatorPublicationWalletAttempt(pending,'attempt-2',Date.now()),/pending/);
 assert.throws(()=>rejectKeelCreatorPublicationWalletAttempt(pending,{id:'attempt-1',result:'timeout'}),/unknown or submitted/);
 const rejected=rejectKeelCreatorPublicationWalletAttempt(pending,{id:'attempt-1',result:'rejected-before-submission'});
 assert.equal(rejected.walletAttempt,undefined);assert.equal(rejected.receipts.length,0);
 const confirmed=await recordKeelCreatorPublicationReceipt(pending,h(100),transport(pending));
 assert.equal(confirmed.walletAttempt,undefined);assert.equal(confirmed.receipts.length,1);
});

test('historical partially paid 60M journal resumes exact remaining calls without changing its fingerprint or receipts',async()=>{
 const {journal}=await setup(60_000_000n);
 await assert.rejects(prepareKeelCreatorPublicationWalletStep(journal,actor,transport(journal)),/reader.provider bounds/);
 const paid=await recordKeelCreatorPublicationReceipt(journal,h(100),transport(journal));
 const before=serializeKeelCreatorPublicationJournal(paid);
 const rpc=transport(paid);const next=await prepareKeelCreatorPublicationWalletStep(paid,actor,rpc);
 assert.equal(next.status,'approval-required');assert.equal(next.stepId,paid.steps[1].id);
 assert.equal(serializeKeelCreatorPublicationJournal(paid),before);
 assert.equal(paid.fingerprint,journal.fingerprint);
 const sent=rpc.requests.filter(x=>x.method==='eth_simulateV1')[0].params[0].blockStateCalls;
 assert.equal(sent.length,paid.steps.length-1);assert.equal(sent[0].calls[0].to,paid.steps[1].call.to);
 await assert.rejects(prepareKeelCreatorPublicationWalletStep(paid,actor,transport(paid,{changedReceipt:true})),/exact reviewed publication step/);
});

test('historical allowance rejects a paid journal attached to another remaining plan before simulation',async()=>{
 const {simulateKeelRetainedPublicationAfterReceipts}=await import('../packages/sdk/dist/publication-preflight.js');
 const {journal}=await setup(60_000_000n);const paid=await recordKeelCreatorPublicationReceipt(journal,h(100),transport(journal));
 const rpc=transport(paid);
 const simulation={...paid.simulation,assertions:[],blockNumber:18n,planFingerprint:paid.fingerprint,preparationCalls:paid.steps.slice(1).map(step=>step.call)};
 await assert.rejects(simulateKeelRetainedPublicationAfterReceipts({...simulation,planFingerprint:h(999)},paid,rpc),/exact saved journal/);
 await assert.rejects(simulateKeelRetainedPublicationAfterReceipts({...simulation,reader:a(99)},paid,rpc),/exact saved journal/);
 await assert.rejects(simulateKeelRetainedPublicationAfterReceipts({...simulation,preparationCalls:[paid.steps[0].call]},paid,rpc),/exact saved journal/);
 assert.equal(rpc.requests.length,0);
});

test('historical replay snapshots authority before awaits and accepts an optional diagnostics observer',async()=>{
 const {simulateKeelRetainedPublicationAfterReceipts}=await import('../packages/sdk/dist/publication-preflight.js');
 const {journal}=await setup(60_000_000n);const paid=await recordKeelCreatorPublicationReceipt(journal,h(100),transport(journal));
 const simulation={...paid.simulation,assertions:[],blockNumber:18n,planFingerprint:paid.fingerprint,preparationCalls:paid.steps.slice(1).map(step=>({...step.call})),diagnostics:()=>{}};
 const rpc=transport(paid);let first=true;
 const proof=await simulateKeelRetainedPublicationAfterReceipts(simulation,paid,{request:async req=>{if(first){first=false;simulation.maximumReadGas=70_000_000n;simulation.preparationCalls[0].data='0xffff';}return rpc.request(req);}});
 assert.equal(proof.validatedTransactionCalls,paid.steps.length-1);
 const discovery=rpc.requests.find(x=>x.method==='eth_simulateV1').params[0].blockStateCalls;
 assert.equal(discovery[0].calls[0].data,paid.steps[1].call.data);
});

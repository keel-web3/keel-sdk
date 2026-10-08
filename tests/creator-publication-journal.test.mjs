import test from 'node:test';import assert from 'node:assert/strict';
import {encodeFunctionData,encodeAbiParameters,parseAbi,keccak256} from 'viem';
import {prepareKeelCreatorInline,buildKeelCreatorPreparedCopyBindingCall,createKeelCreatorPublicationJournal,prepareKeelCreatorPublicationWalletStep,recordKeelCreatorPublicationReceipt,serializeKeelCreatorPublicationJournal,parseKeelCreatorPublicationJournal,beginKeelCreatorPublicationWalletAttempt,rejectKeelCreatorPublicationWalletAttempt} from '../packages/sdk/dist/index.js';
const a=n=>'0x'+n.toString(16).padStart(40,'0'),h=n=>'0x'+n.toString(16).padStart(64,'0');
const owner=a(1),collection=a(2),renderer=a(3),factory=a(4),store=a(5),mint=a(6),code='0x6000',expected='data:application/json,{"name":"verified exact"}';
const block={number:'0x12',hash:h(42),timestamp:'0x68f00000',gasLimit:'0x1000000'};
const call=(to,data='0x1234')=>({from:owner,to,data,value:'0x0',gas:'0xf4240',maxFeePerGas:'0x1000000',maxPriorityFeePerGas:'0xf4240'});
async function setup(){
 const prepared=await prepareKeelCreatorInline({chainId:11155111,store,resources:[{id:'index.html',role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<p>exact</p>'.repeat(100))}],poster:{mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')}});
 prepared.prepaymentSimulation='required';prepared.route={renderer,factory,builder:a(7),registry:a(8),validation:a(9),instance:'test',shellId:h(1),shellRevision:1n,authenticatedBlockNumber:'18',authenticatedBlockHash:block.hash};prepared.infrastructure={contracts:[{address:renderer,runtimeCodeHash:keccak256(code)},{address:factory,runtimeCodeHash:keccak256(code)}]};
 const binding=buildKeelCreatorPreparedCopyBindingCall({renderer,collection,tokenId:1n,plan:prepared});
 const steps=[{id:'upload',phase:'upload',call:call(store)},{id:'validate',phase:'validate',call:call(a(9))},{id:'create',phase:'create-collection',call:call(factory)},{id:'bind',phase:'bind',call:call(renderer,binding.data)},{id:'route',phase:'mint-route',call:call(mint)},{id:'mint',phase:'mint',call:call(mint)}];
 const journal=createKeelCreatorPublicationJournal({id:'fresh-1',actorId:'actor',owner,sourceRevision:'sha256:source',settingsRevision:'defaults:1',prepared,collection,tokenId:1n,steps,simulation:{metadataCall:call(collection,encodeFunctionData({abi:parseAbi(['function tokenURI(uint256) view returns(string)']),functionName:'tokenURI',args:[1n]})),expectedTokenURI:expected,maximumTokenUriBytes:2_000_000,maximumReadGas:1_000_000n,collectionOverheadGas:10_000n,maximumTransactionGas:16_000_000n}});
 return {journal,steps};
}
const actor={actorId:'actor',owner,sourceRevision:'sha256:source',settingsRevision:'defaults:1'};
function transport(journal,options={}){let pass=0;const requests=[];return {requests,request:async request=>{
 requests.push(request);if(request.method==='eth_chainId')return '0xaa36a7';if(request.method==='eth_getBlockByNumber')return block;
 if(request.method==='eth_getCode')return request.params[0]===collection?(options.existing?'0x6000':'0x'):code;
 if(request.method==='eth_getTransactionByHash'){const step=journal.steps[0];return {hash:h(100),from:owner,to:step.call.to,input:options.changedReceipt?'0x99':step.call.data,value:'0x0'};}
 if(request.method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:h(100),blockHash:block.hash,blockNumber:block.number};
 if(request.method==='eth_simulateV1'){if(options.error)throw options.error;pass++;const calls=request.params[0].blockStateCalls;return calls.map((_,i)=>({calls:[{status:'0x1',gasUsed:'0x186a0',maxUsedGas:'0x186a0',returnData:pass===3&&i===calls.length-1?encodeAbiParameters([{type:'string'}],[options.badMetadata?'changed':expected]):'0x'}]}));}
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

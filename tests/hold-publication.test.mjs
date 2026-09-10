import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, decodeFunctionResult, encodeFunctionResult, keccak256, parseAbi, toHex } from 'viem';
import { prepareKeelWeld, createKeelFeeDefaults, buildKeelTreasuryClaim } from '../packages/sdk/dist/hold-publication.js';
import { ABIS as holdModuleAbis } from '../packages/sdk/dist/abis/keel-hold.generated.js';
import { keelHoldAbi, keelFeeTreasuryAbi } from '../packages/sdk/dist/abi.js';
const abi=parseAbi(keelHoldAbi), hold='0x0000000000000000000000000000000000001000', payer='0x0000000000000000000000000000000000002000', renderer='0x0000000000000000000000000000000000003000';
const zero='0x0000000000000000000000000000000000000000', zeroId='0x'+'00'.repeat(32);
function setup(overrides={}) {
  const stored=new Map(), existing=new Set(); let savedIntent=null, sealed=false;
  const client={getBlockNumber:async options=>{assert.equal(options.cacheTime,0);return 17n}, readContract:async call=>{
    assert.equal(call.blockNumber,17n);
    switch(call.functionName){
      case 'requireSystemsActive': return undefined;
      case 'limits': {
        const p={maxSlugBytes:32000,maxBatchSlugs:4,maxChildrenPerObject:2,maxReadDepth:16,revision:2n,...overrides};
        return [p.maxSlugBytes,p.maxBatchSlugs,p.maxChildrenPerObject,p.maxReadDepth,p.revision];
      }
      case 'slugPointer': return stored.has(call.args[0])?renderer:zero;
      case 'getSlug': return toHex(stored.get(call.args[0]));
      case 'weldIntent': return savedIntent??{executor:zero,slugCount:0,remainingSlugs:0,complete:false,objectId:zeroId};
      case 'isSealed': return sealed;
      case 'objectExists': return existing.has(call.args[0]);
      case 'quoteWeld': return [BigInt(call.args[0]*4+10+Math.floor(call.args[0]/10)*10),1];
      case 'harnessRegistered': return false;
      case 'harnessFees': return {registrationWei:25n,revision:1};
      case 'feeExempt': return false;
      default: throw new Error('Unexpected read '+call.functionName);
    }
  }};
  return {client,stored,existing,setIntent:value=>savedIntent=value,setSealed:()=>sealed=true};
}
function input(client,bytes=new Uint8Array(65001).fill(7)) {return {client,hold,payer,bytes,objectName:'test',mediaType:'application/octet-stream'};}

test('deployment defaults convert 4/10/10/25 cents using an explicit rate',()=>{
  const fees=createKeelFeeDefaults(2500_000000n);
  assert.deepEqual(fees,{sealFees:{perChunkWei:16_000000000000n,baseSealWei:40_000000000000n,stepSealWei:40_000000000000n,chunksPerStep:10,revision:1},harnessFeeWei:100_000000000000n});
  assert.throws(()=>createKeelFeeDefaults(0n),/positive/);
});

test('live limits drive chunking and intent precedes every write',async()=>{
  const {client}=setup();const result=await prepareKeelWeld({...input(client),renderer});
  assert.equal(result.slugCount,3);assert.equal(result.publicationFee,22n);assert.equal(result.harnessFee,25n);
  const decoded=result.transactions.map(tx=>decodeFunctionData({abi,data:tx.data}));
  assert.equal(decoded[0].functionName,'initWeld');assert.equal(decoded[0].args[0],result.objectId);assert.equal(decoded[0].args[1],3);
  assert.equal(decoded[1].functionName,'castSlugsFor');assert.equal(decoded[1].args[1].length,2); // deduplicated full chunks
  assert.equal(decoded.at(-2).functionName,'sealObject');assert.equal(decoded.at(-1).functionName,'registerHarness');
  assert.equal(result.transactions.reduce((n,tx)=>n+tx.value,0n),47n);
  assert.equal(result.transactions.filter(tx=>tx.value!==0n).length,2);
  assert(decoded.some(call=>call.functionName==='weldComposite'));
});

test('resuming prepaid intent omits payment and already stored payloads',async()=>{
  const state=setup(), bytes=new Uint8Array(65001).fill(7), first=await prepareKeelWeld(input(state.client,bytes));
  state.stored.set(keccak256(bytes.subarray(0,32000)),bytes.subarray(0,32000));
  state.setIntent({executor:payer,slugCount:3,remainingSlugs:1,complete:false,objectId:first.objectId});
  const resumed=await prepareKeelWeld(input(state.client,bytes));
  assert.equal(resumed.publicationFee,0n);
  assert.equal(decodeFunctionData({abi,data:resumed.transactions[0].data}).functionName,'castSlugsFor');
  assert.equal(resumed.transactions.reduce((n,tx)=>n+tx.value,0n),0n);
  assert.equal(resumed.storedBytes,1001);
});

test('sealed object reuse creates no publication payment or writes',async()=>{
  const state=setup();state.setSealed();const result=await prepareKeelWeld(input(state.client));
  assert.equal(result.transactions.length,0);assert.equal(result.publicationFee,0n);
});

test('fanout one cannot cause a nonterminating composite planner',async()=>{
  const {client}=setup({maxChildrenPerObject:1});await assert.rejects(prepareKeelWeld(input(client)),/fanout/);
});

test('failed policy read cannot silently choose another storage policy',async()=>{
  const client={getBlockNumber:async()=>17n,readContract:async()=>{throw new Error('RPC unavailable')}};
  await assert.rejects(prepareKeelWeld(input(client)),/RPC unavailable/);
});

test('one treasury claim sorts and deduplicates token assets',()=>{
  const call=buildKeelTreasuryClaim(hold,payer,[renderer,payer,renderer,zero]);
  const decoded=decodeFunctionData({abi:parseAbi(keelFeeTreasuryAbi),data:call.data});
  assert.equal(decoded.functionName,'claim');assert.deepEqual(decoded.args,[payer,[payer,renderer]]);assert.equal(call.value,0n);
});

test('paused publication is rejected before returning payment transactions',async()=>{
 const state=setup(),read=state.client.readContract;
 state.client.readContract=async call=>{if(call.functionName==='requireSystemsActive')throw new Error('SystemsUnavailable');return read(call)};
 await assert.rejects(prepareKeelWeld(input(state.client)),/SystemsUnavailable/);
 state.setSealed();const reuse=await prepareKeelWeld(input(state.client));assert.equal(reuse.transactions.length,0);
});

// Exercise viem's actual multi-output decoding, not a struct-shaped RPC mock.
test('public limits getter decodes five fields and preserves the SDK policy object', async()=>{
  const compilerAbi = holdModuleAbis.KeelHold;
  const getter = compilerAbi.find(item=>item.type==='function' && item.name==='limits');
  assert.deepEqual(getter.outputs.map(item=>item.type), ['uint32','uint32','uint32','uint32','uint64']);
  for(const name of ['MAX_CHUNK_BYTES','MAX_BATCH_CHUNKS','MAX_CHILDREN_PER_OBJECT','MAX_CHUNKS_PER_OBJECT','MAX_READ_DEPTH'])
    assert.equal(abi.some(item=>item.type==='function' && item.name===name),false);
  const state=setup(), read=state.client.readContract;
  const result=[32000,4,2,16,2n];
  const wire=encodeFunctionResult({abi:compilerAbi,functionName:'limits',result});
  state.client.readContract=async call=>call.functionName==='limits'
    ? decodeFunctionResult({abi:call.abi,functionName:'limits',data:wire}) : read(call);
  const plan=await prepareKeelWeld(input(state.client));
  assert.deepEqual(plan.limits,{maxSlugBytes:32000,maxBatchSlugs:4,maxChildrenPerObject:2,maxReadDepth:16,revision:2n});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {KOC1_TOOL_DEFINITIONS} from '../packages/mcp/dist/koc1-tools.js';
import {prepareKoc1Draft} from '../packages/mcp/dist/koc1-draft.js';
import {createMcpServer,KOC1_DRAFT_DEFAULT_FEE_RATE} from '../packages/mcp/dist/index.js';
import * as lib from '../packages/ordinals-collections/src/index.ts';
const keys=[1,2,3,4].map(n=>lib.xOnly(n.toString(16).padStart(64,'0')));
const draft=()=>({mode:'first',open:'100',close:'200',cap:'21',price:'1000',challengeWindow:'6',collectAfter:'6',refundAfter:'18',notice:'3',earlyRefund:true,pausable:true,blind:true,cycle:false,treasuryKey:keys[3],writerKeys:keys.slice(0,3),writers:[1,2,3].map(n=>n.toString(16).padStart(64,'0')+'i0'),metadataRoot:'55'.repeat(32),metadataCount:'21',artName:''});
const run=args=>KOC1_TOOL_DEFINITIONS.find(t=>t.descriptor.name==='keel-ordinals-collection-prepare').run({},args);
test('draft accepts exact Studio form without location/funding, returns canonical exact bytes and explicit unresolved boundaries',async()=>{
 const request={mode:'draft',draft:draft()},before=structuredClone(request),out=await run(request);
 assert.equal(out.valid,true,JSON.stringify(out.errors));assert.deepEqual(request,before);assert.deepEqual(out.errors,{});
 assert.equal(out.recipeByteLength,Buffer.from(out.recipeBytes,'hex').length);assert.equal((await run(request)).recipeBytes,out.recipeBytes);
 const recipe=lib.decodeCbor(out.recipeBytes);assert.equal(lib.cbor(recipe).toString('hex'),out.recipeBytes);assert.equal(recipe.end.max,21);assert.equal(recipe.price,1000);
 assert.equal(recipe.writers.length,3);assert.equal(recipe.writers[0].authority.length,36);assert.equal(recipe.metadata.root.length,32);assert.equal(recipe.finality,null);assert.equal(recipe.indexer,null);assert.equal(recipe.art.viewer,null);
 assert.equal(recipe.id,undefined);assert.equal(recipe.height,undefined);assert.equal(out.recipeCompleteness,'unbound-draft');assert.equal(out.specValid,false);assert.equal(out.publicationReady,false);
 assert.ok(out.deferredChecks.some(s=>/reference/i.test(s)));assert.equal(out.feeRateSatPerVbyte,2);assert.equal(KOC1_DRAFT_DEFAULT_FEE_RATE,2);assert.equal(out.feeRateDefaulted,true);
});
test('draft cost accounting measures witness weight, rounds per transaction and does not double-count price/escrow',async()=>{
 const out=await run({mode:'draft',draft:draft(),feeRate:3.25});
 for(const cost of [out.inscriptionCost,out.mintCost]){
  assert.equal(cost.estimated,true);assert.equal(cost.commit.vsize,154);assert.equal(cost.commitFeeSats,Math.ceil(154*3.25));
  assert.equal(cost.reveal.weight,cost.reveal.strippedBytes*3+cost.reveal.totalBytes);assert.equal(cost.reveal.vsize,Math.ceil(cost.reveal.weight/4));
  assert.equal(cost.revealFeeSats,Math.ceil(cost.reveal.vsize*3.25));assert.equal(cost.totalFeeSats,cost.commitFeeSats+cost.revealFeeSats);
 }
 assert.equal(out.inscriptionCost.totalSats,out.inscriptionCost.totalFeeSats+330);
 assert.equal(out.mintCost.totalSats,out.mintCost.totalFeeSats+330+1000);assert.equal(out.mintCost.revealSpendSats,out.mintCost.revealFeeSats+330+1000);
 assert.equal(out.mintCost.escrowOutputSats,1000);assert.equal(out.mintCost.escrowOutputVbytes,43);assert.equal(out.mintCost.escrowDustTopUpSats,0);
 const zero=await run({mode:'draft',draft:{...draft(),price:'0'}});assert.equal(zero.mintCost.escrowOutputSats,330);assert.equal(zero.mintCost.escrowDustTopUpSats,330);assert.equal(zero.mintCost.totalSats,zero.mintCost.totalFeeSats+660);
});
test('draft escrow uses exact canonical tree and reports script, witness and whole-spend sizes without signing',async()=>{
 const out=await prepareKoc1Draft({mode:'draft',draft:draft()},{...lib,signTransaction(){throw Error('signing forbidden');}});
 const tree=lib.escrowTemplate({treasuryKey:keys[3],writerKeys:keys.slice(0,3),collectAfter:6,refundAfter:18,earlyRefund:true},out.escrow.assumedBuyerKey);
 assert.deepEqual(out.escrow.scripts,tree.scripts);assert.deepEqual(out.escrow.controlBlocks,tree.controlBlocks);
 for(const leaf of ['L_t','L_m','L_e']){const size=out.escrow.sizes[leaf];assert.equal(size.scriptBytes,tree.scripts[leaf].length/2);assert.equal(size.scriptVbytes,size.scriptBytes/4);assert.equal(size.vsize,Math.ceil(size.weight/4));}
 assert.equal(out.escrow.sizes.L_t.vsize,196);assert.equal(out.escrow.sizes.L_m.vsize,146);assert.equal(out.escrow.sizes.L_e.vsize,203);
 const noEarly=await run({mode:'draft',draft:{...draft(),earlyRefund:false}});assert.equal(noEarly.escrow.scripts.L_e,undefined);assert.equal(noEarly.escrow.sizes.L_m.controlBytes,65);
});
test('draft validates every end mode, metadata range/cycling and finite blind rules',async()=>{
 for(const patch of [{mode:'first'},{mode:'supply'},{mode:'time',cycle:true},{mode:'open',close:'',cycle:true,blind:false},{mode:'open',close:'200',cycle:true,blind:true}]) assert.equal((await run({mode:'draft',draft:{...draft(),...patch}})).valid,true);
 for(const [patch,field] of [[{metadataCount:'20'},'metadataCount'],[{close:'99'},'close'],[{cap:'0'},'cap'],[{mode:'time',cycle:false},'cycle'],[{mode:'open',close:'',cycle:true,blind:true},'blind'],[{mode:'weird'},'mode']]){const out=await run({mode:'draft',draft:{...draft(),...patch}});assert.equal(out.valid,false);assert.equal(typeof out.errors[field],'string');assert.equal(out.recipeBytes,null);assert.equal(out.inscriptionCost,null);}
});
test('draft field errors cover keys, authority IDs, integer precision, delays, fee rates and malformed requests',async()=>{
 const cases=[[{collectAfter:'5'},'collectAfter'],[{refundAfter:'6'},'refundAfter'],[{notice:'-1'},'notice'],[{challengeWindow:'65536'},'challengeWindow'],[{price:'1.5'},'price'],[{price:'9007199254740992'},'price'],[{open:'4294967296'},'open'],[{metadataRoot:'x'},'metadataRoot'],[{metadataCount:'0'},'metadataCount'],[{treasuryKey:'ff'.repeat(32)},'treasuryKey'],[{writerKeys:[keys[0],keys[0],keys[2]]},'key1'],[{writerKeys:[keys[0],keys[1],keys[3]]},'key2'],[{writers:['01'.repeat(32)+'i0','01'.repeat(32)+'i0','02'.repeat(32)+'i0']},'writer1'],[{writers:['a','b','c']},'writer0'],[{writerKeys:[]},'writerKeys'],[{earlyRefund:'true'},'earlyRefund']];
 for(const [patch,field] of cases){const out=await run({mode:'draft',draft:{...draft(),...patch}});assert.equal(out.valid,false,JSON.stringify(patch));assert.equal(typeof out.errors[field],'string');}
 for(const feeRate of [0,-1,Infinity,NaN,'2',1000001,null]){const out=await run({mode:'draft',draft:draft(),feeRate});assert.equal(out.valid,false);assert.ok(out.errors.feeRate);}
 const unknown=await run({mode:'draft',draft:draft(),funding:[]});assert.ok(unknown.errors.form);
 const missing=await run({mode:'draft'});assert.equal(missing.valid,false);assert.ok(missing.errors.form);
});
test('draft mode works through production MCP schemas and performs no chain reads or signing',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'koc1-draft-test-'));
 try{const server=await createMcpServer({workspaceRoot:root,pluginConfig:false});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'draft-test',version:'1'}}});
 const original=globalThis.fetch;let reads=0;globalThis.fetch=()=>{reads++;throw Error('network forbidden');};
 try{const response=await server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-ordinals-collection-prepare',arguments:{mode:'draft',draft:draft()}}});assert.ok(!response.result.isError,JSON.stringify(response));const out=response.result.structuredContent;assert.equal(out.valid,true);assert.equal(out.signed,false);assert.equal(out.chainReads,false);assert.equal(out.broadcast,false);assert.equal(reads,0);}finally{globalThis.fetch=original;}
 }finally{await rm(root,{recursive:true,force:true});}
});
test('draft request and response types compile from the public @keel/mcp export',async()=>{
 const {execFileSync}=await import('node:child_process');
 execFileSync(process.execPath,[new URL('../node_modules/typescript/bin/tsc',import.meta.url).pathname,'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext',new URL('./fixtures/koc1-draft-types.ts',import.meta.url).pathname],{stdio:'pipe'});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {KOC1_TOOL_DEFINITIONS} from '../packages/mcp/dist/koc1-tools.js';
import {createMcpServer} from '../packages/mcp/dist/index.js';
import {parseTx,xOnly,keyOutput,decodeCbor} from '../packages/ordinals-collections/src/index.ts';
const read=async n=>JSON.parse(await readFile(new URL(`../packages/ordinals-collections/spec/vectors/${n}.json`,import.meta.url)));
const fixtures=(await read('numbering-controls-roots')).cases[0].input;
const validRecipe=(await read('recipes')).cases.find(c=>c.id==='valid-recipe').input;
const run=(name,args)=>KOC1_TOOL_DEFINITIONS.find(t=>t.descriptor.name===`keel-ordinals-collection-${name}`).run({},args);
const base=()=>structuredClone(validRecipe);
const buyer=xOnly('01'.padStart(64,'0')),script=keyOutput(buyer);
function prepareArgs(){return {...base(),minter:buyer,funding:[{txid:'aa'.repeat(32),vout:0,value:200000,script,internalKey:buyer}],commitValue:100000,commitFee:1000,revealFee:1000,recipientScript:script,changeScript:script};}
test('KOC1 prepare validates reference policy and emits unsigned commit/reveal PSBTs, CBOR and escrow keys',async()=>{
 const args=prepareArgs(),before=structuredClone(args),out=await run('prepare',args);
 assert.equal(out.valid,true);assert.equal(out.signed,false);assert.equal(out.broadcast,false);assert.equal(out.verified,false);assert.equal(out.keyChecks.distinctTreasuryAndWriters,true);
 assert.deepEqual(args,before);assert.ok(out.escrow.scripts.L_t);assert.ok(out.escrow.scripts.L_m);assert.ok(out.escrow.scripts.L_e);
 assert.equal(Buffer.from(out.commit.psbt,'base64').subarray(0,5).toString('hex'),'70736274ff');assert.equal(out.reveal.tx.outputs[1].script,out.escrow.scriptPubKey);
 assert.equal(out.reveal.tx.outputs[2].value,0);assert.equal(out.reveal.tx.outputs[0].value,330);assert.equal(out.reveal.tx.inputs[0].txid,parseTx((await import('../packages/ordinals-collections/src/tx.ts')).serializeTx(out.commit.tx,false)).txid);
 assert.ok(!out.commit.tx.inputs[0].witness);assert.ok(!out.reveal.tx.inputs[0].witness);
 const wire=decodeCbor(out.recipeBytes);assert.ok(!Object.hasOwn(wire,'id'));assert.ok(!Object.hasOwn(wire,'height'));assert.ok(Buffer.isBuffer(wire.payment.writerKeys[0]));
 const check=await run('verify',{recipeBytes:out.recipeBytes,inscriptionId:args.recipe.id,height:args.recipe.height,txIndex:args.recipe.txIndex,refs:args.refs});assert.equal(check.valid,true);
});
test('KOC1 prepare rejects invalid refs, W/CSV, key collisions, funding and unknown signing fields',async()=>{
 for(const modify of [a=>a.refs={},a=>a.recipe.payment.collectAfter=0,a=>a.recipe.payment.treasuryKey=a.recipe.payment.writerKeys[0],a=>a.funding=[],a=>a.privateKey='secret']){const a=prepareArgs();modify(a);await assert.rejects(()=>run('prepare',a));}
});
test('KOC1 verify resolves inscription evidence, rejects hash/root mutations, and leaves ID-only requests pending',async()=>{
 const {recipe,refs}=base(),out=await run('prepare',prepareArgs());
 const display=Buffer.from(recipe.id.slice(0,64),'hex').reverse().toString('hex')+'i'+Buffer.from(recipe.id.slice(64),'hex').readUInt32BE();
 const args={recipeId:display,inscriptions:{[display]:{bytes:out.recipeBytes,height:recipe.height,txIndex:recipe.txIndex}},refs};
 assert.equal((await run('verify',args)).valid,true);assert.equal((await run('verify',{recipeId:display})).status,'pending');
 const bad=base();Object.values(bad.refs)[0].bytes='00';assert.equal((await run('verify',bad)).valid,false);
 const s={height:102,hash:'11'.repeat(32),candidates:fixtures.candidates,controls:fixtures.controls,indexRoot:'ff'.repeat(32)};
 const r=await run('verify',{recipe:fixtures.recipe,refs:fixtures.refs,indexSnapshots:[s]});assert.equal(r.valid,false);assert.equal(r.snapshots[0].rootMatches,false);assert.equal(r.verified,false);
 await assert.rejects(()=>run('verify',{...base(),recipeBytes:out.recipeBytes}),/exactly one/);
});
test('KOC1 supply uses reference members/refunds and keeps missing pending coverage unknown',async()=>{
 const args={recipe:fixtures.recipe,refs:fixtures.refs,snapshot:{height:102,hash:'11'.repeat(32),candidates:fixtures.candidates,controls:fixtures.controls}};
 const lib=await import('../packages/ordinals-collections/src/index.ts');const state=lib.indexState(args.recipe,args.refs,args.snapshot.candidates,102,args.snapshot.hash,args.snapshot.controls);
 const unknown=await run('supply',args);assert.equal(unknown.minted,state.count);assert.equal(unknown.refund,state.over);assert.equal(unknown.pending,null);assert.equal(unknown.remaining,null);assert.equal(unknown.canSend,false);
 const complete=await run('supply',{...args,pendingCoverage:'complete'});assert.equal(complete.pending,0);assert.equal(complete.remaining,Math.max(0,state.cap-state.count));
});
test('KOC1 pending validation deduplicates, authenticates commits, applies next-block pause and does not claim guaranteed confirmation',async()=>{
 const {recipe,refs}=base();recipe.end={mode:'first',open:100,close:110,max:21};
 const original=fixtures.candidates.find(c=>!c.charms.length&&c.height===100),p={...original,height:null,txIndex:null,id:'pending'};
 const snapshot={height:99,hash:'11'.repeat(32),candidates:[p,{...p,id:'duplicate'}]};
 const a={recipe,refs,snapshot,pendingCoverage:'complete'};
 assert.equal((await run('supply',a)).pending,1);
 const forged=structuredClone(a);forged.snapshot.candidates[0].commitTx=forged.snapshot.candidates[0].commitTx.slice(0,-2)+'ff';forged.snapshot.candidates.pop();assert.equal((await run('supply',forged)).pending,0);
 const mixed=structuredClone(forged);mixed.snapshot.candidates.push(p);assert.equal((await run('supply',mixed)).pending,1);
 const paused=structuredClone(a);paused.snapshot.controls=[{id:'pause',p:'koc1',op:'control',r:recipe.id,parent:recipe.id,height:98,action:'pause',at:100}];assert.equal((await run('supply',paused)).pending,0);
 const missing=structuredClone(a);delete missing.snapshot.candidates[0].charms;await assert.rejects(()=>run('supply',missing),/charm evidence/);
});
test('KOC1 MCP tools list and dispatch through the production server',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'koc1-mcp-test-'));
 try{const server=await createMcpServer({workspaceRoot:root});await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'koc1-test',version:'1'}}});
 const list=await server.handle({jsonrpc:'2.0',id:1,method:'tools/list',params:{}});for(const tool of KOC1_TOOL_DEFINITIONS)assert.ok(list.result.tools.some(t=>t.name===tool.descriptor.name));
 const r=await server.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'keel-ordinals-collection-verify',arguments:base()}});assert.ok(!r.result.isError,JSON.stringify(r));assert.equal(r.result.structuredContent.valid,true);
 const clean=await server.handle({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'keel-ordinals-collection-prepare',arguments:prepareArgs()}});assert.ok(!clean.result.isError,JSON.stringify(clean));
 const linked=prepareArgs();linked.recipe.description='https://example.com/offchain-art';
 const blocked=await server.handle({jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'keel-ordinals-collection-prepare',arguments:linked}});assert.equal(blocked.result.isError,true);assert.equal(blocked.result.structuredContent.code,'external-link-found');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('KOC1 supply refuses a forged snapshot root and keeps unresolved confirmed positions unknown',async()=>{
 const args={recipe:fixtures.recipe,refs:fixtures.refs,snapshot:{height:102,hash:'11'.repeat(32),candidates:structuredClone(fixtures.candidates),indexRoot:'ff'.repeat(32)},pendingCoverage:'complete'};
 await assert.rejects(()=>run('supply',args),/root mismatch/);delete args.snapshot.indexRoot;
 const candidate=args.snapshot.candidates.find(c=>c.height===100);delete candidate.txIndex;
 const out=await run('supply',args);assert.ok(out.unresolvedPositions>0);assert.equal(out.pending,null);assert.equal(out.remaining,null);
 const future=structuredClone(args);future.snapshot.candidates[0].height=103;await assert.rejects(()=>run('supply',future),/beyond snapshot/);
});

test('KOC1 CBOR recipe round-trips safe satoshi prices above u32 without precision loss',async()=>{
 const args=prepareArgs();args.recipe.price=5_000_000_000;
 args.funding[0].value=6_000_000_000;args.commitValue=5_500_000_000;
 const out=await run('prepare',args);assert.equal(out.reveal.tx.outputs[1].value,5_000_000_000);
 const check=await run('verify',{recipeBytes:out.recipeBytes,inscriptionId:args.recipe.id,height:args.recipe.height,txIndex:args.recipe.txIndex,refs:args.refs});assert.equal(check.valid,true);
 assert.throws(()=>decodeCbor('1b0020000000000000'),/precision/);
});

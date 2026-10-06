import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {compileKeelCollectorMetadata, readKeelTokenMatrix, packKeelMatrixDictionary, compileKeelTokenMatrix, normalizeKeelLoadingManifest} from '../packages/sdk/dist/index.js';
import {createMcpServer} from '../packages/mcp/dist/server.js';
const row = id => ({tokenId:id,metadata:{name:`Object ${id}`,attributes:[{trait_type:'Paint',value:id%2?'Blue':'Red'},{trait_type:'Power',display_type:'number',value:42}],description:'Quote " slash \\ line\n nul\u0000 # % ? café 😀 </script>'},details:{seed:`seed-${id}`,traits:['A','B'],enabled:true,value:null}});
test('default metadata stores shared dictionary bytes and binary rows with exact typed output',()=>{
 const tokens=Array.from({length:1000},(_,id)=>row(id));
 const compiled=compileKeelCollectorMetadata(tokens,1000);
 assert.equal(compiled.storage,'compact-matrix');assert.equal(compiled.base64Layers,0);
 for(const id of [0,1,997,999]){
  assert.deepEqual(JSON.parse(new TextDecoder().decode(readKeelTokenMatrix(compiled.marketplace.matrix,id))),tokens[id].metadata);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(readKeelTokenMatrix(compiled.details.matrix,id))),tokens[id].details);
 }
 const raw=tokens.reduce((n,t)=>n+Buffer.byteLength(JSON.stringify(t.metadata)),0);
 const packed=compiled.marketplace.matrix.sharedValueBytes+compiled.marketplace.matrix.matrixBytes;
 assert.ok(packed<raw/4,`${packed} vs ${raw}`);
 assert.ok(compiled.marketplace.dictionary.readPlan.every(r=>r.nativeSlugReads===2&&r.objectReads===0));
 const entries=compiled.marketplace.matrix.table;
 for(const page of compiled.marketplace.dictionary.pages)for(const e of page.entries)assert.deepEqual(page.bytes.slice(e.offset,e.offset+e.length),entries[e.key-1].bytes);
});
test('sparse tokens remain unavailable, and raw/none are explicit choices',()=>{
 const compact=compileKeelCollectorMetadata([row(7)],8);assert.throws(()=>readKeelTokenMatrix(compact.marketplace.matrix,0));
 const raw=compileKeelCollectorMetadata([row(7)],8,{storage:'json'});assert.equal(raw.marketplace.matrix.table.length,1);
 assert.deepEqual(JSON.parse(new TextDecoder().decode(readKeelTokenMatrix(raw.marketplace.matrix,7))),row(7).metadata);
 assert.equal(compileKeelCollectorMetadata([row(7)],8,{storage:'none'}).enabled,false);
});
test('quotes, unicode, unsafe number types, duplicate traits and cycles never silently corrupt metadata',()=>{
 for(const value of [NaN,Infinity,undefined,1n,new Date(),[,1]])assert.throws(()=>compileKeelCollectorMetadata([{tokenId:0,metadata:{value}}],1));
 const cycle={};cycle.self=cycle;assert.throws(()=>compileKeelCollectorMetadata([{tokenId:0,metadata:cycle}],1));
 assert.throws(()=>compileKeelCollectorMetadata([{tokenId:0,metadata:{attributes:[{trait_type:'Paint',value:'Red'},{trait_type:'Paint',value:'Blue'}]}}],1));
 assert.throws(()=>compileKeelCollectorMetadata([{tokenId:0,metadata:{attributes:[{trait_type:'Power',display_type:'number',value:'42'}]}}],1));
});
test('packed dictionaries preserve contiguous keys across oversize object fallback and page boundaries',()=>{
 const m=compileKeelTokenMatrix([{tokenId:0,parts:[{role:'a',bytes:new Uint8Array([1,2])},{role:'large',bytes:new Uint8Array(32).fill(3)},{role:'b',bytes:new Uint8Array([4,5])}]}],1);
 const p=packKeelMatrixDictionary(m,8);assert.deepEqual(p.pages.map(page=>page.entries.map(e=>e.key)),[[1],[3]]);assert.equal(p.objects[0].id,2);
 assert.equal(p.readPlan[0].nativeSlugReads,3);assert.equal(p.readPlan[0].objectReads,1);
});
test('MCP default writes native .bin slugs and a local plan, with safe workspace boundaries',async()=>{
 const root=await mkdtemp('/tmp/keel-collector-metadata-');try{
  await mkdir(root+'/out');await writeFile(root+'/input.json',JSON.stringify({tokenCount:8,tokens:[row(0),row(7)]}));
  const server=await createMcpServer({workspaceRoot:root});
  await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'metadata-test',version:'1'}}});
  const call=args=>server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-metadata-prepare',arguments:args}});
  const result=(await call({manifestPath:'input.json',outputDirectory:'out'})).result;
  assert.ok(!result.isError,JSON.stringify(result));const plan=result.structuredContent;
  assert.equal(plan.storage,'compact-matrix');assert.equal(plan.published,false);assert.equal(plan.base64Layers,0);
  const expected=compileKeelCollectorMetadata([row(0),row(7)],8);
  assert.deepEqual(new Uint8Array(await readFile(plan.marketplace.pages[0].path)),expected.marketplace.dictionary.pages[0].bytes);
  assert.deepEqual(new Uint8Array(await readFile(plan.marketplace.rows[0].path)),expected.marketplace.matrix.blocks[0].bytes);
  assert.equal((await call({manifestPath:'input.json',outputDirectory:'/tmp'})).result.isError,true);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('custom init loaders require a bounded checked manifest',()=>{
 assert.deepEqual(normalizeKeelLoadingManifest(),{protocol:'keel-loading@1',readiness:'paint',timeoutMs:15000});
 assert.equal(normalizeKeelLoadingManifest({protocol:'keel-loading@1',loaderResourceId:'my-loader',readiness:'manual'}).readiness,'manual');
 for(const v of [{protocol:'wrong'},{protocol:'keel-loading@1',timeoutMs:Infinity},{protocol:'keel-loading@1',timeoutMs:0},{protocol:'keel-loading@1',verified:true}])assert.throws(()=>normalizeKeelLoadingManifest(v));
});

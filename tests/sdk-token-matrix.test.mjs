import test from 'node:test';
import assert from 'node:assert/strict';
import {compileKeelTokenMatrix,readKeelTokenMatrix,moduleAbi,moduleAbiContracts} from '../packages/sdk/dist/index.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createMcpServer} from '../packages/mcp/dist/server.js';
const part=(role,text)=>({role,bytes:new TextEncoder().encode(text)});
const token=(id,skin)=>({tokenId:id,parts:[part('open','{"name":"Gator #'),part('token-id',String(id)),part('field','","skin":'),part('trait',JSON.stringify(skin)),part('end','}') ]});
const read=(m,id)=>JSON.parse(new TextDecoder().decode(readKeelTokenMatrix(m,id)));

test('shared templates select explicit token traits; rows contain only choices',()=>{
 const input=[token(7,'Blue'),token(0,'Lava'),token(2,'Lava')];
 const m=compileKeelTokenMatrix(input,8);
 assert.equal(m.templates.length,1); assert.equal(m.templates[0].slots,1);
 assert.equal(m.rowStride,6); assert.equal(m.matrixBytes,48);
 assert.equal(m.table.filter(x=>x.roles.includes('trait')).length,2);
 assert.deepEqual(read(m,7),{name:'Gator #7',skin:'Blue'});
 assert.deepEqual(read(m,0),{name:'Gator #0',skin:'Lava'});
 assert.deepEqual(read(m,2),{name:'Gator #2',skin:'Lava'});
 assert.throws(()=>read(m,1),/no complete/);
 assert.deepEqual(m,compileKeelTokenMatrix([...input].reverse(),8));
});
test('different layer layouts share equal bytes and span row blocks correctly',()=>{
 const input=Array.from({length:4000},(_,id)=>token(id,id%2?'Blue':'Lava'));
 input[17]={tokenId:17,parts:[part('special','{"name":"special"}')]};
 const m=compileKeelTokenMatrix(input,4000);
 assert.equal(m.complete,true); assert.equal(m.templates.length,2); assert.equal(m.blocks.length,2);
 assert.deepEqual(read(m,17),{name:'special'});
 for(const id of [0,3832,3833,3999])assert.equal(read(m,id).skin,id%2?'Blue':'Lava');
});
test('invalid IDs, ID substitutions and mutated shared bytes fail closed',()=>{
 assert.throws(()=>compileKeelTokenMatrix([token(0,'Lava'),token(0,'Blue')],2));
 assert.throws(()=>compileKeelTokenMatrix([token(2,'Lava')],2));
 const bad=token(0,'Lava');bad.parts[1]=part('token-id','7');
 assert.throws(()=>compileKeelTokenMatrix([bad],1),/mismatch/);
 const m=compileKeelTokenMatrix([token(0,'Lava')],1);m.table[0].bytes[0]^=1;
 assert.throws(()=>read(m,0),/corrupt/);
});

test('MCP uses the same matrix compiler and confines reads to its workspace',async()=>{
 const root=await mkdtemp('/tmp/keel-matrix-mcp-');
 try {
  const tokens=[token(0,'Lava'),token(7,'Blue')];
  const manifest={tokenCount:8,tokens:[]};
  for(const t of tokens){const row={tokenId:t.tokenId,parts:[]};for(const [i,p] of t.parts.entries()){
   const path=`${t.tokenId}-${i}.bin`;await writeFile(root+'/'+path,p.bytes);row.parts.push({role:p.role,path});
  }manifest.tokens.push(row);}
  await writeFile(root+'/input.json',JSON.stringify(manifest));
  const server=await createMcpServer({workspaceRoot:root});
  await server.handle({jsonrpc:'2.0',id:0,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'matrix-test',version:'1'}}});
  const call=path=>server.handle({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'keel-token-matrix-prepare',arguments:{manifestPath:path}}});
  const result=(await call('input.json')).result;assert.ok(!result.isError,JSON.stringify(result));
  const expected=compileKeelTokenMatrix(tokens,8),actual=result.structuredContent;
  assert.deepEqual(actual.templates,expected.templates);assert.equal(actual.matrixBytes,48);
  assert.equal(actual.published,false);assert.equal(actual.selectedChainBindingsVerified,false);
  assert.equal(actual.table.length,expected.table.length);
  const dictionary=[];
  const compact={tokenCount:8,parts:dictionary,tokens:manifest.tokens.map(t=>({tokenId:t.tokenId,partIds:t.parts.map(p=>{if(p.role==='token-id')return 0;const id=dictionary.length+1;dictionary.push({id,...p});return id;})}))};
  await writeFile(root+'/compact.json',JSON.stringify(compact));
  const shared=(await call('compact.json')).result;assert.ok(!shared.isError,JSON.stringify(shared));
  assert.deepEqual(shared.structuredContent.templates,actual.templates);
  assert.deepEqual(shared.structuredContent.blocks,actual.blocks);
  assert.deepEqual(shared.structuredContent.reads,actual.reads);
  compact.tokens[0].partIds[0]=9999;await writeFile(root+'/invalid.json',JSON.stringify(compact));
  assert.equal((await call('invalid.json')).result.isError,true);
  assert.equal((await call('/etc/passwd')).result.isError,true);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('the canonical module catalog exposes the matrix contract controls',async()=>{
 assert.ok(moduleAbiContracts('keel-sleeve').includes('KeelTokenMatrix'));
 const abi=await moduleAbi('keel-sleeve','KeelTokenMatrix');
 for(const name of ['tokenJSON','tokenSelection','bindTable','bindTemplate','bindRowBlock'])assert.ok(abi.some(entry=>entry.type==='function'&&entry.name===name));
});


/** Append-only revision of token zero's SDK-compiled presentation. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha256,toHex,keccak256,parseAbi} from 'viem';
import {compileKeelTokenMatrix,readKeelTokenMatrix,KEEL_MATRIX_TOKEN_ID,KEEL_MATRIX_ROW_SLOT} from '@keel/sdk/token-matrix';
import {createKeelManagedObjectPlan} from '@keel/sdk/native-publication';
import {keelHoldAbi} from '@keel/sdk/abi';
import {openSession,readJSON,artifact,HOLD,SIGNER} from './gator-sepolia-session.mjs';
const root='apps/desktop/artifacts/gator-inline-sepolia/live-token-0';
const compile=async path=>{const input=await readJSON(path);return compileKeelTokenMatrix([{tokenId:0,parts:await Promise.all(input.tokens[0].parts.map(async p=>({role:p.role,bytes:await readFile(p.path)})))}],4000);};
const old=await compile(root+'/before-layout-fix/metadata-input.json'),next=await compile(root+'/metadata-input.json');
const before=await readJSON(root+'/before-layout-fix/token-proof.json'),prepared=await readJSON(root+'/preparation.json');
assert.equal(sha256(readKeelTokenMatrix(old,0)),before.jsonDigest);
assert.equal(sha256(readKeelTokenMatrix(next,0)),prepared.jsonDigest);
assert.equal(prepared.svgDigest,before.svgDigest);
assert.equal(next.rowStride,old.rowStride);assert.equal(next.rowStride,4);assert.equal(next.templates.length,1);
const table=[...old.table],byDigest=new Map(table.map(v=>[v.digest,v.id])),ids=new Map(),added=[];
for(const v of next.table){let id=byDigest.get(v.digest);if(id===undefined){id=table.length+1;const row={...v,id};table.push(row);added.push(row);byDigest.set(v.digest,id);}ids.set(v.id,id);}
const template={...next.templates[0],id:old.templates.length+1,commands:next.templates[0].commands.map(id=>{if(id===KEEL_MATRIX_TOKEN_ID)return id;assert.ok(id<KEEL_MATRIX_ROW_SLOT,'This revision expects a constant SDK template');return ids.get(id);})};
const blocks=next.blocks.map(b=>({ ...b,bytes:Uint8Array.from(b.bytes)}));new DataView(blocks[0].bytes.buffer).setUint16(0,template.id);
const revised={...next,table,templates:[...old.templates,template],blocks};
assert.equal(sha256(readKeelTokenMatrix(revised,0)),prepared.jsonDigest);
const browser=await readJSON(root+'/browser-acceptance.json');assert.equal(browser.jsonDigest,prepared.jsonDigest);assert.equal(browser.runtimeErrors,0);assert.ok(browser.htmlProducesPNG&&browser.canonicalKPresent);
const execute=process.env.KEEL_GATOR_LAYOUT_EXECUTE==='1';
const summary={chainId:11155111,tokenId:0,metadataResolver:before.metadataResolver,newSharedValues:added.length,newSharedBytes:added.reduce((n,v)=>n+v.bytes.length,0),templateId:template.id,svgUnchanged:true,jsonDigest:prepared.jsonDigest,execute};
await writeFile(root+'/layout-revision-plan.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));if(!execute)process.exit(0);
const s=await openSession(root,{execute:true,budget:340_000_000_000_000_000n}),build=await artifact('KeelTokenMatrix'),abi=parseAbi(keelHoldAbi),resolver=before.metadataResolver;
assert.equal((await s.c.readContract({address:resolver,abi:build.abi,functionName:'owner'})).toLowerCase(),SIGNER.toLowerCase());
const original=await readJSON('apps/desktop/artifacts/gator-sepolia/compiled-original.json');assert.equal(await s.c.readContract({address:before.collection,abi:original.abi,functionName:'tokenURI',args:[0n]}),before.tokenURI);
const oldRowId=keccak256(old.blocks[0].bytes),newRowId=keccak256(blocks[0].bytes);
const currentRow=await s.c.readContract({address:resolver,abi:build.abi,functionName:'rowBlocks',args:[0n]});assert.ok(currentRow===oldRowId||currentRow===newRowId,'Unexpected concurrent row revision');
for(const v of old.table){const p=await createKeelManagedObjectPlan(v.bytes,{hold:HOLD,mediaType:'text/plain',compression:'none'});assert.equal(await s.c.readContract({address:resolver,abi:build.abi,functionName:'table',args:[v.id]}),p.objectId);}
await s.precast(added);await s.weldPrepared(added);
const bind=[];
for(const v of added){const p=await s.publish(v.bytes),actual=await s.c.readContract({address:resolver,abi:build.abi,functionName:'table',args:[v.id]});if(actual==='0x'+'0'.repeat(64))bind.push({id:v.id,objectId:p.objectId});else assert.equal(actual,p.objectId);}
if(bind.length)await s.call('layout:table',resolver,build.abi,'bindTable',[bind.map(x=>x.id),bind.map(x=>x.objectId)]);
const commands=Buffer.alloc(template.commands.length*2);template.commands.forEach((v,i)=>commands.writeUInt16BE(v,i*2));
const actualTemplate=await s.c.readContract({address:resolver,abi:build.abi,functionName:'template',args:[template.id]});if(actualTemplate==='0x')await s.call('layout:template',resolver,build.abi,'bindTemplate',[template.id,toHex(commands)]);else assert.equal(actualTemplate,toHex(commands));
const pointer=await s.c.readContract({address:HOLD,abi,functionName:'slugPointer',args:[newRowId]});if(pointer==='0x'+'0'.repeat(40))await s.call('cast:'+newRowId,HOLD,abi,'castSlugs',[[toHex(blocks[0].bytes)]]);else assert.equal(await s.c.getCode({address:pointer}),'0x00'+Buffer.from(blocks[0].bytes).toString('hex'));
if(currentRow!==newRowId)await s.call('layout:row',resolver,build.abi,'bindRowBlock',[0n,newRowId]);
const actual=await s.c.readContract({address:resolver,abi:build.abi,functionName:'tokenJSON',args:[0n],gas:60_000_000n});assert.equal(sha256(Buffer.from(actual)),prepared.jsonDigest);
const proof={...before,jsonDigest:prepared.jsonDigest,layoutRevision:true,readback:true,tokenURIReadback:true};
await writeFile(root+'/readers-proof.json',JSON.stringify(proof,null,2));await writeFile(root+'/token-proof.json',JSON.stringify(proof,null,2));console.log(JSON.stringify({phase:'layout-revision-verified',...proof}));

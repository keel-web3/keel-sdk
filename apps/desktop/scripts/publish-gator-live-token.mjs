/** Token-zero acceptance before the creator-authorized 4,000-token rollout.
 * Reuses KEEL's SDK table/compiler and registered shared runtime. */
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {sha256,toHex,parseAbi,encodeFunctionData,keccak256} from 'viem';
import {compileKeelTokenMatrix,readKeelTokenMatrix} from '@keel/sdk/token-matrix';
import {keelHoldAbi} from '@keel/sdk/abi';
import {openSession,readJSON,artifact,HOLD,SIGNER,CAP} from './gator-sepolia-session.mjs';
import {prepareLiveToken,LIVE_ROOT} from './prepare-gator-live-token.mjs';
const execute=process.env.KEEL_GATOR_TOKEN_EXECUTE==='1',phase=process.env.KEEL_GATOR_TOKEN_PHASE??'storage';
assert.ok(['storage','readers','activate'].includes(phase));
const s=await openSession(LIVE_ROOT,{execute,budget:340_000_000_000_000_000n}),holdABI=parseAbi(keelHoldAbi);
const registration=await readJSON('apps/desktop/artifacts/gator-inline-sepolia/runtime-registration/proof.json');assert.ok(registration.exactReadback);
assert.deepEqual(await s.read(registration.sourceObjectId),await readFile((await import('@keel/sdk/layered-runtime-info')).LAYERED_RUNTIME.localPath));
const browser=await readJSON(LIVE_ROOT+'/browser-acceptance.json'),preparation=await readJSON(LIVE_ROOT+'/preparation.json');
if(browser.htmlDigest){assert.equal(browser.htmlDigest,sha256(await readFile(LIVE_ROOT+'/viewer.html')));assert.equal(browser.svgDigest,preparation.svgDigest);}
else assert.equal(browser.jsonDigest,preparation.jsonDigest);
assert.equal(browser.runtimeErrors,0);assert.ok(browser.htmlProducesPNG&&browser.canonicalKPresent);
const original=await readJSON('apps/desktop/artifacts/gator-sepolia/compiled-original.json'),matrixBuild=await artifact('KeelTokenMatrix'),collection='0xab2e21bffafdae462e9392375a413d36ea7c247c';
assert.equal((await s.c.readContract({address:collection,abi:original.abi,functionName:'owner'})).toLowerCase(),SIGNER.toLowerCase());
await s.c.readContract({address:collection,abi:original.abi,functionName:'ownerOf',args:[0n]});
const input=await readJSON(LIVE_ROOT+'/image-input.json'),parts=await Promise.all(input.tokens[0].parts.map(async p=>({role:p.role,bytes:await readFile(p.path)})));
const image=compileKeelTokenMatrix([{tokenId:0,parts}],4000);assert.equal(sha256(readKeelTokenMatrix(image,0)),preparation.svgDigest);
console.log(JSON.stringify({phase:'review',target:phase,chainId:11155111,collection,tokenId:0,imageValues:image.table.length,feeCapGwei:Number(CAP)/1e9,execute}));
if(!execute)process.exit(0);
if(phase==='storage'){
 let verifiedBytes=0,verifiedObjects=0;
 for(const value of image.table.filter(v=>v.roles.includes('image-asset'))){const p=await s.publish(value.bytes);verifiedBytes+=value.bytes.length;verifiedObjects++;console.log(JSON.stringify({phase:'layer-verified',verifiedObjects,totalLayers:image.table.filter(v=>v.roles.includes('image-asset')).length,verifiedBytes,objectId:p.objectId}));}
 await writeFile(LIVE_ROOT+'/layer-storage-proof.json',JSON.stringify({chainId:11155111,tokenId:0,verifiedBytes,verifiedObjects,exactReadback:true},null,2));process.exit(0);
}
// Source registration is necessary, but only the active catalog proof permits
// the collector-facing reader and URI attachment steps.
const binding=await readJSON('apps/desktop/artifacts/gator-inline-sepolia/canonical-bindings/catalog-live-proof.json');assert.ok(binding.exactReadback&&binding.mcpFoundRuntime);assert.equal(binding.sourceDigest,registration.sourceDigest);
const imageResolver=await s.deploy('deploy:image-matrix',matrixBuild,[HOLD,collection,SIGNER,4000n,image.rowStride]);
const prepared=await prepareLiveToken(imageResolver),metadata=prepared.matrices.metadata;
const metadataResolver=await s.deploy('deploy:metadata-matrix',matrixBuild,[HOLD,collection,SIGNER,4000n,metadata.rowStride]);
// Group the small SDK-planned fragments into standard Hold castSlugs calls;
// object identities, layer reuse and the subsequent exact read-back stay intact.
await s.precast([...image.table,...metadata.table]);
await s.weldPrepared([...image.table,...metadata.table]);
for(const [name,resolver,matrix] of [['image',imageResolver,image],['metadata',metadataResolver,metadata]]){
 const ids=[];
 for(const value of matrix.table)ids.push((await s.publish(value.bytes)).objectId);
 for(let at=0;at<ids.length;at+=100){const entries=matrix.table.slice(at,at+100),missing=[];
  for(const v of entries){const actual=await s.c.readContract({address:resolver,abi:matrixBuild.abi,functionName:'table',args:[v.id]});if(actual==='0x'+'0'.repeat(64))missing.push(v);else assert.equal(actual,ids[v.id-1]);}
  if(missing.length)await s.call(name+':table:'+at,resolver,matrixBuild.abi,'bindTable',[missing.map(v=>v.id),missing.map(v=>ids[v.id-1])]);
 }
 for(const t of matrix.templates){const bytes=Buffer.alloc(t.commands.length*2);t.commands.forEach((v,i)=>bytes.writeUInt16BE(v,i*2));const actual=await s.c.readContract({address:resolver,abi:matrixBuild.abi,functionName:'template',args:[t.id]});if(actual==='0x')await s.call(name+':template:'+t.id,resolver,matrixBuild.abi,'bindTemplate',[t.id,toHex(bytes)]);else assert.equal(actual,toHex(bytes));}
 for(const block of matrix.blocks.filter(b=>b.bytes.some(x=>x))){const id=keccak256(block.bytes),pointer=await s.c.readContract({address:HOLD,abi:holdABI,functionName:'slugPointer',args:[id]});if(pointer==='0x'+'0'.repeat(40))await s.call('cast:'+id,HOLD,holdABI,'castSlugs',[[toHex(block.bytes)]]);else assert.equal(await s.c.getCode({address:pointer}),'0x00'+Buffer.from(block.bytes).toString('hex'));
  const actual=await s.c.readContract({address:resolver,abi:matrixBuild.abi,functionName:'rowBlocks',args:[BigInt(block.index)]});if(actual!==id){assert.equal(actual,'0x'+'0'.repeat(64),'Existing selection differs; require an explicit revision');await s.call(name+':row:'+block.index,resolver,matrixBuild.abi,'bindRowBlock',[BigInt(block.index),id]);}
 }
 const actual=await s.c.readContract({address:resolver,abi:matrixBuild.abi,functionName:'tokenJSON',args:[0n],gas:60_000_000n});assert.deepEqual(Buffer.from(actual),Buffer.from(readKeelTokenMatrix(matrix,0)));
 const gas=await s.c.estimateGas({to:resolver,data:encodeFunctionData({abi:matrixBuild.abi,functionName:'tokenJSON',args:[0n]}),gas:60_000_000n});assert.ok(gas<60_000_000n);console.log(JSON.stringify({phase:'reader-verified',name,resolver,bytes:Buffer.byteLength(actual),gas:String(gas)}));
}
const proof={chainId:11155111,collection,tokenId:0,imageResolver,metadataResolver,jsonDigest:prepared.graph.integrity.digest,svgDigest:sha256(prepared.svg),readback:true,tokenURI:`web3://${metadataResolver}:11155111/tokenJSON/0?mime.type=json`};await writeFile(LIVE_ROOT+'/readers-proof.json',JSON.stringify(proof,null,2));
if(phase==='activate'){
 // Activate only after the exact public readers passed. Minting the remaining
 // inventory is a separate step after actual collector/browser acceptance.
 await s.call('collection:suffix',collection,original.abi,'setTokenURISuffix',['?mime.type=json']);
 await s.call('collection:base-uri',collection,original.abi,'setBaseURI',[`web3://${metadataResolver}:11155111/tokenJSON/`]);
 const uri=await s.c.readContract({address:collection,abi:original.abi,functionName:'tokenURI',args:[0n]});assert.equal(uri,proof.tokenURI);await writeFile(LIVE_ROOT+'/token-proof.json',JSON.stringify({...proof,tokenURIReadback:true},null,2));console.log(JSON.stringify({phase:'token-uri-verified',...proof}));
}

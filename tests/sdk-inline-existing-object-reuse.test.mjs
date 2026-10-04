import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import * as sdk from '../packages/sdk/dist/inline-viewer-graph.js';

const bytes=s=>new TextEncoder().encode(s);
const integrity=b=>({algorithm:'sha256',digest:'0x'+createHash('sha256').update(b).digest('hex'),byteLength:b.length});
const join=parts=>new Uint8Array(Buffer.concat(parts.map(p=>p.bytes)));
const scope={mode:'assembly-only',chainId:11155111,store:'0x'+'12'.repeat(20)};
function document(parts){const rootBytes=join(parts);return{rootBytes,rootIntegrity:integrity(rootBytes),byteLength:rootBytes.length,parts};}
function localDocument(){return document([
 ['shell-prefix','<!doctype html><html><head></head><body>'],
 ['module','<script>globalThis.fish="水🐟";</script>'],
 ['entrypoint','<script>globalThis.boot=1;</script>'],
 ['shell-suffix','</body></html>'],
].map(([role,text])=>{const b=bytes(text);return{kind:'existing',role,bytes:b,byteLength:b.length,integrity:integrity(b)};}));}
async function fixture(carriage='raw-percent'){
 const built=await sdk.buildKeelInlineTokenURIGraph(localDocument(),{carriage,legacyCarriage:"acknowledged"});
 const existingParts=built.parts.map((p,i)=>({role:p.role,bytes:p.bytes.slice(),integrity:{...p.integrity},
  carrier:{chainId:scope.chainId,store:scope.store,objectId:'0x'+(i+1).toString(16).padStart(64,'0'),mediaType:built.mediaType,compression:'none',storedByteLength:p.bytes.length}}));
 if(carriage==='follow-latest')throw new Error('Use mixed fixture');
 return{built,existingParts};
}
async function inspect(parts,extra={}){return sdk.inspectKeelInlineExistingObjectReuse({existingObjectReuse:scope,existingParts:parts,...extra});}
const clone=p=>p.map(x=>({...x,bytes:x.bytes.slice(),integrity:{...x.integrity},carrier:{...x.carrier}}));

test('prepared aligned Base64 is inferred and copied exactly, with zero new source bytes',async()=>{
 const {existingParts}=await fixture('pinned');
 const inspected=await inspect(existingParts);
 assert.equal(inspected.carriage,'pinned');assert.equal(inspected.newSourcePublicationBytes,0);
 assert.equal(inspected.storageTransform,'none');assert.equal(inspected.selectedChainBindingVerified,false);
 assert.deepEqual(inspected.reusedObjectIds,existingParts.map(p=>p.carrier.objectId));
 const graph=await sdk.buildKeelInlineTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope});
 assert.equal(graph.schema,'keel-inline-preencoded-token-uri@1');
 assert.equal(graph.creatorPublicationBytes,0);assert.deepEqual(graph.fragmentBytes,join(existingParts));
 assert.deepEqual(graph.parts.map(p=>p.sourceObjectId),inspected.reusedObjectIds);
 graph.parts.forEach((p,i)=>assert.deepEqual(p.bytes,existingParts[i].bytes));
 assert.deepEqual(graph.htmlBytes,inspected.root.rootBytes);
 const direct=await sdk.buildKeelInlinePreEncodedTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope});
 assert.deepEqual(direct.fragmentBytes,graph.fragmentBytes);
});

test('raw-percent and percent infer exact existing carriages without repadding',async()=>{
 for(const carriage of ['raw-percent','percent']){
  const {existingParts}=await fixture(carriage);
  const inspected=await inspect(existingParts);assert.equal(inspected.carriage,carriage);
  const graph=await sdk.buildKeelInlineTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope});
  assert.deepEqual(graph.fragmentBytes,join(existingParts));assert.equal(graph.creatorPublicationBytes,0);
  const fn=carriage==='percent'?sdk.buildKeelInlineEscapedTokenURIGraph:sdk.buildKeelInlineRawPercentTokenURIGraph;
  const direct=await fn(inspected.root,{existingParts,existingObjectReuse:scope});assert.deepEqual(direct.fragmentBytes,graph.fragmentBytes);
 }
});

test('full shell plus prepared body media infers follow-latest and preserves body IDs',async()=>{
 const {existingParts}=await fixture('pinned');
 for(const p of existingParts.slice(1,-1))p.carrier.mediaType='application/vnd.keel.token-uri-base64-body-fragment';
 const inspected=await inspect(existingParts);assert.equal(inspected.carriage,'follow-latest');
 const graph=await sdk.buildKeelInlineTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope});
 assert.equal(graph.shellSelection,'follow-latest');assert.equal(graph.creatorPublicationBytes,0);
 assert.deepEqual(graph.fragmentBytes,join(existingParts.slice(1,-1)));
 assert.deepEqual(graph.parts.map(p=>p.sourceObjectId),inspected.reusedObjectIds.slice(1,-1));
 const direct=await sdk.buildKeelInlineFollowLatestTokenURIBodyGraph(inspected.root,{existingParts,existingObjectReuse:scope});
 assert.deepEqual(direct.fragmentBytes,graph.fragmentBytes);
});

test('explicit mismatching carriage and direct helper fail before fresh encoding',async()=>{
 const {existingParts}=await fixture('pinned');const inspected=await inspect(existingParts);
 await assert.rejects(inspect(existingParts,{carriage:'compact'}),/does not match/);
 await assert.rejects(sdk.buildKeelInlineTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope,carriage:'percent'}),/does not match/);
 await assert.rejects(sdk.buildKeelInlineRawPercentTokenURIGraph(inspected.root,{existingParts,existingObjectReuse:scope}),/does not match/);
});

test('assembly-only requires every ordered part and forbids creator or unused parts',async()=>{
 const {existingParts}=await fixture();const {root}=await inspect(existingParts);
 for(const actual of [undefined,existingParts.slice(1),[...existingParts,existingParts[1]]]){
  await assert.rejects(sdk.buildKeelInlineTokenURIGraph(root,{existingParts:actual,existingObjectReuse:scope}),/every ordered part/);
 }
 const creator=document(root.parts.map((p,i)=>i===1?{...p,kind:'creator',role:'entrypoint'}:p));
 await assert.rejects(sdk.buildKeelInlineTokenURIGraph(creator,{existingParts,existingObjectReuse:scope}),/new source publication is forbidden/);
});

test('selected-chain store and nonzero exact object IDs are mandatory',async()=>{
 const {existingParts}=await fixture();
 for(const [key,value] of [['chainId',1],['store','0x'+'34'.repeat(20)],['objectId','0x'+'00'.repeat(32)],['objectId','0x1234']]){
  const parts=clone(existingParts);parts[1].carrier[key]=value;await assert.rejects(inspect(parts),/selected-chain object/);
 }
 await assert.rejects(sdk.inspectKeelInlineExistingObjectReuse({existingObjectReuse:{...scope,mode:'fresh'},existingParts}),/assembly-only/);
});

test('unsupported raw binary and mixed prepared media never transcode',async()=>{
 const {existingParts}=await fixture();
 for(const media of ['application/octet-stream','application/vnd.keel.token-uri-percent-fragment']){
  const parts=clone(existingParts);parts[1].carrier.mediaType=media;
  await assert.rejects(inspect(parts),/incompatible|canonical RFC 4648|not canonical/);
 }
});

test('stored SHA, exact lengths and compression are checked before assembly',async()=>{
 const {existingParts}=await fixture();
 for(const mutate of [p=>p.bytes[0]^=1,p=>p.integrity.byteLength++,p=>p.carrier.storedByteLength++,p=>p.carrier.compression='gzip',p=>p.integrity.algorithm='none']){
  const parts=clone(existingParts);mutate(parts[1]);await assert.rejects(inspect(parts),/commitment|exact uncompressed|SHA-256/);
 }
});

test('source edits, root edits and local unpadded source cannot hide behind old receipts',async()=>{
 const {existingParts}=await fixture('pinned');const {root}=await inspect(existingParts);
 const changedParts=root.parts.map((p,i)=>i===1?(()=>{const b=bytes('<script>different()</script>');return{...p,bytes:b,byteLength:b.length,integrity:integrity(b)};})():p);
 await assert.rejects(sdk.buildKeelInlineTokenURIGraph(document(changedParts),{existingParts,existingObjectReuse:scope}),/differs from the published decoded source/);
 const changedRoot={...root,rootBytes:bytes('different'),byteLength:9,rootIntegrity:integrity(bytes('different'))};
 await assert.rejects(sdk.buildKeelInlineTokenURIGraph(changedRoot,{existingParts,existingObjectReuse:scope}),/root differs/);
 await assert.rejects(sdk.buildKeelInlineTokenURIGraph(localDocument(),{existingParts,existingObjectReuse:scope}),/cannot replace or repad/);
});

test('shell order, exact Base64 alignment and inconsistent immutable IDs fail closed',async()=>{
 const {existingParts}=await fixture('pinned');
 const moved=clone(existingParts);moved[1].role='shell-prefix';await assert.rejects(inspect(moved),/move shell boundaries/);
 const bad=clone(existingParts);bad[1].bytes=bytes(Buffer.from(Buffer.from('seven!!').toString('base64')).toString('base64'));
 bad[1].integrity=integrity(bad[1].bytes);bad[1].carrier.storedByteLength=bad[1].bytes.length;
 await assert.rejects(inspect(bad),/alignment|unpadded/);
 const conflict=clone(existingParts);conflict[1].carrier.objectId=conflict[0].carrier.objectId;
 await assert.rejects(inspect(conflict),/conflicting/);
});

test('inspection clones Buffer-backed bytes rather than exposing caller aliasing',async()=>{
 const {existingParts}=await fixture();existingParts[1].bytes=Buffer.from(existingParts[1].bytes);
 const snapshot=Uint8Array.from(existingParts[1].bytes);const result=await inspect(existingParts);
 existingParts[1].bytes.fill(0);existingParts[1].carrier.objectId='0x'+'ff'.repeat(32);
 assert.deepEqual(result.existingParts[1].bytes,snapshot);assert.notEqual(result.existingParts[1].carrier.objectId,existingParts[1].carrier.objectId);
});

test('ordinary default and explicit local carriage outputs remain byte-identical',async()=>{
 const root=localDocument();
 for(const carriage of [undefined,'compact','raw-percent','percent','pinned','follow-latest']){
  const options=carriage===undefined?{}:{carriage,legacyCarriage:'acknowledged'};
  const candidate=await sdk.buildKeelInlineTokenURIGraph(root,options);
  const golden={"default":"8f56c5230d5dcaf9ad44491cfe13e8c4b3b6193095bcc17156b4a8e2999821b2","compact":"8f56c5230d5dcaf9ad44491cfe13e8c4b3b6193095bcc17156b4a8e2999821b2","raw-percent":"8f56c5230d5dcaf9ad44491cfe13e8c4b3b6193095bcc17156b4a8e2999821b2","percent":"b80a38221bd1b68ed27c7776afc469e70079119ba4fb0f5dea0a0562c3356a70","pinned":"dc18b1d315ab5d6a4d492062f7270843e10e63e902367831a9dd5262b4df8b71","follow-latest":"8b85e4738cb2f5e03c91398dca3458cef13b2bd1ce977c81fa8cbd621885c792"};
  const actual=createHash('sha256').update(JSON.stringify(candidate,(_,v)=>v instanceof Uint8Array?{hex:Buffer.from(v).toString('hex')}:v)).digest('hex');
  assert.equal(actual,golden[carriage??'default']);
 }
});

async function withDigestBarrier(action){
 const original=globalThis.crypto.subtle.digest;
 let release,enter;const gate=new Promise(r=>release=r);const entered=new Promise(r=>enter=r);let first=true;
 globalThis.crypto.subtle.digest=async function(...args){if(first){first=false;enter();await gate;}return original.apply(this,args);};
 try{return await action({entered,release});}finally{release();globalThis.crypto.subtle.digest=original;}
}

test('async digest suspension cannot change selected chain, future receipts, order or carriage',async()=>{
 const {existingParts}=await fixture('pinned');const mutableScope={...scope};
 const input={existingObjectReuse:mutableScope,existingParts,carriage:'pinned'};
 const expected=clone(existingParts);
 await withDigestBarrier(async({entered,release})=>{
  const pending=sdk.inspectKeelInlineExistingObjectReuse(input);await entered;
  mutableScope.chainId=1;mutableScope.store='0x'+'34'.repeat(20);
  existingParts[2].carrier.chainId=1;existingParts[2].carrier.store=mutableScope.store;
  existingParts[2].bytes.fill(0);existingParts[2].role='shell-prefix';input.carriage='raw-percent';existingParts.reverse();
  release();const result=await pending;
  assert.equal(result.carriage,'pinned');assert.deepEqual(result.existingParts,expected);
 });
});

test('async digest suspension compares root against its entry-time snapshot',async()=>{
 const {existingParts}=await fixture('pinned');const {root}=await inspect(existingParts);
 const expectedRoot=Uint8Array.from(root.rootBytes);const expectedStored=join(existingParts);
 await withDigestBarrier(async({entered,release})=>{
  const pending=sdk.buildKeelInlineTokenURIGraph(root,{existingParts,existingObjectReuse:{...scope}});await entered;
  root.rootBytes.fill(0);root.rootIntegrity.digest='0x'+'00'.repeat(32);
  root.parts[2].bytes.fill(0);root.parts[2].integrity.digest='0x'+'00'.repeat(32);root.parts[2].role='shell-prefix';
  existingParts[2].bytes.fill(0);existingParts[2].carrier.chainId=1;
  release();const result=await pending;
  assert.deepEqual(result.htmlBytes,expectedRoot);assert.deepEqual(result.fragmentBytes,expectedStored);
 });
});

test('receipt module identity and execution labels cannot silently override the root',async()=>{
 const {existingParts}=await fixture();
 existingParts[1].moduleId='keel.example';existingParts[1].moduleVersion='1';existingParts[1].execution='classic';existingParts[1].phase='foundation';existingParts[1].weight=1;
 const {root}=await inspect(existingParts);
 for(const [key,value] of [['moduleId','other'],['moduleVersion','2'],['execution','module'],['phase','bootstrap'],['weight',2]]){
  const altered=clone(existingParts);altered[1][key]=value;
  await assert.rejects(sdk.buildKeelInlineTokenURIGraph(root,{existingParts:altered,existingObjectReuse:scope}),/differs from the published decoded source/);
 }
});

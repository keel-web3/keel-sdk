import test from'node:test';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{encodeAbiParameters}from'viem';
import{prepareKeelCreatorInline,decodeKeelPreparedDenseCopyFragment,prepareKeelDensePayload,buildKeelOnchainContainerBinding,buildKeelPreparedDenseCopyShell,serializeKeelDenseTransportJSON}from'../packages/sdk/dist/index.js';
import{analyzeTokenUri,canonicalJson}from'../packages/mcp/dist/standards.js';
const store='0xd820e337692a6eb7a4878e42ce88cbcff49b55cf',address='0x'+'11'.repeat(20),digest='0x'+'22'.repeat(32);
const poster={mediaType:'image/png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64')};
async function fixture(source='export const gif=d=>`data:image/gif;base64,${btoa(d)}`;',compression='brotli'){
 const plan=await prepareKeelCreatorInline({chainId:11155111,store,compression,poster,resources:[{id:'game.html',aliases:['./game.html'],role:'entrypoint',mediaType:'text/html',bytes:Buffer.from('<!doctype html><script src="./game.js"></script>')},{id:'game.js',aliases:['./game.js'],role:'module',mediaType:'text/javascript',bytes:Buffer.from(source)}]});
 const body=[plan.shell.prefix,...plan.objects.slice(0,plan.request.bodyObjectIds.length),plan.shell.suffix].map(o=>Buffer.from(decodeKeelPreparedDenseCopyFragment(o.bytes)).toString()).join('');
 const ctx={protocol:'keel-context@3',chainId:'11155111',collection:address,tokenId:'1',composerAddress:address,composerCodeHash:digest,composerRevision:'1',containerTableObjectId:plan.table.objectId,containerTableDigest:plan.table.digest,presentationDigest:digest,presentationDigestType:'keccak256:keel.creator-prepared-copy-presentation@1'};
 const tail=`<script>(()=>{try{const v="${Buffer.from(JSON.stringify(ctx)).toString('base64url')}";void v}catch(e){throw e}})()</script>`;
 return{html:body+tail,body,tail,ctx,plan};
}
const token=html=>'data:application/json,'+encodeURIComponent(JSON.stringify({name:'test',image:'data:image/png;base64,'+poster.bytes.toString('base64'),animation_url:'data:text/html;charset=utf-8,'+encodeURIComponent(html)}));
const errors=r=>r.findings.filter(f=>f.severity==='error');
test('supported COPY shell verifies every Brotli/None resource and keeps generated GIF prefixes readable',async()=>{for(const codec of['brotli','none']){const f=await fixture(undefined,codec),a=await analyzeTokenUri(token(f.html));assert.deepEqual(errors(a),[]);assert.equal(a.metadata.canonicalShells,1);assert.equal(a.metadata.graphItems,2);}});
test('code injected before or inside the COPY bootstrap cannot inherit canonical status',async()=>{const f=await fixture();for(const html of[f.html.replace('];queueMicrotask','];globalThis.injected=true;queueMicrotask'),f.html.replace('document.open();','globalThis.injected=true;document.open();')]){const a=await analyzeTokenUri(token(html));assert(errors(a).some(f=>f.code==='viewer-not-canonical-shell'));}});
test('a modified compressed verifier is rejected',async()=>{const f=await fixture(),html=f.html.replace(/utf8\("([A-Za-z0-9+/=]+)"\)/,(m,b)=>m.replace(b,b.slice(0,30)+(b[30]==='A'?'B':'A')+b.slice(31)));const a=await analyzeTokenUri(token(html));assert(errors(a).some(f=>f.code==='viewer-not-canonical-shell'));});
test('changed packed payload bytes fail their commitments',async()=>{const f=await fixture(),html=f.html.replace(/"storedDense":"(.)/,(m,c)=>m.slice(0,-1)+(c==='A'?'B':'A'));const a=await analyzeTokenUri(token(html));assert(errors(a).some(f=>f.code==='viewer-not-canonical-shell'));});
test('the collection packtable commitment is checked',async()=>{const f=await fixture(),bad={...f.ctx,containerTableDigest:digest},html=f.body+f.tail.replace(Buffer.from(JSON.stringify(f.ctx)).toString('base64url'),Buffer.from(JSON.stringify(bad)).toString('base64url'));const a=await analyzeTokenUri(token(html));assert(errors(a).some(f=>/commitment mismatch/.test(f.detail)));});
test('external locators hidden inside packed creator modules still fail',async()=>{const html=await hostilePackedFixture(),a=await analyzeTokenUri(token(html));assert(errors(a).some(f=>f.code==='external-locator'&&f.at.includes('game.js')),JSON.stringify(a.findings));});
test('a concrete invalid image data URI in JavaScript is still rejected',async()=>{const f=await fixture('export const bad="data:image/png;base64,%%%";'),a=await analyzeTokenUri(token(f.html));assert(errors(a).some(f=>f.code==='data-uri-invalid'));});

// A deliberately hostile, data-only test fixture. Production preparation already
// refuses this source. Recompute its valid content commitments to prove the audit
// detects the locator itself rather than relying on an integrity failure.
async function hostilePackedFixture(){
 const f=await fixture(),source=Buffer.from('export const leak=()=>fetch("https://example.com/art");'),payload=prepareKeelDensePayload(source,{compression:'brotli'}),r=f.plan.resources[1];
 const rawBinding={chainId:11155111,store:f.plan.store,objectId:r.carrier.objectId,compression:payload.compression,storedIntegrity:payload.storedIntegrity,integrity:payload.decodedIntegrity},binding={id:'0x'+createHash('sha256').update(canonicalJson(rawBinding)).digest('hex'),...rawBinding};
 const resources=[f.plan.resources[0],{...r,payload,binding,pack:{containerId:binding.id,objectId:r.carrier.objectId,storedIntegrity:payload.storedIntegrity,storedDense:payload.storedDense},descriptor:{...r.descriptor,integrity:payload.decodedIntegrity,onchain:{containerId:binding.id,offset:0},containerBindings:[binding]}}];
 const rows=resources.map(r=>({byteLength:BigInt(r.payload.compressedBytes.length),digest:r.payload.storedIntegrity.digest,objectId:r.carrier.objectId,containerId:r.binding.id}));
 const bytes=Buffer.from(encodeAbiParameters([{type:'tuple[]',components:[{name:'byteLength',type:'uint256'},{name:'digest',type:'bytes32'},{name:'objectId',type:'bytes32'},{name:'containerId',type:'bytes32'}]}],[rows]).slice(2),'hex');
 const ctx={...f.ctx,containerTableDigest:'0x'+createHash('sha256').update(bytes).digest('hex')},shell=await buildKeelPreparedDenseCopyShell({embeddedContainerDelivery:{chainId:11155111,store:f.plan.store}});
 return Buffer.from(shell.prefix).toString()+serializeKeelDenseTransportJSON(resources.map(r=>r.pack)).slice(1,-1)+Buffer.from(shell.containerBridge).toString()+serializeKeelDenseTransportJSON([null,...resources.map(r=>r.descriptor)]).slice(5,-1)+Buffer.from(shell.suffix).toString()+f.tail.replace(Buffer.from(JSON.stringify(f.ctx)).toString('base64url'),Buffer.from(JSON.stringify(ctx)).toString('base64url'));
}

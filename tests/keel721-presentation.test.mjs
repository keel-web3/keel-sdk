import test from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData } from "viem";
import { buildKeel721PresentationCall, keel721PresentationAbi, reviewKeel721URI } from "../packages/sdk/dist/keel721-presentation.js";
import { keelRouted721Abi } from "../packages/sdk/dist/abi.js";
import { parseAbi } from "viem";

const collection = "0x1111111111111111111111111111111111111111";
const module = "0x2222222222222222222222222222222222222222";
const store = "0x3333333333333333333333333333333333333333";
const objectId = `0x${"ab".repeat(32)}`;
const call = action => buildKeel721PresentationCall({ collection, module, action });

test("binds the module on the collection, then sends scoped image references to the shared module", () => {
  const bind = call({ kind: "bind-module" });
  assert.equal(bind.to, collection);
  assert.deepEqual(decodeFunctionData({ abi: parseAbi(keelRouted721Abi), data: bind.data }).args, [module]);
  const image = call({ kind: "image", store, objectId });
  assert.equal(image.to, module);
  assert.equal(image.value, 0n);
  assert.deepEqual(decodeFunctionData({ abi: keel721PresentationAbi, data: image.data }).args, [collection, 0n, store, objectId]);
});

test("supports standard templates, exact URIs and explicit KEEL fallback", () => {
  for (const prefix of ["ipfs://cid/", "ar://transaction/", "https://example.com/"]) {
    const result = call({ kind: "uri", tokenId: 7n, prefix, postfix: ".json" });
    assert.deepEqual(decodeFunctionData({ abi: keel721PresentationAbi, data: result.data }).args, [collection, 7n, prefix, ".json", true]);
  }
  const exact = call({ kind: "uri", prefix: "ar://transaction", appendTokenId: false });
  assert.deepEqual(decodeFunctionData({ abi: keel721PresentationAbi, data: exact.data }).args, [collection, 0n, "ar://transaction", "", false]);
  const fallback = call({ kind: "uri", prefix: "", appendTokenId: false });
  assert.deepEqual(decodeFunctionData({ abi: keel721PresentationAbi, data: fallback.data }).args, [collection, 0n, "", "", false]);
});

test("large URIs remain buildable and size advice counts UTF-8 bytes", () => {
  const large = "x".repeat(65_537);
  assert.ok(call({ kind: "uri", prefix: large }).data.length > large.length);
  assert.equal(reviewKeel721URI(large).warnings.length, 1);
  assert.equal(reviewKeel721URI(large, null).warnings.length, 0);
  assert.equal(reviewKeel721URI("é", 2).bytes, 2);
  assert.equal(reviewKeel721URI("é", 1).warnings.length, 1);
  assert.throws(() => reviewKeel721URI("", -1), /warningBytes/);
});

test("rejects invalid references and unsafe IDs without restricting image payload size", () => {
  assert.throws(() => call({ kind: "image", store, objectId: `0x${"00".repeat(32)}` }), /both/);
  assert.throws(() => call({ kind: "uri", tokenId: -1, prefix: "ipfs://x" }), /non-negative/);
  assert.throws(() => call({ kind: "image", store, objectId: "0x12" }), /bytes32/);
});

test('native media adapter encodes every actual module route and keeps primary and poster references separate',async()=>{
 const {buildKeelNativeMediaPresentationCall,keelNativeMediaPresentationAbi,KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES}=await import('../packages/sdk/dist/keel721-presentation.js');
 assert.deepEqual(KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES,['native-fallback','image-only-inline','media-with-poster-inline','embedded-program','direct-reference']);
 for(const [route,index] of KEEL_NATIVE_MEDIA_PRESENTATION_ROUTES.map((route,index)=>[route,index])){
  const source=index===0?undefined:{store,objectId};
  const result=buildKeelNativeMediaPresentationCall({collection,module,route,source,tokenId:7n});
  const decoded=decodeFunctionData({abi:keelNativeMediaPresentationAbi,data:result.data});
  assert.equal(decoded.functionName,'setNativeMediaSource');assert.deepEqual(decoded.args,[collection,7n,index,source?.store??'0x0000000000000000000000000000000000000000',source?.objectId??'0x'+'0'.repeat(64),false]);
  assert.equal(result.to,module);assert.equal(result.value,0n);assert.equal((result.data.length-2)/2,196);
 }
 const poster=call({kind:'image',store,objectId:'0x'+'cd'.repeat(32)});
 assert.notEqual(poster.data,buildKeelNativeMediaPresentationCall({collection,module,route:'media-with-poster-inline',source:{store,objectId}}).data);
 const omitted=buildKeelNativeMediaPresentationCall({collection,module,route:'embedded-program',source:{store,objectId},omitImage:true});
 assert.equal(decodeFunctionData({abi:keelNativeMediaPresentationAbi,data:omitted.data}).args[5],true);
});
test('native adapter cannot omit the image by accident, reuse an empty source or smuggle a fallback object',async()=>{
 const {buildKeelNativeMediaPresentationCall}=await import('../packages/sdk/dist/keel721-presentation.js');
 const base={collection,module,route:'image-only-inline',source:{store,objectId}};
 for(const change of [{route:'unknown'},{source:undefined},{omitImage:true},{route:'native-fallback'},{tokenId:-1},{module:'0x0000000000000000000000000000000000000000'},{source:{store,objectId:'0x12'}}])assert.throws(()=>buildKeelNativeMediaPresentationCall({...base,...change}));
 assert.throws(()=>buildKeelNativeMediaPresentationCall({...base,omitImage:'false'}),/explicit boolean/);
});

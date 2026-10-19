import test from 'node:test';
import assert from 'node:assert/strict';
import {assertKeelInlineBuildRoute,resolveKeelInlineBuildRoute} from '../packages/sdk/dist/index.js';
const resources=[{id:'game.html',bytes:Buffer.from('<script>game();</script>'.repeat(2000))}];
test('default compact compression cannot silently enter a legacy uncompressed collection',()=>{
 assert.equal(resolveKeelInlineBuildRoute({resources}).route,'creator-prepared-copy');
 assert.throws(()=>assertKeelInlineBuildRoute({resources,publicationPath:'legacy-collection-harness'}),/KEEL_INLINE_DELIVERY_PLAN_REQUIRED/);
 assert.equal(assertKeelInlineBuildRoute({resources,publicationPath:'creator-prepared-renderer'}).route,'creator-prepared-copy');
});
test('explicit Off and Raw preserve the legacy path without inventing compression or hybrid',()=>{
 for(const options of [{compression:'none'},{payloadStorage:'raw'}]){
  const plan=assertKeelInlineBuildRoute({resources,...options,publicationPath:'legacy-collection-harness'});
  assert.equal(plan.route,'legacy-uncompressed');assert.equal(plan.compressedBytes,resources[0].bytes.length);
  assert.equal(plan.requiresFullReadValidation,true);assert.deepEqual(plan.offchainPayloads,[]);
 }
 assert.throws(()=>resolveKeelInlineBuildRoute({resources,payloadStorage:'raw',compression:'brotli'}),/Raw/);
});


test('unavailable Inline gives actionable alternatives without confusing delivery and storage',()=>{
 try{assertKeelInlineBuildRoute({resources,publicationPath:'legacy-collection-harness'});assert.fail('requires a working delivery plan');}
 catch(error){assert.equal(error.code,'KEEL_INLINE_DELIVERY_PLAN_REQUIRED');
  const original=error.decision.alternatives.find(option=>option.route==='original-assisted-delivery');
  assert.equal(original.storagePlacement,'onchain');assert.equal(original.delivery,'hybrid');assert.equal(original.resourceBytes,'original');assert.equal(original.status,'requires-validation');
  assert.deepEqual(error.decision.offchainPayloads,[]);
 }
});

test('binary media selects beneficial lossless compression while explicit Off and Raw retain exact storage policy',()=>{
 const bytes=Buffer.alloc(735649);for(let i=0;i<bytes.length;i++)bytes[i]=(i*17+(i%31))%256;
 const resources=[{id:'original.gif',bytes}],before=Buffer.from(bytes);
 const plan=resolveKeelInlineBuildRoute({resources});
 assert.equal(plan.route,'creator-prepared-copy');assert.equal(plan.resources[0].compression,'brotli');
 assert.ok(plan.compressedBytes<plan.sourceBytes);assert.deepEqual(bytes,before);
 assert.throws(()=>assertKeelInlineBuildRoute({resources,publicationPath:'legacy-collection-harness'}),/KEEL_INLINE_DELIVERY_PLAN_REQUIRED/);
 for(const options of [{compression:'none'},{payloadStorage:'raw'}]) {
  const exact=assertKeelInlineBuildRoute({resources,...options,publicationPath:'legacy-collection-harness'});
  assert.equal(exact.resources[0].compression,'none');assert.equal(exact.compressedBytes,bytes.length);
 }
});

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

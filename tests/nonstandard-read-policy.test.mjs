import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createKeelExplicitNonstandardReadPolicy, keelNonstandardReadAcknowledgementKey,
  resolveKeelTokenURIReadBounds, resolveKeelTokenURIPreparationBounds,
  assertKeelNonstandardTokenURIIdentity, keelTokenURIRpcResponseBytes,
} from '../packages/protocol/dist/index.js';
import {auditKeelInlineTokenURI} from '../packages/sdk/dist/inline-transport-audit.js';
import {assessKeelCreatorPreparedInlineBudget} from '../packages/sdk/dist/creator-prepared-inline.js';

const hash=x=>'0x'+createHash('sha256').update(x).digest('hex');
const uri='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({
  name:'nonstandard fixture',description:'A'.repeat(2_000_001),
  animation_url:'data:text/html;charset=utf-8,'+encodeURIComponent('<html><body>same work</body></html>'),
  image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=',
}));
export function policyFor(tokenURI=uri) {
  const identity={chainId:31337,projectId:'project-1',revision:'source-1',defaultsRevision:'defaults-1',
    planDigest:hash('selected plan'),measurementDigest:hash('actual measured return'),sourceDigest:hash('source'),
    tokenUriDigest:hash(tokenURI),completeTokenUriBytes:Buffer.byteLength(tokenURI)};
  const limits={maximumTokenUriBytes:Buffer.byteLength(tokenURI),maximumRpcResponseBytes:keelTokenURIRpcResponseBytes(Buffer.byteLength(tokenURI)),maximumReadGas:'60000000'};
  return createKeelExplicitNonstandardReadPolicy({identity,limits,acknowledgementKey:keelNonstandardReadAcknowledgementKey({identity,limits})});
}
test('standard read bounds stay exactly 2M and 50M; ABI/padding/hex/JSON are counted independently',()=>{
  assert.deepEqual(resolveKeelTokenURIReadBounds(),{maximumTokenUriBytes:2_000_000,maximumRpcResponseBytes:4_004_224,maximumReadGas:50_000_000n});
  assert.equal(keelTokenURIRpcResponseBytes(2_000_001),4_004_288);
  assert.throws(()=>keelTokenURIRpcResponseBytes(Number.MAX_SAFE_INTEGER),/safe/);
});
test('only the exact acknowledged identity and physical bounds can authorize above-target inspection',async()=>{
  await assert.rejects(auditKeelInlineTokenURI(uri),/limit/);
  const policy=policyFor();
  const audit=await auditKeelInlineTokenURI(uri,{nonstandardReadPolicy:policy});
  assert.equal(audit.completeTokenURIBytes,Buffer.byteLength(uri));
  assert.equal(audit.tokenURIIntegrity.digest,hash(uri));
  assert.deepEqual(audit.nonstandardReadPolicy,policy);
  for(const field of ['projectId','revision','defaultsRevision','planDigest','measurementDigest','sourceDigest','tokenUriDigest','completeTokenUriBytes','chainId']){
    const stale=structuredClone(policy);
    stale.identity[field]=typeof stale.identity[field]==='number'?stale.identity[field]+1:stale.identity[field]+'1';
    assert.throws(()=>resolveKeelTokenURIReadBounds(stale),/invalid|exact|stale|positive|SHA|accommodate/);
  }
  assert.throws(()=>resolveKeelTokenURIReadBounds({...policy,unreviewed:true}),/fields/);
  for(const value of [NaN,Infinity,0,-1,2.5,Number.MAX_SAFE_INTEGER]){
    const invalid=structuredClone(policy);invalid.limits.maximumTokenUriBytes=value;
    assert.throws(()=>resolveKeelTokenURIReadBounds(invalid));
  }
  const tooSmall=structuredClone(policy);tooSmall.limits.maximumRpcResponseBytes=policy.identity.completeTokenUriBytes*2;
  assert.throws(()=>resolveKeelTokenURIReadBounds(tooSmall),/ABI/);
  assert.throws(()=>assertKeelNonstandardTokenURIIdentity(policy,{chainId:1,byteLength:Buffer.byteLength(uri),digest:hash(uri)}),/chain/);
  await assert.rejects(auditKeelInlineTokenURI(uri+' ',{nonstandardReadPolicy:policy}),/bound|limit/);
});
test('policy snapshots cannot be mutated during the first async digest and decoder limits remain separate',async()=>{
  const policy=structuredClone(policyFor()),pending=auditKeelInlineTokenURI(uri,{nonstandardReadPolicy:policy});
  policy.identity.revision='changed';policy.limits.maximumTokenUriBytes=1;
  const result=await pending;assert.equal(result.nonstandardReadPolicy.identity.revision,'source-1');
  const html='data:text/html;charset=utf-8,'+'x'.repeat(2_000_001);
  const largeHTML='data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify({animation_url:html,image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII='}));
  await assert.rejects(auditKeelInlineTokenURI(largeHTML,{nonstandardReadPolicy:policyFor(largeHTML)}),/inspection limit/);
});
test('unsigned budget permits preparation before final measurement and does not become read authority',()=>{
  const p=policyFor();
  const budget={schema:'keel-token-uri-preparation-budget@1',chainId:31337,projectId:'project-1',revision:'source-1',defaultsRevision:'defaults-1',sourceDigest:p.identity.sourceDigest,planDigest:p.identity.planDigest,maximumTokenUriBytes:3_000_000,maximumReadGas:'60000000'};
  assert.throws(()=>assessKeelCreatorPreparedInlineBudget(2_000_001),/limit/);
  assert.equal(assessKeelCreatorPreparedInlineBudget(2_000_001,undefined,budget).requiresCompleteRead,true);
  assert.equal(resolveKeelTokenURIPreparationBounds(budget).maximumTokenUriBytes,3_000_000);
  assert.throws(()=>resolveKeelTokenURIReadBounds(budget),/fields/);
  assert.throws(()=>resolveKeelTokenURIPreparationBounds({...budget,maximumTokenUriBytes:Infinity}));
});

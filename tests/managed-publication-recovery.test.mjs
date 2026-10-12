import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyKeelUnfundedPublicationRecovery as classify } from '../packages/sdk/dist/managed-publication.js';
const hash=`0x${'ab'.repeat(32)}`,planDigest=`0x${'cd'.repeat(32)}`,generation='saved-generation';
function input(){return {planDigest,generation,deadline:1791673827n,
  canonicalBlock:{number:11894657n,hash,timestamp:1791757080n},minimumRemainingLifetimeSeconds:300n,renewedLifetimeSeconds:86400n,
  issuance:{status:'never-issued',boundary:'keel-persist-before-approval@1',planDigest,generation},
  reconciliation:{status:'no-funded-job',planDigest,blockNumber:11894657n,blockHash:hash},
  activity:{transactionCount:0,completedChunks:0,completedOperations:0,paidFeeWei:0n}};}

test('observed expired Retro deadline renews only with separately certified never-issued evidence',()=>{
 const value=input(),before=structuredClone(value),result=classify(value);
 assert.deepEqual(result,{status:'refresh-unfunded-review',deadline:1791843480n,previousDeadline:1791673827n,fullSimulationRequired:true,approvalReady:false});
 assert.deepEqual(value,before);assert.equal(Object.isFrozen(result),true);
 // These dates reproduce the observed condition, not a claim that the actual
 // legacy Retro journal has the synthetic never-issued evidence used above.
 assert.equal(classify({...value,issuance:{status:'unknown'}}).status,'reconcile-approval');
});
test('minimum remaining lifetime and exact contract expiry boundary are explicit',()=>{
 const value=input(),now=value.canonicalBlock.timestamp;
 for(const deadline of [now-1n,now,now+300n])assert.equal(classify({...value,deadline}).status,'refresh-unfunded-review');
 assert.deepEqual(classify({...value,deadline:now+301n}),{status:'keep-saved-plan'});
});
test('missing hashes do not turn issued, pending or legacy unknown attempts into unissued evidence',()=>{
 for(const status of ['issued','pending','unknown'])assert.deepEqual(classify({...input(),issuance:{status}}),{status:'reconcile-approval',reason:'issuance-unknown'});
 for(const status of ['pending','unknown'])assert.deepEqual(classify({...input(),reconciliation:{status}}),{status:'reconcile-approval',reason:'chain-reconciliation-incomplete'});
});
test('expired funded jobs and recorded payment/progress are always preserved',()=>{
 assert.deepEqual(classify({...input(),reconciliation:{status:'funded'}}),{status:'preserve-funded-job'});
 assert.deepEqual(classify({...input(),activity:{...input().activity,jobId:'10'}}),{status:'preserve-funded-job'});
 for(const patch of [{approvalTransactionHash:hash},{transactionCount:1},{completedChunks:1},{completedOperations:1},{paidFeeWei:1n}])
  assert.deepEqual(classify({...input(),activity:{...input().activity,...patch}}),{status:'reconcile-approval',reason:'recorded-activity'});
});
test('stale plan, generation and canonical reconciliation identities cannot authorize renewal',()=>{
 for(const patch of [{generation:'old'},{planDigest:hash},{boundary:'unknown'}])assert.equal(classify({...input(),issuance:{...input().issuance,...patch}}).reason,'evidence-identity-mismatch');
 for(const patch of [{planDigest:hash},{blockHash:planDigest},{blockNumber:11894656n}])assert.equal(classify({...input(),reconciliation:{...input().reconciliation,...patch}}).reason,'evidence-identity-mismatch');
});
test('invalid TTL, overflow, negative counts and missing explicit evidence fail closed',()=>{
 for(const patch of [{renewedLifetimeSeconds:300n},{minimumRemainingLifetimeSeconds:-1n},{renewedLifetimeSeconds:1n<<64n},{deadline:0n},
  {canonicalBlock:{...input().canonicalBlock,timestamp:(1n<<64n)-1n}},{activity:{...input().activity,transactionCount:-1}},
  {activity:{...input().activity,paidFeeWei:-1n}}])assert.throws(()=>classify({...input(),...patch}),TypeError);
 assert.throws(()=>classify({...input(),issuance:undefined}),TypeError);
});

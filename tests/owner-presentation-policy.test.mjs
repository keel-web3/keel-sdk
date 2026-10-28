import test from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../packages/protocol/dist/index.js';
import { planKeelAssetPresentation } from '../packages/sdk/dist/presentation.js';
import { createKeelStudioDefaultProfile, resolveKeelBuildDefaults, assertKeelRetainedBuildDefaultsCurrent, resolveKeelRetainedBuildReadPolicy } from '../packages/sdk/dist/studio-project-defaults.js';
const digest='0x'+'ab'.repeat(32);
const caps={directAsset:'qualified',shellInline:'qualified',shellHybrid:'qualified',inlineImageTypes:['image/png'],identity:{chainId:31337,blockNumber:'1',blockHash:digest}};
const input=(size, extra={})=>({source:{resourceId:'original',mediaType:'image/png',byteLength:size,digest},execution:'static',sourceMotion:'still',capabilities:caps,...extra});
test('decimal original-image threshold keeps verification and visibly blocks an absent IPFS pointer',()=>{
 for(const size of [899999,900000,900001]) {
  const plan=p.planKeelSmartAssetPresentation(input(size));
  assert.equal(plan.viewer,'keel-verification-shell');
  assert.equal(plan.recommendedCandidateId,size>900000?'external-preview-inline':'canonical-inline');
  if(size>900000){assert.equal(plan.fallbackDelivery,'ipfs');assert.equal(plan.image.uri,null);assert.ok(plan.blockers.includes('explicit-external-preview-url-required'));}
 }
 const video=p.planKeelSmartAssetPresentation(input(900001,{source:{resourceId:'clip',mediaType:'video/mp4',byteLength:900001,digest}}));
 assert.equal(video.recommendedCandidateId,'canonical-inline');
});
test('exact IPFS preview and explicit onchain/no-shell overrides survive automatic policy',()=>{
 const plan=p.planKeelSmartAssetPresentation(input(900001,{externalPreviewUri:'ipfs://bafyfixture/preview.webp'}));
 assert.equal(plan.image.uri,'ipfs://bafyfixture/preview.webp');assert.equal(plan.animation.delivery,'inline-shell');
 assert.equal(plan.selectedCandidateId,'external-preview-inline');assert.equal(plan.hardBlockers.length,0, 'qualified adapter and supplied exact preview select the default plan, not only a suggestion');
 for(const size of [899999,900000,900001]) assert.equal(p.planKeelSmartAssetPresentation(input(size,{externalPreviewUri:'ipfs://bafyfixture/preview.webp'})).selectedCandidateId,size>900000?'external-preview-inline':'canonical-inline');
 for(const id of ['canonical-inline','image-only-inline']) {
  const explicit=p.planKeelSmartAssetPresentation(input(900001,{selection:p.resolveKeelAssetPresentationSelection(id,'image/png')}));
  assert.equal(explicit.selectedCandidateId,id);assert.equal(explicit.selectionSource,'explicit');
 }
});
test('full-call measured gas recommends Hybrid at 50M independently of size and honors explicit delivery',()=>{
 for(const gas of [49999999n,50000000n,50000001n]) {
  const plan=p.planKeelSmartAssetPresentation(input(100,{measurements:{readGas:gas}}));
  assert.equal(plan.recommendedCandidateId,gas>=50000000n?'canonical-hybrid':'canonical-inline');
  const simple=planKeelAssetPresentation({originalByteLength:100,compressedByteLength:100,tokenUriByteLength:100,readGas:gas,hybridQualified:true});
  assert.equal(simple.automaticMode,gas>=50000000n?'hybrid':'inline');
 }
 assert.equal(planKeelAssetPresentation({originalByteLength:100,compressedByteLength:100,tokenUriByteLength:100,readGas:50000000n}).automaticMode,'inline');
 const unavailable=p.planKeelSmartAssetPresentation(input(100,{measurements:{readGas:50000000n},capabilities:{...caps,shellHybrid:'unsupported'}}));
 assert.equal(unavailable.selectedCandidateId,'canonical-inline');assert.equal(unavailable.status,'compatibility-review-required');
 assert.ok(unavailable.suggestions.some(x=>x.code==='hybrid-unavailable-review-explicit-bounded-keel-read'));
 assert.ok(!unavailable.suggestions.some(x=>x.code==='complete-read-at-or-above-50m-review-qualified-hybrid'));
 const qualified=p.planKeelSmartAssetPresentation(input(100,{measurements:{readGas:50000000n}}));
 assert.ok(qualified.suggestions.some(x=>x.candidateId==='canonical-hybrid' && x.code==='complete-read-at-or-above-50m-review-qualified-hybrid'));
 const explicit=p.planKeelSmartAssetPresentation(input(100,{measurements:{readGas:50000000n},selection:p.resolveKeelAssetPresentationSelection('canonical-inline','image/png')}));
 assert.equal(explicit.selectedCandidateId,'canonical-inline');assert.equal(explicit.status,'compatibility-review-required');
});
test('fresh read defaults are 50M while retained legacy snapshots remain byte-for-byte authoritative',()=>{
 const profile=createKeelStudioDefaultProfile();
 assert.equal(resolveKeelBuildDefaults(profile).values.maxReadGas,undefined, "preserve historical policy object identity; read bounds own fresh defaults");
 const old=structuredClone(resolveKeelBuildDefaults(profile));delete old.values.maxReadGas;delete old.sources.maxReadGas;
 const before=JSON.stringify(old);
 assertKeelRetainedBuildDefaultsCurrent(profile,{retained:old});assert.equal(JSON.stringify(old),before);
 assert.equal(resolveKeelRetainedBuildReadPolicy(profile,{retained:old}).readLimits.maxReadGas,60000000);
 assert.equal(resolveKeelRetainedBuildReadPolicy(profile).readLimits.maxReadGas,50000000);
 assert.equal(p.resolveKeelTokenURIReadBounds().maximumReadGas,50000000n);
});
test('gas-only nonstandard reads require exact measured URI identity and explicit acknowledgement',()=>{
 const identity={chainId:31337,projectId:'art',revision:'1',defaultsRevision:'1',planDigest:digest,measurementDigest:digest,sourceDigest:digest,tokenUriDigest:digest,completeTokenUriBytes:100};
 const limits={maximumTokenUriBytes:100,maximumRpcResponseBytes:p.keelTokenURIRpcResponseBytes(100),maximumReadGas:'60000000'};
 const acknowledgementKey=p.keelNonstandardReadAcknowledgementKey({identity,limits});
 const policy=p.createKeelExplicitNonstandardReadPolicy({identity,limits,acknowledgementKey});
 assert.equal(p.resolveKeelTokenURIReadBounds(policy).maximumReadGas,60000000n);
 assert.throws(()=>p.createKeelExplicitNonstandardReadPolicy({identity:{...identity,revision:'2'},limits,acknowledgementKey}),/stale/);
});

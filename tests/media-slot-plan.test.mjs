import test from 'node:test';import assert from 'node:assert/strict';
import {planKeelMediaSlots,assertKeelMediaSlotReadFit} from '../packages/builder/dist/media-slot-plan.js';
const input={sourceResourceId:'source',mediaType:'image/gif',sourceByteLength:1_000_001};
test('original images and GIF use only image without changing source or adding shell',()=>{for(const mediaType of ['image/gif','image/png','image/jpeg']){const p=planKeelMediaSlots({...input,mediaType});assert.equal(p.image.resourceId,'source');assert.equal(p.animation_url,null);assert.equal(p.viewer,'none');}});
test('small WebP and AVIF default to shell animation with no duplicate full-size image',()=>{for(const mediaType of ['image/webp','image/avif']){const p=planKeelMediaSlots({...input,mediaType,sourceByteLength:500_000});assert.equal(p.image,null);assert.equal(p.animation_url.presentation,'keel-shell');assert.equal(p.viewer,'keel-verification-shell');}});
test('explicit candidate changes animation resource only and thumbnail is separately configured',()=>{const p=planKeelMediaSlots({...input,selectedCandidateResourceId:'edited',thumbnailResourceId:'thumb'});assert.equal(p.image.resourceId,'thumb');assert.equal(p.animation_url.resourceId,'edited');assert.throws(()=>planKeelMediaSlots({...input,thumbnailResourceId:'source'}),/separately/);});
test('defaults filter asset and collection; independent explicit delivery choices win',()=>{const p=planKeelMediaSlots({...input,mediaType:'image/webp',sourceByteLength:10,collectionType:'erc1155',thumbnailResourceId:'thumb',defaults:[{imageDelivery:'hosted',animationDelivery:'hosted'},{mediaType:'image/webp',imageDelivery:'ipfs',animationDelivery:'ipfs'},{mediaType:'image/gif',animationDelivery:'onchain'},{mediaType:'image/webp',sourceByteLength:10,collectionType:'erc1155',animationDelivery:'onchain'}],explicit:{image:{resourceId:'custom',presentation:'direct',delivery:'hosted'}}});assert.equal(p.image.delivery,'hosted');assert.equal(p.animation_url.delivery,'onchain');});
test('both slots require explicit selection and exact complete read proof',()=>{const p=planKeelMediaSlots({...input,mediaType:'image/webp',sourceByteLength:10,explicit:{image:{resourceId:'source',presentation:'direct',delivery:'onchain'}}});assert.equal(p.duplicateSourceInBothSlots,true);assert.throws(()=>assertKeelMediaSlotReadFit(p,{planKey:p.planKey,completeTokenUriBytes:2000001,maxTokenUriBytes:2000000,selectedChainReadPassed:true}),/complete metadata/);assert.throws(()=>assertKeelMediaSlotReadFit(p,{planKey:'old',completeTokenUriBytes:10,maxTokenUriBytes:2000000,selectedChainReadPassed:true}),/complete metadata/);assertKeelMediaSlotReadFit(p,{planKey:p.planKey,completeTokenUriBytes:100,maxTokenUriBytes:2000000,selectedChainReadPassed:true});});

test('decimal 500KB and 2MB asset recommendations apply to image formats while unknown lengths retain verification',()=>{
 for(const mediaType of ['image/gif','image/png','image/jpeg','image/webp','image/avif']){
  for(const sourceByteLength of [undefined,1,499999,500000]){
   const p=planKeelMediaSlots({sourceResourceId:'source',mediaType,sourceByteLength});
   assert.equal(p.viewer,'keel-verification-shell');assert.equal(p.animation_url.resourceId,'source');assert.equal(p.image,null);
  }
  for(const sourceByteLength of [500001,999999,1000000,1000001,2000000]) {
   const direct=planKeelMediaSlots({sourceResourceId:'source',mediaType,sourceByteLength});
   assert.equal(direct.viewer,'none');assert.equal(direct.image.resourceId,'source');assert.equal(direct.animation_url,null);
  }
  const split=planKeelMediaSlots({sourceResourceId:'source',mediaType,sourceByteLength:2000001});
  assert.equal(split.viewer,'keel-verification-shell');assert.equal(split.animation_url.resourceId,'source');
 }
});
test('collector images never silently switch to hosted by size and explicit delivery still wins',()=>{
 for(const sourceByteLength of [100,4000001])for(const thumbnailByteLength of [499999,500000,1000000]){
  const base={sourceResourceId:'work',mediaType:'text/javascript',sourceByteLength,thumbnailResourceId:'preview',thumbnailByteLength};
  const p=planKeelMediaSlots(base);assert.equal(p.image.delivery,'onchain');assert.equal(p.animation_url.delivery,'onchain');
  const explicit=planKeelMediaSlots({...base,explicit:{image:{resourceId:'preview',presentation:'direct',delivery:'onchain'}}});
  assert.equal(explicit.image.delivery,'onchain');assert.equal(explicit.animation_url.resourceId,'work');
 }
 assert.throws(()=>planKeelMediaSlots({...input,sourceByteLength:-1}),/byte length/);
 assert.throws(()=>planKeelMediaSlots({...input,thumbnailResourceId:'preview',thumbnailByteLength:NaN}),/byte length/);
});

test('a permissive caller limit cannot label a greater-than-2MB full initial tokenURI as standard compatible',()=>{
 const plan=planKeelMediaSlots({...input,sourceByteLength:1});
 assertKeelMediaSlotReadFit(plan,{planKey:plan.planKey,completeTokenUriBytes:2000000,maxTokenUriBytes:3000000,selectedChainReadPassed:true});
 assert.throws(()=>assertKeelMediaSlotReadFit(plan,{planKey:plan.planKey,completeTokenUriBytes:2000001,maxTokenUriBytes:3000000,selectedChainReadPassed:true}),/nonstandard route.*marketplace compatibility/);
});

test('SVG without actual source inspection retains verification; explicit direct slots remain explicit',()=>{
 const p=planKeelMediaSlots({...input,mediaType:'image/svg+xml'});assert.equal(p.viewer,'keel-verification-shell');assert.equal(p.image,null);assert.equal(p.animation_url.resourceId,'source');
 const direct=planKeelMediaSlots({...input,mediaType:'image/svg+xml',explicit:{image:{resourceId:'source',presentation:'direct',delivery:'onchain'},animation_url:null}});assert.equal(direct.viewer,'none');assert.equal(direct.image.resourceId,'source');assert.equal(direct.animation_url,null);
});

test('explicit above-target slot gate binds actual matrix, source, revisions and full return without changing standard guard',async()=>{
 const {createKeelExplicitNonstandardReadPolicy,keelNonstandardReadAcknowledgementKey,keelTokenURIRpcResponseBytes,sha256Hex,planKeelSmartAssetPresentation,measureKeelSmartAssetPresentation,hashKeelSmartAssetPresentationPlan}=await import('../packages/protocol/dist/index.js');
 const {assertKeelNonstandardMediaSlotReadFit}=await import('../packages/builder/dist/media-slot-plan.js');
 const bytes=new TextEncoder().encode('<svg/>'),digest=await sha256Hex(bytes);
 const publication=planKeelSmartAssetPresentation({contextIdentity:{projectId:'project',revision:'1',defaultsRevision:'2'},source:{resourceId:'source',mediaType:'image/svg+xml',byteLength:bytes.length,digest},execution:'static',selection:{image:'inline',animation:'omitted'},nonstandardCompatibilityAcknowledged:true,capabilities:{directAsset:'qualified',shellInline:'qualified',shellHybrid:'qualified',identity:{chainId:31337,blockNumber:'1',blockHash:'0x'+'1'.repeat(64)}}});
 const image='data:image/svg+xml;base64,'+Buffer.from(bytes).toString('base64');
 const uri='data:application/json,'+encodeURIComponent(JSON.stringify({image,description:'x'.repeat(2_000_000)}));
 const measured=await measureKeelSmartAssetPresentation(publication,()=>uri);
 assert.deepEqual(measured.hardBlockers,[]);
 const identity={chainId:31337,projectId:'project',revision:'1',defaultsRevision:'2',sourceDigest:digest,planDigest:await hashKeelSmartAssetPresentationPlan(publication),measurementDigest:await sha256Hex(new TextEncoder().encode(measured.measurementKey)),tokenUriDigest:measured.tokenUriDigest,completeTokenUriBytes:measured.completeTokenUriBytes};
 const limits={maximumTokenUriBytes:measured.completeTokenUriBytes,maximumRpcResponseBytes:keelTokenURIRpcResponseBytes(measured.completeTokenUriBytes),maximumReadGas:'60000000'};
 const policy=createKeelExplicitNonstandardReadPolicy({identity,limits,acknowledgementKey:keelNonstandardReadAcknowledgementKey({identity,limits})});
 const slots=planKeelMediaSlots({sourceResourceId:'source',mediaType:'image/svg+xml',sourceByteLength:bytes.length,explicit:{image:{resourceId:'source',presentation:'direct',delivery:'onchain'},animation_url:null}});
 const evidence={planKey:slots.planKey,publicationPlan:publication,tokenURI:uri,selectedChainReadPassed:true,nonstandardReadPolicy:policy};
 await assertKeelNonstandardMediaSlotReadFit(slots,evidence);
 assert.throws(()=>assertKeelMediaSlotReadFit(slots,{planKey:slots.planKey,completeTokenUriBytes:measured.completeTokenUriBytes,maxTokenUriBytes:measured.completeTokenUriBytes,selectedChainReadPassed:true}),/nonstandard route/);
 await assert.rejects(assertKeelNonstandardMediaSlotReadFit(slots,{...evidence,tokenURI:uri+' '}),/measurement|commitment/);
 await assert.rejects(assertKeelNonstandardMediaSlotReadFit(slots,{...evidence,selectedChainReadPassed:false}),/selected-chain/);
 const different=planKeelMediaSlots({sourceResourceId:'other',mediaType:'image/svg+xml',explicit:{image:{resourceId:'other',presentation:'direct',delivery:'onchain'},animation_url:null}});
 await assert.rejects(assertKeelNonstandardMediaSlotReadFit(different,{...evidence,planKey:different.planKey}),/contradict/);
 for(const field of ['revision','sourceDigest','measurementDigest','planDigest','chainId']) {
  const changed=structuredClone(identity);changed[field]=field==='chainId'?1:field==='revision'?'changed':'0x'+'2'.repeat(64);
  const stale=createKeelExplicitNonstandardReadPolicy({identity:changed,limits,acknowledgementKey:keelNonstandardReadAcknowledgementKey({identity:changed,limits})});
  await assert.rejects(assertKeelNonstandardMediaSlotReadFit(slots,{...evidence,nonstandardReadPolicy:stale}),/stale|different/);
 }
 const mutable=structuredClone(evidence),pending=assertKeelNonstandardMediaSlotReadFit(slots,mutable);mutable.tokenURI='changed';mutable.nonstandardReadPolicy.identity.revision='changed';await pending;
 const publicExports=await import('../packages/sdk/dist/presentation.js');
 assert.equal(publicExports.createKeelExplicitNonstandardReadPolicy,createKeelExplicitNonstandardReadPolicy);
 assert.equal(typeof publicExports.resolveKeelTokenURIPreparationBounds,'function');
});

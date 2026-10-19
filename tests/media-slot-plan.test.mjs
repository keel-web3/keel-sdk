import test from 'node:test';import assert from 'node:assert/strict';
import {planKeelMediaSlots,assertKeelMediaSlotReadFit} from '../packages/builder/dist/media-slot-plan.js';
const input={sourceResourceId:'source',mediaType:'image/gif',sourceByteLength:1_000_001};
test('original images and GIF use only image without changing source or adding shell',()=>{for(const mediaType of ['image/gif','image/png','image/jpeg','image/svg+xml']){const p=planKeelMediaSlots({...input,mediaType});assert.equal(p.image.resourceId,'source');assert.equal(p.animation_url,null);assert.equal(p.viewer,'none');}});
test('small WebP and AVIF default to shell animation with no duplicate full-size image',()=>{for(const mediaType of ['image/webp','image/avif']){const p=planKeelMediaSlots({...input,mediaType,sourceByteLength:500_000});assert.equal(p.image,null);assert.equal(p.animation_url.presentation,'keel-shell');assert.equal(p.viewer,'keel-verification-shell');}});
test('explicit candidate changes animation resource only and thumbnail is separately configured',()=>{const p=planKeelMediaSlots({...input,selectedCandidateResourceId:'edited',thumbnailResourceId:'thumb'});assert.equal(p.image.resourceId,'thumb');assert.equal(p.animation_url.resourceId,'edited');assert.throws(()=>planKeelMediaSlots({...input,thumbnailResourceId:'source'}),/separately/);});
test('defaults filter asset and collection; independent explicit delivery choices win',()=>{const p=planKeelMediaSlots({...input,mediaType:'image/webp',sourceByteLength:10,collectionType:'erc1155',thumbnailResourceId:'thumb',defaults:[{imageDelivery:'hosted',animationDelivery:'hosted'},{mediaType:'image/webp',imageDelivery:'ipfs',animationDelivery:'ipfs'},{mediaType:'image/gif',animationDelivery:'onchain'},{mediaType:'image/webp',sourceByteLength:10,collectionType:'erc1155',animationDelivery:'onchain'}],explicit:{image:{resourceId:'custom',presentation:'direct',delivery:'hosted'}}});assert.equal(p.image.delivery,'hosted');assert.equal(p.animation_url.delivery,'onchain');});
test('both slots require explicit selection and exact complete read proof',()=>{const p=planKeelMediaSlots({...input,mediaType:'image/webp',sourceByteLength:10,explicit:{image:{resourceId:'source',presentation:'direct',delivery:'onchain'}}});assert.equal(p.duplicateSourceInBothSlots,true);assert.throws(()=>assertKeelMediaSlotReadFit(p,{planKey:p.planKey,completeTokenUriBytes:2000001,maxTokenUriBytes:2000000,selectedChainReadPassed:true}),/complete metadata/);assert.throws(()=>assertKeelMediaSlotReadFit(p,{planKey:'old',completeTokenUriBytes:10,maxTokenUriBytes:2000000,selectedChainReadPassed:true}),/complete metadata/);assertKeelMediaSlotReadFit(p,{planKey:p.planKey,completeTokenUriBytes:100,maxTokenUriBytes:2000000,selectedChainReadPassed:true});});

test('the 1MB viewer boundary applies to every image format and unknown lengths retain verification',()=>{
 for(const mediaType of ['image/gif','image/png','image/jpeg','image/webp','image/avif']){
  for(const sourceByteLength of [undefined,1,999999,1000000]){
   const p=planKeelMediaSlots({sourceResourceId:'source',mediaType,sourceByteLength});
   assert.equal(p.viewer,'keel-verification-shell');assert.equal(p.animation_url.resourceId,'source');assert.equal(p.image,null);
  }
  const large=planKeelMediaSlots({sourceResourceId:'source',mediaType,sourceByteLength:1000001});
  assert.equal(large.viewer,'none');assert.equal(large.image.resourceId,'source');assert.equal(large.animation_url,null);
 }
});
test('500KB to 1MB collector images default to hosted independently of full artwork size and explicit delivery wins',()=>{
 for(const sourceByteLength of [100,4000001])for(const thumbnailByteLength of [499999,500000,1000000]){
  const base={sourceResourceId:'work',mediaType:'text/javascript',sourceByteLength,thumbnailResourceId:'preview',thumbnailByteLength};
  const p=planKeelMediaSlots(base);assert.equal(p.image.delivery,thumbnailByteLength<500000?'onchain':'hosted');assert.equal(p.animation_url.delivery,'onchain');
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

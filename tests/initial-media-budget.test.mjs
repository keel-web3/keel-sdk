import test from 'node:test';
import assert from 'node:assert/strict';
import {planKeelInitialMediaBudget} from '../packages/builder/dist/media-slot-plan.js';
const data=(mime,bytes)=>`data:${mime};base64,${Buffer.alloc(bytes,65).toString('base64')}`;
const render=({image,animation})=>'data:application/json;base64,'+Buffer.from(JSON.stringify({name:'Combined budget 🖼',...(image===null?{}:{image}),...(animation===null?{}:{animation_url:animation})})).toString('base64');
const hybrid='data:text/html;base64,'+Buffer.from('<!doctype html><title>Existing registered script shell</title>').toString('base64');

test('automatic combined budget allocates image first and uses the existing script shell only when the complete return exceeds2MB',async()=>{
 const image=data('image/png',1_000_000),animation=data('text/html',500_000),input={image,animation,animationKind:'script',hybridAnimation:hybrid,renderTokenURI:render};
 const before={image,animation};assert.ok(Buffer.byteLength(render(before))>2_000_000);
 const plan=await planKeelInitialMediaBudget(input);
 assert.equal(plan.decision,'hybrid');assert.equal(plan.image,image);assert.equal(plan.animation,hybrid);
 assert.equal(plan.tokenURI,render({image,animation:hybrid}));assert.ok(plan.completeTokenUriBytes<=2_000_000);
 assert.equal(plan.imageOnlyTokenUriBytes,Buffer.byteLength(render({image,animation:null})));
 assert.equal(plan.remainingInitialResponseBytes,2_000_000-plan.imageOnlyTokenUriBytes);
 assert.equal(plan.publicationReady,false);assert.equal(plan.requiresSelectedChainRead,true);assert.equal(input.animation,animation);
});
test('explicit Inline is retained with prominent compatibility review instead of silently changing presentation',async()=>{
 const image=data('image/png',1_000_000),animation=data('text/html',500_000);
 const plan=await planKeelInitialMediaBudget({image,animation,animationKind:'script',animationSelection:'inline',hybridAnimation:hybrid,renderTokenURI:render});
 assert.equal(plan.decision,'nonstandard-review-required');assert.equal(plan.animation,animation);assert.equal(plan.standardCompatible,false);
 assert.match(plan.marketplaceWarning,/Marketplaces and wallets may fail.*supported nonstandard route.*explicit compatibility acknowledgement.*selected-chain read/);
 assert.equal(plan.publicationReady,false);
});
test('binary media cannot silently acquire a script hybrid route and an over-budget image is never removed',async()=>{
 for(const mime of ['image/gif','video/mp4','image/png']){
  const animation=data(mime,2_000_000),plan=await planKeelInitialMediaBudget({image:data('image/png',50),animation,animationKind:'embedded-media',hybridAnimation:hybrid,renderTokenURI:render});
  assert.equal(plan.decision,'nonstandard-review-required');assert.equal(plan.animation,animation);assert.equal(plan.standardCompatible,false);
 }
 const image=data('image/png',2_000_000),plan=await planKeelInitialMediaBudget({image,animation:'data:text/html,small',animationKind:'script',hybridAnimation:hybrid,renderTokenURI:render});
 assert.equal(plan.decision,'image-over-budget');assert.equal(plan.image,image);assert.equal(plan.remainingInitialResponseBytes,0);
 await assert.rejects(planKeelInitialMediaBudget({image:'data:image/png,small',animation:'data:video/mp4,small',animationKind:'embedded-media',animationSelection:'hybrid',hybridAnimation:hybrid,renderTokenURI:render}),/supported registered script hybrid shell/);
});
test('the measured complete serialization owns the exact boundary and explicit Hybrid survives below it',async()=>{
 for(const bytes of [499999,500000,999999,1000000]){
  const image=data('image/png',bytes);let lo=0,hi=2_000_000;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(Buffer.byteLength(render({image,animation:data('text/html',mid)}))<=2_000_000)lo=mid;else hi=mid-1;}
  const fits=await planKeelInitialMediaBudget({image,animation:data('text/html',lo),animationKind:'script',hybridAnimation:hybrid,renderTokenURI:render});
  const over=await planKeelInitialMediaBudget({image,animation:data('text/html',lo+1),animationKind:'script',hybridAnimation:hybrid,renderTokenURI:render});
  assert.equal(fits.decision,'inline');assert.ok(fits.completeTokenUriBytes>=1_999_980);assert.equal(over.decision,'hybrid');assert.equal(over.image,image);
 }
 const plan=await planKeelInitialMediaBudget({image:'data:image/png,x',animation:'data:text/html,x',animationKind:'script',animationSelection:'hybrid',hybridAnimation:hybrid,renderTokenURI:render});
 assert.equal(plan.decision,'hybrid');assert.equal(plan.animation,hybrid);
});
test('size hints cannot replace complete JSON measurement and asynchronous input mutations cannot change the selected slots',async()=>{
 await assert.rejects(planKeelInitialMediaBudget({image:null,animation:'x',animationKind:'script',renderTokenURI:()=> 'ipfs://unmeasured'}),/complete JSON metadata/);
 let release;const entered=new Promise(resolve=>{release=resolve;});let first=true;
 const input={image:'data:image/png,original',animation:'data:text/html,original',animationKind:'script',renderTokenURI:async slots=>{if(first){first=false;await entered;}return render(slots);}};
 const run=planKeelInitialMediaBudget(input);input.image='data:image/png,changed';input.animation='changed';release();
 const plan=await run;assert.equal(plan.image,'data:image/png,original');assert.equal(plan.animation,'data:text/html,original');
});

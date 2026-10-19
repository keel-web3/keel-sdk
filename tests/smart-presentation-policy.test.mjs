import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as p from '../packages/protocol/dist/index.js';
const digest = bytes => '0x'+createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=', 'base64');
const image = {resourceId:'preview',mediaType:'image/png',byteLength:png.length,digest:digest(png)};
const hash = n => '0x'+n.repeat(64), address=n=>'0x'+n.repeat(40);
const capabilities = {directAsset:'qualified',shellInline:'qualified',shellHybrid:'qualified',externalPresentation:'qualified',identity:{chainId:11155111,blockNumber:'11949136',blockHash:hash('1'),factory:address('2'),creationCodeHash:hash('3'),reader:address('4'),runtimeCodeHash:hash('5')}};
const input = (size=100) => ({source:{resourceId:'original.gif',mediaType:'image/gif',byteLength:size,digest:hash('a')},preview:image,execution:'static',capabilities,contextIdentity:{projectId:'project',revision:'1',defaultsRevision:'0'}});
const choose=(x,selection)=>p.planKeelSmartAssetPresentation({...x,selection});
const hybrid = {image:'inline',animation:'hybrid-shell'};
const jsonURI = value => 'data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(value));
const imageURI='data:image/png;base64,'+png.toString('base64');
const htmlURI=html=>'data:text/html;charset=utf-8,'+encodeURIComponent(html);
const render = (extra={}) => jsonURI({name:'Exact 🌊',image:imageURI,animation_url:htmlURI('<!doctype html><p>exact verifier program</p>'),...extra});

test('actual decimal thresholds use above, with source and metadata boundaries separate',()=>{
 assert.equal(p.KEEL_SMART_INLINE_ASSET_MAX_BYTES,500000);assert.equal(p.KEEL_SMART_SPLIT_ASSET_THRESHOLD_BYTES,2000000);
 for(const n of [499999,500000])assert.equal(p.planKeelSmartAssetPresentation(input(n)).selectedCandidateId,'canonical-inline');
 for(const n of [500001,1999999,2000000])assert.equal(p.planKeelSmartAssetPresentation(input(n)).selectedCandidateId,'direct-onchain-asset');
 assert.equal(p.planKeelSmartAssetPresentation(input(2000001)).selectedCandidateId,'canonical-hybrid');
});
test('matrix exposes maintained alternatives and never calls a local numeric estimate chain-ready',()=>{
 const plan=p.planKeelSmartAssetPresentation(input());assert.equal(plan.candidates.length,9);assert.equal(plan.publicationReady,false);
 for(const c of plan.candidates){assert.equal(c.publicationReady,false);assert.equal(c.measurementBasis,'provisional-local-measurements');assert.equal(c.measurementComplete,false);assert.equal(c.standardsCompatible,null);}
});
test('real prefix/cap arithmetic rejects old duplication and chooses another qualified layout',()=>{
 const x={...input(130296),measurements:{prefixBytes:256001,suffixBytes:2042,maxEnvelopeBytes:32768,literalMediaPrefixBytes:255863}};
 assert.equal(p.planKeelSmartAssetPresentation(x).selectedCandidateId,'canonical-hybrid');
 const direct=p.planKeelSmartAssetPresentation({...x,capabilities:{...capabilities,shellHybrid:'unsupported'}});assert.equal(direct.selectedCandidateId,'direct-onchain-asset');
 assert.ok(direct.candidates[0].hardBlockers.includes('deployed-envelope-limit'));
 assert.equal(p.planKeelSmartAssetPresentation({...x,measurements:{prefixBytes:100,suffixBytes:100,maxEnvelopeBytes:32768,literalMediaPrefixBytes:0}}).selectedCandidateId,'canonical-inline');
 assert.equal(direct.source.byteLength,130296);assert.deepEqual(direct.preview,image);
});
test('explicit layout remains selected even when a different layout is recommended',()=>{
 const plan=choose(input(1000000),hybrid);assert.equal(plan.selectedCandidateId,'canonical-hybrid');assert.equal(plan.selectionSource,'explicit');assert.equal(plan.recommendedCandidateId,'direct-onchain-asset');
});
test('scripts always require a registered verifier and script MIME overrides a static caller label',()=>{
 const x={...input(1000000),source:{...input().source,mediaType:'text/javascript'},execution:'static'};
 const plan=choose(x,{image:'inline',animation:'omitted'});assert.ok(plan.hardBlockers.includes('script-requires-registered-verifier'));assert.equal(plan.status,'blocked');
 assert.equal(p.planKeelSmartAssetPresentation(x).viewer,'keel-verification-shell');
});
test('actual inspection catches MIME lies, active SVG and undecidable PDF without claiming security approval',()=>{
 for(const [mime,text] of [['image/gif','<!doctype html><script>x()</script>'],['image/svg+xml','<svg onload="x()"/>'],['image/svg+xml','<svg><script>x()</script></svg>']])assert.equal(p.classifyKeelAssetExecution({mediaType:mime,bytes:Buffer.from(text)}),'script');
 assert.equal(p.classifyKeelAssetExecution({mediaType:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')}),'static');
 assert.equal(p.classifyKeelAssetExecution({mediaType:'application/pdf',bytes:Buffer.from('%PDF safe prefix'+' '.repeat(70000)+'/JavaScript')}),'unknown');
 assert.equal(p.classifyKeelAssetExecution({mediaType:'application/octet-stream',bytes:Buffer.from([1,2,3])}),'unknown');
 assert.equal(p.classifyKeelAssetExecution({mediaType:'image/png',bytes:png}),'static');
});
test('all non-script media use same size policy and direct playback retains a separate usable poster',()=>{
 for(const mediaType of ['video/mp4','audio/mpeg','model/gltf-binary','application/pdf','text/plain']){
  const x={...input(500001),source:{...input(500001).source,mediaType}};const plan=p.planKeelSmartAssetPresentation(x);
  assert.equal(plan.selectedCandidateId,'direct-onchain-asset');assert.equal(plan.animation.delivery,'onchain-reference');assert.equal(plan.image.resourceId,'preview');assert.equal(plan.status,'requires-validation');
  const missing=p.planKeelSmartAssetPresentation({...x,preview:undefined});assert.equal(missing.status,'blocked');assert.ok(missing.hardBlockers.includes('usable-grid-image-required'));
 }
});
test('missing and unsupported actual capabilities stay blocked, regardless of defaults',()=>{
 const plan=p.planKeelSmartAssetPresentation({...input(),capabilities:undefined});assert.equal(plan.status,'blocked');
 const explicit=choose({...input(),capabilities:{...capabilities,shellHybrid:'unknown'}},hybrid);assert.equal(explicit.status,'blocked');
});
test('nonstandard size is a compatibility review and exact actual output ceilings remain hard',()=>{
 const x={...input(),candidateMeasurements:{'canonical-hybrid':{completeTokenUriBytes:2000001,imageUriBytes:1750001,encodedImageSlotBytes:1750001,maximumTokenUriBytes:3000000}}};
 const review=choose(x,hybrid);assert.equal(review.status,'compatibility-review-required');assert.equal(review.hardBlockers.length,0);
 const accepted=choose({...x,nonstandardCompatibilityAcknowledged:true},hybrid);assert.equal(accepted.status,'requires-validation');assert.equal(accepted.standardsCompatible,false);
 const blocked=choose({...x,nonstandardCompatibilityAcknowledged:true,candidateMeasurements:{'canonical-hybrid':{completeTokenUriBytes:2000001,maximumTokenUriBytes:2000000}}},hybrid);assert.equal(blocked.status,'blocked');assert.ok(blocked.hardBlockers.includes('actual-reader-output-limit'));
});
test('execution/state/read limits cannot be acknowledged away',()=>{
 for(const [a,b,code] of [['executionGas','maxExecutionGas','transaction-execution-limit'],['stateGas','maxStateGas','transaction-state-limit'],['readGas','maxReadGas','public-read-limit']]){
  const plan=choose({...input(),nonstandardCompatibilityAcknowledged:true,candidateMeasurements:{'canonical-hybrid':{[a]:101n,[b]:100n}}},hybrid);assert.ok(plan.hardBlockers.includes(code));
 }
});
test('external preview is explicit HTTPS/IPFS and does not become the source commitment',()=>{
 const x={...input(),assetPresentation:'external-preview',externalPreviewUri:'https://media.example/preview.png'};const plan=p.planKeelSmartAssetPresentation(x);
 assert.equal(plan.image.delivery,'external');assert.equal(plan.image.uri,x.externalPreviewUri);assert.deepEqual(plan.source,x.source);assert.deepEqual(plan.preview,image);
 for(const value of ['http://media.example/x','https://user:secret@media.example/x','file:///tmp/x','data:image/png,x','https://media.example/x#fragment'])assert.throws(()=>p.parseKeelExternalPreviewUri(value));
 assert.equal(p.parseKeelExternalPreviewUri('ipfs://bafycid/preview.png'),'ipfs://bafycid/preview.png');
});
test('verifier-only is explicit and warns that marketplace grids have no image',()=>{
 const selection={image:'omitted',animation:'hybrid-shell'};const plan=choose(input(),selection);assert.equal(plan.image,null);assert.equal(plan.status,'compatibility-review-required');
 assert.ok(plan.compatibilityWarnings.includes('collection-grids-will-not-show-an-image'));
 assert.equal(choose({...input(),omittedGridImageAcknowledged:true},selection).status,'requires-validation');
});
test('actual chosen rendering counts UTF8, preserves image bytes and commits the embedded program',async()=>{
 const plan=choose(input(),hybrid);const uri=render();const result=await p.measureKeelSmartAssetPresentation(plan,()=>uri);
 assert.equal(result.completeTokenUriBytes,Buffer.byteLength(uri));assert.equal(result.imageUriBytes,Buffer.byteLength(imageURI));
 assert.equal(result.embeddedAnimationIntegrity.digest,digest(Buffer.from('<!doctype html><p>exact verifier program</p>')));assert.equal(result.measurementBasis,'actual-rendered-complete-return');
 assert.equal(result.status,'requires-selected-chain-simulation');assert.equal(result.publicationReady,false);assert.ok(result.measurementKey.includes(result.tokenUriDigest));
});
test('actual metadata/image identity failures remain hard and do not invoke an alternate provider',async()=>{
 const plan=choose(input(),hybrid);assert.equal((await p.measureKeelSmartAssetPresentation(plan,()=>render({image:'data:image/png;base64,AA=='}))).status,'blocked');
 await assert.rejects(p.measureKeelSmartAssetPresentation(plan,()=>'<html>not metadata</html>'));
 const noAnimation=await p.measureKeelSmartAssetPresentation(plan,()=>render({animation_url:'https://fake.example/x'}));assert.ok(noAnimation.hardBlockers.includes('registered-animation-shell-required'));
});
test('image plus hybrid over target suggests smaller slot choices without silently dropping either',async()=>{
 const plan=choose(input(),hybrid);const result=await p.measureKeelSmartAssetPresentation(plan,()=>render({padding:'x'.repeat(2000000)}));
 assert.equal(result.standardsCompatible,false);assert.equal(result.status,'compatibility-review-required');assert.equal(result.hardBlockers.length,0);
 assert.deepEqual(result.recommendations.map(x=>x.candidateId),['image-only-inline','hybrid-verifier-only']);assert.equal(plan.image.delivery,'inline');assert.equal(plan.animation.delivery,'hybrid-shell');
});
test('only measured embedded verifier alone over target suggests IPFS/hosted, without forcing a change',async()=>{
 const plan=choose({...input(),fallbackDelivery:'hosted',nonstandardCompatibilityAcknowledged:true},hybrid);
 const result=await p.measureKeelSmartAssetPresentation(plan,()=>render({animation_url:htmlURI('<script>'+ 'x'.repeat(2000000)+'</script>')}));
 assert.equal(result.status,'requires-selected-chain-simulation');assert.equal(result.standardsCompatible,false);assert.ok(result.recommendations.some(x=>x.candidateId==='hosted-presentation'));
 assert.equal(plan.animation.delivery,'hybrid-shell');
});
test('explicit nonstandard acknowledgement does not bypass a measured qualified provider ceiling',async()=>{
 const plan=choose({...input(),nonstandardCompatibilityAcknowledged:true,candidateMeasurements:{'canonical-hybrid':{maximumTokenUriBytes:2000000}}},hybrid);
 const result=await p.measureKeelSmartAssetPresentation(plan,()=>render({padding:'x'.repeat(2000000)}));assert.equal(result.status,'blocked');assert.ok(result.hardBlockers.includes('actual-reader-output-limit'));
});
test('plan identity binds source, preview, preferences, exact chain code and context/default revision',async()=>{
 const base=input(), first=p.planKeelSmartAssetPresentation(base);for(const change of [ {...base,source:{...base.source,digest:hash('b')}},{...base,preview:{...image,digest:hash('c')}},{...base,contextIdentity:{...base.contextIdentity,revision:'2'}},{...base,capabilities:{...capabilities,identity:{...capabilities.identity,runtimeCodeHash:hash('6')}}},{...base,candidateMeasurements:{'canonical-inline':{completeTokenUriBytes:100}}}])assert.notEqual(p.planKeelSmartAssetPresentation(change).planKey,first.planKey);
 assert.equal(await p.hashKeelSmartAssetPresentationPlan(first),digest(Buffer.from(first.planKey)));
 assert.throws(()=>{first.source.digest=hash('d')});
});
test('async matrix snapshots source and actual candidates; missing adapters are never fake successes',async()=>{
 const x=input(), before=x.source.digest;let first=true;
 const result=await p.measureKeelSmartPresentationMatrix(x,async(candidate,plan)=>{if(first){first=false;x.source.digest=hash('e');}assert.equal(plan.source.digest,before);if(candidate.id!=='canonical-hybrid')return null;return render();});
 assert.equal(result.results.find(x=>x.candidateId==='canonical-hybrid').status,'requires-selected-chain-simulation');assert.ok(result.results.some(x=>x.status==='unavailable'));assert.ok(result.results.some(x=>x.status==='blocked'));assert.equal(result.publicationReady,false);
});
test('malformed quantities, unknown axes and unsupported pairs fail closed',()=>{
 assert.throws(()=>p.planKeelSmartAssetPresentation({...input(),measurements:{stateGas:'-1'}}));
 assert.throws(()=>choose(input(),{image:'external',animation:'omitted'}),/no maintained/);
 assert.throws(()=>p.planKeelSmartAssetPresentation({...input(),source:{...input().source,byteLength:NaN}}));
});
test('exact native source references bind the plan and actual metadata cannot switch paid object IDs',async()=>{
 const onchain={chainId:11155111,store:address('7'),objectId:hash('8')},x={...input(500001),preview:undefined,source:{...image,resourceId:'original',byteLength:500001,onchain}};
 const plan=p.planKeelSmartAssetPresentation(x);assert.equal(plan.image.uri,`web3://${address('7')}:11155111/haulObject/${hash('8')}?mime.type=image%2Fpng`);
 const right=await p.measureKeelSmartAssetPresentation(plan,()=>jsonURI({image:plan.image.uri}));assert.equal(right.hardBlockers.length,0);
 const wrong=await p.measureKeelSmartAssetPresentation(plan,()=>jsonURI({image:plan.image.uri.replace(hash('8'),hash('9'))}));assert.ok(wrong.hardBlockers.includes('native-image-reference-changed'));
 const cross=p.planKeelSmartAssetPresentation({...x,source:{...x.source,onchain:{...onchain,chainId:1}}});assert.equal(cross.status,'blocked');
});
test('candidate measurements distinguish actual outer expansion from native source and inline image budgets',()=>{
 const x={...input(130296),candidateMeasurements:{'canonical-hybrid':{completeTokenUriBytes:2100000,imageUriBytes:1750000,encodedImageSlotBytes:1750000},'hybrid-verifier-only':{completeTokenUriBytes:1900000,embeddedAnimationUriBytes:1500000}}};
 const plan=choose(x,hybrid);assert.equal(plan.standardsCompatible,false);assert.equal(plan.source.byteLength,130296);assert.ok(plan.compatibilityWarnings.includes('complete-metadata-above-standard-target'));
 assert.equal(plan.candidates.find(c=>c.id==='hybrid-verifier-only').standardsCompatible,true);
});

test('review regression: actual original outer image contribution warns even below the inner image URI target',async()=>{
 const bytes=Buffer.alloc(1312476);png.copy(bytes);const uri='data:image/png;base64,'+bytes.toString('base64');
 const plan=choose({...input(),preview:{...image,byteLength:bytes.length,digest:digest(bytes)}},hybrid);
 const metadata={name:'Same metadata',image:uri,animation_url:htmlURI('<!doctype html><p>exact verifier program</p>')};
 const full=jsonURI(metadata),{image:ignored,...withoutImage}=metadata;
 const measured=await p.measureKeelSmartAssetPresentation(plan,()=>full);
 assert.equal(measured.imageUriBytes,1749990);assert.equal(measured.encodedImageSlotBytes,1750025);assert.equal(measured.encodedImageValueBytes,1750002);
 assert.equal(measured.encodedImageSlotBytes,Buffer.byteLength(full)-Buffer.byteLength(jsonURI(withoutImage)));
 assert.equal(measured.encodedImageValueBytes,Buffer.byteLength(full)-Buffer.byteLength(jsonURI({...metadata,image:''})));
 assert.equal(measured.completeTokenUriBytes,1750255);assert.equal(measured.standardsCompatible,false);assert.equal(measured.status,'compatibility-review-required');assert.ok(measured.compatibilityWarnings.includes('inline-image-above-compatibility-target'));
 assert.equal(measured.hardBlockers.length,0);assert.equal(measured.tokenURI,full);assert.equal(measured.tokenUriDigest,digest(Buffer.from(full)));assert.equal(plan.preview.digest,digest(bytes));
});
test('outer contribution retains the actual percent grammar, escaped keys, whitespace and nested metadata',async()=>{
 const plan=choose(input(),hybrid),value=JSON.stringify(imageURI),tail=' "description":"🌊 exact", "nested":{"image":"untouched","values":[1,{"x":"a,b"}]}, "animation_url":'+JSON.stringify(htmlURI('Exact program'))+' }';
 const original='{"\\u0069mage" : '+value+','+tail;
 const encode=json=>'data:application/json;charset=utf-8,'+encodeURIComponent(json).replaceAll('%3A',':').replaceAll('%2C',',').replaceAll('%2F','/').replaceAll('%22','%22').replaceAll('%7B','%7b');
 const full=encode(original),without=encode('{'+tail),empty=encode('{"\\u0069mage" : "",'+tail),measured=await p.measureKeelSmartAssetPresentation(plan,()=>full);
 assert.equal(measured.encodedImageSlotBytes,Buffer.byteLength(full)-Buffer.byteLength(without));assert.equal(measured.encodedImageValueBytes,Buffer.byteLength(full)-Buffer.byteLength(empty));assert.equal(measured.tokenURI,full);assert.equal(measured.hardBlockers.length,0);
 const base64=json=>'data:application/json;base64,'+Buffer.from(json).toString('base64');const b=await p.measureKeelSmartAssetPresentation(plan,()=>base64(original));
 assert.equal(b.encodedImageSlotBytes,Buffer.byteLength(base64(original))-Buffer.byteLength(base64('{'+tail)));assert.equal(b.encodedImageValueBytes,Buffer.byteLength(base64(original))-Buffer.byteLength(base64('{"\\u0069mage" : "",'+tail)));assert.equal(b.tokenURI,base64(original));
});
test('review regression: unrelated metadata does not turn a 44-byte hybrid program into an external-delivery recommendation',async()=>{
 const program='<!doctype html><p>exact verifier program</p>',padding='x'.repeat(2000000);
 const matrix=await p.measureKeelSmartPresentationMatrix({...input(),selection:hybrid},candidate=>{
  if(candidate.id==='canonical-hybrid')return jsonURI({name:'Same metadata',image:imageURI,animation_url:htmlURI(program),description:padding});
  if(candidate.id==='hybrid-verifier-only')return jsonURI({name:'Same metadata',animation_url:htmlURI(program),description:padding});return null;
 });
 const measured=matrix.results.find(row=>row.candidateId==='hybrid-verifier-only').measurement;
 assert.equal(measured.embeddedAnimationIntegrity.byteLength,44);assert.equal(measured.embeddedAnimationUriBytes,93);assert.equal(measured.completeTokenUriBytes,2000259);
 assert.equal(matrix.recommendations.some(row=>['ipfs-presentation','hosted-presentation'].includes(row.candidateId)),false);
 assert.ok(matrix.recommendations.every(row=>row.code!=='measured-embedded-verifier-alone-above-target'));assert.equal(matrix.publicationReady,false);
});
test('encoded URI expansion preserves decoded integrity while offering external compatibility choices',async()=>{
 const x={...input(),candidateMeasurements:{'canonical-hybrid':{completeTokenUriBytes:2500000,embeddedAnimationUriBytes:2100000,embeddedProgramBytes:700000}}};const plan=choose(x,hybrid);
 assert.equal(plan.suggestions.some(row=>['ipfs-presentation','hosted-presentation'].includes(row.candidateId)),true);
 const measured=await p.measureKeelSmartAssetPresentation(plan,()=>render({animation_url:htmlURI(' '.repeat(700000))}));
 assert.equal(measured.embeddedAnimationIntegrity.byteLength,700000);assert.ok(measured.embeddedAnimationUriBytes>2000000);assert.equal(measured.recommendations.some(row=>['ipfs-presentation','hosted-presentation'].includes(row.candidateId)),true);assert.equal(measured.status,'compatibility-review-required');
});
test('duplicate image properties are rejected rather than measuring an earlier value and validating a later one',async()=>{
 const plan=choose(input(),hybrid);const uri='data:application/json,'+encodeURIComponent('{"image":1,"image":'+JSON.stringify(imageURI)+',"animation_url":'+JSON.stringify(htmlURI('Exact'))+'}');await assert.rejects(p.measureKeelSmartAssetPresentation(plan,()=>uri),/unambiguous|Duplicate/);
});

test('encoded verifier property uses the original outer grammar and suggests external delivery only for its own carried bytes',async()=>{
 const program=' '.repeat(700000),animation=htmlURI(program),metadata={name:'Same metadata',animation_url:animation,description:''};
 const full=jsonURI(metadata),{animation_url:unused,...without}=metadata;
 const matrix=await p.measureKeelSmartPresentationMatrix({...input(),selection:hybrid},candidate=>candidate.id==='canonical-hybrid'?jsonURI({...metadata,image:imageURI}):candidate.id==='hybrid-verifier-only'?full:null);
 const measured=matrix.results.find(row=>row.candidateId==='hybrid-verifier-only').measurement;
 assert.equal(measured.embeddedAnimationIntegrity.byteLength,700000);assert.equal(measured.embeddedAnimationUriBytes,2100029);
 assert.equal(measured.encodedAnimationSlotBytes,3500070);assert.equal(measured.encodedAnimationSlotBytes,Buffer.byteLength(full)-Buffer.byteLength(jsonURI(without)));
 assert.ok(measured.compatibilityWarnings.includes('embedded-verifier-above-compatibility-target'));assert.equal(measured.status,'compatibility-review-required');assert.equal(measured.hardBlockers.length,0);
 assert.ok(matrix.recommendations.some(row=>row.candidateId==='ipfs-presentation'));assert.equal(matrix.publicationReady,false);assert.equal(measured.tokenURI,full);
 const plan=choose({...input(),fallbackDelivery:'hosted',nonstandardCompatibilityAcknowledged:true},hybrid),ack=await p.measureKeelSmartAssetPresentation(plan,()=>jsonURI({...metadata,image:imageURI}));
 assert.equal(ack.status,'requires-selected-chain-simulation');assert.ok(ack.recommendations.some(row=>row.candidateId==='hosted-presentation'));assert.equal(ack.publicationReady,false);
});
test('animation contribution preserves original JSON escaping, Unicode and canonical Base64 outer grammar',async()=>{
 const plan=choose(input(),hybrid),program=htmlURI('Exact 🌊 program'),value=JSON.stringify(program),prefix=' { "name":"🌊", "\\u0061nimation_url" : ',tail=', "image":'+JSON.stringify(imageURI)+' }',original=prefix+value+tail;
 const percent=s=>'data:application/json,'+encodeURIComponent(s),base64=s=>'data:application/json;base64,'+Buffer.from(s).toString('base64');
 for(const wrap of [percent,base64]){
  const full=wrap(original),without=wrap(' { "name":"🌊"'+tail),empty=wrap(prefix+'""'+tail);
  const measured=await p.measureKeelSmartAssetPresentation(plan,()=>full);
  assert.equal(measured.encodedAnimationSlotBytes,Buffer.byteLength(full)-Buffer.byteLength(without));assert.equal(measured.encodedAnimationValueBytes,Buffer.byteLength(full)-Buffer.byteLength(empty));assert.equal(measured.tokenURI,full);
 }
 const duplicated=percent('{"image":'+JSON.stringify(imageURI)+',"animation_url":"first","animation_url":'+value+'}');
 await assert.rejects(p.measureKeelSmartAssetPresentation(plan,()=>duplicated),/Duplicate metadata animation_url/);
});
test('actual encoded verifier soft-target boundaries remain explicit choices without a hard size prohibition',async()=>{
 for(const [length,expected] of [[399985,1999995],[399986,2000000],[399987,2000005]]){
  const full=jsonURI({name:'Same metadata',animation_url:htmlURI(' '.repeat(length)),description:''});
  const plan=choose({...input(),selection:{image:'omitted',animation:'hybrid-shell'},omittedGridImageAcknowledged:true,nonstandardCompatibilityAcknowledged:true},{image:'omitted',animation:'hybrid-shell'});
  const measured=await p.measureKeelSmartAssetPresentation(plan,()=>full);
  assert.equal(measured.encodedAnimationSlotBytes,expected);assert.equal(measured.compatibilityWarnings.includes('embedded-verifier-above-compatibility-target'),expected>2000000);assert.equal(measured.hardBlockers.length,0);assert.equal(measured.status,'requires-selected-chain-simulation');
 }
});

test('medium image recommendation keeps exact original bytes instead of a separate generated poster',async()=>{
 const original=Buffer.alloc(500001);png.copy(original);const source={resourceId:'exact-original.png',mediaType:'image/png',byteLength:original.length,digest:digest(original)};
 const plan=p.planKeelSmartAssetPresentation({...input(),source,capabilities:{...capabilities,inlineImageTypes:['image/png']}});
 assert.equal(plan.selectedCandidateId,'image-only-inline');assert.equal(plan.image.resourceId,source.resourceId);assert.equal(plan.image.commitment.digest,source.digest);assert.equal(plan.animation.delivery,'omitted');
 const actual=jsonURI({image:'data:image/png;base64,'+original.toString('base64')});
 const measured=await p.measureKeelSmartAssetPresentation(plan,()=>actual);assert.equal(measured.hardBlockers.length,0);assert.equal(measured.tokenURI,actual);
 const replaced=await p.measureKeelSmartAssetPresentation(plan,()=>jsonURI({image:imageURI}));assert.ok(replaced.hardBlockers.includes('inline-image-source-changed'));
 const advanced=choose({...input(),source},{image:'onchain-reference',animation:'omitted'});assert.equal(advanced.selectedCandidateId,'direct-onchain-asset');assert.ok(advanced.compatibilityWarnings.includes('native-object-references-may-not-load-in-marketplace-grids'));
});
test('inline native nonimage playback requires exact qualified MIME, independent poster and both measured commitments',async()=>{
 const media=Buffer.from('RIFF0000WAVEexact native audio'),source={resourceId:'exact.wav',mediaType:'audio/wav',byteLength:media.length,digest:digest(media)};
 const selection={image:'inline',animation:'inline-media'},caps={...capabilities,inlineMediaTypes:['audio/wav']};
 const plan=choose({...input(),source,capabilities:caps},selection);assert.equal(plan.selectedCandidateId,'media-only-inline');assert.equal(plan.image.resourceId,image.resourceId);
 const actual=jsonURI({image:imageURI,animation_url:'data:audio/wav;base64,'+media.toString('base64')});
 const measured=await p.measureKeelSmartAssetPresentation(plan,()=>actual);assert.equal(measured.hardBlockers.length,0);assert.equal(measured.inlineMediaIntegrity.digest,source.digest);assert.equal(measured.encodedAnimationSlotBytes,Buffer.byteLength(actual)-Buffer.byteLength(jsonURI({image:imageURI})));
 const changed=await p.measureKeelSmartAssetPresentation(plan,()=>jsonURI({image:imageURI,animation_url:'data:audio/wav;base64,'+Buffer.from('different').toString('base64')}));assert.ok(changed.hardBlockers.includes('inline-native-media-source-changed'));
 assert.ok(choose({...input(),source},selection).hardBlockers.includes('qualified-inline-media-renderer-required'));
 assert.ok(choose({...input(),source,preview:undefined,capabilities:caps},selection).hardBlockers.includes('usable-grid-image-required'));
 assert.ok(choose({...input(),source:{...source,mediaType:'text/html'},execution:'static',capabilities:caps},selection).hardBlockers.includes('script-requires-registered-verifier'));
 assert.equal(measured.publicationReady,false);
});

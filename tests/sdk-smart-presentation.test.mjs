import test from 'node:test';import assert from 'node:assert/strict';
import {stageKeelStudioProject} from '../packages/sdk/dist/studio-upload.js';
import {createKeelStudioDefaultProfile,resolveKeelBuildDefaults,KEEL_BUILD_DEFAULT_FIELDS,updateKeelStudioDefaultProfile} from '../packages/sdk/dist/studio-project-defaults.js';
import {KEEL_ASSET_PRESENTATION_PREFERENCES,KEEL_ASSET_PRESENTATION_CANDIDATE_IDS,planKeelSmartAssetPresentation} from '../packages/sdk/dist/presentation.js';
import {TOOL_SCHEMAS} from '../packages/mcp/dist/schemas.js';
const text=new TextEncoder();
async function stage(overrides={}){let metadata,form;const input={studioUrl:'https://studio.example',agentToken:'k'.repeat(48),title:'Preserved item',storageStrategy:'onchain',files:[{path:'item.txt',mediaType:'text/plain',bytes:text.encode('Original'),role:'data',format:'asset'}],...overrides,fetchImplementation:async(_url,init)=>{form=init.body;metadata=JSON.parse(form.get('metadata'));return Response.json({schema:'keel-studio-project-handoff@1',id:'same-draft',handoffUrl:'https://studio.example/studio/projects/new?handoff=secret',expiresAt:'2027-09-01T00:00:00Z',fileCount:1,totalBytes:8,wallet:{signing:'not-performed',submission:'not-performed'}},{status:201})}};await stageKeelStudioProject(input);return{metadata,form};}
test('SDK staging and protocol expose the same presets and exact new-source recommendation',async()=>{
 assert.deepEqual(KEEL_ASSET_PRESENTATION_PREFERENCES,['automatic','external-preview','inline-image-hybrid-verifier']);
 const small=await stage();assert.equal(small.metadata.viewer,'keel-verification-shell');assert.equal(small.metadata.assetPresentation,'automatic');
 const bytes=text.encode('x'.repeat(500001));const large=await stage({files:[{path:'item.txt',mediaType:'text/plain',bytes,role:'data',format:'asset'}]});assert.equal(large.metadata.viewer,'keel-verification-shell');assert.equal((await large.form.get('files').arrayBuffer()).byteLength,500001);
 const split=await stage({files:[{path:'item.txt',mediaType:'text/plain',bytes:text.encode('x'.repeat(2000001)),role:'data',format:'asset'}]});assert.equal(split.metadata.viewer,'keel-verification-shell');
});
test('all choice fields survive SDK/API staging without becoming wallet authority',async()=>{
 const {metadata}=await stage({assetPresentation:'external-preview',externalPreviewUri:'https://preview.example/item.png',fallbackDelivery:'ipfs',assetPresentationSelection:'external-preview-hybrid',nonstandardCompatibilityAcknowledged:true});
 assert.equal(metadata.externalPreviewUri,'https://preview.example/item.png');assert.equal(metadata.fallbackDelivery,'ipfs');assert.equal(metadata.assetPresentationSelection,'external-preview-hybrid');assert.equal(metadata.nonstandardCompatibilityAcknowledged,true);assert.equal(metadata.viewer,'keel-verification-shell');
 await assert.rejects(stage({assetPresentation:'unknown'}));await assert.rejects(stage({fallbackDelivery:'unknown'}));await assert.rejects(stage({externalPreviewUri:'https://user:secret@preview.example/x'}));
});
test('explicit retained viewer choices stay selected and actual script sources keep shell defaults',async()=>{
 assert.equal((await stage({viewer:'none'})).metadata.viewer,'none');
 const result=await stage({files:[{path:'fake.gif',mediaType:'image/gif',bytes:text.encode('<!doctype html><script>x()</script>'),role:'image',format:'asset'}]});assert.equal(result.metadata.viewer,'keel-verification-shell');
});
test('Blob reads snapshot source and project choices before awaiting caller-controlled bytes',async()=>{
 let input,metadata;class SlowBlob extends Blob{async arrayBuffer(){input.assetPresentation='external-preview';input.viewer='none';input.files[0].mediaType='text/javascript';return super.arrayBuffer();}}
 input={studioUrl:'https://studio.example',agentToken:'k'.repeat(48),title:'Snapshot item',storageStrategy:'onchain',assetPresentation:'automatic',files:[{path:'item.txt',mediaType:'text/plain',bytes:new SlowBlob(['Original']),role:'data',format:'asset'}],fetchImplementation:async(_url,init)=>{metadata=JSON.parse(init.body.get('metadata'));return Response.json({schema:'keel-studio-project-handoff@1',id:'snapshot',handoffUrl:'https://studio.example/studio/projects/new?handoff=x',expiresAt:'2027-09-01T00:00:00Z',fileCount:1,totalBytes:8,wallet:{signing:'not-performed',submission:'not-performed'}},{status:201})}};
 await stageKeelStudioProject(input);assert.equal(metadata.assetPresentation,'automatic');assert.equal(metadata.viewer,'keel-verification-shell');assert.equal(metadata.components[0].mediaType,'text/plain');
});
test('saved preferences use existing revisioned defaults and never persist a per-project URL',()=>{
 const profile=createKeelStudioDefaultProfile(),matrix={schema:'keel-plan-matrix@1',fields:KEEL_BUILD_DEFAULT_FIELDS};
 // Existing resolver layers only its allowlisted fields; account URL keys cannot enter a build.
 const resolved=resolveKeelBuildDefaults({...profile,global:{assetPresentation:'external-preview',fallbackDelivery:'hosted',assetPresentationSelection:'hybrid-verifier-only',nonstandardCompatibilityAcknowledged:true,externalPreviewUri:'https://private.example/x'}});
 assert.equal(resolved.values.assetPresentation,'external-preview');assert.equal(resolved.values.assetPresentationSelection,'hybrid-verifier-only');assert.equal(resolved.values.fallbackDelivery,'hosted');assert.equal(resolved.values.nonstandardCompatibilityAcknowledged,true);assert.equal(resolved.values.externalPreviewUri,undefined);
 assert.equal(resolveKeelBuildDefaults(profile).values.assetPresentation,'automatic');assert.ok(KEEL_ASSET_PRESENTATION_CANDIDATE_IDS.includes('image-only-inline'));assert.equal(KEEL_BUILD_DEFAULT_FIELDS.some(f=>f.id==='externalPreviewUri'),false);
});
test('MCP staging schema consumes canonical enum values rather than a separate policy',()=>{
 const schema=TOOL_SCHEMAS.studioStageProject;assert.deepEqual(schema.properties.assetPresentation.enum,[...KEEL_ASSET_PRESENTATION_PREFERENCES]);assert.deepEqual(schema.properties.assetPresentationSelection.enum,[...KEEL_ASSET_PRESENTATION_CANDIDATE_IDS]);
 assert.equal(typeof planKeelSmartAssetPresentation,'function');
});

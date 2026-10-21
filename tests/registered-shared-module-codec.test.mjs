import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const sourceRoot=process.env.KEEL_SELECTOR_SOURCE_ROOT;
const entry=name=>sourceRoot?pathToFileURL(path.join(sourceRoot,name+'.ts')).href:new URL('../packages/sdk/dist/'+name+'.js',import.meta.url).href;
const {selectKeelRegisteredInlineCandidate,keelRegisteredInlineRecipeDigest}=await import(entry('registered-inline-candidates'));
const {buildKeelInlineLocalDocument,buildKeelInlineModuleFragment,buildKeelInlineRawPercentTokenURIGraph,decodeKeelInlineGraphFragment}=await import(entry('inline-viewer-graph'));
const {createKeelRegisteredNativeGzipProof,KEEL_REGISTERED_NATIVE_GZIP_FRAME_PROFILE:p}=await import(entry('registered-native-gzip'));
const sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
const frame=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/registered-native-gzip-revision5.json.gz',import.meta.url))));
const integrity=b=>({algorithm:'sha256',digest:sha(b),byteLength:b.length});
const half=side=>decodeKeelInlineGraphFragment(Buffer.from(frame.fragments['compact-'+side].base64,'base64'),'application/vnd.keel.token-uri-raw-percent-fragment');
const shell={schema:'keel-inline-shell-fragments@1',codecProfile:'browser-gzip-deflate',prefix:{bytes:half('prefix'),integrity:integrity(half('prefix'))},suffix:{bytes:half('suffix'),integrity:integrity(half('suffix'))}};
const binding=Object.fromEntries(['chainId','revision','store','registry','reader','readerRuntimeCodeHash','metadataObjectId','readerDeploymentTransactionHash','registeredPrefixObjectId','registeredSuffixObjectId','prefixObjectId','suffixObjectId'].map(key=>[key,p[key]]));
Object.assign(binding,{profile:'keel.canonical-native-gzip@1',metadataIntegrity:{algorithm:'sha256',digest:p.metadataDigest,byteLength:p.metadataByteLength}});
const artwork={id:'original',mediaType:'text/html',bytes:Buffer.from('<!doctype html><p>Creator original</p>')};
const shared={id:'shared.renderer',mediaType:'text/javascript',bytes:Buffer.from('globalThis.sharedRenderer=true;'.repeat(30))};
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=','base64');
async function fixture(compression='none'){
 const module=await buildKeelInlineModuleFragment({moduleId:shared.id,version:'1.0.0',mediaType:shared.mediaType,decodedBytes:shared.bytes,compression:'gzip',execution:'classic'});
 const root=await buildKeelInlineLocalDocument({shell,modules:[module],assets:[],entry:{id:artwork.id,mediaType:artwork.mediaType,source:artwork.bytes,compression}});
 const proof=createKeelRegisteredNativeGzipProof({binding,documentBytes:root.rootBytes});
 const graph=await buildKeelInlineRawPercentTokenURIGraph(root,{registeredNativeGzip:proof});
 // Explicit local recipe commitments exercise selector authority boundaries;
 // they are not selected-chain registration or a live-publication assertion.
 const parts=graph.parts.map(part=>({objectId:sha(part.bytes),bytes:part.bytes,disposition:part.sourceKind==='existing'?'reused':'new',role:part.role==='module'?'module':part.sourceKind==='existing'?'boot':'payload'}));
 const recipe={profile:'local-exact-shared-codec-fixture',chainId:p.chainId,store:p.store,registry:p.registry,reader:p.reader,readerRuntimeCodeHash:p.readerRuntimeCodeHash,registrationDigest:sha(Buffer.from('local registration fixture')),revision:5,codec:'none',sourceReader:'canonical-items',registeredParts:parts.filter(part=>part.disposition==='reused').map(part=>({objectId:part.objectId,digest:sha(part.bytes),byteLength:part.bytes.length,role:part.role})),sharedSources:[{id:shared.id,mediaType:shared.mediaType,digest:sha(shared.bytes),byteLength:shared.bytes.length}]};
 const data=(type,bytes)=>'data:'+type+';charset=utf-8,'+encodeURIComponent(Buffer.from(bytes).toString());
 const built={tokenURI:data('application/json',JSON.stringify({name:'Same original',image:'data:image/png;base64,'+image.toString('base64'),animation_url:data('text/html',graph.htmlBytes)})),documentParts:parts,registeredNativeGzip:proof};
 return {recipe,built};
}
async function select(value){return selectKeelRegisteredInlineCandidate({sources:[artwork],collectorImage:{mediaType:'image/png',bytes:image},metadataFields:{name:'Same original'},measurementScope:{kind:'provisional-template',templateDigest:sha(Buffer.from('same context'))},requestedCompression:'none',candidates:[{id:'original-none',status:'registered-recipe',recipe:value.recipe,build:async()=>({...value.built,recipeDigest:keelRegisteredInlineRecipeDigest(value.recipe)})}]});}
test('None creator retains exact registered shared Gzip module with mandatory final proof',async()=>{const result=await select(await fixture());assert.equal(result.selected.codec,'none');assert.equal(result.selected.sourceByteIdentity,'verified-exact');assert.equal(result.requiresFullSimulation,true);assert.equal(result.publicationReady,false);});
for(const kind of ['unregistered','new','boot','wrong-object','wrong-bytes','wrong-MIME','wrong-member','wrong-proof'])test('compressed shared '+kind+' cannot bypass exact module authority',async()=>{
 const f=await fixture(),index=f.built.documentParts.findIndex(part=>part.role==='module'),module=f.built.documentParts[index];
 if(kind==='unregistered'||kind==='new'){f.recipe.registeredParts=f.recipe.registeredParts.filter(part=>part.objectId!==module.objectId);if(kind==='new')module.disposition='new';}
 if(kind==='boot'){module.role='boot';f.recipe.registeredParts.find(part=>part.objectId===module.objectId).role='boot';}
 if(kind==='wrong-object')module.objectId='0x'+'0'.repeat(64);
 if(kind==='wrong-bytes')module.bytes=Buffer.from('changed');
 if(kind==='wrong-MIME')f.recipe.sharedSources[0].mediaType='text/css';
 if(kind==='wrong-member')f.recipe.sharedSources[0].digest='0x'+'0'.repeat(64);
 if(kind==='wrong-proof')f.built.registeredNativeGzip={...f.built.registeredNativeGzip,documentIntegrity:{...f.built.registeredNativeGzip.documentIntegrity,digest:'0x'+'0'.repeat(64)}};
 await assert.rejects(select(f),/registered|source|member|evidence|reused|Reused/i);
});
test('Gzip original remains forbidden under selected None even with shared module proof',async()=>{await assert.rejects(select(await fixture('gzip')),/silently changed its selected codec/);});

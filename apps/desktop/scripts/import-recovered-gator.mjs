/** Recovering files is separate from importing a project: all edits go through the SDK workspace client. */
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createKeelEditorClient} from '@keel/sdk/editor-client';
import {importGatorLayers,applyGatorMetadataNames} from '@keel/sdk/gator-import';
import {layeredAssetIds,selectLayeredArt,resolveLayeredArt} from '@keel/sdk/layered-art';
import {gatorStack} from '@keel/sdk/gator-assembly';
import {optimizeLayerPNG} from '@keel/sdk/layered-png';
const root=path.resolve('apps/desktop/artifacts/gator-new-source'),evidence=path.resolve('apps/desktop/artifacts/gator-ape-rebuild');
const json=async file=>JSON.parse(await readFile(file,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const connection=await json(process.argv[2]??'apps/desktop/artifacts/manual-test-workspace/workspace-connection.json');
const sdk=createKeelEditorClient(connection.socketPath),id=process.argv[3]??'1f1e37b1-87fa-4bcf-a869-e9219c2ad898';
const before=await sdk.readProject(id);let revision=before.revision;
await writeFile(path.join(root,`editor-before-${revision}.json`),JSON.stringify(before,null,2),{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
const recovered=await json(path.join(root,'recovery.json')),labels=await json(path.join(evidence,'metadata-names.json')),webp=await json(path.join(evidence,'webp-token-0.json'));
const pngCache=await json(path.resolve('apps/desktop/artifacts/gator-recovery/png-assets.json'));
assert.equal(labels.conflicts.length,0);
const known=new Set(before.objects.map(o=>o.id)),files=[],reusedWebP=[];
for(const entry of recovered.entries.filter(e=>e.path.startsWith('public/layers/')&&e.path.endsWith('.png'))){
 const relative=entry.path.slice('public/layers/'.length);
 // Keep the recovered opaque background correction; never substitute a flat colour.
 const background=relative.startsWith('Background/')&&recovered.entries.find(e=>e.path==='public/layers-lastreal/'+relative);
 const selected=background||entry;let bytes=await readFile(path.join(root,'source',selected.path));assert.equal(hash(bytes),selected.sha256);
 let type='image/png',objectId=hash(bytes);
 const verified=webp.find(w=>w.path===relative&&w.sourceDigest===objectId);
 if(verified){bytes=await readFile(verified.file);assert.equal(hash(bytes),verified.objectId);objectId=verified.objectId;type='image/webp';reusedWebP.push(relative);}
 else if(!relative.startsWith('Background/')){const cached=pngCache.find(p=>p.sourceDigest===objectId&&p.proof==='exact-png-image-stream');if(cached){bytes=await readFile(path.resolve('apps/desktop/artifacts/gator-recovery/png-assets',cached.objectId));assert.equal(hash(bytes),cached.objectId);objectId=cached.objectId;}else{const prepared=await optimizeLayerPNG(bytes);bytes=Buffer.from(prepared.bytes);objectId=hash(bytes);}}
 if(!known.has(objectId)){const imported=await sdk.importObject(bytes,relative,type,revision);assert.equal(imported.object.id,objectId);revision=imported.revision;known.add(objectId);}
 files.push({path:relative,objectId});
}
const config=await json(path.join(root,'source/src/data/generatorConfig.json'));
const imported=importGatorLayers(config,files,id),art=applyGatorMetadataNames({...imported.manifest,width:4525,height:4525,format:'image/png'},labels.names);
const audit=await json(path.join(evidence,'layer-audit.json'));let checked=0;const ruleConflicts=[];
for(const token of audit.tokens){
 const overrides=Object.fromEntries(art.attributes.map(a=>{const binding=art.assembly.sourceNames[a.id],name=token.assetTraits[binding.attribute.toLowerCase()]??'None';const item=a.items.find(i=>binding.items[i.id]===name);assert.ok(item,'Missing trait '+name);return [a.id,item.id];}));
 const original=gatorStack(art.assembly,token.assetTraits);assert.ok(original.stack.length>0);assert.ok(original.stack.every(p=>known.has(p.objectId)));
 try{const draw=await selectLayeredArt(art,'apechain-contract-snapshot',String(token.tokenId),overrides);const pieces=resolveLayeredArt(art,draw).pieces;assert.ok(pieces.length>0);assert.ok(pieces.every(p=>known.has(p.objectId)));}
 catch(error){if(!/does not meet its rules/.test(error.message))throw error;ruleConflicts.push({tokenId:token.tokenId,error:error.message});}
 checked++;
}
const next=await sdk.updateProject(id,revision,{layered:art,objectIds:[...new Set([...before.project.objectIds,...layeredAssetIds(art)])],notes:`Recovered from Build-A-Gator - new - Copy (3).zip. Original 4525 × 4525 layers and generator rules imported with KEEL SDK. Opaque background corrections retained from layers-lastreal. ${checked}/4000 contract metadata compositions checked; recovery incomplete. ${reusedWebP.length} matching verified WebP layers reused. Historical sets preserved. No publication performed.\n`+imported.notes.join('\n')});
const after=await sdk.readProject(id);assert.equal(after.revision,next.revision);assert.deepEqual(after.project.layerCuration,before.project.layerCuration);
const proof={projectId:id,revision:next.revision,layerPaths:files.length,compositionsChecked:checked,ruleConflicts,metadataComplete:labels.complete,reusedWebP:reusedWebP.length,updatedThrough:'@keel/sdk/editor-client',publicationReady:false};
await writeFile(path.join(root,'editor-import.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify({...proof,ruleConflicts:ruleConflicts.length}));

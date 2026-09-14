/** Add a recovered collection; never overwrite an existing project or wallet profile. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {WorkspaceStore,newTemplateProject} from '../src/workspace.mjs';
import {importGatorLayers} from '@keel/sdk/gator-import';
import {layerDigest,layeredAssetIds,sampleLayeredArt} from '@keel/sdk/layered-art';
import {newLayerCuration,addLayerCandidate} from '@keel/sdk/layered-curation';
import {withLayeredPreview} from '../src/layered-project.mjs';
const database=process.argv[2],expectedRevision=Number(process.argv[3]);
if(!database||!Number.isSafeInteger(expectedRevision))throw Error('Provide the preserved workspace path and reviewed revision. Close its editor before importing.');
const root=path.resolve('apps/desktop/artifacts/gator-recovery'),rows=JSON.parse(await readFile(path.join(root,'png-2160.json'),'utf8'));
if(rows.length!==915||rows.some(r=>r.width!==2160||r.height!==2160||r.proof!=='exact-resized-rgba-and-icc'))throw Error('Finish and verify all recovered PNG layers first.');
const config=JSON.parse(await readFile(path.join(root,'generatorConfig.json'),'utf8'));
let project=newTemplateProject('Token Gators · 2160 studio','layered');const imported=importGatorLayers(config,rows.map(r=>({path:r.path,objectId:r.objectId})),project.id);
project={...project,layered:{...imported.manifest,width:2160,height:2160,seed:'gator-recovery'},directImage:{format:'png',motion:'still'},notes:'2160 × 2160 PNG study. Opaque backgrounds restored from layers-lastreal; authoring inventory includes originals of unused branches for future edits. Used unique PNG budget: 96,250,163 bytes (over the 75 MB goal). Random generations here are new test candidates, not the existing mainnet tokens. Recovered active server generator and public/layers. Originals remain in the downloaded ZIPs. Local rendering only; no live Token Gators contract has been changed.\n'+imported.notes.join('\n')};
let curation=newLayerCuration();for(let i=1;i<=6;i++)curation=(await addLayerCandidate(curation,project.layered,{seed:'gator-recovery',tokenId:String(i),origin:'generated'})).state;
project.layerCuration=curation;project=withLayeredPreview(project);
const sample=await sampleLayeredArt(project.layered,100,'gator-recovery');if(sample.failures.length)throw Error(JSON.stringify(sample.failures));
const store=new WorkspaceStore(database);try{
 const snapshot=store.read();if(snapshot.revision!==expectedRevision)throw Error('Workspace changed before recovery import.');
 if(snapshot.state.projects.some(p=>p.title===project.title))throw Error('Recovered project already exists; inspect it instead of duplicating.');
 const objects=new Map(snapshot.state.objects.map(o=>[o.id,o]));await mkdir(store.objectDirectory,{recursive:true,mode:0o700});
 const add=async(bytes,name,type)=>{const id=await layerDigest(bytes);if(!objects.has(id)){try{await writeFile(path.join(store.objectDirectory,id),bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;if(await layerDigest(await readFile(path.join(store.objectDirectory,id)))!==id)throw Error('Existing object failed verification.');}objects.set(id,{id,name,type,byteLength:bytes.length,source:'local-import'});}return id;};
 for(const row of rows){const bytes=await readFile(path.join(root,'png-2160',row.file));if(await layerDigest(bytes)!==row.objectId)throw Error('Recovered layer digest mismatch.');await add(bytes,row.path,'image/png');}
 const cover=await add(await readFile(path.join(root,'render-2160','gator-1.png')),'Token Gators cover.png','image/png');project.objectIds=[...new Set([...layeredAssetIds(project.layered),cover])];project.metadata={name:project.title,description:'Recovered Token Gators layer generator. Local artist test collection.',image:`keel-asset://${cover}/raw`};
 const next=store.save({...snapshot.state,objects:[...objects.values()],projects:[...snapshot.state.projects,project]},snapshot.revision);
 if(JSON.stringify(next.state.projects.slice(0,-1))!==JSON.stringify(snapshot.state.projects)||JSON.stringify(next.state.wallets)!==JSON.stringify(snapshot.state.wallets))throw Error('Preservation assertion failed.');
 const result={projectId:project.id,revision:next.revision,layers:rows.length,uniqueLayerObjects:layeredAssetIds(project.layered).length,candidates:project.layerCuration.candidates.length,originalBytes:rows.reduce((n,r)=>n+r.originalBytes,0),optimizedBytes:rows.reduce((n,r)=>n+r.storedBytes,0),sample:{count:sample.count,failures:sample.failures.length,duplicates:sample.duplicates},notes:imported.notes,publicationReady:false};
 await writeFile(path.join(root,'workspace-import.json'),JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));
}finally{store.close();}

/** Add an original-resolution test project; preserve the earlier project and frozen sets. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {WorkspaceStore} from '../src/workspace.mjs';
import {withLayeredPreview} from '../src/layered-project.mjs';
import {importGatorLayers,applyGatorMetadataNames} from '@keel/sdk/gator-import';
import {layeredAssetIds} from '@keel/sdk/layered-art';
import {newLayerCuration,addLayerCandidate,assignLayerCandidate} from '@keel/sdk/layered-curation';
const root=path.resolve('apps/desktop/artifacts/gator-ape-rebuild'),recovery=path.resolve('apps/desktop/artifacts/gator-recovery');
const database=process.argv[2],expected=Number(process.argv[3]);if(!database||!Number.isSafeInteger(expected))throw Error('Provide the closed editor workspace and expected revision.');
const json=async f=>JSON.parse(await readFile(f,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const ro=new DatabaseSync(database,{readOnly:true});const row=ro.prepare('SELECT revision,body FROM workspace WHERE id=1').get();ro.close();if(row.revision!==expected)throw Error('Workspace changed');
const state=JSON.parse(row.body),old=state.projects.find(p=>p.id==='526b335e-a84f-4ffd-a9dc-dda30fd759bf');if(!old?.layered)throw Error('Recovered project not found');
if(state.projects.some(p=>p.title==='Token Gators · original size'))throw Error('Original-size project already staged');
const audit=await json(path.join(root,'layer-audit.json')),labels=await json(path.join(root,'metadata-names.json'));if(labels.conflicts.length)throw Error('Resolve conflicting public names first');
const config=await json(path.join(recovery,'generatorConfig.json')),rows=await json(path.join(recovery,'png-assets.json')),webp=await json(path.join(root,'webp-token-0.json'));
const replacements=new Map(webp.map(r=>[r.path,r])),objects=new Map(state.objects.map(o=>[o.id,o]));const objectDir=database+'.objects';await mkdir(objectDir,{recursive:true});
const add=async(bytes,name,type)=>{const id=hash(bytes);if(!objects.has(id)){try{await writeFile(path.join(objectDir,id),bytes,{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(hash(await readFile(path.join(objectDir,id))),id);}objects.set(id,{id,name,type,byteLength:bytes.length,source:'local-import'});}return id;};
const files=[];
for(const r of rows){let bytes,type='image/png';const replacement=replacements.get(r.path);
 if(replacement){bytes=await readFile(replacement.file);assert.equal(hash(bytes),replacement.objectId);type='image/webp';}
 else if(r.path.startsWith('Background/'))bytes=await readFile(path.join(recovery,'recovered-backgrounds',path.basename(r.path)));
 else {bytes=await readFile(path.join(recovery,'png-assets',r.objectId));assert.equal(hash(bytes),r.objectId);}
 files.push({path:r.path,objectId:await add(bytes,r.path,type)});
}
const cover=await add(await readFile(path.join(root,'token-0-webp-canvas.png')),'TokenGator 0 · original size.png','image/png');
const id=randomUUID(),imported=importGatorLayers(config,files,id);const art=applyGatorMetadataNames({...imported.manifest,width:4525,height:4525,format:'image/png'},labels.names);
let curation=newLayerCuration();curation.supply=4000;
for(const token of audit.tokens.filter(t=>[0,1,2].includes(t.tokenId))){const overrides={};
 for(const a of art.attributes){const binding=art.assembly.sourceNames[a.id],trait=token.assetTraits[binding.attribute.toLowerCase()]??'None',item=a.items.find(i=>binding.items[i.id]===trait);if(!item)throw Error('Missing original token trait '+trait);overrides[a.id]=item.id;}
 const added=await addLayerCandidate(curation,art,{seed:'apechain-contract-snapshot',tokenId:String(token.tokenId),overrides,origin:'curated'});curation=assignLayerCandidate(added.state,added.candidate.id);
}
const project=withLayeredPreview({...old,id,title:'Token Gators · original size',layered:art,layerCuration:curation,objectIds:[...new Set([...layeredAssetIds(art),cover])],runtimeModules:[],files:[],metadata:{name:'Token Gators · original size',description:'Recovered generator with published ApeChain trait names. Local test project.',image:'keel-asset://'+cover+'/raw'},notes:`Original 4525 × 4525 canvas. Source PNG copies retained; token 0 uses 14 pixel-verified lossless WebP layers. Public names matched against ${audit.matched}/4000 downloaded contract metadata records; recovery remains incomplete. Backgrounds joined through each current image CID. Tokens 0, 1 and 2 are pinned examples, not random replacements. No publication or contract update has occurred.\n`+imported.notes.join('\n')});
const corrected=withLayeredPreview({...old,layered:applyGatorMetadataNames(old.layered,labels.names),notes:(old.notes+'\nPublished ApeChain names applied; historical candidate snapshots preserved. Original-size test is a separate project.').slice(0,4000)});
await writeFile(path.join(root,'editor-before-project.json'),JSON.stringify({revision:expected,project:old},null,2),{flag:'wx'});
const next={...state,projects:[...state.projects.map(p=>p.id===old.id?corrected:p),project],objects:[...objects.values()]};
for(const key of Object.keys(state).filter(k=>!['projects','objects'].includes(k)))assert.deepEqual(next[key],state[key]);
assert.deepEqual(next.projects.filter(p=>p.id!==old.id&&p.id!==id),state.projects.filter(p=>p.id!==old.id));assert.deepEqual(corrected.layerCuration,old.layerCuration);
const store=new WorkspaceStore(database);try{const saved=store.save(next,expected);assert.equal(saved.state.projects.at(-1).id,id);const proof={projectId:id,correctedProjectId:old.id,revision:saved.revision,dimensions:[4525,4525],nativeLayerPaths:files.length,uniqueProjectAssets:project.objectIds.length,pinnedTokenIds:curation.candidates.map(c=>c.tokenId),metadataMatched:audit.matched,metadataComplete:labels.complete,publicationReady:false};await writeFile(path.join(root,'editor-stage.json'),JSON.stringify(proof,null,2));console.log(JSON.stringify(proof));}finally{store.close();}

import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chunkDirectImageObject,directImageRecipe,parseDirectImageSettings} from '@keel/sdk/direct-image';
import {canonicalLayerJSON,layeredAssetIds} from '@keel/sdk/layered-art';
import {layerCurationPlan} from '@keel/sdk/layered-curation';

export async function exportDirectImagePackage(store,project,directory){
  if(!project.layered||!project.directImage)throw Error('Choose a direct image format first.');
  const settings=parseDirectImageSettings(project.directImage);
  const versions=[project.layered,...(project.layerCuration?.versions.map(v=>v.manifest)??[])];
  if(versions.some(v=>v.reveal.encrypted))throw Error('These layers are private until reveal. Use the encrypted preparation flow; a direct image reveal adapter is still required.');
  const ids=[...new Set(versions.flatMap(layeredAssetIds))];
  const snapshot=store.read(),objects=new Map(snapshot.state.objects.map(o=>[o.id,o]));
  for(const id of ids){if(!project.objectIds.includes(id)||!objects.has(id))throw Error('Keep every layer used by this project and its saved candidates attached.');await store.verifyObject(id);}
  const allocation=project.layerCuration?await layerCurationPlan(project.layerCuration):null;
  const recipe={...directImageRecipe(project.layered,settings),...(allocation?{curation:allocation}:{}),projectId:project.id,contractIds:project.contractIds,targetNetworkId:project.targetNetworkId??null};
  const folder=path.join(directory,`keel-direct-image-${crypto.randomUUID()}`);
  await mkdir(path.join(folder,'chunks'),{recursive:true,mode:0o700});
  const unique=new Set(),resources=[];let storedBytes=0,sourceBytes=0;
  const add=async(bytes,type,role)=>{
    // This is a local packaging budget. A selected-chain adapter must verify/repack it.
    const result=await chunkDirectImageObject(bytes,type,24_000);
    for(const chunk of result.chunks){if(unique.has(chunk.digest))continue;await writeFile(path.join(folder,'chunks',chunk.digest),chunk.bytes,{flag:'wx',mode:0o600});unique.add(chunk.digest);storedBytes+=chunk.bytes.length;}
    resources.push({...result.object,role});sourceBytes+=bytes.length;
  };
  for(const id of ids)await add(store.object(id),objects.get(id).type,'layer');
  await add(new TextEncoder().encode(canonicalLayerJSON(recipe)),'application/json','recipe');
  const plan={schema:'keel-direct-image-package@1',output:settings,resources,chunkCount:unique.size,sourceBytes,storedBytes,storageEncoding:'raw-bytes',localChunkBudget:24_000,
    recipeDigest:resources.at(-1).digest,publicationReady:false,proof:'local-verified-source-bytes',required:recipe.required,signing:'not-performed'};
  await writeFile(path.join(folder,'image-plan.json'),canonicalLayerJSON(plan),{flag:'wx',mode:0o600});
  await writeFile(path.join(folder,'README.txt'),'DIRECT IMAGE LOCAL PREPARATION\nBinary layers and the full recipe are split into deduplicated raw byte chunks. No base64 image objects are uploaded by this package. SVG may encode a chosen PNG layer when constructing the final display response, not in stored image objects.\nThe recipe includes weights, variants, placement boundaries, meshes, inclusion/exclusion rules and saved allocation plans. A selected-chain contract adapter must execute the selection and composition rules; storing JSON or a digest alone does not implement them. PNG requires compositing and encoding; animation additionally needs frame timing, blend and disposal.\nThis folder has not been uploaded or signed. Verify storage chunk limits, contract authority, renderer identity, gas and final metadata.image read-back before publication.\n',{flag:'wx',mode:0o600});
  return {directory:folder,message:`Prepared ${ids.length} layers as ${unique.size} reusable raw chunks. The full recipe is included. Contract rendering and publication still need their adapter.`,plan};
}

import { checkLayeredArt, layeredManifestDigest, canonicalLayerJSON, sampleLayeredArt } from '@keel/sdk/layered-art';
import { sealLayeredBundle, layeredRevealPlan } from '@keel/sdk/layered-reveal';
import { LAYERED_RUNTIME } from '@keel/sdk/layered-runtime-info';
import { resolveRuntimeReferences } from './runtime-library.mjs';
import { verifyRuntimeBytes } from './runtime-files.mjs';
import { layeredHTML } from './layered-project.mjs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
export async function exportLayeredPackage(store, project, directory, encryption, runtimePath) {
  if(project.layerCuration?.set.length)throw Error('Your curated set is saved locally. Export its private set plan for review; publishing it needs a verified collection allocation adapter.');
  const manifest=project.layered;if(!manifest)throw Error('Open a layered project first.');
  const renderer=resolveRuntimeReferences(project.runtimeModules??[]).find(r=>/^keel-layered-runtime-v\d+$/.test(r.id))??LAYERED_RUNTIME;
  if(manifest.exceptions?.length&&renderer.id==='keel-layered-runtime-v1')throw Error('Save the exception rules to link the updated renderer first.');
  if(manifest.assembly&&!['keel-layered-runtime-v3','keel-layered-runtime-v4'].includes(renderer.id))throw Error('Save the imported assembly to link its renderer first.');
  if(manifest.assembly?.sourceNames&&renderer.id!=='keel-layered-runtime-v4')throw Error('Save the metadata names to link the updated renderer first.');
  const runtimeBytes=await readFile(runtimePath);verifyRuntimeBytes(renderer,runtimeBytes);
  const check=checkLayeredArt(manifest,project.objectIds);if(check.issues.length)throw Error(check.issues.map(i=>i.message).join(' '));
  const sample=await sampleLayeredArt(manifest,100,manifest.seed);if(sample.failures.length)throw Error('Fix broken combinations before preparation: '+sample.failures[0].message);
  const root=await layeredManifestDigest(manifest);const assets=[];
  for(const id of check.uniqueAssets){await store.verifyObject(id);const object=store.read().state.objects.find(o=>o.id===id);assets.push({id,type:object.type,bytes:store.object(id)});}
  let sealed; if(manifest.reveal.encrypted){if(!encryption.available())throw Error('OS-protected storage is required before preparing a private reveal.');sealed=await sealLayeredBundle(manifest,assets);
    store.db.exec('CREATE TABLE IF NOT EXISTS layered_secrets (project_id TEXT NOT NULL, manifest TEXT NOT NULL, cipher TEXT PRIMARY KEY, encrypted BLOB NOT NULL)');
    store.db.prepare('INSERT INTO layered_secrets VALUES (?,?,?,?)').run(project.id,root,sealed.descriptor.ciphertextDigest,encryption.encrypt(JSON.stringify({key:Buffer.from(sealed.key).toString('hex'),descriptor:sealed.descriptor,manifestDigest:root})));
    sealed.key.fill(0);
  }
  // Each preparation gets a new folder; an existing publication or recovery file is never overwritten.
  const folder=path.join(directory,`keel-layers-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);await mkdir(path.join(folder,'objects'),{recursive:true});
  if(sealed)await writeFile(path.join(folder,'objects',sealed.descriptor.ciphertextDigest),sealed.ciphertext,{flag:'wx'});
  else for(const asset of assets)await writeFile(path.join(folder,'objects',asset.id),asset.bytes,{flag:'wx'});
  await writeFile(path.join(folder,'layered-runtime.js'),runtimeBytes,{flag:'wx'});
  await writeFile(path.join(folder,'index.html'),layeredHTML(manifest,sealed?.descriptor,false,Object.fromEntries(assets.map(a=>[a.id,a.type]))),{flag:'wx'});
  const plan={schema:'keel-layered-package@1',manifestDigest:root,encrypted:!!sealed,...(sealed?{sealed:sealed.descriptor}:{}),renderer,
    projectId:project.id,collection:{intent:project.intent,contractIds:project.contractIds},shell:'canonical',delivery:project.presentation.delivery,
    resources:sealed?[{id:`asset-${sealed.descriptor.ciphertextDigest}`,path:`objects/${sealed.descriptor.ciphertextDigest}`,digest:sealed.descriptor.ciphertextDigest,mediaType:'application/octet-stream'}]:assets.map(a=>({id:`asset-${a.id}`,path:`objects/${a.id}`,digest:a.id,mediaType:a.type})),
    ...(sealed?{}:{reuse:manifest.attributes.flatMap(a=>a.items.map(i=>({attribute:a.name,item:i.name,...i.usage})))}),reveal:layeredRevealPlan(manifest),sample:sealed?{count:sample.count,duplicates:sample.duplicates,failures:sample.failures.length,proof:sample.proof}:sample,publicationReady:false,missing:['Selected-network reusable module binding and read-back','Canonical shell wrapping through KEEL publication','Collection authority and frozen allocation integration','Verified per-token seed host adapter',...(sealed?['Verified reveal-contract host adapter and key recovery backup']:[])],signing:'not-performed'};
  await writeFile(path.join(folder,'publication-plan.json'),canonicalLayerJSON(plan),{flag:'wx'});
  await writeFile(path.join(folder,'README.txt'),'LOCAL PREPARATION ONLY\nImport index.html and object resources through KEEL with the canonical verification shell. Resolve the separately reusable renderer on the selected network before upload. The copied renderer is a local setup source, not proof of an onchain module. Do not republish it if its exact digest is already available.\nEncrypted packages intentionally omit plaintext layers and trait names. Back up the private key separately in the editor. The reveal entry point requires a verified chain host adapter; arbitrary seed/key inputs do not establish onchain reveal proof.\n',{flag:'wx'});
  return {directory:folder,message:`Prepared ${assets.length} original layers${sealed?' as an encrypted bundle':''}. Nothing uploaded or signed. ${sealed?'Back up the private reveal key separately.':''}`};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,realpath,chmod,writeFile,access,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const tool=process.env.REVIEW_BOUNDED_ROOT??'/Users/ravonus/dev/wt/native-prerequisites-49d-20261020/keel-contracts/docs/reviews/studio-publication-20261020/native-prerequisites/bounded';
const {Recorder,Halt,hash}=await import(pathToFileURL(path.join(tool,'transport.mjs')));
const {loadRecipe,run}=await import(pathToFileURL(path.join(tool,'runner.mjs')));
for(const mode of ['prepare','execute'])test(`${mode}: actual run entry is parent-directory synced before first RPC`,async()=>{
 const base=await realpath(await mkdtemp(path.join(tmpdir(),'keel-review-parent-sync-')));await chmod(base,0o700);
 const name='parent-durability-case',child=path.join(base,name),syncs=[];
 const original=Recorder.prototype.syncDirectory;
 Recorder.prototype.syncDirectory=async function(){let childExists=false;try{await access(child);childExists=true;}catch{}syncs.push({directory:this.directory,childExists});return original.call(this);};
 let reads=0;
 try{
  const loaded=await loadRecipe(path.join(tool,'recipe.json')),recipe={...loaded.recipe,outputBase:base},recipePath=path.join(base,'fixture-recipe.json');await writeFile(recipePath,JSON.stringify(recipe));
  const current=await loadRecipe(recipePath),admission={schema:'keel-public-native-bounded-admission@1',decision:'ACCEPT',recipeSHA256:current.recipeSHA256,sourceFiles:current.recipe.sourceFiles,allowPublicThreeCreateSimulation:true,maximumSimulations:1,allowFreshPinAndFeeFormula:true,privateProgram:false,signing:false,submission:false,stateOverrides:false};
  const bytes=Buffer.from(JSON.stringify(admission)),admissionPath=path.join(base,'fixture-admission.json');await writeFile(admissionPath,bytes);
  await assert.rejects(run(mode,recipePath,name,admissionPath,hash(bytes),{rpcImpl:async()=>{reads++;throw new Halt('OFFLINE_BOUNDARY','Stop before actual network');}}),e=>e.kind==='OFFLINE_BOUNDARY');
  assert.equal(reads,1);console.log(JSON.stringify({mode,syncs,reads,actualNetwork:0}));
  assert.ok(syncs.some(row=>row.directory===base&&row.childExists),'The newly created run directory entry must be synced in its containing base AFTER mkdir and BEFORE any RPC; syncing only files within the child does not persist its parent entry');
 }finally{Recorder.prototype.syncDirectory=original;await rm(base,{recursive:true,force:true});}
});

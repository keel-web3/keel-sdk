import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {mkdtemp,realpath,chmod,writeFile,access,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const tool=process.env.REVIEW_BOUNDED_ROOT??'/Users/ravonus/dev/wt/native-prerequisites-49d-20261020/keel-contracts/docs/reviews/studio-publication-20261020/native-prerequisites/bounded';
const {Recorder,Halt,hash}=await import(pathToFileURL(path.join(tool,'transport.mjs')));
const {loadRecipe,run}=await import(pathToFileURL(path.join(tool,'runner.mjs')));
for(const mode of ['prepare','execute'])test(`${mode}: failed parent sync prevents first RPC`,async()=>{
 const base=await realpath(await mkdtemp(path.join(tmpdir(),'keel-review-parent-failure-')));await chmod(base,0o700);
 const name='parent-failure-case',child=path.join(base,name),original=Recorder.prototype.syncDirectory;let reads=0,injected=0;
 Recorder.prototype.syncDirectory=async function(){let exists=false;try{await access(child);exists=true;}catch{}if(this.directory===base&&exists){injected++;throw new Halt('REVIEW_PARENT_SYNC_FAILURE','Injected parent directory sync failure');}return original.call(this);};
 try{
  const loaded=await loadRecipe(path.join(tool,'recipe.json')),recipe={...loaded.recipe,outputBase:base},recipePath=path.join(base,'fixture-recipe.json');await writeFile(recipePath,JSON.stringify(recipe));
  const current=await loadRecipe(recipePath),admission={schema:'keel-public-native-bounded-admission@1',decision:'ACCEPT',recipeSHA256:current.recipeSHA256,sourceFiles:current.recipe.sourceFiles,allowPublicThreeCreateSimulation:true,maximumSimulations:1,allowFreshPinAndFeeFormula:true,privateProgram:false,signing:false,submission:false,stateOverrides:false},bytes=Buffer.from(JSON.stringify(admission)),admissionPath=path.join(base,'fixture-admission.json');await writeFile(admissionPath,bytes);
  await assert.rejects(run(mode,recipePath,name,admissionPath,hash(bytes),{rpcImpl:async()=>{reads++;throw new Halt('OFFLINE_BOUNDARY','No actual network');}}),e=>e.kind==='REVIEW_PARENT_SYNC_FAILURE');
  assert.equal(injected,1);assert.equal(reads,0);console.log(JSON.stringify({mode,injected,reads,actualNetwork:0}));
 }finally{Recorder.prototype.syncDirectory=original;await rm(base,{recursive:true,force:true});}
});

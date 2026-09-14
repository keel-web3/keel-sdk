import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIntegrity } from '../packages/protocol/dist/index.js';
import { prepareUnverifiedClassicModule } from '../packages/builder/dist/module-unverified.js';
import { createKeelModuleInclusions } from '../packages/builder/dist/module-inclusion.js';
import { syncKeelModuleEditor, checkKeelModuleEditor } from '../packages/builder/dist/module-editor.js';

test('unverified module inference, explicit paths, exclusion, and immutable output', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'keel-editor-test-'));
  const source='function KEEL_solarDates(year = 2026, options = { includeLunar: false }) { return {year, lunar: options.includeLunar}; }';
  const integrity=await createIntegrity(new TextEncoder().encode(source));
  const observation={schema:'keel-module-observation@1',digest:integrity.digest,trust:'unverified-observation',globals:{KEEL_solarDates:{kind:'function',arity:0}},exports:{}};
  await mkdir(path.join(root,'node_modules/@keel-modules'),{recursive:true});
  const outputDirectory=path.join(root,'node_modules/@keel-modules/solar');
  const input={name:'solar',source,observation,outputDirectory};
  await assert.rejects(prepareUnverifiedClassicModule({...input,source:source+' '}),/do not match/);
  const prepared=await prepareUnverifiedClassicModule(input);
  assert.equal(prepared.verification,'unverified');
  await assert.rejects(prepareUnverifiedClassicModule(input),/EEXIST/);
  assert.match(await readFile(path.join(outputDirectory,'index.d.ts'),'utf8'),/year\?: number/);
  const modules=[{name:'solar',specifier:'@keel-modules/solar'}];
  const included=createKeelModuleInclusions(root,modules);
  assert(included.names.includes('solarDates') && included.names.includes('KEEL_solarDates'));
  await writeFile(path.join(root,'art.ts'),'solarDates(2026, {includeLunar:true}); KEEL_solarDates(2027);');
  let editor=await syncKeelModuleEditor(root,modules,['art.ts']);
  checkKeelModuleEditor(root,['art.ts'],editor.files);
  await writeFile(path.join(root,'art.ts'),'solarDates("bad");');
  assert.throws(()=>checkKeelModuleEditor(root,['art.ts'],editor.files),/not assignable/);
  editor=await syncKeelModuleEditor(root,[],['art.ts']);
  assert.throws(()=>checkKeelModuleEditor(root,['art.ts'],editor.files),/Cannot find name 'solarDates'/);
});

test('default module paths and ambiguous aliases',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'keel-alias-test-'));
 for(const name of ['first','second']){
  const directory=path.join(root,'node_modules',name);await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({name,types:'index.d.ts'}));
  await writeFile(path.join(directory,'index.d.ts'),'export declare function snapshot(label?: string): void;');
 }
 const one=createKeelModuleInclusions(root,[{name:'first',specifier:'first'}]);
 assert(one.names.includes('KEEL_first_snapshot'));
 assert.throws(()=>createKeelModuleInclusions(root,[{name:'first',specifier:'first'},{name:'second',specifier:'second'}]),/Ambiguous/);
 const two=createKeelModuleInclusions(root,[{name:'first',specifier:'first'},{name:'second',specifier:'second',aliases:{snapshot:'secondSnapshot'}}]);
 assert(two.names.includes('secondSnapshot'));
});

test('CLI discovery needs no directory argument and watcher removes excluded globals', async()=>{
 const {execFile}=await import('node:child_process');
 const {promisify}=await import('node:util');
 const run=promisify(execFile);
 const root=await mkdtemp(path.join(os.tmpdir(),'keel-watch-test-'));
 await writeFile(path.join(root,'upload.js'),'function KEEL_test() {}');
 const result=await run(process.execPath,['packages/builder/dist/cli.js','module','observe','--file',path.join(root,'upload.js'),'--out',path.join(root,'discover.html')]);
 assert.match(result.stdout,/isolated browser sandbox/);
 const directory=path.join(root,'node_modules/example');await mkdir(directory,{recursive:true});
 await writeFile(path.join(directory,'package.json'),' {"types":"index.d.ts"}');
 await writeFile(path.join(directory,'index.d.ts'),'export declare const sample: number;');
 await writeFile(path.join(root,'art.ts'),'sample;');
 await writeFile(path.join(root,'keel.includes.json'),JSON.stringify([{name:'example',specifier:'example'}]));
 const {watchKeelModuleEditor}=await import('../packages/builder/dist/module-editor.js');
 const errors=[];
 const watcher=await watchKeelModuleEditor(root,['art.ts'],'keel.includes.json',error=>errors.push(error));
 try{
  assert.match(await readFile(path.join(root,'.keel/module-inclusions.d.ts'),'utf8'),/sample/);
  await writeFile(path.join(root,'keel.includes.json'),'[]');
  let removed=false;
  for(let i=0;i<30;i++){
   await new Promise(resolve=>setTimeout(resolve,100));
   if(!(await readFile(path.join(root,'.keel/module-inclusions.d.ts'),'utf8')).includes('sample')){removed=true;break;}
  }
  assert.deepEqual(errors,[]);
  assert(removed,'Watcher left stale included globals');
 }finally{watcher.close();}
});

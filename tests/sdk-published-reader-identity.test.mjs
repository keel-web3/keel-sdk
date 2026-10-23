import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPublishedViewReaderModule,buildCurrentPublishedViewReaderModule,KEEL_PUBLISHED_VIEW_READER_V1} from '../packages/sdk/dist/verification-shell.js';
const root=path.resolve(import.meta.dirname,'..');
const sha=bytes=>'0x'+createHash('sha256').update(bytes).digest('hex');

test('the packaged default published reader retains its exact maintained source identity',async()=>{
 const source=await readFile(path.join(root,'packages/sdk/src/assets/keel-published-view-reader-v1.js'));
 const packaged=await readFile(path.join(root,'packages/sdk/dist/assets/keel-published-view-reader-v1.js'));
 const provenance=JSON.parse(await readFile(path.join(root,'packages/sdk/dist/assets/keel-published-view-reader-v1.provenance.json'),'utf8'));
 assert.equal(provenance.sourceSdkCommit,'f0fca973ba0fd5fbe805ab5d21fd04bfad9ec44a');assert.equal(provenance.sha256,sha(packaged).slice(2));
 assert.deepEqual(packaged,source);
 assert.equal(packaged.length,251050);assert.equal(sha(packaged),'0x978e5fed29103cc72a2272f908421f14a587009d959aa40d3a1853af130bae1a');
 const original=await buildPublishedViewReaderModule();assert.deepEqual(original.source,new Uint8Array(packaged));assert.deepEqual(original.integrity,KEEL_PUBLISHED_VIEW_READER_V1);
 original.source.fill(0);assert.deepEqual((await buildPublishedViewReaderModule()).source,new Uint8Array(packaged));
 const candidate=await buildCurrentPublishedViewReaderModule();assert.equal(sha(candidate.source),candidate.integrity.digest);assert.notEqual(candidate.integrity.digest,original.integrity.digest);
});

test('a clean copied package authenticates actual reader bytes and fails closed on missing or changed assets',async()=>{
 const scratch=await mkdtemp(path.join(tmpdir(),'keel-reader-package-'));
 try{
  const asset=path.join(scratch,'assets/keel-published-view-reader-v1.js');
  // Copy the compiled module and its package siblings, while resolving npm
  // dependencies from the installed SDK. This exercises a different cwd/URL.
  const {cp,symlink}=await import('node:fs/promises');
  await cp(path.join(root,'packages/sdk/dist'),scratch,{recursive:true});
  await writeFile(path.join(scratch,'package.json'),' {"type":"module"}');
  await symlink(path.join(root,'packages/sdk/node_modules'),path.join(scratch,'node_modules'),'dir');
  const module=await import(pathToFileURL(path.join(scratch,'verification-shell.js')).href);
  assert.equal((await module.buildPublishedViewReaderModule()).integrity.digest,KEEL_PUBLISHED_VIEW_READER_V1.digest);
  await writeFile(asset,new Uint8Array(251050));await assert.rejects(module.buildPublishedViewReaderModule(),/digest or byte-length/);
  await rm(asset);await assert.rejects(module.buildPublishedViewReaderModule(),/ENOENT/);
 }finally{await rm(scratch,{recursive:true,force:true});}
});

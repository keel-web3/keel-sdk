// Default, source-only pre-spawn guards. Actual process/isolation/stage controls
// are mandatory in scripts/native/native-session-process.test.mjs with explicit
// reviewed binary and synthetic fixture inputs; they are never silently skipped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeProcessClient } from '../scripts/lib/native-session-process.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'keel-native-input-guards-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const binaryPath=join(dir,'nonexecutable-test-bytes'),inputPath=join(dir,'witness.json');
  writeFileSync(binaryPath,'synthetic public test file');writeFileSync(inputPath,'{}');
  return {dir,options:{binaryPath,inputPath,binarySHA256:digest('synthetic public test file'),inputSHA256:digest('{}')}};
}
test('binary byte drift refuses before process launch',async t=>{
  const {options}=fixture(t);await assert.rejects(createNativeProcessClient({...options,binarySHA256:'0'.repeat(64)}),/reviewed build/);
});
test('canonical witness byte drift refuses before process launch',async t=>{
  const {options}=fixture(t);await assert.rejects(createNativeProcessClient({...options,inputSHA256:'0'.repeat(64)}),/witness input changed/);
});
test('symlink or relative binary/input cannot satisfy immutable file boundary',async t=>{
  const {dir,options}=fixture(t),link=join(dir,'linked');symlinkSync(options.inputPath,link);
  await assert.rejects(createNativeProcessClient({...options,inputPath:link}),/Regular non-symlink/);
  await assert.rejects(createNativeProcessClient({...options,binaryPath:'relative-file'}));
});
test('unbounded, zero, fractional and negative request timeouts reject before spawn',async t=>{
  const {options}=fixture(t);for(const timeoutMs of [0,-1,0.5,120001,Infinity])await assert.rejects(createNativeProcessClient({...options,timeoutMs}));
});

import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,createReadStream,mkdtempSync,cpSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
const build=resolve(process.env.KEEL_NATIVE_BUILD_DIR??'/tmp/keel-proof-executor-build');
const receipt=JSON.parse(readFileSync(join(build,'receipt.json'),'utf8'));
for(const [name,expected] of [['keel-proof-executor',receipt.binarySha256],['keel-proof-runner',receipt.brokerSha256]])assert.equal(createHash('sha256').update(readFileSync(join(build,name))).digest('hex'),expected);
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['ignore','pipe','pipe']}).trim();
const tag=`keel-proof-runner:${receipt.sdkCommit}`;
const context=mkdtempSync(join(tmpdir(),'keel-runner-image-'));
try{
 for(const name of ['keel-proof-executor','keel-proof-runner','receipt.json'])cpSync(join(build,name),join(context,name));
 docker('build','--network','none','--pull=false','-f',resolve('native/proof-executor/runner.Dockerfile'),'-t',tag,context);
}finally{rmSync(context,{recursive:true,force:true});}
const inspect=JSON.parse(docker('image','inspect',tag))[0],archive=join(build,'keel-proof-runner.tar');
assert.deepEqual(inspect.Config.Entrypoint,['/runner']);assert.equal(inspect.Config.User,'1000:1000');
docker('save','--output',archive,tag);docker('image','rm',tag);docker('load','--input',archive);
assert.equal(JSON.parse(docker('image','inspect',tag))[0].Id,inspect.Id,'saved archive reload must restore the exact image');
const digest=createHash('sha256');for await(const chunk of createReadStream(archive))digest.update(chunk);
const imageReceipt={...receipt,schema:'keel-proof-runner-image@1',imageId:inspect.Id,imageBytes:inspect.Size,archiveSha256:digest.digest('hex'),archiveReloadVerified:true};
writeFileSync(join(build,'runner-image-receipt.json'),JSON.stringify(imageReceipt,null,2)+'\n');console.log(JSON.stringify(imageReceipt));

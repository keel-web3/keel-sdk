import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createIsolatedRunnerSpawner} from '../native/proof-executor/runner-client.mjs';
const digest='a'.repeat(64),hello={type:'runner',schema:'keel-proof-runner@1',binarySha256:digest,maximumConcurrency:1,maximumWallTimeMs:180000};
async function fixture(t,frames){
 const dir=await mkdtemp(join(tmpdir(),'runner-client-test-')),socketPath=join(dir,'runner.sock');let input='';
 const server=createServer(socket=>{socket.on('error',()=>{});socket.on('data',c=>input+=c);socket.end(frames.map(frame=>JSON.stringify(frame)).join('\n')+'\n');});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});
 const child=createIsolatedRunnerSpawner({socketPath,binarySha256:digest})();let output='';child.stdout.on('data',c=>output+=c);child.stderr.resume();child.stdin.write('PRIVATE TEST INPUT\n');
 const code=await new Promise(resolve=>child.once('close',resolve));return {code,input,output};
}
test('valid broker identity and final zero exit permit completion',async t=>{
 const result=await fixture(t,[hello,{type:'result',synthetic:true},{type:'runner-exit',code:0}]);assert.equal(result.code,0);assert.match(result.output,/synthetic/);
});
for(const [name,frames] of [
 ['missing exit',[hello,{type:'result'}]],['nonzero exit',[hello,{type:'result'},{type:'runner-exit',code:1}]],
 ['wrong identity',[{...hello,binarySha256:'b'.repeat(64)}]],['wrong concurrency',[{...hello,maximumConcurrency:2}]],
 ['unbounded wall time',[{...hello,maximumWallTimeMs:180001}]],['primitive frame',[null]],['array frame',[[]]],
 ['result before identity',[{type:'result'}]],['trailing result',[hello,{type:'runner-exit',code:0},{type:'result'}]],
 ['unknown frame',[hello,{type:'unexpected'}]],['invalid exit',[hello,{type:'runner-exit',code:7}]],
 ['busy',[{type:'error',category:'runner-busy'}]],
])test(`${name} cannot be a successful native completion`,async t=>{
 const result=await fixture(t,frames);assert.equal(result.code,1);
 if(frames[0]?.type!=='runner'||frames[0].binarySha256!==digest||frames[0].maximumConcurrency!==1||frames[0].maximumWallTimeMs>180000)assert.equal(result.input,'');
});

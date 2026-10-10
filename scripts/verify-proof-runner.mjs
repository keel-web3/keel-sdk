import assert from 'node:assert/strict';
import { spawn,execFileSync } from 'node:child_process';
import { mkdtempSync,readFileSync,writeFileSync,copyFileSync,renameSync,chmodSync,rmSync,existsSync,mkdirSync,symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createConnection } from 'node:net';
import { createIsolatedRunnerSpawner } from '../native/proof-executor/runner-client.mjs';

const root=process.cwd(),source=join(root,'native/proof-executor/runner'),directory=mkdtempSync(join(tmpdir(),'keel-runner-guards-'));
const image='node@sha256:6c74791e557ce11fc957704f6d4fe134a7bc8d6f5ca4403205b2966bd488f6b3',go=process.env.KEEL_GO_BINARY??'go';
const uid=process.getuid(),container=`keel-runner-guards-${process.pid}`,binary=join(directory,'runner'),target=join(directory,'executor');
const evidence={schema:'keel-proof-runner-qualification@1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),synthetic:true,network:'none',checks:[]};
const record=name=>{evidence.checks.push(name);console.log(`PASS ${name}`);};
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe']}).trim();
const build=(output,pkg,extra=[])=>execFileSync(go,['build','-buildvcs=false','-trimpath',...extra,'-o',output,pkg],{cwd:source,env:{...process.env,CGO_ENABLED:'0'},stdio:'inherit',timeout:120000});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
let running=false;
const sock=join(directory,'socket');mkdirSync(sock,{mode:0o700});
const socketPath=join(sock,'runner.sock');
let digest;
function start({name=container,expected=digest,wall='3s',binaryPath='/artifacts/executor',mode='ro',extra=[]}={}){
 return docker('run','--pull=never','-d','--name',name,'--init','--network','none','--memory','768m','--cpus','2','--pids-limit','64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${uid}:${process.getgid()}`,'-e','SECRET_FIXTURE=must-not-reach-child','-v',`${directory}:/artifacts:${mode}`,'-v',`${sock}:/run/keel-proof:rw`,'--entrypoint','/artifacts/runner',image,'--binary',binaryPath,'--sha256',expected,'--socket','/run/keel-proof/runner.sock','--uid',String(uid),'--wall-time',wall,...extra);
}
async function waitSocket(){for(let i=0;i<100;i++){if(existsSync(socketPath))return;await delay(20);}throw new Error('runner socket did not appear');}
function request(mode,{spawnExecutor=createIsolatedRunnerSpawner({socketPath,binarySha256:digest})}={}){
 const child=spawnExecutor();let data='';child.stdout.on('data',chunk=>data+=chunk);child.stderr.resume();
 const done=new Promise(resolve=>child.once('close',code=>resolve({code,frames:data.trim()?data.trim().split('\n').map(line=>JSON.parse(line)):[]})));
 child.stdin.write(`${JSON.stringify({mode})}\n`);return {child,done};
}
async function exitStatus(name){for(let i=0;i<100;i++){const state=JSON.parse(docker('inspect','--format','{{json .State}}',name));if(!state.Running)return state.ExitCode;await delay(20);}throw new Error('runner did not stop');}
async function noChildren(){for(let i=0;i<100;i++){if(!/keel-proof-executor|grandchild/.test(docker('top',container,'-eo','pid,args')))return;await delay(20);}throw new Error('executor child was not reaped');}
function rawOutputBudget(){return new Promise((resolve,reject)=>{
 const socket=createConnection(socketPath);let hello=false,bytes=0;
 socket.setTimeout(6000,()=>socket.destroy(new Error('quota test deadline')));
 socket.on('error',reject);socket.on('data',chunk=>{if(!hello){hello=true;socket.write('{"mode":"output"}\n');return;}bytes+=chunk.length;});
 socket.on('close',()=>resolve(bytes));
});}
async function isolatedClient(clientUID){
 const child=spawn('docker',['run','--pull=never','--rm','-i','--network','none','--memory','128m','--pids-limit','32','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user',`${clientUID}:${process.getgid()}`,'-v',`${sock}:/run/keel-proof:ro`,'-v',`${join(root,'native/proof-executor')}:/client:ro`,'-e','KEEL_RUNNER_SOCKET=/run/keel-proof/runner.sock','-e',`KEEL_EXECUTOR_SHA256=${digest}`,image,'node','/client/runner-relay.mjs'],{stdio:['pipe','pipe','pipe']});
 let data='';child.stdout.on('data',c=>data+=c);child.stderr.resume();child.stdin.write('{"mode":"inspect"}\n');
 return new Promise(resolve=>child.once('close',code=>resolve({code,data})));
}
try{
 docker('image','inspect',image);build(binary,'.');build(target,'./fixtures/executor');digest=sha(target);chmodSync(binary,0o555);chmodSync(target,0o555);
 start();running=true;await waitSocket();
 const config=JSON.parse(docker('inspect',container))[0];
 assert.equal(config.HostConfig.NetworkMode,'none');assert.equal(config.HostConfig.Memory,768*1024*1024);assert.equal(config.HostConfig.NanoCpus,2e9);assert.equal(config.HostConfig.PidsLimit,64);assert.equal(config.HostConfig.ReadonlyRootfs,true);assert.deepEqual(config.HostConfig.CapDrop,['ALL']);assert.ok(config.HostConfig.SecurityOpt.includes('no-new-privileges'));assert.equal(config.Mounts.find(m=>m.Destination==='/artifacts').RW,false);
 const first=await request('inspect').done;assert.equal(first.code,0);const info=first.frames[0];assert.equal(info.marker,'original');assert.deepEqual(info.environment.sort(),['GOMAXPROCS=2','GOMEMLIMIT=512MiB']);assert.deepEqual(info.interfaces,['lo']);assert.equal(info.uid,uid);assert.equal(info.rootWriteRefused,true);assert.equal(info.rootEscalationRefused,true);
 record('actual child is unprivileged with no network, no secret environment, read-only root and checked hard limits');
 assert.equal(info['memory.max'],String(768*1024*1024));assert.equal(info['pids.max'],'64');assert.equal(info['cpu.max'],'200000 100000');
 assert.equal((await isolatedClient(uid)).code,0);record('application container can use a read-only socket-directory mount');
 chmodSync(sock,0o711);chmodSync(socketPath,0o666);
 try{const foreign=await isolatedClient(uid+1);assert.equal(foreign.code,1);assert.equal(foreign.data,'');}finally{chmodSync(sock,0o700);chmodSync(socketPath,0o600);}
 record('kernel peer UID check rejects a different user even when fixture permissions allow connection');
 const replacement=join(directory,'replacement');build(replacement,'./fixtures/executor',['-ldflags','-X main.marker=replacement']);renameSync(replacement,target);
 const bound=await request('inspect').done;assert.equal(bound.code,0);assert.equal(bound.frames[0].marker,'original');record('actual executed file remains the verified open inode after the pathname is replaced');
 const pending=request('hang');await delay(100);const busy=await request('inspect').done;assert.equal(busy.code,1);assert.equal(busy.frames[0].category,'runner-busy');pending.child.kill();await pending.done;await noChildren();
 assert.equal((await request('inspect').done).code,0);record('one active execution, no queue, cancellation reaps the process and a clean retry succeeds');
 const before=Date.now();assert.equal((await request('hang').done).code,1);assert.ok(Date.now()-before<5000);await noChildren();record('independent broker deadline kills and reaps a stalled child');
 assert.equal((await request('fail').done).code,1);assert.equal((await request('stderr').done).code,1);await noChildren();record('nonzero exit and diagnostic quota cannot produce successful completion');
 const descendant=await request('descendant').done;assert.equal(descendant.code,0);await noChildren();record('descendant process groups are killed and reaped after completion');
 const pids=await request('pids').done;assert.equal(pids.code,0);assert.equal(pids.frames[0].pidLimitEnforced,true);await noChildren();record('actual PID exhaustion is bounded and descendant cleanup restores capacity');
 const memoryEvents=()=>Object.fromEntries(docker('exec',container,'cat','/sys/fs/cgroup/memory.events').split('\n').map(line=>line.split(' ')));
 const beforeOOM=Number(memoryEvents().oom_kill);assert.equal((await request('memory').done).code,1);await noChildren();assert.ok(Number(memoryEvents().oom_kill)>beforeOOM,'kernel must record an actual cgroup OOM kill');assert.equal((await request('inspect').done).code,0);record('actual memory exhaustion cannot pass and leaves the broker able to retry');
 const outputBytes=await rawOutputBudget();assert.ok(outputBytes<=64*1024*1024+128);assert.ok(outputBytes>60*1024*1024);await noChildren();record('broker output quota terminates an oversized stream independently of client framing');
 const simultaneous=`${container}-other`;start({name:simultaneous});assert.notEqual(await exitStatus(simultaneous),0);docker('rm',simultaneous);assert.equal((await request('inspect').done).code,0);record('concurrent startup cannot unlink or replace the live runner socket');
 // Recreate the original executable so restart is checked against its expected hash.
 build(target,'./fixtures/executor');chmodSync(target,0o555);
 const killed=request('hang');await delay(100);docker('kill','--signal','KILL',container);await killed.done;assert.ok(existsSync(socketPath),'SIGKILL leaves the filesystem socket to recover');docker('start',container);await delay(100);await waitSocket();assert.equal((await request('inspect').done).code,0);record('SIGKILL followed by restart safely recovers the owned stale socket');
 docker('rm','-f',container);running=false;await delay(20);
 for(const [name,settings] of [['wrong-hash',{expected:'0'.repeat(64)}],['writable-binary',{mode:'rw'}]]){
  const instance=`${container}-${name}`;start({name:instance,...settings});assert.notEqual(await exitStatus(instance),0);docker('rm',instance);record(`${name} cannot start a runner`);
 }
 rmSync(socketPath,{force:true});symlinkSync(target,socketPath);start();running=true;assert.notEqual(await exitStatus(container),0);assert.equal(sha(target),digest);docker('rm',container);running=false;rmSync(socketPath);record('malicious socket symlink is refused without altering its target');
 evidence.binarySha256=digest;evidence.brokerSha256=sha(binary);evidence.hardLimits={memoryBytes:768*1024*1024,nanoCPUs:2e9,pids:64,maximumActive:1,queue:0};
}catch(error){evidence.failure={name:error.name,message:error.message};process.exitCode=1;console.error(error);if(running){try{console.error(docker('logs',container));}catch{}}}
finally{if(process.env.KEEL_RUNNER_EVIDENCE)writeFileSync(process.env.KEEL_RUNNER_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');if(running){try{docker('rm','-f',container);}catch{}}rmSync(directory,{recursive:true,force:true});}

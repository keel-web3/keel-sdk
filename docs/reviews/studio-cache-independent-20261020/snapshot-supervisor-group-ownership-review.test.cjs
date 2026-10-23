const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {spawn,execFileSync}=require('node:child_process'),{Writable}=require('node:stream');
const helper=process.env.REVIEW_SNAPSHOT_SUPERVISOR||'/private/tmp/keel-snapshot-supervisor-7a2-source.cjs';
const terminated=pid=>{try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')return true;throw e;}try{return execFileSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).includes('Z');}catch{return true;}};
test('timeout kills a TERM-ignoring owned descendant and preserves another process group',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'keel-review-snapshot-group-')),saved={PATH:process.env.PATH,POSTGRES_USER:process.env.POSTGRES_USER,POSTGRES_DB:process.env.POSTGRES_DB,REVIEW_GROUP_ROOT:process.env.REVIEW_GROUP_ROOT};
 const neighbor=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});let leader;
 try{
  await fs.writeFile(path.join(root,'pg_dump'),'#!/usr/bin/python3\nimport os,signal,time\nr=os.environ["REVIEW_GROUP_ROOT"]\nopen(r+"/leader","w").write(str(os.getpid()))\np=os.fork()\nif p==0:\n signal.signal(signal.SIGTERM,signal.SIG_IGN)\n open(r+"/descendant","w").write(str(os.getpid()))\n os.close(1);os.close(2)\n time.sleep(60)\n os._exit(0)\nos.write(1,b"PGDMP-partial")\ntime.sleep(60)\n',{mode:0o700});
  Object.assign(process.env,{PATH:root,POSTGRES_USER:'synthetic',POSTGRES_DB:'synthetic',REVIEW_GROUP_ROOT:root});
  const {runSnapshot}=require(helper),output=new Writable({write(_c,_e,done){done();}});
  const r=await runSnapshot(32,{output,setTimer:(fn,ms)=>setTimeout(fn,ms===150000?500:ms===5000?150:ms),clearTimer:clearTimeout});
  leader=Number(await fs.readFile(path.join(root,'leader'),'utf8'));const descendant=Number(await fs.readFile(path.join(root,'descendant'),'utf8'));
  for(let i=0;i<100&&!terminated(descendant);i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(r.result,'FAIL');assert.equal(r.category,'snapshot-timeout');assert.equal(r.childClosed,true);assert.equal(r.termSent,true);assert.equal(r.killSent,true);assert.equal(terminated(descendant),true,'owned TERM-ignoring descendant must terminate');assert.equal(neighbor.exitCode,null);assert.equal(terminated(neighbor.pid),false,'unrelated process group must remain alive');
  console.log(JSON.stringify({result:r.result,category:r.category,ownedDescendantTerminated:true,otherGroupPreserved:true,actualDockerCalls:0}));
 }finally{
  if(leader)try{process.kill(-leader,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  try{process.kill(-neighbor.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
  await new Promise(resolve=>neighbor.exitCode!==null||neighbor.signalCode!==null?resolve():neighbor.once('close',resolve));
  for(const [key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;
  await fs.rm(root,{recursive:true,force:true});
 }
});

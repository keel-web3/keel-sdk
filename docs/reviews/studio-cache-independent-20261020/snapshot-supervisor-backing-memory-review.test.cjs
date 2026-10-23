const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {Writable}=require('node:stream');
const helper=process.env.REVIEW_SNAPSHOT_SUPERVISOR||'/private/tmp/keel-snapshot-supervisor-7a2-source.cjs';
test('actual supervisor retains only bounded diagnostic bytes, without zero-length backing views',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'keel-review-snapshot-backing-'));
 const oldPath=process.env.PATH,oldUser=process.env.POSTGRES_USER,oldDB=process.env.POSTGRES_DB,original=Buffer.concat;
 const scanned=[];
 try{
  const executable=path.join(root,'pg_dump');
  await fs.writeFile(executable,'#!/usr/bin/python3\nimport os,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\nos.write(1,b"PGDMP")\nfor i in range(64): os.write(2,b"x"*65536)\ntime.sleep(60)\n',{mode:0o700});
  process.env.PATH=root;process.env.POSTGRES_USER='synthetic';process.env.POSTGRES_DB='synthetic';
  Buffer.concat=function(values,...rest){
   if(values.some(v=>v.length===0&&v.buffer.byteLength>0)){
    const buffers=new Set(values.map(v=>v.buffer));scanned.push({views:values.length,zeroBackingViews:values.filter(v=>v.length===0&&v.buffer.byteLength>0).length,logicalBytes:values.reduce((s,v)=>s+v.length,0),uniqueBackingBytes:[...buffers].reduce((s,b)=>s+b.byteLength,0)});
   }
   return original.call(this,values,...rest);
  };
  const {runSnapshot}=require(helper),output=new Writable({write(_chunk,_encoding,done){done();}});
  const result=await runSnapshot(32,{output,setTimer:(fn,ms)=>setTimeout(fn,ms===150000?1000:ms===5000?250:ms),clearTimer:clearTimeout});
  assert.equal(result.result,'FAIL');assert.equal(result.category,'diagnostic-limit');assert.equal(result.childClosed,true);assert.equal(result.killSent,true);assert.equal(result.stderrRetainedBytes,16384);
  console.log(JSON.stringify({result:result.result,category:result.category,stderrBytes:result.stderrBytes,stderrRetainedBytes:result.stderrRetainedBytes,scanned,actualDockerCalls:0}));
  assert.equal(scanned.length,0,'Zero-length diagnostic slices must not retain every excess stderr backing buffer until completion');
 }finally{
  Buffer.concat=original;
  for(const [key,value]of [['PATH',oldPath],['POSTGRES_USER',oldUser],['POSTGRES_DB',oldDB]])if(value===undefined)delete process.env[key];else process.env[key]=value;
  await fs.rm(root,{recursive:true,force:true});
 }
});

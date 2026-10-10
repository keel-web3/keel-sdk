import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createConnection } from 'node:net';
import { isAbsolute } from 'node:path';

/** Local IPC only. Native calldata is buffered until the broker's immutable
 * executable identity is checked. A result needs the broker's final exit frame.
 * Deployment separately verifies the actual container/image/security settings.
 */
export function createIsolatedRunnerSpawner({socketPath,binarySha256}) {
  if(!isAbsolute(socketPath)||!socketPath.endsWith('/runner.sock')||!/^[a-f0-9]{64}$/.test(binarySha256))throw new TypeError('Pinned local runner identity required.');
  return function spawnExecutor(){
    const child=new EventEmitter();
    child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    const socket=createConnection({path:socketPath});
    let ready=false,done=false,exitCode,buffer=Buffer.alloc(0),bytes=0;
    const finish=code=>{if(done)return;done=true;socket.destroy();child.stdin.destroy();child.stdout.end();child.stderr.end();child.emit('close',code);};
    child.kill=()=>{finish(1);return true;};
    socket.setTimeout(181000,()=>finish(1));
    socket.on('error',()=>finish(1));
    socket.on('close',()=>finish(exitCode===0&&buffer.length===0?0:1));
    socket.on('data',chunk=>{
      if(done)return;bytes+=chunk.length;
      if(bytes>64*1024*1024+4096){finish(1);return;}
      buffer=Buffer.concat([buffer,chunk]);let boundary;
      while(!done&&(boundary=buffer.indexOf(10))>=0){
        const raw=buffer.subarray(0,boundary);buffer=buffer.subarray(boundary+1);
        let frame;try{frame=JSON.parse(raw.toString('utf8'));}catch{finish(1);return;}
        if(!frame||typeof frame!=='object'||Array.isArray(frame)){finish(1);return;}
        if(exitCode!==undefined){finish(1);return;}
        if(!ready){
          if(frame.type==='error'&&frame.category==='runner-busy'){child.stdout.write(`${JSON.stringify(frame)}\n`);finish(1);return;}
          if(frame.type!=='runner'||frame.schema!=='keel-proof-runner@1'||frame.binarySha256!==binarySha256||frame.maximumConcurrency!==1||!Number.isSafeInteger(frame.maximumWallTimeMs)||frame.maximumWallTimeMs<=0||frame.maximumWallTimeMs>180000){finish(1);return;}
          ready=true;child.stdin.pipe(socket,{end:false});continue;
        }
        if(frame.type==='runner-exit'){
          if(![0,1].includes(frame.code)){finish(1);return;}exitCode=frame.code;continue;
        }
        if(!['read','result','error'].includes(frame.type)){finish(1);return;}
        child.stdout.write(Buffer.concat([raw,Buffer.from('\n')]));
      }
      if(buffer.length>34*1024*1024)finish(1);
    });
    child.stdin.on('error',()=>finish(1));
    return child;
  };
}

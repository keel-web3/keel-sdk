import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter,once,errorMonitor} from 'node:events';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import * as offline from './support/offline-shell-browser.mjs';

async function resetDeniedConnect(mode) {
  const targets=[],errors=[],events=[];
  const server=createServer();
  let accepted;
  server.on('connect',(request,socket)=>{
    targets.push(`CONNECT ${request.url}`);
    accepted=socket;
    socket.on('finish',()=>events.push('denial-finished'));
    socket.on('close',()=>events.push('socket-closed'));
    if(mode==='baseline') {
      // Exact old denial write: an established peer's reset had no error listener.
      socket.end('HTTP/1.1 502 Blocked\r\nConnection: close\r\n\r\n');
    } else {
      socket.on(errorMonitor,error=>events.push(error.code));
      offline.endDeniedProxyConnect(socket,error=>errors.push({code:error.code,message:error.message}));
    }
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const client=connect(server.address().port,'127.0.0.1');
  const timeout=setTimeout(()=>{accepted?.destroy();client.destroy();server.close();throw Error('Loopback CONNECT reset did not finish');},3000);
  const received=[];
  client.on('error',error=>{throw error;});
  client.on('data',chunk=>{received.push(chunk);client.resetAndDestroy();});
  client.write('CONNECT blocked.invalid:443 HTTP/1.1\r\nHost: blocked.invalid:443\r\n\r\n');
  await once(client,'close');
  // The peer reset is delivered on the server's real TCP read side.
  if(accepted&&!accepted.closed)await new Promise(resolve=>accepted.once('close',resolve));
  await new Promise(resolve=>server.close(resolve));clearTimeout(timeout);
  console.log(JSON.stringify({targets,errors,events,response:Buffer.concat(received).toString()}));
}

if(process.argv[2]==='--connect-reset-child') {
  await resetDeniedConnect(process.argv[3]);
} else {
  function child(mode) {
    return new Promise((resolve,reject)=>{
      const processChild=spawn(process.execPath,[fileURLToPath(import.meta.url),'--connect-reset-child',mode],{stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='';processChild.stdout.on('data',chunk=>stdout+=chunk);processChild.stderr.on('data',chunk=>stderr+=chunk);
      const timeout=setTimeout(()=>{processChild.kill('SIGKILL');reject(Error('CONNECT child failed to terminate'));},5000);
      processChild.on('error',error=>{clearTimeout(timeout);reject(error);});
      processChild.on('exit',(code,signal)=>{clearTimeout(timeout);resolve({code,signal,stdout,stderr});});
    });
  }
  test('original raw CONNECT denial reproduces the uncaught real TCP reset',async()=>{
    const result=await child('baseline');assert.equal(result.code,1);assert.equal(result.signal,null);
    assert.match(result.stderr,/Unhandled 'error' event/u);assert.match(result.stderr,/read ECONNRESET/u);
  });
  test('completed denial keeps exact target and response while accepting real TCP peer reset',async()=>{
    const result=await child('fixed');assert.equal(result.code,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.stderr,'');
    const report=JSON.parse(result.stdout);assert.deepEqual(report.targets,['CONNECT blocked.invalid:443']);assert.deepEqual(report.errors,[]);
    assert.deepEqual(report.events,['denial-finished','ECONNRESET','socket-closed']);
    assert.equal(report.response,'HTTP/1.1 502 Blocked\r\nConnection: close\r\n\r\n');
  });
  for(const [finished,code] of [[false,'ECONNRESET'],[false,'EPIPE'],[true,'EPIPE'],[true,'EACCES']]) {
    test(`unexpected CONNECT socket error remains visible (finished=${finished}, ${code})`,()=>{
      const socket=new EventEmitter(),errors=[];let written;
      socket.end=value=>{written=value;};offline.endDeniedProxyConnect(socket,error=>errors.push(error));
      if(finished)socket.emit('finish');const error=Object.assign(Error('preserved unexpected socket error'),{code});socket.emit('error',error);
      assert.deepEqual(errors,[error]);assert.equal(errors[0],error);assert.equal(written,'HTTP/1.1 502 Blocked\r\nConnection: close\r\n\r\n');
    });
  }
}

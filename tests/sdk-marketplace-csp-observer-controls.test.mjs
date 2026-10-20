import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,stat,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCspCdpSession,launchCspBrowser,observeMarketplaceCsp} from './helpers/marketplace-csp-browser.mjs';

class Socket extends EventTarget {
  messages=[];
  send(text) {this.messages.push(JSON.parse(text));}
  reply(value) {this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}

test('CDP commands time out, ignore their late replies and cannot resolve a different command',async()=>{
  const socket=new Socket(),session=createCspCdpSession(socket,{commandTimeoutMs:20});
  await assert.rejects(session.send('NoReply'),/CDP NoReply timed out after 20ms/u);
  assert.doesNotThrow(()=>socket.reply({id:1,result:{mustNotResolve:true}}));
  const next=session.send('ActualReply');
  socket.reply({id:2,result:{exact:true}});
  assert.deepEqual(await next,{exact:true});
  session.dispose();
});

test('socket disconnect rejects every pending command and all subsequent commands',async()=>{
  const socket=new Socket(),session=createCspCdpSession(socket);
  const first=session.send('First'),second=session.send('Second');
  const all=Promise.allSettled([first,second]);
  socket.dispatchEvent(new Event('close'));
  for(const result of await all) {
    assert.equal(result.status,'rejected');assert.match(result.reason.message,/socket closed/u);
  }
  await assert.rejects(session.send('AfterClose'),/socket closed/u);
  assert.equal(socket.messages.length,2);
  session.dispose();
});

test('malformed CDP responses fail the session instead of escaping event handlers',async()=>{
  for(const payload of ['not-json','null','[]']) {
    const socket=new Socket(),session=createCspCdpSession(socket);
    const pending=session.send('Pending');
    socket.dispatchEvent(new MessageEvent('message',{data:payload}));
    await assert.rejects(pending,/Malformed CDP message/u);
    assert.throws(()=>session.assertHealthy(),/Malformed CDP message/u);
    session.dispose();
  }
});

test('a synchronous socket send failure rejects its pending command',async()=>{
  const socket=new Socket();socket.send=()=>{throw new Error('TEST_SOCKET_SEND_FAILURE');};
  const session=createCspCdpSession(socket);
  await assert.rejects(session.send('Send'),/TEST_SOCKET_SEND_FAILURE/u);
  await assert.rejects(session.send('Again'),/TEST_SOCKET_SEND_FAILURE/u);
  session.dispose();
});

test('disposing a session rejects pending work, removes listeners and is idempotent',async()=>{
  const socket=new Socket(),session=createCspCdpSession(socket);
  const pending=session.send('Pending');
  session.dispose();session.dispose();
  await assert.rejects(pending,/CDP session closed/u);
  await assert.rejects(session.send('AfterDispose'),/CDP session closed/u);
  assert.doesNotThrow(()=>socket.reply({id:1,result:'late'}));
});

async function isolatedProfiles(run) {
  const directory=await mkdtemp(join(tmpdir(),'keel-csp-startup-control-'));
  const previous=process.env.TMPDIR;process.env.TMPDIR=directory;
  try {await run(directory);assert.deepEqual(await readdir(directory),[]);}
  finally {if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;await rm(directory,{recursive:true,force:true});}
}

test('a nonexistent browser rejects and removes its owned profile',{timeout:5000},async()=>{
  await isolatedProfiles(async directory=>{
    await assert.rejects(launchCspBrowser(join(directory,'missing-browser')),/ENOENT/u);
  });
});

test('a browser exiting before DevTools rejects and removes its owned profile',{timeout:5000},async()=>{
  await isolatedProfiles(async()=>{
    await assert.rejects(launchCspBrowser('/usr/bin/false'),/exited before DevTools/u);
  });
});

test('actual Chrome cleanup is idempotent, settles pending work and removes its owned profile',{timeout:15000},async()=>{
  const binary=process.env.KEEL_CHROME_HEADLESS_SHELL;
  assert.ok(binary,'An actual explicitly selected Chrome is required');
  const browser=await launchCspBrowser(binary);
  const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
  const pending=browser.send('Runtime.evaluate',{expression:'new Promise(()=>{})',awaitPromise:true},sessionId).catch(error=>error);
  await Promise.all([browser.close(),browser.close()]);
  assert.match((await pending).message,/CDP session closed|CDP socket closed|Inspected target navigated or closed/u);
  await assert.rejects(stat(browser.profile),{code:'ENOENT'});
});

async function fakeBrowser(run,body) {
  const directory=await mkdtemp(join(tmpdir(),'keel-csp-fake-binary-'));
  const executable=join(directory,'browser'),pidFile=join(directory,'pid');
  await writeFile(executable,'#!/bin/sh\nprintf "%s" "$$" > "'+pidFile+'"\n'+body+'\nexec /bin/sleep 30\n',{mode:0o700});
  try {await run(executable,pidFile);}
  finally {await rm(directory,{recursive:true,force:true});}
}
async function assertChildGone(pidFile) {
  const pid=Number(await readFile(pidFile,'utf8'));
  assert.ok(Number.isSafeInteger(pid)&&pid>0);
  assert.throws(()=>process.kill(pid,0),{code:'ESRCH'});
}

test('a refused CDP connection terminates its owned child and removes its profile',{timeout:5000},async()=>{
  await fakeBrowser(async(executable,pidFile)=>{
    await isolatedProfiles(async()=>{
      await assert.rejects(launchCspBrowser(executable),/CDP connection failed|CDP closed before connection/u);
      await assertChildGone(pidFile);
    });
  },'printf "DevTools listening on ws://127.0.0.1:1/devtools/browser/refused\\n" >&2');
});

test('missing DevTools startup is bounded and cleans up the actual owned process',{timeout:15000},async()=>{
  await fakeBrowser(async(executable,pidFile)=>{
    await isolatedProfiles(async()=>{
      await assert.rejects(launchCspBrowser(executable),/DevTools startup timed out after 10000ms/u);
      await assertChildGone(pidFile);
    });
  },'');
});

for(const readinessMs of [50,500]) {
  test(`actual Chrome retains a250ms runtime error with readiness at${readinessMs}ms`,{timeout:15000},async()=>{
    const binary=process.env.KEEL_CHROME_HEADLESS_SHELL;
    assert.ok(binary,'An actual explicitly selected Chrome is required');
    const html=`<!doctype html><body><output id="result">waiting</output><script>setTimeout(()=>{document.querySelector('#result').dataset.state='passed';document.querySelector('#result').textContent='module ran'},${readinessMs});setTimeout(()=>{throw new Error('LATE_RUNTIME_NEGATIVE')},250)</script>`;
    const server=createServer((_request,response)=>{response.setHeader('content-type','text/html');response.end(html);});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    try {
      const observed=await observeMarketplaceCsp(binary,`http://127.0.0.1:${server.address().port}`,'late-control');
      assert.equal(observed.state.state,'passed');
      assert.ok(observed.events.some(event=>event.kind==='exception'&&event.text.includes('LATE_RUNTIME_NEGATIVE')));
      assert.ok(observed.observedMs>=4000,'readiness must not shorten the original4000ms window');
      assert.ok(observed.readinessAtMs!==undefined,'actual readiness must still be observed');
    } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
}

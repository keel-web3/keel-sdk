import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {waitForOfflineBrowserEndpoint} from './support/offline-shell-browser.mjs';

function browser() {
  return Object.assign(new EventEmitter(),{stderr:new PassThrough(),exitCode:null,signalCode:null});
}
function cleaned(child) {
  assert.equal(child.listenerCount('exit'),0);assert.equal(child.listenerCount('error'),0);
  assert.equal(child.stderr.listenerCount('data'),0);child.stderr.end();
}
test('startup observes a split loopback endpoint then releases its listeners',async()=>{
  const child=browser(),pending=waitForOfflineBrowserEndpoint(child,'/verified/chromium',1000);
  child.stderr.write('startup\nDevTools listening on ws://127.0.0.1:1234/devtools/browser/');
  assert.equal(child.listenerCount('exit'),1,'A partial endpoint is not ready');child.stderr.write('test\n');
  assert.equal(await pending,'ws://127.0.0.1:1234/devtools/browser/test');cleaned(child);
});
test('a large warning suffix cannot discard an endpoint in the same chunk',async()=>{
  const child=browser(),pending=waitForOfflineBrowserEndpoint(child,'/verified/chromium',1000);
  child.stderr.write('DevTools listening on ws://127.0.0.1:1234/devtools/browser/test\n'+'.'.repeat(40000));
  assert.equal(await pending,'ws://127.0.0.1:1234/devtools/browser/test');cleaned(child);
});
test('startup timeout includes bounded diagnostic tail and keeps non-loopback endpoints unaccepted',async()=>{
  const child=browser(),pending=waitForOfflineBrowserEndpoint(child,'/verified/chromium',20);
  child.stderr.write('discarded-prefix'+'.'.repeat(20000)+'\nDevTools listening on ws://unapproved.invalid:1/browser/test\nstartup-tail');
  await assert.rejects(pending,error=>{
    assert.match(error.message,/Chromium debugging endpoint timed out/);
    assert.match(error.message,/binary=\/verified\/chromium; elapsedMs=\d+; exitCode=null; signal=null/);
    assert.ok(error.message.endsWith('startup-tail")'));assert.ok(!error.message.includes('discarded-prefix'));
    assert.ok(error.message.length<17000);return true;
  });cleaned(child);
});
test('early exit preserves code, signal and stderr instead of waiting for timeout',async()=>{
  const child=browser(),pending=waitForOfflineBrowserEndpoint(child,'/verified/chromium',1000);
  child.stderr.write('missing runtime dependency');child.exitCode=2;child.emit('exit',2,null);
  await assert.rejects(pending,/exited before qualification: 2; signal=null.*missing runtime dependency/);cleaned(child);
});
test('already-exited and signalled browsers fail immediately',async()=>{
  for(const [code,signal] of [[0,null],[null,'SIGTERM']]){
    const child=browser();child.exitCode=code;child.signalCode=signal;
    await assert.rejects(waitForOfflineBrowserEndpoint(child,'/verified/chromium',1000),/exited before qualification/);cleaned(child);
  }
});
test('spawn errors remain failures with executable context',async()=>{
  const child=browser(),pending=waitForOfflineBrowserEndpoint(child,'/verified/chromium',1000);
  child.emit('error',Object.assign(Error('spawn ENOENT'),{code:'ENOENT'}));
  await assert.rejects(pending,/Chromium failed to start: spawn ENOENT \(binary=\/verified\/chromium/);cleaned(child);
});
test('startup timeout cannot become unbounded',()=>{
  for(const timeout of [0,-1,60001,Infinity,1.5]){
    const child=browser();assert.throws(()=>waitForOfflineBrowserEndpoint(child,'/verified/chromium',timeout));child.stderr.end();
  }
});

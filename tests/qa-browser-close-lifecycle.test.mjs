import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const sourcePath=process.env.KEEL_QA_CLOSE_HELPER??path.resolve('tests/support/offline-shell-browser.mjs');
const source=await readFile(sourcePath,'utf8'),module=await import(pathToFileURL(sourcePath));
let close=module.closeObservedBrowser;
if(!close){
 const exact="const exited=once(child,'exit');\n    await command('Browser.close');\n    await exited;";
 assert.ok(source.includes(exact),'Baseline lifecycle extraction must match unchanged exact helper bytes');
 close=new (Object.getPrototypeOf(async function(){}).constructor)('command','exited',exact.replace("const exited=once(child,'exit');",''));
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('clean observed browser exit completes even when CDP close never acknowledges',async()=>{
 const ack=deferred(),exit=deferred();let done=false;
 const running=close(method=>{assert.equal(method,'Browser.close');return ack.promise},exit.promise).then(()=>{done=true});exit.resolve([0,null]);await tick();
 try{assert.equal(done,true,'A clean process exit after close dispatch is terminal evidence; a dead WebSocket cannot acknowledge later');}
 finally{ack.resolve();await running;}
});
test('close acknowledgement alone does not replace required process exit',async()=>{
 const exit=deferred();let done=false;const running=close(async()=>undefined,exit.promise).then(()=>{done=true});await tick();assert.equal(done,false);exit.resolve([0,null]);await running;assert.equal(done,true);
});
test('normal close acknowledgement and clean process exit complete',async()=>{
 await close(async method=>{assert.equal(method,'Browser.close')},Promise.resolve([0,null]));
});
test('nonzero browser exit remains failure even after close acknowledgement',async()=>{
 await assert.rejects(close(async()=>undefined,Promise.resolve([1,null])),/clean|exit|code/iu);
});
test('signal-terminated browser remains failure even after close acknowledgement',async()=>{
 await assert.rejects(close(async()=>undefined,Promise.resolve([null,'SIGKILL'])),/clean|exit|signal/iu);
});
test('protocol failure before browser exit remains failure',async()=>{
 const exit=deferred();try{await assert.rejects(close(async()=>{throw Error('synthetic protocol failure')},exit.promise),/synthetic protocol failure/)}finally{exit.resolve([0,null]);}
});

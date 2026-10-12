// Protocol unit tests only. These synthetic replies do not prove EVM execution;
// the companion native Go tests and full SDK integration must establish that.
import test from 'node:test';
import assert from 'node:assert/strict';
const { createKeelLocalSimulationTransport } = await import(process.env.KEEL_LOCAL_SESSION_MODULE ?? '../packages/sdk/dist/local-simulation-session.js');
const hash=n=>`0x${n.toString(16).padStart(64,'0')}`;
const pin={number:0n,hash:hash(1),stateRoot:hash(2)};
const program=()=>({blockStateCalls:[0,1].map(n=>({calls:[{from:`0x${'11'.repeat(20)}`,to:`0x${'22'.repeat(20)}`,data:'0x12345678',value:'0x0',gas:'0x100000',nonce:`0x${n}`}]})),validation:true,traceTransfers:false,returnFullTransactions:true});
const request=()=>({method:'eth_simulateV1',params:[program(),'0x0']});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function setup({ before, readHook, clientHook, options={} }={}) {
 const clients=[],reads=[],commands=[],evidence=[];let canonicalReads=0;
 const transport=createKeelLocalSimulationTransport({block:pin,readTransport:{async request(input){reads.push(input);const changed=await readHook?.(input,++canonicalReads);if(changed!==undefined)return changed;return input.method==='eth_chainId'?'0xaa36a7':{number:'0x0',hash:pin.hash,stateRoot:pin.stateRoot};}},
  async createClient(){const state={closed:0,stages:[],executions:0};clients.push(state);const created=await clientHook?.(state);if(created)return created;
   return {async close(){state.closed++;},async request(body,{signal}){
    commands.push(structuredClone(body));const action=await before?.(body,state,signal);if(action!==undefined)return action;
    const binding={sessionId:body.sessionId,programDigest:body.programDigest,canonicalHash:body.canonicalHash};let result;
    if(body.type==='begin'){state.program=JSON.parse(body.programJSON);state.binding=binding;result={...binding,nextIndex:0,stageCount:state.program.blockStateCalls.length,checkpoint:pin.hash,status:'open',acceptance:false};}
    else if(body.type==='stage'){
     if(!state.stages[body.index]){state.executions++;state.stages[body.index]={...binding,index:body.index,previousCheckpoint:body.expectedCheckpoint,checkpoint:hash(body.index+10),result:{hash:hash(body.index+10),calls:[{status:'0x1',returnData:'0x'}]}};}
     result=state.stages[body.index];
    }else if(body.type==='finish')result={...binding,status:'completed',acceptance:false,fullWitnessComplete:true,headerHistoryComplete:true,stickyStateError:false,stageCount:state.stages.length,checkpoint:state.stages.at(-1).checkpoint,results:state.stages.map(x=>x.result)};
    else throw new Error('Unexpected protocol command');
    return {id:body.id,result};
   }};
  },onSession:value=>evidence.push(value),...options});
 return {transport,clients,reads,commands,evidence};
}
test('complete request uses original bounded stages and returns only complete results',async()=>{
 const h=setup(),expected=request();const result=await h.transport.request(expected);
 assert.equal(result.length,2);assert.deepEqual(h.commands.map(x=>x.type),['begin','stage','stage','finish']);
 assert.deepEqual(JSON.parse(h.commands[0].programJSON),expected.params[0]);assert.equal(h.clients[0].executions,2);assert.equal(h.clients[0].closed,1);
 assert.equal(h.evidence.length,1);assert.equal(h.evidence[0].acceptance,false);assert.equal(h.reads.length,4);
});
test('discovery and strict replay start new independent local sessions',async()=>{
 const h=setup();const discovery=request();discovery.params[0].validation=false;
 await h.transport.request(discovery);await h.transport.request(request());
 assert.equal(h.clients.length,2);assert.notEqual(h.commands[0].sessionId,h.commands[4].sessionId);
 assert.equal(h.clients[0].program.validation,false);assert.equal(h.clients[1].program.validation,true);
 assert.ok(h.clients.every(c=>c.closed===1&&c.executions===2));
});
test('caller mutation after request starts cannot replace queued calls',async()=>{
 const gate=deferred();let once=true;const h=setup({readHook:async()=>{if(once){once=false;await gate.promise;}}});
 const input=request(),original=structuredClone(input);const pending=h.transport.request(input);input.params[0].blockStateCalls[0].calls[0].data='0xdeadbeef';gate.resolve();await pending;
 assert.deepEqual(h.clients[0].program,original.params[0]);
});
test('atomic outer call stays one indivisible native stage',async()=>{
 const h=setup(),input=request();input.params[0].blockStateCalls.splice(1);await h.transport.request(input);
 assert.equal(h.clients[0].executions,1);assert.equal(h.commands.filter(x=>x.type==='stage').length,1);
});
test('state overrides and changed pin reject before local process creation',async()=>{
 for(const change of [x=>x.params[0].blockStateCalls[0].stateOverrides={},x=>x.params[1]='latest',x=>x.params[0].gas='0x123']){
  const h=setup(),input=request();change(input);await assert.rejects(h.transport.request(input),e=>e.kind==='configuration-invalid');assert.equal(h.clients.length,0);
 }
});
test('stale canonical pin prevents any stage',async()=>{
 const h=setup({readHook:input=>input.method==='eth_getBlockByNumber'?{number:'0x0',hash:hash(999),stateRoot:pin.stateRoot}:undefined});
 await assert.rejects(h.transport.request(request()),e=>e.kind==='chain-reorganized');assert.equal(h.clients.length,0);
});
test('canonical reorg after execution discards complete native result',async()=>{
 let blocks=0;const h=setup({readHook:input=>input.method==='eth_getBlockByNumber'&&++blocks===2?{number:'0x0',hash:hash(99),stateRoot:pin.stateRoot}:undefined});
 await assert.rejects(h.transport.request(request()),e=>e.kind==='chain-reorganized');assert.equal(h.clients[0].closed,1);assert.equal(h.evidence.length,0);
});
test('one typed lost stage response retries exact idempotent command',async()=>{
 let missed=false;const h=setup({before(body,state){if(body.type==='stage'&&body.index===0&&!missed){missed=true;state.executions++;state.stages[0]={sessionId:body.sessionId,programDigest:body.programDigest,canonicalHash:body.canonicalHash,index:0,previousCheckpoint:body.expectedCheckpoint,checkpoint:hash(10),result:{hash:hash(10),calls:[{status:'0x1',returnData:'0x'}]}};throw Object.assign(new Error('lost local reply'),{code:'LOCAL_RESPONSE_LOST'});}}});
 await h.transport.request(request());const stages=h.commands.filter(x=>x.type==='stage');assert.deepEqual(stages[0],stages[1]);assert.equal(h.clients[0].executions,2);assert.equal(stages.length,3);
});
test('unknown local error is never retried and closes native state',async()=>{
 const h=setup({before:body=>{if(body.type==='stage')throw new Error('unknown');}});
 await assert.rejects(h.transport.request(request()));assert.equal(h.commands.filter(x=>x.type==='stage').length,1);assert.equal(h.clients[0].closed,1);assert.equal(h.evidence.length,0);
});
test('repeated known lost response is bounded to one retry',async()=>{
 const h=setup({before:body=>{if(body.type==='stage')throw Object.assign(new Error('lost'),{code:'LOCAL_RESPONSE_LOST'});}});
 await assert.rejects(h.transport.request(request()));assert.equal(h.commands.filter(x=>x.type==='stage').length,2);assert.equal(h.clients[0].closed,1);
});
test('native missing witness or execution error produces no partial success',async()=>{
 const h=setup({before:body=>body.type==='stage'?{id:body.id,error:{code:'native-stage-failed',message:'missing authenticated trie node'}}:undefined});
 await assert.rejects(h.transport.request(request()),e=>e.kind==='unsupported-simulation');assert.equal(h.clients[0].closed,1);assert.equal(h.commands.filter(x=>x.type==='finish').length,0);
});
test('wrong native digest, stale checkpoint and missing final stage all reject',async()=>{
 for(const change of [r=>r.programDigest=hash(55),r=>r.previousCheckpoint=hash(55),r=>r.index=9]){
  const h=setup({before:body=>{if(body.type!=='stage')return;const r={sessionId:body.sessionId,programDigest:body.programDigest,canonicalHash:body.canonicalHash,index:body.index,previousCheckpoint:body.expectedCheckpoint,checkpoint:hash(10),result:{}};change(r);return {id:body.id,result:r};}});
  await assert.rejects(h.transport.request(request()),e=>e.kind==='unsupported-simulation');assert.equal(h.clients[0].closed,1);
 }
});
test('final results must equal every previously observed stage result',async()=>{
 const h=setup({before:body=>body.type==='finish'?{id:body.id,result:{sessionId:body.sessionId,programDigest:body.programDigest,canonicalHash:body.canonicalHash,status:'completed',acceptance:false,stageCount:2,checkpoint:hash(11),results:[{},{}]}}:undefined});
 await assert.rejects(h.transport.request(request()),e=>e.kind==='unsupported-simulation');assert.equal(h.evidence.length,0);
});
test('abort while native stage is pending discards late result and closes process',async()=>{
 const entered=deferred(),late=deferred(),controller=new AbortController();const h=setup({options:{signal:controller.signal},before:async body=>{if(body.type==='stage'){entered.resolve();await late.promise;}}});
 const pending=h.transport.request(request());await entered.promise;controller.abort();await assert.rejects(pending,e=>e.kind==='rpc-unavailable');
 assert.equal(h.clients[0].closed,1);late.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.commands.filter(x=>x.type==='finish').length,0);assert.equal(h.evidence.length,0);
});
test('transport close cancels active request and prohibits subsequent calls',async()=>{
 const entered=deferred(),late=deferred();const h=setup({before:async body=>{if(body.type==='stage'){entered.resolve();await late.promise;}}});
 const pending=h.transport.request(request());const observed=pending.catch(error=>error);await entered.promise;await h.transport.close();assert.equal((await observed).kind,'rpc-unavailable');
 const count=h.reads.length;await assert.rejects(h.transport.request(request()),e=>e.kind==='rpc-unavailable');assert.equal(h.reads.length,count);late.resolve();
});
test('bounded request deadline includes native body/response wait',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const entered=deferred(),late=deferred();const h=setup({options:{requestTimeoutMs:100},before:async body=>{if(body.type==='stage'){entered.resolve();await late.promise;}}});
 const pending=h.transport.request(request());const observed=pending.catch(error=>error);await entered.promise;t.mock.timers.tick(100);
 assert.equal((await observed).kind,'rpc-unavailable');assert.equal(h.clients[0].closed,1);late.resolve();
});
test('late-created process is closed if cancellation wins process startup',async()=>{
 const entered=deferred(),late=deferred(),controller=new AbortController();let closed=0;const h=setup({options:{signal:controller.signal},clientHook:async()=>{entered.resolve();await late.promise;return {request:async()=>assert.fail('cancelled client used'),close:async()=>{closed++;}};}});
 const pending=h.transport.request(request());const observed=pending.catch(error=>error);await entered.promise;controller.abort();assert.equal((await observed).kind,'rpc-unavailable');late.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,1);
});
test('project estimate is denied before ordinary chain reader receives calldata',async()=>{
 const h=setup();await assert.rejects(h.transport.request({method:'eth_estimateGas',params:[{data:'0x1234'}]}),e=>e.kind==='configuration-invalid');assert.equal(h.reads.length,0);assert.equal(h.clients.length,0);
});
test('explicit project estimate capability is separate from ordinary read transport',async()=>{
 const estimates=[];const h=setup({options:{projectEstimateTransport:{request:async input=>{estimates.push(input);return '0xabc';}}}});
 const input={method:'eth_estimateGas',params:[{data:'0x1234'}]};assert.equal(await h.transport.request(input),'0xabc');assert.deepEqual(estimates.map(({signal,...rest})=>rest),[input]);assert.ok(estimates[0].signal instanceof AbortSignal);assert.equal(h.reads.length,0);
});
test('complete stage count without full witness/history or with sticky state error rejects',async()=>{
 for(const field of ['fullWitnessComplete','headerHistoryComplete','stickyStateError']){
  const h=setup({before(body,state){if(body.type!=='finish')return;const result={sessionId:body.sessionId,programDigest:body.programDigest,canonicalHash:body.canonicalHash,status:'completed',acceptance:false,fullWitnessComplete:true,headerHistoryComplete:true,stickyStateError:false,stageCount:state.stages.length,checkpoint:state.stages.at(-1).checkpoint,results:state.stages.map(x=>x.result)};result[field]=!result[field];return {id:body.id,result};}});
  await assert.rejects(h.transport.request(request()),e=>e.kind==='unsupported-simulation');assert.equal(h.evidence.length,0);
 }
});
test('cleanup failure cannot replace the primary native execution failure',async()=>{
 const primary=new Error('primary native error');const h=setup({clientHook:()=>({request:async()=>{throw primary;},close:async()=>{throw new Error('cleanup error');}})});
 await assert.rejects(h.transport.request(request()),error=>error===primary);
});
test('late cleanup rejection after cancelled startup does not become unhandled',async()=>{
 const entered=deferred(),late=deferred(),controller=new AbortController();const h=setup({options:{signal:controller.signal},clientHook:async()=>{entered.resolve();await late.promise;return {request:async()=>assert.fail('cancelled client used'),close:async()=>{throw new Error('late cleanup');}};}});
 const pending=h.transport.request(request());const observed=pending.catch(error=>error);await entered.promise;controller.abort();assert.equal((await observed).kind,'rpc-unavailable');late.resolve();await new Promise(resolve=>setImmediate(resolve));
});
test('ordinary transport rejects eth_call, trace, and transaction submission',async()=>{
 const h=setup();for(const method of ['eth_call','debug_traceCall','eth_sendRawTransaction'])await assert.rejects(h.transport.request({method,params:[{data:'0x1234'}]}),e=>e.kind==='configuration-invalid');assert.equal(h.reads.length,0);assert.equal(h.clients.length,0);
});
test('cleanup wait has a five-second bound and preserves primary failure',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const closing=deferred(),primary=new Error('native failed');
 const h=setup({clientHook:()=>({request:async()=>{throw primary;},close:async()=>{closing.resolve();await new Promise(()=>{});}})});
 const pending=h.transport.request(request());let settled=false;const observed=pending.catch(error=>{settled=true;return error;});await closing.promise;
 t.mock.timers.tick(4999);await Promise.resolve();assert.equal(settled,false);t.mock.timers.tick(1);assert.equal(await observed,primary);
});
test('cancelling one request does not poison a separate concurrent native session',async()=>{
 const entered=deferred(),late=deferred(),controller=new AbortController();const h=setup({before:async(body,state)=>{if(body.type==='stage'&&state===h.clients[0]){entered.resolve();await late.promise;}}});
 const first=h.transport.request({...request(),signal:controller.signal});const observed=first.catch(error=>error);await entered.promise;
 const second=await h.transport.request(request());assert.equal(second.length,2);controller.abort();assert.equal((await observed).kind,'rpc-unavailable');late.resolve();
 assert.equal(h.clients.length,2);assert.ok(h.clients.every(c=>c.closed===1));assert.equal(h.evidence.length,1);
});

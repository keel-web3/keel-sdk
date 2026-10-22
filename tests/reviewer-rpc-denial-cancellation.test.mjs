import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKeelRpcPool} from '../packages/sdk/dist/rpc.js';

// Complete matching JSON-RPC denials from an injected local mock only.
for (const code of [401,403]) test(`explicit RPC${code} denial survives capture-time cancellation for later requests`, async () => {
  const abort=new AbortController(), reason=new Error('reviewer capture-time abort');
  let deny=true; const calls=[];
  const pool=createKeelRpcPool({rpcUrls:['https://free.example','https://paid.example/DUMMY'],chainId:11155111,minIntervalMs:0,
    onPrivateResponse:event=>{if(event.response?.error?.code===code)abort.abort(reason);},
    fetchImpl:async(url,init)=>{
      const q=JSON.parse(init.body);calls.push({url,method:q.method});
      return new Response(JSON.stringify(q.method==='eth_chainId'?{jsonrpc:'2.0',id:q.id,result:'0xaa36a7'}:
        deny?{jsonrpc:'2.0',id:q.id,error:{code,message:'access denied'}}:{jsonrpc:'2.0',id:q.id,result:'0x'}));
    }});
  await assert.rejects(pool.pin(0).request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'0x4'],signal:abort.signal}),error=>error===reason);
  const count=calls.length;deny=false;
  await assert.rejects(pool.pin(0).request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'0x4']}),error=>error.reason==='access-denied');
  assert.equal(calls.length,count);assert.equal(pool.status()[0].disabled,true);
});

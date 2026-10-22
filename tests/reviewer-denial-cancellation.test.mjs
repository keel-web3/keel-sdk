import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createKeelRpcPool} from '../packages/sdk/dist/rpc.js';

// Local injected mock only. No network, provider or credentials.
for (const status of [401, 403]) test(`HTTP${status} observed before caller cancellation remains restricted for the next queued request`, async () => {
  const abort = new AbortController(), reason = new Error('reviewer caller cancellation');
  let denied = false, calls = 0;
  const pool = createKeelRpcPool({rpcUrls: ['https://free.example'], chainId:11155111, minIntervalMs:0,
    fetchImpl: async (_url, init) => {
      const q = JSON.parse(init.body); calls++;
      if(q.method === 'eth_chainId') return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:'0xaa36a7'}));
      if(!denied) {
        denied = true;
        return new Response(new ReadableStream({start(controller) {
          init.signal.addEventListener('abort', () => controller.error(init.signal.reason), {once:true});
          setImmediate(() => abort.abort(reason));
        }}), {status});
      }
      return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result:'0x'}));
    }});
  await assert.rejects(pool.pin(0).request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'0x4'],signal:abort.signal}), error => error===reason);
  const count = calls;
  await assert.rejects(pool.pin(0).request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'0x4']}), error => error.reason==='access-denied');
  assert.equal(calls, count, 'a known HTTP denial must restrict later dispatch despite caller cancellation');
  assert.equal(pool.status()[0].disabled, true);
});

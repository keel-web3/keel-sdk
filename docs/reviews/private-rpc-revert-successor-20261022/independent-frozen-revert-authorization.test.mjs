/** Public synthetic RPC errors only. No network or provider access. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { createKeelRpcPool, KeelRpcResponseError } from '../../../packages/sdk/dist/rpc.js';
const observations = [];
for (const prose of ['execution reverted: unauthorized', 'execution reverted: authentication required']) {
  test(`contract ${prose} remains a revert and does not disable its provider`, async () => {
    let requests = 0;
    const pool = createKeelRpcPool({ rpcUrls: ['https://free.example'], chainId:11155111, minIntervalMs:0,
      fetchImpl: async (_url, init) => {
        requests++;
        const q = JSON.parse(init.body);
        return new Response(JSON.stringify(q.method === 'eth_call'
          ? { jsonrpc:'2.0',id:q.id,error:{code:-32000,message:prose} }
          : { jsonrpc:'2.0',id:q.id,result:q.method === 'eth_chainId' ? '0xaa36a7' : '0x' }));
      } });
    let first;
    try { await pool.pin(0).request({method:'eth_call',params:[{to:'0x'+'22'.repeat(20),data:'0x'},'latest']}); }
    catch (error) { first=error; }
    const status = pool.status();
    observations.push({prose,first:{name:first?.name,reason:first?.reason,code:first?.code},status,requests});
    writeFileSync(new URL('./revert-authorization-observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');
    assert.ok(first instanceof KeelRpcResponseError, 'Execution-reverted prose must keep the genuine revert path');
    assert.equal(first.code,3);
    assert.equal(status[0].disabled,false,'An artwork revert must not permanently disable the shared RPC provider');
    assert.equal(await pool.pin(0).request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'latest']}),'0x');
  });
}

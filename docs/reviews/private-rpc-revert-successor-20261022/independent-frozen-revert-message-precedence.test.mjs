/** Independent RPC classification controls; all fetches terminate in local mocks. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync } from 'node:fs';
import { createKeelRpcPool, KeelRpcResponseError, KeelRpcSetupError } from '../../../packages/sdk/dist/rpc.js';
const observations = [];
const urls = ['https://free.example', 'https://alternate.example'];
const prose = ['unauthorized','authentication required','rate limit','request body size limit reached'];
const query = {method:'eth_call',params:[{to:'0x'+'22'.repeat(20),data:'0x'},'latest']};
function fixture(status, message) {
  const calls=[];
  const pool=createKeelRpcPool({rpcUrls:urls,chainId:11155111,minIntervalMs:0,fetchImpl:async(url,init)=>{
    const q=JSON.parse(init.body);calls.push({index:urls.indexOf(url),method:q.method});
    return new Response(JSON.stringify(q.method==='eth_call'
      ? {jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'execution reverted: '+message}}
      : {jsonrpc:'2.0',id:q.id,result:q.method==='eth_chainId'?'0xaa36a7':'0x'}),{status:q.method==='eth_call'?status:200});
  }});
  return {pool,calls};
}
function record(name,error,f) {
  observations.push({name,error:{name:error?.name,code:error?.code,reason:error?.reason},
    status:f.pool.status().map(({endpoint,...safe})=>safe),calls:f.calls});
  writeFileSync(new URL('./revert-message-precedence-observations.json',import.meta.url),JSON.stringify(observations,null,2)+'\n');
}
for(const status of [200,413,429,503]) for(const message of prose) {
  test(`HTTP${status} genuine revert containing ${message} stays deterministic and leaves provider reusable`,async()=>{
    const f=fixture(status,message);let error;
    try{await f.pool.request(query);}catch(caught){error=caught;}
    record(`HTTP${status} ${message}`,error,f);
    assert.ok(error instanceof KeelRpcResponseError,'A genuine contract revert must keep its typed deterministic path');
    assert.equal(error.code,3);assert.ok(f.calls.every(row=>row.index===0),'Never disclose the reverted request to another recipient');
    assert.equal(f.pool.status()[0].disabled,false,'Contract authorization is not provider credential denial');
    assert.equal(await f.pool.request({method:'eth_getCode',params:['0x'+'22'.repeat(20),'latest']}),'0x');
    assert.ok(f.calls.every(row=>row.index===0),'The original provider remains usable after the revert');
  });
}
for(const status of [401,403]) for(const message of prose) {
  test(`actual HTTP${status} remains credential denial despite execution/retry prose ${message}`,async()=>{
    const f=fixture(status,message);let error;
    try{await f.pool.pin(0).request(query);}catch(caught){error=caught;}
    record(`HTTP${status} ${message}`,error,f);
    assert.ok(error instanceof KeelRpcSetupError);assert.equal(error.reason,'access-denied');
    assert.equal(f.pool.status()[0].disabled,true);assert.ok(f.calls.every(row=>row.index===0));
  });
}

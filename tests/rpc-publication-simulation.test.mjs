import test from 'node:test';import assert from 'node:assert/strict';
import {createKeelRpcPool} from '../packages/sdk/dist/rpc.js';
function fixture(){const requests=[];const pool=createKeelRpcPool({rpcUrls:['https://rpc.example'],chainId:11155111,minIntervalMs:0,fetchImpl:async(_url,init)=>{const request=JSON.parse(init.body);requests.push(request);return Response.json({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0xaa36a7':[]});}});return {pool,requests};}
const params=(data='0x')=>[{blockStateCalls:[{calls:[{from:'0x'+'11'.repeat(20),to:'0x'+'22'.repeat(20),data,value:'0x0',gas:'0x100000'}]}],validation:true,traceTransfers:false,returnFullTransactions:false},'0x12'];
test('read-only RPC pool carries the complete bounded publication simulation instead of blocking all approvals',async()=>{
 const f=fixture();await f.pool.request({method:'eth_simulateV1',params:params('0x'+'00'.repeat(300_000))});
 assert.equal(f.requests.at(-1).method,'eth_simulateV1');
 for(const method of ['eth_sendTransaction','eth_sendRawTransaction','personal_sign'])await assert.rejects(f.pool.request({method,params:[]}),/read-only/);
});
test('simulation overrides and unbounded/ordinary oversized reads reject before network access',async()=>{
 for(const mutate of [p=>{p[0].stateOverrides={};},p=>{p[0].blockStateCalls[0].stateOverrides={};},p=>{p[0].validation=undefined;},p=>{p[0].blockStateCalls=[];}]){
  const f=fixture(),p=params();mutate(p);await assert.rejects(f.pool.request({method:'eth_simulateV1',params:p}),/without state/);assert.equal(f.requests.length,0);
 }
 const f=fixture();await assert.rejects(f.pool.request({method:'eth_call',params:[{data:'0x'+'00'.repeat(300_000)},'latest']}),/bounded/);assert.equal(f.requests.length,0);
});

test('simulation failure type and numeric provider gas cap survive without leaking private provider text',async()=>{
 for(const error of [{code:-32601,message:'secret-key method unsupported'},{code:-38014,message:'secret-key insufficient funds'},{code:-32000,message:'gas cap: 16777216 https://rpc/private-key'}]){
  const p=createKeelRpcPool({rpcUrls:['https://rpc.example'],chainId:11155111,minIntervalMs:0,fetchImpl:async(_u,init)=>{const body=JSON.parse(init.body);return Response.json(body.method==='eth_chainId'?{jsonrpc:'2.0',id:body.id,result:'0xaa36a7'}:{jsonrpc:'2.0',id:body.id,error});}});
  await assert.rejects(p.request({method:'eth_simulateV1',params:params()}),result=>{assert.equal(result.code,error.code);assert.doesNotMatch(result.message,/secret-key|private-key/);if(error.code===-32000)assert.match(result.message,/16777216/);return true;});
 }
});

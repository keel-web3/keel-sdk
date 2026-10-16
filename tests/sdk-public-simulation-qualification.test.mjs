import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createKeelPublicSimulationPool as fixedPool} from '../packages/sdk/dist/public-simulation-pool.js';

// Synthetic public calls only. Numeric fixtures match the measured 50M/12k
// envelope behavior; no saved candidate, artwork, URL credential or calldata.
const zero='0x'+'0'.repeat(40),owner='0x'+'1'.repeat(40),target='0x'+'2'.repeat(40);
const hex=n=>'0x'+BigInt(n).toString(16),hash=s=>'0x'+createHash('sha256').update(s).digest('hex');
function fixture({privateCap=200000000n,transactionCap,variablePublic=false,badSequenceHeader=false,approved=true}={}){
 const pin={number:11925227n,hash:hash('synthetic-pin'),timestamp:BigInt(Math.floor(Date.now()/1000))};
 const header={number:hex(pin.number),hash:pin.hash,timestamp:hex(pin.timestamp),gasLimit:hex(200000000n),baseFeePerGas:'0x1',slotNumber:'0x1',blockAccessListHash:hash('synthetic-bal')};
 const sent=[],publicSequences=[];let publicAttempts=0;
 function response(body){
  const {method,params}=body;
  if(method==='eth_chainId')return{result:hex(11155111)};
  if(method==='eth_getBlockByNumber')return{result:header};
  if(method==='eth_getTransactionCount')return{result:'0x0'};
  if(method==='eth_getBalance')return{result:'0xffffffffffffffffffffffffffffffff'};
  if(method==='eth_getCode')return{result:'0x'};
  assert.equal(method,'eth_simulateV1');
  const program=params[0],blocks=program.blockStateCalls;
  const isPublic=blocks.every(b=>b.calls.every(c=>c.from===zero&&c.to===zero&&c.data==='0x'));
  if(program.validation&&blocks.length===1&&blocks[0].calls[0].nonce==='0x1')return{error:{code:-38011,message:'synthetic nonce too high'}};
  if(isPublic){publicAttempts++;publicSequences.push(blocks.map(b=>BigInt(b.calls[0].gas)));}
  else sent.push(structuredClone(body));
  const cap=isPublic?(variablePublic&&publicAttempts%2===0?200000000n:50000000n):privateCap;
  let remaining=cap,parent=header;
  const result=blocks.map((block,i)=>{
   const call=block.calls[0],requested=BigInt(call.gas),used=isPublic?12000n:20000n;
   let gas=requested<remaining?requested:remaining;
   if(transactionCap!==undefined&&gas>transactionCap)gas=transactionCap;
   remaining-=used;
   const next={number:hex(pin.number+1n+BigInt(i)),hash:hash('synthetic-'+i),parentHash:parent.hash,timestamp:hex(pin.timestamp+12n*BigInt(i+1)),gasLimit:header.gasLimit,baseFeePerGas:'0x1',slotNumber:hex(BigInt(i+2)),blockAccessListHash:header.blockAccessListHash,
    transactions:[{...call,gas:hex(gas),nonce:call.nonce??hex(i)}],calls:[{status:'0x1',returnData:'0x',gasUsed:hex(used),maxUsedGas:hex(used)}]};
   if(badSequenceHeader&&isPublic&&blocks.length===45&&i===44)next.parentHash=hash('wrong-parent');
   parent=next;return next;
  });
  return{result};
 }
 const fetchImpl=async(_url,options)=>{const body=JSON.parse(options.body);const value=response(body);return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,...value}),{headers:{'content-type':'application/json'}})};
 const request={method:'eth_simulateV1',params:[{blockStateCalls:Array.from({length:45},(_,i)=>({calls:[{from:owner,to:target,data:'0xab',value:'0x0',gas:hex(50000000n),nonce:hex(i),gasPrice:'0x3'}]})),validation:false,traceTransfers:false,returnFullTransactions:true},hex(pin.number)]};
 const options={chainId:11155111,rpcUrls:['https://synthetic.example.invalid'],approvedProjectRpcUrls:approved?['https://synthetic.example.invalid']:[],block:pin,fetchImpl,minIntervalMs:0,requestTimeoutMs:5000,readTransport:{request:async request=>response(request).result}};
 return{options,request,sent,publicSequences};
}
async function run(create,scenario){const env=fixture(scenario),pool=create(env.options);try{return{env,result:await pool.request(env.request)}}finally{await pool.close()}}

test('fixed qualifier uses bounded public sequence and preserves exact project request',async()=>{
 const {env,result}=await run(fixedPool);assert.equal(result.length,45);assert.equal(env.sent.length,1);
 assert.deepEqual({method:env.sent[0].method,params:env.sent[0].params},env.request);
 assert.ok(env.publicSequences.some(sequence=>sequence.length===45&&sequence.every(gas=>gas===21000n)));
});
test('actual project cumulative clamping still fails with project-request evidence',async()=>{
 const env=fixture({privateCap:50000000n}),pool=fixedPool(env.options);
 try{await assert.rejects(pool.request(env.request),error=>error.kind==='provider-limit'&&error.diagnostic.phase==='project-request'&&error.diagnostic.providerGasCap==='49980000');assert.equal(env.sent.length,1)}finally{await pool.close()}
});
test('variable public capacity never becomes an inferred project request cap',async()=>{
 const {env,result}=await run(fixedPool,{variablePublic:true});assert.equal(result.length,45);assert.equal(env.sent.length,1);
 assert.ok(result.every(block=>block.transactions[0].gas===hex(50000000n)));
});
test('insufficient individual envelope capacity still rejects before project disclosure',async()=>{
 const env=fixture({transactionCap:49000000n}),pool=fixedPool(env.options);
 try{await assert.rejects(pool.request(env.request),error=>error.kind==='provider-limit');assert.equal(env.sent.length,0)}finally{await pool.close()}
});
test('invalid ordered public headers still reject before project disclosure',async()=>{
 const env=fixture({badSequenceHeader:true}),pool=fixedPool(env.options);
 try{await assert.rejects(pool.request(env.request),error=>error.kind==='unsupported-simulation');assert.equal(env.sent.length,0)}finally{await pool.close()}
});
test('passing public qualification cannot authorize an unapproved project recipient',async()=>{
 const env=fixture({approved:false}),pool=fixedPool(env.options);
 try{await assert.rejects(pool.request(env.request));assert.equal(env.sent.length,0)}finally{await pool.close()}
});

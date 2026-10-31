import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createApprovedProofStateReader} from '../native/proof-executor/state-reader.mjs';
const publicUrl='https://public.example',fallbackUrl='https://fallback.example',hash=`0x${'a1'.repeat(32)}`,other=`0x${'b2'.repeat(32)}`,address=`0x${'c3'.repeat(20)}`,anchor={blockHash:hash,requireCanonical:true};
const slot=i=>`0x${BigInt(i).toString(16).padStart(64,'0')}`;
function fixture(options={}) {
 let clock=0;const calls=[],events=[];let proofCount=0;
 const fetchImpl=async(url,init)=>{const q=JSON.parse(init.body),index=String(url).startsWith(fallbackUrl)?1:0;calls.push({index,method:q.method,params:q.params});
  if(options.deny===index&&q.method==='eth_getProof')return new Response('denied',{status:403});
  if(options.revert&&index===0&&q.method==='eth_getProof')return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,error:{code:3,message:'execution reverted'}}));
  let result;if(q.method==='eth_chainId')result='0xaa36a7';else if(q.method==='eth_getBlockByNumber')result={number:'0x4',hash:index===1&&options.badFallbackPin?other:hash};
  else if(q.method==='eth_getCode'){clock+=options.delay??1300;result='0x6000';}
  else if(q.method==='eth_getProof'){proofCount++;clock+=options.outlier?(proofCount===1?15000:800):(options.delay??1300);if(options.concurrent)await new Promise(resolve=>setTimeout(resolve,15));result={address,accountProof:['0xc0'],storageProof:q.params[1].map(key=>({key,value:'0x0',proof:['0xc0']}))};}
  else throw Error('unexpected method');return new Response(JSON.stringify({jsonrpc:'2.0',id:q.id,result}),{headers:{'content-type':'application/json'}});
 };
 const reader=createApprovedProofStateReader({rpcUrls:[publicUrl,fallbackUrl],approvedStateRpcUrls:options.onlyPublic?[publicUrl]:[publicUrl,fallbackUrl],block:{number:4n,hash},fetchImpl,minIntervalMs:0,onAttempt:e=>events.push(e),...(options.policy===false?{}:{latencyFallback:true}),monotonicNow:()=>options.invalidClock?NaN:clock});
 return {reader,calls,events,read:i=>reader.request({method:'eth_getProof',params:[address,[slot(i)],anchor]})};
}
const proofCalls=f=>f.calls.filter(x=>x.method==='eth_getProof');
test('sustained slow public reads switch only the next request to the approved pinned fallback',async()=>{const f=fixture();try{for(let i=0;i<33;i++)await f.read(i);assert.deepEqual(proofCalls(f).map(x=>x.index),[...Array(32).fill(0),1]);assert.equal(f.events.length,1);assert.deepEqual(f.events[0],{candidateIndex:1,latencyFallback:1,primaryReadSamples:32,primaryReadMs:41600});assert.ok(proofCalls(f).every(x=>JSON.stringify(x.params[2])===JSON.stringify(anchor)));assert.equal(f.calls.filter(x=>x.index===1&&x.method==='eth_getBlockByNumber').length,1);}finally{f.reader.close()}});
test('healthy public reads remain first',async()=>{const f=fixture({delay:800});try{for(let i=0;i<40;i++)await f.read(i);assert.ok(proofCalls(f).every(x=>x.index===0));assert.equal(f.events.length,0);}finally{f.reader.close()}});
test('policy is opt-in',async()=>{const f=fixture({policy:false});try{for(let i=0;i<40;i++)await f.read(i);assert.ok(proofCalls(f).every(x=>x.index===0));}finally{f.reader.close()}});
test('one outlier cannot trigger sustained-latency fallback',async()=>{const f=fixture({outlier:true});try{for(let i=0;i<33;i++)await f.read(i);assert.ok(proofCalls(f).every(x=>x.index===0));}finally{f.reader.close()}});
test('an unapproved alternate is never contacted',async()=>{const f=fixture({onlyPublic:true});try{for(let i=0;i<40;i++)await f.read(i);assert.ok(f.calls.every(x=>x.index===0));}finally{f.reader.close()}});
test('access denial remains terminal and never triggers fallback',async()=>{const f=fixture({deny:0});try{await assert.rejects(f.read(1));assert.ok(f.calls.every(x=>x.index===0));}finally{f.reader.close()}});
test('fallback pinned-header mismatch rejects before requesting its proof',async()=>{const f=fixture({badFallbackPin:true});try{for(let i=0;i<32;i++)await f.read(i);await assert.rejects(f.read(32),/block|chain|state source/i);assert.equal(proofCalls(f).filter(x=>x.index===1).length,0);}finally{f.reader.close()}});
test('RPC reverts do not grant fallback',async()=>{const f=fixture({revert:true});try{await assert.rejects(f.read(1));assert.ok(f.calls.every(x=>x.index===0));}finally{f.reader.close()}});
test('cached identical reads do not inflate the latency sample',async()=>{const f=fixture();try{for(let i=0;i<40;i++)await f.read(1);assert.equal(proofCalls(f).length,1);assert.equal(f.events.length,0);}finally{f.reader.close()}});
test('overlapping primary reads disable latency inference rather than inflating it',async()=>{const f=fixture({concurrent:true});try{await Promise.all([f.read(0),f.read(1)]);for(let i=2;i<40;i++)await f.read(i);assert.ok(proofCalls(f).every(x=>x.index===0));assert.equal(f.events.length,0);}finally{f.reader.close()}});
test('an invalid clock cannot select a fallback',async()=>{const f=fixture({invalidClock:true});try{for(let i=0;i<40;i++)await f.read(i);assert.ok(proofCalls(f).every(x=>x.index===0));}finally{f.reader.close()}});
test('a fallback denial is terminal and does not shop back to public',async()=>{const f=fixture({deny:1});try{for(let i=0;i<32;i++)await f.read(i);await assert.rejects(f.read(32));assert.deepEqual(proofCalls(f).map(x=>x.index),[...Array(32).fill(0),1]);}finally{f.reader.close()}});

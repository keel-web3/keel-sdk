import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {encodeAbiParameters} from 'viem';
import {readTokenUri,TOKEN_URI_READ_GAS_LIMIT} from '../packages/mcp/dist/standards.js';
test('MCP standard read uses 50M and distinguishes a higher-cap success from an unrelated revert',async()=>{
 assert.equal(TOKEN_URI_READ_GAS_LIMIT,50000000);
 let highSucceeds=true;const calls=[];
 const server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const r=JSON.parse(text);calls.push(r);let result,error;
  if(r.method==='eth_chainId')result='0x7a69';else if(r.method==='eth_blockNumber')result='0x10';else if(r.method==='eth_estimateGas')result='0x2faf081';else if(r.method==='eth_call'){
   if(r.params[0].gas||!highSucceeds)error={code:3,message:'execution reverted'};else result=encodeAbiParameters([{type:'string'}],['data:application/json,{"name":"fixture"}']);
  }else error={code:-32601,message:'method missing'};
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:r.id,...(error?{error}:{result})}));
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const url='http://127.0.0.1:'+server.address().port;const a='0x'+'11'.repeat(20);
  let read=await readTokenUri(url,a,1n);assert.equal(read.failure.code,'read-gas-exceeds-limit');assert.match(read.failure.detail,/Hybrid.*qualified/);
  assert.equal(calls.find(x=>x.method==='eth_call').params[0].gas,'0x2faf080');
  highSucceeds=false;read=await readTokenUri(url,a,1n);assert.equal(read.failure.code,'read-failed');assert.doesNotMatch(read.failure.detail,/size|too.large/);
  assert.equal(read.readOptions.standardSingleCallGas,50000000);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

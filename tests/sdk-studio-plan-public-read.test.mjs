import assert from 'node:assert/strict';
import test from 'node:test';
import {encodeAbiParameters} from 'viem';
import {readKeelInlineTokenAudit, toKeelDenseTransportDataURL} from '../packages/sdk/dist/index.js';

const collection='0x'+'11'.repeat(20), hash='0x'+'22'.repeat(32);
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';
const token=(name='Exact source fixture')=>toKeelDenseTransportDataURL('metadata',JSON.stringify({name,image,animation_url:toKeelDenseTransportDataURL('html','<!doctype html><p>🔥%#</p>')}));
function fixture(uri,options={}){
 const calls=[];
 const fetcher=async(_url,input)=>{
  const request=JSON.parse(input.body);calls.push(request);
  let result;
  if(request.method==='eth_chainId')result='0x7a69';
  else if(request.method==='eth_getCode')result='0x60006000';
  else if(request.method==='eth_getBlockByNumber')result={number:'0x10',hash:options.reorg&&request.params[0]!=='latest'?'0x'+'33'.repeat(32):hash,gasLimit:options.blockGasLimit??'0x3938700'};
  else if(request.method==='eth_call')result=options.abi??encodeAbiParameters([{type:'string'}],[uri]);
  else throw Error('Unexpected RPC call '+request.method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}});
 };
 return {calls,read:()=>readKeelInlineTokenAudit({rpcUrl:'http://127.0.0.1:8545',chainId:31337,collection,tokenId:'1'},fetcher)};
}

test('public byte reader accepts an exactly 2,000,000-byte complete Inline return and rejects one byte more',async()=>{
 const base=token('');const uri=token('a'.repeat(2_000_000-Buffer.byteLength(base)));
 assert.equal(Buffer.byteLength(uri),2_000_000);
 const f=fixture(uri);const result=await f.read();
 assert.equal(result.audit.completeTokenURIBytes,2_000_000);
 assert.equal(result.audit.htmlBytes,Buffer.byteLength('<!doctype html><p>🔥%#</p>'));
 assert.equal(result.callGasLimit,'60000000');assert.equal(result.browserVerified,false);
 assert.equal(result.selectedChainReadAuthenticated,false);assert.equal(result.audit.onchainStorage.status,'not-inspected');
 assert.ok(f.calls.filter(c=>['eth_call','eth_getCode'].includes(c.method)).every(c=>c.params[1]==='0x10'));
 await assert.rejects(fixture(token('a'.repeat(2_000_001-Buffer.byteLength(base)))).read(),/length|oversized|limit/);
 assert.equal((await fixture(token(),{blockGasLimit:'0x1c9c380'}).read()).callGasLimit,'30000000');
});

test('noncanonical ABI framing, UTF-8 corruption and a changed pinned block fail before a public audit',async()=>{
 const uri=token(), encoded=encodeAbiParameters([{type:'string'}],[uri]);
 const offset=Buffer.from(encoded.slice(2),'hex');offset[31]=64;
 const padding=Buffer.from(encoded.slice(2),'hex');padding[padding.length-1]=1;
 const utf8=Buffer.from(encoded.slice(2),'hex');utf8[64]=255;
 for(const bytes of [offset,padding,utf8])await assert.rejects(fixture(uri,{abi:'0x'+bytes.toString('hex')}).read());
 await assert.rejects(fixture(uri,{abi:encoded+'00'}).read(),/padding|length/);
 await assert.rejects(fixture(uri,{reorg:true}).read(),/block changed/);
 const accepted=await fixture(uri).read();
 assert.equal(accepted.publicationReady,false);assert.equal(accepted.signing,'not-performed');assert.equal(accepted.submission,'not-performed');
});

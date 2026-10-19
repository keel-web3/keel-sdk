import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import solc from 'solc';
import {createKeelExplicitNonstandardReadPolicy,keelNonstandardReadAcknowledgementKey,keelTokenURIRpcResponseBytes} from '../packages/protocol/dist/index.js';
import {readKeelInlineTokenAudit} from '../packages/sdk/dist/inline-token-read.js';

const sha=b=>'0x'+createHash('sha256').update(b).digest('hex');
test('real local EVM returns the exact valid 2M+ URI under explicit policy, without signing or transactions',async t=>{
  const target='0x'+'45'.repeat(20),fillerBytes=2_050_001;
  const metadata={name:'actual local read fixture',description:'FILLER',
    animation_url:'data:text/html;charset=utf-8,'+encodeURIComponent('<html><body>capacity fixture</body></html>'),
    image:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII='};
  const [prefix,suffix]=('data:application/json;charset=utf-8,'+encodeURIComponent(JSON.stringify(metadata))).split('FILLER');
  const expected=prefix+'A'.repeat(fillerBytes)+suffix;
  const source=`pragma solidity ^0.8.36; contract LargeRead { function tokenURI(uint256) external pure returns(string memory) { bytes memory p=bytes(${JSON.stringify(prefix)}); bytes memory s=bytes(${JSON.stringify(suffix)}); bytes memory out=new bytes(p.length+${fillerBytes}+s.length); assembly ("memory-safe") { let dest:=add(out,32) mcopy(dest,add(p,32),mload(p)) let start:=add(dest,mload(p)) let end:=add(start,${fillerBytes}) for {let at:=start} lt(at,end) {at:=add(at,32)} {mstore(at,0x${'41'.repeat(32)})} mcopy(end,add(s,32),mload(s)) } return string(out); } }`;
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'LargeRead.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},evmVersion:'osaka',outputSelection:{'*':{'*':['evm.deployedBytecode.object']}}}})));
  assert.ok(!compiled.errors?.some(e=>e.severity==='error'),JSON.stringify(compiled.errors));
  const runtime='0x'+compiled.contracts['LargeRead.sol'].LargeRead.evm.deployedBytecode.object;
  assert.ok((runtime.length-2)/2<24576);
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
  const binary=process.env.KEEL_TEST_ANVIL??'/Users/ravonus/.foundry/bin/anvil';
  const child=spawn(binary,['--host','127.0.0.1','--port',String(port),'--chain-id','31337','--hardfork','osaka','--gas-limit','200000000','--silent'],{stdio:'ignore'});
  t.after(()=>{child.kill('SIGTERM');});
  const url=`http://127.0.0.1:${port}`;let id=0;const requests=[];
  async function rpc(method,params){const body=JSON.stringify({jsonrpc:'2.0',id:++id,method,params});const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body,signal:AbortSignal.timeout(30000)});const text=await response.text();requests.push({method,httpStatus:response.status,requestBytes:Buffer.byteLength(body),responseBytes:Buffer.byteLength(text),responseSHA256:sha(text)});assert.equal(response.status,200);const result=JSON.parse(text);if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result.result;}
  let ready=false;for(let attempts=0;attempts<100;attempts++){try{await rpc('eth_chainId',[]);ready=true;break;}catch{await new Promise(r=>setTimeout(r,25));}}assert.equal(ready,true);
  // Explicit local test initialization. No deployment receipt, canonical fork,
  // production capacity or transaction-equivalence claim is made from setCode.
  await rpc('anvil_setCode',[target,runtime]);assert.equal(await rpc('eth_getCode',[target,'latest']),runtime);
  const identity={chainId:31337,projectId:'local-capacity',revision:'1',defaultsRevision:'1',sourceDigest:sha(source),planDigest:sha('local-read-plan'),measurementDigest:sha(JSON.stringify({runtime:sha(runtime),uri:sha(expected),bytes:Buffer.byteLength(expected)})),tokenUriDigest:sha(expected),completeTokenUriBytes:Buffer.byteLength(expected)};
  const limits={maximumTokenUriBytes:Buffer.byteLength(expected),maximumRpcResponseBytes:keelTokenURIRpcResponseBytes(Buffer.byteLength(expected)),maximumReadGas:'60000000'};
  const policy=createKeelExplicitNonstandardReadPolicy({identity,limits,acknowledgementKey:keelNonstandardReadAcknowledgementKey({identity,limits})});
  const physical=[];
  const fetcher=async(input,init)=>{const response=await fetch(input,init);const clone=response.clone();const bytes=new Uint8Array(await clone.arrayBuffer());const q=JSON.parse(init.body);physical.push({method:q.method,params:q.method==='eth_call'?q.params:undefined,requestBytes:Buffer.byteLength(init.body),responseBytes:bytes.byteLength,responseSHA256:sha(bytes),httpStatus:response.status});return response;};
  await assert.rejects(readKeelInlineTokenAudit({rpcUrl:url,chainId:31337,collection:target,tokenId:'1'},fetcher),/limit|oversized/);
  const result=await readKeelInlineTokenAudit({rpcUrl:url,chainId:31337,collection:target,tokenId:'1',nonstandardReadPolicy:policy},fetcher);
  assert.equal(result.audit.completeTokenURIBytes,Buffer.byteLength(expected));assert.equal(result.audit.tokenURIIntegrity.digest,sha(expected));
  assert.equal(result.audit.uriCompatibility.tokenURI.strictURICompatible,true);
  assert.equal(result.audit.imageBytes,Buffer.from(metadata.image.split(',')[1],'base64').length);
  assert.equal(result.rpcChainAndBlockConsistent,true);assert.equal(result.signing,'not-performed');
  const calls=physical.filter(q=>q.method==='eth_call');assert.equal(calls.length,2);
  assert.deepEqual(calls[0].params,calls[1].params);assert.ok(calls[1].responseBytes>4_000_000);assert.ok(calls[1].responseBytes<=limits.maximumRpcResponseBytes);
  assert.ok(requests.every(q=>!/(?:send|sign)/iu.test(q.method)));
  const receipt={schema:'keel-local-nonstandard-read@1',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),solc:solc.version(),anvil:execFileSync(binary,['--version'],{encoding:'utf8'}).split('\n')[0],setup:'LOCAL anvil_setCode synthetic fixture initialization; no transaction, creation receipt or production capacity claim',runtimeBytes:(runtime.length-2)/2,runtimeSHA256:sha(Buffer.from(runtime.slice(2),'hex')),sourceSHA256:sha(source),expectedTokenURISHA256:sha(expected),completeTokenURIBytes:Buffer.byteLength(expected),physicalReads:physical,policy,signatures:0,broadcasts:0,originalIncidentTested:false,status:'PASS_ACTUAL_LOCAL_EVM_READ_ONLY'};
  if(process.env.KEEL_NONSTANDARD_RECEIPT)await writeFile(process.env.KEEL_NONSTANDARD_RECEIPT,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  t.diagnostic(JSON.stringify({completeTokenURIBytes:receipt.completeTokenURIBytes,runtimeSHA256:receipt.runtimeSHA256,ethCallResponseBytes:calls[1].responseBytes,status:receipt.status}));
});

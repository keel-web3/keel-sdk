import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ethereumTezosAttachmentId,buildEthereumTezosAttachment,readEthereumTezosAttachment} from '../packages/sdk/src/ethereum-tezos-proof.ts';
const golden=JSON.parse(fs.readFileSync(new URL('./fixtures/ethereum-tezos-attachment.json',import.meta.url),'utf8'));
const c={account:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',codeHash:'0xd0a06b12ac47863b5c7be4185c2deaad1c61557033f56c7d4ea74429cbb25e23',length:3124n,network:1,objectId:'0x8208bc8e0243d08d113ddf3171bd7b259d74a4971d1eca5c43d4a5a16682732b',offset:0n,revision:1n,schema:1,slot:15204064n};
const identity='0xe4c41f4cd9d4908499fae7435f39d2d03c01429daea2ee203bcf331bbb1ec58c';
const flatten=n=>n?.prim==='Pair'?n.args.flatMap(flatten):[n];
const g=flatten(golden);
const input={receiver:'KT195UdRi1ZG8UyUMfBwHUViJ83R3hgvu8qq',coordinates:c,accountRlp:'0x'+g[0].bytes,code:'0x'+g[1].bytes,accountProof:g.at(-1).map(x=>'0x'+x.bytes)};
test('coordinate packing matches applied Octez receipt ID',()=>assert.equal(ethereumTezosAttachmentId(c),identity));
test('attachment parameters match native applied scenario',()=>assert.deepEqual(flatten(buildEthereumTezosAttachment(input).parameters.value),g));
test('fake source bytes, unsupported routes and invalid coordinates fail locally',()=>{
 for(const change of [{network:2},{schema:2},{revision:0n},{length:0n},{offset:-1n},{slot:1n<<64n},{account:'0x11'}])assert.throws(()=>ethereumTezosAttachmentId({...c,...change}));
 assert.throws(()=>buildEthereumTezosAttachment({...input,code:'0x00'}));
 assert.throws(()=>buildEthereumTezosAttachment({...input,coordinates:{...c,offset:1n}}));
 assert.throws(()=>buildEthereumTezosAttachment({...input,accountProof:[]}));
 assert.notEqual(ethereumTezosAttachmentId({...c,revision:2n}),identity);
});
test('reader rejects wrong network and unavailable RPC before accepting a receipt',async()=>{
 const options={rpc:'http://localhost:8732',expectedChainId:'NetXdQprcVkpaWU',receiver:input.receiver,identity,expectedProfile:'0x'+'11'.repeat(32)};
 await assert.rejects(readEthereumTezosAttachment({...options,fetcher:async()=>new Response(JSON.stringify('NetWrong'))}),/Wrong Tezos network/);
 await assert.rejects(readEthereumTezosAttachment({...options,fetcher:async()=>new Response('',{status:503})}),/unavailable/);
});
const profile='0x26859e43689242e007bba2e41459c41642d976998697d0e7853d5d205f2c001b';
const record={prim:'Pair',args:[{string:'2026-09-13T04:28:36Z'},
 {prim:'Pair',args:[{bytes:c.account.slice(2)},{bytes:c.codeHash.slice(2)},{int:'3124'},{int:'1'},{bytes:c.objectId.slice(2)},{int:'0'},{int:'1'},{int:'1'},{int:'15204064'}]},
 {bytes:'5566bf50796faf93c9b6f6adacd3b32c70bfe16b48ffc59db6cd144cbdc89739'},
 {bytes:profile.slice(2)},{bytes:'5f7ced51847b6e83637675f88a7a15ed2fad87f64d67344b82b4c320ecd8d52a'},
 {string:'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx'}]};
const network='NetXdQprcVkpaWU',block='B'+'1'.repeat(50);
function rpcFixture(receipt=record){return async(url,options)=>new Response(JSON.stringify(url.endsWith('chain_id')?network:url.endsWith('/hash')?block:{data:JSON.parse(options.body).view==='source_status'?{int:'1'}:receipt}));}
test('readback decodes exact native receipt and distinguishes current status',async()=>{
 const receipt=await readEthereumTezosAttachment({rpc:'http://localhost:8732',expectedChainId:network,receiver:input.receiver,identity,expectedProfile:profile,fetcher:rpcFixture()});
 assert.deepEqual(receipt.coordinates,c);assert.equal(receipt.recordedAcceptance,true);
 assert.equal(receipt.currentSourceStatus,'finalized');assert.equal(receipt.currentProfileStatus,'unavailable');
 const wrong=structuredClone(record);wrong.args[1].args[6].int='2';
 await assert.rejects(readEthereumTezosAttachment({rpc:'http://localhost:8732',expectedChainId:network,receiver:input.receiver,identity,expectedProfile:profile,fetcher:rpcFixture(wrong)}),/coordinates mismatch/);
});
test('submission reads confirmed block and rejects failed operations',async()=>{
 const {submitEthereumTezosAttachment}=await import('../packages/sdk/src/ethereum-tezos-proof.ts');
 let sent=0,confirmed=false;const paths=[];
 const fetcher=async(url,options)=>{
  paths.push(url);if(url.endsWith('chain_id'))return new Response(JSON.stringify(network));
  const body=JSON.parse(options.body);
  if(body.view==='profile_id')return new Response(JSON.stringify({data:{bytes:profile.slice(2)}}));
  assert.equal(confirmed,true);return new Response(JSON.stringify({data:body.view==='source_status'?{int:'1'}:record}));
 };
 const options={...input,rpc:'http://localhost:8732',expectedChainId:network,expectedProfile:profile,fetcher,
 wallet:{getChainId:async()=>network,sendOperation:async()=>{sent++;return 'test-operation';}},
 waitForConfirmation:async()=>{confirmed=true;return {applied:true,blockHash:block};}};
 const result=await submitEthereumTezosAttachment(options);
 assert.equal(sent,1);assert.equal(result.receipt.blockHash,block);
 assert.ok(paths.some(x=>x.includes(`/blocks/${block}/helpers/`)));
 await assert.rejects(submitEthereumTezosAttachment({...options,waitForConfirmation:async()=>({applied:false,blockHash:block})}),/operation failed/);
 const before=sent;
 await assert.rejects(submitEthereumTezosAttachment({...options,expectedProfile:'0x'+'11'.repeat(32)}),/profile mismatch/);
 assert.equal(sent,before);
});

test('profile suspension is distinct from historical acceptance and source finality',async()=>{
 const options={rpc:'http://localhost:8732',expectedChainId:network,receiver:input.receiver,identity,expectedProfile:profile};
 for (const [state,expected] of [['0','proposed'],['1','review-delay'],['2','active'],['3','suspended'],['4','cancelled'],['5','expired'],['6','unknown'],['7','immutable'],['8','unavailable']]) {
  const base=rpcFixture();
  const fetcher=async(url,options)=> options?.body && JSON.parse(options.body).view==='profile_status'
   ?new Response(JSON.stringify({data:{int:state}})):base(url,options);
  const receipt=await readEthereumTezosAttachment({...options,fetcher});
  assert.equal(receipt.recordedAcceptance,true);assert.equal(receipt.currentSourceStatus,'finalized');
  assert.equal(receipt.currentProfileStatus,expected);
 }
});

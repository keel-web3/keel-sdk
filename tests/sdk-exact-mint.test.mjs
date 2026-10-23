import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMintAuthorizationTypedData,createExactMintAuthorizationTypedData} from '../packages/sdk/dist/typed-data.js';
import {keelMintGateAbi} from '../packages/sdk/dist/abi.js';
import {parseAbi,hashTypedData,encodeFunctionData,decodeFunctionData,toFunctionSelector,encodeEventTopics,decodeEventLog,encodeAbiParameters} from 'viem';
const gate='0x0000000000000000000000000000000000001234';
const auth={campaignId:'0x'+'12'.repeat(32),account:'0x000000000000000000000000000000000000cafe',signer:'0x000000000000000000000000000000000000beef',maxQuantity:1n,unitPrice:10n,nonce:0n,deadline:2000000000n,contextHash:'0x'+'34'.repeat(32)};
const abi=parseAbi(keelMintGateAbi);
const normalize=x=>JSON.parse(JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):typeof v==='string'?v.toLowerCase():v));
test('exact signatures have their own type and reuse identical validated fields',()=>{
 const legacy=createMintAuthorizationTypedData(11155111,gate,auth),exact=createExactMintAuthorizationTypedData(11155111,gate,auth);
 assert.deepEqual(exact.message,legacy.message);assert.deepEqual(exact.domain,legacy.domain);
 assert.equal(exact.primaryType,'ExactMintAuthorization');assert.notEqual(hashTypedData(exact),hashTypedData(legacy));
});
test('exact signing keeps uint256 nonce and common validation bounds',()=>{
 const max=(1n<<256n)-1n;
 assert.equal(createExactMintAuthorizationTypedData(11155111,gate,{...auth,nonce:max}).message.nonce,max);
 for(const bad of [{...auth,nonce:max+1n},{...auth,maxQuantity:0n},{...auth,account:'bad'}])assert.throws(()=>createExactMintAuthorizationTypedData(11155111,gate,bad));
});
test('exact and partial entrypoints encode separately with the same proof tuple',()=>{
 const proof={allowance:0n,merkleProof:[],authorization:auth,signature:'0x'+'01'.repeat(65),customData:'0x',mintData:'0x'};
 for(const functionName of ['mint','mintExact']){
  const data=encodeFunctionData({abi,functionName,args:[auth.campaignId,1n,proof]});
  const decoded=decodeFunctionData({abi,data});assert.equal(decoded.functionName,functionName);assert.deepEqual(normalize(decoded.args),normalize([auth.campaignId,1n,proof]));
 }
 assert.notEqual(toFunctionSelector(abi.find(x=>x.type==='function'&&x.name==='mint')),toFunctionSelector(abi.find(x=>x.type==='function'&&x.name==='mintExact')));
});
test('exact history receipt preserves nonce, quantity, buyer and digest',()=>{
 const digest=hashTypedData(createExactMintAuthorizationTypedData(11155111,gate,auth));
 const topics=encodeEventTopics({abi,eventName:'ExactAuthorizationConsumed',args:{campaignId:auth.campaignId,authorizationDigest:digest,account:auth.account}});
 const decoded=decodeEventLog({abi,topics,data:encodeAbiParameters([{type:'uint64'},{type:'uint256'}],[1n,0n])});
 assert.equal(decoded.eventName,'ExactAuthorizationConsumed');assert.deepEqual(normalize(decoded.args),normalize({quantity:1n,campaignId:auth.campaignId,authorizationDigest:digest,account:auth.account,nonce:0n}));
});
test('checked contract ABI and SDK selectors/topics agree',()=>{
 const compiled=JSON.parse(fs.readFileSync(new URL('../../keel-contracts/modules/keel-mint-access/abi/KeelMintGate.json',import.meta.url)));
 for(const name of ['mint','mintExact','authorizationDigest','exactAuthorizationDigest','EXACT_MINT_AUTHORIZATION_TYPEHASH'])assert.equal(toFunctionSelector(abi.find(x=>x.type==='function'&&x.name===name)),toFunctionSelector(compiled.find(x=>x.type==='function'&&x.name===name)));
 assert.deepEqual(abi.find(x=>x.type==='event'&&x.name==='ExactAuthorizationConsumed').inputs.map(({name,type,indexed})=>({name,type,indexed:!!indexed})),compiled.find(x=>x.type==='event'&&x.name==='ExactAuthorizationConsumed').inputs.map(({name,type,indexed})=>({name,type,indexed:!!indexed})));
});

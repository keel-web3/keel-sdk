import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {assertCanonicalGasEnvelope} from './header-gas-reference.mjs';
import {validate,load} from './validate-retained.mjs';
const fresh=JSON.parse(readFileSync('/tmp/keel-private-gif-fresh-forward-capture-20261020-01/normal.provisional.private.json')).capture;
const old=load();
for(const [name,capture]of [['historical actual block',old.capture],['fresh actual lower block ceiling',fresh]])test(name,()=>{
 const before=JSON.stringify(capture),result=assertCanonicalGasEnvelope(capture);
 assert.equal(result.maximumTotalGas,result.blockGasLimit);assert.equal(result.maximumExecutionGas,'16777216');
 assert.equal(result.historicalConstantUsed,false);assert.equal(JSON.stringify(capture),before);
});
const cases={
 'larger total envelope':x=>x.nativeAssembly.exactSimulationInput.maximumTransactionGas='199219142',
 'smaller total envelope':x=>x.nativeAssembly.exactSimulationInput.maximumTransactionGas='199219140',
 'historical envelope reused':x=>x.nativeAssembly.exactSimulationInput.maximumTransactionGas='200000000',
 'preparation envelope changed':x=>x.nativeAssembly.exactSimulationInput.preparationCalls[0].gas='0x1',
 'observation envelope changed':x=>x.nativeAssembly.exactSimulationInput.observationCalls[0].gas='0x1',
 'canonical hash changed':x=>x.canonicalBlock.hash='0x'+'11'.repeat(32),
 'canonical number changed':x=>x.canonicalBlock.number='1',
 'input number changed':x=>x.nativeAssembly.exactSimulationInput.blockNumber='1',
 'canonical timestamp changed':x=>x.canonicalBlock.timestamp='1',
 'native header changed':x=>x.nativeCapture.headerRlp='0xc0',
 'compiler header changed':x=>x.nativeAssembly.headerRlp='0xc0',
 'chain changed':x=>x.nativeAssembly.exactSimulationInput.chainId=1,
};
for(const [name,mutate]of Object.entries(cases))test('reject '+name,()=>{const x=structuredClone(fresh);mutate(x);assert.throws(()=>assertCanonicalGasEnvelope(x));});
for(const key of ['discoveryGasPolicy','chainId','reader','readerRuntimeCodeHash','maximumTokenUriBytes','maximumReadGas','collectionOverheadGas'])test('preserve historical strict equality '+key,async()=>{
 const x=structuredClone(fresh),input=x.nativeAssembly.exactSimulationInput;
 input[key]=typeof input[key]==='number'?input[key]+1:typeof input[key]==='string'?input[key]+'1':null;
 await assert.rejects(validate({...old,capture:x}),/Unchanged execution\/read bound/u);
});
test('whole fresh program derives exact original assets and URI without changing input',async()=>{
 const before=JSON.stringify(fresh),result=await validate({...old,capture:fresh});
 assert.equal(result.tokenURIBytes,555958);assert.equal(result.tokenURISHA256,'1d057277c522b141d1a93448923bbf17e80c9f89d3f7dd95bb8a86bb06cf04d0');
 assert.equal(result.source.sha256,'bf4c6d26e9e203a096f4c3492da46ec518de908e17af688deed76492fbbe3dbe');
 assert.equal(result.programExecuted,false);assert.equal(result.rpcRequests,0);assert.equal(JSON.stringify(fresh),before);
});

import test from'node:test';import assert from'node:assert/strict';import{createRequire}from'node:module';
import{planKeelTezosCodeConstants,expandKeelTezosCodeConstants}from'../packages/sdk/dist/tezos-code-constants.js';
import{keelTezosExpressionHash}from'../packages/sdk/dist/tezos-live-state.js';
import{groupKeelTezosOperations,estimateKeelTezosOperationBytes}from'../packages/sdk/dist/tezos-collection.js';
const require=createRequire(new URL('../node_modules/.pnpm/@taquito+local-forging@25.0.0/node_modules/@taquito/local-forging/package.json',import.meta.url));const{valueEncoder}=require('./dist/lib/michelson/codec.js');
const encode=value=>Uint8Array.from(Buffer.from(valueEncoder(value),'hex'));
const prim=(name,args)=>({prim:name,...(args?{args}:{})});
const program=()=>[prim('parameter',[prim('unit')]),prim('storage',[prim('unit')]),prim('code',[[prim('CDR'),prim('NIL',[prim('operation')]),prim('PAIR')]]),...Array.from({length:3},(_,view)=>prim('view',[{string:'test'+view},prim('unit'),prim('unit'),Array.from({length:8},(_,i)=>[prim('PUSH',[prim('string'),{string:'x'.repeat(300)+(i%4)}]),prim('DROP')]).flat()]))];
test('protocol hash matches the published Octez 999 expression vector',()=>{assert.equal(keelTezosExpressionHash(encode({int:'999'})),'expruQN5r2umbZVHy6WynYM8f71F8zS4AERz9bugF8UkPBEqrHLuU8');});
test('large scripts use exact independent AST constants and expand byte-for-byte without mutating input',()=>{
 const source=program(),before=JSON.stringify(source),plan=planKeelTezosCodeConstants(source,encode,{targetBytes:2500,maxConstantBytes:1024,minimumSavings:64});
 assert.equal(JSON.stringify(source),before);assert(plan.packedBytes<=2500);assert(plan.constants.length>0);assert(plan.constants.every(c=>c.bytes<=1024));
 assert.deepEqual(expandKeelTezosCodeConstants(plan.code,plan.constants,encode),source);assert.equal(plan.signing,'not-performed');assert.equal(plan.submission,'not-performed');
 assert.deepEqual(planKeelTezosCodeConstants(source,encode,{targetBytes:2500,maxConstantBytes:1024,minimumSavings:64}),plan);
 const groups=groupKeelTezosOperations(plan.constants.map(c=>c.operation),1400);assert(groups.length>1);for(const g of groups)assert(g.reduce((n,o)=>n+estimateKeelTezosOperationBytes(o),0)<=1400);
});
test('altered constant values, unknown references and unsafe budgets are rejected',()=>{
 const plan=planKeelTezosCodeConstants(program(),encode,{targetBytes:2500,maxConstantBytes:1024,minimumSavings:64});const bad=structuredClone(plan.constants);bad[0].value={int:'999'};
 assert.throws(()=>expandKeelTezosCodeConstants(plan.code,bad,encode),/evidence/);assert.throws(()=>expandKeelTezosCodeConstants(plan.code,[],encode),/Unresolved/);
 assert.throws(()=>planKeelTezosCodeConstants(plan.code,encode),/expanded/);assert.throws(()=>planKeelTezosCodeConstants(program(),encode,{targetBytes:32000}),/limits/);
});

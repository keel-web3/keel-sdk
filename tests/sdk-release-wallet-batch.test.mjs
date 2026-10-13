import assert from 'node:assert/strict';import test from 'node:test';
import {encodeKeelAtomicWalletBatch,assertKeelFailedReleaseTransaction} from '../packages/sdk/dist/release-wallet-batch.js';
const creator='0x1111111111111111111111111111111111111111';const calls=[{to:'0x2222222222222222222222222222222222222222',data:'0x1234',value:'0x0'},{to:creator,data:'0xabcd',value:'0x0'}];
const input=()=>({chainId:11155111,creator,calls,transaction:{chainId:11155111,from:creator,to:creator,input:encodeKeelAtomicWalletBatch(calls),value:0n},receipt:{status:'reverted',logs:[]}});
test('only an exact fully reverted atomic program authorizes receipt recovery',()=>assert.doesNotThrow(()=>assertKeelFailedReleaseTransaction(input())));
test('success, partial effects, other creator, wrong chain, value, order and unknown modes fail closed',()=>{
for(const change of [i=>i.receipt.status='success',i=>i.receipt.logs=[{}],i=>i.transaction.from=calls[0].to,i=>i.transaction.chainId=1,i=>i.transaction.value=1n,i=>i.transaction.to=calls[0].to,i=>i.transaction.input+='00',i=>i.calls=[...calls].reverse(),i=>i.transaction.input=i.transaction.input.slice(0,12)+'01'+i.transaction.input.slice(14)]){const i=input();change(i);assert.throws(()=>assertKeelFailedReleaseTransaction(i));}
});

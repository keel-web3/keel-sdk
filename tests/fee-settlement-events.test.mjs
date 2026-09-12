import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAbi,decodeEventLog,erc20Abi} from 'viem';
import {keelFeeTreasuryAbi,keelMintGateAbi} from '../packages/sdk/dist/abi.js';
import {ABIS as kernel} from '../packages/sdk/dist/abis/keel-kernel.generated.js';
import {ABIS as mint} from '../packages/sdk/dist/abis/keel-mint-access.generated.js';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const base='../../keel-contracts/benchmarks/evm-fee-review/settlement/';
for(const [name,abi,generated,module] of [['KeelFeeTreasury',keelFeeTreasuryAbi,kernel,'keel-kernel'],['KeelMintGate',keelMintGateAbi,mint,'keel-mint-access']]) {
 test(`${name}: SDK event schemas match checked-in contract ABI and retain indexed identities`,()=>{
  const canonical=read(`../../keel-contracts/modules/${module}/abi/${name}.json`);
  assert.deepEqual(generated[name],canonical);
  const simple=e=>({name:e.name,inputs:e.inputs.map(({name,type,indexed})=>({name,type,indexed:Boolean(indexed)}))});
  for(const e of parseAbi(abi).filter(e=>e.type==='event')) {
   assert.deepEqual(simple(e),simple(canonical.find(c=>c.type==='event'&&c.name===e.name)));
  }
  for(const prior of read(base+name+'.before.json').abi.filter(e=>e.type==='event')) {
   const now=canonical.find(e=>e.type==='event'&&e.name===prior.name);
   const fields=e=>simple(e).inputs.sort((a,b)=>a.name.localeCompare(b.name));
   assert.deepEqual(fields(now),fields(prior));
  }
 });
}
const evidence=read(base+'receipts.json');
test('treasury real receipt logs identify the asset and recipient after indexed-field reordering',()=>{
 for(const row of evidence.records.filter(r=>r.label.startsWith('treasury sweep '))) {
  const transfers=row.logs.flatMap(log=>{try{return [decodeEventLog({abi:erc20Abi,...log})]}catch{return []}}).filter(e=>e.eventName==='Transfer');
  const claims=row.logs.flatMap(log=>{try{return [decodeEventLog({abi:parseAbi(keelFeeTreasuryAbi),...log})]}catch{return []}}).filter(e=>e.eventName==='FeesClaimed');
  assert.equal(claims.length,Number(row.label.split(' ').at(-1)));
  for(let i=0;i<claims.length;i++) {
   assert.equal(claims[i].args.recipient,transfers[i].args.to);
   assert.equal(claims[i].args.amount,transfers[i].args.value);
   assert.equal(claims[i].args.amount,1000n);
   assert.notEqual(claims[i].args.asset,claims[i].args.recipient);
  }
 }
});
test('MintGate real receipt logs retain charged amount, quantity, signer and platform-fee status',()=>{
 for(const row of evidence.records.filter(r=>r.label.startsWith('gate '))) {
  const events=row.logs.flatMap(log=>{try{return [decodeEventLog({abi:parseAbi(keelMintGateAbi),...log})]}catch{return []}}).filter(e=>e.eventName==='Minted');
  assert.equal(events.length,1);
  const args=events[0].args, quantity=BigInt(row.label.split('x').at(-1));
  assert.equal(args.quantity,quantity);
  assert.equal(args.paid,row.label.includes('free')?0n:1000n*quantity);
  assert.equal(args.platformSigned,true);
  assert.notEqual(args.signer,args.account);
 }
});

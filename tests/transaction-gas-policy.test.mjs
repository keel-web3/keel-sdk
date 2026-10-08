import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveKeelTransactionGasPolicy, KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP } from '../packages/sdk/dist/managed-publication.js';
const policy = (chainId, blockTimestamp, blockGasLimit = 200_000_000n) => resolveKeelTransactionGasPolicy({chainId,blockTimestamp,blockGasLimit});
test('Sepolia activation changes total bounds without raising the regular execution limit', () => {
 const before=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP-1n), after=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP);
 assert.equal(before.maximumTotalGas,16_777_216n);assert.equal(before.separateStateGas,false);
 assert.equal(after.maximumTotalGas,200_000_000n);assert.equal(after.maximumExecutionGas,16_777_216n);assert.equal(after.separateStateGas,true);
 assert.equal(after.transactionBaseGas,12000);assert.equal(after.recipientAccessGas,3000);
 assert.equal(after.zeroCalldataFloorGas,64);assert.equal(after.nonzeroCalldataFloorGas,64);
 assert.equal(policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP,9_000_000_000n).maximumTotalGas,4_294_967_295n);
});
test('mainnet retains its registered pre-Amsterdam profile and all bounds respect the actual block', () => {
 assert.equal(policy(1,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP+9999n).maximumTotalGas,16_777_216n);
 assert.equal(policy(1,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP,10_000_000n).maximumTotalGas,10_000_000n);
 assert.equal(policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP,10_000_000n).maximumTotalGas,10_000_000n);
});
test('missing timestamp, malformed block and unknown chain do not inherit a permissive fallback', () => {
 assert.throws(()=>policy(11155111,undefined),/timestamp/);
 assert.throws(()=>policy(11155111,-1n),/timestamp/);
 assert.throws(()=>policy(11155111,1n,0n),/timestamp/);
 assert.throws(()=>policy(31337,1n),/registered/);
 for (const chain of ['1', 1.1, 0, -1, NaN]) assert.throws(()=>policy(chain,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP),/numeric chain/);
});

import { estimateEthereumCalldataIntrinsicGasWithEip7623, estimateKeelHistoryInscriptionGas } from '../packages/sdk/dist/managed-publication.js';
test('Amsterdam quote uses unchanged normal 4/16 but 64/64 floor and 12000+3000 base', () => {
 const p=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP);
 const quote=estimateEthereumCalldataIntrinsicGasWithEip7623({bytes:new Uint8Array([0,1]),transactionGasPolicy:p});
 assert.equal(quote.standardCalldataGas,20);assert.equal(quote.floorCalldataGas,128);
 assert.equal(quote.standardTotalGas,15020);assert.equal(quote.floorTotalGas,15128);assert.equal(quote.gasProfile,'sepolia-amsterdam');
 const old=estimateEthereumCalldataIntrinsicGasWithEip7623({bytes:new Uint8Array([0,1])});
 assert.equal(old.floorTotalGas,21050);assert.equal(old.gasProfile,'legacy-eip7623-quote');
});
test('zero-state history quote cannot put a calldata-floor-heavy batch above the regular cap', () => {
 const p=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP);
 const batch={batchIndex:0,orderedChunkCount:1,storedByteLength:263000,payloads:['0x00'],transactionInput:'0x'+'00'.repeat(263000)};
 assert.throws(()=>estimateKeelHistoryInscriptionGas({batches:[batch],transactionGasPolicy:p}),/regular execution gas cap/);
 assert.throws(()=>estimateKeelHistoryInscriptionGas({batches:[],transactionGasPolicy:p,transactionGasCap:200_000_001}),/total gas cap/);
});

import { assertKeelAmsterdamSimulationHeader } from '../packages/sdk/dist/managed-publication.js';
test('simulated Amsterdam headers must advance block number, timestamp and known slot', () => {
 const p=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP),hash='0x'+'ab'.repeat(32);
 const parent={hash,number:42n,timestamp:KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP,slotNumber:10n};
 const header={hash,parentHash:hash,number:'0x2b',timestamp:'0x6ac4fd61',slotNumber:'0xb',blockAccessListHash:hash};
 assert.doesNotThrow(()=>assertKeelAmsterdamSimulationHeader(p,header,parent));
 for (const patch of [{number:'0x2a'},{timestamp:'0x6ac4fd60'},{slotNumber:'0xa'},{parentHash:'0x'+'cd'.repeat(32)}])assert.throws(()=>assertKeelAmsterdamSimulationHeader(p,{...header,...patch},parent),/simulator/);
 const before=policy(11155111,KEEL_SEPOLIA_AMSTERDAM_TIMESTAMP-1n);
 assert.throws(()=>assertKeelAmsterdamSimulationHeader(before,header,parent),/selected fork|crossed/);
});

test('historical Prague and Osaka have their own execution/calldata rules, and unknown L2 profiles fail closed',()=>{
 const prague=policy(11155111,1741159776n),osaka=policy(11155111,1760427360n);
 assert.equal(prague.fork,'prague');assert.equal(prague.maximumExecutionGas,200_000_000n);assert.equal(prague.maximumTotalGas,200_000_000n);
 assert.equal(osaka.fork,'osaka');assert.equal(osaka.maximumExecutionGas,16_777_216n);assert.equal(osaka.maximumTotalGas,16_777_216n);
 assert.equal(prague.zeroCalldataFloorGas,10);assert.equal(prague.nonzeroCalldataFloorGas,40);
 assert.equal(prague.feeModel,'ethereum-l1');assert.match(prague.rulesSource,/v1\.17\.7/);
 assert.throws(()=>policy(11155111,1741159775n),/registered/);assert.throws(()=>policy(8453,1791475620n),/registered/);
 assert.equal(policy(1,1760427360n).fork,'prague');assert.equal(policy(11155111,1760427360n).fork,'osaka');
});
test('a missing or different fork/header never authenticates a historical simulation',()=>{
 const p=policy(11155111,1760427359n),hash='0x'+'ab'.repeat(32),parent={hash,number:1n,timestamp:1760427359n};
 assert.throws(()=>assertKeelAmsterdamSimulationHeader(p,{},parent),/simulator/);
 assert.throws(()=>assertKeelAmsterdamSimulationHeader(p,{hash,parentHash:hash,number:'0x2',timestamp:'0x'+(1760427360n).toString(16)},parent),/fork/);
});

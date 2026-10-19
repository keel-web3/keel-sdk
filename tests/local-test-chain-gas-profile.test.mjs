import test from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../packages/sdk/dist/transaction-gas-policy.js';
const evidence={environment:'test',rpcUrl:'http://127.0.0.1:18545',clientVersion:'anvil/v1.8.5',nodeInfo:{hardFork:'Osaka',network:'ethereum',environment:{chainId:31337,gasLimit:'0xbebc200'},forkConfig:{forkUrl:null}},genesis:{number:'0x0',hash:'0x'+'71'.repeat(32),gasLimit:'0xbebc200'}};
test('verified explicit local Osaka fixture resolves the same policy used by publication',()=>{
 assert.equal(typeof policy.createKeelLocalTestChainGasProfile,'function','Explicit local fixture profile is missing; current publication rejects chain31337.');
 const localTestChainProfile=policy.createKeelLocalTestChainGasProfile(evidence);
 const resolved=policy.resolveKeelTransactionGasPolicy({chainId:31337,blockTimestamp:1792262053n,blockGasLimit:200000000n,localTestChainProfile});
 assert.equal(resolved.profile,'local-anvil-osaka');assert.equal(resolved.maximumTotalGas,16777216n);assert.equal(resolved.separateStateGas,false);assert.equal(resolved.transactionBaseGas,21000);assert.equal(resolved.zeroCalldataFloorGas,10);assert.equal(resolved.nonzeroCalldataFloorGas,40);
});

test('local profiles reject production, public RPC, wrong chain/fork/client and forked state',()=>{
 for(const patch of [{environment:'production'},{rpcUrl:'https://127.0.0.1:18545'},{rpcUrl:'http://rpc.example:8545'},{clientVersion:'anvil/v1.7.1'},{nodeInfo:{...evidence.nodeInfo,hardFork:'Amsterdam'}},{nodeInfo:{...evidence.nodeInfo,environment:{chainId:1,gasLimit:'0xbebc200'}}},{nodeInfo:{...evidence.nodeInfo,forkConfig:{forkUrl:'https://example.com'}}}])assert.throws(()=>policy.createKeelLocalTestChainGasProfile({...evidence,...patch}),/development\/test/);
});
test('unknown/unregistered chains and copied/changed profile evidence remain closed',()=>{
 const localTestChainProfile=policy.createKeelLocalTestChainGasProfile(evidence),base={chainId:31337,blockTimestamp:1792262053n,blockGasLimit:200000000n};
 assert.throws(()=>policy.resolveKeelTransactionGasPolicy(base),/registered/);
 assert.throws(()=>policy.resolveKeelTransactionGasPolicy({...base,localTestChainProfile:{...localTestChainProfile}}),/does not match/);
 assert.throws(()=>policy.resolveKeelTransactionGasPolicy({...base,chainId:31338,localTestChainProfile}),/does not match/);
 assert.throws(()=>policy.resolveKeelTransactionGasPolicy({...base,chainId:1,localTestChainProfile}),/does not match/);
 assert.throws(()=>policy.resolveKeelTransactionGasPolicy({...base,blockGasLimit:200000001n,localTestChainProfile}),/does not match/);
 assert.equal(policy.resolveKeelTransactionGasPolicy({...base,blockGasLimit:10000000n,localTestChainProfile}).maximumTotalGas,10000000n);
});
import {keelTransactionGasCap} from '../packages/sdk/dist/tx-gas.js';
test('selected-block planning requires the same explicit local profile',()=>{
 const input={chainId:31337,blockTimestamp:1792262053n,blockGasLimit:200000000n};assert.throws(()=>keelTransactionGasCap(input),/registered/);
 const actual=keelTransactionGasCap({...input,localTestChainProfile:policy.createKeelLocalTestChainGasProfile(evidence)});assert.equal(actual.gasCap,16777216);assert.equal(actual.source,'local-anvil-osaka');assert.equal(actual.profileResolved,true);
});

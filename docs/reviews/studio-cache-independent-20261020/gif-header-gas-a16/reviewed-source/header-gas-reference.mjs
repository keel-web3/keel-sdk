// The normal compiler derives its envelope from each actual pinned block.
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {api,SDK_ROOT,SDK_COMMIT} from './canonical-reference.mjs';
import {plain} from './strict/deployed-core.mjs';
import {sha} from './strict/identity.mjs';
const {resolveKeelTransactionGasPolicy}=await import(pathToFileURL(SDK_ROOT+'/packages/sdk/dist/transaction-gas-policy.js'));
export function assertCanonicalGasEnvelope(capture){
 const input=plain(capture.nativeAssembly.exactSimulationInput),rlp=capture.nativeAssembly.headerRlp,pin=capture.canonicalBlock;
 assert.equal(typeof rlp,'string');assert.match(rlp,/^0x(?:[0-9a-f]{2})+$/iu);
 assert.equal(api.keccak256(rlp).toLowerCase(),pin.hash.toLowerCase(),'Header bytes must hash to the normal canonical pin');
 assert.equal(capture.nativeCapture.headerRlp,rlp,'Native and compiler header bytes must match');
 const fields=api.fromRlp(rlp,'hex');assert.ok(Array.isArray(fields)&&fields.length>=15,'Full Ethereum header required');
 const quantity=i=>{const x=fields[i];assert.equal(typeof x,'string');assert.match(x,/^0x[0-9a-f]+$/iu);assert.ok(!x.startsWith('0x00'),'Canonical positive header quantity required');return BigInt(x);};
 const number=quantity(8),blockGasLimit=quantity(9),timestamp=quantity(11);
 assert.equal(number,BigInt(pin.number));assert.equal(number,BigInt(input.blockNumber));assert.equal(timestamp,BigInt(pin.timestamp));
 const policy=resolveKeelTransactionGasPolicy({chainId:input.chainId,blockTimestamp:timestamp,blockGasLimit});
 assert.equal(BigInt(input.maximumTransactionGas),policy.maximumTotalGas,'Exact actual-SDK block/fork gas envelope required');
 for(const call of [...input.preparationCalls,...input.observationCalls])assert.equal(BigInt(call.gas),policy.maximumTotalGas,'Normal preparation/observation envelope must match the same block policy');
 return {sdkCommit:SDK_COMMIT,profile:policy.profile,headerHash:pin.hash,headerRlpSHA256:sha(rlp),blockNumber:number.toString(),blockTimestamp:timestamp.toString(),blockGasLimit:blockGasLimit.toString(),maximumTotalGas:policy.maximumTotalGas.toString(),maximumExecutionGas:policy.maximumExecutionGas.toString(),inputGasChanged:false,historicalConstantUsed:false};
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from 'viem';
import { inspectContract, IMPLEMENTATION_SLOT, ADMIN_SLOT, BEACON_SLOT, rpcUrl } from '../src/contract-rpc.mjs';
const address = '0x1111111111111111111111111111111111111111';
const implementation = '0x2222222222222222222222222222222222222222';
const contract = { chainId: 11155111, address, name: 'Proxy', kind: 'proxy', source: 'manual', abi: [], proxy: { kind: 'eip1967', implementation } };
const client = (overrides = {}) => ({ getChainId: async () => 11155111, getBlockNumber: async () => 100n, getCode: async () => '0x6000', getStorageAt: async ({ slot }) => slot === IMPLEMENTATION_SLOT ? toHex(BigInt(implementation), { size: 32 }) : toHex(0, { size: 32 }), ...overrides });
test('ERC1967 slots match the standard and all observations use one block', async () => {
  assert.equal(IMPLEMENTATION_SLOT, '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc');
  assert.equal(ADMIN_SLOT, '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103');
  const evidence = await inspectContract(contract, '', client({ getCode: async (args) => { assert.equal(args.blockNumber, 100n); return '0x6000'; } }));
  assert.equal(evidence.implementation, implementation);
  assert.equal(evidence.importedImplementationMismatch, false);
  assert.equal(evidence.authority, 'unverified');
  assert.equal(evidence.abiMatchesCode, 'not-established');
});
test('wrong-chain RPC and absent code fail; changed implementation is visible', async () => {
  await assert.rejects(inspectContract(contract, '', client({ getChainId: async () => 1 })), /does not match/);
  await assert.rejects(inspectContract(contract, '', client({ getCode: async () => '0x' })), /No contract code/);
  const evidence = await inspectContract(contract, '', client({ getStorageAt: async () => toHex(0, { size: 32 }) }));
  assert.equal(evidence.importedImplementationMismatch, true);
});
test('beacons resolve through their implementation getter and conflicting slots fail', async () => {
  const mock = client({ getStorageAt: async ({ slot }) => slot === BEACON_SLOT ? toHex(BigInt(address), { size: 32 }) : toHex(0, { size: 32 }), readContract: async ({ address: target, blockNumber }) => { assert.equal(target, address); assert.equal(blockNumber, 100n); return implementation; } });
  assert.equal((await inspectContract(contract, '', mock)).kind, 'beacon');
  await assert.rejects(inspectContract(contract, '', client({ getStorageAt: async () => toHex(BigInt(address), { size: 32 }) })), /Both implementation and beacon/);
  assert.throws(() => rpcUrl('http://example.com'), /HTTPS/);
  assert.throws(() => rpcUrl('https://user:password@example.com'), /HTTPS/);
  assert.equal(rpcUrl('http://127.0.0.1:8545'), 'http://127.0.0.1:8545/');
});

test('unsigned simulation binds the selected sender, chain, value and block without a send method', async () => {
  const { simulateControl } = await import('../src/contract-rpc.mjs');
  const { createTrackedContract } = await import('@keel/sdk/contract-controls');
  const target = '0x1111111111111111111111111111111111111111';
  const sender = '0x2222222222222222222222222222222222222222';
  let calls = 0;
  const contract = createTrackedContract({ name: 'Test', address: target, chainId: 11155111, kind: 'custom', source: 'manual', abi: [{ type: 'function', name: 'setValue', stateMutability: 'nonpayable', inputs: [{ type: 'uint256' }], outputs: [] }] });
  const client = { getChainId: async () => 11155111, getBlockNumber: async () => 42n, getCode: async () => '0x6000', getStorageAt: async () => '0x'+'0'.repeat(64), call: async (call) => { calls++; assert.equal(call.account, sender); assert.equal(call.to, target); assert.equal(call.blockNumber, 42n); assert.equal(call.value, 0n); return { data: '0x' }; } };
  const result = await simulateControl({ contract, signature: 'setValue(uint256)', args: ['1'], account: sender }, client);
  assert.equal(result.simulation, 'succeeded-at-observed-block'); assert.equal(result.signing, 'not-performed'); assert.equal(calls, 1);
  await assert.rejects(simulateControl({ contract, signature: 'setValue(uint256)', args: ['1'], account: sender }, { ...client, getChainId: async () => 1 }), /does not match/);
});

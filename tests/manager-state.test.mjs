import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, encodeFunctionResult, decodeFunctionResult } from 'viem';
import { keelManagerAbi } from '../packages/sdk/dist/abi.js';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';

const abi = parseAbi(keelManagerAbi);
const normalize = item => JSON.parse(JSON.stringify(item.type === 'event' ? { anonymous: false, ...item, inputs: item.inputs.map(input => ({ indexed: false, ...input })) } : item, (key, value) => key === 'internalType' ? undefined : value));

test('grouped read inputs and outputs match the generated ABI', () => {
  for (const name of ['governanceState', 'executionPolicyState', 'automationKeyState', 'governanceEpoch', 'executionMode']) {
    const current = ABIS.KeelManager.find(entry => entry.name === name);
    const browser = abi.find(entry => entry.name === name);
    // Non-snapshot scalar return names need not be present in the human ABI.
    if (name.endsWith('State')) assert.deepEqual(normalize(browser), normalize(current), name);
    else assert.ok(browser && current);
  }
  assert.deepEqual(normalize(abi.find(entry => entry.name === 'RpcHostListConfigured')), normalize(ABIS.KeelManager.find(entry => entry.name === 'RpcHostListConfigured')));
});

test('retired tiny getters are absent from both public ABIs', () => {
  const retired = ['governanceThreshold', 'governanceNonce', 'governorChangeNonce', 'executionPolicy', 'executionPolicyNonce', 'automationKeyValidUntil', 'automationNonce', 'automationKeyGeneration'];
  for (const name of retired) {
    assert.ok(!abi.some(entry => entry.name === name), name);
    assert.ok(!ABIS.KeelManager.some(entry => entry.name === name), name);
  }
});

test('grouped results preserve named fields and integer boundaries', () => {
  const max64 = (1n << 64n) - 1n, max256 = (1n << 256n) - 1n;
  const cases = [
    ['governanceState', { threshold: 22n, nonce: max256, epoch: max64, changeNonce: max64 }],
    ['executionPolicyState', { maxValue: (1n << 96n) - 1n, minimumTier: 3, enabled: true, nonce: max256 }],
    ['automationKeyState', { validUntil: max64, nonce: max256, generation: max256 }],
  ];
  for (const [functionName, result] of cases) {
    const data = encodeFunctionResult({ abi: ABIS.KeelManager, functionName, result });
    assert.deepEqual(decodeFunctionResult({ abi, functionName, data }), result);
  }
});

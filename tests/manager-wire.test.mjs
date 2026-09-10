import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, encodeErrorResult, toEventSelector, toFunctionSelector } from 'viem';
import { formatAbiItem } from 'viem/utils';
import { ABIS } from '../packages/sdk/dist/abis/keel-artifacts.generated.js';
import { keelManagerErrorsAbi, decodeKeelManagerError } from '../packages/sdk/dist/manager-errors.js';
import { keelManagerEventsAbi, decodeKeelManagerLog } from '../packages/sdk/dist/manager-events.js';

const word = value => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
const address = '0x0000000000000000000000000000000000001234';

test('manager and helper share RPC errors and the actual event layout', () => {
  const events = abi => abi.find(entry => entry.type === 'event' && entry.name === 'RpcHostListConfigured');
  assert.deepEqual(events(ABIS.KeelManager), events(ABIS.KeelManagerRpcPolicy));
  assert.deepEqual(events(ABIS.KeelManager).inputs.map(input => input.indexed), [true, false, false, false]);
  for (const name of ['InvalidRpcHostList', 'RpcHostListRevisionMismatch']) {
    const error = abi => abi.find(entry => entry.type === 'error' && entry.name === name);
    assert.deepEqual(error(ABIS.KeelManager), error(ABIS.KeelManagerRpcPolicy));
  }
  const mismatch = keelManagerErrorsAbi.find(entry => entry.name === 'RpcHostListRevisionMismatch');
  assert.deepEqual(mismatch.inputs.map(input => input.name), ['supplied', 'current']);
});

test('proxy ABI advertises the recovery log and roster failure that its helper emits', () => {
  for (const name of ['ManagerRecovered', 'InvalidRecoveryGovernors']) {
    assert.deepEqual(ABIS.KeelManagerProxy.find(entry => entry.name === name), ABIS.KeelManagerRecovery.find(entry => entry.name === name));
  }
});

test('manager errors preserve selectors, argument order and boundary values without duplicate entries', () => {
  const signatures = keelManagerErrorsAbi.map(formatAbiItem);
  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(new Set(signatures.map(toFunctionSelector)).size, signatures.length);
  const samples = [
    ['GovernorThresholdNotMet', [1n, 2n]],
    ['RpcHostListRevisionMismatch', [9n, 1n]],
    ['UpgradeNotReady', [(1n << 64n) - 1n]],
    ['SystemsUnavailable', [(1n << 192n) - 1n]],
    ['CodeHashMismatch', [word(1), word(2)]],
    ['InvalidGovernorSignature', [address]],
    ['InvalidRecoveryGovernors', undefined],
    ['RecoveryLocked', undefined],
    ['UnauthorizedRole', undefined],
  ];
  for (const [errorName, args] of samples) {
    const data = encodeErrorResult({ abi: keelManagerErrorsAbi, errorName, args });
    const decoded = decodeKeelManagerError(data);
    assert.equal(decoded.errorName, errorName);
    assert.deepEqual(decoded.args, args);
  }
  for (const data of ['0x', '0x01', '0xffffffff', '0xgggggggg', toFunctionSelector('SystemsUnavailable(uint192)')]) {
    assert.equal(decodeKeelManagerError(data), null);
  }
});

test('a real receipt from before standardization decodes RPC and governance fields', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/manager-rpc-receipt.json', import.meta.url)));
  const rpc = decodeKeelManagerLog(fixture.logs[0]);
  assert.equal(rpc.eventName, 'RpcHostListConfigured');
  assert.deepEqual(rpc.args, { digest: fixture.logs[0].topics[1], revision: 1n, epoch: 1n, hostCount: 1n });
  const governance = decodeKeelManagerLog(fixture.logs[1]);
  assert.equal(governance.eventName, 'GovernanceExecuted');
  assert.equal(governance.args.nonce, 0n);
  assert.equal(governance.args.value, 0n);
  assert.equal(governance.args.selector, '0x575fa028');
  assert.equal(decodeKeelManagerLog({ ...fixture.logs[0], topics: [...fixture.logs[0].topics, word(1)] }), null);
});

test('recovery roster and indexed tier events retain all frontend fields', () => {
  const governors = [address, '0x0000000000000000000000000000000000005678'];
  const recovery = decodeKeelManagerLog({
    topics: [toEventSelector('ManagerRecovered(uint64,uint64,address[])')],
    data: encodeAbiParameters([{ type: 'uint64' }, { type: 'uint64' }, { type: 'address[]' }], [2n, 1n, governors]),
  });
  assert.equal(recovery.eventName, 'ManagerRecovered');
  assert.deepEqual(recovery.args, { governanceEpoch: 2n, recoveryEpoch: 1n, governors });
  const tier = decodeKeelManagerLog({
    topics: [toEventSelector('AccountTierConfigured(address,uint8,uint8)'), word(address), word(0), word(3)], data: '0x',
  });
  assert.deepEqual(tier.args, { account: address, previousTier: 0, nextTier: 3 });
});

test('event registry has unique signatures and rejects unknown or truncated logs', () => {
  const signatures = keelManagerEventsAbi.map(formatAbiItem);
  assert.equal(new Set(signatures).size, signatures.length);
  assert.equal(new Set(signatures.map(toEventSelector)).size, signatures.length);
  for (const log of [
    { topics: [], data: '0x' },
    { topics: [word(123)], data: '0x' },
    { topics: [toEventSelector('RpcHostListConfigured(bytes32,uint64,uint64,uint256)'), word(1)], data: '0x' },
    { topics: [toEventSelector('ManagerRecovered(uint64,uint64,address[])')], data: word(2) },
    { topics: [toEventSelector('AccountTierConfigured(address,uint8,uint8)'), word(address)], data: '0x' },
  ]) assert.equal(decodeKeelManagerLog(log), null);
});

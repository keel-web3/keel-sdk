import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAbi, decodeFunctionData } from 'viem';
import { contractControls, createTrackedContract, contractIdentity, parseContractAbi, prepareContractControl } from '../packages/sdk/dist/contract-controls.js';
const address = '0x1111111111111111111111111111111111111111';
const implementation = '0x2222222222222222222222222222222222222222';
const abi = parseAbi(['function balanceOf(address who) view returns (uint256)', 'function mint(address to,uint256 amount)', 'function mint(uint256 amount)', 'function purchase(uint256 amount) payable', 'function batch((address owner,uint256 amount)[] items)']);
const proxy = () => createTrackedContract({ address, chainId: 11155111, name: 'My collection', kind: 'proxy', source: 'manual', abi, proxy: { kind: 'eip1967', implementation } });
test('tracked identity includes the chain and ABI cannot invent verified authority', () => {
  assert.notEqual(contractIdentity(1, address), contractIdentity(11155111, address));
  assert.equal(createTrackedContract({ ...proxy(), authority: 'owner' }).authority, 'unverified');
  assert.throws(() => contractIdentity(0, address));
  assert.throws(() => createTrackedContract({ ...proxy(), address: 'bad' }));
});
test('overloads get separate controls and write calldata targets proxy, never implementation', () => {
  const controls = contractControls(abi);
  assert.equal(controls.filter((c) => c.name === 'mint').length, 2);
  assert.equal(controls.find((c) => c.name === 'balanceOf').mode, 'read');
  const call = prepareContractControl({ contract: proxy(), signature: 'mint(uint256)', args: ['9007199254740993'] });
  assert.equal(call.to, address);
  assert.notEqual(call.to, implementation);
  assert.deepEqual(decodeFunctionData({ abi, data: call.data }).args, [9007199254740993n]);
  assert.equal(call.status, 'review-only');
  assert.throws(() => prepareContractControl({ contract: proxy(), signature: 'mint', args: ['1'] }));
  assert.throws(() => prepareContractControl({ contract: proxy(), signature: 'mint(uint256)', args: [9007199254740992] }), /decimal strings/);
});
test('tuple arrays preserve precision and native value is permitted only on payable methods', () => {
  const call = prepareContractControl({ contract: proxy(), signature: 'batch((address,uint256)[])', args: [[[address, '123']]] });
  assert.equal(decodeFunctionData({ abi, data: call.data }).args[0][0].amount, 123n);
  assert.throws(() => prepareContractControl({ contract: proxy(), signature: 'mint(uint256)', args: ['1'], valueWei: '1' }), /Only payable/);
  assert.equal(prepareContractControl({ contract: proxy(), signature: 'purchase(uint256)', args: ['1'], valueWei: '123' }).valueWei, '123');
});
test('ABI imports accept compiler artifacts and reject ambiguous or hostile shapes', () => {
  assert.deepEqual(parseContractAbi({ abi }), abi);
  assert.throws(() => parseContractAbi([abi[0], abi[0]]), /Duplicate/);
  assert.throws(() => parseContractAbi([{ type: 'function', name: 'run', inputs: [], outputs: [] }]), /stateMutability/);
  assert.throws(() => parseContractAbi(Array.from({ length: 513 }, () => abi[0])), /maximum/);
  assert.throws(() => parseContractAbi([{ type: 'script', name: 'run' }]), /Invalid/);
  for (const type of ['uint7', 'int257', 'uint999[]']) assert.throws(() => parseContractAbi([{ type: 'function', name: 'bad', stateMutability: 'view', inputs: [{ type }], outputs: [] }]), /integer widths/);
  assert.throws(() => parseContractAbi(' '.repeat(512_001)), /exceeds/);
});

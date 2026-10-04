import assert from 'node:assert/strict';
import test from 'node:test';
import {compiledDeployableNames} from './compiled-deployables.mjs';

test('internal-only library bytecode stubs are excluded even with error ABI', () => {
  assert.deepEqual(compiledDeployableNames('libraries/Internal.sol', {
    bytecode: {object: '0x600080fd'}, abi: [{type: 'error', name: 'Invalid'}], methodIdentifiers: {},
  }), []);
});
test('callable external and public libraries remain deployable', () => {
  assert.deepEqual(compiledDeployableNames('libraries/Formatter.sol', {
    bytecode: {object: '60006000'}, abi: [{type: 'function', name: 'format'}],
  }), ['Formatter']);
  assert.deepEqual(compiledDeployableNames('libraries/StorageCalls.sol', {
    bytecode: {object: '60006000'}, abi: [], methodIdentifiers: {'read(Thing storage)': '12345678'},
  }), ['StorageCalls']);
});
test('compiler AST classifies libraries outside conventional directories', () => {
  const artifact = {bytecode: {object: '0x600080fd'}, abi: [],
    ast: {nodes: [{nodeType: 'ContractDefinition', name: 'Internal', contractKind: 'library'}]}};
  assert.deepEqual(compiledDeployableNames('helpers/Internal.sol', artifact), []);
});
test('interfaces and abstract bases require actual creation bytecode', () => {
  for (const object of ['', '0x']) assert.deepEqual(compiledDeployableNames('Base.sol', {
    bytecode: {object}, abi: [{type: 'function', name: 'read'}],
  }), []);
});
test('unlinked concrete creation code stays cataloged for explicit link resolution', () => {
  assert.deepEqual(compiledDeployableNames('Collection.sol', {
    bytecode: {object: '0x60__$0123456789012345678901234567890123$__00'}, abi: [],
  }), ['Collection']);
});

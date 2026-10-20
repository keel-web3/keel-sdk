import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KeelChainCapabilityError,
  KeelTezosAccountOperationError,
  buildKeelTezosAccountExecute,
  keelTezosTokenBoundAccountKey,
  prepareKeelTezosTokenBoundAccount,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const contracts = (path) => readFileSync(new URL(`../../keel-contracts/${path}`, import.meta.url), 'utf8');
const NETWORK = 'NetXdQprcVkpaWU';
const REGISTRY = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const HOST = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const ACCOUNT = 'KT1Tezooo1zzSmartPyzzSTATiCzzzyfC8eF';
const CAROL = 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx';

nodeTest('the registry key and create call use the registry layout; the address is read back', () => {
  const key = keelTezosTokenBoundAccountKey({ tokenContract: HOST, tokenId: 7, salt: '0x0A' });
  assert.deepEqual(key, { prim: 'Pair', args: [{ string: HOST }, { prim: 'Pair', args: [{ int: '7' }, { bytes: '0a' }] }] });
  const prepared = prepareKeelTezosTokenBoundAccount({ network: NETWORK, registry: REGISTRY, tokenContract: HOST, tokenId: 7, salt: '0x0a' });
  assert.deepEqual(prepared.operation, { kind: 'transaction', amount: '0', destination: REGISTRY, parameters: { entrypoint: 'create_account', value: key } });
  assert.equal(prepared.implementation, REGISTRY);
  assert.deepEqual(prepared.readBack, { contract: REGISTRY, view: 'account', input: key, returns: 'option address' });
  assert.equal(prepared.signing, 'not-performed');
  assert.throws(() => keelTezosTokenBoundAccountKey({ tokenContract: CAROL, tokenId: 1, salt: '0x01' }), /KT1/);
  assert.throws(() => keelTezosTokenBoundAccountKey({ tokenContract: HOST, tokenId: -1, salt: '0x01' }), RangeError);
  assert.throws(() => keelTezosTokenBoundAccountKey({ tokenContract: HOST, tokenId: 1, salt: '0x1' }), /salt/);
  assert.throws(() => prepareKeelTezosTokenBoundAccount({ network: 'mainnet', registry: REGISTRY, tokenContract: HOST, tokenId: 1, salt: '0x' }), /Net/);
});

nodeTest('execute writes one lambda that emits the calls in order', () => {
  const { operation, authorization } = buildKeelTezosAccountExecute({
    account: ACCOUNT, attach: 3,
    calls: [{ kind: 'value', to: CAROL, amount: 25 }, { kind: 'fa2', fa2: HOST, tokenId: 2, to: CAROL }],
  });
  assert.equal(authorization, 'host-owner');
  assert.equal(operation.destination, ACCOUNT);
  assert.equal(operation.amount, '3');
  assert.equal(operation.parameters.entrypoint, 'execute');
  const code = operation.parameters.value;
  assert.deepEqual(code.slice(0, 2), [{ prim: 'DROP' }, { prim: 'NIL', args: [{ prim: 'operation' }] }]);
  // CONS prepends, so the last call is pushed first and the first call ends up first in the list.
  const pushes = code.filter((node) => node.prim === 'PUSH' && node.args[0].prim === 'address').map((node) => node.args[1].string);
  assert.deepEqual(pushes, [HOST, CAROL]);
  assert.equal(code.filter((node) => node.prim === 'TRANSFER_TOKENS').length, 2);
  assert.equal(code.filter((node) => node.prim === 'CONS').length, 2);
  const batch = code.find((node) => node.prim === 'PUSH' && node.args[0].prim === 'list').args[1];
  assert.deepEqual(batch, [{ prim: 'Pair', args: [{ string: ACCOUNT }, [{ prim: 'Pair', args: [{ string: CAROL }, { prim: 'Pair', args: [{ int: '2' }, { int: '1' }] }] }]] }]);
  assert.ok(code.some((node) => node.prim === 'CONTRACT' && node.annots?.[0] === '%transfer'));
  assert.ok(code.some((node) => node.prim === 'PUSH' && node.args[0].prim === 'mutez' && node.args[1].int === '25'));
});

nodeTest('only CALL exists on Tezos; other ERC-6551 operations get a typed error', () => {
  for (const operation of [1, 2, 3]) {
    assert.throws(() => buildKeelTezosAccountExecute({ account: ACCOUNT, operation, calls: [{ kind: 'value', to: CAROL, amount: 1 }] }),
      (error) => error instanceof KeelTezosAccountOperationError && error instanceof KeelChainCapabilityError && error.code === 'KEEL_CHAIN_CAPABILITY_UNSUPPORTED' && error.capability === 'stake.token-bound-account.delegate-call' && error.operation === operation);
  }
  assert.equal(buildKeelTezosAccountExecute({ account: ACCOUNT, operation: 0, calls: [{ kind: 'value', to: CAROL, amount: 1 }] }).operation.amount, '0');
  assert.throws(() => buildKeelTezosAccountExecute({ account: ACCOUNT, calls: [] }), RangeError);
  assert.throws(() => buildKeelTezosAccountExecute({ account: ACCOUNT, calls: [{ kind: 'delegate', to: CAROL }] }), /kind/);
  assert.throws(() => buildKeelTezosAccountExecute({ account: CAROL, calls: [{ kind: 'value', to: CAROL, amount: 1 }] }), /KT1/);
});

nodeTest('the capability map lists the native registry and account', () => {
  const resolution = resolveKeelChainCapability('stake.token-bound-account', 'tezos');
  assert.equal(resolution.supported, true);
  assert.equal(resolution.capability.status, 'adapter-different');
  assert.deepEqual(resolution.adapter.contracts.slice(0, 2), ['KeelTokenBoundAccountRegistry', 'KeelTokenBoundAccount']);
});

siblingSource('the SDK matches the SmartPy registry key, entrypoints and views', () => {
  const source = contracts('src/modules/keel-stake/tezos/keel_token_bound_account.py');
  assert.match(source, /\.layout\(\("token_contract", \("token_id", "salt"\)\)\)/u);
  for (const name of ['def create_account(self, key)', 'def account(self, key)', 'def execute(self, action)', 'def token(self)', 'def owner(self)', 'def state(self)', 'def is_valid_signer(self, signer)']) {
    assert.ok(source.includes(name), name);
  }
  assert.match(source, /sp\.lambda_\(sp\.unit, sp\.list\[sp\.operation\]\)/u);
  const fixture = JSON.parse(contracts('test/fixtures/parity/token-bound-account.json'));
  assert.ok(fixture.steps.some((step) => step.op === 'execute' && step.tezos === 'KEEL_ACCOUNT_OWNER'));
});

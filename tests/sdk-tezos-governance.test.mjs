import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_GOVERNANCE_ERRORS,
  KEEL_TEZOS_MUTEZ_MAX,
  KEEL_TEZOS_UINT64_MAX,
  buildKeelTezosGovernanceApprovals,
  buildKeelTezosGovernanceLambda,
  buildKeelTezosGovernanceProposal,
  keelTezosGovernanceThreshold,
  resolveKeelChainCapability,
} from '../packages/sdk/dist/index.js';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const MANAGER = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';
const SINK = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const call = (tag, amount) => ({ destination: SINK, entrypoint: 'receive_value', parameterType: { prim: 'nat' }, value: { int: String(tag) }, amount });

// The lambda the Octez replay (keel-contracts script/parity/tezos-governance-value-counters-proof.py) hand-writes for one call.
const oneCall = (amount) => [
  { prim: 'CDR' },
  { prim: 'PUSH', args: [{ prim: 'address' }, { string: SINK }] },
  { prim: 'CONTRACT', args: [{ prim: 'nat' }], annots: ['%receive_value'] },
  { prim: 'IF_NONE', args: [[{ prim: 'PUSH', args: [{ prim: 'string' }, { string: 'KEEL_TARGET' }] }, { prim: 'FAILWITH' }], []] },
  { prim: 'PUSH', args: [{ prim: 'mutez' }, { int: String(amount) }] },
  { prim: 'PUSH', args: [{ prim: 'nat' }, { int: '7' }] },
  { prim: 'TRANSFER_TOKENS' },
  { prim: 'CONS' },
  { prim: 'UNIT' },
  { prim: 'PAIR' },
];

nodeTest('the errors name the EVM errors and the limits are EVM uint64 and Tezos mutez', () => {
  assert.equal(KEEL_TEZOS_GOVERNANCE_ERRORS.KEEL_INCORRECT_VALUE, 'IncorrectValue');
  assert.equal(KEEL_TEZOS_GOVERNANCE_ERRORS.KEEL_COUNTER_OVERFLOW, 'Panic(0x11)');
  assert.equal(KEEL_TEZOS_GOVERNANCE_ERRORS.KEEL_PAUSE_REVISION_OVERFLOW, 'Panic(0x11)');
  assert.equal(KEEL_TEZOS_UINT64_MAX, 18446744073709551615n);
  assert.equal(KEEL_TEZOS_MUTEZ_MAX, 9223372036854775807n);
});

nodeTest('the threshold is EVM ceil(2N/3) for three to 32 governors', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 32].map(keelTezosGovernanceThreshold), [2, 3, 4, 4, 5, 22]);
  assert.throws(() => keelTezosGovernanceThreshold(2), /3 to 32/u);
  assert.throws(() => keelTezosGovernanceThreshold(33), RangeError);
});

nodeTest('one call builds the lambda the Octez replay runs, forwarding exactly its value', () => {
  const { lambda, value } = buildKeelTezosGovernanceLambda([{ ...call(7, 5) }]);
  assert.deepEqual(lambda, oneCall(5));
  assert.equal(value, 5n);
});

nodeTest('calls are consed in order and their amounts add to the proposal value', () => {
  const proposal = buildKeelTezosGovernanceProposal({ manager: MANAGER, deadline: 2000, calls: [call(21, 2), call(22, 3)] });
  assert.equal(proposal.value, 5n);
  assert.equal(proposal.operation.parameters.entrypoint, 'propose_with_value');
  assert.equal(proposal.operation.amount, '0', 'a proposal never carries tez');
  const [lambda, rest] = proposal.operation.parameters.value.args;
  assert.deepEqual(rest, { prim: 'Pair', args: [{ int: '2000' }, { int: '5' }] });
  const tags = lambda.filter((item) => item.prim === 'PUSH' && item.args[0].prim === 'nat').map((item) => item.args[1].int);
  assert.deepEqual(tags, ['21', '22']);
  assert.equal(lambda.filter((item) => item.prim === 'CONS').length, 2);
  assert.equal(proposal.signing, 'not-performed');
});

nodeTest('a zero-value action uses plain propose, and the default entrypoint needs no annotation', () => {
  const proposal = buildKeelTezosGovernanceProposal({ manager: MANAGER, deadline: '2000',
    calls: [{ destination: 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx', parameterType: { prim: 'unit' }, value: { prim: 'Unit' } }] });
  assert.equal(proposal.value, 0n);
  assert.equal(proposal.operation.parameters.entrypoint, 'propose');
  assert.deepEqual(proposal.operation.parameters.value.args[1], { int: '2000' });
  const contract = proposal.lambda.find((item) => item.prim === 'CONTRACT');
  assert.equal(contract.annots, undefined);
});

nodeTest('only the approval that reaches the threshold attaches the value', () => {
  const approvals = buildKeelTezosGovernanceApprovals({ manager: MANAGER, proposalId: 4, value: 5n, governorCount: 4 });
  assert.deepEqual(approvals.map((a) => [a.executes, a.operation.amount, a.operation.parameters.value.int]),
    [[false, '0', '4'], [true, '5', '4']]);
  const three = buildKeelTezosGovernanceApprovals({ manager: MANAGER, proposalId: 0, governorCount: 3 });
  assert.deepEqual(three.map((a) => [a.executes, a.operation.amount]), [[true, '0']]);
});

nodeTest('bad input is refused before any call is built', () => {
  assert.throws(() => buildKeelTezosGovernanceLambda([]), /1\.\.32/u);
  assert.throws(() => buildKeelTezosGovernanceLambda([call(1, -1)]), RangeError);
  assert.throws(() => buildKeelTezosGovernanceLambda([call(1, KEEL_TEZOS_MUTEZ_MAX + 1n)]), RangeError);
  assert.throws(() => buildKeelTezosGovernanceLambda([call(1, KEEL_TEZOS_MUTEZ_MAX), call(2, 1)]), /more than a Tezos amount/u);
  assert.throws(() => buildKeelTezosGovernanceLambda([{ ...call(1, 0), entrypoint: 'not an entrypoint' }]), TypeError);
  assert.throws(() => buildKeelTezosGovernanceLambda([{ ...call(1, 0), destination: 'tz1notAnAddress' }]));
  assert.throws(() => buildKeelTezosGovernanceProposal({ manager: 'tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx', deadline: 1, calls: [call(1, 0)] }), /KT1/u);
  assert.throws(() => buildKeelTezosGovernanceProposal({ manager: MANAGER, deadline: KEEL_TEZOS_UINT64_MAX + 1n, calls: [call(1, 0)] }), RangeError);
});

nodeTest('the capability map lists governance value and counters', () => {
  const value = resolveKeelChainCapability('authority.governance-value', 'tezos');
  assert.equal(value.supported, true);
  assert.match(value.capability.tezos.behaviour, /propose_with_value/u);
  const counters = resolveKeelChainCapability('authority.governance-counters', 'tezos');
  assert.equal(counters.capability.status, 'parity');
});

siblingSource('the error map covers every Tezos error the shared fixture expects', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/governance-value-counters.json', import.meta.url), 'utf8'));
  const pairs = new Set(fixture.steps.filter((step) => step.tezos).map((step) => `${step.tezos}=${step.evm}`));
  for (const pair of pairs) {
    const [tezos, evm] = pair.split('=');
    assert.equal(KEEL_TEZOS_GOVERNANCE_ERRORS[tezos], evm, pair);
  }
  assert.equal(String(KEEL_TEZOS_UINT64_MAX), fixture.uint64Max);
});

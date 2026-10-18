import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { siblingTest } from './sibling-repository.mjs';
import {
  KEEL_TEZOS_ACCESS_CONTROLLER_MODULE_ID,
  KEEL_TEZOS_PAUSE_ERRORS,
  buildKeelPauseAction,
  buildKeelTezosPauseAction,
  buildKeelTezosResumeAction,
  decodeKeelTezosPauseState,
  KEEL_TEZOS_MODULES,
  KEEL_TEZOS_PAUSE_GATES,
  keelPauseBits,
  keelTezosPauseGate,
  keelTezosPausedFor,
  keelPausePresets,
} from '../packages/sdk/dist/index.js';
import { keccak256, stringToHex } from 'viem';

const siblingSource = siblingTest(nodeTest, 'keel-contracts');
const CONTROLLER = 'KT1BNnzhtsMKUG7t72phZN8BG2W6TwPUQsYt';
const MANAGER = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton';

nodeTest('a Tezos stop goes to the access controller and a resume to the manager, with EVM masks', () => {
  const mask = keelPauseBits.chunking | keelPauseBits.mintOne;
  const pause = buildKeelTezosPauseAction(CONTROLLER, mask);
  assert.equal(pause.authorization, buildKeelPauseAction('0x0000000000000000000000000000000000000001', mask).authorization);
  assert.deepEqual(pause.operation, { kind: 'transaction', amount: '0', destination: CONTROLLER, parameters: { entrypoint: 'pause_systems', value: { int: '65' } } });
  const resume = buildKeelTezosResumeAction(MANAGER, keelPauseBits.chunking, 1n);
  assert.equal(resume.authorization, 'governance');
  assert.equal(resume.sender, MANAGER);
  assert.deepEqual(resume.operation.parameters, { entrypoint: 'resume_systems', value: { prim: 'Pair', args: [{ int: '1' }, { int: '1' }] } });
  assert.equal(pause.signing, 'not-performed');
});

nodeTest('masks and revisions EVM would refuse are refused before they are built', () => {
  assert.throws(() => buildKeelTezosPauseAction(CONTROLLER, 0n), /supported pause controls/u);
  assert.throws(() => buildKeelTezosPauseAction(CONTROLLER, keelPausePresets.all + 1n), /supported pause controls/u);
  assert.throws(() => buildKeelTezosResumeAction(MANAGER, 1n, 1n << 64n), /uint64/u);
  assert.throws(() => buildKeelTezosPauseAction('tz1KqTpEZ7Yob7QbPE4Hy4Wo8fHG8LhKxZSx', 1n), /KT1/u);
});

nodeTest('the Tezos state reads like the EVM state', () => {
  const state = decodeKeelTezosPauseState({ prim: 'Pair', args: [{ int: '1020' }, { int: '7' }] });
  assert.equal(state.flags, 1020n);
  assert.equal(state.revision, 7n);
  assert.equal(state.allMintsPaused, true);
  assert.equal(state.controls.find((control) => control.id === 'mintOne').paused, true);
  assert.equal(state.controls.find((control) => control.id === 'viewers').paused, false);
  assert.throws(() => decodeKeelTezosPauseState({ prim: 'Pair', args: [{ int: '32768' }, { int: '0' }] }), RangeError);
  assert.equal(KEEL_TEZOS_PAUSE_ERRORS.KEEL_SYSTEMS_UNAVAILABLE, 'SystemsUnavailable');
  assert.equal(KEEL_TEZOS_ACCESS_CONTROLLER_MODULE_ID, keccak256(stringToHex('keel.module.access-controller')));
});

siblingSource('the shared pause vectors use the SDK bits and error names on both chains', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/system-pause.json', import.meta.url), 'utf8'));
  const names = { CHUNKING: 'chunking', VIEWERS: 'viewers', MINT_721: 'mint721', MINT_1155: 'mint1155', MINT_ADMIN: 'mintAdmin', MINT_CAMPAIGN: 'mintCampaign',
    MINT_ONE: 'mintOne', MINT_AUCTION: 'mintAuction', MINT_CROSS_CHAIN: 'mintCrossChain', MINT_IP: 'mintIP', PUBLICATION: 'publication', MARKET: 'market',
    STAKING: 'staking', COLLECTIONS: 'collections', TREASURY: 'treasury' };
  for (const [name, id] of Object.entries(names)) assert.equal(BigInt(fixture.bits[name]), keelPauseBits[id], name);
  assert.equal(BigInt(fixture.bits.ALL), keelPausePresets.all);
  assert.equal(BigInt(fixture.bits.ALL_MINTS), keelPausePresets.allMints);
  for (const step of fixture.steps) {
    if (step.tezos) assert.equal(KEEL_TEZOS_PAUSE_ERRORS[step.tezos], step.evm, step.label);
    else assert.equal(step.evm, '', step.label);
  }
});

nodeTest('every native pause gate names a cataloged entrypoint and an EVM bit', () => {
  const entrypoints = new Map();
  for (const module of KEEL_TEZOS_MODULES) for (const [contract, names] of Object.entries(module.entrypoints)) entrypoints.set(contract, new Set([...(entrypoints.get(contract) ?? []), ...names]));
  for (const [key, mask] of Object.entries(KEEL_TEZOS_PAUSE_GATES)) {
    const [contract, entrypoint] = key.split('.');
    assert.ok(entrypoints.get(contract)?.has(entrypoint), key);
    assert.ok(mask > 0n && (mask & ~keelPausePresets.all) === 0n, key);
  }
  assert.equal(keelTezosPauseGate('KeelMarket', 'cancel_listing'), 0n);
  assert.deepEqual(keelTezosPausedFor('KeelMarket', 'buy', keelPausePresets.all).map((control) => control.id), ['market']);
  assert.deepEqual(keelTezosPausedFor('KeelMarket', 'buy', keelPauseBits.chunking), []);
});

siblingSource('the module gate vectors use the SDK gates on both chains', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../keel-contracts/test/fixtures/parity/system-pause-modules.json', import.meta.url), 'utf8'));
  const named = new Set();
  for (const gate of fixture.gates) for (const name of gate.tezos) {
    const [contract, entrypoint] = name.split('.');
    assert.equal(keelTezosPauseGate(contract, entrypoint), BigInt(gate.mask), name);
    named.add(name);
  }
  for (const entry of fixture.open) for (const name of entry.tezos) {
    const [contract, entrypoint] = name.split('.');
    assert.equal(keelTezosPauseGate(contract, entrypoint), 0n, name);
  }
  const lanes = new Set(['KeelHold', 'KeelHoldOnchFS', 'KeelMarket', 'KeelIPActionExecutor']);
  for (const key of Object.keys(KEEL_TEZOS_PAUSE_GATES)) if (lanes.has(key.split('.')[0])) assert.ok(named.has(key), key);
});
